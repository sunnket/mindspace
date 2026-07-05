import { supabase } from './supabaseClient';
import { CanvasState, CanvasObjectData, DrawingStroke, ConnectionData } from './db';
import { 
  saveCanvasState, 
  saveObjects, 
  saveStrokes, 
  saveConnection, 
  clearAll,
  getAllCanvasStates,
  getAllObjects,
  getAllStrokes,
  getAllConnections,
  getAbsoluteAllObjects,
  getAbsoluteAllStrokes,
  getAbsoluteAllConnections
} from './db';

/**
 * Pushes the active canvas state and all its items to the cloud.
 */
export async function syncCanvasToCloud(
  canvasId: string,
  userId: string,
  state: Partial<CanvasState>,
  objects: CanvasObjectData[],
  strokes: DrawingStroke[],
  connections: ConnectionData[]
) {
  try {
    // 1. Sync canvas state
    const { error: canvasErr } = await supabase.from('canvases').upsert({
      id: canvasId,
      user_id: userId,
      title: state.title || 'Untitled Canvas',
      theme_color: state.themeColor || '#FAF6F1',
      camera: state.camera || { x: 0, y: 0, zoom: 1 },
      checkpoint: state.checkpoint || null,
      last_modified: Date.now(),
      category: state.category || 'personal',
      is_favorite: state.isFavorite || false,
      archived: state.archived || false,
      deleted: state.deleted || false
    });

    if (canvasErr) throw canvasErr;

    // 2. Sync objects belonging to this canvas parent
    const canvasObjects = objects.filter(o => o.parentId === canvasId || (!o.parentId && canvasId === 'root'));
    if (canvasObjects.length > 0) {
      const mappedObjects = canvasObjects.map(o => ({
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
        updated_at: o.updatedAt || Date.now()
      }));

      const { error: objErr } = await supabase.from('canvas_objects').upsert(mappedObjects);
      if (objErr) throw objErr;
    }

    // 3. Sync strokes
    const canvasStrokes = strokes.filter(s => s.parentId === canvasId || (!s.parentId && canvasId === 'root'));
    if (canvasStrokes.length > 0) {
      const mappedStrokes = canvasStrokes.map(s => ({
        id: s.id,
        canvas_id: canvasId,
        user_id: userId,
        points: s.points,
        color: s.color,
        size: s.size,
        parent_id: s.parentId || null,
        is_highlighter: s.isHighlighter || false,
        created_at: s.createdAt
      }));

      const { error: strokeErr } = await supabase.from('drawing_strokes').upsert(mappedStrokes);
      if (strokeErr) throw strokeErr;
    }

    // 4. Sync connections
    const canvasConns = connections.filter(c => c.parentId === canvasId || (!c.parentId && canvasId === 'root'));
    if (canvasConns.length > 0) {
      const mappedConns = canvasConns.map(c => ({
        id: c.id,
        canvas_id: canvasId,
        user_id: userId,
        from_id: c.fromId,
        to_id: c.toId,
        parent_id: c.parentId || null,
        created_at: c.createdAt,
        style: c.style || {}
      }));

      const { error: connErr } = await supabase.from('connections').upsert(mappedConns);
      if (connErr) throw connErr;
    }
  } catch (err) {
    console.error('Error syncing canvas to cloud:', err);
  }
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

/**
 * Pulls all user data from Supabase and populates IndexedDB.
 * Returns true if successful and fetched new data.
 */
export async function pullCloudToLocal(userId: string): Promise<boolean> {
  try {
    // 1. Fetch from Supabase
    const [canvasesRes, objectsRes, strokesRes, connectionsRes] = await Promise.all([
      supabase.from('canvases').select('*').eq('user_id', userId),
      supabase.from('canvas_objects').select('*').eq('user_id', userId),
      supabase.from('drawing_strokes').select('*').eq('user_id', userId),
      supabase.from('connections').select('*').eq('user_id', userId)
    ]);

    if (canvasesRes.error) throw canvasesRes.error;
    if (objectsRes.error) throw objectsRes.error;
    if (strokesRes.error) throw strokesRes.error;
    if (connectionsRes.error) throw connectionsRes.error;

    // If user has no canvases in the cloud, return false (will fallback to guest or default schema)
    if (!canvasesRes.data || canvasesRes.data.length === 0) {
      return false;
    }

    // 2. Clear IndexedDB first to load fresh cloud user state
    await clearAll();

    // 3. Save to local IndexedDB
    for (const c of canvasesRes.data) {
      await saveCanvasState({
        id: c.id,
        title: c.title,
        themeColor: c.theme_color,
        camera: c.camera,
        checkpoint: c.checkpoint || undefined,
        lastModified: c.last_modified,
        category: c.category,
        isFavorite: c.is_favorite,
        archived: c.archived,
        deleted: c.deleted
      });
    }

    const localObjects: CanvasObjectData[] = (objectsRes.data || []).map(o => ({
      id: o.id,
      parentId: o.parent_id || undefined,
      type: o.type as any,
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
      updatedAt: o.updated_at
    }));
    await saveObjects(localObjects);

    for (const s of (strokesRes.data || [])) {
      await saveStrokes([{
        id: s.id,
        parentId: s.parent_id || undefined,
        points: s.points,
        color: s.color,
        size: s.size,
        isHighlighter: s.is_highlighter,
        createdAt: s.created_at
      }]);
    }

    for (const c of (connectionsRes.data || [])) {
      await saveConnection({
        id: c.id,
        parentId: c.parent_id || undefined,
        fromId: c.from_id,
        toId: c.to_id,
        createdAt: c.created_at,
        style: c.style
      });
    }

    return true;
  } catch (err) {
    console.error('Error pulling cloud data to local:', err);
    return false;
  }
}

/**
 * Migrates local offline guest data to the registered user's account.
 */
export async function migrateGuestData(userId: string) {
  try {
    const canvases = await getAllCanvasStates();
    const allObjects = await getAbsoluteAllObjects();
    const allStrokes = await getAbsoluteAllStrokes();
    const allConnections = await getAbsoluteAllConnections();

    // If there is no local data, don't migrate anything
    if (canvases.length === 0 && allObjects.length === 0 && allStrokes.length === 0 && allConnections.length === 0) {
      return;
    }

    // Ensure root canvas exists first to prevent foreign key errors on orphan items
    await supabase.from('canvases').upsert({
      id: 'root',
      user_id: userId,
      title: 'Home Workspace',
      theme_color: '#FAF6F1',
      camera: { x: 0, y: 0, zoom: 1 },
      last_modified: Date.now()
    });

    // 1. Sync canvases
    for (const c of canvases) {
      await supabase.from('canvases').upsert({
        id: c.id,
        user_id: userId,
        title: c.title || 'Untitled Canvas',
        theme_color: c.themeColor || '#FAF6F1',
        camera: c.camera,
        checkpoint: c.checkpoint || null,
        last_modified: c.lastModified,
        category: c.category,
        is_favorite: c.isFavorite,
        archived: c.archived,
        deleted: c.deleted
      });
    }

    // 2. Sync objects
    if (allObjects.length > 0) {
      const mappedObjects = allObjects.map(o => ({
        id: o.id,
        canvas_id: o.parentId || 'root',
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
        updated_at: o.updatedAt || Date.now()
      }));
      await supabase.from('canvas_objects').upsert(mappedObjects);
    }

    // 3. Sync strokes
    if (allStrokes.length > 0) {
      const mappedStrokes = allStrokes.map(s => ({
        id: s.id,
        canvas_id: s.parentId || 'root',
        user_id: userId,
        points: s.points,
        color: s.color,
        size: s.size,
        parent_id: s.parentId || null,
        is_highlighter: s.isHighlighter || false,
        created_at: s.createdAt
      }));
      await supabase.from('drawing_strokes').upsert(mappedStrokes);
    }

    // 4. Sync connections
    if (allConnections.length > 0) {
      const mappedConns = allConnections.map(c => ({
        id: c.id,
        canvas_id: c.parentId || 'root',
        user_id: userId,
        from_id: c.fromId,
        to_id: c.toId,
        parent_id: c.parentId || null,
        created_at: c.createdAt,
        style: c.style || {}
      }));
      await supabase.from('connections').upsert(mappedConns);
    }

    console.log('Successfully migrated guest data to account:', userId);
  } catch (err) {
    console.error('Failed to migrate guest data:', err);
  }
}
