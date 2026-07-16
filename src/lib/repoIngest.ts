import JSZip from 'jszip';
import { useCanvasStore } from '@/store/canvasStore';
import type { CanvasObjectData } from '@/lib/db';

/**
 * Repo / Folder Explorer ingest.
 *
 * Turns a dropped folder, a picked folder (webkitdirectory), or a .zip of a
 * repo into a single canvas block that browses like a mini code editor: a file
 * tree on the left, syntax-highlighted source on the right.
 *
 * The whole repo (tree + text) is serialized as JSON into the block's `content`
 * so it persists through IndexedDB + cloud sync and survives a reload — no
 * separate blob store, same as every other block. To keep that payload sane we
 * skip build/vendor junk, skip binaries (kept as tree entries, no text), and
 * cap per-file and total text. Anything trimmed is reported in `meta` so the UI
 * can say so plainly instead of silently lying about the repo.
 */

export interface RepoFile {
  /** Path relative to the repo root, e.g. "src/index.ts". */
  path: string;
  /** Byte size when known (0 for zip entries whose size we didn't measure). */
  size: number;
  /** File text, or null when binary / skipped for size. */
  text: string | null;
  /** True for non-text files (images, fonts, binaries…). */
  binary: boolean;
  /** True when the text was cut at the per-file cap. */
  truncated?: boolean;
  /** True when text was dropped because the whole-repo cap was hit. */
  skipped?: boolean;
}

export interface RepoPayload {
  v: 1;
  name: string;
  files: RepoFile[];
  meta: {
    fileCount: number;
    textBytes: number;
    binaryCount: number;
    truncatedCount: number;
    skippedCount: number;
    ignoredCount: number;
    loadedAt: number;
    hitTotalCap: boolean;
  };
}

/** Folders that are noise for reading — build output, deps, VCS internals. */
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', '.next', '.nuxt', '.svelte-kit',
  'dist', 'build', 'out', 'coverage', '.turbo', '.parcel-cache', '.cache',
  'venv', '.venv', 'env', '__pycache__', '.pytest_cache', '.mypy_cache',
  'target', 'vendor', 'Pods', 'DerivedData', '.gradle', '.idea', 'bin', 'obj',
  '.terraform', '.serverless', 'bower_components', '.expo', '.angular',
  '.vercel', '.output', 'tmp', '.tmp',
]);

/** Extensions we treat as binary — listed in the tree, never read as text. */
const BINARY_EXTS = new Set([
  // images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'icns', 'tiff', 'heic',
  // vector/design that is often huge or non-source
  'psd', 'ai', 'sketch', 'fig', 'xcf',
  // fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // audio / video
  'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus',
  'mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'wmv',
  // archives / packages
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'jar', 'war', 'apk', 'ipa',
  // docs / binaries
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'odt', 'ods', 'odp',
  'exe', 'dll', 'so', 'dylib', 'o', 'a', 'lib', 'class', 'pyc', 'wasm',
  'bin', 'dat', 'db', 'sqlite', 'sqlite3', 'mo',
]);

const MAX_FILE_TEXT_CHARS = 400_000;      // ~400 KB per file
const MAX_TOTAL_TEXT_CHARS = 8_000_000;   // ~8 MB of text across the repo
const MAX_FILES = 6000;                   // hard ceiling on tree entries
const NUL = String.fromCharCode(0);       // control char (no literal NUL in source)

