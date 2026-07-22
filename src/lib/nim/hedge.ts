/**
 * Hedged NIM streaming.
 *
 * Lifted verbatim out of the agent-chat route so the frame agent races models
 * the same proven way instead of growing a second, subtly different copy. Each
 * slot in the plan has its own launch delay; a later slot only enters the race
 * if nobody has produced a first token yet. First token wins, losers are
 * aborted, and a hard failure pulls the next unlaunched slot forward at once.
 */

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

export interface ChatMsg {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface HedgeSlot {
  model: string;
  delayMs: number;
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
    throw new Error(`${model} status ${res.status}: ${errText.slice(0, 160)}`);
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
      throw new Error(`${model} produced no content`);
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
): Promise<{ stream: ReadableStream<Uint8Array>; model: string }> {
  const opts = { ...DEFAULTS, ...options };
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
          resolve({ stream, model: plan[i].model });
        })
        .catch((err) => {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (!settled) console.warn(`NIM model ${plan[i].model} (slot ${i}) failed:`, lastError.message);
          failed++;
          if (settled) return;
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
