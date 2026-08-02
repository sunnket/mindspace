import type { CanvasObjectData } from './db';
import { gistOf } from './semanticZoom';

/**
 * ------------------------------------------------------------------
 * SEARCHING THE GALLERY — with an answer, not just a filter.
 *
 * What was here before was a boolean: a canvas survived if its title, its
 * category, or ANY block inside it contained the query. That is a correct
 * filter and a useless result. You typed "pricing", four boards came back, and
 * every one of them showed you the same thing it always shows — a title, a card
 * count and a timestamp. Nothing said which of them mentioned pricing, where,
 * or in what context, so the only way to find out was to open all four and
 * search again inside each.
 *
 * This module answers the question instead. For every canvas it returns:
 *
 *   · a SCORE, so the board that is genuinely about your query sorts above the
 *     one that mentions it once in a footnote;
 *   · the ranges that matched IN THE TITLE, so they can be marked up;
 *   · and every block that matched, each with a readable snippet windowed
 *     around the match and the offsets to highlight inside it.
 *
 * The snippets are what the gallery shows under each result, and the object ids
 * are what makes them clickable — the canvas can be opened flown straight to
 * the block you were actually looking for.
 * ------------------------------------------------------------------
 */

export interface SearchHit {
  objectId: string;
  /** A short human word for what kind of block this is — "checklist", "note". */
  kind: string;
  /** Text around the strongest match, with ellipses where it was cut. */
  snippet: string;
  /** [start, end) offsets INTO `snippet` to mark up. Non-overlapping, sorted. */
  ranges: Range[];
  score: number;
}

export type Range = [number, number];

export interface Scored<T> {
  item: T;
  score: number;
  /** Ranges to mark up in the canvas title. */
  titleRanges: Range[];
  /** The query matched this canvas's category chip. */
  categoryMatch: boolean;
  /** The best few matching blocks, already ranked. */
  hits: SearchHit[];
  /** How many blocks matched in total — `hits` is capped, this is not. */
  totalHits: number;
}

/** How many matching blocks a single canvas result carries. */
const MAX_HITS = 4;
/** Characters of context around a match. */
const SNIPPET_LEN = 104;
/** Longest text we will flatten out of one block before searching it. */
const FLAT_MAX = 4000;

/**
 * Query → terms. Quoted phrases stay whole ("q3 pricing" is one term), which is
 * the only way to ask for an exact sequence; everything else splits on spaces.
 */
export function parseQuery(raw: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const t = (m[1] ?? m[2] ?? '').toLowerCase().trim();
    if (t && !terms.includes(t)) terms.push(t);
  }
  return terms;
}

/** Every occurrence of `term` in `haystack` (already lower-cased). */
function findAll(haystack: string, term: string): Range[] {
  const out: Range[] = [];
  let i = haystack.indexOf(term);
  while (i !== -1 && out.length < 40) {
    out.push([i, i + term.length]);
    i = haystack.indexOf(term, i + term.length);
  }
  return out;
}

/**
 * Merge overlapping ranges and sort them.
 *
 * Two terms can overlap ("pric" and "pricing"), and a highlighter fed
 * overlapping ranges renders the same characters twice — which shows up as
 * duplicated text rather than as a highlight, so this is not cosmetic.
 */
export function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length < 2) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Range[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1]) last[1] = Math.max(last[1], sorted[i][1]);
    else out.push(sorted[i]);
  }
  return out;
}

/* ------------------------------------------------------------------
   What kind of block is this?

   Functional blocks keep their data in `style` and their identity in a flag, so
   the flag is the honest name — a card with `isTodo` is a checklist, not a
   card. Ordered most-specific first: several flags can be set at once and the
   first true one is the one the block actually is.
   ------------------------------------------------------------------ */
const KIND_FLAGS: [string, string][] = [
  ['isCheckpoint', 'checkpoint'],
  ['isTodo', 'checklist'],
  ['isTable', 'table'],
  ['isRoadmap', 'roadmap'],
  ['isTimeline', 'timeline'],
  ['isChart', 'chart'],
  ['isPoll', 'poll'],
  ['isQuote', 'quote'],
  ['isCallout', 'callout'],
  ['isCode', 'code'],
  ['isMermaid', 'diagram'],
  ['isBinder', 'binder'],
  ['isRepo', 'repo'],
  ['isGithub', 'github'],
  ['isFile', 'file'],
  ['isVoiceNote', 'voice note'],
  ['isLinkPreview', 'link'],
  ['isEmbed', 'embed'],
  ['isMap', 'map'],
  ['isWeather', 'weather'],
  ['isProgress', 'progress'],
  ['isCountdown', 'countdown'],
  ['isTimer', 'timer'],
  ['isDecision', 'decision'],
  ['isLiveMetric', 'metric'],
];