export function extOf(path: string): string {
  const base = path.split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function isBinaryPath(path: string): boolean {
  const base = (path.split('/').pop() || '').toLowerCase();
  if (base === '.ds_store') return true;
  return BINARY_EXTS.has(extOf(path));
}

/** True if any path segment is an ignored directory. */
function isIgnoredPath(path: string): boolean {
  return path.split('/').some((seg) => IGNORE_DIRS.has(seg));
}

/** A source entry to be read, abstracted over folder Files and zip members. */
interface RawEntry {
  path: string;
  size: number;
  readText: () => Promise<string>;
}

/**
 * Strip a shared leading directory so the tree root is the repo's contents, not
 * a redundant wrapper folder (webkitdirectory and most zips add one).
 */
function stripCommonRoot(paths: string[]): { root: string; strip: (p: string) => string } {
  if (paths.length === 0) return { root: '', strip: (p) => p };
  const firstSeg = (p: string) => p.split('/')[0];
  const candidate = firstSeg(paths[0]);
  const allShare = !!candidate && paths.every((p) => p.includes('/') && firstSeg(p) === candidate);
  if (allShare) {
    return { root: candidate, strip: (p) => p.slice(candidate.length + 1) };
  }
  return { root: '', strip: (p) => p };
}

/** Build the persisted payload from raw entries, applying all the caps/filters. */
async function buildPayload(entries: RawEntry[], fallbackName: string): Promise<RepoPayload> {
  const kept = entries.filter((e) => !isIgnoredPath(e.path));
  const ignoredCount = entries.length - kept.length;

  const { root, strip } = stripCommonRoot(kept.map((e) => e.path));
  const name = root || fallbackName || 'repo';

  kept.sort((a, b) => a.path.localeCompare(b.path));

  const files: RepoFile[] = [];
  let textBytes = 0;
  let binaryCount = 0;
  let truncatedCount = 0;
  let skippedCount = 0;
  let hitTotalCap = false;

  for (const entry of kept) {
    if (files.length >= MAX_FILES) break;
    const rel = strip(entry.path);
    if (!rel) continue;

    if (isBinaryPath(rel)) {
      files.push({ path: rel, size: entry.size, text: null, binary: true });
      binaryCount++;
      continue;
    }

    if (hitTotalCap || textBytes >= MAX_TOTAL_TEXT_CHARS) {
      hitTotalCap = true;
      files.push({ path: rel, size: entry.size, text: null, binary: false, skipped: true });
      skippedCount++;
      continue;
    }

    let text: string;
    try {
      text = await entry.readText();
    } catch {
      files.push({ path: rel, size: entry.size, text: null, binary: false, skipped: true });
      skippedCount++;
      continue;
    }

    // A stray NUL byte means it's really binary despite the extension.
    if (text.includes(NUL)) {
      files.push({ path: rel, size: entry.size, text: null, binary: true });
      binaryCount++;
      continue;
    }

    let truncated = false;
    if (text.length > MAX_FILE_TEXT_CHARS) {
      text = text.slice(0, MAX_FILE_TEXT_CHARS);
      truncated = true;
      truncatedCount++;
    }
    textBytes += text.length;
    files.push({ path: rel, size: entry.size || text.length, text, binary: false, truncated });
  }

  return {
    v: 1,
    name,
    files,
    meta: {
      fileCount: files.length,
      textBytes,
      binaryCount,
      truncatedCount,
      skippedCount,
      ignoredCount,
      loadedAt: Date.now(),
      hitTotalCap,
    },
  };
}

/* ------------------------------------------------------------------ *
 *  Entry collectors — folder picker, zip, and drag-drop
 * ------------------------------------------------------------------ */

/** From a webkitdirectory <input> FileList (each File has webkitRelativePath). */
function entriesFromFileList(fileList: FileList | File[]): RawEntry[] {
  const arr = Array.from(fileList as ArrayLike<File>);
  return arr.map((file) => {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    return { path, size: file.size, readText: () => file.text() };
  });
}

/** From a .zip file, via JSZip. */
async function entriesFromZip(file: File): Promise<{ entries: RawEntry[]; name: string }> {
  const zip = await JSZip.loadAsync(file);
  const entries: RawEntry[] = [];
  zip.forEach((path, zf) => {
    if (zf.dir) return;
    // Ignore macOS zip cruft.
    if (path.startsWith('__MACOSX/') || path.endsWith('.DS_Store')) return;
    entries.push({
      path,
      size: 0,
      readText: () => zf.async('string'),
    });
  });
  const zipName = file.name.replace(/\.zip$/i, '') || 'repo';
  return { entries, name: zipName };
}

/**
 * Synchronously grab the FileSystemEntry objects from a drop. Must run inside
 * the drop handler before any await — the DataTransfer is emptied afterwards.
 */
export function collectDropEntries(dt: DataTransfer): FileSystemEntry[] {
  const out: FileSystemEntry[] = [];
  const items = dt.items;
  if (!items) return out;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind !== 'file') continue;
    const entry = (it as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.();
    if (entry) out.push(entry);
  }
  return out;
}

export function hasDirectoryEntry(entries: FileSystemEntry[]): boolean {
  return entries.some((e) => e.isDirectory);
}

function fsEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readAllDirEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const pump = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) { resolve(all); return; }
        all.push(...batch);
        pump(); // readEntries returns in chunks — keep going until empty
      }, reject);
    };
    pump();
  });
}

