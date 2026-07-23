'use client';

import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { screenToCanvas, clamp, fitImageBox } from '@/lib/utils';
import { isUrl, newLinkCard } from '@/lib/linkPreview';
import { ingestFile } from '@/lib/fileIngest';
import { collectDropEntries, hasDirectoryEntry, ingestDroppedFolder } from '@/lib/repoIngest';
import { applyCanvasTheme, resetCanvasTheme, DEFAULT_BACKGROUND } from '@/lib/canvasTheme';
import { IMAGE_SHAPE_CLIP, imageClipId } from '@/lib/imageShapes';
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
import CanvasObject from './CanvasObject';
import RelaxEffectsLayer from './RelaxEffectsLayer';
import CanvasResident from './CanvasResident';
import ConstellationView from './ConstellationView';
import FlowModeLayer from './FlowModeLayer';
import DrawingLayer from './DrawingLayer';
import ConnectionsLayer from './ConnectionsLayer';
import FloatingToolbar from '@/components/ui/FloatingToolbar';
import SpatialSearch from '@/components/ui/SpatialSearch';
import SingularitySearch from '@/components/ui/SingularitySearch';
import CommandPalette from '@/components/ui/CommandPalette';
import PlusMenu from '@/components/ui/PlusMenu';
import SlashCommandMenu from '@/components/ui/SlashCommandMenu';
import AtMentionMenu from '@/components/ui/AtMentionMenu';
import AgentOverlay from '@/components/ui/AgentOverlay';
import SkillSetPanel from '@/components/ui/SkillSetPanel';
import { isSkillsetActive, activeRuleCount } from '@/lib/skillset';
import SelectionPanel from '@/components/ui/SelectionPanel';
import Minimap from '@/components/ui/Minimap';
import CheckpointIndex from '@/components/ui/CheckpointIndex';
import SaveIndicator from '@/components/ui/SaveIndicator';
import TrashPile from '@/components/ui/TrashPile';
import VoiceOrb from './VoiceOrb';
import AuthButton from '@/components/ui/AuthButton';
import ShortcutsOverlay from './ShortcutsOverlay';
import ShareModal from '@/components/ui/ShareModal';
import MinimizeDock from './MinimizeDock';
import WarpPortal from './WarpPortal';
import ScenesPanel from './ScenesPanel';
import FrameHUD from './FrameHUD';
import ChatLauncher from '@/components/chat/ChatLauncher';
import AgentChatPanel from '@/components/chat/AgentChatPanel';
import CollabBar from '@/components/collab/CollabBar';
import PluginsPanel from '@/components/ui/PluginsPanel';
import CollabCursors from '@/components/collab/CollabCursors';
import CollabModal from '@/components/collab/CollabModal';
import PulseLayer from '@/components/collab/PulseLayer';
import { useCollabStore } from '@/store/collabStore';

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
 * One pill, four board actions — Share, Skill Set, Plugins, Collaborate.
 *
 * These used to be three different components in three different places (an
 * always-on Share button, a hover-revealed Skill Set, a toolbar icon, and a
 * top-centre Collaborate bar), each with its own background, padding and
 * border. Sharing the surface here is what makes the row read as one control
 * cluster instead of four unrelated buttons that happen to sit near each other.
 *
 * Hidden until the canvas name is hovered, unless `active` — a pill reporting
 * live state (a skill set is applied, a panel is open) must stay visible, or
 * the user loses track of something they turned on.
 */
