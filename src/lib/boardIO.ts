import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData, DrawingStroke, ConnectionData, saveObjects, saveStrokes, saveConnection } from './db';

interface BoardExport {
  version: 1;
  exportedAt: string;
  objects: CanvasObjectData[];
  strokes: DrawingStroke[];
  connections: ConnectionData[];
}

export function exportBoard(filename = 'mindspace-board.json') {
  const state = useCanvasStore.getState();
  const data: BoardExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    objects: state.objects.filter((o) => !o.style?.isMinimized),
    strokes: state.strokes,
    connections: state.connections,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function parseBoardFile(text: string): BoardExport | null {
  try {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.objects) || !Array.isArray(data.strokes) || !Array.isArray(data.connections)) {
      return null;
    }
    return data as BoardExport;
  } catch {
    return null;
  }
}

/** Imports a previously-exported board, offsetting it so it lands beside existing content. */
export async function importBoard(file: File): Promise<{ ok: boolean; count: number }> {
  const text = await file.text();
  const data = parseBoardFile(text);
  if (!data) return { ok: false, count: 0 };

  const store = useCanvasStore.getState();
  const parentId = store.canvasStack.length > 0
    ? store.canvasStack[store.canvasStack.length - 1]
    : (store.urlCanvasId === 'root' ? undefined : store.urlCanvasId);

  const OFFSET = 60;
  const idMap = new Map<string, string>();
  const now = Date.now();

  const newObjects: CanvasObjectData[] = data.objects.map((o) => {
    const newId = crypto.randomUUID();
    idMap.set(o.id, newId);
    return { ...o, id: newId, parentId, x: o.x + OFFSET, y: o.y + OFFSET, createdAt: now, updatedAt: now };
  });

  const newStrokes: DrawingStroke[] = data.strokes.map((s) => ({
    ...s,
    id: crypto.randomUUID(),
    parentId,
    points: s.points.map(([x, y]) => [x + OFFSET, y + OFFSET]),
    createdAt: now,
  }));

  const newConnections: ConnectionData[] = data.connections
    .map((c): ConnectionData | null => {
      const fromId = idMap.get(c.fromId);
      const toId = idMap.get(c.toId);
      if (!fromId || !toId) return null;
      return { ...c, id: crypto.randomUUID(), parentId, fromId, toId, createdAt: now };
    })
    .filter((c): c is ConnectionData => c !== null);

  useCanvasStore.setState((s) => ({
    objects: [...s.objects, ...newObjects],
    strokes: [...s.strokes, ...newStrokes],
    connections: [...s.connections, ...newConnections],
    isDirty: true,
  }));

  await saveObjects(newObjects);
  await saveStrokes(newStrokes);
  for (const c of newConnections) await saveConnection(c);

  return { ok: true, count: newObjects.length };
}
