import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { CanvasObjectData, DrawingStroke, ConnectionData, Scene, CommentThread, SkyState } from '@/lib/db';
import type { CanvasOp } from '@/lib/collab/types';
import { CanvasBackground, DEFAULT_BACKGROUND } from '@/lib/canvasTheme';
import type { RelaxEffectId } from '@/lib/relaxEffects';
import { CanvasSkillset, emptySkillset, makeRule, getPreset, installPreset } from '@/lib/skillset';
import { cameraForRect, objectsInFrame, strokesInFrame, type FrameKind } from '@/lib/frames';
import { isStackable, stackIdOf, membersOf, stackSlots } from '@/lib/stacks';
import { sameLink } from '@/lib/constellations';
import {
  BrainstormTool,
  DEFAULT_PIN_COLOR,
  DEFAULT_CLIP_COLOR,
  DEFAULT_THREAD_COLOR,
  PIN_SIZE,
} from '@/lib/brainstorm';

export type InteractionMode = 'select' | 'draw' | 'text' | 'pan' | 'connector' | 'shape' | 'arrow' | 'frame' | 'relax' | 'brainstorm';

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
 * The canvas level the user is currently looking at — the `parentId` that its
 * objects carry.
 *
 * Two things decide it and BOTH matter: a nested space pushes onto canvasStack,
 * and the board itself is identified by urlCanvasId. Only the root board has
 * objects with no parent, so deriving this from the stack alone silently
 * reports "root" for every real canvas — and any filter built on it returns
 * nothing at all. That is exactly how the minimap ended up drawing an empty
 * board. One definition, so the two halves can't drift apart again.
 */
