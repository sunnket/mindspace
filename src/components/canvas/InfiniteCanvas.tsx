'use client';

import React, { useRef, useCallback, useEffect, useLayoutEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { screenToCanvas, clamp, fitImageBox, dragState, endActiveDrag } from '@/lib/utils';
import { isUrl, newLinkCard } from '@/lib/linkPreview';
import { ingestFile } from '@/lib/fileIngest';
import { collectDropEntries, hasDirectoryEntry, ingestDroppedFolder } from '@/lib/repoIngest';
import { applyCanvasTheme, resetCanvasTheme, DEFAULT_BACKGROUND } from '@/lib/canvasTheme';
import { IMAGE_SHAPE_CLIP, imageClipId } from '@/lib/imageShapes';
import { attachTouchCanvas } from '@/lib/touchCanvas';
import {
  saveObjects,
  saveStrokes,
  saveCanvasState,
  getAllObjects,
  getAllStrokes,
  getCanvasState,
  deleteObject as dbDeleteObject,
  deleteStroke as dbDeleteStroke,
  getAllConnections,
  COLLAB_SESSION_ID_PREFIX,
} from '@/lib/db';
import dynamic from 'next/dynamic';
import CanvasObject from './CanvasObject';
import FlowModeLayer from './FlowModeLayer';
import DrawingLayer from './DrawingLayer';
import ConnectionsLayer from './ConnectionsLayer';
import ConnectorPanel from '@/components/ui/ConnectorPanel';
import FloatingToolbar from '@/components/ui/FloatingToolbar';
import SpatialSearch from '@/components/ui/SpatialSearch';
import CommandPalette from '@/components/ui/CommandPalette';
import PlusMenu from '@/components/ui/PlusMenu';
import SlashCommandMenu from '@/components/ui/SlashCommandMenu';
import AtMentionMenu from '@/components/ui/AtMentionMenu';
import { isSkillsetActive, activeRuleCount } from '@/lib/skillset';
import ContextRail from '@/components/ui/rail/ContextRail';
import Minimap from '@/components/ui/Minimap';
import MobileViewControls from '@/components/ui/MobileViewControls';
import ReturnToWork from '@/components/ui/ReturnToWork';
import CheckpointIndex from '@/components/ui/CheckpointIndex';
import SaveIndicator from '@/components/ui/SaveIndicator';
import VoiceOrb from './VoiceOrb';
import { warmVoiceEngineIfUsed } from '@/hooks/useSpeechRecognition';
import Pocket from './Pocket';
import ScenesPanel, { ScenesList } from './ScenesPanel';
import FrameHUD from './FrameHUD';
import ChatLauncher from '@/components/chat/ChatLauncher';
import CollabBar from '@/components/collab/CollabBar';
import CanvasBackgroundPanel from '@/components/ui/CanvasBackgroundPanel';
import RelaxPanel from '@/components/ui/RelaxPanel';
import FlowModePanel from '@/components/ui/FlowModePanel';
import { useFlowStore } from '@/store/flowStore';
import CollabCursors from '@/components/collab/CollabCursors';
import AgentCursor from '@/components/canvas/AgentCursor';
import PulseLayer from '@/components/collab/PulseLayer';
import { useCollabStore } from '@/store/collabStore';

/* ------------------------------------------------------------------
   Four heavy layers that render nothing until you ask for them.

   The PDF reader alone pulls in pdf.js, 40 hand-built rooms and 140KB of its
   own CSS; the relax engine carries fifteen particle systems and their audio;
   Constellation is a whole second renderer. All three were plain imports, so
   all three were downloaded, parsed and executed before the board could paint
   — for a session that may never open a PDF and never touch a star map.

   Splitting them out is invisible in use (each mounts only when its own state
   flips on, which is exactly when the chunk is fetched) and is the difference
   between the canvas arriving and the canvas arriving eventually.
   ------------------------------------------------------------------ */
const PdfReaderLayer = dynamic(() => import('./PdfReaderLayer'), { ssr: false });
const ConstellationView = dynamic(() => import('./ConstellationView'), { ssr: false });
const RelaxEffectsLayer = dynamic(() => import('./RelaxEffectsLayer'), { ssr: false });

/* The same argument, one level down: these are overlays, modals and side
   panels. Every one of them renders nothing until something is opened, and
   together they were several hundred KB sitting in front of the board's own
   first paint. Split out, the toolbar and the canvas arrive first and these
   stream in behind — which is the order a person actually needs them in. */
const AgentOverlay = dynamic(() => import('@/components/ui/AgentOverlay'), { ssr: false });
const AgentChatPanel = dynamic(() => import('@/components/chat/AgentChatPanel'), { ssr: false });
const TrashPile = dynamic(() => import('@/components/ui/TrashPile'), { ssr: false });
const SkillSetPanel = dynamic(() => import('@/components/ui/SkillSetPanel'), { ssr: false });
const SingularitySearch = dynamic(() => import('@/components/ui/SingularitySearch'), { ssr: false });
const CollabModal = dynamic(() => import('@/components/collab/CollabModal'), { ssr: false });
const PluginsPanel = dynamic(() => import('@/components/ui/PluginsPanel'), { ssr: false });
const ShareModal = dynamic(() => import('@/components/ui/ShareModal'), { ssr: false });
const ShortcutsOverlay = dynamic(() => import('./ShortcutsOverlay'), { ssr: false });

/** Below this zoom, a click on empty canvas dives instead of creating. */
const DIVE_ZOOM = 0.62;

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

// Self-contained cursor glow: tracks the mouse via direct style writes so the
// canvas tree is not re-rendered on every mousemove event.
function GlowCursor({ isDrawMode }: { isDrawMode: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (ref.current) {
        ref.current.style.left = `${e.clientX}px`;
        ref.current.style.top = `${e.clientY}px`;
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  return (
    <div
      ref={ref}
      className="glow-cursor"
      style={{
        width: isDrawMode ? 30 : 20,
        height: isDrawMode ? 30 : 20,
      }}
    />
  );
}

/**
 * One row of the board menu — Share, Skill Set, Plugins, Collaborate.
 *
 * These four used to be pills laid out HORIZONTALLY beside the canvas name,
 * revealed by hovering it. Two problems with that: a hover-only control is
 * invisible until you happen to sweep the title (nothing said it was there),
 * and four pills in a row pushed the cluster far across the top of the board.
 * They're now rows in a proper dropdown behind an explicit ▾ button, so the
 * affordance is visible, the list reads top-to-bottom, and each row has room
 * for a label and a description instead of just a word.
 */
function MenuRow({
  onClick, label, hint, children, active = false, badge, dot = false, ...rest
}: {
  onClick: () => void;
  label: string;
  hint: string;
  children: React.ReactNode;
  active?: boolean;
  badge?: number;
  /** "There's something in here" — without spelling out how much. */
  dot?: boolean;
} & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="w-full flex items-center gap-2.5 rounded-xl transition-colors cursor-pointer text-left group/row"
      style={{
        padding: '8px 9px',
        background: active ? 'var(--accent-subtle)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--well)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      {...rest}
    >
      <span
        className="shrink-0 flex items-center justify-center rounded-lg"
        style={{
          width: 28, height: 28,
          background: active ? 'rgba(var(--accent-rgb),0.18)' : 'var(--well)',
          color: active ? 'var(--accent)' : 'var(--text-secondary)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {children}
        </svg>
      </span>
      <span className="flex flex-col min-w-0 flex-1" style={{ gap: 1 }}>
        <span
          className="text-[12px] font-bold leading-tight text-[var(--text-primary)] group-hover/row:text-[var(--accent)] transition-colors"
          style={{ fontFamily: "'Outfit', sans-serif", color: active ? 'var(--accent)' : undefined }}
        >
          {label}
        </span>
        <span className="text-[9.5px] font-medium leading-tight text-[var(--text-tertiary)] truncate">
          {hint}
        </span>
      </span>
      {badge !== undefined && (
        <span
          className="shrink-0 flex items-center justify-center text-[9px] font-bold text-white rounded-full tabular-nums"
          style={{ minWidth: 16, height: 16, padding: '0 4px', background: 'var(--accent)' }}
        >
          {badge}
        </span>
      )}
      {badge === undefined && dot && (
        <span
          aria-hidden="true"
          className="shrink-0 rounded-full"
          style={{ width: 6, height: 6, background: 'var(--accent)', marginRight: 3 }}
        />
      )}
    </button>
  );
}

export default function InfiniteCanvas() {
  const searchParams = useSearchParams();
  const urlId = searchParams?.get('id') || 'root';
  // A joining guest's live session lives under a synthetic canvas id instead
  // of whatever's in the URL — this is what actually swaps them into the
  // shared view without ever touching their real canvas. Null for a host
  // and for anyone not currently in a session.
  const sessionCanvasId = useCollabStore((s) => s.sessionCanvasId);
  const effectiveCanvasId = sessionCanvasId ?? urlId;

  const containerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, camX: 0, camY: 0 });
  const [loaded, setLoaded] = useState(false);
  /* Mirrors `loaded` for the unmount-save cleanup, which must read it at
     teardown time rather than close over whatever it was at mount. */
  const loadedRef = useRef(false);

  /* THE BOARD DOES NOT RE-RENDER WHEN THE CAMERA MOVES.
     `camera` is deliberately not subscribed here. Everything that needs the
     exact value reads it live from the store at the moment it needs it, and
     the two nodes that actually move are painted by `paintCamera`. React only
     hears about the camera through these two coarse selectors, which is all
     the render tree genuinely depends on: which objects to MOUNT, and whether
     a click means "dive in".
     `cullKey` changes about once per 160px travelled (the cull carries 400px
     of margin, which is what makes that safe); `diveReady` is a boolean that
     flips twice in a session. A pan that used to cost sixty full reconciles a
     second now costs zero. */
  const cullKey = useCanvasStore((s) => {
    const q = 160;
    return `${Math.round(s.camera.x / q)}:${Math.round(s.camera.y / q)}:${s.camera.zoom.toFixed(2)}`;
  });
  const diveReady = useCanvasStore((s) => s.camera.zoom < DIVE_ZOOM);
  const setCamera = useCanvasStore((s) => s.setCamera);
  const canvasBackground = useCanvasStore((s) => s.canvasBackground);
  const setCanvasBackground = useCanvasStore((s) => s.setCanvasBackground);
  const objects = useCanvasStore((s) => s.objects);
  const setObjects = useCanvasStore((s) => s.setObjects);
  const strokes = useCanvasStore((s) => s.strokes);
  const setStrokes = useCanvasStore((s) => s.setStrokes);
  const mode = useCanvasStore((s) => s.mode);
  const relaxEffect = useCanvasStore((s) => s.relaxEffect);
  const brainstormTool = useCanvasStore((s) => s.brainstormTool);
  const threadAnchorId = useCanvasStore((s) => s.threadAnchorId);
  const pendingFocusId = useCanvasStore((s) => s.pendingFocusId);
  const setPendingFocusId = useCanvasStore((s) => s.setPendingFocusId);
  const setMode = useCanvasStore((s) => s.setMode);
  const previousMode = useCanvasStore((s) => s.previousMode);
  const setPreviousMode = useCanvasStore((s) => s.setPreviousMode);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);
  const focusedId = useCanvasStore((s) => s.focusedId);
  const spreadStackId = useCanvasStore((s) => s.spreadStackId);
  const setFocusedId = useCanvasStore((s) => s.setFocusedId);
  const editingId = useCanvasStore((s) => s.editingId);
  const setEditingId = useCanvasStore((s) => s.setEditingId);
  const addObject = useCanvasStore((s) => s.addObject);
  const removeObject = useCanvasStore((s) => s.removeObject);
  const isDirty = useCanvasStore((s) => s.isDirty);
  const setUrlCanvasId = useCanvasStore((s) => s.setUrlCanvasId);
  const setDirty = useCanvasStore((s) => s.setDirty);
  const setLastSaved = useCanvasStore((s) => s.setLastSaved);
  const setSearchOpen = useCanvasStore((s) => s.setSearchOpen);
  const setCommandPaletteOpen = useCanvasStore((s) => s.setCommandPaletteOpen);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const canvasStack = useCanvasStore((s) => s.canvasStack);
  const popCanvas = useCanvasStore((s) => s.popCanvas);
  const plusMenuPos = useCanvasStore((s) => s.plusMenuPos);
  const setPlusMenuPos = useCanvasStore((s) => s.setPlusMenuPos);
  const workspaceTitle = useCanvasStore((s) => s.workspaceTitle);
  const setWorkspaceTitle = useCanvasStore((s) => s.setWorkspaceTitle);
  const skillset = useCanvasStore((s) => s.skillset);
  const setSkillset = useCanvasStore((s) => s.setSkillset);
  const setSkillSetPanelOpen = useCanvasStore((s) => s.setSkillSetPanelOpen);
  const pluginsPanelOpen = useCanvasStore((s) => s.pluginsPanelOpen);
  const setPluginsPanelOpen = useCanvasStore((s) => s.setPluginsPanelOpen);
  /** The ▾ board menu beside the canvas name — everything that belongs to the
      BOARD rather than to the pen in your hand. */
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  /** Scenes moved out of its own top-right corner and into that menu. */
  const [scenesMenuOpen, setScenesMenuOpen] = useState(false);
  /* Canvas background, Stress Reliefer and Flow Mode came in from the drawing
     toolbar for the same reason Scenes did: none of them make a mark, they set
     what the board IS while you work on it. Each hangs off the menu as its own
     dropdown, exactly like Scenes and Plugins. */
  const [bgMenuOpen, setBgMenuOpen] = useState(false);
  const [relaxMenuOpen, setRelaxMenuOpen] = useState(false);
  const [flowMenuOpen, setFlowMenuOpen] = useState(false);
  const flowEnabled = useFlowStore((s) => s.enabled);
  const sceneCount = useCanvasStore((s) => s.scenes.length);
  // Collab lives in its own store; the header only needs "is a session running"
  // (to hide the idle entry point) and the way to start one.
  const collabStatus = useCollabStore((s) => s.status);
  const openCollabModal = useCollabStore((s) => s.openModal);
  const collabActive = collabStatus === 'connected' || collabStatus === 'connecting';
  const checkpoint = useCanvasStore((s) => s.checkpoint);
  const setCheckpoint = useCanvasStore((s) => s.setCheckpoint);
  const addToTrash = useCanvasStore((s) => s.addToTrash);
  const connections = useCanvasStore((s) => s.connections);
  const setConnections = useCanvasStore((s) => s.setConnections);
  const updateObject = useCanvasStore((s) => s.updateObject);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [activeArrowId, setActiveArrowId] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showShare, setShowShare] = useState(false);

  // Leave any live collaboration session when the canvas unmounts.
  useEffect(() => {
    return () => {
      const c = useCollabStore.getState();
      if (c.status !== 'idle') c.leave();
    };
  }, []);

  /* Once the board has settled, quietly fetch the on-device speech model for
     people who dictate. Waiting until the button is pressed means a download, a
     WASM boot and a first inference all happen while someone sits watching a
     pulsing orb; done here it has already happened. Only for those who have
     dictated on this machine before — nobody else should pay for a model they
     may never use. */
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const start = () => warmVoiceEngineIfUsed();
    if (w.requestIdleCallback) {
      const handle = w.requestIdleCallback(start, { timeout: 8000 });
      return () => w.cancelIdleCallback?.(handle);
    }
    const t = setTimeout(start, 4000);
    return () => clearTimeout(t);
  }, []);

  // Paint the chosen canvas color mode across the whole workspace (canvas paper,
  // grid, cards, glass chrome, text). Restore the default palette on unmount so
  // other routes (landing) are unaffected.
  useEffect(() => {
    applyCanvasTheme(canvasBackground);
  }, [canvasBackground]);
  useEffect(() => () => resetCanvasTheme(), []);

  const truncatedTitle = useMemo(() => {
    if (!workspaceTitle) return 'Untitled';
    const words = workspaceTitle.split(' ');
    if (words.length <= 2) return workspaceTitle;
    return words.slice(0, 2).join(' ') + '...';
  }, [workspaceTitle]);

  // Clear connector selection when leaving mode
  useEffect(() => {
    if (mode !== 'connector') {
      useCanvasStore.getState().resetConnectorSelection();
    }
  }, [mode]);

  // Track the effective canvas ID (real URL id, or a synthetic collab
  // session id while a guest is in a live session) in Zustand — this is
  // what every canvasStore "current canvas" resolution reads.
  useEffect(() => {
    setUrlCanvasId(effectiveCanvasId);
  }, [effectiveCanvasId, setUrlCanvasId]);

  // Load from IndexedDB
  /* The Pocket is read ONCE per mount, not per canvas: it deliberately belongs
     to no board, so navigating between canvases must leave it exactly as it is. */
  useEffect(() => {
    void useCanvasStore.getState().loadPocket();
  }, []);

  useEffect(() => {
    async function load() {
      // In flight, this canvas's store contents are not its own yet — nothing
      // may be persisted under its id until the read below lands.
      loadedRef.current = false;
      try {
        const parentId = canvasStack.length > 0 ? canvasStack[canvasStack.length - 1] : effectiveCanvasId;
        const [savedObjects, savedStrokes, savedCamera, savedConnections] = await Promise.all([
          getAllObjects(parentId === 'root' ? undefined : parentId),
          getAllStrokes(parentId === 'root' ? undefined : parentId),
          getCanvasState(parentId),
          getAllConnections(parentId === 'root' ? undefined : parentId),
        ]);

        if (savedObjects.length === 0 && parentId === 'root' && useCanvasStore.getState().objects.length === 0) {
          // Populate default workspace
          import('uuid').then(({ v4: uuidv4 }) => {
            const defaultObjects = [
              { id: uuidv4(), type: 'heading', x: -300, y: -250, width: 600, height: 100, content: 'A space that thinks with you', zIndex: 1, createdAt: Date.now(), updatedAt: Date.now() },
              { id: uuidv4(), type: 'card', x: -350, y: -100, width: 220, height: 160, content: 'Draw Anywhere\nHold D and start drawing. Natural, pressure-sensitive strokes.', zIndex: 2, createdAt: Date.now(), updatedAt: Date.now() },
              { id: uuidv4(), type: 'card', x: -100, y: -100, width: 220, height: 160, content: 'Infinite Canvas\nZoom infinitely. Pan endlessly. Your thoughts have no boundaries.', zIndex: 3, createdAt: Date.now(), updatedAt: Date.now() },
              { id: uuidv4(), type: 'card', x: 150, y: -100, width: 220, height: 160, content: 'Type Anywhere\nClick any empty space and start writing. Headings, lists.', zIndex: 4, createdAt: Date.now(), updatedAt: Date.now() },
              { id: uuidv4(), type: 'card', x: -350, y: 100, width: 220, height: 160, content: 'Spatial Search\nSearch and fly to your thoughts. Cinematically animate to the result.', zIndex: 5, createdAt: Date.now(), updatedAt: Date.now() },
              { id: uuidv4(), type: 'card', x: -100, y: 100, width: 220, height: 160, content: 'Nested Spaces\nDouble-click any heading to zoom into a sub-space.', zIndex: 6, createdAt: Date.now(), updatedAt: Date.now() },
              { id: uuidv4(), type: 'card', x: 150, y: 100, width: 220, height: 160, content: 'Offline First\nEverything saves automatically to your device.', zIndex: 7, createdAt: Date.now(), updatedAt: Date.now() },
            ];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setObjects(defaultObjects as any);
          });
        } else {
          setObjects(savedObjects);
        }
        
        setStrokes(savedStrokes);
        setConnections(savedConnections);
        if (savedCamera) {
          if (savedCamera.checkpoint) {
            setCheckpoint(savedCamera.checkpoint);
          }
          if (savedCamera.camera) {
            setCamera(savedCamera.camera); // Restore last saved camera coordinate point
          } else if (savedCamera.checkpoint) {
            setCamera(savedCamera.checkpoint); // Fallback to checkpoint
          }
          
          if (savedCamera.title) {
            setWorkspaceTitle(savedCamera.title);
          }
        }
        // Restore this canvas's color mode (fall back to the default cream paper)
        setCanvasBackground(savedCamera?.background || DEFAULT_BACKGROUND);
        // Load this canvas's saved scenes + comment threads (reset when switching canvases)
        useCanvasStore.getState().setScenes(savedCamera?.scenes || []);
        useCanvasStore.getState().setThreads(savedCamera?.threads || []);
        // Load this canvas's Skill Set (per-canvas agent rules); null when none.
        setSkillset(savedCamera?.skillset || null);
        // Load this canvas's Constellation View star map (positions, links, names).
        useCanvasStore.getState().setSky(savedCamera?.sky || {});
        loadedRef.current = true;
        setLoaded(true);
      } catch (err) {
        console.error('Failed to load canvas data:', err);
        loadedRef.current = true;
        setLoaded(true);
      }
    }
    load();
  }, [canvasStack, setObjects, setStrokes, setCamera, setWorkspaceTitle, effectiveCanvasId, setCanvasBackground, setSkillset]);

  // Save on unmount to prevent losing last-second pans or edits
  useEffect(() => {
    return () => {
      /* Never persist canvas state that the load hasn't filled in yet.
         Before `load()` resolves every field here is still a store default —
         "Untitled Canvas", camera 0/0/1, ink paper, no scenes, no skill set —
         and writing those over a canvas that already has real ones silently
         erases them. That is not hypothetical: this cleanup runs on every dep
         change AND on React's dev-mode double-invoke, so a canvas created with
         a title, camera, background, scenes and a skill set (a template) lost
         all five within a second of being opened. */
      if (!loadedRef.current) return;

      const state = useCanvasStore.getState();
      const parentId = state.canvasStack.length > 0 ? state.canvasStack[state.canvasStack.length - 1] : effectiveCanvasId;
      // A guest's live collab session is a synthetic, never-persisted view —
      // nothing to save here (db.ts/syncService.ts also guard this, but
      // skipping it here avoids the wasted work entirely).
      if (parentId.startsWith(COLLAB_SESSION_ID_PREFIX)) return;

      // Always save camera position and canvas state locally on unmount.
      // Every field comes from the live store — a closure copy of the title
      // goes stale the moment the load renames the canvas.
      saveCanvasState({
        id: parentId,
        title: state.workspaceTitle,
        camera: state.camera,
        checkpoint: state.checkpoint || undefined,
        background: state.canvasBackground,
        scenes: state.scenes,
        threads: state.threads,
        skillset: state.skillset || undefined,
        sky: state.sky,
        lastModified: Date.now(),
      }).catch(err => console.error('Failed to save canvas state on unmount:', err));

      if (state.isDirty) {
        saveObjects(state.objects).catch(err => console.error('Failed to save objects on unmount:', err));
        saveStrokes(state.strokes).catch(err => console.error('Failed to save strokes on unmount:', err));
        
        import('@/store/authStore').then(({ useAuthStore }) => {
          const user = useAuthStore.getState().user;
          if (user) {
            import('@/lib/syncService').then(({ syncCanvasToCloud }) => {
              syncCanvasToCloud(
                parentId,
                user.id,
                {
                  id: parentId,
                  title: state.workspaceTitle,
                  camera: state.camera,
                  checkpoint: state.checkpoint || undefined,
                  background: state.canvasBackground,
                  scenes: state.scenes,
                  threads: state.threads,
                  skillset: state.skillset || undefined,
                  sky: state.sky,
                  lastModified: Date.now(),
                },
                state.objects,
                state.strokes,
                state.connections,
                { force: true }
              ).catch(err => console.error('Failed to sync canvas on unmount:', err));
            });
          }
        });
      }
    };
  }, [effectiveCanvasId]);

  // Autosave
  useEffect(() => {
    if (!isDirty || !loaded) return;

    const timeout = setTimeout(async () => {
      try {
        /* Read at SAVE time, not at schedule time. The camera is no longer a
           render subscription, and it shouldn't be an autosave dependency
           either — a pan would have restarted this debounce on every frame
           just to persist a viewport nobody asked to save yet. */
        const camera = useCanvasStore.getState().camera;
        const parentId = canvasStack.length > 0 ? canvasStack[canvasStack.length - 1] : effectiveCanvasId;
        // A guest's live collab session is a synthetic, never-persisted view.
        if (parentId.startsWith(COLLAB_SESSION_ID_PREFIX)) return;

        // Save locally to IndexedDB first
        await Promise.all([
          saveObjects(objects),
          saveStrokes(strokes),
          saveCanvasState({
            id: parentId,
            title: workspaceTitle,
            camera,
            checkpoint: checkpoint || undefined,
            background: canvasBackground,
            scenes: useCanvasStore.getState().scenes,
            threads: useCanvasStore.getState().threads,
            skillset: useCanvasStore.getState().skillset || undefined,
            sky: useCanvasStore.getState().sky,
            lastModified: Date.now(),
          }),
        ]);

        // Sync to cloud if user is authenticated
        const { useAuthStore } = await import('@/store/authStore');
        const user = useAuthStore.getState().user;
        if (user) {
          const { syncCanvasToCloud } = await import('@/lib/syncService');
          await syncCanvasToCloud(
            parentId,
            user.id,
            {
              id: parentId,
              title: workspaceTitle,
              camera,
              checkpoint: checkpoint || undefined,
              background: canvasBackground,
              scenes: useCanvasStore.getState().scenes,
              threads: useCanvasStore.getState().threads,
              skillset: useCanvasStore.getState().skillset || undefined,
              sky: useCanvasStore.getState().sky,
              lastModified: Date.now(),
            },
            objects,
            strokes,
            connections
          );
        }

        setDirty(false);
        setLastSaved(Date.now());
      } catch (err) {
        console.error('Autosave error:', err);
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [isDirty, objects, strokes, checkpoint, loaded, canvasStack, effectiveCanvasId, workspaceTitle, setDirty, setLastSaved, connections, canvasBackground]);


  /* ------------------------------------------------------------------
     THE CAMERA PIPELINE — one gesture, one camera write per frame.

     Two bugs lived where this now is, and both of them were felt rather
     than seen.

     1. STALE CAMERA. The wheel handler closed over `camera` from React
        state. A trackpad fires wheel events in bursts — several inside a
        single frame — and each one computed its new position from the
        camera as it was at the last RENDER, not as it is now. So every
        event in a burst but the last was overwritten, and the board moved
        less than your fingers did. Measured: twenty wheel events of 25px
        moved the canvas 375px instead of 500px. A quarter of every fast
        scroll was silently thrown away, which is exactly what "slippery"
        or "buggy" feels like.

     2. LISTENER CHURN. The effect below re-attached the native wheel
        listener every time the callback identity changed — which, with
        `camera` in its deps, was every frame of every zoom.

     The fix for both: intents are accumulated in a ref and applied ONCE
     per animation frame, reading the camera live from the store at flush
     time. Nothing is dropped, nothing is stale, the listener binds once,
     and a burst of twenty events costs one state write instead of twenty.
     ------------------------------------------------------------------ */
  const worldRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  /**
   * The camera, painted straight onto the DOM.
   *
   * This is the half that makes the board feel like a board. Moving the canvas
   * is a 60Hz gesture, but the canvas is a React tree with hundreds of nodes in
   * it — driving the transform from state meant every pixel of every pan
   * re-rendered and reconciled the whole thing just to write one string into
   * one style attribute. Two elements actually move: the world layer and the
   * grid behind it. So they are written to directly, and React is told about
   * the camera on a slower, coarser schedule (see `cullKey` / `diveReady`),
   * because nothing else on screen needs to know where the board is mid-flight.
   */
  const paintCamera = useCallback((cam: { x: number; y: number; zoom: number }) => {
    const w = worldRef.current;
    if (w) w.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`;
    const g = gridRef.current;
    if (g) {
      const step = 24 * cam.zoom;
      g.style.backgroundPosition = `${cam.x % step}px ${cam.y % step}px`;
      g.style.backgroundSize = `${step}px ${step}px`;
      g.style.opacity = cam.zoom > 0.4 ? '0.35' : '0';
    }
  }, []);

  /* Paint on mount and on EVERY camera change, from a store subscription
     rather than a render — animateCamera (scenes, dive, fit, minimap jumps)
     and collab both write the camera without going through a gesture, and all
     of them have to show up on screen. */
  useLayoutEffect(() => {
    paintCamera(useCanvasStore.getState().camera);
    return useCanvasStore.subscribe((s, prev) => {
      if (s.camera !== prev.camera) paintCamera(s.camera);
    });
  }, [paintCamera]);

  const camIntent = useRef<{
    /** Absolute target, from a drag-pan (which knows where it started). */
    panTo: { x: number; y: number } | null;
    /** Relative scroll, accumulated across the frame. */
    dx: number;
    dy: number;
    /** Accumulated zoom multiplier + the cursor it should pivot around. */
    zoomFactor: number;
    zoomAt: { x: number; y: number } | null;
  }>({ panTo: null, dx: 0, dy: 0, zoomFactor: 1, zoomAt: null });
  const camRaf = useRef<number | null>(null);

  /* Where the zoom is HEADING, and where it is now.
     A wheel notch sets a target and the board eases toward it over ~7 frames
     instead of jumping — the difference between a scale that snaps between
     values and one that travels. Panning is never eased: a drag has to track
     the cursor exactly or the board feels like it's on elastic. */
  const camEase = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const easeRaf = useRef<number | null>(null);

  const stopEase = () => {
    if (easeRaf.current != null) cancelAnimationFrame(easeRaf.current);
    easeRaf.current = null;
    camEase.current = null;
  };

  const startEase = useCallback(() => {
    if (easeRaf.current != null) return;   // already gliding — it'll pick up the new target
    const step = () => {
      easeRaf.current = null;
      const target = camEase.current;
      if (!target) return;
      const cur = useCanvasStore.getState().camera;
      const k = 0.28;                       // ≈7 frames to arrive
      const next = {
        x: cur.x + (target.x - cur.x) * k,
        y: cur.y + (target.y - cur.y) * k,
        zoom: cur.zoom + (target.zoom - cur.zoom) * k,
      };
      // Close enough that another frame would move it less than a pixel: land
      // exactly on the target so the zoom read-out doesn't sit at 99.7%.
      const done = Math.abs(target.zoom - next.zoom) < 0.0005
        && Math.abs(target.x - next.x) < 0.5 && Math.abs(target.y - next.y) < 0.5;
      useCanvasStore.getState().setCamera(done ? target : next);
      if (done) camEase.current = null;
      else easeRaf.current = requestAnimationFrame(step);
    };
    easeRaf.current = requestAnimationFrame(step);
  }, []);

  const flushCamera = useCallback(() => {
    camRaf.current = null;
    const intent = camIntent.current;
    // Compose onto where the camera is HEADING if a zoom is still easing, so a
    // second notch mid-glide adds to the first instead of fighting it.
    const cam = camEase.current ?? useCanvasStore.getState().camera;
    let { x, y, zoom } = cam;
    const zooming = !!intent.zoomAt && intent.zoomFactor !== 1;

    if (intent.panTo) {
      x = intent.panTo.x;
      y = intent.panTo.y;
    }

    if (zooming && intent.zoomAt) {
      const next = clamp(zoom * intent.zoomFactor, MIN_ZOOM, MAX_ZOOM);
      // Keep the point under the cursor pinned while the scale changes. The
      // anchor is baked into the TARGET, so easing toward it holds the anchor
      // for the whole glide.
      x = intent.zoomAt.x - (intent.zoomAt.x - x) * (next / zoom);
      y = intent.zoomAt.y - (intent.zoomAt.y - y) * (next / zoom);
      zoom = next;
    }

    x += intent.dx;
    y += intent.dy;

    camIntent.current = { panTo: null, dx: 0, dy: 0, zoomFactor: 1, zoomAt: null };

    if (zooming) {
      camEase.current = { x, y, zoom };
      startEase();
      return;
    }

    // A pan while a zoom was still gliding cancels the glide — the hand wins.
    stopEase();
    const live = useCanvasStore.getState().camera;
    if (x !== live.x || y !== live.y || zoom !== live.zoom) {
      useCanvasStore.getState().setCamera({ x, y, zoom });
    }
  }, [startEase]);

  const scheduleCamera = useCallback(() => {
    if (camRaf.current == null) camRaf.current = requestAnimationFrame(flushCamera);
  }, [flushCamera]);

  // A gesture in flight when the canvas unmounts must not leave a frame booked.
  useEffect(() => () => {
    if (camRaf.current != null) cancelAnimationFrame(camRaf.current);
    if (easeRaf.current != null) cancelAnimationFrame(easeRaf.current);
  }, []);

  // Wheel zoom
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      /* ---- Give the scroll to a scrollable block first -------------------
         The canvas used to swallow EVERY wheel event (preventDefault before
         anything else), so a long checklist, a tall table, a repo tree or a
         transcript could never be scrolled with the wheel — the board panned
         underneath instead and the content stayed put. Blocks tried to fix this
         individually with `onWheel={e => e.stopPropagation()}`, which cannot
         work: React delegates its listeners to the root container, an ANCESTOR
         of this one, so by the time a synthetic handler runs, this native
         listener has already cancelled the event.

         One check here fixes all of them, including blocks added later. Walk up
         from whatever the cursor is over, stopping at the canvas itself, and if
         some element on the way can genuinely scroll along the wheel's dominant
         axis, leave the event completely alone: no preventDefault, no camera
         change, and the browser performs its ordinary, momentum-correct scroll.
         Only the inner region moves — never the whole board. */
      const container = containerRef.current;
      const wantsY = Math.abs(e.deltaY) >= Math.abs(e.deltaX);
      let node = e.target as HTMLElement | null;
      while (node && node !== container) {
        // Text inputs and the like have no layout box worth testing.
        if (node.nodeType === 1) {
          const cs = getComputedStyle(node);
          const overflow = wantsY ? cs.overflowY : cs.overflowX;
          if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') {
            const scrollable = wantsY
              ? node.scrollHeight > node.clientHeight + 1
              : node.scrollWidth > node.clientWidth + 1;
            if (scrollable) return;
          }
        }
        node = node.parentElement;
      }

      e.preventDefault();

      /* A tour is a slideshow, not a canvas. Scrolling during one dragged the
         board out from under the slide — and for a frame scene, whose mask is
         pinned to a region, that just scrolled the content out of its own
         frame. Playback owns the camera; the arrows and Esc own navigation. */
      if (useCanvasStore.getState().isTouring) return;

      if (e.ctrlKey || e.metaKey) {
        // Smooth exponential zoom for trackpads and mouse wheels. Factors
        // MULTIPLY across a burst, so twenty small pinches compose into the
        // one big scale change they add up to.
        const rect = container?.getBoundingClientRect();
        if (!rect) return;
        camIntent.current.zoomFactor *= Math.exp(-e.deltaY * 0.005);
        camIntent.current.zoomAt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      } else {
        camIntent.current.dx -= e.deltaX;
        camIntent.current.dy -= e.deltaY;
      }
      scheduleCamera();
    },
    // No `camera` dep — the flush reads it live, so this binds ONCE and every
    // event in a burst contributes instead of overwriting its neighbours.
    [scheduleCamera]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  /* ------------------------------------------------------------------
     The same board, driven by fingers.

     Everything above this point speaks mouse, and a touchscreen never sends a
     mousemove for a travelling finger — which is precisely why the board could
     not be dragged, moved or zoomed on a phone. lib/touchCanvas.ts reads the
     touches and translates; see the essay at the top of that file for why the
     translation lives at the boundary instead of in forty call sites.

     Binds once and reads everything it needs live from the store, so no gesture
     is ever driven by a stale camera or a stale mode.
     ------------------------------------------------------------------ */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return attachTouchCanvas(container, {
      getCamera: () => useCanvasStore.getState().camera,
      setCamera: (cam) => useCanvasStore.getState().setCamera(cam),
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      isSuspended: () => useCanvasStore.getState().isTouring,
      isDrawing: () => useCanvasStore.getState().mode === 'draw',
      /* What a finger may pick up and move. Two things qualify, and the
         distinction is the whole reason panning works on a screen that is
         mostly covered in cards:

           · A block that is ALREADY selected. Tap it once to pick it up, then
             drag. Without that rule the first finger-drag over any card
             flung it across the board instead of scrolling past it — the
             single most common complaint about canvases on phones.
           · A handle that only exists because something is selected: resize
             dots, arrow endpoints, connector grips. Those are unambiguous —
             you cannot land on one by accident — so they drag immediately. */
      isDraggable: (el) => {
        if (el.closest('[data-touch-drag="handle"], .resize-handle')) return true;
        const block = el.closest('.canvas-object');
        if (!block || !block.classList.contains('selected')) return false;
        /* …with one exception, and it is the one that matters most: while you
           are actually TYPING into a block, a finger dragged across its words
           is a text selection, not a move. That is the same division of labour
           the mouse path already draws (see handleMouseDown in CanvasObject) —
           the difference is that a mouse can grab the 6px of padding around
           the words and a fingertip cannot, so on touch the whole block is a
           handle right up until the caret is in it. */
        const id = block.closest('[data-object-id]')?.getAttribute('data-object-id');
        return !!id && useCanvasStore.getState().editingId !== id;
      },
      /* A second finger during a stroke means "zoom", not "draw a fork". The
         drawing layer throws the half-finished stroke away when it hears this. */
      onMultiTouch: () => window.dispatchEvent(new CustomEvent('canvas-abort-stroke')),
    });
  }, []);

  /* ------------------------------------------------------------------
     The on-screen keyboard, and "there is nowhere to write".

     `body` is `position: fixed`, so a phone keyboard does not resize the
     layout — it slides a panel over the bottom half of a viewport that still
     believes it is 844px tall. Tap the lower two thirds of the board to start
     a note and the caret you just created is behind the keys, with no scroll
     to recover it because an infinite canvas has no scroll.

     Two fixes, and they are separate:

       · `--kb-inset` is published to CSS so every piece of bottom chrome
         (toolbar, sheets, zoom pill) rides above the keyboard instead of under
         it. The visual viewport is the only honest source for that number.
       · The camera lifts the block being edited into the space that is
         actually still visible. Only when it needs to — a block already in the
         clear is left exactly where the user put it, because an unrequested
         camera move is its own kind of disorienting.
     ------------------------------------------------------------------ */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb-inset', `${Math.round(inset)}px`);

      // Under ~120px it is a URL bar collapsing, not a keyboard.
      if (inset < 120) return;
      const id = useCanvasStore.getState().editingId;
      if (!id) return;
      const obj = useCanvasStore.getState().objects.find((o) => o.id === id);
      if (!obj) return;

      const cam = useCanvasStore.getState().camera;
      const top = obj.y * cam.zoom + cam.y;
      const bottom = top + obj.height * cam.zoom;
      const safeBottom = vv.height - 16;
      if (bottom <= safeBottom && top >= 8) return;

      /* Lift it to sit just above the keys — not to the middle of the free
         strip, because what you are typing belongs at the bottom of your
         attention, with the rest of the board still readable above it. */
      const wanted = Math.min(safeBottom - obj.height * cam.zoom, vv.height * 0.34);
      useCanvasStore.getState().animateCamera({ ...cam, y: cam.y + (wanted - top) }, 260);
    };

    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      document.documentElement.style.removeProperty('--kb-inset');
    };
  }, []);

  /* Editing started while the keyboard was already up (tapping straight from
     one note into another) fires no viewport resize, so it needs its own nudge
     through the same path. */
  useEffect(() => {
    if (!editingId) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const t = setTimeout(() => vv.dispatchEvent(new Event('resize')), 120);
    return () => clearTimeout(t);
  }, [editingId]);

  /* A pan ends when the BUTTON comes up, wherever that happens to be — over
     the toolbar, a panel, another window, or nowhere at all because the tab
     lost focus mid-drag. The container's own onMouseUp only ever saw releases
     that landed back on the board, so every other ending left the canvas
     believing it was still being panned. These listeners are the safety net
     that guarantees a gesture always finishes. */
  useEffect(() => {
    /* Bubble phase, NOT capture: React's own delegated onMouseUp on the board
       runs first and still gets to see the flag, so a still tap on empty
       canvas keeps creating a text box. We only clean up after it.

       And deliberately NOT `pointerup`. Pointer events are dispatched BEFORE
       their compatibility mouse events, so listening for it here cleared the
       flag before React's onMouseUp could read it — which silently killed
       tap-anywhere-to-write. `pointercancel` is safe: it means the gesture was
       abandoned, and no mouseup follows it. */
    const end = () => {
      isPanningRef.current = false;
      // Any block gesture still believing it's live ends here too.
      endActiveDrag();
    };
    window.addEventListener('mouseup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('mouseup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
    };
  }, []);

  // Mouse down for panning
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 2) return; // Ignore right click
      if (mode === 'draw') return;
      // Playback owns the camera — see handleWheel.
      if (useCanvasStore.getState().isTouring) return;

      // Close plus menu
      if (plusMenuPos) {
        setPlusMenuPos(null);
        return;
      }

      if (mode === 'pan' || e.button === 1) {
        // Middle click or pan mode
        isPanningRef.current = true;
        const midCam = useCanvasStore.getState().camera;
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          camX: midCam.x,
          camY: midCam.y,
        };
        e.preventDefault();
        return;
      }

      if (mode === 'text' || mode === 'select' || mode === 'shape' || mode === 'arrow' || mode === 'frame' || mode === 'relax' || mode === 'brainstorm') {
        // If they click empty space, we record pan start just in case it's a tiny drag
        isPanningRef.current = true;
        const liveCam = useCanvasStore.getState().camera;
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          camX: liveCam.x,
          camY: liveCam.y,
        };
      }

      // Deselect
      setSelectedId(null);
      setEditingId(null);
      // …and an open pile gathers itself back up. Clicking away from a thing
      // is how you're done with it everywhere else on this canvas.
      useCanvasStore.getState().setSpreadStack(null);
      /* A selected connector lets go too. Its own hit path stops mousedown from
         reaching here, so this only ever fires for a click that missed it. */
      useCanvasStore.getState().setSelectedConnectionId(null);
    },
    [mode, setSelectedId, setEditingId, plusMenuPos, setPlusMenuPos]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      /* Read the camera LIVE from the store, never from this callback's
         closure. The closure only re-binds when `camera.zoom` changes (it's the
         one camera field in the dep array), so after any PAN the closed-over
         `camera.x/y` is stale by the whole pan distance. Locally that's
         invisible — you see the real OS cursor — but the world coordinate we
         broadcast to collaborators was computed from the wrong origin, so a
         peer saw our cursor pinned to empty space (or floating over their own
         UI) instead of what we were pointing at. This one read is the fix. */
      const liveCamera = useCanvasStore.getState().camera;

      // Broadcast my cursor (in world coords) to collaborators, if in a session.
      const collab = useCollabStore.getState();
      if (collab.status === 'connected' && collab._cursorSender) {
        const world = screenToCanvas(e.clientX, e.clientY, liveCamera);
        collab._cursorSender(world.x, world.y);
      }

      if (activeArrowId) {
        const worldPos = screenToCanvas(e.clientX, e.clientY, liveCamera);
        const arrowObj = objects.find((o) => o.id === activeArrowId);
        if (arrowObj && arrowObj.style) {
          const startX = arrowObj.style.startX as number || 0;
          const startY = arrowObj.style.startY as number || 0;
          const minX = Math.min(startX, worldPos.x);
          const minY = Math.min(startY, worldPos.y);
          const maxX = Math.max(startX, worldPos.x);
          const maxY = Math.max(startY, worldPos.y);
          
          updateObject(activeArrowId, {
            x: minX,
            y: minY,
            width: Math.max(15, maxX - minX),
            height: Math.max(15, maxY - minY),
            style: {
              ...arrowObj.style,
              endX: worldPos.x,
              endY: worldPos.y,
            }
          });
        }
      }

      /* --- Never pan unless a button is genuinely still down ---------------
         `isPanningRef` used to be cleared ONLY by the container's own
         onMouseUp. Release the button anywhere that isn't the board — over the
         toolbar, a panel, the minimap, or outside the window entirely — and
         that handler never fired, so the flag stayed true forever. From then
         on every ordinary mouse move panned the camera by the distance from a
         long-dead press: blocks slid away from the cursor as you reached for
         them ("it repels"), and touching one dragged it while the world
         scrolled underneath, flinging it across the board.

         `e.buttons` is the ground truth — 0 means nothing is held, whatever we
         think we remember. Checking it makes a stale press impossible to act
         on. `dragState.objectDrag` is the matching guard from the other side:
         a block drag and a viewport pan must never run together. */
      if (e.buttons === 0) isPanningRef.current = false;
      if (dragState.objectDrag) return;

      if (isPanningRef.current) {
        // Dragging empty board pans the viewport — the plainest possible
        // reading of "grab the paper and move it".
        if (mode === 'select' || mode === 'text' || mode === 'pan' || mode === 'relax' || mode === 'brainstorm') {
          /* Absolute, measured from where the drag began, so a frame that
             coalesces three mousemoves lands on the newest one rather than
             summing all three. Through the same one-write-per-frame flush as
             the wheel, so a mouse reporting at 1000Hz costs 60 renders a
             second, not a thousand. */
          camIntent.current.panTo = {
            x: panStartRef.current.camX + (e.clientX - panStartRef.current.x),
            y: panStartRef.current.camY + (e.clientY - panStartRef.current.y),
          };
          scheduleCamera();
        }
      }
    },
    // No `camera` dep: the handler reads it live from the store (see top), so
    // the callback never needs to re-bind when the camera changes.
    [mode, scheduleCamera, activeArrowId, objects, updateObject]
  );

  /* ------------------------------------------------------------------
     Zoomed out, then clicked: dive in.

     Below ~60% the board stops being a page and becomes a map. You can see
     where everything is and read none of it, and the only ways in were the
     wheel (which zooms around the cursor, so you overshoot and hunt) and the
     minimap. Worse, a click out here used to DROP A TEXT BOX at 40% scale —
     you asked to look closer and got a 6px caret instead.

     So a click on empty board while zoomed out means "take me there", and two
     bits of judgement make it land somewhere useful rather than technically
     correct:

       · It aims at CONTENT, not at the pixel. Whatever sits within reach of the
         click is gathered up and framed as a group, so you arrive with the
         cluster centred and whole instead of half a card filling the screen.
         Click genuinely empty space and you simply get 100% at that point.
       · It never zooms OUT. The fit is floored at a real magnification, so a
         dive is always a dive.

     And because a camera jump you didn't ask for is disorienting, the previous
     view is kept for a few seconds behind one chip.
     ------------------------------------------------------------------ */
  const [diveBack, setDiveBack] = useState<{ x: number; y: number; zoom: number } | null>(null);
  const diveBackTimer = useRef<number | null>(null);

  const rememberDive = useCallback((cam: { x: number; y: number; zoom: number }) => {
    setDiveBack(cam);
    if (diveBackTimer.current) window.clearTimeout(diveBackTimer.current);
    diveBackTimer.current = window.setTimeout(() => setDiveBack(null), 9000);
  }, []);
  useEffect(() => () => { if (diveBackTimer.current) window.clearTimeout(diveBackTimer.current); }, []);

  const diveTo = useCallback((world: { x: number; y: number }) => {
    const store = useCanvasStore.getState();
    const cam = store.camera;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    /** How far from the click still counts as "what you were pointing at". */
    const REACH = 340;
    const near = store.objects.filter((o) => {
      if (o.style?.isMinimized) return false;
      const dx = Math.max(o.x - world.x, 0, world.x - (o.x + o.width));
      const dy = Math.max(o.y - world.y, 0, world.y - (o.y + o.height));
      return Math.hypot(dx, dy) <= REACH;
    });

    let target: { x: number; y: number; zoom: number };
    if (near.length > 0) {
      const minX = Math.min(...near.map((o) => o.x));
      const minY = Math.min(...near.map((o) => o.y));
      const maxX = Math.max(...near.map((o) => o.x + o.width));
      const maxY = Math.max(...near.map((o) => o.y + o.height));
      const pad = 90;
      const fit = Math.min(vw / (maxX - minX + pad * 2), vh / (maxY - minY + pad * 2));
      // Never below a real magnification, never past 100% — you asked to read
      // it, not to inspect the pixels.
      const zoom = clamp(fit, Math.min(1, cam.zoom * 1.8), 1);
      target = {
        x: vw / 2 - (minX + (maxX - minX) / 2) * zoom,
        y: vh / 2 - (minY + (maxY - minY) / 2) * zoom,
        zoom,
      };
    } else {
      target = { x: vw / 2 - world.x, y: vh / 2 - world.y, zoom: 1 };
    }

    rememberDive(cam);
    store.animateCamera(target, 620);
  }, [rememberDive]);

  /** A block tapped from far out gets framed on its own — same idea, one card. */
  const diveToObject = useCallback((id: string) => {
    const store = useCanvasStore.getState();
    const obj = store.objects.find((o) => o.id === id);
    if (!obj) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 120;
    const zoom = clamp(Math.min(vw / (obj.width + pad * 2), vh / (obj.height + pad * 2)), 0.4, 1);
    rememberDive(store.camera);
    store.animateCamera({
      x: vw / 2 - (obj.x + obj.width / 2) * zoom,
      y: vh / 2 - (obj.y + obj.height / 2) * zoom,
      zoom,
    }, 620);
  }, [rememberDive]);

  /* A block's own click handler can't reach these callbacks (it lives inside
     CanvasObject, one tree away), so it asks for a dive by event. */
  useEffect(() => {
    const onDive = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) diveToObject(id);
    };
    window.addEventListener('dive-to-object', onDive as EventListener);
    return () => window.removeEventListener('dive-to-object', onDive as EventListener);
  }, [diveToObject]);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        
        // If it was a click (not a drag) on empty space in select/text/shape/arrow mode, create element!
        const target = e.target as HTMLElement;
        const isClickOnObject = target.closest('.canvas-object') || target.closest('.canvas-object-content');
        if (!isClickOnObject && (mode === 'select' || mode === 'text' || mode === 'shape' || mode === 'arrow' || mode === 'frame' || mode === 'relax' || mode === 'brainstorm')) {
          const dx = Math.abs(e.clientX - panStartRef.current.x);
          const dy = Math.abs(e.clientY - panStartRef.current.y);
          if (dx < 5 && dy < 5) {
            // It was a click
            const upCam = useCanvasStore.getState().camera;
            const worldPos = screenToCanvas(e.clientX, e.clientY, upCam);

            /* Far enough out that the board is a map: a click means "closer",
               not "start writing here". Only in select mode — every other tool
               was picked up on purpose and gets to do its job at any zoom. */
            if (mode === 'select' && upCam.zoom < DIVE_ZOOM) {
              diveTo(worldPos);
              return;
            }

            if (mode === 'arrow') {
              const aStyle = useCanvasStore.getState().arrowStyle;
              if (!activeArrowId) {
                // First click: Create the arrow with the current tool defaults
                // (set in the selection panel while in arrow mode).
                const obj = addObject({
                  type: 'arrow',
                  x: worldPos.x,
                  y: worldPos.y,
                  width: 15,
                  height: 15,
                  content: '',
                  style: {
                    startX: worldPos.x,
                    startY: worldPos.y,
                    endX: worldPos.x,
                    endY: worldPos.y,
                    pointerType: aStyle.pointerType,
                    color: aStyle.color,
                    thickness: aStyle.thickness,
                    dashStyle: aStyle.dashStyle,
                  }
                });
                setActiveArrowId(obj.id);
              } else {
                // Second click: finalize the arrow. It carries no label any
                // more, so it's left selected (handles live, style panel open)
                // rather than dropped into a text caret.
                setSelectedId(activeArrowId);
                setActiveArrowId(null);
                setMode('select');
              }
            } else if (mode === 'shape') {
              const activeShape = useCanvasStore.getState().selectedShapeType || 'square';
              // The finish is chosen in the rail alongside the shape, so the
              // stamp lands looking the way the picker previewed it.
              const finish = useCanvasStore.getState().shapeStyle;
              const obj = addObject({
                type: 'shape',
                x: worldPos.x - 75, // Center the 150x150 shape at click position
                y: worldPos.y - 75,
                width: 150,
                height: 150,
                content: '',
                style: {
                  shapeType: activeShape,
                  color: finish.color,
                  borderColor: finish.borderColor,
                }
              });
              // Selected, not editing: a shape holds no text, so there is
              // nothing to type into once it lands.
              setSelectedId(obj.id);
              setMode('select');
            } else if (mode === 'frame') {
              const draftKind = useCanvasStore.getState().frameDraftKind;
              const obj = addObject({
                type: 'frame',
                x: worldPos.x - 240,
                y: worldPos.y - 160,
                width: 480,
                height: 320,
                content: '',
                zIndex: 0,
                style: {
                  // Grouping frames take the colour picked in the rail; every
                  // other kind is locked to its identity colour by the renderer.
                  frameColor: useCanvasStore.getState().frameDraftColor,
                  ...(draftKind !== 'normal' ? { frameKind: draftKind } : {}),
                },
              });
              setSelectedId(obj.id);
              setEditingId(obj.id);
              setMode('select');
            } else if (mode === 'relax') {
              // No-op until an effect is picked, so a stray click can't fire a
              // burst the user never chose.
              if (useCanvasStore.getState().relaxEffect) {
                window.dispatchEvent(
                  new CustomEvent('spawn-relax-burst', { detail: { x: worldPos.x, y: worldPos.y } })
                );
              }
            } else if (mode === 'brainstorm') {
              // Only the Pin tool acts on empty board — it drops a push-pin and
              // stays armed so you can pin several in a row. Clip works on notes,
              // and a click on nothing while threading just lets the anchor go.
              const store = useCanvasStore.getState();
              if (store.brainstormTool === 'pin') {
                store.addPin(worldPos.x, worldPos.y);
              } else if (store.brainstormTool === 'thread') {
                store.setThreadAnchorId(null);
              }
            } else {
              const ts = useCanvasStore.getState().textStyle;
              const obj = addObject({
                type: 'text',
                x: worldPos.x,
                y: worldPos.y,
                // Start small: the block hugs the text and grows out with it, up
                // to the 900px column where it wraps (CanvasObject syncs this).
                width: 160,
                height: 44,
                content: '',
                style: {
                  fontSize: ts.fontSize,
                  fontFamily: ts.fontFamily,
                  fontWeight: ts.fontWeight,
                  textColor: ts.textColor,
                  bgColor: ts.bgColor,
                  textAlign: ts.textAlign,
                  headingLevel: ts.headingLevel,
                },
              });
              setSelectedId(obj.id);
              setEditingId(obj.id);
              if (mode === 'text') setMode('select');
            }
          }
        }
      }
    },
    [mode, addObject, setSelectedId, setEditingId, setMode, activeArrowId, setActiveArrowId, diveTo]
  );

  /* Dismiss the Plugins dropdown on an outside click — same contract as the
     insert menu: a listener rather than a full-screen backdrop, so the canvas
     stays scrollable and zoomable underneath while it's open. The pill itself
     is excluded so its own click toggles the menu shut instead of this closing
     it and the click immediately reopening it. */
  useEffect(() => {
    if (!pluginsPanelOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('.plugins-menu') || el?.closest?.('[data-plugins-button]')) return;
      setPluginsPanelOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [pluginsPanelOpen, setPluginsPanelOpen]);

  /* Scenes gets the same treatment. It's a workspace rather than a menu, so a
     click inside it (renaming a scene, reordering, flying to one) must not
     close it — only a click that lands outside does. */
  useEffect(() => {
    if (!scenesMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('.scenes-menu') || el?.closest?.('[data-scenes-button]')) return;
      setScenesMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setScenesMenuOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [scenesMenuOpen]);

  /* Same contract for the ▾ board menu, plus Escape — a menu opened by an
     explicit click needs an equally explicit way out. */
  useEffect(() => {
    if (!boardMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('.board-menu') || el?.closest?.('[data-board-menu-button]')) return;
      setBoardMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBoardMenuOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [boardMenuOpen]);

  /* Background, Stress Reliefer and Flow Mode share one contract: click outside
     or press Escape to dismiss. The background and relax pickers additionally
     close on any click that lands on the board — you're choosing how the canvas
     LOOKS, and you can't judge that through a card sitting on top of it. Flow
     Mode is a settings sheet, so it stays put until dismissed. */
  useEffect(() => {
    if (!bgMenuOpen && !relaxMenuOpen && !flowMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      const inside = (sel: string) => !!el?.closest?.(sel);
      // Each row is excluded from its own dropdown's dismissal, or the mousedown
      // would close it a beat before the click reopened it.
      if (!inside('.bg-menu') && !inside('[data-bg-button]')) setBgMenuOpen(false);
      if (!inside('.relax-menu') && !inside('[data-relax-button]')) setRelaxMenuOpen(false);
      if (!inside('.flow-menu') && !inside('[data-flow-button]')) setFlowMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setBgMenuOpen(false);
      setRelaxMenuOpen(false);
      setFlowMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [bgMenuOpen, relaxMenuOpen, flowMenuOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if typing in input/contenteditable
      const target = e.target as HTMLElement;
      if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') {
          target.blur();
          setFocusedId(null);
        }
        return;
      }

      // ? = toggle the keyboard shortcuts cheatsheet
      if (e.key === '?') {
        e.preventDefault();
        setShowShortcuts((s) => !s);
        return;
      }

      // F2 = rename the selected frame (the conventional rename key, and a
      // keyboard route to the title tab that doesn't depend on hitting it).
      if (e.key === 'F2') {
        const sel = useCanvasStore.getState().selectedId;
        const selObj = sel ? useCanvasStore.getState().objects.find((o) => o.id === sel) : null;
        if (selObj?.type === 'frame') {
          e.preventDefault();
          setEditingId(selObj.id);
        }
        return;
      }

      // F = zoom to fit everything on screen
      if (e.key === 'f' || e.key === 'F') {
        const objs = useCanvasStore.getState().objects;
        if (objs.length === 0) return;
        const minX = Math.min(...objs.map((o) => o.x));
        const minY = Math.min(...objs.map((o) => o.y));
        const maxX = Math.max(...objs.map((o) => o.x + o.width));
        const maxY = Math.max(...objs.map((o) => o.y + o.height));
        const pad = 120;
        const w = maxX - minX + pad * 2;
        const h = maxY - minY + pad * 2;
        const zoom = Math.min(window.innerWidth / w, window.innerHeight / h, 1.2);
        useCanvasStore.getState().animateCamera({
          x: window.innerWidth / 2 - (minX + (maxX - minX) / 2) * zoom,
          y: window.innerHeight / 2 - (minY + (maxY - minY) / 2) * zoom,
          zoom,
        }, 700);
        return;
      }

      // Space = temporary pan
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setPreviousMode(mode);
        setMode('pan');
        return;
      }

      // D = draw mode
      if (e.key === 'd' || e.key === 'D') {
        if (!e.repeat) {
          setPreviousMode(mode);
          setMode('draw');
        }
        return;
      }

      // T = text mode
      if (e.key === 't' || e.key === 'T') {
        setMode('text');
        return;
      }

      // S = shape mode
      if (e.key === 's' || e.key === 'S') {
        setMode('shape');
        return;
      }

      // A = arrow mode (deselect so the panel shows arrow tool defaults)
      if (e.key === 'a' || e.key === 'A') {
        setMode('arrow');
        setSelectedId(null);
        return;
      }

      // R = frame/region mode
      if (e.key === 'r' || e.key === 'R') {
        setMode('frame');
        return;
      }

      // V = select mode
      if (e.key === 'v' || e.key === 'V') {
        setMode('select');
        return;
      }

      // Escape = gather an open pile / exit focus mode / deselect
      if (e.key === 'Escape') {
        // Innermost thing first: a spread pile is the most recent thing you
        // opened, so it's the first thing Escape should close.
        if (useCanvasStore.getState().spreadStackId) {
          useCanvasStore.getState().setSpreadStack(null);
        } else if (focusedId) {
          setFocusedId(null);
        } else if (canvasStack.length > 0) {
          popCanvas();
        } else {
          setSelectedId(null);
          setEditingId(null);
        }
        return;
      }

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // A selected connector is the smaller, more recent thing — it goes first.
        const connId = useCanvasStore.getState().selectedConnectionId;
        if (connId) {
          useCanvasStore.getState().removeConnection(connId);
          return;
        }
        if (selectedId) {
          const obj = objects.find((o) => o.id === selectedId);
          if (obj) {
            const relatedConns = connections.filter(c => c.fromId === obj.id || c.toId === obj.id);
            addToTrash({
              id: obj.id,
              label: (obj.content || obj.type || 'Card').slice(0, 24),
              color: obj.style?.color as string | undefined,
              originX: window.innerWidth / 2,
              originY: window.innerHeight / 2,
              objectData: obj,
              connectionsData: relatedConns,
            });
          }
          removeObject(selectedId);
          dbDeleteObject(selectedId);
        }
        return;
      }

      // Ctrl+F = search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }

      // Ctrl+K = command palette
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      // Ctrl+Z = undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl+Shift+Z = redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // Release space -> return to previous mode
      if (e.code === 'Space') {
        setMode(previousMode);
      }
      // Release D -> return to previous mode
      if (e.key === 'd' || e.key === 'D') {
        setMode(previousMode);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [mode, previousMode, selectedId, focusedId, canvasStack, setMode, setPreviousMode, setSelectedId, setFocusedId, setSearchOpen, setCommandPaletteOpen, removeObject, undo, redo, popCanvas]);

  // Drag and drop ANY file — images become image cards; everything else (pdf,
  // docx, pptx, xlsx, zip, code, …) becomes a readable File block the agent can
  // inspect and answer questions about.
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const dt = e.dataTransfer;
      const origin = screenToCanvas(e.clientX, e.clientY, useCanvasStore.getState().camera);

      // 0a) A block pulled out of the Singularity search — recreate a fresh copy
      //     of it (from this or any other canvas) right where it was dropped.
      const singPayload = dt.getData('application/x-mindspace-object');
      if (singPayload) {
        try {
          const p = JSON.parse(singPayload) as Partial<import('@/lib/db').CanvasObjectData>;
          const w = p.width || 300;
          const h = p.height || 180;
          const created = addObject({
            type: (p.type as import('@/lib/db').CanvasObjectData['type']) || 'text',
            x: origin.x - w / 2,
            y: origin.y - h / 2,
            width: w,
            height: h,
            content: p.content || '',
            style: p.style ? { ...p.style } : undefined,
            rotation: p.rotation,
          });
          // Close the search well and select the fresh copy so it's never left
          // hidden behind the overlay after a drop.
          useCanvasStore.getState().setSingularityOpen(false);
          setSelectedId(created.id);
        } catch {
          /* malformed payload — ignore */
        }
        return;
      }

      // 0) A dragged folder → a Code Repo explorer (file tree + syntax
      //    highlighting). Entries must be read synchronously, before any await.
      const dropEntries = collectDropEntries(dt);
      if (hasDirectoryEntry(dropEntries)) {
        void ingestDroppedFolder(dropEntries, origin.x, origin.y);
        return;
      }

      // 1) Real files (from disk) keep their rich file-ingest treatment.
      const files = Array.from(dt.files);
      if (files.length > 0) {
        files.forEach((file, i) => {
          ingestFile(file, origin.x + (i % 3) * 330, origin.y + Math.floor(i / 3) * 170);
        });
        return;
      }

      // 2) An image/logo dragged out of the embedded browser (or another tab /
      //    app). Native drag carries a URL, not a file, so resolve it here.
      let src = '';
      let w = 0;
      let h = 0;
      const custom = dt.getData('application/x-mindspace-image');
      if (custom) {
        try {
          const p = JSON.parse(custom);
          src = p.src || '';
          w = p.w || 0;
          h = p.h || 0;
        } catch {
          /* ignore */
        }
      }
      const html = dt.getData('text/html');
      if (!src && html) {
        const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (m) src = m[1];
      }
      const uri = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim();
      const firstUrl = uri
        .split('\n')
        .map((s) => s.trim())
        .find((s) => /^https?:\/\//i.test(s));

      const looksLikeImage = (u: string) =>
        !!custom || (!!html && /<img/i.test(html)) || /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)(\?|#|$)/i.test(u);

      if (!src && firstUrl && looksLikeImage(firstUrl)) src = firstUrl;

      if (src && /^https?:\/\//i.test(src)) {
        const ratio = w && h ? h / w : 0.66;
        const width = 300;
        addObject({
          type: 'image',
          x: origin.x - width / 2,
          y: origin.y - (width * ratio) / 2,
          width,
          height: Math.max(80, Math.round(width * ratio)) || 200,
          content: src,
        });
        return;
      }

      // 3) A bare link dragged in → drop a link-preview card.
      if (firstUrl && isUrl(firstUrl)) {
        addObject(newLinkCard(firstUrl, origin.x - 150, origin.y - 130));
        return;
      }

      // 4) Plain text dragged in → drop a text card.
      const text = dt.getData('text/plain');
      if (text && text.trim()) {
        addObject({
          type: 'text',
          x: origin.x - 150,
          y: origin.y - 80,
          width: 300,
          height: 160,
          content: text.trim(),
        });
      }
    },
    [addObject, setSelectedId]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Paste images and links
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const pasteCam = useCanvasStore.getState().camera;
      const centerX = (window.innerWidth / 2 - pasteCam.x) / pasteCam.zoom;
      const centerY = (window.innerHeight / 2 - pasteCam.y) / pasteCam.zoom;

      /* ONE paste = ONE image. A single copied picture arrives as SEVERAL
         clipboard entries — Chrome carries it as image/png AND text/html with an
         <img> in it, some apps offer image/png and image/jpeg of the same bitmap.
         Adding an object per entry is what multiplied the image on the canvas.
         So: take the first image entry and ignore the rest. */
      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
      const file = imageItem?.getAsFile() ?? null;

      if (file) {
        e.preventDefault(); // never let the bitmap also land as junk in a text field
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const src = ev.target?.result as string;
          if (!src) return;
          // Size it from the image's REAL pixels, at its own aspect ratio.
          const { width, height } = await fitImageBox(src);
          addObject({
            type: 'image',
            x: centerX - width / 2,
            y: centerY - height / 2,
            width,
            height,
            content: src,
          });
        };
        reader.readAsDataURL(file);
        return;
      }

      // Don't hijack pastes into a text field — only turn a URL pasted onto the
      // bare canvas into a link-preview card (typing a URL into a block + Enter
      // is handled separately in CanvasObject).
      const active = document.activeElement as HTMLElement | null;
      const inField =
        !!active &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (inField) return;

      const text = (e.clipboardData?.getData('text') || '').trim();
      if (isUrl(text)) {
        e.preventDefault();
        addObject({
          type: 'browser',
          x: centerX - 400,
          y: centerY - 300,
          width: 800,
          height: 600,
          content: text,
        });
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [addObject]);

  // Viewport culling: only mount objects that intersect the visible area (plus a
  // margin). Without this, a large stored canvas mounts every card at once and can
  // lock up the browser on load.
  const visibleObjects = useMemo(() => {
    const deduped = Array.from(new Map(objects.map((o) => [o.id, o])).values()).filter(
      (o) => !o.style?.isMinimized
    );
    if (typeof window === 'undefined') return deduped;

    // Live, not the quantised key: the key decides WHEN to recompute, the
    // store decides what the answer is.
    const cam = useCanvasStore.getState().camera;
    const margin = 400; // screen px of slack around the viewport
    const minX = (-cam.x - margin) / cam.zoom;
    const minY = (-cam.y - margin) / cam.zoom;
    const maxX = (window.innerWidth - cam.x + margin) / cam.zoom;
    const maxY = (window.innerHeight - cam.y + margin) / cam.zoom;

    return deduped.filter(
      (o) =>
        o.id === selectedId ||
        o.id === editingId ||
        o.id === focusedId ||
        /* An open pile blooms outward from a single shared x/y, so its far
           cards can land well past the cull margin while the pile itself sits
           comfortably on screen — and half the spread would simply not mount. */
        (spreadStackId && o.style?.stackId === spreadStackId) ||
        o.style?.linkIsPlaying ||
        (o.x + o.width >= minX && o.x <= maxX && o.y + o.height >= minY && o.y <= maxY)
    );
    // `cullKey` (not `camera`) on purpose — see the note above it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, cullKey, selectedId, editingId, focusedId, spreadStackId]);

  /* Leaving brainstorm mode drops any half-tied thread, so re-entering later
     never starts you mid-connection against a pin you've forgotten about. */
  useEffect(() => {
    if (mode !== 'brainstorm' && threadAnchorId) {
      useCanvasStore.getState().setThreadAnchorId(null);
    }
  }, [mode, threadAnchorId]);

  /* Singularity handoff — a cross-canvas result set `pendingFocusId` and then
     navigated here. The moment that object exists on the freshly loaded board,
     fly to it and pulse it. Selecting it forces it past the viewport cull so its
     DOM node is present for the pulse even if it started off-screen. The fly is
     deferred a tick so the canvas-load's own camera restore can't override it,
     and a stale id gives up after a while so it can't hijack a later load. */
  useEffect(() => {
    if (!pendingFocusId) return;
    const target = objects.find((o) => o.id === pendingFocusId);
    if (!target) {
      const giveUp = setTimeout(() => setPendingFocusId(null), 8000);
      return () => clearTimeout(giveUp);
    }
    setSelectedId(target.id);
    setPendingFocusId(null);
    const zoom = 1;
    const tx = window.innerWidth / 2 - (target.x + target.width / 2) * zoom;
    const ty = window.innerHeight / 2 - (target.y + target.height / 2) * zoom;
    const flyT = setTimeout(() => {
      useCanvasStore.getState().animateCamera({ x: tx, y: ty, zoom }, 850);
      setTimeout(() => {
        const el = document.querySelector(`[data-object-id="${target.id}"]`);
        if (el) {
          el.classList.add('result-pulse');
          setTimeout(() => el.classList.remove('result-pulse'), 4500);
        }
      }, 900);
    }, 90);
    return () => clearTimeout(flyT);
  }, [pendingFocusId, objects, setSelectedId, setPendingFocusId]);


  return (
    <>
      {/* Canvas container */}
      <div
        ref={containerRef}
        className={`canvas-container paper-texture mode-${mode}${
          mode === 'relax' && relaxEffect ? ` relax-${relaxEffect}` : ''
        }${mode === 'brainstorm' ? ` tool-${brainstormTool}` : ''}${
          /* The cursor is the whole tutorial for diving: out here it turns into
             a magnifier, so "click to get closer" is offered rather than
             explained. */
          mode === 'select' && diveReady ? ' dive-ready' : ''
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Grid — positioned by paintCamera, not by React. */}
        <div ref={gridRef} className="canvas-grid" />

        {/* World transform layer.
            No `transform` from React state on purpose: the camera is painted
            straight onto this node by paintCamera, sixty times a second,
            without re-rendering the board. See THE CAMERA PIPELINE above. */}
        <div ref={worldRef} className="canvas-world">
          {/* Connections Layer (Behind objects) */}
          <ConnectionsLayer />

          {/* Render objects (viewport-culled). Objects always render as their
              full real component at every zoom level. */}
          {visibleObjects.map((obj) => (
            <div key={obj.id} data-object-id={obj.id}>
              <CanvasObject
                obj={obj}
                isSelected={selectedId === obj.id}
                isFocused={focusedId === obj.id}
              />
            </div>
          ))}

          {/* Cinematic Stress Reliefer particles */}
          <RelaxEffectsLayer />
        </div>

        {/* Drawing layer (SVG overlay) */}
        <DrawingLayer />

        {/* Focus mode overlay */}
        <AnimatePresence>
          {focusedId && (
            <motion.div
              className="focus-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              onClick={() => setFocusedId(null)}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Breadcrumb for nested canvases */}
      <AnimatePresence>
        {canvasStack.length > 0 && (
          <motion.div
            className="fixed top-11 left-1/2 -translate-x-1/2 z-50"
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
          >
            <div className="glass-panel px-4 py-2 flex items-center gap-2 text-sm">
              <button
                onClick={() => popCanvas()}
                className="text-[var(--accent)] hover:underline font-light"
              >
                ← Back
              </button>
              <span className="text-[var(--text-muted)]">/</span>
              <span className="text-[var(--text-secondary)] font-light">
                {objects.find((o) => o.id === canvasStack[canvasStack.length - 1])?.content || 'Sub-space'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Glow cursor */}
      <GlowCursor isDrawMode={mode === 'draw'} />

      {/* Zoom indicator removed as requested - moved to Minimap */}

      {/* Welcome hint for empty canvas */}
      <AnimatePresence>
        {loaded && objects.length === 0 && strokes.length === 0 && (
          <motion.div
            className="fixed inset-0 flex items-center justify-center pointer-events-none z-10"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ delay: 0.5, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="text-center">
              <h2
                className="text-3xl mb-3 text-[var(--text-muted)]"
                style={{ fontFamily: "'Inter', sans-serif", fontWeight: 500 }}
              >
                Your mind space awaits
              </h2>
              <p className="text-sm text-[var(--text-muted)] font-light max-w-xs mx-auto leading-relaxed opacity-70">
                Click anywhere to type · Hold <kbd className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-tertiary)] font-mono">D</kbd> to draw · Scroll to zoom
              </p>
              <p className="text-xs text-[var(--text-muted)] font-light mt-3 opacity-50">
                Press <kbd className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-tertiary)] font-mono">⌘K</kbd> for all commands
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Connectors: one panel at the top of the screen that is both the tool
          (in connector mode) and the editor for whichever link is selected.
          It replaced a bare "Exit Connector Mode" pill — the mode had a way
          out and no way to say what kind of line you wanted. */}
      <ConnectorPanel />

      {/* Brainstorm Mode HUD — names the active tool, guides the thread flow,
          and offers a one-click exit. Mirrors the connector-mode banner. */}
      <AnimatePresence>
        {mode === 'brainstorm' && (
          <motion.div
            className="fixed top-12 left-1/2 -translate-x-1/2 z-[100] pointer-events-auto"
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            <div className="glass-panel px-4 py-2 flex items-center gap-3">
              <span className="text-xs font-medium tracking-wide text-[var(--text-primary)]">
                {brainstormTool === 'pin'
                  ? 'Click the board to drop a pin'
                  : brainstormTool === 'clip'
                  ? 'Click a note to clip it'
                  : threadAnchorId
                  ? 'Now tap another pin to tie the thread'
                  : 'Tap a pin to start a thread'}
              </span>
              <button
                onClick={() => setMode('select')}
                className="flex items-center gap-1.5 pl-2.5 border-l border-[var(--border)] text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
              >
                <span className="w-4 h-4 rounded-full bg-[var(--accent-subtle)] flex items-center justify-center text-[var(--accent)] text-[10px]">✕</span>
                Done
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Noise overlay */}
      <div className="noise-overlay" />

      {/* Hand-drawn "sloppiness" filters referenced by shapes via CSS filter:url() */}
      <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
        <defs>
          <filter id="ms-rough-1" x="-8%" y="-8%" width="116%" height="116%">
            <feTurbulence type="fractalNoise" baseFrequency="0.016" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id="ms-rough-2" x="-12%" y="-12%" width="124%" height="124%">
            <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="13" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          {/* "Tap to cycle" clip masks for image & camera-mirror blocks.
              objectBoundingBox units (0..1) so one clip fits any block size. */}
          {(Object.keys(IMAGE_SHAPE_CLIP) as (keyof typeof IMAGE_SHAPE_CLIP)[]).map((shape) => {
            const clip = IMAGE_SHAPE_CLIP[shape];
            return (
              <clipPath key={shape} id={imageClipId(shape)} clipPathUnits="objectBoundingBox">
                {clip.kind === 'circle' ? (
                  <circle cx="0.5" cy="0.5" r="0.5" />
                ) : clip.kind === 'polygon' ? (
                  <polygon points={clip.points} />
                ) : (
                  <path d={clip.d} />
                )}
              </clipPath>
            );
          })}
        </defs>
      </svg>

      {/* UI overlays */}
      {/* No `relative` here on purpose — it and `fixed` are the same Tailwind
          property group, so which one won would come down to stylesheet order,
          not the order they're written in. A fixed element is already a
          containing block, so the Plugins dropdown's `absolute` anchors to it. */}
      <div className="canvas-chrome board-header fixed top-12 left-10 z-50 pointer-events-auto flex flex-col items-start">
        <div className="group/head flex items-center gap-2.5">
          {isEditingTitle ? (
            <input
              autoFocus
              type="text"
              value={workspaceTitle}
              onChange={(e) => setWorkspaceTitle(e.target.value)}
              onBlur={() => setIsEditingTitle(false)}
              onKeyDown={(e) => e.key === 'Enter' && setIsEditingTitle(false)}
              className="bg-white/80 dark:bg-white/10 border-none outline-none text-2xl text-[var(--text-primary)] w-80 px-4 py-2 rounded-xl transition-all shadow-xl backdrop-blur-md"
              placeholder="Untitled Workspace"
              style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 300 }}
            />
          ) : (
            <button
              onClick={() => setIsEditingTitle(true)}
              className="group flex flex-col items-start text-left"
            >
              <h1
                className="text-2xl text-[var(--text-primary)] transition-all group-hover:text-[var(--accent)]"
                style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 300, letterSpacing: '-0.02em' }}
              >
                {truncatedTitle}
              </h1>
              <div className="h-px w-0 group-hover:w-full bg-[var(--accent)] transition-all duration-300 opacity-30" />
            </button>
          )}

          {/* The board menu's handle: a plain ▾ next to the name. Visible at all
              times (it no longer hides behind a hover on the title), it rotates
              to ▴ while open, and shows an accent dot when something inside is
              live — a skill set applied, a panel open — so state the user turned
              on is never buried in a closed menu. */}
          {!isEditingTitle && (() => {
            const skillActive = isSkillsetActive(skillset);
            const anyActive = skillActive || pluginsPanelOpen || scenesMenuOpen
              || flowEnabled || !!relaxEffect || bgMenuOpen || relaxMenuOpen || flowMenuOpen;
            return (
              <button
                data-board-menu-button
                onClick={() => setBoardMenuOpen((v) => !v)}
                title="Board actions — share, skill set, plugins, collaborate"
                aria-label="Board actions"
                aria-expanded={boardMenuOpen}
                className="relative shrink-0 flex items-center justify-center rounded-full border transition-all duration-200 cursor-pointer"
                style={{
                  width: 24, height: 24,
                  background: boardMenuOpen ? 'var(--accent-subtle)' : 'var(--bg-glass)',
                  borderColor: boardMenuOpen ? 'rgba(var(--accent-rgb),0.45)' : 'var(--border)',
                  color: boardMenuOpen ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                <motion.svg
                  width="11" height="11" viewBox="0 0 24 24" fill="currentColor"
                  aria-hidden="true"
                  animate={{ rotate: boardMenuOpen ? 180 : 0 }}
                  transition={{ type: 'spring', damping: 22, stiffness: 300 }}
                >
                  <path d="M12 16.5 4.5 8h15z" />
                </motion.svg>
                {anyActive && !boardMenuOpen && (
                  <span
                    className="absolute -top-0.5 -right-0.5 rounded-full"
                    style={{ width: 7, height: 7, background: 'var(--accent)', boxShadow: '0 0 0 2px var(--bg-primary)' }}
                  />
                )}
              </button>
            );
          })()}
        </div>

        {/* Board actions, vertically. Anchored under the title row. */}
        <AnimatePresence>
          {boardMenuOpen && !isEditingTitle && (() => {
            const skillActive = isSkillsetActive(skillset);
            const ruleCount = activeRuleCount(skillset);
            const close = () => setBoardMenuOpen(false);
            return (
              <motion.div
                key="board-menu"
                className="board-menu absolute left-0 top-full z-[120]"
                style={{ marginTop: 10 }}
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="tool-panel flex flex-col gap-0.5" style={{ padding: 7, width: 244 }}>
                  {/* Two groups, and the separator between them is what keeps
                      this readable at eight rows: how the board LOOKS and FEELS
                      first (background, mood, focus — the three that came in
                      from the drawing toolbar), then what you DO with it. */}
                  <MenuRow
                    onClick={() => { close(); setRelaxMenuOpen(false); setFlowMenuOpen(false); setBgMenuOpen((v) => !v); }}
                    label="Background"
                    hint="Paper, colour & light for this board"
                    active={bgMenuOpen}
                    data-bg-button
                  >
                    {/* a paint drop over a filled half-disc — the same mark the
                        toolbar button carried, so it's still recognisable */}
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
                  </MenuRow>

                  <MenuRow
                    onClick={() => { close(); setBgMenuOpen(false); setFlowMenuOpen(false); setRelaxMenuOpen((v) => !v); }}
                    label="Stress Reliefer"
                    hint="Fifteen ways to let a thought go"
                    active={relaxMenuOpen}
                    dot={!!relaxEffect}
                    data-relax-button
                  >
                    <ellipse cx="11" cy="12.5" rx="7.2" ry="3.8" transform="rotate(20 11 12.5)" />
                    <ellipse cx="13" cy="11.5" rx="6.8" ry="4.2" transform="rotate(-40 13 11.5)" />
                    <ellipse cx="12" cy="12" rx="7.5" ry="3.5" transform="rotate(70 12 12)" />
                  </MenuRow>

                  <MenuRow
                    onClick={() => { close(); setBgMenuOpen(false); setRelaxMenuOpen(false); setFlowMenuOpen((v) => !v); }}
                    label="Flow Mode"
                    hint="Cinematic focus writing"
                    active={flowMenuOpen}
                    dot={flowEnabled}
                    data-flow-button
                  >
                    <path d="M5.4 6.6c2.2-2.3 4.4-2.3 6.6 0s4.4 2.3 6.6 0" opacity="0.5" />
                    <path d="M3 12c3-3.1 6-3.1 9 0s6 3.1 9 0" />
                    <path d="M5.4 17.4c2.2-2.3 4.4-2.3 6.6 0s4.4 2.3 6.6 0" opacity="0.5" />
                  </MenuRow>

                  <div className="w-full h-px shrink-0" style={{ background: 'var(--border)', margin: '5px 0' }} />

                  {/* Scenes leads the second group: it's the one row that opens a
                      workspace of its own rather than firing an action. A dot
                      says "there are scenes in here" — the exact number was
                      noise, since the list itself is one click away. */}
                  <MenuRow
                    onClick={() => { close(); setPluginsPanelOpen(false); setScenesMenuOpen((v) => !v); }}
                    label="Scenes"
                    hint="Present this board as a guided tour"
                    active={scenesMenuOpen}
                    dot={sceneCount > 0}
                    data-scenes-button
                  >
                    {/* a slide with a play head on it, and the deck behind */}
                    <path d="M6.5 18.5H5A1.5 1.5 0 0 1 3.5 17V7" opacity="0.45" />
                    <rect x="6.5" y="4" width="14" height="12.5" rx="2" />
                    <path d="M11.8 8.2v4.1l3.6-2.05z" fill="currentColor" stroke="none" />
                    <path d="M13.5 16.5v3.2" />
                    <path d="M10.6 20.4h5.8" />
                  </MenuRow>

                  <MenuRow
                    onClick={() => { close(); setShowShare(true); }}
                    label="Share"
                    hint="View-only link, or export as image / PDF"
                  >
                    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </MenuRow>

                  <MenuRow
                    onClick={() => { close(); setSkillSetPanelOpen(true); }}
                    label="Skill Set"
                    hint="Rules the agent follows on this canvas"
                    active={skillActive}
                    badge={skillActive && ruleCount > 0 ? ruleCount : undefined}
                  >
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    <path d="M9 7h7M9 11h5" />
                  </MenuRow>

                  <MenuRow
                    onClick={() => { close(); setPluginsPanelOpen(!pluginsPanelOpen); }}
                    label="Plugins"
                    hint="Embeds, GitHub & more"
                    active={pluginsPanelOpen}
                    data-plugins-button
                  >
                    <path d="m19 5 2.5-2.5" /><path d="m2.5 21.5 2.5-2.5" />
                    <path d="M6.8 20.4a2.4 2.4 0 0 0 3.4 0l2.3-2.3-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
                    <path d="m7.5 13.5 2-2" /><path d="m10.5 16.5 2-2" />
                    <path d="M12 6l6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
                  </MenuRow>

                  {/* Only the idle entry point lives here. Once a session is
                      live, CollabBar takes over with its own top-centre status
                      bar — that one must stay visible, not sit behind a menu. */}
                  {!collabActive && (
                    <MenuRow
                      onClick={() => { close(); openCollabModal(); }}
                      label="Collaborate"
                      hint="Work on this canvas live, together"
                    >
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                    </MenuRow>
                  )}
                </div>
              </motion.div>
            );
          })()}
        </AnimatePresence>
        {canvasStack.length > 0 && (
          <button
            onClick={() => popCanvas()}
            className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--accent)] mt-2 transition-colors flex items-center gap-1"
          >
            <span className="text-xs">←</span> Parent Space
          </button>
        )}

        {/* Scenes, hanging off the board menu that opened it. Same anchor and
            same dismissal contract as Plugins below. */}
        <AnimatePresence>
          {scenesMenuOpen && (
            <motion.div
              key="scenes-dropdown"
              className="scenes-menu absolute left-0 top-full z-[120]"
              style={{ marginTop: 12 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <ScenesList onPlay={() => setScenesMenuOpen(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Plugins, as a dropdown hanging off its own pill — the same shape and
            dismissal contract as the insert (+) menu, rather than a panel
            floating up out of the toolbar. */}
        <AnimatePresence>
          {pluginsPanelOpen && (
            <motion.div
              key="plugins-dropdown"
              className="plugins-menu absolute left-0 top-full z-[120]"
              style={{ marginTop: 12 }}
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <PluginsPanel onClose={() => setPluginsPanelOpen(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Canvas background — same anchor, same motion, same dismissal as
            Scenes and Plugins. It used to fly up out of the toolbar; hanging it
            off the board's name puts the control next to the thing it changes. */}
        <AnimatePresence>
          {bgMenuOpen && (
            <motion.div
              key="bg-dropdown"
              className="bg-menu absolute left-0 top-full z-[120]"
              style={{ marginTop: 12 }}
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Same `tool-panel` surface and padding it had in the toolbar —
                  only the anchor moved. */}
              <div className="tool-panel" style={{ padding: 16 }}>
                <CanvasBackgroundPanel onPick={() => setBgMenuOpen(false)} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {relaxMenuOpen && (
            <div className="relax-menu absolute left-0 top-full z-[120]" style={{ marginTop: 12 }}>
              <RelaxPanel onClose={() => setRelaxMenuOpen(false)} />
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {flowMenuOpen && (
            <motion.div
              key="flow-dropdown"
              className="flow-menu absolute left-0 top-full z-[120]"
              style={{ marginTop: 12 }}
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <FlowModePanel onClose={() => setFlowMenuOpen(false)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Flow Mode: cinematic focus-writing overlay (spotlight, weather, progress) */}
      <FlowModeLayer />

      {/* Constellation View: a dark, user-composed star map of the board.
          Opened from the minimap; portals itself to <body>; renders only when
          `constellationOpen`. */}
      <ConstellationView />

      {/* Immersive PDF Reader: cinematic reading room for a dropped PDF.
          Opened from a PDF file block; portals to <body>; renders only when a
          PDF is open (usePdfReaderStore). */}
      <PdfReaderLayer />

      {/* Every piece of app chrome, in ONE wrapper.
          A tour is a presentation, and `.tour-mode` used to hide only four of
          these by class — so the title, Share, collab bar, sign-in and chat
          launcher all stayed on screen over the slide. Grouping them means the
          tour hides the chrome wholesale instead of by enumeration, and nothing
          new has to remember to opt in. The wrapper is an unstyled, unpositioned
          div, so it creates no stacking context and every `fixed` child keeps
          the exact position and z-index it had. */}
      <div className="canvas-chrome">
        <FloatingToolbar />
        <SpatialSearch />
        <SingularitySearch />
        <CommandPalette />
        <PlusMenu />
        <SlashCommandMenu />
        <AtMentionMenu />
        <AgentOverlay />
        <SkillSetPanel />
        {/* One docked panel for whatever you're doing: the selection's
            properties, or the options of the tool you're holding. */}
        <ContextRail />
        {/* Controls for whichever frame is selected — kind picker, bulk delete,
            slide capture, and the Ask-AI box for agent frames. */}
        <FrameHUD />
        <Minimap />
        {/* Zoom / fit, for a screen with no wheel and no minimap. */}
        <MobileViewControls />
        {/* Scrolled off into empty space? One chip, pointing home. */}
        <ReturnToWork />

        {/* Just dived in? The view you came from, held for a few seconds behind
            one chip. A camera move the user didn't type has to be undoable, and
            re-finding an overview by hand is the most annoying way to spend a
            wheel. It sits in the same top-centre slot as ReturnToWork, which
            can't be on screen at the same time — that one only appears when
            NOTHING is in view, and a dive always lands on something. */}
        <AnimatePresence>
          {diveBack && (
            <motion.button
              key="dive-back"
              onClick={() => {
                useCanvasStore.getState().animateCamera(diveBack, 560);
                setDiveBack(null);
              }}
              initial={{ opacity: 0, y: -12, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.94 }}
              transition={{ type: 'spring', damping: 24, stiffness: 300 }}
              className="fixed left-1/2 -translate-x-1/2 z-[144] flex items-center gap-2.5 rounded-full clay-card cursor-pointer pointer-events-auto group flow-hideable"
              style={{ top: 16, padding: '7px 15px 7px 9px' }}
              title="Return to the view you dived in from"
            >
              <span
                className="flex items-center justify-center rounded-full shrink-0"
                style={{ width: 24, height: 24, background: 'var(--accent-subtle)', color: 'var(--accent)' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M8 11h6M20 20l-4.4-4.4" />
                </svg>
              </span>
              <span className="flex flex-col items-start leading-none" style={{ gap: 2 }}>
                <span className="text-[11.5px] font-extrabold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                  Back to overview
                </span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  {Math.round(diveBack.zoom * 100)}% view
                </span>
              </span>
            </motion.button>
          )}
        </AnimatePresence>
        <CheckpointIndex />
        <SaveIndicator />
        <TrashPile />
        <VoiceOrb />
        {/* The account avatar + name used to sit in the top-right corner of the
            board. It's a duplicate — the same control already lives on the
            landing page, which is where you sign in and out from — and on the
            canvas it was chrome competing with the work. Gone from here. */}

        {/* Live collaboration */}
        <CollabBar />
        <CollabCursors />
        {/* The AI agent's own live pointer while it builds (Miro-style) */}
        <AgentCursor />
        <CollabModal />
        <PulseLayer />

        {/* Keyboard shortcuts help (press ?) */}
        <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />

        {/* Share & export */}
        {showShare && <ShareModal onClose={() => setShowShare(false)} />}

        {/* The Pocket: a board-independent tray. Drag a block onto the rail to
            carry it, open any other canvas, drag it back out there. Replaced
            both the per-canvas minimize shelf and the Warp destination modal. */}
        <Pocket />

        {/* Human↔human DM chat (launched from the toolbar's Messages button) */}
        <ChatLauncher />
        {/* AI agent chat — corner launcher + resizable right-side panel */}
        <AgentChatPanel />
      </div>

      {/* Scenes: the tour PLAYER, and nothing else. Deliberately outside
          .canvas-chrome, because it must survive the very rule that hides the
          chrome during a presentation. The scene list lives in the ▾ board menu
          above, inside the wrapper, where it's hidden along with everything
          else the moment a tour starts. */}
      <ScenesPanel />
    </>
  );
}
