import { CanvasObjectData, DrawingStroke, ConnectionData, getAllObjects, getAllStrokes, getAllConnections } from './db';

interface BoardExport {
  version: 1;
  exportedAt: string;
  objects: CanvasObjectData[];
  strokes: DrawingStroke[];
  connections: ConnectionData[];
}

function slugify(title: string): string {
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'untitled-canvas';
}

function downloadJson(data: unknown, filename: string) {
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

/** Downloads any canvas (not necessarily the one currently open) as a portable .json file. */
export async function exportBoardById(canvasId: string, title: string) {
  const parentId = canvasId === 'root' ? undefined : canvasId;
  const [objects, strokes, connections] = await Promise.all([
    getAllObjects(parentId),
    getAllStrokes(parentId),
    getAllConnections(parentId),
  ]);

  const data: BoardExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    objects: objects.filter((o) => !o.style?.isMinimized),
    strokes,
    connections,
  };

  downloadJson(data, `${slugify(title)}.json`);
}
