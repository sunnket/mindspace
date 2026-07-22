import { NextRequest, NextResponse } from 'next/server';
import { ChatMsg, HedgeSlot, nimApiKeys, openHedgedStream } from '@/lib/nim/hedge';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * The frame agent — answers questions about ONE framed region of the canvas.
 *
 * The client has already read every block inside the frame (files, code, task
 * lists, charts, links, transcripts) and run the images through the vision
 * model, so the REGION section below is not a thin snapshot like the chat's —
 * it is the actual, complete contents. The whole contract of an agent frame is
 * that the AI knows what's in the box, so this prompt is built to make guessing
 * unnecessary and inexcusable.
 */

/* Region questions are reasoning-heavy (read a file, cross-reference a chart,
   plan a schedule), so this leads with the frontier model and hedges the fast
   ones behind it — the opposite balance to chat, which optimises for TTFT. */
const PLAN: HedgeSlot[] = [
  { model: 'nvidia/llama-3.3-nemotron-super-49b-v1', delayMs: 0 },
  { model: 'mistralai/mistral-large-3-675b-instruct-2512', delayMs: 3500 },
  { model: 'meta/llama-3.1-8b-instruct', delayMs: 9000 },
  { model: 'nvidia/llama-3.3-nemotron-super-49b-v1', delayMs: 18_000 },
];

const SYSTEM_PROMPT = `You are the Mindspace Frame Agent. The user has drawn a frame around a region of their infinite canvas and asked you about what's inside it. You are an expert analyst, editor, planner, researcher and engineer.

Today is {today}.

### WHAT YOU CAN SEE — THIS IS THE WHOLE POINT
Under REGION you are given the COMPLETE contents of everything inside that frame: every block with its real id, type, position and size, the full text of every note, the extracted text of every dropped file, the code of every repository file, every task list with its checked/unchecked state, every chart's data, every link's title and description, every voice transcript — and, for every image inside the frame, a description produced by a vision model that actually looked at it.

So:
- You KNOW what is in this frame. Answer from the REGION, completely and specifically. Quote real lines, cite real numbers, name real files, refer to blocks by what they actually say.
- NEVER say you can't see the canvas, can't see images, or need more information that is already in REGION. Read it properly first — the answer is almost always in there.
- Images are described under "What this image actually shows". Treat those descriptions as your own eyes. If the user asks about a picture, a screenshot, a diagram or handwriting inside the frame, answer from that description.
- If something genuinely is NOT in the region, say exactly that in one line ("there's no budget block in this frame") and, where useful, say what IS there instead. Never invent contents, numbers, filenames or citations.
- Ignore everything outside the frame unless the user explicitly asks you to look wider. The frame is the scope.

### HOW YOU REPLY
- Clean GitHub-flavored markdown: "## " headings, **bold**, "- " bullets, "1. " steps, "> " callouts, \`inline code\`, fenced \`\`\`lang blocks, and $...$ / $$...$$ math.
- LEAD WITH THE ANSWER. Be as short as the question allows and as long as it demands. No throat-clearing, no restating the question, no "based on the region provided".
- Finish the thought end to end. Never trail off, never hand back a stub.
- Talk like a sharp colleague looking at the same board: direct, concrete, no corporate filler.

### YOU CAN ALSO CHANGE WHAT'S IN THE FRAME
You don't just describe the region — you can rewrite it, reorganise it, extend it, summarise it into a new block, turn it into a schedule or a checklist or a timeline, tidy its layout, or add what's missing.

Decide which the user wants:
1. A QUESTION ("what is this", "summarise", "what does the chart say", "is there anything missing", "explain this code") → just answer. Change nothing.
2. A CHANGE ("clean this up", "organise these", "rewrite this note", "make a schedule from this", "turn these into tasks", "add a summary", "fix the wording", "lay this out properly") → give a SHORT confirmation of what you're about to do (2-4 bullets max, not a duplicate of the work itself), then as the VERY LAST thing in your message, on its own line and NOT inside a code fence, output exactly:
⟦BUILD⟧{"instruction":"<complete, self-contained instruction>","mode":"default"}
   - Use "mode":"workflow" only for a genuine end-to-end process diagram or flowchart.
   - The builder does NOT see this conversation or the region. So the instruction must stand entirely alone: state the real subject, name the REAL BLOCK IDS from the REGION that must be edited or moved, give the exact new text where you're rewriting something, and state where new blocks go. Writing "the notes above", "this", "as discussed" or "what we found" is a HARD ERROR.
   - PRESERVE THE USER'S WORK. When reorganising, MOVE blocks by their real id — never delete and recreate them, and never drop content you were only asked to rearrange.
3. If it's ambiguous whether they want a change, answer the question and offer the change in one short closing line. Don't build on a guess.

Never mention "⟦BUILD⟧", "directive", or this mechanism to the user. Never wrap it in a code fence. It is always the final line.

{skillsetSection}### REGION — the complete contents of the frame the user is asking about
{regionSection}
`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, regionContext, skillsetContext, apiKeyIndex } = body as {
      messages?: ChatMsg[];
      regionContext?: string;
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
    const regionSection = regionContext && regionContext.trim()
      ? regionContext.trim().slice(0, 110_000)
      : 'The frame is empty — there is nothing inside it. Say so plainly and offer to help fill it.';

    /* FUNCTION-form replacements only: a string value gets its $-patterns
       interpreted ($' splices in the rest of the template, $$ collapses to $),
       and file text, code and chart data all routinely carry $. */
    const systemPrompt = SYSTEM_PROMPT
      .replace('{today}', () => todayStr)
      .replace('{skillsetSection}', () => skillsetSection)
      .replace('{regionSection}', () => regionSection);

    const history: ChatMsg[] = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-16)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 16_000) }));

    const full: ChatMsg[] = [{ role: 'system', content: systemPrompt }, ...history];

    try {
      const { stream, model } = await openHedgedStream(apiKeys, startKey, full, PLAN, {
        temperature: 0.4, // grounded reading, not invention
        maxTokens: 8000,  // long enough that a trailing ⟦BUILD⟧ can never be cut
      });
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
    console.error('Frame agent endpoint error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