export function blockKind(obj: CanvasObjectData): string {
  const style = obj.style || {};
  for (const [flag, name] of KIND_FLAGS) if (style[flag]) return name;
  switch (obj.type) {
    case 'heading': return 'heading';
    case 'sticky': return 'sticky';
    case 'card': return 'card';
    case 'text': return 'note';
    case 'shape': return 'shape';
    case 'frame': return 'frame';
    case 'image': return 'image';
    case 'workflow-node': return 'step';
    default: return obj.type;
  }
}

/** Weight by how much a match in this kind of block means. */
function kindWeight(obj: CanvasObjectData): number {
  if (obj.type === 'heading') return 3;
  if (obj.type === 'frame') return 2.2;   // a frame's label names a whole region
  if (obj.style?.isCheckpoint) return 2;
  if (obj.type === 'sticky') return 1.3;
  return 1;
}

/* ------------------------------------------------------------------
   Getting words out of a block that isn't prose.

   A checklist, a table, a poll and a roadmap all keep their content as JSON in
   `content`. Summarising that with the prose summariser produces exactly what
   it sounds like:

     …-a723-ad6dfba4a69e","text":"Pricing page live","done":false},{"id":"0baf…

   which is a snippet nobody can read, wrapped around the one word they searched
   for. Worse, the ids and the hex colours in there are themselves searchable,
   so typing a stray "fa" could match half the board.

   Rather than write an extractor per block type — and forget one every time a
   new block ships — this walks the parsed JSON and keeps strings that arrived
   through a key that names TEXT. `text`, `label`, `title` are words a person
   wrote; `id`, `color`, `done` are not. A new block type gets this for free as
   long as it calls its text field something honest.
   ------------------------------------------------------------------ */
const TEXT_KEYS = new Set([
  'text', 'label', 'title', 'name', 'content', 'note', 'caption', 'question',
  'answer', 'description', 'summary', 'heading', 'body', 'value', 'item', 'task',
]);

const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i;
const HEXCOLOR = /^#[0-9a-f]{3,8}$/i;

function isWordy(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 400) return false;
  if (UUIDISH.test(t) || HEXCOLOR.test(t)) return false;
  if (t.startsWith('data:')) return false;
  // At least one letter — pure numbers and punctuation are not what anyone
  // means by searching a board.
  return /[a-z]/i.test(t);
}

function harvest(node: unknown, out: string[], viaTextKey: boolean, depth: number): void {
  if (out.length >= 80 || depth > 6) return;
  if (typeof node === 'string') {
    if (viaTextKey && isWordy(node)) out.push(node.trim());
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) harvest(v, out, viaTextKey, depth + 1);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      harvest(v, out, TEXT_KEYS.has(k.toLowerCase()), depth + 1);
    }
  }
}

/* Flattening runs over every block of every board on every keystroke, and for
   structured blocks it involves a JSON.parse. Keyed on the raw source, so the
   parse happens once per distinct block and typing a fifth letter costs a few
   hundred `indexOf` calls and nothing else. Same shape as the cache the canvas
   summariser keeps for the same reason. */
const flatCache = new Map<string, string>();
const FLAT_CACHE_MAX = 1200;

/**
 * A block's searchable text, flattened and cleaned the same way the canvas
 * summarises it — so a match in the gallery is a match you can actually see
 * when the board opens, rather than a hit on raw markdown syntax.
 */
function flatten(obj: CanvasObjectData): string {
  const raw = (obj.content || '').trim();
  if (!raw && !(obj.summary || '').trim()) return '';

  const key = `${obj.type} ${obj.summary || ''} ${raw}`;
  const cached = flatCache.get(key);
  if (cached !== undefined) return cached;

  let out: string;
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const words: string[] = [];
      harvest(parsed, words, true, 0);
      /* Deliberately '' when a structured block holds no prose — a chart of
         numbers genuinely has nothing to search, and saying so is better than
         falling back to dumping its data. */
      out = words.join(' · ');
    } catch {
      // Not JSON after all (a note that opens with a bracket) — prose path.
      out = gistOf(obj, FLAT_MAX).text;
    }
  } else {
    out = gistOf(obj, FLAT_MAX).text;
  }

  if (flatCache.size > FLAT_CACHE_MAX) flatCache.clear();
  flatCache.set(key, out);
  return out;
}

/**
 * A window of `text` around the first match, with every term's ranges rebased
 * into it.
 *
 * The window starts a little BEFORE the match rather than at it: a snippet that
 * begins with the word you searched for reads as a fragment, while one with a
 * few words of run-up reads as a sentence.
 */
