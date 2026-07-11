import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { CanvasObjectData, DrawingStroke, ConnectionData, Scene, CommentThread } from '@/lib/db';
import type { CanvasOp } from '@/lib/collab/types';
import { CanvasBackground, DEFAULT_BACKGROUND } from '@/lib/canvasTheme';

export type InteractionMode = 'select' | 'draw' | 'text' | 'pan' | 'connector' | 'shape' | 'arrow' | 'frame';

/* ------------------------------------------------------------------
   Collaboration bridge — inert unless a live session sets these.
   When solo, collabEmitter is null (no broadcast) and collabAuthor is
   null (objects are never author-stamped), so nothing changes.
   ------------------------------------------------------------------ */
let collabEmitter: ((op: CanvasOp) => void) | null = null;
let collabAuthor: { id: string; color: string } | null = null;

export function setCollabEmitter(fn: ((op: CanvasOp) => void) | null) {
  collabEmitter = fn;
}
export function setCollabAuthor(a: { id: string; color: string } | null) {
  collabAuthor = a;
}
function emitCollab(op: CanvasOp) {
  if (collabEmitter) collabEmitter(op);
}

/**
 * Whether an object may be auto-removed when its text content is blank.
 * Only plain text/heading/sticky and featureless cards qualify. A card with
 * ANY `is*` feature flag (isTodo, isPoll, isCountdown, isQuote, isLiveMetric,
 * future flags…) is a functional block and must never be auto-cleaned —
 * blocks store their data in style, not content, so "blank" means nothing.
 */
export function isAutoCleanable(o: CanvasObjectData): boolean {
  if (o.style?.isMinimized) return false;
  if (o.type === 'frame') return false;
  if (o.type === 'text' || o.type === 'heading' || o.type === 'sticky') return true;
  if (o.type === 'card') {
    const style = o.style || {};
    const hasFeatureFlag = Object.entries(style).some(
      ([k, v]) => /^is[A-Z]/.test(k) && Boolean(v)
    );
    return !hasFeatureFlag;
  }
  return false;
}

export interface UndoAction {
  type: 'add' | 'delete' | 'move' | 'edit' | 'stroke-add' | 'stroke-delete';
  objectId?: string;
  strokeId?: string;
  before?: Partial<CanvasObjectData> | null;
  after?: Partial<CanvasObjectData> | null;
  strokeData?: DrawingStroke;
  objectData?: CanvasObjectData;
}

interface CanvasStore {
  // Workspace metadata
  workspaceTitle: string;
  setWorkspaceTitle: (title: string) => void;
  urlCanvasId: string;
  setUrlCanvasId: (id: string) => void;
  
  // Canvas background / color mode (paper color + intensity, drives the theme)
  canvasBackground: CanvasBackground;
  setCanvasBackground: (bg: CanvasBackground) => void;

  // Camera state
  camera: { x: number; y: number; zoom: number };
  setCamera: (camera: { x: number; y: number; zoom: number }) => void;
  animateCamera: (target: { x: number; y: number; zoom: number }, duration?: number) => void;
  checkpoint: { x: number; y: number; zoom: number } | null;
  setCheckpoint: (checkpoint: { x: number; y: number; zoom: number } | null) => void;

  // Scenes (cinematic tours)
  scenes: Scene[];
  setScenes: (scenes: Scene[]) => void;
  addScene: (name?: string) => void;
  addSceneWithCamera: (name: string, camera: { x: number; y: number; zoom: number }, durationMs?: number, notes?: string) => void;
  removeScene: (id: string) => void;
  renameScene: (id: string, name: string) => void;
  moveScene: (id: string, dir: -1 | 1) => void;
  setSceneDuration: (id: string, durationMs: number) => void;
  isTouring: boolean;
  setTouring: (v: boolean) => void;

  // Margins (spatial comment threads)
  threads: CommentThread[];
  setThreads: (threads: CommentThread[]) => void;
  addThread: (anchor: CommentThread['anchor'], firstReply: { author: string; text: string }) => string;
  addReply: (threadId: string, reply: { author: string; text: string }) => void;
  resolveThread: (threadId: string, resolved: boolean) => void;
  deleteThread: (threadId: string) => void;
  moveThread: (threadId: string, x: number, y: number) => void;
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  commentMode: boolean;
  setCommentMode: (v: boolean) => void;
  threadsSidebarOpen: boolean;
  setThreadsSidebarOpen: (v: boolean) => void;

  // Objects
  objects: CanvasObjectData[];
  setObjects: (objects: CanvasObjectData[]) => void;
  addObject: (obj: Partial<CanvasObjectData>) => CanvasObjectData;
  updateObject: (id: string, updates: Partial<CanvasObjectData>) => void;
  removeObject: (id: string) => void;
  duplicateObject: (id: string) => CanvasObjectData | null;

  // Layer ordering (z-index)
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;

  // Minimize dock — slide any object into the corner shelf, drag it back out anywhere
  minimizeObject: (id: string) => void;
  restoreMinimized: (id: string, worldX: number, worldY: number) => void;

  // Warp — teleport an object to another canvas/board (changes its parentId,
  // persists under the new parent, and removes it from the current canvas).
  teleportObject: (id: string, targetParentId: string) => void;

  // Strokes
  strokes: DrawingStroke[];
  setStrokes: (strokes: DrawingStroke[]) => void;
  addStroke: (stroke: DrawingStroke) => void;
  removeStroke: (id: string) => void;

  // Collaboration — apply remote edits without re-broadcasting
  applyRemoteOp: (op: CanvasOp) => void;
  applyRemoteSnapshot: (
    objects: CanvasObjectData[],
    strokes: DrawingStroke[],
    connections: ConnectionData[]
  ) => void;
  
  // Selection
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  
  // Interaction mode
  mode: InteractionMode;
  setMode: (mode: InteractionMode) => void;
  previousMode: InteractionMode;
  setPreviousMode: (mode: InteractionMode) => void;
  
  // Focus mode
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  
  // Editing state (auto-focusing text)
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  editingCommentId: string | null;
  setEditingCommentId: (id: string | null) => void;
  
