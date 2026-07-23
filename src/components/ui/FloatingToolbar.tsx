'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore, InteractionMode } from '@/store/canvasStore';
import { useChatStore, useChatUnreadTotal } from '@/store/chatStore';
import { useVoiceStore } from '@/store/voiceStore';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import WorkflowMenu from './WorkflowMenu';
import FlowModePanel, { FlowIcon } from './FlowModePanel';
import { useFlowStore } from '@/store/flowStore';
import CanvasBackgroundPanel from './CanvasBackgroundPanel';
import BrainstormPanel, { PinIcon } from './BrainstormPanel';
import ShapePreview from '@/components/canvas/ShapePreview';
import { RELAX_EFFECTS, RELAX_EFFECT_LIST } from '@/lib/relaxEffects';
import RelaxIcon from './RelaxIcons';
import { FRAME_KINDS, frameKindMeta } from '@/lib/frames';

const FRAME_COLORS = [
  { name: 'Terracotta', hex: '#C97B4B' },
  { name: 'Sage', hex: '#45B761' },
  { name: 'Sky', hex: '#4A90D9' },
  { name: 'Amethyst', hex: '#9B59B6' },
  { name: 'Rose', hex: '#E93D82' },
  { name: 'Charcoal', hex: '#2D2A26' },
];

const DRAW_COLORS = [
  '#FFFFFF', '#2D2A26', '#0B57D0', '#D93025', '#188038', // Classics
  '#FFB300', '#FF7043', '#D81B60', '#9B59B6', // Warm creative
  '#3F51B5', '#00ACC1', '#8EAC8A', '#4E342E', // Cool earth
  '#F48FB1', '#FFF59D', '#A5D6A7', '#B39DDB', // Pastels
  '#00E5FF', '#D500F9', '#00E676', '#FF3D00'  // Neons
];

const DRAW_SIZES = [2, 4, 6, 10, 16];

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  if (!hex || typeof hex !== 'string' || hex.startsWith('url(')) return { r: 0, g: 0, b: 0 };
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  return { r, g, b };
};

const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (c: number) => {
    const clamped = Math.min(255, Math.max(0, c));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) {
      h = (g - b) / d + (g < b ? 6 : 0);
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
};

const hslToHex = (h: number, s: number, l: number): string => {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (0 <= h && h < 60) { r = c; g = x; b = 0; }
  else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
  else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
  else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
  else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
  else if (300 <= h && h < 360) { r = c; g = 0; b = x; }
  const red = Math.round((r + m) * 255);
  const green = Math.round((g + m) * 255);
  const blue = Math.round((b + m) * 255);
  const toHex = (num: number) => num.toString(16).padStart(2, '0');
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
};