function snippetAround(text: string, lower: string, terms: string[]): { snippet: string; ranges: Range[] } | null {
  let first = Infinity;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && i < first) first = i;
  }
  if (first === Infinity) return null;

  const lead = 28;
  let start = Math.max(0, first - lead);
  // Snap to a word boundary so a snippet never opens mid-word.
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    if (sp !== -1 && sp - start < 14) start = sp + 1;
  }
  let end = Math.min(text.length, start + SNIPPET_LEN);
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end);
    if (sp > start + SNIPPET_LEN * 0.6) end = sp;
  }

  const body = text.slice(start, end);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const snippet = prefix + body + suffix;

  const bodyLower = body.toLowerCase();
  const ranges: Range[] = [];
  for (const t of terms) {
    for (const [s, e] of findAll(bodyLower, t)) {
      ranges.push([s + prefix.length, e + prefix.length]);
    }
  }
  return { snippet, ranges: mergeRanges(ranges) };
}

export interface Searchable {
  title?: string;
  category?: string;
  lastModified: number;
  objects: CanvasObjectData[];
}

/**
 * Rank a list of canvases against a query.
 *
 * AND semantics across terms: every term has to appear SOMEWHERE in the canvas
 * (its title, its category, or one of its blocks) for it to survive. That is
 * what people mean by typing two words, and it is what makes a second word feel
 * like it narrows rather than widens.
 */
export function searchCanvases<T extends Searchable>(items: T[], rawQuery: string): Scored<T>[] {
  const terms = parseQuery(rawQuery);
  if (terms.length === 0) return [];
  const whole = rawQuery.toLowerCase().trim();

  const out: Scored<T>[] = [];

  for (const item of items) {
    const title = (item.title || 'untitled canvas').toLowerCase();
    const category = (item.category || '').toLowerCase();

    /** Terms accounted for anywhere in this canvas — the AND gate. */
    const seen = new Set<string>();
    let score = 0;

    // ---- title -----------------------------------------------------------
    const titleRanges: Range[] = [];
    for (const t of terms) {
      const found = findAll(title, t);
      if (found.length) {
        seen.add(t);
        titleRanges.push(...found);
        // Word-initial matches are what a person means by "starts with".
        const atWordStart = found.some(([s]) => s === 0 || /\s/.test(title[s - 1]));
        score += atWordStart ? 90 : 55;
      }
    }
    if (title === whole) score += 600;
    else if (title.startsWith(whole)) score += 320;
    else if (terms.length > 1 && title.includes(whole)) score += 200;

    // ---- category --------------------------------------------------------
    let categoryMatch = false;
    for (const t of terms) {
      if (category && category.includes(t)) {
        seen.add(t);
        categoryMatch = true;
        score += 40;
      }
    }

    // ---- blocks ----------------------------------------------------------
    const hits: SearchHit[] = [];
    let totalHits = 0;

    for (const obj of item.objects) {
      const flat = flatten(obj);
      if (!flat) continue;
      const lower = flat.toLowerCase();

      const matched = terms.filter((t) => lower.includes(t));
      if (matched.length === 0) continue;
      matched.forEach((t) => seen.add(t));
      totalHits++;

      const w = kindWeight(obj);
      /* Every term present in ONE block is worth far more than the same terms
         scattered across three: it means the block is about the thing you
         asked for, not that the words happen to co-occur on the board. */
      const allInOne = matched.length === terms.length ? 1.8 : 1;
      const startsWith = matched.some((t) => lower.startsWith(t)) ? 12 : 0;
      const hitScore = (18 * matched.length * w * allInOne) + startsWith;
      score += hitScore;

      const win = snippetAround(flat, lower, terms);
      if (win) {
        hits.push({
          objectId: obj.id,
          kind: blockKind(obj),
          snippet: win.snippet,
          ranges: win.ranges,
          score: hitScore,
        });
      }
    }

    if (seen.size < terms.length) continue;   // some term appears nowhere

    /* Beyond a handful, more matches stop meaning "more relevant" and start
       meaning "long board". Logarithmic, so 40 hits does not bury a title
       match, and so results do not simply sort by size. */
    score += Math.log2(1 + totalHits) * 10;

    hits.sort((a, b) => b.score - a.score);

    out.push({
      item,
      score,
      titleRanges: mergeRanges(titleRanges),
      categoryMatch,
      hits: hits.slice(0, MAX_HITS),
      totalHits,
    });
  }

  /* Recency breaks ties, and only ties. Two boards that mention your query
     equally often are ordered by the one you touched last, which is almost
     always the one you meant. */
  out.sort((a, b) => (b.score - a.score) || (b.item.lastModified - a.item.lastModified));
  return out;
}

/** Split `text` into alternating plain / highlighted pieces for rendering. */
export function splitByRanges(text: string, ranges: Range[]): { text: string; hit: boolean }[] {
  if (!ranges.length) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) parts.push({ text: text.slice(at, s), hit: false });
    parts.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}
