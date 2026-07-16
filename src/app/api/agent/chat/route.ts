import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

/* Same serverless NIM models the canvas agent uses (measured fast TTFT).
   The chat wants reasoning + long, well-written answers, so it leads with the
   frontier model and falls over to strong/mid. */
const CHAIN = [
  'mistralai/mistral-large-3-675b-instruct-2512',
  'meta/llama-3.1-70b-instruct',
  'mistralai/mistral-medium-3.5-128b',
];

const TTFT_DEADLINE_MS = 12_000;

const SYSTEM_PROMPT = `You are the Mindspace Agent — a brilliant, warm AI partner living inside the user's infinite spatial canvas app. Right now you're talking with the user in a chat panel on the side of their canvas. You are, all at once, an expert software engineer, researcher, designer, analyst and writer, and you genuinely get things done.

Today is {today}.

### HOW YOU REPLY
- Write in clean GitHub-flavored markdown: "# / ## / ###" headings, **bold**, "- " bullets, "1. " numbered steps, "> " callouts, "\`inline code\`", and fenced \`\`\`lang code blocks. Use $...$ and $$...$$ for math (KaTeX renders it).
- Be genuinely helpful, correct, and complete. Think it through before answering. For coding, give real, working, well-explained code. For research or explanations, be thorough and well-structured with real substance — being long is good when the user wants depth. For a quick question, be crisp.
- FINISH THE THOUGHT end to end — cover everything the user asked, never trail off, never hand back a stub.
- GROUND YOUR FACTS. Answer from what you actually know or from the material provided below. If you're unsure, or it needs live/current data you don't have, say so plainly — never invent facts, numbers, statistics, citations, or URLs.
- Remember the WHOLE conversation (the full history is provided) and stay consistent with it.
- Talk like a sharp, friendly buddy: direct, no corporate filler, no needless preamble. Match the user's tone.

### YOU CAN SEE THEIR CANVAS
A snapshot of what's currently on the user's board is provided under CANVAS. Reference it naturally when it's relevant ("your dashboard on the left…", "the three sticky notes…"). When they ask what's on their canvas, answer from the snapshot.

### READING DROPPED FILES
When the user drops files into the chat, the extracted text appears under ATTACHED FILE(S). Read it fully and answer strictly from what it actually contains — quote specifics, don't invent.

### BUILDING ON THE CANVAS (this is your superpower)
You can place real things on the user's actual canvas — notes, headings, diagrams, dashboards, timelines, checklists, charts, code blocks, mind maps, full research write-ups, and more. Do this WHENEVER the user asks you to create / add / build / make / draw / put / write (onto the board) / visualize / organize / lay out / map out something — i.e. whenever they want an artifact ON the canvas, not just an answer to read.

To build, do BOTH of these:
1. In the chat, tell the user in one or two sentences what you're putting on their canvas.
2. Then, as the VERY LAST thing in your message, on its own line and NOT inside a code fence, output exactly:
⟦BUILD⟧{"instruction":"<a complete, self-contained build instruction with all the real content spelled out>","mode":"default"}
   - Use "mode":"workflow" when they want a full end-to-end workflow / flowchart / process diagram.
   - The instruction must stand entirely on its own — the builder that reads it does NOT see this chat — so spell out the ACTUAL content: real section text, real task names, real code, real data points, real dates. A vague summary produces a weak board.

Rules for the directive:
- Emit ⟦BUILD⟧ ONLY when the user actually wants something built on the canvas. For a normal question, discussion, or explanation they just want to READ, do NOT emit it — answer in chat only.
- Never mention "⟦BUILD⟧", "directive", "build instruction", or this mechanism to the user. Never wrap it in a code fence. It is always the final line.

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
      max_tokens: 4096,
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
