/**
 * The NIM model roster — ONE source of truth for every agent surface
 * (canvas builder, chat, frame agent).
 *
 * ── HOW THESE WERE CHOSEN (live shootout, 2026-08-06) ────────────────────────
 *
 * The old roster was picked on TIME-TO-FIRST-TOKEN, and that is the wrong
 * metric for a builder. The canvas agent's job is to stream a COMPLETE JSON
 * action plan; a first token in 400ms is worthless if the plan then dribbles
 * out for another 76 seconds and gets cut off mid-action. What matters is
 * THROUGHPUT and whether the model CLOSES ITS JSON.
 *
 * Measured on the real task (build a Roman-Empire board: sticky notes,
 * sections, a chart — the exact shape of a normal ask), THREE runs, some
 * serial and some concurrent across keys:
 *
 *   model                                   time to a COMPLETE plan   actions
 *   openai/gpt-oss-20b                       10.5s / 11.5s / 19.5s      5-6
 *   nvidia/llama-3.3-nemotron-super-49b-v1   76.5s / 55.7s / 34.8s      2-9   ← old lead
 *   openai/gpt-oss-120b                      75.5s / 58.0s / 91.1s     9-11
 *   mistralai/mistral-nemotron                        33.6s              6
 *   meta/llama-3.1-8b-instruct               31.8s / 5.6s / TIMED OUT    8-9
 *   nvidia/nemotron-3-nano-30b-a3b                    58.6s              6
 *   nvidia/nvidia-nemotron-nano-9b-v2                 37.7s              4
 *   nvidia/nemotron-3-super-120b-a12b                 46.2s              1
 *   mistralai/mistral-medium-3.5-128b                141.2s              9
 *
 * The old lead was the SLOWEST generator on the tier — 37-82 chars/second,
 * 35-76 seconds for one board. That single number is the whole "the agent is
 * dumb, short, half-done and takes forever" complaint. gpt-oss-20b builds the
 * same board 3-7x sooner and is the only model that was never slower than 20s.
 *
 * llama-3.1-8b is a genuine WILDCARD: 5.6s in one run (650 chars/s, the fastest
 * result recorded anywhere), a 180s timeout in the next. Perfect hedge material
 * — held back far enough that it only wins when the preferred lanes are cold,
 * where a fast partial board beats a spinner.
 *
 * DEAD — do not re-add without probing first:
 *   mistralai/mistral-large-3-675b-instruct-2512 → HTTP 410 Gone, end-of-life
 *     2026-07-23. It was still slot 3 of "heavy", slot 4 of "balanced", slot 4
 *     of chat and slot 2 of the frame agent — a guaranteed-failing lane in
 *     every single race, on every key, wasting one of only 5 hedge slots.
 *   moonshotai/kimi-k2.6 → HTTP 404 for this account.
 *   deepseek-ai/deepseek-v4-flash, z-ai/glm-5.2, meta/llama-3.3-70b-instruct,
 *   nvidia/llama-3.3-nemotron-super-49b-v1.5 → no first token inside 150-180s,
 *   repeatedly.
 *
 * ── HOW THE DELAYS WORK ──────────────────────────────────────────────────────
 * openHedgedStream resolves on the FIRST TOKEN and aborts every other attempt,
 * so a slot that fires early WINS THE WHOLE PLAN. That makes the delays a
 * ranking, not just a safety net: a lower-quality model must be held back past
 * the lead's expected first token, or it steals a board it will only half
 * build. Hence gpt-oss-20b leads, a second gpt-oss-20b on a DIFFERENT KEY
 * rescues a cold lead, and the fast-but-truncating 8B is held until it's clear
 * both preferred lanes are cold — at which point a finished-ish board beats no
 * board at all.
 */

export interface HedgeSlot {
  model: string;
  delayMs: number;
}

export const MODELS = {
  /** Fastest to a COMPLETE plan, every run. The builder's lead. */
  builder: 'openai/gpt-oss-20b',
  /** Most actions and flawless JSON, but 58-91s — a far-out depth backstop only. */
  deep: 'openai/gpt-oss-120b',
  /**
   * Wildcard: 5.6s when warm, a 180s timeout when not — and, critically, the
   * least reliable at the JSON contract. Caught live emitting UNESCAPED nested
   * JSON inside a string ("content":"{"type":"link",…}"), which terminates the
   * string early and corrupts brace depth for the entire rest of the document:
   * an unrecoverable stream, zero blocks on the canvas, no error. It is fast
   * enough to WIN a race it should not win, so it is deliberately held to the
   * back of every build plan except "quick" (where plans are 1-3 actions and it
   * copes fine). A rescue of last resort, never a lead.
   */
  fast: 'meta/llama-3.1-8b-instruct',
  /** Middle lane: ~34s, valid JSON. Diversity against a bad gpt-oss day. */
  mid: 'mistralai/mistral-nemotron',
  /** Fluent prose, answers directly. Great for chat, far too slow to build with. */
  prose: 'nvidia/llama-3.3-nemotron-super-49b-v1',
} as const;

export type Profile = 'heavy' | 'balanced' | 'quick';

/**
 * BUILDER plans — optimised for "the whole plan lands, complete, soon".
 * Every slot after the first sits on a different key (the racer rotates keys by
 * slot index), so a cold or rate-limited key is overtaken rather than fatal.
 */
