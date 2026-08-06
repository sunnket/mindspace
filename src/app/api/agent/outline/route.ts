import { NextRequest, NextResponse } from 'next/server';
import { ChatMsg, nimApiKeys, nimComplete, raceForResult } from '@/lib/nim/hedge';
import { MODELS } from '@/lib/nim/models';
import { fitToBudget, FAST_INPUT_CHARS } from '@/lib/nim/budget';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * THE OUTLINE PASS — the first half of parallel board building.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * A single model writing a single plan is THROUGHPUT-BOUND. The fastest builder
 * on this tier streams ~200 chars/second, so a genuinely detailed board — say
 * 12,000 characters of real writing — takes a minute of pure generation no
 * matter how clever the prompt is. Faced with that, the model does the only
 * thing it can: it writes less. Measured on "give me a detailed report on
 * carbon emissions end to end": 11 blocks holding 2,032 characters TOTAL. The
 * structure was right and the content was a skeleton, which is exactly the
 * "why is this so thin, I asked for detailed" complaint. Telling it to write
 * more just makes it run longer and risk truncation.
 *
 * The way out is not a better prompt, it is CONCURRENCY. This endpoint splits
 * the request into independent sections; the client then builds every section
 * AT THE SAME TIME on a different API key. Five sections writing 1,500
 * characters each is 7,500 characters of real depth in roughly the wall time
 * one model needs for 1,500 — and each writer has the whole request in front
 * of it for one narrow job, so it goes deep instead of summarising.
 *
 * It also fixes a correctness bug that prompting never solved: parts of a
 * multi-part request being silently dropped ("...and also the ways to stop
 * them" coming back with no mitigation anywhere). Decomposition is now an
 * explicit, checkable step — every clause the user named becomes a section, and
 * a section that exists WILL be written, because it has its own request.
 *
 * Deliberately small and strictly bounded: a few hundred output tokens, the
 * fast builder model, and the client abandons it after a few seconds and falls
 * back to the ordinary single-pass build. This must never become the
 * multi-minute "understanding your intent" stall that the old two-phase
 * Director was killed for.
 */

const SYSTEM_PROMPT = `You are the planning half of a canvas board builder. You do NOT write the board — you split the user's request into sections that will then be written IN PARALLEL by separate writers.

Today is {today}.

### YOUR ONE JOB: LOSE NOTHING, OVERLAP NOTHING
- Read the user's request and list EVERY distinct part of it. If they said "a report on X and also ways to stop them", that is AT LEAST two sections — one for X, one for the ways. A part of the request that gets no section will never be written at all, and that is the worst thing you can do here.
- If REFERENCE MATERIAL is supplied, the sections must cover THAT material end to end — walk through it and give every major theme its own section. Do not invent a different topic.
- Sections must not overlap. Each writer works alone and cannot see the others, so two sections covering the same ground produce a duplicated board.
- Order them the way a reader should meet them.

### NO FILLER SECTIONS
Every section must carry real subject matter. NEVER emit "Introduction", "Overview" (as a whole section), "Conclusion", "Summary", "Appendix", "Glossary", "References", "Next Steps" or "Further Reading" — those are document furniture, not content, and on a canvas they produce empty-looking columns. A board of five substantive sections beats seven where two are packaging. If the material has an important framing idea, fold it into the first REAL section instead of giving it a section of its own.

### HOW MANY
Between 3 and 5. Prefer 4. Each section becomes a tall, dense column of writing, so five substantial ones already make a large board — merge closely-related ideas rather than splitting them thin.

### EACH SECTION
- "title": the heading the reader will see. Short and concrete.
- "brief": ONE dense paragraph telling that writer exactly what to cover — the specific sub-topics, the angle, the facts or figures from the reference material that belong there, and anything the user explicitly asked for that lands in this section. Be specific enough that the writer never has to guess. This is the only instruction that writer gets.
- "widgets": the block types this section should use, from: "text", "sticky", "chart", "timeline", "todo", "code", "table", "map", "image", "quote", "metric", "progress", "mermaid", "workflow". Pick what genuinely fits the content. If the USER named a widget ("use sticky notes", "add a workflow", "with a chart"), put it in the sections where it belongs — their instruction is not optional.

### OUTPUT — THIS IS A STRICT FORMAT, NOT A SUGGESTION
Reply with ONE compact line of JSON and NOTHING else. No markdown, no headings, no numbered list, no "### SECTIONS", no code fence, no explanation before or after. Your very first character must be "{".
{"boardTitle":"A short title for the whole board","sections":[{"title":"...","brief":"...","widgets":["text","chart"]}]}`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, context, filesContext, webContext, searchContext, wikiContext, skillsetContext, apiKeyIndex } = body as Record<string, unknown>;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
    }

    const apiKeys = nimApiKeys();
    if (apiKeys.length === 0) {
      return NextResponse.json({ success: false, error: 'No NVIDIA API keys configured' }, { status: 500 });
    }
    const startKey = typeof apiKeyIndex === 'number' && apiKeyIndex >= 0 ? apiKeyIndex % apiKeys.length : 0;

    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    /* The planner only needs enough of the material to see its SHAPE, not all
       of it — the writers get the full text. Keeping this small is what keeps
       the pass fast enough to be worth doing. */
    const fitted = fitToBudget([
      { key: 'context', text: str(context), priority: 1, max: 14_000, min: 500 },
      { key: 'files', text: str(filesContext), priority: 2, max: 12_000, min: 500 },
      { key: 'web', text: str(webContext), priority: 3, max: 8000, min: 500 },
      { key: 'search', text: str(searchContext), priority: 4, max: 3000, min: 300 },
      { key: 'wiki', text: str(wikiContext), priority: 5, max: 3000, min: 300 },
    ], Math.min(FAST_INPUT_CHARS, 34_000));

    const parts: string[] = [];
    if (fitted.sections.context) parts.push(`### REFERENCE MATERIAL — the sections must cover THIS, end to end:\n"""${fitted.sections.context}"""`);
    if (fitted.sections.files) parts.push(`### ATTACHED FILE(S):\n"""${fitted.sections.files}"""`);
    if (fitted.sections.web) parts.push(`### CRAWLED WEB PAGE(S):\n"""${fitted.sections.web}"""`);
    if (fitted.sections.search) parts.push(`### WEB SEARCH RESULTS:\n"""${fitted.sections.search}"""`);
    if (fitted.sections.wiki) parts.push(`### WIKIPEDIA:\n"""${fitted.sections.wiki}"""`);
    if (str(skillsetContext)) parts.push(`### THIS CANVAS'S STANDING RULES\n${str(skillsetContext).slice(0, 2000)}`);

    const now = new Date();
    const todayStr = `${now.toISOString().slice(0, 10)} (${now.toLocaleDateString('en-US', { weekday: 'long' })})`;
    const systemPrompt = SYSTEM_PROMPT.replace('{today}', () => todayStr);

    const messages: ChatMsg[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${parts.length ? parts.join('\n\n') + '\n\n' : ''}### THE REQUEST\n${prompt.trim().slice(0, 6000)}` },
    ];

    /* LED BY THE 8B, and that is not a compromise — it is the right tool.
       Measured on this exact prompt:
         meta/llama-3.1-8b-instruct   3.4s   (ttft 0.45s, 3043 chars, no reasoning)
         nvidia/nemotron-super-49b   17.0s
         openai/gpt-oss-20b          19-32s  (ttft 11.4s — it emits 1.2-2.4k chars
                                              of REASONING before a single output
                                              token, which is dead time here)
         nvidia/nemotron-nano-9b     27.3s   (and ran out of budget mid-answer)
         mistralai/mistral-nemotron  timed out at 90s
       The 8B is unreliable at long action plans (it corrupts nested JSON — see
       lib/nim/models.ts) but an outline is short, shallow and structured, which
       is exactly what it is good at. Leading with anything else would spend more
       time PLANNING the board than the writers spend building it, and this pass
       sits on the critical path before a single block appears. */
    /* Read one candidate answer into sections, in three escalating ways.
       Returns null when nothing usable is in there, which is the signal for the
       race below to keep waiting on a sibling. */
    const readOutline = (raw: string): { boardTitle: string; sections: { title: string; brief: string; widgets: string[] }[] } | null => {
    const cleaned = raw.trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '');
    let parsed: { boardTitle?: string; sections?: { title?: string; brief?: string; widgets?: string[] }[] } | null = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch { /* fall back to the tolerant scan below */ }

    if (!parsed?.sections?.length) {
      /* Whole-document parsing is the wrong tool here for the same reason it is
         wrong for action plans: the answer can be CUT OFF at the token ceiling
         (observed live — 4,709 characters of perfectly good sections ending
         mid-object, and a strict parse threw away all of them). Walk the
         sections array object by object and keep every one that closed. */
      const key = cleaned.indexOf('"sections"');
      const open = key === -1 ? cleaned.indexOf('[') : cleaned.indexOf('[', key);
      const found: { title?: string; brief?: string; widgets?: string[] }[] = [];
      if (open !== -1) {
        let depth = 0, inStr = false, esc = false, objStart = -1;
        for (let i = open + 1; i < cleaned.length; i++) {
          const c = cleaned[i];
          if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
          }
          if (c === '"') { inStr = true; continue; }
          if (c === '{') { if (depth === 0) objStart = i; depth++; }
          else if (c === '}') {
            depth--;
            if (depth === 0 && objStart >= 0) {
              try { found.push(JSON.parse(cleaned.slice(objStart, i + 1))); } catch { /* skip */ }
              objStart = -1;
            }
          } else if (c === ']' && depth === 0) break;
        }
      }
      const titleMatch = cleaned.match(/"boardTitle"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      parsed = { boardTitle: titleMatch ? titleMatch[1] : parsed?.boardTitle, sections: found };
    }

    if (!parsed?.sections?.length) {
      /* LAST RESORT: the plan came back as MARKDOWN, not JSON. Observed live —
         the planner answered "### SECTIONS\n1. **Sources and Scale**\n   - …"
         and a JSON-only reader threw away a perfectly good outline, failing the
         whole parallel build over formatting. The titles and briefs are right
         there; take them. */
      const lines = cleaned.split('\n');
      const md: { title: string; brief: string }[] = [];
      const headerRe = /^\s*(?:#{2,4}\s+|(?:\d+[.)]\s*)|[-*]\s+)\**\s*([^*\n:]{3,90?})\**\s*:?\s*$/;
      for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        const h = line.match(headerRe);
        const isNoise = h && /^(sections?|output|outline|board ?title|json|widgets?|brief)$/i.test(h[1].trim());
        if (h && !isNoise) {
          md.push({ title: h[1].trim(), brief: '' });
        } else if (md.length && line.trim()) {
          const t = line.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').trim();
          if (t) md[md.length - 1].brief += (md[md.length - 1].brief ? ' ' : '') + t;
        }
      }
      const usable = md.filter((s) => s.title && s.brief.length > 25);
      if (usable.length >= 3) {
        console.debug(`[Agent] outline arrived as markdown — recovered ${usable.length} sections`);
        parsed = { boardTitle: parsed?.boardTitle || '', sections: usable.map((s) => ({ ...s, widgets: [] })) };
      }
    }

    /* Hard cap at 5. Every section is a live request, and fanning out to seven
       measurably degraded the whole board on a busy tier — empty columns, 502s
       and one 340-second straggler. Five parallel writers already give ~5x the
       content of a single pass; more just buys tail latency. */
    const sections = (parsed?.sections || [])
      .filter((s) => s && typeof s.title === 'string' && s.title.trim())
      .slice(0, 5)
      .map((s) => ({
        title: String(s.title).trim().slice(0, 120),
        brief: String(s.brief || '').trim().slice(0, 1400),
        widgets: Array.isArray(s.widgets) ? s.widgets.filter((w) => typeof w === 'string').slice(0, 6) : [],
      }));

      if (sections.length < 3) return null;
      return { boardTitle: String(parsed?.boardTitle || '').trim().slice(0, 120), sections };
    };

    /* RACE FOR A USABLE ANSWER, not for a first token.
       The planner is a small non-streaming job, and the failure that actually
       bites is not slowness — it is the 8B replying in MARKDOWN instead of JSON
       (measured: 2 of 4 runs, each one killing the whole parallel build). A
       first-token race commits to whoever spoke first and then discovers the
       format is wrong with no way back. Firing three cheap attempts at once and
       taking the first that PARSES costs two extra small requests and turns a
       coin flip into a near-certainty. The 8B leads on two keys because when it
       does comply it is 5x faster than anything else here; nemotron backs it up
       because it is the most format-obedient of the three. */
    const attempt = (model: string, keyOffset: number, temperature: number) => async () => {
      const text = await nimComplete(
        apiKeys[(startKey + keyOffset) % apiKeys.length], model, messages,
        { maxTokens: 2600, temperature, timeoutMs: 40_000 },
      );
      return text;
    };

    const outline = await raceForResult(
      [
        attempt(MODELS.fast, 0, 0.3),
        attempt(MODELS.fast, 1, 0.45),   // a different key AND a different sample
        attempt(MODELS.prose, 2, 0.35),  // ~17s but the most format-obedient
      ],
      readOutline,
    );

    if (!outline) {
      console.debug('[Agent] outline: no attempt produced a usable plan');
      return NextResponse.json({ success: false, error: 'outline unusable' }, { status: 422 });
    }
    console.debug(`[Agent] outline: ${outline.sections.length} sections — ${outline.sections.map((s) => s.title).join(' | ')}`);

    return NextResponse.json({
      success: true,
      boardTitle: outline.boardTitle,
      sections: outline.sections,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Agent outline endpoint error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
