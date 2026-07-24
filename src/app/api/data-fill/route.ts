import { NextRequest, NextResponse } from 'next/server';
import { ChatMsg, HedgeSlot, nimApiKeys, openHedgedStream } from '@/lib/nim/hedge';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * AI fill — the ✨ in every data block's toolbar.
 *
 * The block sends what it already has (its columns, whatever rows are filled
 * in, and what kind of thing it is) and gets back rows to ADD or blanks to
 * COMPLETE. Deliberately small and non-streaming: the caller wants one JSON
 * payload it can drop straight into the grid, not a conversation.
 *
 * Latency plan mirrors chat's — lead with the fast, fluent model and rescue a
 * cold key at 1.2s — because this sits behind a button the user is watching.
 */
const PLAN: HedgeSlot[] = [
  { model: 'nvidia/llama-3.3-nemotron-super-49b-v1', delayMs: 0 },
  { model: 'nvidia/llama-3.3-nemotron-super-49b-v1', delayMs: 1200 },
  { model: 'meta/llama-3.1-8b-instruct', delayMs: 3000 },
  { model: 'mistralai/mistral-large-3-675b-instruct-2512', delayMs: 8000 },
];

const SYSTEM = `You fill in structured data for a visual canvas app. You return JSON and nothing else.

RULES
- Reply with ONE JSON object. No prose, no markdown, no code fences, no explanation before or after.
- Shape: {"rows": [ {"<columnId>": "<value>", ...}, ... ]}
- Use EXACTLY the column ids you are given. Never invent a column, never rename one, never drop one.
- Every value is a STRING.
- For a column with an "options" list you MUST pick one of those exact labels, spelled exactly as given.
- For number columns return a bare number as a string, like "5". No units, no symbols.
- For date columns use YYYY-MM-DD.
- For person columns invent plausible full names ("Priya Raman"), and REUSE the same few names across rows so the board looks like a real team.
- Make the content specific and realistic to the subject — real task names, real categories. Never output filler like "Task 1", "Item A", "Lorem ipsum", "TBD", "N/A" or "Example".
- Match the tone and domain of any rows that are already filled in. If the existing rows are about a product launch, yours are too.

MODES
- "complete": you are given rows that have some blank cells. Return the SAME NUMBER of rows in the SAME ORDER, each object containing ONLY the cells that were blank and that you filled. Never change a value the user already wrote.
- "extend": invent brand-new rows that continue the set. Return exactly the number of rows asked for, fully populated.`;

interface FillBody {
  mode?: 'complete' | 'extend';
  /** What this block is about — its title, plus the block kind. */
  subject?: string;
  columns?: { id: string; name: string; kind: string; options?: string[] }[];
  /** Existing rows, as { columnId: value }. */
  rows?: Record<string, string>[];
  count?: number;
}

