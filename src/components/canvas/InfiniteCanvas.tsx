'use client';

import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { screenToCanvas, clamp } from '@/lib/utils';
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
} from '@/lib/db';
import CanvasObject from './CanvasObject';
import DrawingLayer from './DrawingLayer';
import ConnectionsLayer from './ConnectionsLayer';
import FloatingToolbar from '@/components/ui/FloatingToolbar';
import SpatialSearch from '@/components/ui/SpatialSearch';
import CommandPalette from '@/components/ui/CommandPalette';
import PlusMenu from '@/components/ui/PlusMenu';
import SlashCommandMenu from '@/components/ui/SlashCommandMenu';
import Minimap from '@/components/ui/Minimap';
import CheckpointIndex from '@/components/ui/CheckpointIndex';
import SaveIndicator from '@/components/ui/SaveIndicator';
import TrashPile from '@/components/ui/TrashPile';
import VoiceOrb from './VoiceOrb';
import AuthButton from '@/components/ui/AuthButton';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

export default function InfiniteCanvas() {
  const searchParams = useSearchParams();
  const urlId = searchParams?.get('id') || 'root';

  const containerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, camX: 0, camY: 0 });
  const [glowPos, setGlowPos] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);

  const camera = useCanvasStore((s) => s.camera);
  const setCamera = useCanvasStore((s) => s.setCamera);
  const objects = useCanvasStore((s) => s.objects);
  const setObjects = useCanvasStore((s) => s.setObjects);
  const strokes = useCanvasStore((s) => s.strokes);
  const setStrokes = useCanvasStore((s) => s.setStrokes);
  const mode = useCanvasStore((s) => s.mode);
  const setMode = useCanvasStore((s) => s.setMode);
  const previousMode = useCanvasStore((s) => s.previousMode);
  const setPreviousMode = useCanvasStore((s) => s.setPreviousMode);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);
  const focusedId = useCanvasStore((s) => s.focusedId);
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
  const checkpoint = useCanvasStore((s) => s.checkpoint);
  const setCheckpoint = useCanvasStore((s) => s.setCheckpoint);
  const addToTrash = useCanvasStore((s) => s.addToTrash);
  const connections = useCanvasStore((s) => s.connections);
  const setConnections = useCanvasStore((s) => s.setConnections);
  const updateObject = useCanvasStore((s) => s.updateObject);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [activeArrowId, setActiveArrowId] = useState<string | null>(null);

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

  // Track the URL canvas ID in Zustand
  useEffect(() => {
    setUrlCanvasId(urlId);
  }, [urlId, setUrlCanvasId]);

  // Load from IndexedDB
  useEffect(() => {
    async function load() {
      try {
        const parentId = canvasStack.length > 0 ? canvasStack[canvasStack.length - 1] : urlId;
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
              { id: uuidv4(), type: 'card', x: -350, y: -100, width: 220, height: 160, content: '✎ Draw Anywhere\nHold D and start drawing. Natural, pressure-sensitive strokes.', zIndex: 2, createdAt: Date.now(), updatedAt: Date.now() },
              { id: uuidv4(), type: 'card', x: -100, y: -100, width: 220, height: 160, content: '∞ Infinite Canvas\nZoom infinitely. Pan endlessly. Your thoughts have no boundaries.', zIndex: 3, createdAt: Date.now(), updatedAt: Date.now() },
              { id: uuidv4(), type: 'card', x: 150, y: -100, width: 220, height: 160, content: '📝 Type Anywhere\nClick any empty space and start writing. Headings, lists.', zIndex: 4, createdAt: Date.now(), updatedAt: Date.now() },
              { id: uuidv4(), type: 'card', x: -350, y: 100, width: 220, height: 160, content: '🔍 Spatial Search\nSearch and fly to your thoughts. Cinematically animate to the result.', zIndex: 5, createdAt: Date.now(), updatedAt: Date.now() },
              { id: uuidv4(), type: 'card', x: -100, y: 100, width: 220, height: 160, content: '🌀 Nested Spaces\nDouble-click any heading to zoom into a sub-space.', zIndex: 6, createdAt: Date.now(), updatedAt: Date.now() },
              { id: uuidv4(), type: 'card', x: 150, y: 100, width: 220, height: 160, content: '💾 Offline First\nEverything saves automatically to your device.', zIndex: 7, createdAt: Date.now(), updatedAt: Date.now() },
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
        setLoaded(true);
      } catch (err) {
        console.error('Failed to load canvas data:', err);
        setLoaded(true);
      }
    }
    load();
  }, [canvasStack, setObjects, setStrokes, setCamera, setWorkspaceTitle, urlId]);

  // Save on unmount to prevent losing last-second pans or edits
  useEffect(() => {
    return () => {
      const state = useCanvasStore.getState();
      if (state.isDirty) {
        const parentId = state.canvasStack.length > 0 ? state.canvasStack[state.canvasStack.length - 1] : urlId;
        
        saveCanvasState({
          id: parentId,
          title: workspaceTitle,
          camera: state.camera,
          checkpoint: checkpoint || undefined,
          lastModified: Date.now(),
        }).catch(err => console.error('Failed to save canvas state on unmount:', err));
        
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
                },
                state.objects,
                state.strokes,
                state.connections
              ).catch(err => console.error('Failed to sync canvas on unmount:', err));
            });
          }
        });
      }
    };
  }, [urlId, workspaceTitle, checkpoint]);

  // Autosave
  useEffect(() => {
    if (!isDirty || !loaded) return;

    const timeout = setTimeout(async () => {
      try {
        const parentId = canvasStack.length > 0 ? canvasStack[canvasStack.length - 1] : urlId;
        
        // Save locally to IndexedDB first
        await Promise.all([
          saveObjects(objects),
          saveStrokes(strokes),
          saveCanvasState({
            id: parentId,
            title: workspaceTitle,
            camera,
            checkpoint: checkpoint || undefined,
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
  }, [isDirty, objects, strokes, camera, checkpoint, loaded, canvasStack, urlId, workspaceTitle, setDirty, setLastSaved, connections]);


  // Wheel zoom
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();

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

      if (mode === 'text' || mode === 'select' || mode === 'shape' || mode === 'arrow') {
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
    },
    [mode, camera, setSelectedId, setEditingId, plusMenuPos, setPlusMenuPos]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      setGlowPos({ x: e.clientX, y: e.clientY });

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
        if (mode === 'select' || mode === 'text' || mode === 'pan') {
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
        if (mode === 'select' || mode === 'text' || mode === 'shape' || mode === 'arrow') {
          const dx = Math.abs(e.clientX - panStartRef.current.x);
          const dy = Math.abs(e.clientY - panStartRef.current.y);
          if (dx < 5 && dy < 5) {
            // It was a click
            const worldPos = screenToCanvas(e.clientX, e.clientY, camera);
            
            if (mode === 'arrow') {
              const activePointer = useCanvasStore.getState().selectedArrowPointerType || 'line';
              if (!activeArrowId) {
                // First click: Create the arrow
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
                    pointerType: activePointer,
                    color: 'var(--accent)',
                    thickness: 3,
                    dashStyle: 'solid',
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
            } else {
              const obj = addObject({
                type: 'text',
                x: worldPos.x,
                y: worldPos.y,
                width: 900,
                height: 100,
                content: '',
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

      // A = arrow mode
      if (e.key === 'a' || e.key === 'A') {
        setMode('arrow');
        return;
      }

      // V = select mode
      if (e.key === 'v' || e.key === 'V') {
        setMode('select');
        return;
      }

      // Escape = exit focus mode / deselect
      if (e.key === 'Escape') {
        if (focusedId) {
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

  // Drag and drop images
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/')
      );

      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const worldPos = screenToCanvas(e.clientX, e.clientY, camera);
          addObject({
            type: 'image',
            x: worldPos.x,
            y: worldPos.y,
            width: 300,
            height: 200,
            content: ev.target?.result as string,
          });
        };
        reader.readAsDataURL(file);
      });
    },
    [camera, addObject]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Paste images
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items || []);
      items.forEach((item) => {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              const centerX = (window.innerWidth / 2 - camera.x) / camera.zoom;
              const centerY = (window.innerHeight / 2 - camera.y) / camera.zoom;
              addObject({
                type: 'image',
                x: centerX,
                y: centerY,
                width: 300,
                height: 200,
                content: ev.target?.result as string,
              });
            };
            reader.readAsDataURL(file);
          }
        }
      });
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [camera, addObject]);

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
        className={`canvas-container paper-texture mode-${mode}`}
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

          {/* Render objects */}
          {Array.from(new Map(objects.map(o => [o.id, o])).values()).map((obj) => (
            <div key={obj.id} data-object-id={obj.id}>
              <CanvasObject
                obj={obj}
                isSelected={selectedId === obj.id}
                isFocused={focusedId === obj.id}
              />
            </div>
          ))}
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
      <div
        className="glow-cursor"
        style={{
          left: glowPos.x,
          top: glowPos.y,
          width: mode === 'draw' ? 30 : 20,
          height: mode === 'draw' ? 30 : 20,
        }}
      />

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
              className="glass-panel px-5 py-2.5 flex items-center gap-3 group transition-all hover:border-[var(--accent)] hover:shadow-[0_0_20px_rgba(201,123,75,0.2)]"
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

      {/* Noise overlay */}
      <div className="noise-overlay" />

      {/* UI overlays */}
      <div className="fixed top-12 left-10 z-50 pointer-events-auto flex flex-col items-start">
        {isEditingTitle ? (
          <input
            autoFocus
            type="text"
            value={workspaceTitle}
            onChange={(e) => setWorkspaceTitle(e.target.value)}
            onBlur={() => setIsEditingTitle(false)}
            onKeyDown={(e) => e.key === 'Enter' && setIsEditingTitle(false)}
            className="bg-white/80 border-none outline-none text-2xl text-[var(--text-primary)] w-80 px-4 py-2 rounded-xl transition-all shadow-xl backdrop-blur-md"
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
        {canvasStack.length > 0 && (
          <button 
            onClick={() => popCanvas()}
            className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--accent)] mt-2 transition-colors flex items-center gap-1"
          >
            <span className="text-xs">←</span> Parent Space
          </button>
        )}
      </div>
      
      <FloatingToolbar />
      <SpatialSearch />
      <CommandPalette />
      <PlusMenu />
      <SlashCommandMenu />
      <Minimap />
      <CheckpointIndex />
      <SaveIndicator />
      <TrashPile />
      <VoiceOrb />
      <AuthButton hideGuest={true} />
    </>
  );
}