export function resolveParentId(canvasStack: string[], urlCanvasId: string): string | undefined {
  if (canvasStack.length > 0) return canvasStack[canvasStack.length - 1];
  return urlCanvasId === 'root' ? undefined : urlCanvasId;
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
  type: 'add' | 'delete' | 'move' | 'edit' | 'stroke-add' | 'stroke-delete' | 'bulk-delete';
  objectId?: string;
  strokeId?: string;
  before?: Partial<CanvasObjectData> | null;
  after?: Partial<CanvasObjectData> | null;
  strokeData?: DrawingStroke;
  objectData?: CanvasObjectData;
  /** bulk-delete: everything a delete frame swept, restored as one undo. */
  objectsData?: CanvasObjectData[];
  strokesData?: DrawingStroke[];
  connectionsData?: ConnectionData[];
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

  // Constellation View — a user-composed star map (see lib/constellations +
  // SkyState). Open/closed is view state; the star arrangement itself persists.
  constellationOpen: boolean;
  setConstellationOpen: (v: boolean) => void;
  sky: SkyState;
  /** Replace the sky without marking dirty — used when loading a canvas. */
  setSky: (sky: SkyState) => void;
  /** Move a star to a new spot in the sky (your arrangement). */
  moveSkyStar: (id: string, x: number, y: number) => void;
  /** Name (or clear the name of) a single star. */
  nameSkyStar: (id: string, name: string) => void;
  /** Wire two stars together / pull the wire out. */
  addSkyLink: (a: string, b: string) => void;
  removeSkyLink: (a: string, b: string) => void;
  /** Name a constellation, keyed by its connected-component anchor id. */
  nameSkyConstellation: (anchor: string, name: string) => void;

  // Scenes (cinematic tours)
  scenes: Scene[];
  setScenes: (scenes: Scene[]) => void;
  addScene: (name?: string) => void;
  addSceneWithCamera: (name: string, camera: { x: number; y: number; zoom: number }, durationMs?: number, notes?: string) => void;
  /** Turn a `scene`-kind frame into a slide (or refresh the one it already owns). */
  addSceneFromFrame: (frameId: string) => void;
  /** Create/refresh a slide for every scene frame on this canvas, in reading order. */
  syncSceneFrames: () => number;
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

  // Skill Set (per-canvas agent rules)
  skillset: CanvasSkillset | null;
  /** Replace the skill set without marking dirty — used when loading a canvas. */
  setSkillset: (s: CanvasSkillset | null) => void;
  toggleSkillsetEnabled: () => void;
  setSkillsetPersona: (text: string) => void;
  addSkillRule: (text?: string) => void;
  updateSkillRule: (id: string, text: string) => void;
  toggleSkillRule: (id: string) => void;
  removeSkillRule: (id: string) => void;
  installSkillPreset: (presetId: string) => void;
  clearSkillset: () => void;
  skillSetPanelOpen: boolean;
  /** The Plugins dropdown, opened from the canvas-title header. */
  pluginsPanelOpen: boolean;
  setPluginsPanelOpen: (v: boolean) => void;
  setSkillSetPanelOpen: (v: boolean) => void;

  // Objects
  objects: CanvasObjectData[];
  setObjects: (objects: CanvasObjectData[]) => void;
  addObject: (obj: Partial<CanvasObjectData>) => CanvasObjectData;
  updateObject: (id: string, updates: Partial<CanvasObjectData>) => void;
  removeObject: (id: string) => void;
  duplicateObject: (id: string) => CanvasObjectData | null;
  /** Sweep everything a delete-frame captures, minus anything the user tapped
   *  to spare. One undo entry puts it all back. */
  deleteRegion: (frameId: string, opts?: { keepFrame?: boolean; spare?: string[] }) => number;
  /** Which kind of frame the frame tool will place next. */
  frameDraftKind: FrameKind;
  setFrameDraftKind: (kind: FrameKind) => void;

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

  /* Stacks — piles you make by dropping a note onto another note.
     `spreadStackId` is the one pile currently bloomed open. It is VIEW state,
     not board state: it never persists, never syncs to collaborators, and
     never reaches an export, because which pile you happen to have open is
     about you, not about the board. */
  spreadStackId: string | null;
  setSpreadStack: (stackId: string | null) => void;
  /** Drop `dragId` onto `targetId` and pile them (joining an existing pile). */
  stackObjects: (dragId: string, targetId: string) => void;
  /** Pull one card out of its pile and drop it at `x`/`y` as its own block. */
  unstackObject: (id: string, x: number, y: number) => void;
  /** Deal an entire pile back out onto the board as loose cards. */
  scatterStack: (stackId: string) => void;


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

  /* Singularity Search — the cinematic black-hole search overlay. Matches from
     this canvas and every other one are pulled in and clustered around a core.
     `pendingFocusId` is set right before navigating to another canvas so the
     board it lands on flies to (and pulses) that object once it has loaded. */
  singularityOpen: boolean;
  setSingularityOpen: (open: boolean) => void;
  pendingFocusId: string | null;
  setPendingFocusId: (id: string | null) => void;

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
  drawOpacity: number;
  setDrawOpacity: (v: number) => void;
  drawFlow: number;
  setDrawFlow: (v: number) => void;
  drawHardness: number;
  setDrawHardness: (v: number) => void;
  drawStabilization: number;
  setDrawStabilization: (v: number) => void;
  drawPressure: boolean;
  setDrawPressure: (v: boolean) => void;
  drawSmoothing: number;
  setDrawSmoothing: (v: number) => void;
  drawTexture: 'none' | 'chalk' | 'watercolor' | 'noise' | 'splatter';
  setDrawTexture: (v: 'none' | 'chalk' | 'watercolor' | 'noise' | 'splatter') => void;
  drawBlendMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';
  setDrawBlendMode: (v: 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten') => void;
  
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

  // Canvas Resident — the pixel cat that lives on the board
  residentEnabled: boolean;
  setResidentEnabled: (v: boolean) => void;
  
  // Slash menu
  slashMenu: { objectId: string; query: string; x: number; y: number } | null;
  setSlashMenu: (menu: { objectId: string; query: string; x: number; y: number } | null) => void;

  // @-mention menu — picks another block/heading to link to as an inline chip.
  atMenu: { objectId: string; query: string; x: number; y: number } | null;
  setAtMenu: (menu: { objectId: string; query: string; x: number; y: number } | null) => void;

  // Read-only mode — the public share viewer renders the board but blocks every edit.
  readOnly: boolean;
  setReadOnly: (v: boolean) => void;

  // Stress Reliefer. Null until the user actually picks an effect — entering
  // relax mode alone must not arm the canvas or swap the cursor.
  relaxEffect: RelaxEffectId | null;
  setRelaxEffect: (effect: RelaxEffectId | null) => void;

  // Shape settings
  selectedShapeType: string;
  setSelectedShapeType: (type: string) => void;

  /* Brainstorm kit — the corkboard tools (pins, clips, threads). `mode` is
     'brainstorm' while the kit is active; brainstormTool is which of the three
     is armed. Pins are real objects; clips ride an object's style; threads are
     connections with `style.thread`. */
  brainstormTool: BrainstormTool;
  setBrainstormTool: (tool: BrainstormTool) => void;
  pinColor: string;
  setPinColor: (color: string) => void;
  clipColor: string;
  setClipColor: (color: string) => void;
  threadColor: string;
  setThreadColor: (color: string) => void;
  /** The first pin/block tapped while running a thread; the next tap ties to it. */
  threadAnchorId: string | null;
  setThreadAnchorId: (id: string | null) => void;
  /** Drop a push-pin, centred on a world point, in the current pin colour. */
  addPin: (worldX: number, worldY: number) => CanvasObjectData;
  /** Fasten / remove a paper clip on any object (or the top of a pile). */
  toggleClip: (objectId: string) => void;
  /** Run a thread between two objects — a styled connection, deduped. */
  linkThread: (fromId: string, toId: string) => void;

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

  // Constellation View — the user-composed star map. Open/closed is view
  // state; the arrangement (positions, links, names) persists in `sky`.
  constellationOpen: false,
  setConstellationOpen: (v) => set({ constellationOpen: v }),
  sky: {},
  setSky: (sky) => set({ sky: sky || {} }),
  moveSkyStar: (id, x, y) =>
    set((s) => {
      const stars = { ...(s.sky.stars || {}) };
      stars[id] = { ...stars[id], x, y };
      return { sky: { ...s.sky, stars }, isDirty: true };
    }),
  nameSkyStar: (id, name) =>
    set((s) => {
      const stars = { ...(s.sky.stars || {}) };
      const cur = { ...(stars[id] || {}) };
      const v = (name || '').trim();
      if (v) {
        cur.name = v;
        stars[id] = cur;
      } else {
        delete cur.name;
        // keep the record only if it still carries a position override
        if (cur.x !== undefined || cur.y !== undefined) stars[id] = cur;
        else delete stars[id];
      }
      return { sky: { ...s.sky, stars }, isDirty: true };
    }),
  addSkyLink: (a, b) =>
    set((s) => {
      if (a === b) return {};
      const links = s.sky.links || [];
      if (links.some((l) => sameLink(l, a, b))) return {};
      return { sky: { ...s.sky, links: [...links, [a, b] as [string, string]] }, isDirty: true };
    }),
  removeSkyLink: (a, b) =>
    set((s) => ({
      sky: { ...s.sky, links: (s.sky.links || []).filter((l) => !sameLink(l, a, b)) },
      isDirty: true,
    })),
  nameSkyConstellation: (anchor, name) =>
    set((s) => {
      const names = { ...(s.sky.names || {}) };
      const v = (name || '').trim();
      if (v) names[anchor] = v;
      else delete names[anchor];
      return { sky: { ...s.sky, names }, isDirty: true };
    }),

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
  /* A scene FRAME stores its rectangle, not a camera. The camera is re-derived
     at playback for the current viewport, so the slide frames the same region
     on any screen — and the player can dim everything outside it. */
  addSceneFromFrame: (frameId) => {
    const state = get();
    const frame = state.objects.find((o) => o.id === frameId && o.type === 'frame');
    if (!frame) return;
    const rect = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
    const name = (frame.content || '').trim() || `Scene ${state.scenes.length + 1}`;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    const camera = cameraForRect(rect, vw, vh);

    const existing = state.scenes.find((s) => s.frameId === frameId);
    if (existing) {
      set((s) => ({
        scenes: s.scenes.map((sc) => (sc.frameId === frameId ? { ...sc, name, rect, camera } : sc)),
        isDirty: true,
      }));
      return;
    }
    const scene: Scene = {
      id: uuidv4(), name, camera, rect, frameId,
      order: state.scenes.length, durationMs: 1400,
    };
    set((s) => ({ scenes: [...s.scenes, scene], isDirty: true }));
  },

  syncSceneFrames: () => {
    const state = get();
    const activeParent = resolveParentId(state.canvasStack, state.urlCanvasId);
    const frames = state.objects
      .filter((o) => o.type === 'frame' && o.parentId === activeParent && o.style?.frameKind === 'scene')
      .sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x));
    frames.forEach((f) => get().addSceneFromFrame(f.id));
    return frames.length;
  },

  removeScene: (id) =>
    set((state) => ({
      scenes: state.scenes.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })),
      isDirty: true,
    })),
  renameScene: (id, name) =>
    set((state) => {
      const scene = state.scenes.find((s) => s.id === id);
      const scenes = state.scenes.map((s) => (s.id === id ? { ...s, name } : s));
      // Renaming a frame scene renames its FRAME too, or the next frame edit
      // would push the old title straight back over this one.
      if (scene?.frameId) {
        return {
          scenes,
          objects: state.objects.map((o) => (o.id === scene.frameId ? { ...o, content: name, updatedAt: Date.now() } : o)),
          isDirty: true,
        };
      }
      return { scenes, isDirty: true };
    }),
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

  // Skill Set (per-canvas agent rules) — persisted with the canvas state.
  skillset: null,
  setSkillset: (skillset) => set({ skillset }),
  toggleSkillsetEnabled: () =>
    set((state) => {
      // Flip from the CURRENTLY displayed state: with no skill set yet the UI
      // shows "Off", so the first toggle must turn a fresh one ON.
      const current = state.skillset?.enabled ?? false;
      const base = state.skillset ?? emptySkillset();
      return { skillset: { ...base, enabled: !current, updatedAt: Date.now() }, isDirty: true };
    }),
  setSkillsetPersona: (text) =>
    set((state) => {
      const base = state.skillset ?? emptySkillset();
      return { skillset: { ...base, persona: text, updatedAt: Date.now() }, isDirty: true };
    }),
  addSkillRule: (text = '') =>
    set((state) => {
      const base = state.skillset ?? emptySkillset();
      return {
        skillset: { ...base, enabled: true, rules: [...base.rules, makeRule(text)], updatedAt: Date.now() },
        isDirty: true,
      };
    }),
  updateSkillRule: (id, text) =>
    set((state) => {
      if (!state.skillset) return {};
      return {
        skillset: {
          ...state.skillset,
          rules: state.skillset.rules.map((r) => (r.id === id ? { ...r, text } : r)),
          updatedAt: Date.now(),
        },
        isDirty: true,
      };
    }),
  toggleSkillRule: (id) =>
    set((state) => {
      if (!state.skillset) return {};
      return {
        skillset: {
          ...state.skillset,
          rules: state.skillset.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
          updatedAt: Date.now(),
        },
        isDirty: true,
      };
    }),
  removeSkillRule: (id) =>
    set((state) => {
      if (!state.skillset) return {};
      return {
        skillset: {
          ...state.skillset,
          rules: state.skillset.rules.filter((r) => r.id !== id),
          updatedAt: Date.now(),
        },
        isDirty: true,
      };
    }),
  installSkillPreset: (presetId) =>
    set((state) => {
      const preset = getPreset(presetId);
      if (!preset) return {};
      return { skillset: installPreset(state.skillset, preset), isDirty: true };
    }),
  clearSkillset: () => set({ skillset: null, isDirty: true }),
  skillSetPanelOpen: false,
  setSkillSetPanelOpen: (skillSetPanelOpen) => set({ skillSetPanelOpen }),
  pluginsPanelOpen: false,
  setPluginsPanelOpen: (pluginsPanelOpen) => set({ pluginsPanelOpen }),

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

    /* A frame is a BACKDROP, and a backdrop belongs behind its contents — always,
       no matter when it was created. The AI agent routinely emits the frame LAST
       (after the blocks it wraps), which gave it the highest z-index: it then sat
       on top of everything inside it, tinting it and, because it's a full-size
       div, swallowing every click meant for the cards underneath. That is why a
       link card inside an agent-drawn frame looked dead — you couldn't press play
       on it, because you were clicking the frame. */
    if (obj.type === 'frame' && partial.zIndex === undefined) {
      obj.zIndex = 0;
    }

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

      /* A scene frame IS its slide: rename or resize the frame and the slide it
         owns follows, so the tour never drifts out of sync with the board. */
      const sceneFrame = obj.type === 'frame'
        && obj.style?.frameKind === 'scene'
        && state.scenes.some((s) => s.frameId === id);
      if (sceneFrame) {
        const next = { ...obj, ...updates };
        const rect = { x: next.x, y: next.y, width: next.width, height: next.height };
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
        return {
          objects: state.objects.map((o) =>
            o.id === id ? { ...o, ...updates, updatedAt: Date.now() } : o
          ),
          scenes: state.scenes.map((s) =>
            s.frameId === id
              ? { ...s, name: (next.content || '').trim() || s.name, rect, camera: cameraForRect(rect, vw, vh) }
              : s
          ),
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

  /**
   * Sweep a delete-frame's region: every block whose centre sits inside, the
   * ink drawn there, and the connections that touched any of it — gone in one
   * move, and back in one Ctrl+Z.
   *
   * Doing this as N separate removeObject calls would have cost the user N
   * undos to recover from a misplaced frame, which makes a bulk eraser far too
   * dangerous to use. So it pushes ONE `bulk-delete` entry carrying everything
   * it took.
   */
  deleteRegion: (frameId, opts) => {
    const state = get();
    const frame = state.objects.find((o) => o.id === frameId && o.type === 'frame');
    if (!frame) return 0;

    /* Anything the user tapped to keep is lifted out before the sweep, so a
       delete frame doesn't have to be positioned perfectly — you can throw it
       over a whole cluster and then rescue the two things worth keeping. */
    const spare = new Set(opts?.spare || []);
    const doomedObjects = objectsInFrame(state.objects, frame).filter((o) => !spare.has(o.id));
    const doomedStrokes = strokesInFrame(state.strokes, frame);

    /* Counted BEFORE the frame joins the pile: the frame is the tool, not
       content, so reporting "swept 8" for 7 blocks and the eraser you drew
       around them would just look like an off-by-one. */
    const sweptCount = doomedObjects.length + doomedStrokes.length;
    if (sweptCount === 0) return 0;
    if (!opts?.keepFrame) doomedObjects.push(frame);

    const objIds = new Set(doomedObjects.map((o) => o.id));
    const strokeIds = new Set(doomedStrokes.map((s) => s.id));
    const doomedConns = state.connections.filter((c) => objIds.has(c.fromId) || objIds.has(c.toId));
    const connIds = new Set(doomedConns.map((c) => c.id));

    set((s) => ({
      objects: s.objects.filter((o) => !objIds.has(o.id)),
      strokes: s.strokes.filter((st) => !strokeIds.has(st.id)),
      connections: s.connections.filter((c) => !connIds.has(c.id)),
      selectedId: s.selectedId && objIds.has(s.selectedId) ? null : s.selectedId,
      editingId: s.editingId && objIds.has(s.editingId) ? null : s.editingId,
      focusedId: s.focusedId && objIds.has(s.focusedId) ? null : s.focusedId,
      isDirty: true,
      undoStack: [...s.undoStack, {
        type: 'bulk-delete' as const,
        objectsData: doomedObjects,
        strokesData: doomedStrokes,
        connectionsData: doomedConns,
      }],
      redoStack: [],
    }));

    // Tell collaborators, then clear local storage. Both are per-item; only the
    // UNDO needs to be atomic, and that's held in the single stack entry above.
    doomedObjects.forEach((o) => emitCollab({ kind: 'remove', id: o.id }));
    void import('@/lib/db').then(({ deleteObject, deleteConnection, deleteStroke }) => {
      doomedObjects.forEach((o) => deleteObject(o.id).catch(() => {}));
      doomedConns.forEach((c) => deleteConnection(c.id).catch(() => {}));
      doomedStrokes.forEach((s) => deleteStroke(s.id).catch(() => {}));
    });

    return sweptCount;
  },

  frameDraftKind: 'normal',
  setFrameDraftKind: (frameDraftKind) => set({ frameDraftKind }),

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

  /* ---- Stacks ---------------------------------------------------------
     Piling is only ever a write to `style` — stackId and stackOrder — which
     means it rides the existing updateObject path and so gets persistence,
     collab broadcast and undo for free, and cannot introduce a second way for
     a board to change. */
  spreadStackId: null,
  setSpreadStack: (stackId) => set({ spreadStackId: stackId }),

  stackObjects: (dragId, targetId) => {
    const state = get();
    const drag = state.objects.find((o) => o.id === dragId);
    const target = state.objects.find((o) => o.id === targetId);
    if (!drag || !target || dragId === targetId) return;
    if (!isStackable(drag) || !isStackable(target)) return;

    // Land on the pile the target already belongs to, or start one on it.
    const stackId = stackIdOf(target) || `stk-${uuidv4()}`;
    const existing = membersOf(state.objects, stackId);
    const onTop = existing.length
      ? Math.max(...existing.map((m) => (m.style?.stackOrder as number) ?? 0)) + 1
      : 1;

    // Everything a pile is made of comes along: the whole run when the dragged
    // card was itself carrying a pile, so dropping one pile on another merges
    // them instead of stranding the cards underneath.
    const dragStack = stackIdOf(drag);
    const moving = dragStack ? membersOf(state.objects, dragStack) : [drag];

    // Seed the pile onto the target if it wasn't in one yet.
    if (!stackIdOf(target)) {
      state.updateObject(target.id, { style: { ...target.style, stackId, stackOrder: 0 } });
    }

    moving.forEach((m, i) => {
      const live = get().objects.find((o) => o.id === m.id);
      if (!live) return;
      state.updateObject(m.id, {
        // Members share the pile's spot; the fan is drawn, never stored.
        x: target.x,
        y: target.y,
        style: { ...live.style, stackId, stackOrder: onTop + i },
      });
    });
  },

  unstackObject: (id, x, y) => {
    const state = get();
    const obj = state.objects.find((o) => o.id === id);
    if (!obj) return;
    const style = { ...(obj.style || {}) };
    delete style.stackId;
    delete style.stackOrder;
    state.updateObject(id, { x, y, style, zIndex: state.getNextZIndex() });
  },

  scatterStack: (stackId) => {
    const state = get();
    const members = membersOf(state.objects, stackId);
    if (members.length < 2) return;

    // Deal them onto the same grid the pile was showing when open, so cards
    // land exactly where they already appear to be rather than jumping.
    const slots = stackSlots(state.objects, stackId);
    members.forEach((m) => {
      const slot = slots.get(m.id);
      const style = { ...(m.style || {}) };
      delete style.stackId;
      delete style.stackOrder;
      state.updateObject(m.id, {
        x: m.x + (slot?.dx ?? 0),
        y: m.y + (slot?.dy ?? 0),
        style,
      });
    });
    set({ spreadStackId: null });
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

  // Singularity Search
  singularityOpen: false,
  setSingularityOpen: (open) => set({ singularityOpen: open }),
  pendingFocusId: null,
  setPendingFocusId: (id) => set({ pendingFocusId: id }),

  // AI Agent state
  agentRunning: false,
  agentLogs: [],
  agentStatus: 'idle',
  setAgentState: (state) => set((prev) => ({ ...prev, ...state })),
  
  drawColor: '#2d2d2d',
  setDrawColor: (color) => set({ drawColor: color }),
  drawSize: 4,
  setDrawSize: (size) => set({ drawSize: size }),
  eraserMode: false,
  setEraserMode: (on) => set((state) => ({ eraserMode: on, highlighterMode: on ? false : state.highlighterMode })),
  highlighterMode: false,
  setHighlighterMode: (on) => set((state) => ({ highlighterMode: on, eraserMode: on ? false : state.eraserMode })),
  drawOpacity: 0.9,
  setDrawOpacity: (v) => set({ drawOpacity: v }),
  drawFlow: 1.0,
  setDrawFlow: (v) => set({ drawFlow: v }),
  drawHardness: 1.0,
  setDrawHardness: (v) => set({ drawHardness: v }),
  drawStabilization: 0.5,
  setDrawStabilization: (v) => set({ drawStabilization: v }),
  drawPressure: true,
  setDrawPressure: (v) => set({ drawPressure: v }),
  drawSmoothing: 0.5,
  setDrawSmoothing: (v) => set({ drawSmoothing: v }),
  drawTexture: 'none',
  setDrawTexture: (v) => set({ drawTexture: v }),
  drawBlendMode: 'normal',
  setDrawBlendMode: (v) => set({ drawBlendMode: v }),
  
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
      case 'bulk-delete': {
        // A delete frame's whole sweep comes back at once — blocks, ink and the
        // connections between them — so one Ctrl+Z fully reverses it.
        const objs = action.objectsData || [];
        const strs = action.strokesData || [];
        const conns = action.connectionsData || [];
        const objIds = new Set(objs.map((o) => o.id));
        const strIds = new Set(strs.map((s) => s.id));
        const connIds = new Set(conns.map((c) => c.id));
        set({
          objects: [...state.objects.filter((o) => !objIds.has(o.id)), ...objs],
          strokes: [...state.strokes.filter((s) => !strIds.has(s.id)), ...strs],
          connections: [...state.connections.filter((c) => !connIds.has(c.id)), ...conns],
          undoStack: newUndoStack,
          redoStack: [...state.redoStack, action],
          isDirty: true,
        });
        break;
      }
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
      case 'bulk-delete': {
        const objIds = new Set((action.objectsData || []).map((o) => o.id));
        const strIds = new Set((action.strokesData || []).map((s) => s.id));
        const connIds = new Set((action.connectionsData || []).map((c) => c.id));
        set({
          objects: state.objects.filter((o) => !objIds.has(o.id)),
          strokes: state.strokes.filter((s) => !strIds.has(s.id)),
          connections: state.connections.filter((c) => !connIds.has(c.id)),
          undoStack: [...state.undoStack, action],
          redoStack: newRedoStack,
          isDirty: true,
        });
        break;
      }
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

  // Canvas Resident — on by default; the choice is remembered
  residentEnabled: typeof window !== 'undefined'
    ? localStorage.getItem('mindspace-resident-enabled') !== 'false'
    : true,
  setResidentEnabled: (v) => {
    try { localStorage.setItem('mindspace-resident-enabled', String(v)); } catch { /* private mode */ }
    set({ residentEnabled: v });
  },
  
  // Slash menu
  slashMenu: null,
  setSlashMenu: (menu) => set({ slashMenu: menu }),

  // @-mention menu
  atMenu: null,
  setAtMenu: (menu) => set({ atMenu: menu }),

  // Read-only mode (public share viewer)
  readOnly: false,
  setReadOnly: (v) => set({ readOnly: v }),

  // Stress Reliefer
  relaxEffect: null,
  setRelaxEffect: (relaxEffect) => set({ relaxEffect }),

  // Shape settings
  selectedShapeType: 'square' as any,
  setSelectedShapeType: (selectedShapeType) => set({ selectedShapeType }),

  // Brainstorm kit (pins / clips / threads)
  brainstormTool: 'pin',
  setBrainstormTool: (brainstormTool) => set({ brainstormTool, threadAnchorId: null }),
  pinColor: DEFAULT_PIN_COLOR,
  setPinColor: (pinColor) => set({ pinColor }),
  clipColor: DEFAULT_CLIP_COLOR,
  setClipColor: (clipColor) => set({ clipColor }),
  threadColor: DEFAULT_THREAD_COLOR,
  setThreadColor: (threadColor) => set({ threadColor }),
  threadAnchorId: null,
  setThreadAnchorId: (threadAnchorId) => set({ threadAnchorId }),

  addPin: (worldX, worldY) => {
    const pin = get().addObject({
      type: 'pin',
      // Centre the head on the drop point; the tip hangs just below.
      x: worldX - PIN_SIZE / 2,
      y: worldY - PIN_SIZE / 2,
      width: PIN_SIZE,
      height: PIN_SIZE,
      content: '',
      style: { pinColor: get().pinColor },
    });
    return pin;
  },

  toggleClip: (objectId) => {
    const obj = get().objects.find((o) => o.id === objectId);
    if (!obj || obj.type === 'pin' || obj.type === 'arrow' || obj.type === 'frame') return;
    const hasClip = !!obj.style?.clip;
    get().updateObject(objectId, {
      style: { ...obj.style, clip: hasClip ? undefined : { color: get().clipColor } },
    });
  },

  linkThread: (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    // A thread already tied between this pair is left alone — no doubling up.
    const exists = get().connections.some(
      (c) =>
        c.style?.thread &&
        ((c.fromId === fromId && c.toId === toId) || (c.fromId === toId && c.toId === fromId))
    );
    if (exists) return;
    get().addConnection(fromId, toId, { thread: true, color: get().threadColor });
  },

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
  recolorWorkflowGroup: (workflowId: string, updates: { color?: string; borderColor?: string; textColor?: string; branchColor?: string }) => {
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
