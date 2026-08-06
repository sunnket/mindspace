/**
 * Rich paste — a paste keeps the shape it had where it was copied from.
 *
 * THE BUG THIS EXISTS FOR. None of the contentEditable text editors had an
 * `onPaste` handler, so a paste took the browser's default path: the clipboard's
 * `text/html` was spliced into the element as real DOM — <b>, <span
 * style="font-size:24pt">, <ul>, the lot. The block then read itself back with
 * `innerText` (which is the source of truth for every text block, and has to be,
 * because `content` is stored as plain text), and `innerText` throws all of that
 * away. So every paste arrived flattened to the block's single font and single
 * size: headings, bold, bullets and sizing all gone in one step, and the user
 * had to re-type the structure by hand.
 *
 * WHAT IT DOES INSTEAD. Two things, from one parse of the clipboard HTML:
 *
 *   1. STRUCTURE → the canvas's own markdown subset (the one RichText already
 *      renders — see components/canvas/RichText.tsx). Headings become #/##/###,
 *      bold becomes **, lists become "- "/"1. ", checkboxes "[]"/"[x]",
 *      blockquotes "> ", rules "---", code fences ```. Because the output is
 *      plain text, it round-trips through `innerText`, IndexedDB, the cloud, the
 *      collab wire and the agent snapshot with no changes anywhere else.
 *
 *   2. TYPOGRAPHY → the source's dominant font family and size, so a paste is
 *      the size it was when it was copied. The block model holds ONE family and
 *      ONE size per block (obj.style.fontFamily / fontSize), so "dominant" is
 *      the honest answer: whichever family/size covers the most characters,
 *      weighted by text length. Mixed sizes inside one paste are carried by the
 *      heading levels instead, which is what they mean anyway.
 *
 * WHY WE RESOLVE CSS BY HAND. The fragment is parsed with DOMParser into a
 * document that is never rendered, so `getComputedStyle` returns nothing useful
 * — inheritance has to be walked manually. That is fine in practice because the
 * sources that matter (Word, Google Docs, web pages, this app) all write their
 * typography into inline `style` attributes on the spans they emit.
 */

/* Tags whose contents are not content. */
const SKIP_TAGS = new Set([
  'STYLE', 'SCRIPT', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'TITLE', 'COLGROUP', 'COL', 'IFRAME', 'OBJECT',
]);

/* Tags that start their own line. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'HR',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE',
  'MAIN', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD', 'ADDRESS', 'FORM', 'FIELDSET', 'NAV',
]);

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji',
]);

/* Enough to keep a pasted face in the right CATEGORY when the machine reading
   the board doesn't have that exact font installed. Losing "Garamond" but
   staying a serif is a far better outcome than silently becoming Inter. */
const LOOKS_SERIF = /times|georgia|garamond|palatino|book antiqua|cambria|constantia|baskerville|didot|minion|caslon|hoefler|charter|utopia|lora|merriweather|playfair|cinzel|serif/i;
const LOOKS_MONO = /courier|consolas|monaco|menlo|mono|jetbrains|source code|ibm plex mono|fira code|code|terminal|vt323/i;
const LOOKS_CURSIVE = /script|caveat|pacifico|dancing|lobster|sacramento|handwriting|comic|brush|segoe script|hallelujah|architects/i;

/** A paste with no declared size at all shouldn't invent one. */
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 200;

export interface PastedTypography {
  /** A CSS font stack, e.g. `'Calibri', sans-serif`. Absent if none declared. */
  fontFamily?: string;
  /** Pixels. Absent if the source declared no size. */
  fontSize?: number;
}

export interface ParsedPaste {
  /** The pasted content rewritten into the canvas's markdown subset. */
  markdown: string;
  /** The source's dominant family/size, where it declared them. */
  typography: PastedTypography;
}

/* ------------------------------- CSS bits -------------------------------- */

/**
 * The inline `style` attribute as a map.
 *
 * Property names are lower-cased; VALUES are left exactly as written, because
 * one of them is a font family and those carry meaningful case — lower-casing
 * turned `'Bebas Neue'` into `'bebas neue'`, which then showed up verbatim in
 * the properties rail. Everything that compares a value does its own
 * case-folding through `low()`.
 */