export default function FloatingToolbar() {
  const mode = useCanvasStore((s) => s.mode);
  const setMode = useCanvasStore((s) => s.setMode);
  const drawColor = useCanvasStore((s) => s.drawColor);
  const setDrawColor = useCanvasStore((s) => s.setDrawColor);
  const drawSize = useCanvasStore((s) => s.drawSize);
  const setDrawSize = useCanvasStore((s) => s.setDrawSize);
  const eraserMode = useCanvasStore((s) => s.eraserMode);
  const setEraserMode = useCanvasStore((s) => s.setEraserMode);
  const highlighterMode = useCanvasStore((s) => s.highlighterMode);
  const setHighlighterMode = useCanvasStore((s) => s.setHighlighterMode);
  const drawOpacity = useCanvasStore((s) => s.drawOpacity);
  const setDrawOpacity = useCanvasStore((s) => s.setDrawOpacity);
  const drawFlow = useCanvasStore((s) => s.drawFlow);
  const setDrawFlow = useCanvasStore((s) => s.setDrawFlow);
  const drawHardness = useCanvasStore((s) => s.drawHardness);
  const setDrawHardness = useCanvasStore((s) => s.setDrawHardness);
  const drawStabilization = useCanvasStore((s) => s.drawStabilization);
  const setDrawStabilization = useCanvasStore((s) => s.setDrawStabilization);
  const drawPressure = useCanvasStore((s) => s.drawPressure);
  const setDrawPressure = useCanvasStore((s) => s.setDrawPressure);
  const drawSmoothing = useCanvasStore((s) => s.drawSmoothing);
  const setDrawSmoothing = useCanvasStore((s) => s.setDrawSmoothing);
  const drawTexture = useCanvasStore((s) => s.drawTexture);
  const setDrawTexture = useCanvasStore((s) => s.setDrawTexture);
  const drawBlendMode = useCanvasStore((s) => s.drawBlendMode);
  const setDrawBlendMode = useCanvasStore((s) => s.setDrawBlendMode);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const undoStack = useCanvasStore((s) => s.undoStack);
  const redoStack = useCanvasStore((s) => s.redoStack);
  const setPlusMenuPos = useCanvasStore((s) => s.setPlusMenuPos);
  
  const textSize = useCanvasStore((s) => s.textSize);
  const setTextSize = useCanvasStore((s) => s.setTextSize);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const updateObject = useCanvasStore((s) => s.updateObject);
  const frameDraftKind = useCanvasStore((s) => s.frameDraftKind);
  const setFrameDraftKind = useCanvasStore((s) => s.setFrameDraftKind);
  const objects = useCanvasStore((s) => s.objects);
  const addObject = useCanvasStore((s) => s.addObject);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);
  const setEditingId = useCanvasStore((s) => s.setEditingId);
  const selectedObject = objects.find(o => o.id === selectedId);
  const camera = useCanvasStore((s) => s.camera);
  const checkpoint = useCanvasStore((s) => s.checkpoint);
  const setCheckpoint = useCanvasStore((s) => s.setCheckpoint);
  const setCommentMode = useCanvasStore((s) => s.setCommentMode);
  const setThreadsSidebarOpen = useCanvasStore((s) => s.setThreadsSidebarOpen);
  // Human↔human DM chat now lives in the toolbar (replacing the old thread pins).
  const chatPanelOpen = useChatStore((s) => s.panelOpen);
  const openChat = useChatStore((s) => s.openPanel);
  const closeChat = useChatStore((s) => s.closePanel);
  const chatUnread = useChatUnreadTotal();

  const [showDrawOptions, setShowDrawOptions] = useState(false);
  const [showAdvancedDraw, setShowAdvancedDraw] = useState(false);

  const [showShapeOptions, setShowShapeOptions] = useState(false);
  const [showArrowOptions, setShowArrowOptions] = useState(false);
  const [showFrameOptions, setShowFrameOptions] = useState(false);
  const [showBrainstormOptions, setShowBrainstormOptions] = useState(false);
  const [showWorkflowMenu, setShowWorkflowMenu] = useState(false);
  const [showBgOptions, setShowBgOptions] = useState(false);
  const [showRelaxOptions, setShowRelaxOptions] = useState(false);
  const [showFlow, setShowFlow] = useState(false);
  const flowEnabled = useFlowStore((s) => s.enabled);

  const relaxEffect = useCanvasStore((s) => s.relaxEffect);
  const setRelaxEffect = useCanvasStore((s) => s.setRelaxEffect);
  const activeRelax = relaxEffect ? RELAX_EFFECTS[relaxEffect] : null;

  // Touching the canvas dismisses the picker on the spot — nobody wants to play
  // with an effect through a panel sitting on top of it.
  useEffect(() => {
    if (!showRelaxOptions) return;
    const dismiss = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.canvas-container')) {
        setShowRelaxOptions(false);
      }
    };
    window.addEventListener('mousedown', dismiss);
    return () => window.removeEventListener('mousedown', dismiss);
  }, [showRelaxOptions]);

  /** Shut every toolbar flyout. One tool's panel is never open beside another's. */
  const closeAllPanels = React.useCallback(() => {
    setShowDrawOptions(false);
    setShowShapeOptions(false);
    setShowArrowOptions(false);
    setShowFrameOptions(false);
    setShowBrainstormOptions(false);
    setShowBgOptions(false);
    setShowRelaxOptions(false);
    setShowWorkflowMenu(false);
    setShowFlow(false);
  }, []);

  /* A mode can also be entered from the keyboard (D, S, R, V…) or by the canvas
     itself (placing a shape drops you back into select). Whenever the mode
     actually CHANGES, re-sync which panel is showing — so a keyboard shortcut
     still pops the right palette, and finishing a placement puts it away.
     A click on the tool you're already in doesn't change the mode, which is
     exactly what lets that click toggle its panel shut instead. */
  const lastMode = useRef(mode);
  useEffect(() => {
    if (lastMode.current === mode) return;
    lastMode.current = mode;
    setShowDrawOptions(mode === 'draw');
    setShowShapeOptions(mode === 'shape');
    setShowFrameOptions(mode === 'frame');
    setShowBrainstormOptions(mode === 'brainstorm');
    setShowRelaxOptions(mode === 'relax');
    setShowBgOptions(false);
    setShowWorkflowMenu(false);
  }, [mode]);

  const [selectedShapeDomain, setSelectedShapeDomain] = useState<'all' | 'brainstorm' | 'code' | 'love' | 'usecase' | 'story' | 'system'>('all');
  const selectedShapeType = useCanvasStore((s) => s.selectedShapeType);
  const setSelectedShapeType = useCanvasStore((s) => s.setSelectedShapeType);
  const selectedArrowPointerType = useCanvasStore((s) => s.selectedArrowPointerType);
  const setSelectedArrowPointerType = useCanvasStore((s) => s.setSelectedArrowPointerType);

  // When selectedObject changes, sync the toolbar state (but don't auto-open)
  React.useEffect(() => {
    if (selectedObject && (selectedObject.type === 'text' || selectedObject.type === 'heading' || selectedObject.type === 'card' || selectedObject.type === 'sticky')) {
      if (selectedObject.style?.fontSize && selectedObject.style.fontSize !== textSize) {
        setTextSize(selectedObject.style.fontSize as number);
      }
    }
  }, [selectedObject, textSize, setTextSize]);

  const handleSizeChange = (size: number) => {
    setTextSize(size);
    if (selectedId && selectedObject) {
      updateObject(selectedId, { style: { ...selectedObject.style, fontSize: size } });
    }
  };

  const tools: { id: InteractionMode | 'workflow'; icon: React.ReactNode; label: string }[] = [
    {
      id: 'select',
      label: 'Select (V)',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 3l7.5 18 2.6-7.4L21.5 11 4 3z" fill="currentColor" stroke="none" />
        </svg>
      ),
    },
    {
      id: 'voice' as unknown as InteractionMode,
      label: 'Voice Typing',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      ),
    },
    {
      id: 'draw',
      label: 'Draw (D)',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      ),
    },
    {
      id: 'workflow' as unknown as InteractionMode,
      label: 'Workflow',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="6" r="2.5" />
          <circle cx="19" cy="6" r="2.5" />
          <circle cx="12" cy="18" r="2.5" />
          <path d="M7 7.5L10.5 16M17 7.5L13.5 16" />
        </svg>
      ),
    },
    {
      id: 'pan',
      label: 'Pan (Space)',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 11V6a2 2 0 0 0-4 0v5" />
          <path d="M14 10V4a2 2 0 0 0-4 0v6" />
          <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
          <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
        </svg>
      ),
    },
    {
      id: 'arrow',
      // A connector, not a compass needle: a line with a real head on it, which
      // is what the tool actually draws.
      label: 'Arrow (A)',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 18c3.6-8.4 9.6-12 17.2-12" />
          <path d="M14.6 3.4 20.6 6l-2.4 6" />
        </svg>
      ),
    },
    {
      id: 'shape',
      // Three shapes crammed into 18px read as a smudge. One clean square with a
      // circle and a triangle tucked behind it says "shapes" and stays legible.
      label: 'Shape (S)',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="16.2" cy="7.8" r="4.6" opacity="0.55" />
          <path d="M6.6 3.6 11.4 12H1.8Z" opacity="0.55" />
          <rect x="5" y="10.6" width="11.4" height="10.4" rx="2.4" fill="var(--bg-glass)" />
        </svg>
      ),
    },
    {
      id: 'frame',
      label: 'Frame (R)',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 8V4h4" />
          <path d="M16 4h4v4" />
          <path d="M20 16v4h-4" />
          <path d="M8 20H4v-4" />
        </svg>
      ),
    },
    {
      id: 'brainstorm',
      label: 'Brainstorm — pins, clips & thread',
      icon: <PinIcon size={17} />,
    },
    {
      id: 'relax',
      label: 'Stress Reliefer',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="11" cy="12.5" rx="7.2" ry="3.8" transform="rotate(20 11 12.5)" />
          <ellipse cx="13" cy="11.5" rx="6.8" ry="4.2" transform="rotate(-40 13 11.5)" />
          <ellipse cx="12" cy="12" rx="7.5" ry="3.5" transform="rotate(70 12 12)" />
          <ellipse cx="11.5" cy="11" rx="6.2" ry="3.2" transform="rotate(-75 11.5 11)" />
          <ellipse cx="12.5" cy="13" rx="5.5" ry="2.8" transform="rotate(130 12.5 13)" />
        </svg>
      ),
    },
  ];

  const { isListening } = useVoiceStore();
  const { startRecognition, stopRecognition } = useSpeechRecognition();

  return (
    <div className="floating-toolbar">
      {/* Workflow Menu Overlay */}
      <AnimatePresence>
        {showWorkflowMenu && (
          <motion.div
            className="absolute bottom-16 left-1/2 -translate-x-1/2 z-[100]"
            initial={{ opacity: 0, y: 15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <WorkflowMenu onClose={() => setShowWorkflowMenu(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Brainstorm panel — pins, clips & thread */}
      <AnimatePresence>
        {showBrainstormOptions && mode === 'brainstorm' && (
          <motion.div
            key="brainstorm-panel"
            className="absolute bottom-16 left-1/2 -translate-x-1/2 z-[100]"
            initial={{ opacity: 0, y: 15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <BrainstormPanel />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Flow Mode panel */}
      <AnimatePresence>
        {showFlow && (
          <motion.div
            key="flow-panel"
            className="absolute bottom-16 right-0 z-[100]"
            initial={{ opacity: 0, y: 15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <FlowModePanel onClose={() => setShowFlow(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="glass-panel flex items-center gap-1 px-2 py-1.5"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Plus Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          data-plus-button
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            closeAllPanels();
            // Toggle: a second click on + puts the insert menu away again.
            if (useCanvasStore.getState().plusMenuPos) {
              setPlusMenuPos(null);
              return;
            }
            // Position the menu slightly above the toolbar button
            setPlusMenuPos({ x: rect.left, y: rect.top, isToolbar: true });
          }}
          className="relative w-9 h-9 rounded-lg flex items-center justify-center text-lg font-medium transition-all text-[var(--accent)] hover:bg-[var(--accent-subtle)]"
          title="Add Item"
        >
          +
        </motion.button>

        {/* Separator */}
        <div className="w-px h-6 bg-[var(--border)] mx-1" />

        {/* Mode tools */}
        {tools.map((tool) => {
          const active = mode === tool.id || (tool.id === 'voice' as unknown as InteractionMode && isListening) || (tool.id === 'workflow' as unknown as InteractionMode && showWorkflowMenu);
          return (
            <motion.button
              key={tool.id}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                setCommentMode(false);
                setThreadsSidebarOpen(false);

                if (tool.id === 'voice' as unknown as InteractionMode) {
                  closeAllPanels();
                  if (isListening) stopRecognition();
                  else startRecognition();
                  return;
                }

                if (tool.id === 'workflow' as unknown as InteractionMode) {
                  const wasOpen = showWorkflowMenu;
                  closeAllPanels();
                  if (!wasOpen) {
                    setShowWorkflowMenu(true);
                    setMode('select');
                  }
                  return;
                }

                const panelOpen =
                  (tool.id === 'draw' && showDrawOptions) ||
                  (tool.id === 'shape' && showShapeOptions) ||
                  (tool.id === 'frame' && showFrameOptions) ||
                  (tool.id === 'brainstorm' && showBrainstormOptions) ||
                  (tool.id === 'relax' && showRelaxOptions);

                if (mode === (tool.id as InteractionMode) && panelOpen) {
                  closeAllPanels();
                  return;
                }

                closeAllPanels();
                setMode(tool.id as InteractionMode);
                if (tool.id === 'arrow') setSelectedId(null);
                if (tool.id === 'draw') setShowDrawOptions(true);
                else if (tool.id === 'shape') setShowShapeOptions(true);
                else if (tool.id === 'frame') setShowFrameOptions(true);
                else if (tool.id === 'brainstorm') setShowBrainstormOptions(true);
                else if (tool.id === 'relax') setShowRelaxOptions(true);
              }}
              className={`relative w-9 h-9 rounded-lg flex items-center justify-center text-sm font-medium transition-all ${
                active
                  ? 'text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
              }`}
              title={tool.label}
            >
              {active && (
                <motion.span
                  layoutId="toolbar-active"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  className="absolute inset-0 rounded-lg clay-inset"
                />
              )}
              <span className="relative flex items-center justify-center">{tool.icon}</span>
            </motion.button>
          );
        })}

        {/* Canvas background / color mode — sits right beside Frame */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            const wasOpen = showBgOptions;
            closeAllPanels();
            setCommentMode(false);
            setThreadsSidebarOpen(false);
            if (!wasOpen) setShowBgOptions(true);
          }}
          className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
            showBgOptions
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
          }`}
          title="Canvas background & color modes"
        >
          {showBgOptions && (
            <motion.span
              layoutId="toolbar-active"
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="absolute inset-0 rounded-lg clay-inset"
            />
          )}
          <span className="relative flex items-center justify-center">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
            </svg>
          </span>
        </motion.button>

        {/* Plugins used to live here. It moved to the canvas-title header,
            alongside Share, Skill Set and Collaborate — board-level actions
            belong with the board's name, not in the drawing toolbar. */}

        {/* Flow Mode — cinematic focus writing (spotlight, semantic weather, progress) */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            const wasOpen = showFlow;
            closeAllPanels();
            setCommentMode(false);
            setThreadsSidebarOpen(false);
            if (!wasOpen) setShowFlow(true);
          }}
          className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
            showFlow || flowEnabled
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
          }`}
          title="Flow Mode — cinematic focus writing"
        >
          {showFlow && (
            <motion.span
              layoutId="toolbar-active"
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="absolute inset-0 rounded-lg clay-inset"
            />
          )}
          {flowEnabled && !showFlow && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
          )}
          <span className="relative flex items-center justify-center">
            <FlowIcon size={18} />
          </span>
        </motion.button>

        {/* Messages — human↔human DM chat (moved here from the corner; replaces
            the old thread pins, which are gone). */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            closeAllPanels();
            setCommentMode(false);
            setThreadsSidebarOpen(false);
            if (chatPanelOpen) closeChat();
            else openChat();
          }}
          className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
            chatPanelOpen
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
          }`}
          title="Messages"
        >
          {chatPanelOpen && (
            <motion.span
              layoutId="toolbar-active"
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="absolute inset-0 rounded-lg clay-inset"
            />
          )}
          <span className="relative flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <defs>
                <mask id="toolbar-chat-bubble-mask">
                  <rect x="0" y="0" width="24" height="24" fill="white" />
                  <path d="M19.4003 18C19.7837 17.2499 20 16.4002 20 15.5C20 12.4624 17.5376 10 14.5 10C11.4624 10 9 12.4624 9 15.5C9 18.5376 11.4624 21 14.5 21L21 21C21 21 20 20 19.4143 18.0292" fill="black" stroke="black" strokeWidth="3.5" />
                </mask>
              </defs>
              <path d="M18.85 12C18.9484 11.5153 19 11.0137 19 10.5C19 6.35786 15.6421 3 11.5 3C7.35786 3 4 6.35786 4 10.5C4 11.3766 4.15039 12.2181 4.42676 13C5.50098 16.0117 3 18 3 18H9.5" mask="url(#toolbar-chat-bubble-mask)" />
              <path d="M19.4003 18C19.7837 17.2499 20 16.4002 20 15.5C20 12.4624 17.5376 10 14.5 10C11.4624 10 9 12.4624 9 15.5C9 18.5376 11.4624 21 14.5 21L21 21C21 21 20 20 19.4143 18.0292" />
            </svg>
          </span>
          {chatUnread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-1 rounded-full bg-[var(--accent)] text-white text-[8px] font-extrabold flex items-center justify-center tabular-nums shadow-sm">{chatUnread}</span>
          )}
        </motion.button>

        {/* Separator */}
        <div className="w-px h-6 bg-[var(--border)] mx-1" />

        {/* Undo/Redo */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={undo}
          disabled={undoStack.length === 0}
          className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm transition-all ${
            undoStack.length === 0
              ? 'text-[var(--text-muted)] cursor-not-allowed'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
          }`}
          title="Undo (Ctrl+Z)"
        >
          ↺
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={redo}
          disabled={redoStack.length === 0}
          className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm transition-all ${
            redoStack.length === 0
              ? 'text-[var(--text-muted)] cursor-not-allowed'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
          }`}
          title="Redo (Ctrl+Shift+Z)"
        >
          ↻
        </motion.button>
      </motion.div>

      {/* Draw options panel */}
      <AnimatePresence>
        {showDrawOptions && mode === 'draw' && (
          <motion.div
            style={{ padding: 16 }}
            className={`glass-panel absolute bottom-14 left-1/2 -translate-x-1/2 flex flex-col gap-3 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              showAdvancedDraw
                ? 'w-[840px] max-w-[95vw]'
                : 'w-[270px]'
            }`}
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {!showAdvancedDraw ? (
              <>
                {/* Header / Title */}
                <div className="flex justify-between items-center px-1">
                  <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-[0.16em] select-none">
                    {eraserMode ? 'Eraser' : highlighterMode ? 'Highlighter' : 'Pen'} Brush
                  </span>
                </div>

                {/* Tool Switcher */}
                <div className="flex bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border)] gap-1 shrink-0" style={{ padding: 3 }}>
                  <button
                    onClick={() => {
                      setEraserMode(false);
                      setHighlighterMode(false);
                    }}
                    style={{ padding: '6px 8px' }}
                    className={`flex-1 rounded-md text-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                      !eraserMode && !highlighterMode
                        ? 'bg-white dark:bg-white/15 text-[var(--accent)] shadow-sm'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    Pen
                  </button>
                  <button
                    onClick={() => {
                      setHighlighterMode(true);
                      setEraserMode(false);
                    }}
                    style={{ padding: '6px 8px' }}
                    className={`flex-1 rounded-md text-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                      highlighterMode
                        ? 'bg-white dark:bg-white/15 text-[var(--accent)] shadow-sm'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 11l-6 6v3h9l3-3" />
                      <path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
                    </svg>
                    Highlighter
                  </button>
                  <button
                    onClick={() => {
                      setEraserMode(true);
                      setHighlighterMode(false);
                    }}
                    style={{ padding: '6px 8px' }}
                    className={`flex-1 rounded-md text-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                      eraserMode
                        ? 'bg-white dark:bg-white/15 text-[var(--accent)] shadow-sm'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span>⌫</span> Eraser
                  </button>
                </div>

                {/* Colors (Pen / Highlighter only) */}
                {!eraserMode && (
                  <div className="flex flex-col gap-2 shrink-0">
                    {/* Standard Swatches */}
                    <div className="grid grid-cols-10 gap-1 justify-center">
                      {DRAW_COLORS.map((color) => (
                        <button
                          key={color}
                          onClick={() => {
                            setDrawColor(color);
                          }}
                          className="w-5.5 h-5.5 rounded-full border transition-all hover:scale-110 cursor-pointer"
                          style={{
                            background: color,
                            borderColor: drawColor === color ? 'var(--accent)' : 'transparent',
                            boxShadow: drawColor === color ? '0 0 0 1.5px var(--accent-subtle)' : 'none',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Sizes (Quick bar in simple mode) */}
                <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2 mt-0.5 shrink-0">
                  <span className="text-[10px] text-[var(--text-muted)] font-medium">Quick Sizes</span>
                  <div className="flex gap-1.5">
                    {DRAW_SIZES.map((size) => (
                      <button
                        key={size}
                        onClick={() => setDrawSize(size)}
                        className={`flex items-center justify-center w-7 h-7 rounded-lg transition-all cursor-pointer ${
                          drawSize === size
                            ? 'bg-[var(--accent-subtle)]'
                            : 'hover:bg-[var(--bg-tertiary)]'
                        }`}
                      >
                        <div
                          className="rounded-full bg-current"
                          style={{
                            width: Math.max(3, size / 1.5),
                            height: Math.max(3, size / 1.5),
                            color: eraserMode ? 'var(--text-secondary)' : drawColor.startsWith('url(') ? 'var(--accent)' : drawColor,
                            opacity: highlighterMode ? 0.35 : 1,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              // Extended / Advanced horizontal layout spanning the yellow area!
              <div className="flex gap-5 items-stretch min-h-[220px] min-w-0">
                {/* Column 1: Tools & Swatches */}
                <div className="w-[230px] flex flex-col gap-3 shrink-0 pr-3 border-r border-[var(--border)]">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-[0.16em] select-none">
                      Brush & Palette
                    </span>
                  </div>

                  {/* Tool Switcher */}
                  <div className="flex bg-[var(--bg-tertiary)] p-1 rounded-lg border border-[var(--border)] gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEraserMode(false);
                        setHighlighterMode(false);
                      }}
                      className={`flex-1 py-1 px-1 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        !eraserMode && !highlighterMode
                          ? 'bg-white dark:bg-white/15 text-[var(--accent)] shadow-sm'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      Pen
                    </button>
                    <button
                      onClick={() => {
                        setHighlighterMode(true);
                        setEraserMode(false);
                      }}
                      className={`flex-1 py-1 px-1 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        highlighterMode
                          ? 'bg-white dark:bg-white/15 text-[var(--accent)] shadow-sm'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      Highlighter
                    </button>
                    <button
                      onClick={() => {
                        setEraserMode(true);
                        setHighlighterMode(false);
                      }}
                      className={`flex-1 py-1 px-1 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        eraserMode
                          ? 'bg-white dark:bg-white/15 text-[var(--accent)] shadow-sm'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      Eraser
                    </button>
                  </div>

                  {/* Quick Color Swatches */}
                  {!eraserMode && (
                    <div className="flex flex-col gap-2 shrink-0">
                      <div className="grid grid-cols-5 gap-1.5 justify-center">
                        {DRAW_COLORS.map((color) => (
                          <button
                            key={color}
                            onClick={() => {
                              setDrawColor(color);
                            }}
                            className="w-[34px] h-[22px] rounded-md border transition-all hover:scale-105 cursor-pointer"
                            style={{
                              background: color,
                              borderColor: drawColor === color ? 'var(--accent)' : 'transparent',
                              boxShadow: drawColor === color ? '0 0 0 1.5px var(--accent-subtle)' : 'none',
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Column 2: Advanced Custom Colors (HEX/RGB/HSL/Gradients) */}
                <div className="w-[260px] flex flex-col gap-2.5 shrink-0 pr-3 border-r border-[var(--border)]">
                  {!eraserMode ? (() => {
                    const { r, g, b } = hexToRgb(drawColor);
                    const { h, s, l } = rgbToHsl(r, g, b);
                    return (
                      <>
                        <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-[0.16em] select-none px-1">
                          Custom Color
                        </span>
                        
                        {/* HEX & Eyedropper */}
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 flex items-center bg-[var(--bg-tertiary)] px-2.5 py-1 rounded-lg border border-[var(--border)] gap-1.5">
                            <span className="text-[9px] text-[var(--text-muted)] font-bold tracking-wider">HEX</span>
                            <input
                              type="text"
                              className="w-full bg-transparent outline-none text-xs text-[var(--text-primary)] font-mono"
                              value={drawColor.startsWith('url(') ? '#FFFFFF' : drawColor}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val.match(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)) {
                                  setDrawColor(val);
                                } else if (!val.startsWith('#') && val.match(/^([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)) {
                                  setDrawColor('#' + val);
                                }
                              }}
                            />
                          </div>
                          {typeof window !== 'undefined' && 'EyeDropper' in window && (
                            <button
                              onClick={async () => {
                                try {
                                  const EyeDropperCtor = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
                                  const eyeDropper = new EyeDropperCtor();
                                  const result = await eyeDropper.open();
                                  setDrawColor(result.sRGBHex);
                                } catch {
                                  // ignore
                                }
                              }}
                              title="Eyedropper tool"
                              className="w-7 h-7 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m2 22 1-1h3l9-9 3 3-9 9H3l-1-1Z" />
                                <path d="M19 11l-4-4" />
                                <path d="M15 3h6v6" />
                              </svg>
                            </button>
                          )}
                        </div>

                        {/* RGB inputs */}
                        <div className="grid grid-cols-3 bg-[var(--bg-tertiary)] p-1 rounded-lg border border-[var(--border)] text-center text-[9px]">
                          <div className="flex flex-col">
                            <span className="text-[8px] text-[var(--text-muted)] font-bold">R</span>
                            <input
                              type="number"
                              min="0"
                              max="255"
                              className="w-full bg-transparent text-center text-xs text-[var(--text-primary)] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-semibold"
                              value={r}
                              onChange={(e) => {
                                const newR = Math.min(255, Math.max(0, parseInt(e.target.value) || 0));
                                setDrawColor(rgbToHex(newR, g, b));
                              }}
                            />
                          </div>
                          <div className="flex flex-col border-l border-[var(--border)]">
                            <span className="text-[8px] text-[var(--text-muted)] font-bold">G</span>
                            <input
                              type="number"
                              min="0"
                              max="255"
                              className="w-full bg-transparent text-center text-xs text-[var(--text-primary)] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-semibold"
                              value={g}
                              onChange={(e) => {
                                const newG = Math.min(255, Math.max(0, parseInt(e.target.value) || 0));
                                setDrawColor(rgbToHex(r, newG, b));
                              }}
                            />
                          </div>
                          <div className="flex flex-col border-l border-[var(--border)]">
                            <span className="text-[8px] text-[var(--text-muted)] font-bold">B</span>
                            <input
                              type="number"
                              min="0"
                              max="255"
                              className="w-full bg-transparent text-center text-xs text-[var(--text-primary)] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-semibold"
                              value={b}
                              onChange={(e) => {
                                const newB = Math.min(255, Math.max(0, parseInt(e.target.value) || 0));
                                setDrawColor(rgbToHex(r, g, newB));
                              }}
                            />
                          </div>
                        </div>

                        {/* HSL inputs */}
                        <div className="grid grid-cols-3 bg-[var(--bg-tertiary)] p-1 rounded-lg border border-[var(--border)] text-center text-[9px]">
                          <div className="flex flex-col">
                            <span className="text-[8px] text-[var(--text-muted)] font-bold">H</span>
                            <input
                              type="number"
                              min="0"
                              max="360"
                              className="w-full bg-transparent text-center text-xs text-[var(--text-primary)] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-semibold"
                              value={h}
                              onChange={(e) => {
                                const newH = Math.min(360, Math.max(0, parseInt(e.target.value) || 0));
                                setDrawColor(hslToHex(newH, s, l));
                              }}
                            />
                          </div>
                          <div className="flex flex-col border-l border-[var(--border)]">
                            <span className="text-[8px] text-[var(--text-muted)] font-bold">S</span>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              className="w-full bg-transparent text-center text-xs text-[var(--text-primary)] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-semibold"
                              value={s}
                              onChange={(e) => {
                                const newS = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                                setDrawColor(hslToHex(h, newS, l));
                              }}
                            />
                          </div>
                          <div className="flex flex-col border-l border-[var(--border)]">
                            <span className="text-[8px] text-[var(--text-muted)] font-bold">L</span>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              className="w-full bg-transparent text-center text-xs text-[var(--text-primary)] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-semibold"
                              value={l}
                              onChange={(e) => {
                                const newL = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                                setDrawColor(hslToHex(h, s, newL));
                              }}
                            />
                          </div>
                        </div>

                        {/* Gradients */}
                        <div className="flex flex-col gap-1 border-t border-[var(--border)]/60 pt-2">
                          <span className="text-[8px] uppercase font-bold text-[var(--text-muted)] tracking-wider px-0.5">Gradients</span>
                          <div className="flex gap-1.5">
                            {[
                              { id: 'url(#sunset-grad)', css: 'linear-gradient(135deg, #FF512F 0%, #DD2476 100%)', label: 'Sunset' },
                              { id: 'url(#ocean-grad)', css: 'linear-gradient(135deg, #02AAB0 0%, #00CDAC 100%)', label: 'Ocean' },
                              { id: 'url(#fire-grad)', css: 'linear-gradient(135deg, #F5576C 0%, #F08080 100%)', label: 'Fire' },
                              { id: 'url(#lavender-grad)', css: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)', label: 'Lavender' },
                              { id: 'url(#cosmic-grad)', css: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)', label: 'Cosmic' }
                            ].map((grad) => (
                              <button
                                key={grad.id}
                                onClick={() => setDrawColor(grad.id)}
                                title={grad.label}
                                className="w-5.5 h-5.5 rounded-full border transition-all hover:scale-110 cursor-pointer"
                                style={{
                                  background: grad.css,
                                  borderColor: drawColor === grad.id ? 'var(--accent)' : 'transparent',
                                  boxShadow: drawColor === grad.id ? '0 0 0 1.5px var(--accent-subtle)' : 'none',
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      </>
                    );
                  })() : (
                    <div className="flex items-center justify-center h-full text-xs text-[var(--text-muted)] italic select-none">
                      Eraser selected — no color parameters needed.
                    </div>
                  )}
                </div>

                {/* Column 3: Advanced Brush Slider controls (2-column layout to fit horizontally!) */}
                <div className="flex-1 flex flex-col gap-2 min-w-0 pr-1 overflow-y-auto">
                  <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-[0.16em] select-none px-1">
                    Brush Settings
                  </span>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[10px] bg-[var(--bg-secondary)]/50 p-2.5 rounded-xl border border-[var(--border)]">
                    {/* Size */}
                    <div className="flex flex-col gap-0.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--text-secondary)] font-semibold">Size</span>
                        <span className="text-[var(--text-muted)] font-mono">{drawSize}px</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="100"
                        className="w-full accent-[var(--accent)] cursor-pointer h-1 rounded"
                        value={drawSize}
                        onChange={(e) => setDrawSize(parseInt(e.target.value))}
                      />
                    </div>

                    {/* Hardness */}
                    <div className="flex flex-col gap-0.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--text-secondary)] font-semibold">Hardness</span>
                        <span className="text-[var(--text-muted)] font-mono">{Math.round(drawHardness * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.01"
                        className="w-full accent-[var(--accent)] cursor-pointer h-1 rounded"
                        value={drawHardness}
                        onChange={(e) => setDrawHardness(parseFloat(e.target.value))}
                      />
                    </div>

                    {/* Opacity */}
                    <div className="flex flex-col gap-0.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--text-secondary)] font-semibold">Opacity</span>
                        <span className="text-[var(--text-muted)] font-mono">{Math.round(drawOpacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.05"
                        max="1.0"
                        step="0.01"
                        className="w-full accent-[var(--accent)] cursor-pointer h-1 rounded"
                        value={drawOpacity}
                        onChange={(e) => setDrawOpacity(parseFloat(e.target.value))}
                      />
                    </div>

                    {/* Flow */}
                    <div className="flex flex-col gap-0.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--text-secondary)] font-semibold">Flow</span>
                        <span className="text-[var(--text-muted)] font-mono">{Math.round(drawFlow * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.05"
                        max="1.0"
                        step="0.01"
                        className="w-full accent-[var(--accent)] cursor-pointer h-1 rounded"
                        value={drawFlow}
                        onChange={(e) => setDrawFlow(parseFloat(e.target.value))}
                      />
                    </div>

                    {/* Stabilization */}
                    <div className="flex flex-col gap-0.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--text-secondary)] font-semibold">Stabilize</span>
                        <span className="text-[var(--text-muted)] font-mono">{Math.round(drawStabilization * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="1.0"
                        step="0.01"
                        className="w-full accent-[var(--accent)] cursor-pointer h-1 rounded"
                        value={drawStabilization}
                        onChange={(e) => setDrawStabilization(parseFloat(e.target.value))}
                      />
                    </div>

                    {/* Smoothing */}
                    <div className="flex flex-col gap-0.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--text-secondary)] font-semibold">Smooth</span>
                        <span className="text-[var(--text-muted)] font-mono">{Math.round(drawSmoothing * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.0"
                        max="1.0"
                        step="0.01"
                        className="w-full accent-[var(--accent)] cursor-pointer h-1 rounded"
                        value={drawSmoothing}
                        onChange={(e) => setDrawSmoothing(parseFloat(e.target.value))}
                      />
                    </div>

                    {/* Texture Select */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[var(--text-secondary)] font-semibold">Texture</span>
                      <select
                        value={drawTexture}
                        onChange={(e) => setDrawTexture(e.target.value as 'none' | 'chalk' | 'watercolor' | 'noise' | 'splatter')}
                        className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-2 py-0.5 outline-none text-[11px] cursor-pointer"
                      >
                        <option value="none">None</option>
                        <option value="chalk">Chalk</option>
                        <option value="watercolor">Watercolor</option>
                        <option value="noise">Noise Grain</option>
                        <option value="splatter">Splatter</option>
                      </select>
                    </div>

                    {/* Blend Mode Select */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[var(--text-secondary)] font-semibold">Blend Mode</span>
                      <select
                        value={drawBlendMode}
                        onChange={(e) => setDrawBlendMode(e.target.value as 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten')}
                        className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-2 py-0.5 outline-none text-[11px] cursor-pointer"
                      >
                        <option value="normal">Normal</option>
                        <option value="multiply">Multiply</option>
                        <option value="screen">Screen</option>
                        <option value="overlay">Overlay</option>
                        <option value="darken">Darken</option>
                        <option value="lighten">Lighten</option>
                      </select>
                    </div>
                  </div>

                  {/* Pressure Sensitivity Toggle */}
                  <div className="flex items-center justify-between py-1 px-1 bg-[var(--bg-secondary)]/50 rounded-lg border border-[var(--border)] text-[10px] shrink-0 mt-0.5">
                    <span className="text-[var(--text-secondary)] font-semibold">Pressure Sensitivity</span>
                    <button
                      onClick={() => setDrawPressure(!drawPressure)}
                      className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out outline-none ${
                        drawPressure ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          drawPressure ? 'translate-x-3.5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Toggle advanced settings button */}
            <button
              onClick={() => setShowAdvancedDraw(!showAdvancedDraw)}
              style={{ padding: '7px 12px' }}
              className="rounded-lg bg-[rgba(var(--accent-rgb),0.08)] hover:bg-[rgba(var(--accent-rgb),0.13)] text-[var(--accent)] text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0 w-full"
            >
              <span>{showAdvancedDraw ? 'Simple Settings' : 'Advanced Mode →'}</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Shape options panel — only while placing a new shape; editing an
          existing shape is handled by the left SelectionPanel. */}
      <AnimatePresence>
        {showShapeOptions && mode === 'shape' && (
          <motion.div
            style={{ padding: 16 }}
            className="glass-panel absolute bottom-14 left-1/2 -translate-x-1/2 flex flex-col gap-3 min-w-[280px]"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider">Shape Domain</span>
              {/* Category tabs */}
              <div className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-2 mb-1">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'brainstorm', label: 'Brainstorm' },
                  { id: 'code', label: 'Tech' },
                  { id: 'love', label: 'Expressive' },
                  { id: 'usecase', label: 'Actions' },
                  { id: 'story', label: 'Story' },
                  { id: 'system', label: 'System' },
                ].map((domain) => (
                  <button
                    key={domain.id}
                    onClick={() => setSelectedShapeDomain(domain.id as typeof selectedShapeDomain)}
                    style={{ padding: '4px 9px' }}
                    className={`rounded-md text-[10px] font-semibold transition-all cursor-pointer ${
                      selectedShapeDomain === domain.id
                        ? 'bg-[var(--accent)] text-white shadow-sm font-bold'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {domain.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2 justify-center max-h-60 overflow-y-auto pr-1">
              {[
                // Brainstorm
                { id: 'lightbulb', label: 'Lightbulb', domain: 'brainstorm' },
                { id: 'sticky', label: 'Sticky', domain: 'brainstorm' },
                { id: 'cloud', label: 'Cloud', domain: 'brainstorm' },
                { id: 'star', label: 'Star', domain: 'brainstorm' },
                { id: 'sun', label: 'Sun', domain: 'brainstorm' },
                { id: 'moon', label: 'Moon', domain: 'brainstorm' },
                { id: 'target', label: 'Target', domain: 'brainstorm' },
                { id: 'puzzle', label: 'Puzzle', domain: 'brainstorm' },
                { id: 'gear', label: 'Gear', domain: 'brainstorm' },
                { id: 'funnel', label: 'Funnel', domain: 'brainstorm' },
                { id: 'magnet', label: 'Magnet', domain: 'brainstorm' },
                { id: 'square', label: 'Square', domain: 'brainstorm' },
                { id: 'circle', label: 'Circle', domain: 'brainstorm' },
                { id: 'triangle', label: 'Triangle', domain: 'brainstorm' },
                { id: 'diamond', label: 'Diamond', domain: 'brainstorm' },
                { id: 'octagon', label: 'Stop', domain: 'brainstorm' },

                // Code
                { id: 'terminal', label: 'Terminal', domain: 'code' },
                { id: 'brackets', label: 'Brackets', domain: 'code' },
                { id: 'api', label: 'API', domain: 'code' },
                { id: 'server', label: 'Server', domain: 'code' },
                { id: 'cube', label: 'Cube', domain: 'code' },
                { id: 'branch', label: 'Branch', domain: 'code' },
                { id: 'terminal-prompt', label: 'Prompt', domain: 'code' },
                { id: 'cpu', label: 'CPU', domain: 'code' },
                { id: 'globe', label: 'Globe', domain: 'code' },
                { id: 'key', label: 'Key', domain: 'code' },
                { id: 'database', label: 'Database', domain: 'code' },
                { id: 'document', label: 'Doc', domain: 'code' },
                { id: 'folder', label: 'Folder', domain: 'code' },
                { id: 'queue', label: 'Queue', domain: 'code' },
                { id: 'webhook', label: 'Webhook', domain: 'code' },
                { id: 'cache', label: 'Cache', domain: 'code' },
                { id: 'event', label: 'Event', domain: 'code' },
                { id: 'pipeline', label: 'Pipeline', domain: 'code' },
                { id: 'auth', label: 'Auth', domain: 'code' },
                { id: 'diff', label: 'Diff', domain: 'code' },
                { id: 'hash', label: 'Hash', domain: 'code' },
                { id: 'branch-merge', label: 'Git Merge', domain: 'code' },
                { id: 'token', label: 'Token', domain: 'code' },

                // Love
                { id: 'heart', label: 'Heart', domain: 'love' },
                { id: 'smile', label: 'Smile', domain: 'love' },
                { id: 'thumbs-up', label: 'Up', domain: 'love' },
                { id: 'thumbs-down', label: 'Down', domain: 'love' },
                { id: 'flower', label: 'Flower', domain: 'love' },
                { id: 'sparkles', label: 'Sparkles', domain: 'love' },
                { id: 'trophy', label: 'Trophy', domain: 'love' },
                { id: 'medal', label: 'Medal', domain: 'love' },
                { id: 'gift', label: 'Gift', domain: 'love' },
                { id: 'balloon', label: 'Balloon', domain: 'love' },
                { id: 'clapping', label: 'Clap', domain: 'love' },
                { id: 'coffee', label: 'Coffee', domain: 'love' },
                { id: 'check-circle', label: 'Check', domain: 'love' },
                { id: 'cross-circle', label: 'Cross', domain: 'love' },

                // Usecase
                { id: 'speech', label: 'Speech', domain: 'usecase' },
                { id: 'message', label: 'Mail', domain: 'usecase' },
                { id: 'cross', label: 'Cross', domain: 'usecase' },
                { id: 'lightning', label: 'Flash', domain: 'usecase' },
                { id: 'shield', label: 'Shield', domain: 'usecase' },
                { id: 'arrow-left', label: 'Left', domain: 'usecase' },
                { id: 'arrow-right', label: 'Right', domain: 'usecase' },
                { id: 'arrow-up', label: 'Up', domain: 'usecase' },
                { id: 'arrow-down', label: 'Down', domain: 'usecase' },
                { id: 'tag', label: 'Tag', domain: 'usecase' },
                { id: 'banner', label: 'Banner', domain: 'usecase' },
                { id: 'user', label: 'User', domain: 'usecase' },
                { id: 'clock', label: 'Clock', domain: 'usecase' },
                { id: 'calendar', label: 'Calendar', domain: 'usecase' },
                { id: 'card', label: 'Card', domain: 'usecase' },
                { id: 'chart', label: 'Chart', domain: 'usecase' },
                { id: 'cart', label: 'Cart', domain: 'usecase' },
                { id: 'play', label: 'Play', domain: 'usecase' },
                { id: 'pause', label: 'Pause', domain: 'usecase' },
                { id: 'stop', label: 'Stop', domain: 'usecase' },
                { id: 'infinity', label: 'Infinity', domain: 'usecase' },

                // Story
                { id: 'beat', label: 'Beat', domain: 'story' },
                { id: 'scene', label: 'Scene', domain: 'story' },
                { id: 'arc', label: 'Arc', domain: 'story' },
                { id: 'twist', label: 'Twist', domain: 'story' },
                { id: 'stakes', label: 'Stakes', domain: 'story' },
                { id: 'character', label: 'Character', domain: 'story' },
                { id: 'whisper', label: 'Whisper', domain: 'story' },
                { id: 'foreshadow', label: 'Foreshadow', domain: 'story' },
                { id: 'world', label: 'World', domain: 'story' },
                { id: 'voice', label: 'Voice', domain: 'story' },

                // System
                { id: 'feedback', label: 'Feedback', domain: 'system' },
                { id: 'bottleneck', label: 'Bottleneck', domain: 'system' },
                { id: 'cascade', label: 'Cascade', domain: 'system' },
                { id: 'threshold', label: 'Threshold', domain: 'system' },
                { id: 'trade-off', label: 'Trade-off', domain: 'system' },
                { id: 'pareto', label: 'Pareto', domain: 'system' },
                { id: 'pivot', label: 'Pivot', domain: 'system' },
                { id: 'lever', label: 'Lever', domain: 'system' },
                { id: 'compound', label: 'Compound', domain: 'system' },
                { id: 'risk', label: 'Risk', domain: 'system' }
              ].filter((sOption) => selectedShapeDomain === 'all' || sOption.domain === selectedShapeDomain)
               .map((sOption) => (
                <button
                  key={sOption.id}
                  onClick={() => {
                    setSelectedShapeType(sOption.id as typeof selectedShapeType);
                    // The choice is made — get the palette out of the way.
                    setShowShapeOptions(false);
                    // If a shape is selected, instantly change its type
                    if (selectedId && selectedObject && selectedObject.type === 'shape') {
                      updateObject(selectedId, {
                        style: {
                          ...selectedObject.style,
                          shapeType: sOption.id,
                        }
                      });
                    } else {
                      // Instantly spawn shape at the center of screen
                      const centerX = (-camera.x + window.innerWidth / 2) / camera.zoom;
                      const centerY = (-camera.y + window.innerHeight / 2) / camera.zoom;
                      const obj = addObject({
                        type: 'shape',
                        x: centerX - 75,
                        y: centerY - 75,
                        width: 150,
                        height: 150,
                        content: '',
                        style: {
                          shapeType: sOption.id,
                          color: 'rgba(255, 252, 248, 0.75)',
                          borderColor: 'var(--accent-light)',
                        }
                      });
                      setSelectedId(obj.id);
                      setEditingId(obj.id);
                      setMode('select');
                    }
                  }}
                  className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl border transition-all ${
                    selectedShapeType === sOption.id
                      ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] shadow-sm'
                      : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                  }`}
                  title={sOption.label}
                >
                  {/* Real shape preview — identical geometry to the canvas renderer */}
                  <span className="mb-1 flex items-center justify-center">
                    <ShapePreview
                      type={sOption.id}
                      size={24}
                      fill={selectedShapeType === sOption.id ? 'var(--accent-subtle)' : 'rgba(255, 252, 248, 0.9)'}
                      stroke={selectedShapeType === sOption.id ? 'var(--accent)' : 'currentColor'}
                    />
                  </span>
                  <span className="text-[8px] uppercase tracking-wider font-medium">{sOption.label}</span>
                </button>
              ))}
            </div>
            
            {/* Color options for shape background! */}
            <div className="w-full h-px bg-[var(--border)] my-1" />
            <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider px-1">Shape Style</span>
            <div className="flex gap-1.5 justify-center">
              {[
                { name: 'Cream', bg: 'rgba(255, 252, 248, 0.75)', border: 'var(--accent-light)' },
                { name: 'Peach', bg: 'rgba(232, 169, 123, 0.15)', border: 'var(--accent)' },
                { name: 'Sage', bg: 'rgba(69, 183, 97, 0.15)', border: 'rgba(69, 183, 97, 0.5)' },
                { name: 'Sky', bg: 'rgba(74, 144, 217, 0.15)', border: 'rgba(74, 144, 217, 0.5)' },
                { name: 'Amethyst', bg: 'rgba(155, 89, 182, 0.15)', border: 'rgba(155, 89, 182, 0.5)' }
              ].map((styleOption) => (
                <button
                  key={styleOption.name}
                  onClick={() => {
                    if (selectedId && selectedObject && selectedObject.type === 'shape') {
                      updateObject(selectedId, {
                        style: {
                          ...selectedObject.style,
                          color: styleOption.bg,
                          borderColor: styleOption.border,
                        }
                      });
                    }
                    setShowShapeOptions(false);
                  }}
                  className="w-6.5 h-6.5 rounded-full border transition-all hover:scale-110"
                  style={{
                    background: styleOption.bg,
                    borderColor: styleOption.border,
                  }}
                  title={styleOption.name}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Arrow options are now handled entirely by the left SelectionPanel
          (both the tool defaults in arrow mode and editing a selected arrow). */}
      <AnimatePresence>
        {false && (
          <motion.div
            className="glass-panel absolute bottom-14 left-1/2 -translate-x-1/2 p-4 flex flex-col gap-3 min-w-[240px]"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider px-1">Pointer Type</span>
            <div className="grid grid-cols-4 gap-2 justify-center">
              {[
                {
                  id: 'line',
                  label: 'Line',
                  icon: (
                    <svg width="22" height="14" viewBox="0 0 24 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <line x1="2" y1="7" x2="22" y2="7" />
                    </svg>
                  ),
                },
                {
                  id: 'arrow',
                  label: 'Arrow',
                  icon: (
                    <svg width="22" height="14" viewBox="0 0 24 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="2" y1="7" x2="19" y2="7" />
                      <polyline points="14 2 20 7 14 12" />
                    </svg>
                  ),
                },
                {
                  id: 'dot',
                  label: 'Dot',
                  icon: (
                    <svg width="22" height="14" viewBox="0 0 24 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <line x1="2" y1="7" x2="16" y2="7" />
                      <circle cx="19.5" cy="7" r="3" fill="currentColor" stroke="none" />
                    </svg>
                  ),
                },
                {
                  id: 'diamond',
                  label: 'Diamond',
                  icon: (
                    <svg width="22" height="14" viewBox="0 0 24 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="2" y1="7" x2="15" y2="7" />
                      <polygon points="18.5 3.5 22 7 18.5 10.5 15 7" fill="currentColor" stroke="none" />
                    </svg>
                  ),
                },
              ].map((aOption) => (
                <button
                  key={aOption.id}
                  onClick={() => {
                    setSelectedArrowPointerType(aOption.id as typeof selectedArrowPointerType);
                    // If an arrow object is currently selected, instantly update its pointer head style
                    if (selectedId && selectedObject && selectedObject.type === 'arrow') {
                      updateObject(selectedId, {
                        style: {
                          ...selectedObject.style,
                          pointerType: aOption.id,
                        }
                      });
                    }
                  }}
                  className={`flex flex-col items-center justify-center w-13 h-13 rounded-xl border transition-all ${
                    (selectedObject?.style?.pointerType === aOption.id || (!selectedObject && selectedArrowPointerType === aOption.id))
                      ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] shadow-sm'
                      : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                  }`}
                  title={aOption.label}
                >
                  <span className="mb-0.5 flex items-center justify-center">{aOption.icon}</span>
                  <span className="text-[7.5px] uppercase tracking-wider font-semibold">{aOption.label}</span>
                </button>
              ))}
            </div>
            
            {/* Style options for colors */}
            <div className="w-full h-px bg-[var(--border)] my-1" />
            <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider px-1">Arrow Style</span>
            <div className="flex gap-1.5 justify-center">
              {[
                { name: 'Red', hex: '#D64545' },
                { name: 'Peach', hex: '#E67E22' },
                { name: 'Sage', hex: '#45B761' },
                { name: 'Sky', hex: '#4A90D9' },
                { name: 'Amethyst', hex: '#9B59B6' },
                { name: 'Classic', hex: '#2D2A26' }
              ].map((colorOption) => {
                const isActive = selectedObject?.style?.color === colorOption.hex || (!selectedObject && drawColor === colorOption.hex);
                return (
                  <button
                    key={colorOption.name}
                    onClick={() => {
                      setDrawColor(colorOption.hex);
                      if (selectedId && selectedObject && selectedObject.type === 'arrow') {
                        updateObject(selectedId, {
                          style: {
                            ...selectedObject.style,
                            color: colorOption.hex,
                          }
                        });
                      }
                    }}
                    className="w-6.5 h-6.5 rounded-full border transition-all hover:scale-110"
                    style={{
                      background: colorOption.hex,
                      borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                      borderWidth: isActive ? '2px' : '1px',
                      boxShadow: isActive ? '0 0 0 2px var(--accent-subtle)' : 'none',
                    }}
                    title={colorOption.name}
                  />
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Frame options panel — only while placing a new frame; editing an
          existing frame is handled by the left SelectionPanel. */}
      <AnimatePresence>
        {showFrameOptions && mode === 'frame' && (
          <motion.div
            style={{ padding: 16 }}
            className="glass-panel absolute bottom-14 left-1/2 -translate-x-1/2 flex flex-col gap-3 min-w-[240px]"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider">
              Frame type
            </span>
            <div className="flex gap-1">
              {FRAME_KINDS.map((k) => {
                const active = frameDraftKind === k.id;
                return (
                  <button
                    key={k.id}
                    onClick={() => setFrameDraftKind(k.id)}
                    title={k.blurb}
                    aria-pressed={active}
                    className="flex-1 rounded-lg text-[10px] font-extrabold transition-all cursor-pointer active:scale-95 whitespace-nowrap"
                    style={{
                      padding: '6px 4px',
                      background: active ? k.color : 'var(--well)',
                      color: active ? '#fff' : 'var(--text-secondary)',
                    }}
                  >
                    {k.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-[var(--text-muted)] text-center leading-relaxed">
              {frameKindMeta(frameDraftKind).blurb}
            </p>

            {/* Colour is the user's to choose only on a grouping frame — every
                other kind is locked to its identity colour so it can't be
                mistaken for one. */}
            {frameDraftKind === 'normal' && (
            <>
            <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider">
              Frame color
            </span>
            <div className="flex gap-1.5 justify-center">
              {FRAME_COLORS.map((c) => {
                const isActive = (selectedObject?.style?.frameColor as string) === c.hex;
                return (
                  <button
                    key={c.hex}
                    onClick={() => {
                      if (selectedId && selectedObject && selectedObject.type === 'frame') {
                        updateObject(selectedId, { style: { ...selectedObject.style, frameColor: c.hex } });
                      }
                      setShowFrameOptions(false);
                    }}
                    className="w-7 h-7 rounded-full border transition-all hover:scale-110"
                    style={{
                      background: c.hex,
                      borderColor: isActive ? 'var(--text-primary)' : 'transparent',
                      boxShadow: isActive ? '0 0 0 2px var(--accent-subtle)' : 'none',
                    }}
                    title={c.name}
                  />
                );
              })}
            </div>
            </>
            )}

            <p className="text-[10px] text-[var(--text-muted)] text-center leading-relaxed">
              Click to place it, then click its title tab to name it.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Relax options panel */}
      <AnimatePresence>
        {showRelaxOptions && mode === 'relax' && (
          <motion.div
            style={{ padding: 16 }}
            className="glass-panel absolute bottom-14 left-1/2 -translate-x-1/2 flex flex-col gap-3 min-w-[240px]"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider">
              Stress Reliefer
            </span>

            <div className="grid grid-cols-3 gap-1.5">
              {RELAX_EFFECT_LIST.map((fx) => {
                const active = relaxEffect === fx.id;
                return (
                  <button
                    key={fx.id}
                    title={fx.label}
                    onClick={() => {
                      setRelaxEffect(fx.id);
                      // Get out of the way immediately — the canvas is the point.
                      setShowRelaxOptions(false);
                    }}
                    style={{ padding: '10px 8px' }}
                    className={`flex flex-col items-center gap-1 rounded-lg border transition-all cursor-pointer ${
                      active
                        ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent-light)] shadow-sm'
                        : 'bg-transparent text-[var(--text-secondary)] border-transparent hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    <RelaxIcon id={fx.id} />
                    <span className="text-[9px] font-semibold leading-tight text-center">{fx.label}</span>
                  </button>
                );
              })}
            </div>

            <p className="text-[10px] text-[var(--text-muted)] text-center leading-relaxed">
              {activeRelax
                ? activeRelax.blurb
                : 'Pick an effect, then click anywhere on the canvas to let it go.'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Canvas background / color-mode panel */}
      <AnimatePresence>
        {showBgOptions && (
          <motion.div
            style={{ padding: 16 }}
            className="glass-panel absolute bottom-14 left-1/2 -translate-x-1/2"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <CanvasBackgroundPanel onPick={() => setShowBgOptions(false)} />
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
