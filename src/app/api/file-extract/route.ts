import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Universal file reader. The canvas agent is text-based, so when the user drops
 * ANY file (pdf, docx, pptx, xlsx, zip, code, csv, json, markdown, …) the client
 * POSTs it here and we pull out its full text — plus a little structure (page /
 * slide / sheet counts) and every URL we find inside — so the agent can read the
 * whole thing and answer questions about it.
 *
 * POST multipart/form-data { file }  →  { text, chars, truncated, links, meta }
 */

// Hard ceiling on returned text so a giant document can't blow up the payload or
// the model context. ~180k chars ≈ well within what the agent can chew on.
const MAX_TEXT = 180_000;

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'yaml', 'yml',
  'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'svg', 'log', 'ini', 'toml',
  'env', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java',
  'kt', 'kts', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'php', 'swift', 'sh', 'bash',
  'zsh', 'sql', 'r', 'lua', 'pl', 'dart', 'vue', 'svelte', 'astro', 'graphql',
  'gql', 'proto', 'dockerfile', 'gitignore', 'tex', 'rst', 'srt', 'vtt',
]);

const URL_RE = /https?:\/\/[^\s<>"')\]}]+/gi;

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

function collectLinks(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(URL_RE)) {
    // Trim trailing punctuation that commonly rides along in prose.
    const url = m[0].replace(/[.,;:]+$/, '');
    found.add(url);
    if (found.size >= 60) break;
  }
  return [...found];
}

function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Pull the visible text out of an Office Open XML (docx/pptx/xlsx) part. */
function xmlText(xml: string): string {
  // <a:t> (drawing/ppt), <t> (word/excel), <w:t> — grab the inner text of each.
  const runs = xml.match(/<(?:[a-z]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-z]+:)?t>/gi) || [];
  return runs
    .map((r) => r.replace(/<[^>]+>/g, ''))
    .join(' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

interface Extracted {
  text: string;
  meta: Record<string, unknown>;
}

async function extractPdf(buf: Uint8Array): Promise<Extracted> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buf });
  try {
    const res = await parser.getText();
    // pdf-parse tags each page with a "-- N of M --" marker; drop those.
    const text = (res.text || '').replace(/\n*--\s*\d+\s+of\s+\d+\s*--\n*/g, '\n\n').trim();
    const pages = (res as { total?: number; numpages?: number }).total
      ?? (res as { total?: number; numpages?: number }).numpages;
    return { text, meta: { kind: 'PDF', pages } };
  } finally {
    await parser.destroy?.().catch(() => {});
  }
}

async function extractDocx(buf: Uint8Array): Promise<Extracted> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
  return { text: (value || '').trim(), meta: { kind: 'Word document' } };
}

async function extractZipLike(buf: Uint8Array, ext: string): Promise<Extracted> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);

  if (ext === 'pptx') {
    const slideNames = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => {
        const na = Number(a.match(/slide(\d+)\.xml/)?.[1] || 0);
        const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] || 0);
        return na - nb;
      });
    const parts: string[] = [];
    for (let i = 0; i < slideNames.length; i++) {
      const xml = await zip.files[slideNames[i]].async('string');
      const t = xmlText(xml);
      if (t) parts.push(`--- Slide ${i + 1} ---\n${t}`);
    }
    return { text: parts.join('\n\n').trim(), meta: { kind: 'PowerPoint', slides: slideNames.length } };
  }

  if (ext === 'xlsx') {
    const parts: string[] = [];
    const shared = zip.files['xl/sharedStrings.xml'];
    if (shared) {
      const t = xmlText(await shared.async('string'));
      if (t) parts.push(t);
    }
    const sheetNames = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    for (const s of sheetNames) {
      const t = xmlText(await zip.files[s].async('string'));
      if (t) parts.push(t);
    }
    return { text: parts.join('\n\n').trim(), meta: { kind: 'Spreadsheet', sheets: sheetNames.length } };
  }

  // Generic archive: list entries and read the text-like ones inline.
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  const listing = entries.map((f) => f.name).slice(0, 300);
  const parts: string[] = [`Archive contents (${entries.length} files):\n${listing.join('\n')}`];
  let budget = MAX_TEXT;
  for (const f of entries) {
    if (budget <= 0) break;
    const e = extOf(f.name);
    if (!TEXT_EXTS.has(e)) continue;
    try {
      const content = (await f.async('string')).slice(0, 40_000);
      if (content.trim()) {
        const block = `\n\n===== ${f.name} =====\n${content}`;
        parts.push(block);
        budget -= block.length;
      }
    } catch { /* skip unreadable entry */ }
  }
  return { text: parts.join('').trim(), meta: { kind: 'Archive', files: entries.length } };
}

function extractText(buf: Uint8Array, kind: string): Extracted {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  return { text: text.trim(), meta: { kind } };
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'A file field is required' }, { status: 400 });
    }

    const name = file.name || 'file';
    const ext = extOf(name);
    const mime = file.type || '';
    const buf = new Uint8Array(await file.arrayBuffer());
    // Capture size up front: some parsers (pdf.js) transfer the ArrayBuffer to a
    // worker, neutering `buf` so its length reads 0 afterwards.
    const sizeBytes = buf.byteLength || file.size;

    let extracted: Extracted;
    try {
      if (ext === 'pdf' || mime === 'application/pdf') {
        extracted = await extractPdf(buf);
      } else if (ext === 'docx' || mime.includes('wordprocessingml')) {
        extracted = await extractDocx(buf);
      } else if (['pptx', 'xlsx', 'zip'].includes(ext) || mime.includes('presentationml') || mime.includes('spreadsheetml') || mime.includes('zip')) {
        extracted = await extractZipLike(buf, ext === '' ? 'zip' : ext);
      } else if (TEXT_EXTS.has(ext) || mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('javascript')) {
        extracted = extractText(buf, ext ? `${ext.toUpperCase()} file` : 'Text file');
      } else {
        // Last resort: try to read it as UTF-8. If it decodes to mostly readable
        // text, keep it; otherwise report that it's binary with no text layer.
        const guess = extractText(buf, 'File');
        const printable = (guess.text.match(/[\x20-\x7E\s]/g)?.length || 0) / (guess.text.length || 1);
        extracted = printable > 0.85 && guess.text.length > 0
          ? guess
          : { text: '', meta: { kind: mime || ext || 'Binary file', binary: true } };
      }
    } catch (err) {
      // A parser choking on one format shouldn't 500 the whole drop — degrade to
      // a best-effort UTF-8 read so the block still appears with whatever we got.
      const fallback = extractText(buf, mime || ext || 'File');
      extracted = { text: fallback.text, meta: { kind: fallback.meta.kind, parseError: err instanceof Error ? err.message : String(err) } };
    }

    const links = extracted.text ? collectLinks(extracted.text) : [];
    const fullChars = extracted.text.length;
    const truncated = fullChars > MAX_TEXT;
    const text = truncated ? extracted.text.slice(0, MAX_TEXT) : extracted.text;

    return NextResponse.json({
      text,
      chars: fullChars,
      truncated,
      links,
      meta: { ...extracted.meta, name, ext, mime, sizeBytes, words: wordCount(text) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('File extract endpoint error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
