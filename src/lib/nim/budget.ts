/**
 * Prompt budgeting for the NIM models.
 *
 * WHY THIS EXISTS — measured, not theorised (2026-08-06, live against the tier):
 *
 *   1. Every model on this endpoint has a 131,072-token window, and going over
 *      it is NOT a soft degrade: the endpoint returns HTTP 400 immediately, on
 *      EVERY key and EVERY model:
 *        "This model's maximum context length is 131072 tokens. However, your
 *         messages resulted in 133383 tokens."
 *      The canvas agent had no total cap anywhere — a 35k-char system prompt,
 *      up to 200 snapshot objects at 3k chars of content each, 125k chars of
 *      dropped-file text, 24k of crawled web text and 14k of reference text all
 *      went in unchecked. On a busy board that sailed past the limit, every
 *      hedge slot 400'd, the route 502'd, and the user was told "AI models are
 *      busy or rate-limited" — which was a flat lie, and no amount of retrying
 *      on another key could ever fix it. Meanwhile the chat panel, which sends
 *      ~2k tokens and no snapshot, answered instantly. That is the whole
 *      "the canvas agent says busy while chat works fine" bug.
 *
 *   2. Below the limit, prompt size is still the single biggest latency term.
 *      Time-to-first-token on nemotron-super-49b, same trivial task:
 *          11k tokens →  3.7s
 *          33k tokens → 11.3s
 *          83k tokens → 25.4s
 *      The agent's give-up deadline is 28s, so a merely LARGE prompt pushed
 *      every slot in the race past its deadline — the same 502, the same lie.
 *      Prompt bytes are latency. Spend them like money.
 *
 * So: nothing reaches the model without passing through a budget. The hard cap
 * guarantees we never 400; the soft target keeps an ordinary run fast.
 */

/** Every model behind this app advertises a 131,072-token window. */
export const MODEL_CONTEXT_TOKENS = 131_072;

/**
 * Rough tokens-per-char for the mixed English + JSON + code this app sends.
 * Deliberately PESSIMISTIC (assumes short tokens) so the estimate over-counts
 * rather than under-counts — an over-count costs a little trimming, an
 * under-count costs a 400.
 */
const CHARS_PER_TOKEN = 3.2;

export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

export function tokensToChars(tokens: number): number {
  return Math.floor(tokens * CHARS_PER_TOKEN);
}

/**
 * The most input we will ever send, whatever the caller asks for. Sits far
 * enough below the window that the reserved output tokens (up to ~16k) and any
 * error in the char→token estimate still cannot reach the ceiling.
 */
export const HARD_INPUT_TOKENS = 96_000;
export const HARD_INPUT_CHARS = tokensToChars(HARD_INPUT_TOKENS); // ~307k chars

/**
 * What an ordinary build should stay under so it feels instant. A run carrying
 * a real document (a dropped PDF, a crawled page) is allowed past this up to
 * the hard cap — reading the whole document IS the task there, and the user has
 * accepted the wait by attaching it.
 */
export const FAST_INPUT_TOKENS = 14_000;
export const FAST_INPUT_CHARS = tokensToChars(FAST_INPUT_TOKENS); // ~44k chars

/**
 * One piece of the prompt competing for room.
 * Lower `priority` wins when space runs short. `min` is the floor below which
 * the section is worth nothing and is dropped whole rather than shaved to a
 * meaningless stub.
 */
export interface BudgetSection {
  key: string;
  text: string;
  priority: number;
  /** Drop entirely rather than trim below this many chars. */
  min?: number;
  /** Never give this section more than this, even when there's room to spare. */
  max?: number;
}

export interface BudgetResult {
  /** Section text after trimming, keyed as supplied. Dropped sections are absent. */
  sections: Record<string, string>;
  /** Sections removed outright because they couldn't fit above their floor. */
  dropped: string[];
  /** Sections that were shortened. */
  trimmed: string[];
  totalChars: number;
  estimatedTokens: number;
}

/**
 * Fit a set of sections into a char budget, honouring priority.
 *
 * Sections are granted in priority order. Each gets what it asks for while
 * there's room; the first one that doesn't fit is trimmed to whatever remains
 * (or dropped if that's below its floor), and everything after it is dropped.
 * Trimming cuts from the END and leaves a visible marker so the model knows the
 * material was truncated rather than silently believing it saw everything.
 */
export function fitToBudget(sections: BudgetSection[], budgetChars: number): BudgetResult {
  const ordered = [...sections].sort((a, b) => a.priority - b.priority);
  const out: Record<string, string> = {};
  const dropped: string[] = [];
  const trimmed: string[] = [];
  let remaining = Math.max(0, budgetChars);

  for (const s of ordered) {
    const text = s.text || '';
    if (!text.trim()) continue;
    const want = s.max ? Math.min(text.length, s.max) : text.length;
    const floor = s.min ?? 400;

    if (want <= remaining) {
      const slice = text.slice(0, want);
      out[s.key] = slice;
      if (want < text.length) trimmed.push(s.key);
      remaining -= want;
      continue;
    }

    if (remaining >= floor) {
      const marker = '\n\n…[truncated to fit the model\'s context window]';
      out[s.key] = text.slice(0, Math.max(0, remaining - marker.length)) + marker;
      trimmed.push(s.key);
      remaining = 0;
      continue;
    }

    dropped.push(s.key);
  }

  const totalChars = Object.values(out).reduce((n, t) => n + t.length, 0);
  return { sections: out, dropped, trimmed, totalChars, estimatedTokens: estimateTokens(Object.values(out).join('')) };
}

/**
 * Final safety net: clamp an already-assembled message list so the request can
 * never 400. Trims the LARGEST message first (that's the one that blew the
 * budget) rather than dropping whole turns.
 */
export function clampMessages<T extends { role: string; content: string }>(
  messages: T[],
  maxInputTokens: number = HARD_INPUT_TOKENS,
): { messages: T[]; clamped: boolean; estimatedTokens: number } {
  const total = messages.reduce((n, m) => n + estimateTokens(m.content), 0);
  if (total <= maxInputTokens) return { messages, clamped: false, estimatedTokens: total };

  const next = messages.map((m) => ({ ...m }));
  let over = total - maxInputTokens;
  // Repeatedly shave the biggest message until we're inside the budget.
  while (over > 0) {
    let biggest = 0;
    for (let i = 1; i < next.length; i++) {
      if (next[i].content.length > next[biggest].content.length) biggest = i;
    }
    const target = next[biggest];
    if (target.content.length < 800) break; // nothing meaningful left to take
    const cut = Math.min(target.content.length - 400, tokensToChars(over) + 200);
    target.content = target.content.slice(0, target.content.length - cut) +
      '\n\n…[truncated to fit the model\'s context window]';
    over -= estimateTokens(' '.repeat(cut));
  }

  const estimatedTokens = next.reduce((n, m) => n + estimateTokens(m.content), 0);
  return { messages: next as T[], clamped: true, estimatedTokens };
}
