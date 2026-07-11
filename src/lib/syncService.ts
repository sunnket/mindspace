import { supabase } from './supabaseClient';
import { CanvasState, CanvasObjectData, DrawingStroke, ConnectionData, COLLAB_SESSION_ID_PREFIX } from './db';
import {
  saveCanvasState,
  saveObjects,
  saveStrokes,
  saveConnection,
  getAllCanvasStates,
  getAbsoluteAllObjects,
  getAbsoluteAllStrokes,
  getAbsoluteAllConnections,
} from './db';

/**
 * Cloud persistence discipline
 * ----------------------------
 * Local IndexedDB is the source of truth on-device and is ALWAYS written first
 * (by the caller). The cloud is a self-healing mirror: every requested sync
 * coalesces into a single "latest state" that is guaranteed to eventually land,
 * even across throttling, overlap, oversized rows, and transient failures. It
 * never silently drops the final state, and pulling never destroys local work.
 */
const CLOUD_SYNC_MIN_INTERVAL_MS = 3_500;
const MAX_BACKOFF_MS = 60_000;
const UPSERT_CHUNK = 40;

/* ---------------- resilient upsert ----------------
   Chunk writes so a big canvas isn't one giant request, and if a chunk fails
   (one oversized image data-URL, a bad row) fall back to per-row upserts so the
   good rows still land instead of the whole batch being lost. */
async function upsertResilient(table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase.from(table).upsert(chunk);
    if (error) {
      for (const row of chunk) {
        const { error: rowErr } = await supabase.from(table).upsert(row);
        if (rowErr) console.error(`[sync] ${table} row ${String(row.id)} skipped: ${rowErr.message}`);
      }
    }
  }
}

function mapObject(o: CanvasObjectData, canvasId: string, userId: string) {
  return {
    id: o.id,
    canvas_id: canvasId,
    user_id: userId,
    type: o.type,
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    content: o.content,
    style: o.style || {},
    z_index: o.zIndex || 1,
    parent_id: o.parentId || null,
    rotation: o.rotation || 0,
    locked: o.locked || false,
    created_at: o.createdAt,
    updated_at: o.updatedAt || Date.now(),
  };
}
function mapStroke(s: DrawingStroke, canvasId: string, userId: string) {
  return {
    id: s.id,
    canvas_id: canvasId,
    user_id: userId,
    points: s.points,
    color: s.color,
    size: s.size,
    parent_id: s.parentId || null,
    is_highlighter: s.isHighlighter || false,
    created_at: s.createdAt,
  };
}
function mapConnection(c: ConnectionData, canvasId: string, userId: string) {
  return {
    id: c.id,
    canvas_id: canvasId,
    user_id: userId,
    from_id: c.fromId,
    to_id: c.toId,
    parent_id: c.parentId || null,
    created_at: c.createdAt,
    style: c.style || {},
  };
}

/** Upsert a canvas row. scenes/threads/background are newer columns — if they
 *  don't exist yet, retry with the base columns so the canvas still saves. */
async function upsertCanvasRow(state: Partial<CanvasState>, canvasId: string, userId: string) {
  const base: Record<string, unknown> = {
    id: canvasId,
    user_id: userId,
    title: state.title || 'Untitled Canvas',
    theme_color: state.themeColor || '#FAF6F1',
    camera: state.camera || { x: 0, y: 0, zoom: 1 },
    checkpoint: state.checkpoint || null,
    last_modified: state.lastModified || Date.now(),
    category: state.category || 'personal',
    is_favorite: state.isFavorite || false,
    archived: state.archived || false,
    deleted: state.deleted || false,
  };
  const extended = {
    ...base,
    scenes: state.scenes || [],
    threads: state.threads || [],
    background: state.background || null,
  };
  let { error } = await supabase.from('canvases').upsert(extended);
  if (error) {
    // Extra columns may not exist in this project's schema yet — save the rest.
    ({ error } = await supabase.from('canvases').upsert(base));
    if (error) throw error;
  }
}

/* ---------------- self-healing flush ---------------- */
interface Payload {
  canvasId: string;
  userId: string;
  state: Partial<CanvasState>;
  objects: CanvasObjectData[];
  strokes: DrawingStroke[];
  connections: ConnectionData[];
}
let inFlight = false;
let lastAt = 0;
let failures = 0;
let pending: Payload | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function doUpsert(p: Payload): Promise<void> {
  const belongs = (parentId?: string) => parentId === p.canvasId || (!parentId && p.canvasId === 'root');

  await upsertCanvasRow(p.state, p.canvasId, p.userId);

  const objs = p.objects.filter((o) => belongs(o.parentId)).map((o) => mapObject(o, p.canvasId, p.userId));
  if (objs.length) await upsertResilient('canvas_objects', objs);

  const strokes = p.strokes.filter((s) => belongs(s.parentId)).map((s) => mapStroke(s, p.canvasId, p.userId));
  if (strokes.length) await upsertResilient('drawing_strokes', strokes);

  const conns = p.connections.filter((c) => belongs(c.parentId)).map((c) => mapConnection(c, p.canvasId, p.userId));
  if (conns.length) await upsertResilient('connections', conns);
}

