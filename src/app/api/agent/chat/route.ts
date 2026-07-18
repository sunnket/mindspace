import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

/* Same serverless NIM models the canvas agent uses (measured fast TTFT). Chat
   must feel INSTANT, so it leads with a fast-but-smart mid model and only falls
   over to the heavier ones if that stalls — a 675B frontier model generates
   tokens too slowly to lead an interactive chat. */
const CHAIN = [
  'mistralai/mistral-medium-3.5-128b',
  'meta/llama-3.1-70b-instruct',
  'mistralai/mistral-large-3-675b-instruct-2512',
];

const TTFT_DEADLINE_MS = 12_000;

const SYSTEM_PROMPT = `You are the Mindspace Agent — a brilliant, warm AI partner living inside the user's infinite spatial canvas app. Right now you're talking with the user in a chat panel on the side of their canvas. You are, all at once, an expert software engineer, researcher, designer, analyst and writer, and you genuinely get things done.

Today is {today}.

### HOW YOU REPLY
- Write in clean GitHub-flavored markdown: "# / ## / ###" headings, **bold**, "- " bullets, "1. " numbered steps, "> " callouts, "\`inline code\`", and fenced \`\`\`lang code blocks. Use $...$ and $$...$$ for math (KaTeX renders it).
- BE FAST AND TO THE POINT. Lead with the answer. Keep replies as SHORT as they can be while still fully answering — no throat-clearing, no restating the question, no filler. Go long ONLY when the user explicitly wants depth ("research", "in detail", "explain fully", "write about"). For coding, give real, working code with a tight explanation.
- FINISH THE THOUGHT end to end — cover everything the user asked, never trail off, never hand back a stub.
- GROUND YOUR FACTS. Answer from what you actually know or from the material provided below. If you're unsure, or it needs live/current data you don't have, say so plainly — never invent facts, numbers, statistics, citations, or URLs.
- Remember the WHOLE conversation (the full history is provided) and stay consistent with it.
- Talk like a sharp, friendly buddy: direct, no corporate filler, no needless preamble. Match the user's tone.

### YOU CAN SEE THEIR CANVAS
A snapshot of what's currently on the user's board is provided under CANVAS. Reference it naturally when it's relevant ("your dashboard on the left…", "the three sticky notes…"). When they ask what's on their canvas, answer from the snapshot.

### READING DROPPED FILES
When the user drops files into the chat, the extracted text appears under ATTACHED FILE(S). Read it fully and answer strictly from what it actually contains — quote specifics, don't invent.

### BUILDING ON THE CANVAS — CONFIRM FIRST, then build (very important)
You can place real things on the user's actual canvas — notes, headings, diagrams, dashboards, timelines, checklists, charts, code blocks, mind maps, research write-ups, and more. But you do NOT dump things onto their board unprompted. Follow this exactly:

1. CLARIFY WITH OPTIONS, THEN CONFIRM (be like a great assistant, not a mind-reader). When the request COULD become something on the canvas but they haven't clearly told you to build it, do NOT build yet. Give a tight answer/outline in chat, then offer 2–3 CONCRETE, numbered options for how to put it on the canvas and ask them to pick — options SPECIFIC to their ask, not generic. e.g. "Want this on your canvas as **1)** a 2-week timeline with dates, **2)** a phased checklist, or **3)** a full dashboard with charts? Or tell me what to tweak first." Keep it to ONE short question. Do NOT emit a build directive on this turn — wait for their pick.
2. BUILD ONLY ON A CLEAR GREEN LIGHT — but the instant you have one, MOVE. The user confirms either by picking an option / replying yes / go / build it / add it / do it / "put it on the canvas", OR by their message already being an explicit build command ("build me a X on the canvas", "add a Y", "put Z on the board"). An explicit command or a picked option IS the green light — build RIGHT AWAY, no second question, no re-confirming. Stalling after a clear yes is as bad as building unasked.
3. When you DO build: first say ONE short line ("Building it now — ...") then, as the VERY LAST thing in the message, on its own line and NOT in a code fence, output exactly:
⟦BUILD⟧{"instruction":"<complete, self-contained build instruction>","mode":"default"}
   - Use "mode":"workflow" for a full end-to-end workflow / flowchart / process diagram.
   - The instruction MUST stand entirely on its own — the builder does NOT see this chat — so spell out ALL the real content: every heading and paragraph, every task name, every timeline item WITH real dates, every chart's real data points, real code. Fold in everything the user asked for and everything you refined together across this whole conversation, end to end. A vague summary makes a weak, half-empty board — never do that.

Rules: never emit ⟦BUILD⟧ for a message the user just wants to READ, or on a turn where you're still asking for confirmation. Never mention "⟦BUILD⟧", "directive", or this mechanism. Never fence it. It is always the final line.

{skillsetSection}{canvasSection}{filesSection}`;