  // Nested canvas
  canvasStack: string[];
  pushCanvas: (id: string) => void;
  popCanvas: () => void;
  currentCanvasId: () => string | undefined;
  
  // Search
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  
  // Command palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // AI Agent state
  agentRunning: boolean;
  agentLogs: string[];
  agentStatus: 'idle' | 'running' | 'success' | 'failed';
  setAgentState: (state: Partial<{ agentRunning: boolean; agentLogs: string[]; agentStatus: 'idle' | 'running' | 'success' | 'failed' }>) => void;
  
  // Drawing settings
  drawColor: string;
  setDrawColor: (color: string) => void;
  drawSize: number;
  setDrawSize: (size: number) => void;
  eraserMode: boolean;
  setEraserMode: (on: boolean) => void;
  highlighterMode: boolean;
  setHighlighterMode: (on: boolean) => void;
  
  // Text settings
  textFont: string;
  setTextFont: (font: string) => void;
  textSize: number;
  setTextSize: (size: number) => void;
  
  // Undo/Redo
  undoStack: UndoAction[];
  redoStack: UndoAction[];
  pushUndo: (action: UndoAction) => void;
  undo: () => void;
  redo: () => void;
  
  // Save status
  isDirty: boolean;
  setDirty: (dirty: boolean) => void;
  lastSaved: number;
  setLastSaved: (time: number) => void;
  
  // Plus menu
  plusMenuPos: { x: number; y: number; isToolbar?: boolean } | null;
  setPlusMenuPos: (pos: { x: number; y: number; isToolbar?: boolean } | null) => void;
  
  // Slash menu
  slashMenu: { objectId: string; query: string; x: number; y: number } | null;
  setSlashMenu: (menu: { objectId: string; query: string; x: number; y: number } | null) => void;
  
  // Shape settings
  selectedShapeType: string;
  setSelectedShapeType: (type: string) => void;
  
  // Arrow settings
  selectedArrowPointerType: 'line' | 'arrow' | 'dot' | 'diamond';
  setSelectedArrowPointerType: (type: 'line' | 'arrow' | 'dot' | 'diamond') => void;

  // Default style applied to the NEXT arrow you draw (editable in the panel
  // while in arrow mode, before anything is on the canvas).
  arrowStyle: { color: string; thickness: number; dashStyle: string; pointerType: string };
  setArrowStyle: (patch: Partial<{ color: string; thickness: number; dashStyle: string; pointerType: string }>) => void;

  // Default style applied to the NEXT text block you create (editable in the
  // panel while in text mode, before clicking on the canvas).
  textStyle: {
    fontSize: number; fontFamily: string; fontWeight: number;
    textColor: string; bgColor: string; textAlign: string; headingLevel: string;
  };
  setTextStyle: (patch: Partial<{
    fontSize: number; fontFamily: string; fontWeight: number;
    textColor: string; bgColor: string; textAlign: string; headingLevel: string;
  }>) => void;
  
  // Max z-index tracker
  maxZIndex: number;
  getNextZIndex: () => number;

  // Trash pile animation
  trashItems: Array<{ 
    id: string; 
    label: string; 
    color?: string; 
    originX: number; 
    originY: number; 
    addedAt: number;
    objectData?: CanvasObjectData;
    connectionsData?: ConnectionData[];
  }>;
  addToTrash: (item: { 
    id: string; 
    label: string; 
    color?: string; 
    originX: number; 
    originY: number;
    objectData?: CanvasObjectData;
    connectionsData?: ConnectionData[];
  }) => void;
  clearOldTrash: () => void;
  restoreObject: (id: string) => void;
  deleteFromTrashPermanently: (id: string) => void;
  emptyTrash: () => void;

  // Connections
  connections: ConnectionData[];
  setConnections: (conns: ConnectionData[]) => void;
  addConnection: (fromId: string, toId: string, style?: Record<string, any>) => void;
  removeConnection: (id: string) => void;
  connectorSelectedIds: string[];
  toggleConnectorSelection: (id: string) => void;
  resetConnectorSelection: () => void;

  // Workflow settings
  activeWorkflowId: string | null;
  setActiveWorkflowId: (id: string | null) => void;
  layoutWorkflow: (workflowId: string, mode: 'horizontal' | 'vertical' | 'radial' | 'mindmap' | 'freeform') => void;
  recolorWorkflowGroup: (workflowId: string, updates: { color?: string; borderColor?: string; textColor?: string; branchColor?: string }) => void;
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  // Workspace metadata
  workspaceTitle: 'Untitled Canvas',
  setWorkspaceTitle: (workspaceTitle) => set({ workspaceTitle, isDirty: true }),
  urlCanvasId: 'root',
  setUrlCanvasId: (urlCanvasId) => set({ urlCanvasId }),

  // Canvas background / color mode
  canvasBackground: DEFAULT_BACKGROUND,
  setCanvasBackground: (canvasBackground) => set({ canvasBackground, isDirty: true }),

  // Camera
  camera: { x: 0, y: 0, zoom: 1 },
  setCamera: (camera) => set({ camera }),
  animateCamera: (target, duration = 1200) => {
    const start = { ...get().camera };
    const startTime = performance.now();
    
    const easeInOutCubic = (t: number) => 
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeInOutCubic(progress);
      
      const nextCamera = {
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        zoom: start.zoom + (target.zoom - start.zoom) * eased
      };
      
      set({ camera: nextCamera });
      
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };
    