function schedule() {
  if (timer || inFlight) return;
  const delay = failures > 0 ? Math.min(MAX_BACKOFF_MS, CLOUD_SYNC_MIN_INTERVAL_MS * 2 ** failures) : CLOUD_SYNC_MIN_INTERVAL_MS;
  const wait = Math.max(0, delay - (Date.now() - lastAt));
  timer = setTimeout(() => {
    timer = null;
    void flushNow();
  }, wait);
}

async function flushNow(): Promise<void> {
  if (inFlight || !pending) return;
  inFlight = true;
  lastAt = Date.now();
  const p = pending;
  pending = null; // consume; edits arriving mid-upload re-arm `pending`
  try {
    await doUpsert(p);
    failures = 0;
  } catch (err) {
    failures++;
    console.error('[sync] cloud flush failed (will retry):', err);
    if (!pending) pending = p; // nothing newer queued — retry this exact state
  } finally {
    inFlight = false;
    if (pending) schedule();
  }
}

/**
 * Request a cloud sync of the given canvas. Coalesces rapid calls into one
 * "latest state" flush, spaced by the throttle, and guarantees the final state
 * lands (retry with backoff on failure). Returns immediately — the caller's
 * local save is what marks work "saved"; the cloud converges in the background.
 */
export async function syncCanvasToCloud(
  canvasId: string,
  userId: string,
  state: Partial<CanvasState>,
  objects: CanvasObjectData[],
  strokes: DrawingStroke[],
  connections: ConnectionData[],
  opts?: { force?: boolean }
) {
  if (canvasId.startsWith(COLLAB_SESSION_ID_PREFIX)) return; // never sync a guest's ephemeral session view to their own cloud
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return; // guests stay 100% local

  pending = { canvasId, userId, state, objects, strokes, connections };

  if (opts?.force) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await flushNow();
    return;
  }
  schedule();
}

/**
 * Handles deletes in Supabase when elements are deleted locally.
 */
export async function deleteCloudObject(id: string) {
  const session = await supabase.auth.getSession();
  if (!session.data.session) return;
  await supabase.from('canvas_objects').delete().eq('id', id);
}

export async function deleteCloudStroke(id: string) {
  const session = await supabase.auth.getSession();
  if (!session.data.session) return;
  await supabase.from('drawing_strokes').delete().eq('id', id);
}

export async function deleteCloudConnection(id: string) {
  const session = await supabase.auth.getSession();
  if (!session.data.session) return;
  await supabase.from('connections').delete().eq('id', id);
}

export async function deleteCloudCanvas(id: string) {
  const session = await supabase.auth.getSession();
  if (!session.data.session) return;
  await supabase.from('canvases').delete().eq('id', id);
}