export const BUILD_PLANS: Record<Profile, HedgeSlot[]> = {
  /* Research boards, dashboards, workflows, reorganising a whole canvas.

     THREE builder lanes before anything else enters. Whoever wins the
     first-token race OWNS the whole generation — there is no second chance if
     the winner then streams slowly — so the ranking has to be biased hard
     toward the model that finishes fastest. Measured live: with only two
     builder lanes, a dashboard where both gpt-oss keys happened to be cold fell
     through to mistral-nemotron and took 107s end to end; the same board on a
     warm builder lane takes ~11-20s. Three lanes on three different keys make
     that fall-through much rarer, and cost nothing when the lead is warm (the
     pending timers are cleared the moment a token lands). */
  heavy: [
    { model: MODELS.builder, delayMs: 0 },
    { model: MODELS.builder, delayMs: 3000 },
    { model: MODELS.builder, delayMs: 6500 },
    { model: MODELS.mid, delayMs: 11_000 },     // different family, reliably valid JSON
    { model: MODELS.deep, delayMs: 20_000 },    // most thorough, slowest
    { model: MODELS.fast, delayMs: 32_000 },    // true last resort — see the warning below
  ],
  // The everyday ask.
  balanced: [
    { model: MODELS.builder, delayMs: 0 },
    { model: MODELS.builder, delayMs: 3000 },
    { model: MODELS.builder, delayMs: 6500 },
    { model: MODELS.mid, delayMs: 11_000 },
    { model: MODELS.deep, delayMs: 20_000 },
    { model: MODELS.fast, delayMs: 28_000 },
  ],
  // "add a heading", "make this bigger" — 1-3 actions, latency IS the feature.
  // The 8B is allowed in early here and ONLY here: a plan this short is one it
  // reliably finishes, and the whole point of this profile is to feel instant.
  quick: [
    { model: MODELS.builder, delayMs: 0 },
    { model: MODELS.fast, delayMs: 3000 },
    { model: MODELS.builder, delayMs: 5500 },
    { model: MODELS.mid, delayMs: 9000 },
  ],
};

/**
 * CONVERSATION plan (chat + frame agent) — plain markdown, no JSON contract, so
 * first token really is what the user feels. nemotron stays the lead here: it's
 * fluent and answers directly, and a chat reply is short enough that its low
 * throughput never bites.
 */
export const CHAT_PLAN: HedgeSlot[] = [
  { model: MODELS.prose, delayMs: 0 },
  { model: MODELS.prose, delayMs: 1100 },   // 2nd key — rescue a cold lead
  { model: MODELS.builder, delayMs: 2600 },
  { model: MODELS.fast, delayMs: 6000 },
  { model: MODELS.deep, delayMs: 14_000 },
];

/** Signals that the task needs real reasoning and a big output budget. */
const HEAVY_RE =
  /\b(dashboard|workflow|roadmap|timeline|architect|architecture|system design|strategy|research|analy[sz]e|compare|curriculum|syllabus|study plan|business plan|organi[sz]e|reorgani[sz]e|restructure|tidy|clean up|report|board|guide|breakdown|deep dive|comprehensive|end.to.end|in detail|step by step|everything about|full|complete)\b/i;

/**
 * A genuinely ONE-MOVE edit, where a big budget just adds latency.
 *
 * This used to be `/^(add|make|set|change|…)/` with a 60-char limit, which
 * caught "make me a full startup dashboard" (34 chars) and handed it a 2500
 * token ceiling — the plan hit the ceiling and was chopped off mid-JSON. That
 * is a large part of the "it only half did it" complaint. Now it must ALSO name
 * a single small target and must NOT look heavy.
 */
const QUICK_RE =
  /^(?:\s*(?:please|pls|hey)\s*)?(?:add|make|set|change|rename|resize|recolor|colour|color|move|delete|remove)\s+(?:a|an|the|this|that|it|my)?\s*[\w\s-]{0,28}$/i;

const ONE_WORD_STYLE_RE = /^(?:\s*(?:please|pls)\s*)?(?:bigger|smaller|bold|italic|wider|taller|darker|lighter|undo)\b/i;

export function pickProfile(prompt: string, mode?: string): Profile {
  if (mode === 'workflow') return 'heavy';
  const p = (prompt || '').trim();
  if (HEAVY_RE.test(p)) return 'heavy';
  if (p.length <= 44 && (QUICK_RE.test(p) || ONE_WORD_STYLE_RE.test(p)) && !/[?]/.test(p)) return 'quick';
  return 'balanced';
}

/** A deep ask that must be allowed to run long and land complete. */
export const RESEARCH_RE =
  /\b(research|deep dive|deep-dive|comprehensive|in[\s-]?depth|thorough(?:ly)?|everything about|tell me everything|full report|detailed report|write[\s-]?up|literature review|state of the art|whitepaper|white paper|dossier|exhaustive|complete guide|ultimate guide|study (?:guide|plan)|curriculum|syllabus)\b/i;

/**
 * Output-token ceiling. These are COMPLETION FLOORS as much as latency dials —
 * a plan that hits the ceiling is truncated mid-JSON, which leaves the board
 * half-built and is the worst possible outcome.
 */
export function maxTokensFor(profile: Profile, opts: { workflow?: boolean; research?: boolean }): number {
  if (opts.workflow) return 12_000;
  if (profile === 'quick') return 4000;      // was 2500 — too tight, plans were being cut
  if (profile === 'heavy') return opts.research ? 14_000 : 11_000;
  return opts.research ? 11_000 : 8000;      // balanced
}

export function temperatureFor(profile: Profile, workflow: boolean): number {
  if (workflow) return 0.5;
  if (profile === 'quick') return 0.35;
  return profile === 'heavy' ? 0.45 : 0.45;
}