async function walkFsEntry(entry: FileSystemEntry, prefix: string, out: RawEntry[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  if (entry.isFile) {
    const file = await fsEntryFile(entry as FileSystemFileEntry).catch(() => null);
    if (file) out.push({ path: prefix + entry.name, size: file.size, readText: () => file.text() });
    return;
  }
  if (entry.isDirectory) {
    if (IGNORE_DIRS.has(entry.name)) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const kids = await readAllDirEntries(reader).catch(() => [] as FileSystemEntry[]);
    for (const kid of kids) {
      await walkFsEntry(kid, prefix + entry.name + '/', out);
    }
  }
}

async function entriesFromFsEntries(fsEntries: FileSystemEntry[]): Promise<{ entries: RawEntry[]; name: string }> {
  const out: RawEntry[] = [];
  for (const e of fsEntries) {
    await walkFsEntry(e, '', out);
  }
  const dirs = fsEntries.filter((e) => e.isDirectory);
  const name = dirs.length === 1 ? dirs[0].name : 'repo';
  return { entries: out, name };
}

/* ------------------------------------------------------------------ *
 *  Block lifecycle
 * ------------------------------------------------------------------ */

export const DEFAULT_REPO_SIZE = { width: 760, height: 500 };

/** Create an empty repo block (shows the dropzone until a folder/zip is loaded). */
export function createRepoBlock(x: number, y: number): CanvasObjectData {
  const store = useCanvasStore.getState();
  const block = store.addObject({
    type: 'card',
    x,
    y,
    width: DEFAULT_REPO_SIZE.width,
    height: DEFAULT_REPO_SIZE.height,
    content: '',
    style: { isRepo: true, repoStatus: 'empty' },
  });
  store.setSelectedId(block.id);
  return block;
}

function patchStyle(blockId: string, patch: Record<string, unknown>, content?: string) {
  const store = useCanvasStore.getState();
  const live = store.objects.find((o) => o.id === blockId);
  if (!live) return;
  store.updateObject(blockId, {
    ...(content !== undefined ? { content } : {}),
    style: { ...live.style, ...patch },
  });
}

async function loadEntriesIntoBlock(blockId: string, entries: RawEntry[], name: string): Promise<void> {
  patchStyle(blockId, { isRepo: true, repoStatus: 'loading', repoLoadingName: name, repoError: '' });
  try {
    const payload = await buildPayload(entries, name);
    if (payload.files.length === 0) {
      patchStyle(blockId, {
        repoStatus: 'error',
        repoError: 'No readable files found (everything was build output, binaries, or ignored folders).',
      });
      return;
    }
    patchStyle(
      blockId,
      {
        isRepo: true,
        repoStatus: 'ready',
        repoName: payload.name,
        repoFileCount: payload.meta.fileCount,
        repoLoadingName: '',
        repoError: '',
      },
      JSON.stringify(payload),
    );
  } catch (err) {
    patchStyle(blockId, {
      repoStatus: 'error',
      repoError: (err as Error)?.message || 'Failed to read this folder.',
    });
  }
}

/** Load a picked folder (webkitdirectory input) into an existing block. */
export async function ingestFolderPickerIntoBlock(blockId: string, fileList: FileList | File[]): Promise<void> {
  const entries = entriesFromFileList(fileList);
  const first = (Array.from(fileList as ArrayLike<File>)[0] as File & { webkitRelativePath?: string })?.webkitRelativePath;
  const name = first ? first.split('/')[0] : 'repo';
  await loadEntriesIntoBlock(blockId, entries, name);
}

/** Load a .zip into an existing block. */
export async function ingestZipIntoBlock(blockId: string, file: File): Promise<void> {
  patchStyle(blockId, { repoStatus: 'loading', repoLoadingName: file.name, repoError: '' });
  try {
    const { entries, name } = await entriesFromZip(file);
    await loadEntriesIntoBlock(blockId, entries, name);
  } catch {
    patchStyle(blockId, { repoStatus: 'error', repoError: 'Could not read this .zip archive.' });
  }
}

/** Load dragged FileSystemEntry objects (folder drag-drop) into an existing block. */
export async function ingestFsEntriesIntoBlock(blockId: string, fsEntries: FileSystemEntry[]): Promise<void> {
  patchStyle(blockId, { repoStatus: 'loading', repoLoadingName: 'folder', repoError: '' });
  const { entries, name } = await entriesFromFsEntries(fsEntries);
  await loadEntriesIntoBlock(blockId, entries, name);
}

/** Drop a folder straight onto the canvas → make a new repo block and fill it. */
export async function ingestDroppedFolder(fsEntries: FileSystemEntry[], x: number, y: number): Promise<void> {
  const block = createRepoBlock(x, y);
  await ingestFsEntriesIntoBlock(block.id, fsEntries);
}

export function parseRepoPayload(content: string): RepoPayload | null {
  if (!content) return null;
  try {
    const p = JSON.parse(content);
    if (p && p.v === 1 && Array.isArray(p.files)) return p as RepoPayload;
  } catch {
    /* not a repo payload */
  }
  return null;
}