/** The first balanced JSON value starting at `open` in `s`, or null. */
function balanced(s: string, open: number, closer: string): unknown | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        if (ch !== closer) return null;
        try { return JSON.parse(s.slice(open, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/**
 * Get rows out of whatever the model actually said.
 *
 * Instruction-following on a free tier is not a guarantee, so this accepts
 * every near-miss that still carries the data rather than failing the user's
 * click: the clean object, a bare array of rows, a fenced block, a fenced
 * block with prose either side, and `{"data": …}` / `{"result": …}` instead of
 * `{"rows": …}`. Only genuinely unusable output falls through.
 */
function extractRows(text: string): Record<string, unknown>[] | null {
  const cleaned = text.replace(/```(?:json|JSON)?/g, '').trim();

  const fromValue = (v: unknown): Record<string, unknown>[] | null => {
    if (Array.isArray(v)) {
      const rows = v.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
      return rows.length ? (rows as Record<string, unknown>[]) : null;
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const key of ['rows', 'data', 'result', 'results', 'items', 'output']) {
        if (Array.isArray(o[key])) {
          const got = fromValue(o[key]);
          if (got) return got;
        }
      }
      // A single row returned bare, e.g. {"title":"…","status":"…"}.
      const vals = Object.values(o);
      if (vals.length && vals.every((x) => typeof x === 'string' || typeof x === 'number')) {
        return [o];
      }
    }
    return null;
  };

  // Try every plausible starting point, nearest first.
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch !== '{' && ch !== '[') continue;
    const parsed = balanced(cleaned, i, ch === '{' ? '}' : ']');
    if (parsed === null) continue;
    const rows = fromValue(parsed);
    if (rows) return rows;
  }
  return null;
}

/** Run one hedged completion and return the raw text. */
async function complete(keys: string[], messages: ChatMsg[], temperature: number): Promise<string> {
  const startKey = Math.floor(Math.random() * keys.length);
  const { stream } = await openHedgedStream(keys, startKey, messages, PLAN, {
    temperature,
    maxTokens: 2400,
  });
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

export async function POST(req: NextRequest) {
  let body: FillBody;
  try {
    body = (await req.json()) as FillBody;
  } catch {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 });
  }

  const columns = Array.isArray(body.columns) ? body.columns : [];
  if (columns.length === 0) {
    return NextResponse.json({ error: 'No columns to fill.' }, { status: 400 });
  }

  const keys = nimApiKeys();
  if (keys.length === 0) {
    return NextResponse.json({ error: 'No AI key configured on the server.' }, { status: 503 });
  }

  const mode = body.mode === 'extend' ? 'extend' : 'complete';
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 60) : [];
  const count = Math.min(Math.max(body.count ?? 5, 1), 25);

  const colSpec = columns
    .map((c) => {
      const opts = c.options?.length ? ` — must be one of: ${c.options.join(' | ')}` : '';
      return `- id "${c.id}" (${c.name}), type ${c.kind}${opts}`;
    })
    .join('\n');

  const user =
    mode === 'complete'
      ? `Subject: ${body.subject || 'a data table'}\n\nColumns:\n${colSpec}\n\n` +
        `These rows have blanks. Fill ONLY the blank cells, keeping every existing value exactly as it is. ` +
        `Return the same ${rows.length} rows in the same order.\n\n` +
        `Rows:\n${JSON.stringify(rows, null, 1)}`
      : `Subject: ${body.subject || 'a data table'}\n\nColumns:\n${colSpec}\n\n` +
        (rows.length
          ? `Existing rows (match their subject matter and tone, do NOT repeat them):\n${JSON.stringify(rows.slice(-12), null, 1)}\n\n`
          : '') +
        `Invent ${count} new, fully-populated rows that continue this set.`;

  const messages: ChatMsg[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ];

  try {
    let text = await complete(keys, messages, 0.55);
    let parsedRows = extractRows(text);

    /* One repair attempt. A free-tier model that wandered into prose almost
       always complies when handed its own output back with a blunt "JSON
       only" — cheaper and far less annoying than making the user click the
       button again and hope. */
    if (!parsedRows) {
      console.warn('[data-fill] unparseable first reply:', text.slice(0, 300));
      const repair: ChatMsg[] = [
        ...messages,
        { role: 'assistant', content: text.slice(0, 3000) },
        { role: 'user', content: 'That was not valid JSON. Reply again with ONLY the JSON object {"rows": [...]}. No prose, no code fences, nothing else.' },
      ];
      text = await complete(keys, repair, 0.2);
      parsedRows = extractRows(text);
    }

    if (!parsedRows) {
      console.warn('[data-fill] unparseable after repair:', text.slice(0, 300));
      return NextResponse.json({ error: 'The model did not return usable rows. Try again.' }, { status: 502 });
    }

    // Never trust the shape that comes back: keep only known columns, and
    // coerce every value to a string so the grid can render it blindly.
    const allowed = new Set(columns.map((c) => c.id));
    const safeRows = parsedRows.slice(0, mode === 'complete' ? rows.length : count).map((r) => {
      const out: Record<string, string> = {};
      if (r && typeof r === 'object') {
        for (const [k, v] of Object.entries(r)) {
          if (!allowed.has(k)) continue;
          if (v === null || v === undefined) continue;
          out[k] = typeof v === 'string' ? v : String(v);
        }
      }
      return out;
    });

    return NextResponse.json({ rows: safeRows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'AI fill failed.';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