function styleOf(el: Element): Record<string, string> {
  const raw = el.getAttribute('style');
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf(':');
    if (i === -1) continue;
    out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

const low = (v?: string): string => (v || '').toLowerCase();

/** Any CSS length → px. Word writes pt, the web writes px, older mail writes in/cm. */
function parseSize(raw?: string): number | undefined {
  if (!raw) return undefined;
  const m = raw.trim().match(/^(-?[\d.]+)\s*(px|pt|pc|in|cm|mm|em|rem)?$/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!isFinite(n) || n <= 0) return undefined;
  const unit = m[2] || 'px';
  const px =
    unit === 'pt' ? n * (4 / 3) :
    unit === 'pc' ? n * 16 :
    unit === 'in' ? n * 96 :
    unit === 'cm' ? n * (96 / 2.54) :
    unit === 'mm' ? n * (96 / 25.4) :
    // em/rem have no resolved base in an unrendered document; 16px is the
    // browser default and the only defensible assumption.
    (unit === 'em' || unit === 'rem') ? n * 16 :
    n;
  const rounded = Math.round(px);
  if (rounded < MIN_FONT_SIZE || rounded > MAX_FONT_SIZE) return undefined;
  return rounded;
}

/**
 * A declared font-family list → a stack we can safely set on a block: the
 * source's own first choice, plus a generic that keeps its character if that
 * face isn't installed on the machine reading the board.
 */
function parseFamily(raw?: string): string | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map((p) => p.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  if (!parts.length) return undefined;

  const declaredGeneric = parts.find((p) => GENERIC_FAMILIES.has(p.toLowerCase()));
  const first = parts.find((p) => !GENERIC_FAMILIES.has(p.toLowerCase()));

  // Nothing but a generic ("serif") — that IS the answer.
  if (!first) return declaredGeneric;

  const generic =
    declaredGeneric && declaredGeneric !== 'system-ui' ? declaredGeneric :
    LOOKS_MONO.test(first) ? 'monospace' :
    LOOKS_CURSIVE.test(first) ? 'cursive' :
    LOOKS_SERIF.test(first) ? 'serif' :
    'sans-serif';

  return `'${first}', ${generic}`;
}

/** Is this a real highlight colour, or one of the transparent/white no-ops
 *  that Word and Google Docs sprinkle onto every span? */
function isHighlight(raw?: string): boolean {
  if (!raw) return false;
  const v = low(raw).trim();
  if (!v || v === 'transparent' || v === 'initial' || v === 'inherit' || v === 'none') return false;
  if (/^#(fff|ffffff)$/.test(v) || v === 'white') return false;
  const rgba = v.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const n = rgba[1].split(',').map((x) => parseFloat(x));
    if (n.length >= 4 && n[3] === 0) return false;      // fully transparent
    if (n[0] === 255 && n[1] === 255 && n[2] === 255) return false; // white
  }
  return /^#[0-9a-f]{3,8}$/.test(v) || /^rgba?\(/.test(v) || /^[a-z]+$/.test(v);
}

/* ------------------------------ the walker ------------------------------- */

interface Walk {
  /** Finished lines. */
  out: string[];
  /** The line being built. */
  line: string;
  /** A line prefix (heading hashes, list bullet) waiting for its first content. */
  prefix: string;
  /** Blockquote nesting depth. */
  quote: number;
  /** Open list stack — innermost last. */
  list: { ordered: boolean; n: number }[];
  /** Inside <pre>: whitespace is content. */
  pre: boolean;
  /** Text length seen per font stack / per size, for the dominant-typography vote. */
  fonts: Map<string, number>;
  sizes: Map<number, number>;
  /**
   * Depth inside content that must not vote on typography — headings.
   *
   * A heading's size is already carried by its `#` prefix, so letting it vote
   * makes the block's base size depend on the ratio of heading text to body
   * text in the selection: paste two short paragraphs under one long headline
   * and the whole block came out at headline size. Body text decides the base.
   */
  noVote: number;
}

function flush(w: Walk) {
  /* Trimmed at BOTH ends. Leading whitespace on a markdown line means list
     indentation, and that comes from `prefix` — never from the source HTML's
     own pretty-printing. Left in, the space after a <li>'s <input type=checkbox>
     landed inside the content as `[x]  thing`. */
  const t = w.line.trim();
  w.line = '';
  // Nothing on this line — keep any pending prefix for the line that does have
  // content (a <li> whose text is wrapped in a <p> flushes empty on the way in).
  if (!t) return;
  let line = w.quote > 0 ? `> ${w.prefix}${t}` : `${w.prefix}${t}`;
  w.prefix = '';
  // Never let a table row's separators read as ||spoiler|| syntax.
  line = line.replace(/\|\|/g, '| |');
  w.out.push(line);
}

/** An explicit <br>: end the line even when it's empty, so <br><br> is a gap. */
function hardBreak(w: Walk) {
  const t = w.line.trim();
  w.line = '';
  if (!t) { w.out.push(''); return; }
  w.prefix = '';
  w.out.push((w.quote > 0 ? `> ${t}` : t).replace(/\|\|/g, '| |'));
}

/** A blank separator line, deduped and never leading. */
function blank(w: Walk) {
  if (w.out.length && w.out[w.out.length - 1] !== '') w.out.push('');
}

function appendText(w: Walk, raw: string, marks: string[]) {
  if (!raw) return;
  const text = w.pre ? raw : raw.replace(/[\s ]+/g, ' ');
  if (!text) return;

  // Whitespace-only run: it still separates words, but it must never be given
  // marks (`* italic *` is not italic — RichText requires no space inside the
  // delimiters, deliberately, so "2 * 3 * 4" stays arithmetic).
  if (!text.trim()) {
    if (w.line && !/\s$/.test(w.line)) w.line += ' ';
    return;
  }

  let piece = text;
  if (marks.length) {
    /* Bold and italic on the SAME run would emit `***text***`, which
       RichText's inline scanner reads as `**` + `*text` — an unbalanced mess.
       Bold wins: losing the italic on a bold-italic run costs one nuance,
       emitting broken delimiters costs the whole paragraph. */
    const use = marks.includes('**') ? marks.filter((m) => m !== '*') : marks;
    const lead = piece.match(/^\s*/)![0];
    const tail = piece.match(/\s*$/)![0];
    const core = piece.slice(lead.length, piece.length - (tail.length || 0));
    piece = lead + use.join('') + core + use.slice().reverse().join('') + tail;
  }
  if (/\s$/.test(w.line) && /^\s/.test(piece)) piece = piece.replace(/^\s+/, '');
  w.line += piece;
}

/** The inline marks this element turns on, minus any already active. */
function marksFor(el: Element, active: string[]): string[] {
  const tag = el.tagName;
  const st = styleOf(el);
  const weight = low(st['font-weight']);
  const decoration = `${low(st['text-decoration'])} ${low(st['text-decoration-line'])}`;

  /* Google Docs wraps an ENTIRE copied selection in
     `<b style="font-weight:normal" id="docs-internal-guid-…">`. Trusting the
     tag alone made every Docs paste uniformly bold. */
  const bold =
    tag === 'B' || tag === 'STRONG'
      ? !(weight && /^(normal|[1-4]00)$/.test(weight))
      : !!weight && (weight === 'bold' || weight === 'bolder' || (parseInt(weight, 10) || 0) >= 600);

  const italic = tag === 'I' || tag === 'EM' || tag === 'CITE' || low(st['font-style']) === 'italic';
  const strike =
    tag === 'S' || tag === 'DEL' || tag === 'STRIKE' || decoration.includes('line-through');
  const highlight = tag === 'MARK' || isHighlight(st['background-color']);

  const add: string[] = [];
  if (bold) add.push('**');
  else if (italic) add.push('*');
  if (strike) add.push('~~');
  if (highlight) add.push('==');
  return add.filter((m) => !active.includes(m));
}

/** Record how many characters were set in this family/size, for the vote. */
function tally(w: Walk, chars: number, font?: string, size?: number) {
  if (chars <= 0 || w.noVote > 0) return;
  if (font) w.fonts.set(font, (w.fonts.get(font) || 0) + chars);
  if (size) w.sizes.set(size, (w.sizes.get(size) || 0) + chars);
}

function walk(node: Node, w: Walk, marks: string[], font?: string, size?: number) {
  if (node.nodeType === Node.TEXT_NODE) {
    const raw = node.nodeValue || '';
    appendText(w, raw, marks);
    tally(w, raw.trim().length, font, size);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  const tag = el.tagName;
  if (SKIP_TAGS.has(tag)) return;
  if (el.getAttribute('aria-hidden') === 'true') return;

  const st = styleOf(el);
  if (low(st['display']) === 'none') return;

  const nextFont = parseFamily(st['font-family'] || el.getAttribute('face') || undefined) || font;
  const nextSize = parseSize(st['font-size']) ?? size;

  if (tag === 'BR') { hardBreak(w); return; }
  if (tag === 'HR') { flush(w); w.out.push('---'); return; }

  /* An image inside pasted prose has no text to carry. Naming it is better
     than dropping it silently — the user can see something was there. */
  if (tag === 'IMG') {
    const alt = (el.getAttribute('alt') || '').trim();
    if (alt) appendText(w, alt, marks);
    return;
  }

  if (tag === 'PRE') {
    flush(w);
    blank(w);
    w.out.push('```');
    const wasPre = w.pre;
    w.pre = true;
    // Inside a fence the markdown is literal, so no marks are applied.
    for (const child of Array.from(el.childNodes)) walk(child, w, [], nextFont, nextSize);
    w.pre = wasPre;
    // The fence owns its own line breaks: split whatever accumulated.
    for (const l of w.line.split('\n')) w.out.push(l);
    w.line = '';
    w.out.push('```');
    return;
  }

  if (tag === 'CODE' && !w.pre) {
    // Inline code — RichText renders `…` as a code chip.
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) {
      appendText(w, `\`${text}\``, marks.filter((m) => m !== '**' && m !== '*'));
      tally(w, text.length, nextFont, nextSize);
    }
    return;
  }

  if (tag === 'A') {
    /* The canvas markdown has no [text](url) form — `@[…](ref:id)` is a
       block reference, not a hyperlink. So an anchor keeps the text the user
       could SEE, which is what "same format" means here; a bare URL pasted on
       its own still becomes a link card via the existing path in
       InfiniteCanvas/CanvasObject. Only a link with no visible text falls back
       to its href, so it doesn't vanish entirely. */
    const label = (el.textContent || '').trim();
    if (label) {
      for (const child of Array.from(el.childNodes)) walk(child, w, marks, nextFont, nextSize);
    } else {
      const href = el.getAttribute('href');
      if (href && /^https?:/i.test(href)) appendText(w, href, marks);
    }
    return;
  }

  if (tag === 'UL' || tag === 'OL') {
    flush(w);
    w.list.push({ ordered: tag === 'OL', n: parseInt(el.getAttribute('start') || '1', 10) || 1 });
    for (const child of Array.from(el.childNodes)) walk(child, w, marks, nextFont, nextSize);
    w.list.pop();
    flush(w);
    if (!w.list.length) blank(w);
    return;
  }

  if (tag === 'LI') {
    flush(w);
    const depth = Math.max(0, w.list.length - 1);
    const indent = '  '.repeat(depth);
    const ctx = w.list[w.list.length - 1];

    /* A real task list, not a bullet: <li><input type=checkbox checked> */
    const box = el.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]');
    if (box) {
      w.prefix = `${indent}[${box.hasAttribute('checked') || (box as HTMLInputElement).checked ? 'x' : ' '}] `;
    } else if (ctx?.ordered) {
      w.prefix = `${indent}${ctx.n++}. `;
    } else {
      w.prefix = `${indent}- `;
    }

    for (const child of Array.from(el.childNodes)) walk(child, w, marks, nextFont, nextSize);
    flush(w);
    return;
  }

  if (/^H[1-6]$/.test(tag)) {
    flush(w);
    blank(w);
    /* Only three heading levels exist in the canvas markdown, so h4-h6 land on
       ### rather than being demoted to body text and losing their rank. */
    const level = Math.min(3, parseInt(tag.slice(1), 10));
    // Inside a quote the hashes would render literally — the quote wins.
    if (w.quote === 0) w.prefix = `${'#'.repeat(level)} `;
    w.noVote++;
    for (const child of Array.from(el.childNodes)) walk(child, w, marks, nextFont, nextSize);
    w.noVote--;
    flush(w);
    blank(w);
    return;
  }

  if (tag === 'BLOCKQUOTE') {
    flush(w);
    blank(w);
    w.quote++;
    for (const child of Array.from(el.childNodes)) walk(child, w, marks, nextFont, nextSize);
    flush(w);
    w.quote--;
    blank(w);
    return;
  }

  if (tag === 'TD' || tag === 'TH') {
    // Cells sit on one row line, separated by a pipe.
    if (w.line.trim()) w.line += ' | ';
    for (const child of Array.from(el.childNodes)) walk(child, w, marks, nextFont, nextSize);
    return;
  }

  const isBlock = BLOCK_TAGS.has(tag);
  if (isBlock) flush(w);

  const nextMarks = [...marks, ...marksFor(el, marks)];
  for (const child of Array.from(el.childNodes)) walk(child, w, nextMarks, nextFont, nextSize);

  if (isBlock) {
    flush(w);
    // A paragraph is a paragraph: keep the gap so pasted prose doesn't come out
    // as one dense wall of lines.
    if (tag === 'P' || tag === 'BLOCKQUOTE' || tag === 'TABLE') blank(w);
  }
}