function cloudToObject(o: Record<string, any>): CanvasObjectData {
  return {
    id: o.id,
    parentId: o.parent_id || undefined,
    type: o.type,
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    content: o.content || '',
    style: o.style,
    zIndex: o.z_index,
    rotation: o.rotation || undefined,
    locked: o.locked,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

/**
 * Pulls all of a user's cloud data into IndexedDB and MERGES it with whatever
 * is already local — it never clears local storage. Cloud wins only when it is
 * as-new-or-newer (by updated_at / last_modified); local-only items and any
 * local-only fields (scenes, comment threads, background) are preserved so
 * un-synced offline edits are never destroyed. Returns true if the cloud had
 * any canvases for this user.
 */
export async function pullCloudToLocal(userId: string): Promise<boolean> {
  try {
    const [canvasesRes, objectsRes, strokesRes, connectionsRes] = await Promise.all([
      supabase.from('canvases').select('*').eq('user_id', userId),
      supabase.from('canvas_objects').select('*').eq('user_id', userId),
      supabase.from('drawing_strokes').select('*').eq('user_id', userId),
      supabase.from('connections').select('*').eq('user_id', userId),
    ]);

    if (canvasesRes.error) throw canvasesRes.error;
    if (objectsRes.error) throw objectsRes.error;
    if (strokesRes.error) throw strokesRes.error;
    if (connectionsRes.error) throw connectionsRes.error;

    if (!canvasesRes.data || canvasesRes.data.length === 0) return false;

    // Canvases — merge, keeping newer local and preserving local-only fields.
    const localCanvases = new Map((await getAllCanvasStates()).map((c) => [c.id, c]));
    for (const c of canvasesRes.data) {
      const local = localCanvases.get(c.id);
      if (local && (local.lastModified ?? 0) > (c.last_modified ?? 0)) continue; // local newer — keep
      await saveCanvasState({
        id: c.id,
        title: c.title,
        themeColor: c.theme_color,
        camera: c.camera,
        checkpoint: c.checkpoint ?? local?.checkpoint ?? undefined,
        background: c.background ?? local?.background,
        scenes: c.scenes ?? local?.scenes ?? [],
        threads: c.threads ?? local?.threads ?? [],
        lastModified: c.last_modified,
        category: c.category,
        isFavorite: c.is_favorite,
        archived: c.archived,
        deleted: c.deleted,
      });
    }

    // Objects — merge by updated_at; keep local-only and newer-local objects.
    const localObjects = new Map((await getAbsoluteAllObjects()).map((o) => [o.id, o]));
    const objectsToSave: CanvasObjectData[] = [];
    for (const o of objectsRes.data || []) {
      const local = localObjects.get(o.id);
      if (local && (local.updatedAt ?? 0) > (o.updated_at ?? 0)) continue;
      objectsToSave.push(cloudToObject(o));
    }
    if (objectsToSave.length) await saveObjects(objectsToSave);

    // Strokes — immutable; add cloud-only ones.
    const localStrokeIds = new Set((await getAbsoluteAllStrokes()).map((s) => s.id));
    const strokesToSave = (strokesRes.data || [])
      .filter((s) => !localStrokeIds.has(s.id))
      .map((s) => ({
        id: s.id,
        parentId: s.parent_id || undefined,
        points: s.points,
        color: s.color,
        size: s.size,
        isHighlighter: s.is_highlighter,
        createdAt: s.created_at,
      }));
    if (strokesToSave.length) await saveStrokes(strokesToSave);

    // Connections — add cloud-only ones.
    const localConnIds = new Set((await getAbsoluteAllConnections()).map((c) => c.id));
    for (const c of connectionsRes.data || []) {
      if (localConnIds.has(c.id)) continue;
      await saveConnection({
        id: c.id,
        parentId: c.parent_id || undefined,
        fromId: c.from_id,
        toId: c.to_id,
        createdAt: c.created_at,
        style: c.style,
      });
    }

    return true;
  } catch (err) {
    console.error('Error pulling cloud data to local:', err);
    return false;
  }
}

/**
 * Pushes EVERY local canvas + all its items to the cloud (all parents), used to
 * migrate guest work into a fresh account and as a final flush before logout so
 * nothing local is lost when IndexedDB is cleared. Resilient to oversized rows.
 */
export async function pushAllLocalToCloud(userId: string) {
  try {
    const canvases = await getAllCanvasStates();
    const allObjects = await getAbsoluteAllObjects();
    const allStrokes = await getAbsoluteAllStrokes();
    const allConnections = await getAbsoluteAllConnections();

    if (canvases.length === 0 && allObjects.length === 0 && allStrokes.length === 0 && allConnections.length === 0) {
      return;
    }

    // Ensure the root canvas exists first so orphan items never hit an FK error.
    await upsertCanvasRow({ title: 'Home Workspace', camera: { x: 0, y: 0, zoom: 1 }, lastModified: Date.now() }, 'root', userId);

    for (const c of canvases) {
      await upsertCanvasRow({ ...c }, c.id, userId);
    }

    if (allObjects.length > 0) {
      await upsertResilient('canvas_objects', allObjects.map((o) => mapObject(o, o.parentId || 'root', userId)));
    }
    if (allStrokes.length > 0) {
      await upsertResilient('drawing_strokes', allStrokes.map((s) => mapStroke(s, s.parentId || 'root', userId)));
    }
    if (allConnections.length > 0) {
      await upsertResilient('connections', allConnections.map((c) => mapConnection(c, c.parentId || 'root', userId)));
    }
  } catch (err) {
    console.error('Failed to push local data to cloud:', err);
  }
}

/**
 * Migrates local offline guest data to the registered user's account.
 * (Same operation as a full push — kept as a named export for clarity.)
 */
export async function migrateGuestData(userId: string) {
  await pushAllLocalToCloud(userId);
  console.log('Migrated local data to account:', userId);
}