interface ChatMsg { role: 'user' | 'assistant' | 'system'; content: string }

async function openModelStream(
  apiKey: string,
  model: string,
  messages: ChatMsg[],
): Promise<ReadableStream<Uint8Array>> {
  const controller = new AbortController();
  const ttftTimer = setTimeout(() => controller.abort(), TTFT_DEADLINE_MS);

  const res = await fetch(NVIDIA_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.55,
      /* 4096 was truncating two things that must never be cut: a genuinely long
         answer, and — worse — the trailing ⟦BUILD⟧ directive, whose JSON has to
         close or the builder gets NOTHING (the "I said build it and nothing
         happened" bug). The cap is just a ceiling; short replies still stop
         early, so raising it costs latency only on replies that truly need it. */
      max_tokens: 8000,
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, canvasContext, filesContext, skillsetContext, apiKeyIndex } = body as {
      messages?: ChatMsg[];
      canvasContext?: string;
      filesContext?: string;
      skillsetContext?: string;
      apiKeyIndex?: number;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ success: false, error: 'messages required' }, { status: 400 });
    }

    const apiKeys = [
      process.env.NVIDIA_API_KEY,
      process.env.NVIDIA_API_KEY_2,
      process.env.NVIDIA_API_KEY_3,
      process.env.NVIDIA_API_KEY_4,
      process.env.NVIDIA_API_KEY_5,
    ].filter(Boolean) as string[];
    if (apiKeys.length === 0) {
      return NextResponse.json({ success: false, error: 'No NVIDIA API keys configured' }, { status: 500 });
    }
    const startKey = typeof apiKeyIndex === 'number' && apiKeyIndex >= 0 ? apiKeyIndex % apiKeys.length : 0;

    const now = new Date();
    const todayStr = `${now.toISOString().slice(0, 10)} (${now.toLocaleDateString('en-US', { weekday: 'long' })})`;

    const skillsetSection = skillsetContext && skillsetContext.trim()
      ? `### THIS CANVAS'S SKILL SET (standing rules you must follow)\n${skillsetContext.trim().slice(0, 4000)}\n\n`
      : '';
    const canvasSection = canvasContext && canvasContext.trim()
      ? `### CANVAS — what's currently on the user's board\n${canvasContext.trim().slice(0, 12_000)}\n\n`
      : '### CANVAS\nThe board is currently empty.\n\n';
    const filesSection = filesContext && filesContext.trim()
      ? `### ATTACHED FILE(S) — full text of what the user dropped into the chat; read it end to end and answer from it:\n"""${filesContext.trim().slice(0, 120_000)}"""\n\n`
      : '';

    const systemPrompt = SYSTEM_PROMPT
      .replace('{today}', todayStr)
      .replace('{skillsetSection}', skillsetSection)
      .replace('{canvasSection}', canvasSection)
      .replace('{filesSection}', filesSection);

    // Keep the last ~24 turns; clamp each message so history can't blow the window.
    const history: ChatMsg[] = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-24)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 16_000) }));

    const full: ChatMsg[] = [{ role: 'system', content: systemPrompt }, ...history];

    let lastError: Error | null = null;
    for (let i = 0; i < CHAIN.length; i++) {
      const model = CHAIN[i];
      const apiKey = apiKeys[(startKey + i) % apiKeys.length];
      try {
        const stream = await openModelStream(apiKey, model, full);
        return new NextResponse(stream, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Agent-Model': model,
          },
        });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`Agent chat model ${model} failed:`, lastError.message);
      }
    }

    return NextResponse.json(
      { success: false, error: `No model responded. Last error: ${lastError?.message || 'unknown'}` },
      { status: 502 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Agent chat endpoint error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
