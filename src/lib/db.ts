import { openDB, DBSchema, IDBPDatabase } from 'idb';

/**
 * A joining guest's live collab session renders under a synthetic canvas id
 * (`__collab_<CODE>`) that must never touch local storage — it's the host's
 * shared content, not the guest's own canvas. Every save path below no-ops
 * for this prefix so callers (including applyRemoteSnapshot/applyRemoteOp)
 * don't need their own awareness of it.
 */
export const COLLAB_SESSION_ID_PREFIX = '__collab_';
function isCollabSessionId(id?: string): boolean {
  return !!id && id.startsWith(COLLAB_SESSION_ID_PREFIX);
}

export interface CanvasObjectData {
  id: string;
  type: 'text' | 'sticky' | 'image' | 'drawing' | 'card' | 'heading' | 'shape' | 'arrow' | 'workflow-node' | 'frame' | 'browser' | 'mirror' | 'pin';
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  style?: Record<string, unknown>;
  summary?: string; // optional short summary shown at mid/far zoom (Fathom)
  zIndex: number;
  parentId?: string; // for nested canvases
  rotation?: number;
  locked?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DrawingStroke {
  id: string;
  points: number[][];
  color: string;
  size: number;
  parentId?: string;
  isHighlighter?: boolean;
  createdAt: number;
  opacity?: number;
  flow?: number;
  hardness?: number;
  stabilization?: number;
  pressure?: boolean;
  smoothing?: number;
  texture?: string;
  blendMode?: string;
}

export interface Scene {
  id: string;
  name: string;
  camera: { x: number; y: number; zoom: number };
  order: number;
  durationMs?: number;
  /** Optional narration read aloud in present mode. */
  notes?: string;
  /**
   * Region scenes (born from a `scene`-kind frame) store the world-space
   * rectangle instead of relying on `camera` alone. The camera is then derived
   * at playback time, so the slide frames the same REGION on any screen size
   * rather than replaying a camera captured on a different monitor — and the
   * player can mask everything outside it.
   */
  rect?: { x: number; y: number; width: number; height: number };
  /** The frame this scene mirrors; renaming that frame renames the slide. */
  frameId?: string;
}

export interface CommentReply {
  id: string;
  author: string;
  text: string;
  ts: number;
}

export interface CommentThread {
  id: string;
  anchor: { type: 'object'; objectId: string } | { type: 'point'; x: number; y: number };
  replies: CommentReply[];
  resolved: boolean;
  createdAt: number;
}

/**
 * Constellation View state — the user-composed star map. Clusters are NOT
 * derived here; the sky only holds what the user authored:
 *   stars  — per-block position + name overrides (id → {x,y,name})
 *   links  — the connections the user drew between stars
 *   names  — constellation names, keyed by a connected component's anchor id
 */
export interface SkyStarOverride { x?: number; y?: number; name?: string }
export interface SkyState {
  stars?: Record<string, SkyStarOverride>;
  links?: [string, string][];
  names?: Record<string, string>;
}

export interface CanvasState {
  id: string;
  title?: string;
  themeColor?: string;
  /** Per-canvas background / color mode (paper color + intensity). */
  background?: import('./canvasTheme').CanvasBackground;
  camera: { x: number; y: number; zoom: number };
  checkpoint?: { x: number; y: number; zoom: number };
  scenes?: Scene[];
  threads?: CommentThread[];
  /** Per-canvas Skill Set — standing rules the AI agent obeys in this canvas. */
  skillset?: import('./skillset').CanvasSkillset;
  /** Constellation View — the user-composed star map (positions, links, names). */
  sky?: SkyState;
  lastModified: number;
  category?: string;
  isFavorite?: boolean;
  archived?: boolean;
  deleted?: boolean;
}

export interface ConnectionData {
  id: string;
  fromId: string;
  toId: string;
  parentId?: string;
  createdAt: number;
  style?: Record<string, unknown>;
}

interface MindSpaceDB extends DBSchema {
  objects: {
    key: string;
    value: CanvasObjectData;
    indexes: { 'by-parent': string; 'by-type': string };
  };
  strokes: {
    key: string;
    value: DrawingStroke;
    indexes: { 'by-parent': string };
  };
  connections: {
    key: string;
    value: ConnectionData;
    indexes: { 'by-parent': string };
  };
  canvas: {
    key: string;
    value: CanvasState;
  };
}

let dbInstance: IDBPDatabase<MindSpaceDB> | null = null;

// Fresh database name: the app must never reconnect to legacy stores,
// which may hold oversized/corrupted canvases that lock up the browser on load.
const DB_NAME = 'mindspace-db-v3';
const LEGACY_DB_NAMES = ['mindspace-db'];

export async function getDB(): Promise<IDBPDatabase<MindSpaceDB>> {
  if (dbInstance) return dbInstance;

  if (typeof indexedDB !== 'undefined') {
    for (const legacyName of LEGACY_DB_NAMES) {
      try {
        indexedDB.deleteDatabase(legacyName);
      } catch {
        // Old data is abandoned either way since we only open DB_NAME below
      }
    }
  }

  dbInstance = await openDB<MindSpaceDB>(DB_NAME, 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('objects')) {
        const objectStore = db.createObjectStore('objects', { keyPath: 'id' });
        objectStore.createIndex('by-parent', 'parentId');
        objectStore.createIndex('by-type', 'type');
      }

      if (!db.objectStoreNames.contains('strokes')) {
        const strokeStore = db.createObjectStore('strokes', { keyPath: 'id' });
        strokeStore.createIndex('by-parent', 'parentId');
      }

      if (!db.objectStoreNames.contains('connections')) {
        const connectionStore = db.createObjectStore('connections', { keyPath: 'id' });
        connectionStore.createIndex('by-parent', 'parentId');
      }

      if (!db.objectStoreNames.contains('canvas')) {
        db.createObjectStore('canvas', { keyPath: 'id' });
      }
    },
  });

  return dbInstance;
}