    requestAnimationFrame(step);
  },
  
  // Checkpoint
  checkpoint: null,
  setCheckpoint: (checkpoint) => set({ checkpoint, isDirty: true }),

  // Scenes (cinematic tours) — persisted with the canvas state, sync via cloud
  scenes: [],
  setScenes: (scenes) => set({ scenes }),
  addScene: (name) => {
    const scenes = get().scenes;
    const scene: Scene = {
      id: uuidv4(),
      name: name?.trim() || `Scene ${scenes.length + 1}`,
      camera: { ...get().camera },
      order: scenes.length,
      durationMs: 1400,
    };
    set({ scenes: [...scenes, scene], isDirty: true });
  },
  addSceneWithCamera: (name, camera, durationMs, notes) => {
    const scenes = get().scenes;
    const scene: Scene = {
      id: uuidv4(),
      name: name?.trim() || `Scene ${scenes.length + 1}`,
      camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
      order: scenes.length,
      durationMs: durationMs && durationMs > 0 ? durationMs : 1400,
      notes: notes?.trim() || undefined,
    };
    set({ scenes: [...scenes, scene], isDirty: true });
  },
  removeScene: (id) =>
    set((state) => ({
      scenes: state.scenes.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })),
      isDirty: true,
    })),
  renameScene: (id, name) =>
    set((state) => ({
      scenes: state.scenes.map((s) => (s.id === id ? { ...s, name } : s)),
      isDirty: true,
    })),
  moveScene: (id, dir) =>
    set((state) => {
      const ordered = [...state.scenes].sort((a, b) => a.order - b.order);
      const idx = ordered.findIndex((s) => s.id === id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= ordered.length) return {};
      [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
      return { scenes: ordered.map((s, i) => ({ ...s, order: i })), isDirty: true };
    }),
  setSceneDuration: (id, durationMs) =>
    set((state) => ({
      scenes: state.scenes.map((s) => (s.id === id ? { ...s, durationMs } : s)),
      isDirty: true,
    })),
  isTouring: false,
  setTouring: (isTouring) => set({ isTouring }),

  // Margins (spatial comment threads) — persisted with the canvas state
  threads: [],
  setThreads: (threads) => set({ threads }),
  addThread: (anchor, firstReply) => {
    const id = uuidv4();
    const thread: CommentThread = {
      id,
      anchor,
      resolved: false,
      createdAt: Date.now(),
      replies: [{ id: uuidv4(), author: firstReply.author, text: firstReply.text, ts: Date.now() }],
    };
    set((state) => ({ threads: [...state.threads, thread], isDirty: true, activeThreadId: id }));
    return id;
  },
  addReply: (threadId, reply) =>
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId
          ? { ...t, replies: [...t.replies, { id: uuidv4(), author: reply.author, text: reply.text, ts: Date.now() }] }
          : t
      ),
      isDirty: true,
    })),
  resolveThread: (threadId, resolved) =>
    set((state) => ({
      threads: state.threads.map((t) => (t.id === threadId ? { ...t, resolved } : t)),
      isDirty: true,
    })),
  deleteThread: (threadId) =>
    set((state) => ({
      threads: state.threads.filter((t) => t.id !== threadId),
      activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
      isDirty: true,
    })),
  moveThread: (threadId, x, y) =>
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId && t.anchor.type === 'point' ? { ...t, anchor: { type: 'point', x, y } } : t
      ),
      isDirty: true,
    })),
  activeThreadId: null,
  setActiveThreadId: (activeThreadId) => set({ activeThreadId }),
  commentMode: false,
  setCommentMode: (commentMode) => set({ commentMode }),
  threadsSidebarOpen: false,
  setThreadsSidebarOpen: (threadsSidebarOpen) => set({ threadsSidebarOpen }),

  // Objects
  objects: [],
  setObjects: (objects) => {
    const uniqueObjects = Array.from(new Map(objects.map(o => [o.id, o])).values());
    const maxZ = uniqueObjects.reduce((max, o) => Math.max(max, o.zIndex || 0), 0);
    set({ objects: uniqueObjects, maxZIndex: maxZ });
  },
  addObject: (partial) => {
    // Auto-clean any other empty/blank inputs before adding the new one
    const state = get();
    const currentSelectedId = state.selectedId;
    const currentEditingId = state.editingId;
    const blankObjects = state.objects.filter(o => {
      if (o.id === currentSelectedId || o.id === currentEditingId) return false;
      return o.content.trim() === '' && isAutoCleanable(o);
    });
    blankObjects.forEach(o => state.removeObject(o.id));

    const newZIndex = get().maxZIndex + 1;
    // Guarantee unique ID
    const id = (partial.id && !get().objects.some(o => o.id === partial.id)) 
      ? partial.id 
      : uuidv4();

    const activeCanvasId = partial.parentId !== undefined
      ? partial.parentId
      : (get().canvasStack.length > 0 
         ? get().canvasStack[get().canvasStack.length - 1] 
         : (get().urlCanvasId === 'root' ? undefined : get().urlCanvasId));

    const obj: CanvasObjectData = {
      type: 'text',
      x: 0,
      y: 0,
      width: 900,
      height: 100,
      content: '',
      zIndex: newZIndex,
      parentId: activeCanvasId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      style: {
        fontFamily: get().textFont,
        fontSize: get().textSize,
        ...(partial.style || {}),
      },
      ...partial,
      id, // Override ID in case partial has a duplicate
    };

    // During a live session, stamp authorship so collaborators can be told apart.
    if (collabAuthor && obj.style && obj.style.authorId === undefined) {
      obj.style = { ...obj.style, authorId: collabAuthor.id, authorColor: collabAuthor.color };
    }

    set((state) => ({
      objects: [...state.objects.filter(o => o.id !== obj.id), obj],
      isDirty: true,
      maxZIndex: newZIndex,
      undoStack: [...state.undoStack, { type: 'add', objectId: obj.id, objectData: obj }],
      redoStack: [],
    }));
    emitCollab({ kind: 'add', object: obj });
    return obj;
  },
  updateObject: (id, updates) => {
    set((state) => {
      const obj = state.objects.find((o) => o.id === id);
      if (!obj) return {};

      const isWorkflowNode = obj.type === 'workflow-node' && obj.style?.workflowId;
      const hasPosUpdate = updates.x !== undefined || updates.y !== undefined;
      const shouldMoveWholeWorkflow = state.mode === 'pan';

      if (isWorkflowNode && hasPosUpdate && shouldMoveWholeWorkflow) {
        const workflowId = obj.style?.workflowId;
        const dx = updates.x !== undefined ? updates.x - obj.x : 0;
        const dy = updates.y !== undefined ? updates.y - obj.y : 0;

        if (dx === 0 && dy === 0) {
          return {
            objects: state.objects.map((o) =>
              o.id === id ? { ...o, ...updates, updatedAt: Date.now() } : o
            ),
            isDirty: true,
          };
        }

        return {
          objects: state.objects.map((o) => {
            if (o.style?.workflowId === workflowId && o.type === 'workflow-node') {
              const ox = o.id === id ? (updates.x ?? o.x) : (o.x + dx);
              const oy = o.id === id ? (updates.y ?? o.y) : (o.y + dy);
              return {
                ...o,
                x: ox,
                y: oy,
                updatedAt: Date.now(),
              };
            }
            return o;
          }),
          isDirty: true,
        };
      }

      return {
        objects: state.objects.map((o) =>
          o.id === id ? { ...o, ...updates, updatedAt: Date.now() } : o
        ),
        isDirty: true,
      };
    });
    emitCollab({ kind: 'update', id, updates });
  },
  removeObject: (id) => {
    const obj = get().objects.find(o => o.id === id);
    const relatedConns = get().connections.filter(c => c.fromId === id || c.toId === id);

    set((state) => ({
      objects: state.objects.filter((o) => o.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      connections: state.connections.filter(c => c.fromId !== id && c.toId !== id),
      isDirty: true,
      undoStack: obj ? [...state.undoStack, { type: 'delete', objectId: id, objectData: obj }] : state.undoStack,
      redoStack: [],
    }));
    emitCollab({ kind: 'remove', id });

    // Clean up in DB (both object and related connections)
    import('@/lib/db').then(({ deleteObject, deleteConnection }) => {
      deleteObject(id).catch(err => console.error('Failed to delete object from IndexedDB:', err));
      if (relatedConns.length > 0) {
        relatedConns.forEach(c => deleteConnection(c.id).catch(err => console.error('Failed to delete connection:', err)));
      }
    });
  },

  // Clone an object (offset a little so it's visible), give it a fresh id and the
  // top z-index, and select it. Arrows clone their start/end/bend geometry too.
  duplicateObject: (id) => {
    const src = get().objects.find((o) => o.id === id);
    if (!src) return null;
    const offset = 28;
    const clone: Partial<CanvasObjectData> = {
      ...src,
      id: uuidv4(),
      x: src.x + offset,
      y: src.y + offset,
      zIndex: get().getNextZIndex(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      style: src.style ? { ...src.style } : undefined,
    };
    if (src.type === 'arrow' && src.style) {
      clone.style = {
        ...clone.style,
        startX: (src.style.startX as number ?? 0) + offset,
        startY: (src.style.startY as number ?? 0) + offset,
        endX: (src.style.endX as number ?? 0) + offset,
        endY: (src.style.endY as number ?? 0) + offset,
        ...(src.style.bendX !== undefined
          ? { bendX: (src.style.bendX as number) + offset, bendY: (src.style.bendY as number ?? 0) + offset }
          : {}),
      };
    }
    const created = get().addObject(clone);
    set({ selectedId: created.id });
    return created;
  },

  // Layer ordering — nudge one step, or jump to the very front/back.
  bringToFront: (id) => {
    const next = get().getNextZIndex();
    get().updateObject(id, { zIndex: next });
  },
  sendToBack: (id) => {
    const minZ = get().objects.reduce((m, o) => Math.min(m, o.zIndex ?? 0), 0);
    get().updateObject(id, { zIndex: minZ - 1 });
  },
  bringForward: (id) => {
    const obj = get().objects.find((o) => o.id === id);
    if (!obj) return;
    get().updateObject(id, { zIndex: (obj.zIndex ?? 0) + 1 });
    set((s) => ({ maxZIndex: Math.max(s.maxZIndex, (obj.zIndex ?? 0) + 1) }));
  },
  sendBackward: (id) => {
    const obj = get().objects.find((o) => o.id === id);
    if (!obj) return;
    get().updateObject(id, { zIndex: (obj.zIndex ?? 0) - 1 });
  },

  minimizeObject: (id) => {
    const obj = get().objects.find((o) => o.id === id);
    if (!obj) return;
    get().updateObject(id, {
      style: {
        ...obj.style,
        isMinimized: true,
        minimizedAt: Date.now(),
        preMinimizeWidth: obj.width,
        preMinimizeHeight: obj.height,
      },
    });
    if (get().selectedId === id) set({ selectedId: null });
    if (get().editingId === id) set({ editingId: null });
  },

  restoreMinimized: (id, worldX, worldY) => {
    const obj = get().objects.find((o) => o.id === id);
    if (!obj) return;
    const width = (obj.style?.preMinimizeWidth as number) || obj.width;
    const height = (obj.style?.preMinimizeHeight as number) || obj.height;
    get().updateObject(id, {
      x: worldX - width / 2,
      y: worldY - height / 2,
      width,
      height,
      zIndex: get().getNextZIndex(),
      style: { ...obj.style, isMinimized: false },
    });
  },

  teleportObject: (id, targetParentId) => {
    const obj = get().objects.find((o) => o.id === id);
    if (!obj) return;

    // 'root' means the top-level board (objects there carry no parentId).
    const newParent = targetParentId === 'root' ? undefined : targetParentId;
    const relatedConns = get().connections.filter((c) => c.fromId === id || c.toId === id);

    // The object keeps its id; only its parentId changes, so the single DB
    // record is re-homed under the target canvas (no duplication). It reappears
    // when that canvas is opened.
    const moved: CanvasObjectData = {
      ...obj,
      parentId: newParent,
      style: { ...obj.style, frameParentId: undefined, isMinimized: false },
      updatedAt: Date.now(),
    };

    set((state) => ({
      objects: state.objects.filter((o) => o.id !== id),
      connections: state.connections.filter((c) => c.fromId !== id && c.toId !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      editingId: state.editingId === id ? null : state.editingId,
      isDirty: true,
    }));
    emitCollab({ kind: 'remove', id });

    import('@/lib/db').then(({ saveObject, deleteConnection }) => {
      saveObject(moved).catch((err) => console.error('Failed to persist teleported object:', err));
      relatedConns.forEach((c) =>
        deleteConnection(c.id).catch((err) => console.error('Failed to delete connection:', err))
      );
    });
  },

  // Strokes
  strokes: [],
  setStrokes: (strokes) => set({ strokes }),
  addStroke: (stroke) => {
    const activeCanvasId = stroke.parentId !== undefined
      ? stroke.parentId
      : (get().canvasStack.length > 0 
         ? get().canvasStack[get().canvasStack.length - 1] 
         : (get().urlCanvasId === 'root' ? undefined : get().urlCanvasId));

    const strokeWithParent = {
      ...stroke,
      parentId: activeCanvasId
    };

    set((state) => ({
      strokes: [...state.strokes, strokeWithParent],
      isDirty: true,
      undoStack: [...state.undoStack, { type: 'stroke-add', strokeId: stroke.id, strokeData: strokeWithParent }],
      redoStack: [],
    }));
    emitCollab({ kind: 'stroke-add', stroke: strokeWithParent });
  },
  removeStroke: (id) => {
    const stroke = get().strokes.find(s => s.id === id);
    set((state) => ({
      strokes: state.strokes.filter((s) => s.id !== id),
      isDirty: true,
      undoStack: stroke ? [...state.undoStack, { type: 'stroke-delete', strokeId: id, strokeData: stroke }] : state.undoStack,
      redoStack: [],
    }));
    emitCollab({ kind: 'stroke-remove', id });
  },

  // Collaboration — apply an incoming edit locally. Re-parents to the viewer's
  // current canvas so it persists and reloads correctly, and never re-broadcasts.
  applyRemoteOp: (op) => {
    const stack = get().canvasStack;
    const pid = stack.length > 0 ? stack[stack.length - 1] : get().urlCanvasId;
    const localParent = pid === 'root' ? undefined : pid;

    switch (op.kind) {
      case 'add': {
        const obj = { ...op.object, parentId: localParent };
        set((state) => ({
          objects: [...state.objects.filter((o) => o.id !== obj.id), obj],
          isDirty: true,
          maxZIndex: Math.max(state.maxZIndex, obj.zIndex || 0),
        }));
        import('@/lib/db').then(({ saveObject }) => saveObject(obj));
        break;
      }
      case 'update': {
        set((state) => ({
          objects: state.objects.map((o) =>
            o.id === op.id ? { ...o, ...op.updates, updatedAt: Date.now() } : o
          ),
          isDirty: true,
        }));
        const updated = get().objects.find((o) => o.id === op.id);
        if (updated) import('@/lib/db').then(({ saveObject }) => saveObject(updated));
        break;
      }
      case 'remove': {
        set((state) => ({
          objects: state.objects.filter((o) => o.id !== op.id),
          connections: state.connections.filter((c) => c.fromId !== op.id && c.toId !== op.id),
          selectedId: state.selectedId === op.id ? null : state.selectedId,
          isDirty: true,
        }));
        import('@/lib/db').then(({ deleteObject }) => deleteObject(op.id));
        break;
      }
      case 'stroke-add': {
        const stroke = { ...op.stroke, parentId: localParent };
        set((state) => ({
          strokes: [...state.strokes.filter((s) => s.id !== stroke.id), stroke],
          isDirty: true,
        }));
        import('@/lib/db').then(({ saveStroke }) => saveStroke(stroke));
        break;
      }
      case 'stroke-remove': {
        set((state) => ({ strokes: state.strokes.filter((s) => s.id !== op.id), isDirty: true }));
        import('@/lib/db').then(({ deleteStroke }) => deleteStroke(op.id));
        break;
      }
      case 'connection-add': {
        const conn = { ...op.connection, parentId: localParent };
        set((state) => ({
          connections: [...state.connections.filter((c) => c.id !== conn.id), conn],
          isDirty: true,
        }));
        import('@/lib/db').then(({ saveConnection }) => saveConnection(conn));
        break;
      }
      case 'connection-remove': {
        set((state) => ({ connections: state.connections.filter((c) => c.id !== op.id), isDirty: true }));
        import('@/lib/db').then(({ deleteConnection }) => deleteConnection(op.id));
        break;
      }
    }
  },

  applyRemoteSnapshot: (objects, strokes, connections) => {
    const stack = get().canvasStack;
    const pid = stack.length > 0 ? stack[stack.length - 1] : get().urlCanvasId;
    const localParent = pid === 'root' ? undefined : pid;

    const reObjects = objects.map((o) => ({ ...o, parentId: localParent }));
    const reStrokes = strokes.map((s) => ({ ...s, parentId: localParent }));
    const reConnections = connections.map((c) => ({ ...c, parentId: localParent }));

    const maxZ = reObjects.reduce((m, o) => Math.max(m, o.zIndex || 0), get().maxZIndex);
    set({ objects: reObjects, strokes: reStrokes, connections: reConnections, maxZIndex: maxZ, isDirty: true });

    import('@/lib/db').then(({ saveObjects, saveStrokes, saveConnection }) => {
      saveObjects(reObjects);
      saveStrokes(reStrokes);
      reConnections.forEach((c) => saveConnection(c));
    });
  },

  // Selection
  selectedId: null,
  setSelectedId: (id) => {
    // Clean up empty objects, except the one that is being newly selected, currently edited, or was just selected/edited
    const state = get();
    const currentEditingId = state.editingId;
    const currentSelectedId = state.selectedId;
    const blankObjects = state.objects.filter(o => {
      if (o.id === id || o.id === currentEditingId || o.id === currentSelectedId) return false;
      return o.content.trim() === '' && isAutoCleanable(o);
    });

    blankObjects.forEach(o => state.removeObject(o.id));
    set({ selectedId: id });
  },
  
  // Interaction mode
  mode: 'select',
  setMode: (mode) => set({ mode }),
  previousMode: 'select',
  setPreviousMode: (mode) => set({ previousMode: mode }),
  
  // Focus mode
  focusedId: null,
  setFocusedId: (id) => set({ focusedId: id }),
  
  // Editing state
  editingId: null,
  setEditingId: (id) => {
    // Clean up empty objects, except the one that is being newly edited, currently selected, or was just selected/edited
    const state = get();
    const currentSelectedId = state.selectedId;
    const currentEditingId = state.editingId;
    const blankObjects = state.objects.filter(o => {
      if (o.id === id || o.id === currentSelectedId || o.id === currentEditingId) return false;
      return o.content.trim() === '' && isAutoCleanable(o);
    });

    blankObjects.forEach(o => state.removeObject(o.id));
    set({ editingId: id });
  },
  editingCommentId: null,
  setEditingCommentId: (id) => set({ editingCommentId: id }),
  
  // Nested canvas
  canvasStack: [],
  pushCanvas: (id) => set((state) => ({ canvasStack: [...state.canvasStack, id] })),
  popCanvas: () => set((state) => ({ canvasStack: state.canvasStack.slice(0, -1) })),
  currentCanvasId: () => {
    const stack = get().canvasStack;
    return stack.length > 0 ? stack[stack.length - 1] : undefined;
  },
  
  // Search
  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),
  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),
  
  // Command palette
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  // AI Agent state
  agentRunning: false,
  agentLogs: [],
  agentStatus: 'idle',
  setAgentState: (state) => set((prev) => ({ ...prev, ...state })),
  
  // Drawing settings
  drawColor: '#2d2d2d',
  setDrawColor: (color) => set({ drawColor: color }),
  drawSize: 4,
  setDrawSize: (size) => set({ drawSize: size }),
  eraserMode: false,
  setEraserMode: (on) => set((state) => ({ eraserMode: on, highlighterMode: on ? false : state.highlighterMode })),
  highlighterMode: false,
  setHighlighterMode: (on) => set((state) => ({ highlighterMode: on, eraserMode: on ? false : state.eraserMode })),
  
  // Text settings
  textFont: "'Inter', sans-serif",
  setTextFont: (font) => set({ textFont: font }),
  textSize: 15,
  setTextSize: (size) => set({ textSize: size }),
  
  // Undo/Redo
  undoStack: [],
  redoStack: [],
  pushUndo: (action) => set((state) => ({
    undoStack: [...state.undoStack, action],
    redoStack: [],
  })),
  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const action = state.undoStack[state.undoStack.length - 1];
    const newUndoStack = state.undoStack.slice(0, -1);
    
    switch (action.type) {
      case 'add':
        if (action.objectId) {
          set({
            objects: state.objects.filter(o => o.id !== action.objectId),
            undoStack: newUndoStack,
            redoStack: [...state.redoStack, action],
            isDirty: true,
          });
        }
        break;
      case 'delete':
        const objToRestore = action.objectData;
        if (objToRestore) {
          set({
            objects: [...state.objects.filter(o => o.id !== objToRestore.id), objToRestore],
            undoStack: newUndoStack,
            redoStack: [...state.redoStack, action],
            isDirty: true,
          });
        }
        break;
      case 'move':
      case 'edit':
        if (action.objectId && action.before) {
          set({
            objects: state.objects.map(o =>
              o.id === action.objectId ? { ...o, ...action.before, updatedAt: Date.now() } : o
            ),
            undoStack: newUndoStack,
            redoStack: [...state.redoStack, action],
            isDirty: true,
          });
        }
        break;
      case 'stroke-add':
        if (action.strokeId) {
          set({
            strokes: state.strokes.filter(s => s.id !== action.strokeId),
            undoStack: newUndoStack,
            redoStack: [...state.redoStack, action],
            isDirty: true,
          });
        }
        break;
      case 'stroke-delete':
        if (action.strokeData) {
          set({
            strokes: [...state.strokes, action.strokeData],
            undoStack: newUndoStack,
            redoStack: [...state.redoStack, action],
            isDirty: true,
          });
        }
        break;
    }
  },
  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const action = state.redoStack[state.redoStack.length - 1];
    const newRedoStack = state.redoStack.slice(0, -1);
    
    switch (action.type) {
      case 'add':
        const objToAdd = action.objectData;
        if (objToAdd) {
          set({
            objects: [...state.objects.filter(o => o.id !== objToAdd.id), objToAdd],
            undoStack: [...state.undoStack, action],
            redoStack: newRedoStack,
            isDirty: true,
          });
        }
        break;
      case 'delete':
        if (action.objectId) {
          set({
            objects: state.objects.filter(o => o.id !== action.objectId),
            undoStack: [...state.undoStack, action],
            redoStack: newRedoStack,
            isDirty: true,
          });
        }
        break;
      case 'move':
      case 'edit':
        if (action.objectId && action.after) {
          set({
            objects: state.objects.map(o =>
              o.id === action.objectId ? { ...o, ...action.after, updatedAt: Date.now() } : o
            ),
            undoStack: [...state.undoStack, action],
            redoStack: newRedoStack,
            isDirty: true,
          });
        }
        break;
      case 'stroke-add':
        if (action.strokeData) {
          set({
            strokes: [...state.strokes, action.strokeData],
            undoStack: [...state.undoStack, action],
            redoStack: newRedoStack,
            isDirty: true,
          });
        }
        break;
      case 'stroke-delete':
        if (action.strokeId) {
          set({
            strokes: state.strokes.filter(s => s.id !== action.strokeId),
            undoStack: [...state.undoStack, action],
            redoStack: newRedoStack,
            isDirty: true,
          });
        }
        break;
    }
  },
  
  // Save status
  isDirty: false,
  setDirty: (dirty) => set({ isDirty: dirty }),
  lastSaved: 0,
  setLastSaved: (time) => set({ lastSaved: time }),
  
  // Plus menu
  plusMenuPos: null,
  setPlusMenuPos: (pos) => set({ plusMenuPos: pos }),
  
  // Slash menu
  slashMenu: null,
  setSlashMenu: (menu) => set({ slashMenu: menu }),
  
  // Shape settings
  selectedShapeType: 'square' as any,
  setSelectedShapeType: (selectedShapeType) => set({ selectedShapeType }),
  
  // Arrow settings
  selectedArrowPointerType: 'line',
  setSelectedArrowPointerType: (selectedArrowPointerType) => set({ selectedArrowPointerType }),

  arrowStyle: { color: '#2D2A26', thickness: 3, dashStyle: 'solid', pointerType: 'arrow' },
  setArrowStyle: (patch) => set((s) => ({ arrowStyle: { ...s.arrowStyle, ...patch } })),

  textStyle: {
    fontSize: 15, fontFamily: "'Outfit', sans-serif", fontWeight: 400,
    textColor: '#F4EFE8', bgColor: 'transparent', textAlign: 'left', headingLevel: 'body',
  },
  setTextStyle: (patch) => set((s) => ({ textStyle: { ...s.textStyle, ...patch } })),
  
  // Max z-index
  maxZIndex: 0,
  getNextZIndex: () => {
    const next = get().maxZIndex + 1;
    set({ maxZIndex: next });
    return next;
  },

  // Trash pile
  trashItems: [],
  addToTrash: (item) => {
    const entry = { ...item, addedAt: Date.now() };
    set((state) => ({ 
      trashItems: [...state.trashItems.filter((t) => t.id !== item.id), entry] 
    }));
  },
  clearOldTrash: () => {
    // Keep items for up to 30 minutes
    const cutoff = Date.now() - 30 * 60_000;
    set((state) => ({ trashItems: state.trashItems.filter((t) => t.addedAt > cutoff) }));
  },
  restoreObject: (id) => {
    const item = get().trashItems.find((t) => t.id === id);
    if (!item || !item.objectData) return;

    set((state) => {
      const newObjects = [...state.objects.filter(o => o.id !== item.objectData!.id), item.objectData!];
      const newConnections = [...state.connections];
      if (item.connectionsData) {
        item.connectionsData.forEach((conn) => {
          if (!newConnections.some((c) => c.id === conn.id)) {
            newConnections.push(conn);
          }
        });
      }
      return {
        objects: newObjects,
        connections: newConnections,
        trashItems: state.trashItems.filter((t) => t.id !== id),
        isDirty: true,
      };
    });

    // Save restored object and connections to IndexedDB
    import('@/lib/db').then(({ saveObject, saveConnection }) => {
      saveObject(item.objectData!);
      if (item.connectionsData) {
        item.connectionsData.forEach((conn) => saveConnection(conn));
      }
    });
  },
  deleteFromTrashPermanently: (id) => {
    set((state) => ({
      trashItems: state.trashItems.filter((t) => t.id !== id),
    }));
    import('@/lib/db').then(({ deleteObject }) => {
      deleteObject(id);
    });
  },
  emptyTrash: () => {
    const items = get().trashItems;
    import('@/lib/db').then(({ deleteObject }) => {
      items.forEach((item) => deleteObject(item.id));
    });
    set({ trashItems: [] });
  },

  // Connections
  connections: [],
  setConnections: (connections) => {
    const uniqueConnections = Array.from(new Map(connections.map(c => [c.id, c])).values());
    set({ connections: uniqueConnections });
  },
  addConnection: (fromId, toId, style) => {
    const activeCanvasId = get().canvasStack.length > 0 
      ? get().canvasStack[get().canvasStack.length - 1] 
      : (get().urlCanvasId === 'root' ? undefined : get().urlCanvasId);

    const newConn: ConnectionData = {
      id: uuidv4(),
      fromId,
      toId,
      parentId: activeCanvasId,
      createdAt: Date.now(),
      style,
    };
    set((state) => ({ connections: [...state.connections, newConn], isDirty: true }));
    emitCollab({ kind: 'connection-add', connection: newConn });
    // Save to DB
    import('@/lib/db').then(({ saveConnection }) => saveConnection(newConn));
  },
  removeConnection: (id) => {
    set((state) => ({ connections: state.connections.filter(c => c.id !== id), isDirty: true }));
    emitCollab({ kind: 'connection-remove', id });
    // Delete from DB
    import('@/lib/db').then(({ deleteConnection }) => deleteConnection(id));
  },
  connectorSelectedIds: [],
  toggleConnectorSelection: (id) => {
    const current = get().connectorSelectedIds;
    if (current.includes(id)) {
      set({ connectorSelectedIds: current.filter(x => x !== id) });
    } else {
      const next = [...current, id];
      if (next.length === 2) {
        // Connect them!
        get().addConnection(next[0], next[1]);
        set({ connectorSelectedIds: [] }); // Reset selection after connecting
        console.log('Connected objects:', next[0], next[1]);
      } else {
        set({ connectorSelectedIds: next });
      }
    }
  },
  resetConnectorSelection: () => set({ connectorSelectedIds: [] }),

  // Workflow settings
  activeWorkflowId: null,
  setActiveWorkflowId: (activeWorkflowId) => set({ activeWorkflowId }),
  recolorWorkflowGroup: (workflowId, updates) => {
    set((state) => ({
      objects: state.objects.map((o) => {
        if (o.type === 'workflow-node' && o.style?.workflowId === workflowId) {
          return {
            ...o,
            style: {
              ...o.style,
              ...updates,
            },
          };
        }
        return o;
      }),
      isDirty: true,
    }));
  },
  layoutWorkflow: (workflowId, mode) => {
    const state = get();
    const workflowNodes = state.objects.filter(
      (o) => o.type === 'workflow-node' && o.style?.workflowId === workflowId
    );
    if (workflowNodes.length === 0) return;

    const nodeIds = new Set(workflowNodes.map((n) => n.id));
    const workflowConns = state.connections.filter(
      (c) => nodeIds.has(c.fromId) && nodeIds.has(c.toId)
    );

    const minX = Math.min(...workflowNodes.map((n) => n.x));
    const minY = Math.min(...workflowNodes.map((n) => n.y));
    const maxX = Math.max(...workflowNodes.map((n) => n.x + n.width));
    const maxY = Math.max(...workflowNodes.map((n) => n.y + n.height));
    const originalCenterX = (minX + maxX) / 2;
    const originalCenterY = (minY + maxY) / 2;

    if (mode === 'freeform') return;

    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    workflowNodes.forEach((n) => {
      incoming.set(n.id, []);
      outgoing.set(n.id, []);
    });
    workflowConns.forEach((c) => {
      outgoing.get(c.fromId)?.push(c.toId);
      incoming.get(c.toId)?.push(c.fromId);
    });

    const roots = workflowNodes.filter((n) => (incoming.get(n.id)?.length || 0) === 0);
    if (roots.length === 0 && workflowNodes.length > 0) {
      roots.push(workflowNodes[0]);
    }

    const levels = new Map<string, number>();
    const queue: { id: string; level: number }[] = [];
    roots.forEach((r) => {
      queue.push({ id: r.id, level: 0 });
      levels.set(r.id, 0);
    });

    while (queue.length > 0) {
      const { id, level } = queue.shift()!;
      const children = outgoing.get(id) || [];
      children.forEach((childId) => {
        const currentLevel = levels.get(childId) ?? -1;
        if (level + 1 > currentLevel) {
          if (level + 1 > workflowNodes.length) {
            // Cycle detected: halt traversal along this path to avoid an infinite loop
            return;
          }
          levels.set(childId, level + 1);
          queue.push({ id: childId, level: level + 1 });
        }
      });
    }

    workflowNodes.forEach((n) => {
      if (!levels.has(n.id)) {
        levels.set(n.id, 0);
      }
    });

    const levelGroups = new Map<number, string[]>();
    levels.forEach((level, id) => {
      if (!levelGroups.has(level)) {
        levelGroups.set(level, []);
      }
      levelGroups.get(level)!.push(id);
    });

    const newPositions = new Map<string, { x: number; y: number }>();

    if (mode === 'horizontal') {
      const colWidth = 240;
      const rowHeight = 160;
      levelGroups.forEach((ids, lvl) => {
        const x = lvl * colWidth;
        const count = ids.length;
        ids.forEach((id, idx) => {
          const y = (idx - (count - 1) / 2) * rowHeight;
          newPositions.set(id, { x, y });
        });
      });
    } else if (mode === 'vertical') {
      const colWidth = 220;
      const rowHeight = 200;
      levelGroups.forEach((ids, lvl) => {
        const y = lvl * rowHeight;
        const count = ids.length;
        ids.forEach((id, idx) => {
          const x = (idx - (count - 1) / 2) * colWidth;
          newPositions.set(id, { x, y });
        });
      });
    } else if (mode === 'radial') {
      const radiusStep = 250;
      roots.forEach((r) => {
        newPositions.set(r.id, { x: 0, y: 0 });
      });
      levelGroups.forEach((ids, lvl) => {
        if (lvl === 0) return;
        const radius = lvl * radiusStep;
        const count = ids.length;
        ids.forEach((id, idx) => {
          const angle = (idx / count) * 2 * Math.PI;
          const x = radius * Math.cos(angle);
          const y = radius * Math.sin(angle);
          newPositions.set(id, { x, y });
        });
      });
    } else if (mode === 'mindmap') {
      const colWidth = 240;
      const rowHeight = 160;

      const side = new Map<string, 'left' | 'right'>();
      const rootId = roots[0]?.id;

      if (rootId) {
        newPositions.set(rootId, { x: 0, y: 0 });
        const rootChildren = outgoing.get(rootId) || [];
        rootChildren.forEach((childId, idx) => {
          const s = idx % 2 === 0 ? 'right' : 'left';
          side.set(childId, s);

          const stack = [childId];
          while (stack.length > 0) {
            const curr = stack.pop()!;
            const currSide = side.get(curr) || 'right';
            const currChildren = outgoing.get(curr) || [];
            currChildren.forEach((cId) => {
              if (!side.has(cId)) {
                side.set(cId, currSide);
                stack.push(cId);
              }
            });
          }
        });
      }

      const leftGroups = new Map<number, string[]>();
      const rightGroups = new Map<number, string[]>();

      levels.forEach((level, id) => {
        if (id === rootId) return;
        const s = side.get(id) || 'right';
        if (s === 'left') {
          if (!leftGroups.has(level)) leftGroups.set(level, []);
          leftGroups.get(level)!.push(id);
        } else {
          if (!rightGroups.has(level)) rightGroups.set(level, []);
          rightGroups.get(level)!.push(id);
        }
      });

      leftGroups.forEach((ids, lvl) => {
        const x = -lvl * colWidth;
        const count = ids.length;
        ids.forEach((id, idx) => {
          const y = (idx - (count - 1) / 2) * rowHeight;
          newPositions.set(id, { x, y });
        });
      });

      rightGroups.forEach((ids, lvl) => {
        const x = lvl * colWidth;
        const count = ids.length;
        ids.forEach((id, idx) => {
          const y = (idx - (count - 1) / 2) * rowHeight;
          newPositions.set(id, { x, y });
        });
      });
    }

    const newCoords = Array.from(newPositions.values());
    if (newCoords.length === 0) return;

    const newMinX = Math.min(...newCoords.map((c) => c.x));
    const newMinY = Math.min(...newCoords.map((c) => c.y));
    const newMaxX = Math.max(...newCoords.map((c) => c.x + 150));
    const newMaxY = Math.max(...newCoords.map((c) => c.y + 150));
    const newCenterX = (newMinX + newMaxX) / 2;
    const newCenterY = (newMinY + newMaxY) / 2;

    const finalOffsetX = originalCenterX - newCenterX;
    const finalOffsetY = originalCenterY - newCenterY;

    set((state) => ({
      objects: state.objects.map((o) => {
        const newPos = newPositions.get(o.id);
        if (newPos) {
          return {
            ...o,
            x: newPos.x + finalOffsetX,
            y: newPos.y + finalOffsetY,
            updatedAt: Date.now(),
          };
        }
        return o;
      }),
      isDirty: true,
    }));
  },
}));
