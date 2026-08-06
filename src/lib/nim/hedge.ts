/**
 * Hedged NIM streaming.
 *
 * Lifted verbatim out of the agent-chat route so the frame agent races models
 * the same proven way instead of growing a second, subtly different copy. Each
 * slot in the plan has its own launch delay; a later slot only enters the race
 * if nobody has produced a first token yet. First token wins, losers are
 * aborted, and a hard failure pulls the next unlaunched slot forward at once.
 */

import { clampMessages, estimateTokens, HARD_INPUT_TOKENS } from './budget';

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

export interface ChatMsg {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface HedgeSlot {
  model: string;
  delayMs: number;
}

/**
 * Why an attempt failed, in a form the caller can turn into an HONEST message.
 *
 * This exists because every failure used to surface to the user as "AI models
 * are busy or rate-limited" — including the one failure that had nothing to do
 * with load and could never be fixed by retrying: an over-long prompt, which
 * the endpoint rejects with a flat 400 on every key and every model. Telling
 * someone to "wait a few seconds and try again" when the real problem is that
 * their board is too big to send is worse than useless.
 */
export type HedgeFailureKind =
  | 'oversized'   // 400 — prompt exceeded the context window. Retrying cannot help.
  | 'rate-limit'  // 429 — genuinely throttled. Retrying later helps.
  | 'gone'        // 404/410 — the model id is dead. A code fix, not a user problem.
  | 'timeout'     // no first token inside the deadline on any slot.
  | 'upstream';   // anything else.

export class HedgeError extends Error {
  kind: HedgeFailureKind;
  status?: number;
  constructor(message: string, kind: HedgeFailureKind, status?: number) {
    super(message);
    this.name = 'HedgeError';
    this.kind = kind;
    this.status = status;
  }
}

function classify(status: number | undefined, message: string): HedgeFailureKind {
  if (status === 400 && /context length|too long|maximum context/i.test(message)) return 'oversized';
  if (status === 429) return 'rate-limit';
  if (status === 404 || status === 410) return 'gone';
  if (/abort|timeout|no content/i.test(message)) return 'timeout';
  return 'upstream';
}

export interface HedgeOptions {
  /** Give-up bound per attempt, NOT a latency dial — hedging owns perceived speed. */
  ttftDeadlineMs?: number;
  temperature?: number;
  maxTokens?: number;
}

const DEFAULTS: Required<HedgeOptions> = {
  ttftDeadlineMs: 28_000,
  temperature: 0.55,
  maxTokens: 8000,
};

async function openModelStream(
  apiKey: string,
  model: string,
  messages: ChatMsg[],
  opts: Required<HedgeOptions>,
  external?: AbortController,
): Promise<ReadableStream<Uint8Array>> {
  const controller = external ?? new AbortController();
  const ttftTimer = setTimeout(() => controller.abort(), opts.ttftDeadlineMs);

  const res = await fetch(NVIDIA_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      stream: true,
    }),
    signal: controller.signal,
  });

  if (!res.ok || !res.body) {
    clearTimeout(ttftTimer);
    const errText = res.body ? await res.text() : '';
    throw new HedgeError(
      `${model} status ${res.status}: ${errText.slice(0, 200)}`,
      classify(res.status, errText),
      res.status,
    );
  }

  const upstream = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let sseBuffer = '';

  const pump = async (): Promise<string | null> => {
    while (true) {
      const { done, value } = await upstream.read();
      if (done) return null;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || '';
      let out = '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return out || '';
        try {
          const json = JSON.parse(payload);
          const piece = json.choices?.[0]?.delta?.content;
          if (typeof piece === 'string') out += piece;
        } catch {
          /* partial JSON line — next read completes it */
        }
      }
      if (out) return out;
    }
  };

  // Commit to this model only once its first token lands.
  let firstText = '';
  let firstSeen = false;
  while (!firstSeen) {
    const chunk = await pump();
    if (chunk === null) {
      clearTimeout(ttftTimer);
      throw new HedgeError(`${model} produced no content`, 'timeout');
    }
    if (chunk.length > 0) { firstSeen = true; firstText = chunk; }
  }
  clearTimeout(ttftTimer);

  return new ReadableStream<Uint8Array>({
    start(ctrl) { if (firstText) ctrl.enqueue(encoder.encode(firstText)); },
    async pull(ctrl) {
      try {
        const chunk = await pump();
        if (chunk === null) { ctrl.close(); return; }
        if (chunk) ctrl.enqueue(encoder.encode(chunk));
      } catch (e) {
        ctrl.error(e);
      }
    },
    cancel() { controller.abort(); },
  });
}