/** Whichever family/size covers the most characters. */
function dominant(w: Walk): PastedTypography {
  const pick = <T,>(m: Map<T, number>): T | undefined => {
    let best: T | undefined;
    let bestN = 0;
    for (const [k, n] of m) if (n > bestN) { best = k; bestN = n; }
    return best;
  };
  const out: PastedTypography = {};
  const font = pick(w.fonts);
  const size = pick(w.sizes);
  if (font) out.fontFamily = font;
  if (size) out.fontSize = size;
  return out;
}

/* -------------------------------- public -------------------------------- */

/**
 * Clipboard HTML → canvas markdown + the source's dominant typography.
 * Returns an empty markdown string if the fragment carried no text.
 */
export function parseClipboardHtml(html: string): ParsedPaste {
  if (typeof DOMParser === 'undefined') return { markdown: '', typography: {} };
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return { markdown: '', typography: {} };
  }
  const w: Walk = {
    out: [], line: '', prefix: '', quote: 0, list: [], pre: false,
    fonts: new Map(), sizes: new Map(), noVote: 0,
  };
  walk(doc.body, w, []);
  flush(w);

  const markdown = w.out
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { markdown, typography: dominant(w) };
}

/**
 * What a paste event actually carries, normalised.
 *
 * Prefers `text/html` (the only flavour that HAS formatting) and falls back to
 * `text/plain`. Returns null when there is nothing to insert — including the
 * image case, which callers handle separately: a copied picture arrives as
 * several clipboard entries at once and belongs on the canvas as an image
 * block, not as text.
 */