export async function saveObject(obj: CanvasObjectData): Promise<void> {
  if (isCollabSessionId(obj.parentId)) return;
  const db = await getDB();
  await db.put('objects', { ...obj, updatedAt: Date.now() });
}

export async function saveObjects(objects: CanvasObjectData[]): Promise<void> {
  const filtered = objects.filter((obj) => !isCollabSessionId(obj.parentId));
  if (filtered.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('objects', 'readwrite');
  for (const obj of filtered) {
    await tx.store.put({ ...obj, updatedAt: Date.now() });
  }
  await tx.done;
}

export async function deleteObject(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('objects', id);

  try {
    const { deleteCloudObject } = await import('./syncService');
    await deleteCloudObject(id);
  } catch (err) {
    console.error('Failed to sync delete object to cloud:', err);
  }
}

export async function getAllObjects(parentId?: string): Promise<CanvasObjectData[]> {
  const db = await getDB();
  if (parentId) {
    return db.getAllFromIndex('objects', 'by-parent', parentId);
  }
  const all = await db.getAll('objects');
  return all.filter(o => !o.parentId);
}

export async function saveStroke(stroke: DrawingStroke): Promise<void> {
  if (isCollabSessionId(stroke.parentId)) return;
  const db = await getDB();
  await db.put('strokes', stroke);
}

export async function saveStrokes(strokes: DrawingStroke[]): Promise<void> {
  const filtered = strokes.filter((stroke) => !isCollabSessionId(stroke.parentId));
  if (filtered.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('strokes', 'readwrite');
  for (const stroke of filtered) {
    await tx.store.put(stroke);
  }
  await tx.done;
}

export async function deleteStroke(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('strokes', id);

  try {
    const { deleteCloudStroke } = await import('./syncService');
    await deleteCloudStroke(id);
  } catch (err) {
    console.error('Failed to sync delete stroke to cloud:', err);
  }
}

export async function getAllStrokes(parentId?: string): Promise<DrawingStroke[]> {
  const db = await getDB();
  if (parentId) {
    return db.getAllFromIndex('strokes', 'by-parent', parentId);
  }
  const all = await db.getAll('strokes');
  return all.filter(s => !s.parentId);
}

export async function saveConnection(conn: ConnectionData): Promise<void> {
  if (isCollabSessionId(conn.parentId)) return;
  const db = await getDB();
  await db.put('connections', conn);
}

export async function deleteConnection(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('connections', id);

  try {
    const { deleteCloudConnection } = await import('./syncService');
    await deleteCloudConnection(id);
  } catch (err) {
    console.error('Failed to sync delete connection to cloud:', err);
  }
}

export async function getAllConnections(parentId?: string): Promise<ConnectionData[]> {
  const db = await getDB();
  if (parentId) {
    return db.getAllFromIndex('connections', 'by-parent', parentId);
  }
  const all = await db.getAll('connections');
  return all.filter(c => !c.parentId);
}

export async function getAbsoluteAllObjects(): Promise<CanvasObjectData[]> {
  const db = await getDB();
  return db.getAll('objects');
}

export async function getAbsoluteAllStrokes(): Promise<DrawingStroke[]> {
  const db = await getDB();
  return db.getAll('strokes');
}

export async function getAbsoluteAllConnections(): Promise<ConnectionData[]> {
  const db = await getDB();
  return db.getAll('connections');
}


export async function saveCanvasState(state: CanvasState): Promise<void> {
  if (isCollabSessionId(state.id)) return;
  const db = await getDB();
  await db.put('canvas', state);
}

export async function getCanvasState(id: string = 'root'): Promise<CanvasState | undefined> {
  const db = await getDB();
  return db.get('canvas', id);
}

export async function getAllCanvasStates(): Promise<CanvasState[]> {
  const db = await getDB();
  const all = await db.getAll('canvas');
  return all.sort((a, b) => b.lastModified - a.lastModified);
}

/**
 * Only the real, top-level canvases — the ones the landing gallery should list.
 *
 * A binder / heading opens a canvas-inside-a-canvas whose own state is keyed by
 * the *object's* id (see InfiniteCanvas autosave, which persists the top of the
 * canvas stack). Those nested sub-spaces are legitimate (they hold the sub-space
 * camera + background) but they are NOT standalone canvases and must never show
 * up on the landing page as separate cards. We detect them structurally: a
 * canvas whose id is also an object id is a sub-space of that object. Reading
 * just the object *keys* keeps this cheap (no image data URLs are loaded), and
 * the structural test self-heals any duplicates already written to the DB.
 */
export async function getTopLevelCanvasStates(): Promise<CanvasState[]> {
  const db = await getDB();
  const [states, objectIds] = await Promise.all([
    db.getAll('canvas'),
    db.getAllKeys('objects'),
  ]);
  const nestedIds = new Set(objectIds as string[]);
  return states
    .filter((s) => !nestedIds.has(s.id))
    .sort((a, b) => b.lastModified - a.lastModified);
}

export async function updateCanvasTheme(id: string, themeColor: string): Promise<void> {
  const db = await getDB();
  const state = await db.get('canvas', id);
  if (state) {
    state.themeColor = themeColor;
    await db.put('canvas', state);
  }
}

/** Merge a partial patch (favorite/archive/delete/category/title/theme) into a canvas state. */
export async function updateCanvasMeta(id: string, patch: Partial<CanvasState>): Promise<void> {
  const db = await getDB();
  const state = await db.get('canvas', id);
  if (!state) return;
  await db.put('canvas', { ...state, ...patch, id });
}

/** Permanently remove a canvas and everything inside it. */
export async function deleteCanvasPermanently(id: string): Promise<void> {
  const db = await getDB();
  const [objs, strokes, conns] = await Promise.all([
    db.getAllFromIndex('objects', 'by-parent', id),
    db.getAllFromIndex('strokes', 'by-parent', id),
    db.getAllFromIndex('connections', 'by-parent', id),
  ]);

  const objTx = db.transaction('objects', 'readwrite');
  for (const o of objs) await objTx.store.delete(o.id);
  await objTx.done;

  const strokeTx = db.transaction('strokes', 'readwrite');
  for (const s of strokes) await strokeTx.store.delete(s.id);
  await strokeTx.done;

  const connTx = db.transaction('connections', 'readwrite');
  for (const c of conns) await connTx.store.delete(c.id);
  await connTx.done;

  await db.delete('canvas', id);

  try {
    const { deleteCloudCanvas } = await import('./syncService');
    await deleteCloudCanvas(id);
  } catch (err) {
    console.error('Failed to sync permanent canvas delete to cloud:', err);
  }
}

/** Deep-copy a canvas (state + objects + strokes + connections). Returns the new canvas id. */
export async function duplicateCanvas(id: string): Promise<string | null> {
  const db = await getDB();
  const state = await db.get('canvas', id);
  if (!state) return null;

  const newId = crypto.randomUUID();
  const now = Date.now();

  await db.put('canvas', {
    ...state,
    id: newId,
    title: `${state.title || 'untitled canvas'} copy`,
    lastModified: now,
    isFavorite: false,
    archived: false,
    deleted: false,
  });

  const [objs, strokes, conns] = await Promise.all([
    db.getAllFromIndex('objects', 'by-parent', id),
    db.getAllFromIndex('strokes', 'by-parent', id),
    db.getAllFromIndex('connections', 'by-parent', id),
  ]);

  // Objects get fresh ids; keep a map so connections can be re-pointed
  const idMap = new Map<string, string>();
  const objTx = db.transaction('objects', 'readwrite');
  for (const o of objs) {
    const freshId = crypto.randomUUID();
    idMap.set(o.id, freshId);
    await objTx.store.put({ ...o, id: freshId, parentId: newId, createdAt: now, updatedAt: now });
  }
  await objTx.done;

  const strokeTx = db.transaction('strokes', 'readwrite');
  for (const s of strokes) {
    await strokeTx.store.put({ ...s, id: crypto.randomUUID(), parentId: newId, createdAt: now });
  }
  await strokeTx.done;

  const connTx = db.transaction('connections', 'readwrite');
  for (const c of conns) {
    const fromId = idMap.get(c.fromId);
    const toId = idMap.get(c.toId);
    if (!fromId || !toId) continue;
    await connTx.store.put({ ...c, id: crypto.randomUUID(), parentId: newId, fromId, toId, createdAt: now });
  }
  await connTx.done;

  return newId;
}

export async function clearAll(): Promise<void> {
  const db = await getDB();
  await db.clear('objects');
  await db.clear('strokes');
  await db.clear('connections');
  await db.clear('canvas');
}

/* ------------------------------------------------------------------
   First-run content lives in lib/canvasTemplates.ts.

   What used to be here was `seedDatabaseIfEmpty` — seven canvases whose
   contents were loops writing "Brainstorm Idea #7" and "Thesis Idea #48"
   into 150 identical cards. It made the gallery look populated and taught
   a new user nothing, so it was removed rather than extended. Real,
   fully-built use-case canvases now come from `seedStarterCanvasesIfEmpty`.
   ------------------------------------------------------------------ */

/**
 * The ids of the retired demo canvases, plus the id prefix every object they
 * seeded still carries. Used by the one-time cleanup in canvasTemplates.ts to
 * remove a legacy board ONLY when the user never added anything to it.
 */
export const LEGACY_SEED_CANVASES: Array<{ id: string; objectPrefix: string }> = [
  { id: 'lovely-as-always', objectPrefix: 'lovely-' },
  { id: 'brand-directions', objectPrefix: 'brand-' },
  { id: 'essay-drafts', objectPrefix: 'essay-' },
  { id: 'trip-moodboard', objectPrefix: 'trip-' },
  { id: 'launch-plan-q3', objectPrefix: 'launch-' },
  { id: 'reading-list-2026', objectPrefix: 'reading-' },
  { id: 'thesis-notes', objectPrefix: 'thesis-' },
];