export function openHedgedStream(
  apiKeys: string[],
  startKey: number,
  messages: ChatMsg[],
  plan: HedgeSlot[],
  options: HedgeOptions = {},
): Promise<{ stream: ReadableStream<Uint8Array>; model: string; inputTokens: number }> {
  const opts = { ...DEFAULTS, ...options };

  /* LAST LINE OF DEFENCE against the 400 that used to masquerade as "models are
     busy". Callers are expected to budget their own prompts (lib/nim/budget),
     but a single unbudgeted caller anywhere would take the whole agent down on
     every key at once, so clamp here too. Leave room for the requested output:
     the endpoint counts input + max_tokens against the same window. */
  const outputReserve = Math.ceil(opts.maxTokens * 1.1);
  const inputCeiling = Math.max(8000, HARD_INPUT_TOKENS - outputReserve);
  const clamped = clampMessages(messages, inputCeiling);
  if (clamped.clamped) {
    console.warn(`[NIM] prompt clamped to ~${clamped.estimatedTokens} tokens (ceiling ${inputCeiling})`);
  }
  messages = clamped.messages;
  const inputTokens = clamped.estimatedTokens || messages.reduce((n, m) => n + estimateTokens(m.content), 0);

  return new Promise((resolve, reject) => {
    const controllers: (AbortController | undefined)[] = [];
    const timers: (ReturnType<typeof setTimeout> | undefined)[] = [];
    let launchedCount = 0;
    let failed = 0;
    let settled = false;
    let lastError: Error = new Error('no models attempted');

    const launch = (i: number) => {
      if (settled || controllers[i]) return; // already raced this slot
      if (timers[i] !== undefined) { clearTimeout(timers[i]); timers[i] = undefined; }
      launchedCount++;
      const controller = new AbortController();
      controllers[i] = controller;
      openModelStream(apiKeys[(startKey + i) % apiKeys.length], plan[i].model, messages, opts, controller)
        .then((stream) => {
          if (settled) { controller.abort(); return; } // lost the race — cancel
          settled = true;
          timers.forEach((t) => { if (t !== undefined) clearTimeout(t); });
          controllers.forEach((c, j) => { if (j !== i) c?.abort(); });
          resolve({ stream, model: plan[i].model, inputTokens });
        })
        .catch((err) => {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (!settled) console.warn(`NIM model ${plan[i].model} (slot ${i}) failed:`, lastError.message);
          failed++;
          if (settled) return;
          /* An OVERSIZED prompt is not bad luck — every remaining slot will 400
             on it too. Fail the whole race at once instead of burning the rest
             of the plan (and ~30s of the user's time) rediscovering it. */
          if (lastError instanceof HedgeError && lastError.kind === 'oversized') {
            settled = true;
            timers.forEach((t) => { if (t !== undefined) clearTimeout(t); });
            controllers.forEach((c) => c?.abort());
            reject(lastError);
            return;
          }
          const next = plan.findIndex((_, j) => !controllers[j]);
          if (next !== -1) launch(next);
          else if (failed >= launchedCount) reject(lastError);
        });
    };

    plan.forEach((slot, i) => {
      if (slot.delayMs <= 0) launch(i);
      else timers[i] = setTimeout(() => launch(i), slot.delayMs);
    });
  });
}

/** The configured NIM keys, in order. Empty when none are set. */
export function nimApiKeys(): string[] {
  return [
    process.env.NVIDIA_API_KEY,
    process.env.NVIDIA_API_KEY_2,
    process.env.NVIDIA_API_KEY_3,
    process.env.NVIDIA_API_KEY_4,
    process.env.NVIDIA_API_KEY_5,
  ].filter(Boolean) as string[];
}
