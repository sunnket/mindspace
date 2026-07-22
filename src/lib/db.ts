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
  type: 'text' | 'sticky' | 'image' | 'drawing' | 'card' | 'heading' | 'shape' | 'arrow' | 'workflow-node' | 'frame' | 'browser' | 'mirror';
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

export async function seedDatabaseIfEmpty(): Promise<void> {
  const db = await getDB();
  const existing = await db.getAll('canvas');
  if (existing.length > 0) return;

  const now = Date.now();
  
  // 1. Canvas States
  const seedCanvases: CanvasState[] = [
    {
      id: 'lovely-as-always',
      title: 'lovely as always',
      themeColor: '#FAF6F1',
      camera: { x: 0, y: 0, zoom: 1 },
      lastModified: now - 19000, // 19s ago
      category: 'personal'
    },
    {
      id: 'brand-directions',
      title: 'brand directions',
      themeColor: '#FAF6F1',
      camera: { x: 0, y: 0, zoom: 1 },
      lastModified: now - 2 * 60 * 60 * 1000, // 2h ago
      category: 'work'
    },
    {
      id: 'essay-drafts',
      title: 'essay drafts',
      themeColor: '#FAF6F1',
      camera: { x: 0, y: 0, zoom: 1 },
      lastModified: now - 24 * 60 * 60 * 1000, // yesterday
      category: 'study'
    },
    {
      id: 'trip-moodboard',
      title: 'trip moodboard',
      themeColor: '#FAF6F1',
      camera: { x: 0, y: 0, zoom: 1 },
      lastModified: now - 3 * 24 * 60 * 60 * 1000, // 3 days ago
      category: 'personal'
    },
    {
      id: 'launch-plan-q3',
      title: 'launch plan q3',
      themeColor: '#FAF6F1',
      camera: { x: 0, y: 0, zoom: 1 },
      lastModified: now - 4 * 24 * 60 * 60 * 1000, // 4 days ago
      category: 'work'
    },
    {
      id: 'reading-list-2026',
      title: 'reading list 2026',
      themeColor: '#FAF6F1',
      camera: { x: 0, y: 0, zoom: 1 },
      lastModified: now - 7 * 24 * 60 * 60 * 1000, // 1 week ago
      category: 'study'
    },
    {
      id: 'thesis-notes',
      title: 'thesis notes',
      themeColor: '#FAF6F1',
      camera: { x: 0, y: 0, zoom: 1 },
      lastModified: now - 14 * 24 * 60 * 60 * 1000, // 2 weeks ago
      category: 'work'
    }
  ];

  // Save Canvas States
  for (const c of seedCanvases) {
    await db.put('canvas', c);
  }

  // 2. Canvas Objects (Nodes) for "lovely as always"
  const lovelyObjects: CanvasObjectData[] = [
    {
      id: 'lovely-n1',
      parentId: 'lovely-as-always',
      type: 'card',
      x: 100,
      y: 120,
      width: 140,
      height: 60,
      content: 'project north star',
      zIndex: 1,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'lovely-n2',
      parentId: 'lovely-as-always',
      type: 'shape',
      x: 290,
      y: 80,
      width: 100,
      height: 40,
      content: 'research',
      zIndex: 2,
      createdAt: now,
      updatedAt: now,
      style: {
        shapeType: 'pill',
        color: '#E8A97B', // orange-ish theme background
        borderColor: '#C97B4B',
        textColor: '#FFFFFF'
      }
    },
    {
      id: 'lovely-n3',
      parentId: 'lovely-as-always',
      type: 'card',
      x: 100,
      y: 220,
      width: 140,
      height: 60,
      content: 'user persona',
      zIndex: 3,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'lovely-n4',
      parentId: 'lovely-as-always',
      type: 'card',
      x: 290,
      y: 190,
      width: 140,
      height: 60,
      content: 'competitor scan',
      zIndex: 4,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'lovely-n5',
      parentId: 'lovely-as-always',
      type: 'shape',
      x: 140,
      y: 320,
      width: 110,
      height: 50,
      content: '!! ship by 30',
      zIndex: 5,
      createdAt: now,
      updatedAt: now,
      style: {
        shapeType: 'pill',
        color: '#E8A97B',
        borderColor: '#C97B4B',
        textColor: '#FFFFFF'
      }
    },
    {
      id: 'lovely-n6',
      parentId: 'lovely-as-always',
      type: 'card',
      x: 290,
      y: 290,
      width: 140,
      height: 60,
      content: 'pricing matrix',
      zIndex: 6,
      createdAt: now,
      updatedAt: now
    }
  ];

  // We add some extra nodes to lovelyObjects to sum up to 23 cards for a rich look
  for (let i = 7; i <= 23; i++) {
    lovelyObjects.push({
      id: `lovely-n${i}`,
      parentId: 'lovely-as-always',
      type: 'card',
      x: 500 + (i % 4) * 180,
      y: 100 + Math.floor(i / 4) * 120,
      width: 150,
      height: 80,
      content: `Brainstorm Idea #${i - 6}\nDetail or note related to this card.`,
      zIndex: i,
      createdAt: now,
      updatedAt: now
    });
  }

  for (const obj of lovelyObjects) {
    await db.put('objects', obj);
  }

  // Add 4 sketches (DrawingStrokes) to "lovely as always"
  for (let i = 1; i <= 4; i++) {
    await db.put('strokes', {
      id: `lovely-s${i}`,
      parentId: 'lovely-as-always',
      points: [[200 + i * 20, 200], [210 + i * 20, 205], [220 + i * 20, 215]],
      color: '#C97B4B',
      size: 3,
      createdAt: now
    });
  }

  // Add 2 threads (connections)
  const lovelyConnections: ConnectionData[] = [
    {
      id: 'lovely-c1',
      fromId: 'lovely-n1',
      toId: 'lovely-n2',
      parentId: 'lovely-as-always',
      createdAt: now
    },
    {
      id: 'lovely-c2',
      fromId: 'lovely-n3',
      toId: 'lovely-n4',
      parentId: 'lovely-as-always',
      createdAt: now
    },
    {
      id: 'lovely-c3',
      fromId: 'lovely-n4',
      toId: 'lovely-n6',
      parentId: 'lovely-as-always',
      createdAt: now
    },
    {
      id: 'lovely-c4',
      fromId: 'lovely-n5',
      toId: 'lovely-n6',
      parentId: 'lovely-as-always',
      createdAt: now
    }
  ];
  for (const conn of lovelyConnections) {
    await db.put('connections', conn);
  }

  // 3. brand directions
  // Add 3 ovals and a timeline
  const brandObjects: CanvasObjectData[] = [
    {
      id: 'brand-n1',
      parentId: 'brand-directions',
      type: 'shape',
      x: 100,
      y: 100,
      width: 100,
      height: 60,
      content: 'Vision',
      zIndex: 1,
      createdAt: now,
      updatedAt: now,
      style: { shapeType: 'oval', color: '#FAF6F1', borderColor: '#C97B4B' }
    },
    {
      id: 'brand-n2',
      parentId: 'brand-directions',
      type: 'shape',
      x: 230,
      y: 100,
      width: 100,
      height: 60,
      content: 'Values',
      zIndex: 2,
      createdAt: now,
      updatedAt: now,
      style: { shapeType: 'oval', color: '#FAF6F1', borderColor: '#C97B4B' }
    },
    {
      id: 'brand-n3',
      parentId: 'brand-directions',
      type: 'shape',
      x: 360,
      y: 100,
      width: 100,
      height: 60,
      content: 'Goals',
      zIndex: 3,
      createdAt: now,
      updatedAt: now,
      style: { shapeType: 'oval', color: '#FAF6F1', borderColor: '#C97B4B' }
    }
  ];
  for (let i = 4; i <= 14; i++) {
    brandObjects.push({
      id: `brand-n${i}`,
      parentId: 'brand-directions',
      type: 'card',
      x: 100 + (i % 3) * 160,
      y: 220 + Math.floor(i / 3) * 100,
      width: 130,
      height: 70,
      content: `Idea ${i}`,
      zIndex: i,
      createdAt: now,
      updatedAt: now
    });
  }
  for (const obj of brandObjects) {
    await db.put('objects', obj);
  }
  // timeline line as drawing stroke
  await db.put('strokes', {
    id: 'brand-s1',
    parentId: 'brand-directions',
    points: [[80, 180], [480, 180]],
    color: '#C97B4B',
    size: 2,
    createdAt: now
  });
  for (let i = 2; i <= 8; i++) {
    await db.put('strokes', {
      id: `brand-s${i}`,
      parentId: 'brand-directions',
      points: [[100 * i, 170], [100 * i, 190]],
      color: '#C97B4B',
      size: 2,
      createdAt: now
    });
  }

  // 4. essay drafts
  const essayObjects: CanvasObjectData[] = [];
  for (let i = 1; i <= 8; i++) {
    essayObjects.push({
      id: `essay-n${i}`,
      parentId: 'essay-drafts',
      type: 'card',
      x: 100 + (i % 2) * 260,
      y: 100 + Math.floor(i / 2) * 140,
      width: 220,
      height: 100,
      content: `Draft paragraph #${i}\nHere is some writing representing research text and reflections for the essay.`,
      zIndex: i,
      createdAt: now,
      updatedAt: now
    });
  }
  for (const obj of essayObjects) {
    await db.put('objects', obj);
  }

  // 5. trip moodboard
  const tripObjects: CanvasObjectData[] = [];
  // 4 color cards (blocks)
  const tripColors = ['#FFF8DC', '#FFE4E6', '#E0F2FE', '#DCFCE7'];
  const tripTitles = ['Hotel Vibe', 'Flight Cost', 'Spots to Visit', 'Packing List'];
  for (let i = 0; i < 4; i++) {
    tripObjects.push({
      id: `trip-n${i+1}`,
      parentId: 'trip-moodboard',
      type: 'sticky',
      x: 100 + i * 160,
      y: 100,
      width: 140,
      height: 120,
      content: `${tripTitles[i]}\nImportant sticky notes for the trip!`,
      zIndex: i + 1,
      createdAt: now,
      updatedAt: now,
      style: { color: tripColors[i] }
    });
  }
  for (let i = 5; i <= 19; i++) {
    tripObjects.push({
      id: `trip-n${i}`,
      parentId: 'trip-moodboard',
      type: 'card',
      x: 100 + (i % 4) * 180,
      y: 260 + Math.floor(i / 4) * 110,
      width: 150,
      height: 80,
      content: `Spot ${i - 4}\nDescription`,
      zIndex: i,
      createdAt: now,
      updatedAt: now
    });
  }
  for (const obj of tripObjects) {
    await db.put('objects', obj);
  }

  // 6. launch plan q3
  const launchObjects: CanvasObjectData[] = [];
  for (let i = 1; i <= 12; i++) {
    launchObjects.push({
      id: `launch-n${i}`,
      parentId: 'launch-plan-q3',
      type: 'workflow-node',
      x: 100 + (i - 1) * 220,
      y: 150 + (i % 2 === 0 ? 60 : 0),
      width: 160,
      height: 60,
      content: `Launch Stage ${i}`,
      zIndex: i,
      createdAt: now,
      updatedAt: now,
      style: {
        isWorkflowNode: true,
        workflowId: 'launch-wf',
        nodeShape: 'pill',
        color: '#FAF6F1',
        borderColor: '#C97B4B',
        textColor: '#2D2A26',
        branchColor: '#C97B4B'
      }
    });
  }
  for (const obj of launchObjects) {
    await db.put('objects', obj);
  }

  // 7. reading list 2026
  const readingObjects: CanvasObjectData[] = [];
  const booksList = ['Atomic Habits', 'Clean Code', 'Design Systems Handbook', 'Refactoring', 'Sapiens', 'Educated', 'Dune', 'Deep Work', 'The Hobbit', 'Zero to One'];
  for (let i = 1; i <= 31; i++) {
    readingObjects.push({
      id: `reading-n${i}`,
      parentId: 'reading-list-2026',
      type: 'card',
      x: 100 + (i % 4) * 180,
      y: 100 + Math.floor(i / 4) * 120,
      width: 150,
      height: 90,
      content: `Book #${i}: ${booksList[i % booksList.length]}\nStatus: ${i % 3 === 0 ? 'Completed' : i % 3 === 1 ? 'Reading' : 'To Read'}`,
      zIndex: i,
      createdAt: now,
      updatedAt: now
    });
  }
  for (const obj of readingObjects) {
    await db.put('objects', obj);
  }

  // 8. thesis notes
  const thesisObjects: CanvasObjectData[] = [];
  for (let i = 1; i <= 48; i++) {
    thesisObjects.push({
      id: `thesis-n${i}`,
      parentId: 'thesis-notes',
      type: 'card',
      x: 100 + (i % 6) * 170,
      y: 100 + Math.floor(i / 6) * 110,
      width: 140,
      height: 80,
      content: `Thesis Idea #${i}\nResearch topic and citations here.`,
      zIndex: i,
      createdAt: now,
      updatedAt: now
    });
  }
  for (const obj of thesisObjects) {
    await db.put('objects', obj);
  }
}