export function readPaste(data: DataTransfer | null): ParsedPaste | null {
  if (!data) return null;
  const html = data.getData('text/html');
  if (html && html.trim()) {
    const parsed = parseClipboardHtml(html);
    if (parsed.markdown) return parsed;
  }
  const plain = data.getData('text/plain');
  if (plain) return { markdown: plain, typography: {} };
  return null;
}

/**
 * The style patch a paste should apply to the block it landed in.
 *
 * Two guards, and both of them are about not overwriting a decision:
 *
 *  · The block must still be BLANK. Adopting the source's font onto a block
 *    that already holds the user's own writing would restyle that writing
 *    retroactively — a paste must never reformat text it didn't bring.
 *
 *  · The value being replaced must not be one the user PICKED. A brand-new text
 *    box is stamped with the text tool's current defaults the moment it's born
 *    (see the `textStyle` read in InfiniteCanvas), so "a family is already set"
 *    does NOT mean "the user chose this family" — checking only for absence made
 *    the adopt path dead code for the single most common flow there is: click
 *    empty canvas, paste. So a value is fair game when it is missing OR equal to
 *    the tool default it was seeded from, and off-limits once it differs, which
 *    is the one case where the user really did reach for the rail and set it.
 */
export function typographyPatch(
  typography: PastedTypography,
  existingContent: string,
  existingStyle?: Record<string, unknown>,
  toolDefaults?: { fontFamily?: unknown; fontSize?: unknown }
): Record<string, unknown> | null {
  if (existingContent.trim()) return null;

  const replaceable = (current: unknown, seeded: unknown) =>
    current === undefined || current === null || current === '' || current === seeded;

  const patch: Record<string, unknown> = {};
  if (typography.fontFamily && replaceable(existingStyle?.fontFamily, toolDefaults?.fontFamily)) {
    patch.fontFamily = typography.fontFamily;
  }
  if (typography.fontSize && replaceable(existingStyle?.fontSize, toolDefaults?.fontSize)) {
    patch.fontSize = typography.fontSize;
  }
  return Object.keys(patch).length ? patch : null;
}
