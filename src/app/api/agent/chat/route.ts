import { NextRequest, NextResponse } from 'next/server';
import { ChatMsg, HedgeSlot, nimApiKeys, openHedgedStream } from '@/lib/nim/hedge';

export const runtime = 'nodejs';
export const maxDuration = 300;

/* Launch PLAN by MEASURED speed. Chat must feel INSTANT, so it leads with
   nemotron-super-49b (~1s TTFT when warm, fluent, smart — and with no "detailed
   thinking on" directive it answers directly, no reasoning trace). But on this
   free tier any single key can be cold (probed 2026-07-24: a bare-8B lead
   stalled 15-21s), so a SECOND nemotron fires on a different key at 1.1s to
   rescue an unlucky-cold lead before the user feels it — then the fast 8B, the
   frontier for depth, and a far-out 8B backstop. First token anywhere wins;
   losers abort instantly. mistral-medium (old lead) is OUT — it timed out
   45-60s on this tier. */
const PLAN: HedgeSlot[] = [
  { model: 'nvidia/llama-3.3-nemotron-super-49b-v1', delayMs: 0 },
  { model: 'nvidia/llama-3.3-nemotron-super-49b-v1', delayMs: 1100 },  // 2nd nemotron, different key — the fast rescue
  { model: 'meta/llama-3.1-8b-instruct', delayMs: 2600 },
  { model: 'mistralai/mistral-large-3-675b-instruct-2512', delayMs: 6000 },
  { model: 'meta/llama-3.1-8b-instruct', delayMs: 14_000 },
];

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

### BUILDING ON THE CANVAS — build INSTANTLY when told to, never build unprompted (very important)
You can place real things on the user's actual canvas — notes, headings, diagrams, dashboards, timelines, checklists, charts, code blocks, mind maps, research write-ups, and more. Read the user's intent and pick exactly ONE of these three — getting this split right is the whole game:

1. BUILD IT NOW — the message TELLS YOU to create or change something on the canvas: "build me a X", "add a Y", "make a launch plan", "put this on the board", "turn these notes into a schedule", "organise these", or even a bare deliverable like "a dashboard for my startup". An instruction is a green light — DO IT in the SAME turn. Interpret a terse or rough ask generously and choose sensible defaults YOURSELF; the user tweaks after. Do NOT re-ask what they just told you, do NOT restate their request back as a question, and do NOT offer a numbered menu of options. Re-asking for something the user already stated is the #1 thing that makes you feel dumb and slow — never do it.
2. JUST ANSWER (no build) — the message is a QUESTION or wants to understand something: "what is X", "how does Y work", "difference between A and B", "explain…", "should I…". Answer it well IN THE CHAT and put NOTHING on the canvas — an unrequested board is spam, and auto-building a chart/table/dashboard just because your answer mentioned one is exactly that. You MAY end with ONE short offer ("Want this as a comparison table on your canvas?"), but do NOT emit a build on this turn — wait for their yes.
3. ASK — only if the request is too vague for any sensible build ("make me something", "help with my project" and nothing else). ONE short question. This is rare.

When you DO build (case 1, or after a yes in case 2): keep the CHAT reply SHORT — a single lead line ("Building it now — <one phrase naming what>") and at most a tight few-bullet outline. NEVER type the full essay / report / plan into the chat and then build the same thing — that duplicate wall of text is exactly what the user hates; the full content belongs ON THE CANVAS, not typed out twice. Then, as the VERY LAST thing in the message, on its own line and NOT in a code fence, output exactly:
⟦BUILD⟧{"instruction":"<complete, self-contained build instruction>","mode":"default"}
   - Use "mode":"workflow" for a full end-to-end workflow / flowchart / process diagram.
   - The instruction MUST NAME THE REAL SUBJECT explicitly and stand entirely on its own — the builder does NOT see this chat, so it is a HARD ERROR to write "the report above", "this", "what we discussed", "as outlined". State the exact topic, the angle/scope, the sections to include, and any concrete data / dates / names / numbers from the conversation. Example of WRONG: "a detailed report with sources and charts". Example of RIGHT: "Build a detailed board titled 'Indian Media & the Government (2014–2024)' with sections Executive Summary, Pro-Govt vs Independent outlets, Regulatory pressure, Public trust — include a bar chart of primetime airtime share and cite the outlets by name." Your visible answer is ALSO handed to the builder as source material, so you needn't re-type every paragraph inside the instruction — but the instruction ALONE must still make the subject unmistakable.

Rules: never emit ⟦BUILD⟧ for a message the user just wants to READ, or on a turn where you're still asking for confirmation. Never mention "⟦BUILD⟧", "directive", or this mechanism. Never fence it. It is always the final line.

{skillsetSection}{canvasSection}{filesSection}`;

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

    const apiKeys = nimApiKeys();
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

    /* FUNCTION-form replacements only: a string value gets its $-patterns
       interpreted ($' splices in the rest of the template, $$ collapses to $),
       and skill-set rules / canvas snapshots / file text can all carry $. This
       corrupted or ballooned the prompt and stalled the chat. */
    const systemPrompt = SYSTEM_PROMPT
      .replace('{today}', () => todayStr)
      .replace('{skillsetSection}', () => skillsetSection)
      .replace('{canvasSection}', () => canvasSection)
      .replace('{filesSection}', () => filesSection);

    // Keep the last ~24 turns; clamp each message so history can't blow the window.
    const history: ChatMsg[] = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-24)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 16_000) }));

    const full: ChatMsg[] = [{ role: 'system', content: systemPrompt }, ...history];

    // Race the chain (hedged): first model to produce a token streams back.
    try {
      /* max_tokens 8000, not the default 4096: that was truncating two things
         that must never be cut — a genuinely long answer, and, worse, the
         trailing ⟦BUILD⟧ directive, whose JSON has to close or the builder gets
         NOTHING (the "I said build it and nothing happened" bug). */
      const { stream, model } = await openHedgedStream(apiKeys, startKey, full, PLAN, { maxTokens: 8000 });
      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Agent-Model': model,
        },
      });
    } catch (err) {
      const lastError = err instanceof Error ? err : new Error(String(err));
      return NextResponse.json(
        { success: false, error: `No model responded. Last error: ${lastError.message}` },
        { status: 502 },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Agent chat endpoint error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