function HeaderPill({
  onClick, title, label, children, active = false, badge, ...rest
}: {
  onClick: () => void;
  title: string;
  label: string;
  children: React.ReactNode;
  active?: boolean;
  badge?: number;
} & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-full border shadow-sm backdrop-blur-md transition-all duration-200 cursor-pointer ${
        active
          ? 'opacity-100 translate-x-0'
          : 'opacity-0 -translate-x-1 pointer-events-none group-hover/head:opacity-100 group-hover/head:translate-x-0 group-hover/head:pointer-events-auto'
      }`}
      style={{
        padding: '5px 11px',
        background: active ? 'var(--accent-subtle)' : 'var(--bg-glass)',
        borderColor: active ? 'rgba(var(--accent-rgb),0.4)' : 'var(--border)',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
      }}
      {...rest}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
      <span className="text-[11px] font-semibold whitespace-nowrap" style={{ fontFamily: "'Outfit', sans-serif" }}>
        {label}
      </span>
      {badge !== undefined && (
        <span
          className="flex items-center justify-center text-[9px] font-bold text-white rounded-full"
          style={{ minWidth: 15, height: 15, padding: '0 4px', background: 'var(--accent)' }}
        >
          {badge}
        </span>
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

  const camera = useCanvasStore((s) => s.camera);
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
  useEffect(() => {
    async function load() {
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
            // @ts-ignore
            setObjects(defaultObjects);
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
        setLoaded(true);
      } catch (err) {
        console.error('Failed to load canvas data:', err);
        setLoaded(true);
      }
    }
    load();
  }, [canvasStack, setObjects, setStrokes, setCamera, setWorkspaceTitle, effectiveCanvasId, setCanvasBackground, setSkillset]);

  // Save on unmount to prevent losing last-second pans or edits
  useEffect(() => {
    return () => {
      const state = useCanvasStore.getState();
      const parentId = state.canvasStack.length > 0 ? state.canvasStack[state.canvasStack.length - 1] : effectiveCanvasId;
      // A guest's live collab session is a synthetic, never-persisted view —
      // nothing to save here (db.ts/syncService.ts also guard this, but
      // skipping it here avoids the wasted work entirely).
      if (parentId.startsWith(COLLAB_SESSION_ID_PREFIX)) return;

      // Always save camera position and canvas state locally on unmount
      saveCanvasState({
        id: parentId,
        title: workspaceTitle,
        camera: state.camera,
        checkpoint: checkpoint || undefined,
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
                  title: workspaceTitle,
                  camera: state.camera,
                  checkpoint: checkpoint || undefined,
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
  }, [effectiveCanvasId, workspaceTitle, checkpoint]);

  // Autosave
  useEffect(() => {
    if (!isDirty || !loaded) return;

    const timeout = setTimeout(async () => {
      try {
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
  }, [isDirty, objects, strokes, camera, checkpoint, loaded, canvasStack, effectiveCanvasId, workspaceTitle, setDirty, setLastSaved, connections, canvasBackground]);


  // Wheel zoom
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();

      /* A tour is a slideshow, not a canvas. Scrolling during one dragged the
         board out from under the slide — and for a frame scene, whose mask is
         pinned to a region, that just scrolled the content out of its own
         frame. Playback owns the camera; the arrows and Esc own navigation. */
      if (useCanvasStore.getState().isTouring) return;

      if (e.ctrlKey || e.metaKey) {
        // Smooth exponential zoom for trackpads and mouse wheels
        const zoomFactor = Math.exp(-e.deltaY * 0.005);
        const newZoom = clamp(camera.zoom * zoomFactor, MIN_ZOOM, MAX_ZOOM);

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Zoom toward cursor
        const newX = mouseX - (mouseX - camera.x) * (newZoom / camera.zoom);
        const newY = mouseY - (mouseY - camera.y) * (newZoom / camera.zoom);

        setCamera({ x: newX, y: newY, zoom: newZoom });
      } else {
        // Pan
        setCamera({
          x: camera.x - e.deltaX,
          y: camera.y - e.deltaY,
          zoom: camera.zoom,
        });
      }
    },
    [camera, setCamera]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

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
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          camX: camera.x,
          camY: camera.y,
        };
        e.preventDefault();
        return;
      }

      if (mode === 'text' || mode === 'select' || mode === 'shape' || mode === 'arrow' || mode === 'frame' || mode === 'relax' || mode === 'brainstorm') {
        // If they click empty space, we record pan start just in case it's a tiny drag
        isPanningRef.current = true;
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          camX: camera.x,
          camY: camera.y,
        };
      }

      // Deselect
      setSelectedId(null);
      setEditingId(null);
      // …and an open pile gathers itself back up. Clicking away from a thing
      // is how you're done with it everywhere else on this canvas.
      useCanvasStore.getState().setSpreadStack(null);
    },
    [mode, camera, setSelectedId, setEditingId, plusMenuPos, setPlusMenuPos]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Broadcast my cursor (in world coords) to collaborators, if in a session.
      const collab = useCollabStore.getState();
      if (collab.status === 'connected' && collab._cursorSender) {
        const world = screenToCanvas(e.clientX, e.clientY, camera);
        collab._cursorSender(world.x, world.y);
      }

      if (activeArrowId) {
        const worldPos = screenToCanvas(e.clientX, e.clientY, camera);
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

      if (isPanningRef.current) {
        // If we are in select/text mode, and drag is large enough, switch to panning the canvas optionally?
        // Wait, standard behavior: space to pan, or middle click. Left drag creates selection box (which we don't have yet), or just pans if empty canvas.
        // Let's implement empty canvas drag = pan for simplicity!
        if (mode === 'select' || mode === 'text' || mode === 'pan' || mode === 'relax' || mode === 'brainstorm') {
          const dx = e.clientX - panStartRef.current.x;
          const dy = e.clientY - panStartRef.current.y;
          setCamera({
            x: panStartRef.current.camX + dx,
            y: panStartRef.current.camY + dy,
            zoom: camera.zoom,
          });
        }
      }
    },
    [camera.zoom, mode, setCamera, activeArrowId, objects, updateObject]
  );

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
            const worldPos = screenToCanvas(e.clientX, e.clientY, camera);
            
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
                // Second click: Finalize the arrow
                setSelectedId(activeArrowId);
                setEditingId(activeArrowId);
                setActiveArrowId(null);
                setMode('select');
              }
            } else if (mode === 'shape') {
              const activeShape = useCanvasStore.getState().selectedShapeType || 'square';
              const obj = addObject({
                type: 'shape',
                x: worldPos.x - 75, // Center the 150x150 shape at click position
                y: worldPos.y - 75,
                width: 150,
                height: 150,
                content: '',
                style: {
                  shapeType: activeShape,
                  color: 'rgba(255, 252, 248, 0.75)',
                  borderColor: 'var(--accent-light)',
                }
              });
              setSelectedId(obj.id);
              setEditingId(obj.id);
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
                  frameColor: '#C97B4B',
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
    [mode, camera, addObject, setSelectedId, setEditingId, setMode, activeArrowId, setActiveArrowId]
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
      const origin = screenToCanvas(e.clientX, e.clientY, camera);

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
    [camera, addObject, setSelectedId]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Paste images and links
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const centerX = (window.innerWidth / 2 - camera.x) / camera.zoom;
      const centerY = (window.innerHeight / 2 - camera.y) / camera.zoom;

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
  }, [camera, addObject]);

  // Viewport culling: only mount objects that intersect the visible area (plus a
  // margin). Without this, a large stored canvas mounts every card at once and can
  // lock up the browser on load.
  const visibleObjects = useMemo(() => {
    const deduped = Array.from(new Map(objects.map((o) => [o.id, o])).values()).filter(
      (o) => !o.style?.isMinimized
    );
    if (typeof window === 'undefined') return deduped;

    const margin = 400; // screen px of slack around the viewport
    const minX = (-camera.x - margin) / camera.zoom;
    const minY = (-camera.y - margin) / camera.zoom;
    const maxX = (window.innerWidth - camera.x + margin) / camera.zoom;
    const maxY = (window.innerHeight - camera.y + margin) / camera.zoom;

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
  }, [objects, camera, selectedId, editingId, focusedId, spreadStackId]);

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

  // Grid background transform
  const gridStyle = {
    backgroundPosition: `${camera.x % (24 * camera.zoom)}px ${camera.y % (24 * camera.zoom)}px`,
    backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
    opacity: camera.zoom > 0.4 ? 0.35 : 0,
  };

  return (
    <>
      {/* Canvas container */}
      <div
        ref={containerRef}
        className={`canvas-container paper-texture mode-${mode}${
          mode === 'relax' && relaxEffect ? ` relax-${relaxEffect}` : ''
        }${mode === 'brainstorm' ? ` tool-${brainstormTool}` : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Grid */}
        <div className="canvas-grid" style={gridStyle} />

        {/* World transform layer */}
        <div
          className="canvas-world"
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
          }}
        >
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

          {/* The Canvas Resident — a pixel cat that lives in world space */}
          <CanvasResident />
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

      {/* Connector Mode Exit UI */}
      <AnimatePresence>
        {mode === 'connector' && (
          <motion.div
            className="fixed top-12 left-1/2 -translate-x-1/2 z-[100] pointer-events-auto"
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            <button
              onClick={() => setMode('select')}
              className="glass-panel px-5 py-2.5 flex items-center gap-3 group transition-all hover:border-[var(--accent)] hover:shadow-[0_0_20px_rgba(var(--accent-rgb),0.2)]"
            >
              <div className="w-5 h-5 rounded-full bg-[var(--accent-subtle)] flex items-center justify-center text-[var(--accent)] group-hover:bg-[var(--accent)] group-hover:text-white transition-colors">
                <span className="text-xs">✕</span>
              </div>
              <span className="text-xs font-medium tracking-wide text-[var(--text-primary)] uppercase">
                Exit Connector Mode
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

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
      <div className="canvas-chrome fixed top-12 left-10 z-50 pointer-events-auto flex flex-col items-start">
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

          {/* Board actions. All four live here, all reveal together on hovering
              the canvas name, and all share one pill so the row reads as a set
              rather than four separately-designed buttons. A pill only stays
              pinned when it's reporting live state the user must not lose track
              of — an applied skill set, an open panel. */}
          {!isEditingTitle && (() => {
            const skillActive = isSkillsetActive(skillset);
            const ruleCount = activeRuleCount(skillset);
            return (
              <>
                <HeaderPill onClick={() => setShowShare(true)} title="Share a view-only link or export as image / PDF" label="Share">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </HeaderPill>

                <HeaderPill
                  onClick={() => setSkillSetPanelOpen(true)}
                  title="Skill Set — rules the agent follows in this canvas"
                  label="Skill Set"
                  active={skillActive}
                  badge={skillActive && ruleCount > 0 ? ruleCount : undefined}
                >
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  <path d="M9 7h7M9 11h5" />
                </HeaderPill>

                <HeaderPill
                  onClick={() => setPluginsPanelOpen(!pluginsPanelOpen)}
                  title="Plugins — embeds, GitHub & more"
                  label="Plugins"
                  active={pluginsPanelOpen}
                  data-plugins-button
                >
                  <path d="m19 5 2.5-2.5" /><path d="m2.5 21.5 2.5-2.5" />
                  <path d="M6.8 20.4a2.4 2.4 0 0 0 3.4 0l2.3-2.3-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
                  <path d="m7.5 13.5 2-2" /><path d="m10.5 16.5 2-2" />
                  <path d="M12 6l6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
                </HeaderPill>

                {/* Only the idle entry point lives here. Once a session is live,
                    CollabBar takes over with its own top-centre status bar —
                    that one must stay visible, not hide behind a hover. */}
                {!collabActive && (
                  <HeaderPill onClick={() => openCollabModal()} title="Collaborate live on this canvas" label="Collaborate">
                    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                  </HeaderPill>
                )}
              </>
            );
          })()}
        </div>
        {canvasStack.length > 0 && (
          <button
            onClick={() => popCanvas()}
            className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--accent)] mt-2 transition-colors flex items-center gap-1"
          >
            <span className="text-xs">←</span> Parent Space
          </button>
        )}

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
      </div>
      
      {/* Flow Mode: cinematic focus-writing overlay (spotlight, weather, progress) */}
      <FlowModeLayer />

      {/* Constellation View: a dark, user-composed star map of the board.
          Opened from the minimap; portals itself to <body>; renders only when
          `constellationOpen`. */}
      <ConstellationView />

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
        <SelectionPanel />
        {/* Controls for whichever frame is selected — kind picker, bulk delete,
            slide capture, and the Ask-AI box for agent frames. */}
        <FrameHUD />
        <Minimap />
        <CheckpointIndex />
        <SaveIndicator />
        <TrashPile />
        <VoiceOrb />
        <AuthButton hideGuest={true} />

        {/* Live collaboration */}
        <CollabBar />
        <CollabCursors />
        <CollabModal />
        <PulseLayer />

        {/* Keyboard shortcuts help (press ?) */}
        <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />

        {/* Share & export */}
        {showShare && <ShareModal onClose={() => setShowShare(false)} />}

        {/* Minimize shelf: drag any object into the top-left corner to dock it */}
        <MinimizeDock />

        {/* Warp: teleport objects to other canvases via portals */}
        <WarpPortal />

        {/* Human↔human DM chat (launched from the toolbar's Messages button) */}
        <ChatLauncher />
        {/* AI agent chat — corner launcher + resizable right-side panel */}
        <AgentChatPanel />
      </div>

      {/* Scenes: cinematic camera tours. Deliberately OUTSIDE .canvas-chrome —
          it renders the tour player itself, which must survive the very rule
          that hides the chrome. Its launcher pill opts in separately via the
          .scenes-launcher class. */}
      <ScenesPanel />
    </>
  );
}
