'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore, InteractionMode } from '@/store/canvasStore';
import { useAgentChatStore } from '@/store/agentChatStore';
import { useVoiceStore } from '@/store/voiceStore';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import WorkflowMenu from './WorkflowMenu';
import BrainstormPanel, { PinIcon } from './BrainstormPanel';
import ShapePreview from '@/components/canvas/ShapePreview';
import { FRAME_KINDS, frameKindMeta } from '@/lib/frames';

const FRAME_COLORS = [
  { name: 'Terracotta', hex: '#C97B4B' },
  { name: 'Sage', hex: '#45B761' },
  { name: 'Sky', hex: '#4A90D9' },
  { name: 'Amethyst', hex: '#9B59B6' },
  { name: 'Rose', hex: '#E93D82' },
  { name: 'Charcoal', hex: '#2D2A26' },
];

/* Ten, and the same ten families the selection panel offers, so a drawn line
   and a written word can be the same colour without hunting for it twice.
   This was twenty-one swatches in five commented rows ("Neons", "Pastels"…) —
   a palette nobody picks from, on top of a hex box, an RGB pad and an HSL pad
   that all set the identical value. */
const DRAW_COLORS = [
  '#2D2A26', '#FFFFFF', '#D64545', '#E67E22', '#F5B70A',
  '#2F9E6E', '#00A5B5', '#3E63DD', '#8B5FBF', '#E93D82',
];

const DRAW_GRADIENTS = [
  { id: 'url(#sunset-grad)', css: 'linear-gradient(135deg, #FF512F 0%, #DD2476 100%)', label: 'Sunset' },
  { id: 'url(#ocean-grad)', css: 'linear-gradient(135deg, #02AAB0 0%, #00CDAC 100%)', label: 'Ocean' },
  { id: 'url(#fire-grad)', css: 'linear-gradient(135deg, #F5576C 0%, #F08080 100%)', label: 'Fire' },
  { id: 'url(#lavender-grad)', css: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)', label: 'Lavender' },
  { id: 'url(#cosmic-grad)', css: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)', label: 'Cosmic' },
];

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
  const selectedObject = objects.find(o => o.id === selectedId);
  const camera = useCanvasStore((s) => s.camera);
  const setCommentMode = useCanvasStore((s) => s.setCommentMode);
  const setThreadsSidebarOpen = useCanvasStore((s) => s.setThreadsSidebarOpen);
  /* The AI agent chat now owns this slot. Human↔human DMs used to be here, but
     the agent is the thing you reach for constantly while working a board — a
     conversation with a teammate is an occasional errand, so it moved into the
     insert (+) menu and the slash menu where the other occasional things live. */
  const agentChatOpen = useAgentChatStore((s) => s.panelOpen);
  const toggleAgentChat = useAgentChatStore((s) => s.toggle);
  const agentStreaming = useAgentChatStore((s) => s.streaming);

  const [showDrawOptions, setShowDrawOptions] = useState(false);
  const [showAdvancedDraw, setShowAdvancedDraw] = useState(false);

  const [showShapeOptions, setShowShapeOptions] = useState(false);
  const [showFrameOptions, setShowFrameOptions] = useState(false);
  const [showBrainstormOptions, setShowBrainstormOptions] = useState(false);
  const [showWorkflowMenu, setShowWorkflowMenu] = useState(false);

  /** Shut every toolbar flyout. One tool's panel is never open beside another's. */
  const closeAllPanels = React.useCallback(() => {
    setShowDrawOptions(false);
    setShowShapeOptions(false);
    setShowFrameOptions(false);
    setShowBrainstormOptions(false);
    setShowWorkflowMenu(false);
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
    setShowWorkflowMenu(false);
  }, [mode]);

  const [selectedShapeDomain, setSelectedShapeDomain] = useState<'all' | 'brainstorm' | 'code' | 'love' | 'usecase' | 'story' | 'system'>('all');
  const selectedShapeType = useCanvasStore((s) => s.selectedShapeType);
  const setSelectedShapeType = useCanvasStore((s) => s.setSelectedShapeType);

  // When selectedObject changes, sync the toolbar state (but don't auto-open)
  React.useEffect(() => {
    if (selectedObject && (selectedObject.type === 'text' || selectedObject.type === 'heading' || selectedObject.type === 'card' || selectedObject.type === 'sticky')) {
      if (selectedObject.style?.fontSize && selectedObject.style.fontSize !== textSize) {
        setTextSize(selectedObject.style.fontSize as number);
      }
    }
  }, [selectedObject, textSize, setTextSize]);

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
                  (tool.id === 'brainstorm' && showBrainstormOptions);

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

        {/* This bar is TOOLS — the things that make a mark on the board. Four
            board-level modes used to sit out here and diluted that: Plugins,
            Canvas background, Stress Reliefer and Flow Mode. They're all
            properties of the board rather than something you draw with, so
            they live in the ▾ menu beside the board's name now. Lock-the-view
            is gone entirely. */}

        {/* AI Agent chat — opens the resizable panel on the right. This is the
            slot the DM chat used to hold; the agent earns it because it's the
            one conversation you have constantly while building a board. */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            closeAllPanels();
            setCommentMode(false);
            setThreadsSidebarOpen(false);
            toggleAgentChat();
          }}
          className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-all ${
            agentChatOpen
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
          }`}
          title="AI Agent — chat & build on this canvas"
        >
          {agentChatOpen && (
            <motion.span
              layoutId="toolbar-active"
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="absolute inset-0 rounded-lg clay-inset"
            />
          )}
          <span className="relative flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
            </svg>
          </span>
          {/* A reply still streaming while the panel is shut is the one thing
              worth interrupting for — a quiet pulse, not a number. */}
          {agentStreaming && !agentChatOpen && (
            <motion.span
              className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--accent)]"
              animate={{ opacity: [0.35, 1, 0.35], scale: [0.85, 1.15, 0.85] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            />
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

      {/* Draw options panel — brush, colour, size. That's the whole of what a
          pen needs to be picked up. Everything else (opacity, flow, hardness,
          texture, blend, pressure, gradients) is real but rare, so it sits
          behind one "More" line instead of an 840px three-column control desk
          that opened over the drawing. */}
      <AnimatePresence>
        {showDrawOptions && mode === 'draw' && (
          <motion.div
            style={{ padding: 14, width: 300 }}
            className="tool-panel absolute bottom-14 left-1/2 -translate-x-1/2 flex flex-col gap-3 max-w-[92vw]"
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Brush. The lit segment names the tool, so the "Pen Brush"
                heading that used to sit above it was saying it twice. */}
            <div className="flex rounded-xl gap-0.5" style={{ padding: 3, background: 'var(--well)' }}>
              {([
                ['pen', 'Pen'],
                ['highlighter', 'Highlighter'],
                ['eraser', 'Eraser'],
              ] as const).map(([id, label]) => {
                const active =
                  id === 'pen' ? (!eraserMode && !highlighterMode)
                  : id === 'highlighter' ? highlighterMode
                  : eraserMode;
                return (
                  <button
                    key={id}
                    onClick={() => { setEraserMode(id === 'eraser'); setHighlighterMode(id === 'highlighter'); }}
                    aria-pressed={active}
                    style={{ padding: '6px 4px' }}
                    className={`flex-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer active:scale-95 ${
                      active ? 'clay-inset text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Colour: the house palette on one line, then the two escapes —
                any colour at all, and a pixel off the screen. The 20-swatch
                block plus RGB and HSL number pads it replaces were three
                different ways of typing the same value. */}
            {!eraserMode && (
              <div className="flex items-center gap-2">
                <div className="grid gap-[3px] flex-1 min-w-0" style={{ gridTemplateColumns: 'repeat(10, minmax(0, 1fr))' }}>
                  {DRAW_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setDrawColor(color)}
                      title={color}
                      aria-label={color}
                      className="w-full rounded-full transition-transform duration-100 hover:scale-[1.18] active:scale-95 cursor-pointer"
                      style={{
                        aspectRatio: '1 / 1',
                        background: color,
                        boxShadow: drawColor === color
                          ? '0 0 0 2px var(--accent), 0 0 0 3.5px var(--accent-subtle)'
                          : 'inset 0 0 0 1px rgba(128,128,128,0.28)',
                      }}
                    />
                  ))}
                </div>

                <label
                  title="Any colour"
                  className="w-6 h-6 shrink-0 rounded-lg cursor-pointer relative overflow-hidden"
                  style={{ background: 'conic-gradient(#F00,#FF0,#0F0,#0FF,#00F,#F0F,#F00)' }}
                >
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(drawColor) ? drawColor : '#2D2A26'}
                    onChange={(e) => setDrawColor(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    aria-label="Pick any colour"
                  />
                </label>

                {typeof window !== 'undefined' && 'EyeDropper' in window && (
                  <button
                    onClick={async () => {
                      try {
                        const Ctor = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
                        const { sRGBHex } = await new Ctor().open();
                        if (sRGBHex) setDrawColor(sRGBHex.toUpperCase());
                      } catch {
                        /* Escape — not an error */
                      }
                    }}
                    title="Eyedropper — sample any colour on screen"
                    aria-label="Eyedropper"
                    className="w-6 h-6 shrink-0 rounded-lg flex items-center justify-center bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer active:scale-95"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m2 22 1-1h3l9-9 3 3-9 9H3l-1-1Z" />
                      <path d="M19 11l-4-4" /><path d="M15 3h6v6" />
                    </svg>
                  </button>
                )}
              </div>
            )}

            {/* Size: one slider, with a dot drawn at the true nib size. The old
                panel had five preset buttons here AND a size slider hidden in
                advanced mode, which could disagree with each other. */}
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center shrink-0" style={{ width: 22, height: 22 }}>
                <span
                  className="rounded-full"
                  style={{
                    width: Math.max(3, Math.min(20, drawSize)),
                    height: Math.max(3, Math.min(20, drawSize)),
                    background: eraserMode || drawColor.startsWith('url(') ? 'var(--text-secondary)' : drawColor,
                    opacity: highlighterMode ? 0.4 : 1,
                    boxShadow: 'inset 0 0 0 1px rgba(128,128,128,0.28)',
                  }}
                />
              </span>
              <input
                type="range"
                min={1}
                max={60}
                value={Math.min(60, drawSize)}
                onChange={(e) => setDrawSize(parseInt(e.target.value))}
                className="flex-1 accent-[var(--accent)] cursor-pointer"
                style={{ height: 4 }}
                aria-label="Brush size"
              />
              <span className="text-[10px] font-bold tabular-nums text-[var(--text-secondary)] text-right shrink-0" style={{ width: 24 }}>
                {drawSize}
              </span>
            </div>

            {/* The one line that reveals the rest. A quiet text row, not a
                filled accent bar — it's a disclosure, not the main action. */}
            <button
              onClick={() => setShowAdvancedDraw(!showAdvancedDraw)}
              style={{ padding: '5px 6px' }}
              className="flex items-center justify-center gap-1 rounded-lg text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
            >
              {showAdvancedDraw ? 'Less' : 'More'}
              <motion.span animate={{ rotate: showAdvancedDraw ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="6 15 12 9 18 15" />
                </svg>
              </motion.span>
            </button>

            <AnimatePresence initial={false}>
              {showAdvancedDraw && (
                <motion.div
                  key="draw-more"
                  className="flex flex-col gap-3"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16 }}
                >
                  <div className="w-full h-px bg-[var(--border)]" />

                  {!eraserMode && (
                    <div className="grid gap-x-3 gap-y-2.5" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                      {([
                        ['Opacity', drawOpacity, setDrawOpacity, 0.05],
                        ['Flow', drawFlow, setDrawFlow, 0.05],
                        ['Hardness', drawHardness, setDrawHardness, 0.1],
                        ['Smooth', drawSmoothing, setDrawSmoothing, 0],
                        ['Stabilize', drawStabilization, setDrawStabilization, 0],
                      ] as const).map(([label, val, set, min]) => (
                        <div key={label} className="flex flex-col gap-0.5 min-w-0">
                          <div className="flex justify-between items-center">
                            <span className="text-[9px] uppercase font-extrabold tracking-[0.1em] text-[var(--text-tertiary)]">{label}</span>
                            <span className="text-[9px] font-bold tabular-nums text-[var(--text-secondary)]">{Math.round(val * 100)}%</span>
                          </div>
                          <input
                            type="range" min={min} max={1} step={0.01} value={val}
                            onChange={(e) => set(parseFloat(e.target.value))}
                            className="w-full accent-[var(--accent)] cursor-pointer"
                            style={{ height: 3 }}
                          />
                        </div>
                      ))}

                      <div className="flex flex-col gap-0.5 min-w-0 justify-end">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] uppercase font-extrabold tracking-[0.1em] text-[var(--text-tertiary)]">Pressure</span>
                          <button
                            onClick={() => setDrawPressure(!drawPressure)}
                            role="switch"
                            aria-checked={drawPressure}
                            className="relative shrink-0 transition-colors duration-200 cursor-pointer"
                            style={{
                              width: 28, height: 16, borderRadius: 999,
                              background: drawPressure ? 'var(--accent)' : 'var(--well)',
                              boxShadow: drawPressure ? 'none' : 'inset 0 1px 3px rgba(90,62,40,0.18)',
                            }}
                          >
                            <span
                              className="absolute top-1/2 transition-transform duration-200"
                              style={{
                                width: 12, height: 12, borderRadius: '50%', background: '#fff', left: 2,
                                transform: `translateY(-50%) translateX(${drawPressure ? 12 : 0}px)`,
                                boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                              }}
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {!eraserMode && (
                    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                      <label className="flex flex-col gap-1 min-w-0">
                        <span className="text-[9px] uppercase font-extrabold tracking-[0.1em] text-[var(--text-tertiary)]">Texture</span>
                        <select
                          value={drawTexture}
                          onChange={(e) => setDrawTexture(e.target.value as 'none' | 'chalk' | 'watercolor' | 'noise' | 'splatter')}
                          style={{ padding: '4px 6px' }}
                          className="w-full bg-[var(--well)] text-[var(--text-primary)] rounded-lg outline-none text-[11px] font-semibold cursor-pointer"
                        >
                          <option value="none">None</option>
                          <option value="chalk">Chalk</option>
                          <option value="watercolor">Watercolour</option>
                          <option value="noise">Grain</option>
                          <option value="splatter">Splatter</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 min-w-0">
                        <span className="text-[9px] uppercase font-extrabold tracking-[0.1em] text-[var(--text-tertiary)]">Blend</span>
                        <select
                          value={drawBlendMode}
                          onChange={(e) => setDrawBlendMode(e.target.value as 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten')}
                          style={{ padding: '4px 6px' }}
                          className="w-full bg-[var(--well)] text-[var(--text-primary)] rounded-lg outline-none text-[11px] font-semibold cursor-pointer"
                        >
                          <option value="normal">Normal</option>
                          <option value="multiply">Multiply</option>
                          <option value="screen">Screen</option>
                          <option value="overlay">Overlay</option>
                          <option value="darken">Darken</option>
                          <option value="lighten">Lighten</option>
                        </select>
                      </label>
                    </div>
                  )}

                  {!eraserMode && (
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] uppercase font-extrabold tracking-[0.1em] text-[var(--text-tertiary)] shrink-0">Gradient</span>
                      <div className="flex gap-1.5">
                        {DRAW_GRADIENTS.map((grad) => (
                          <button
                            key={grad.id}
                            onClick={() => setDrawColor(grad.id)}
                            title={grad.label}
                            aria-label={grad.label}
                            className="w-5 h-5 rounded-full transition-transform duration-100 hover:scale-110 active:scale-95 cursor-pointer"
                            style={{
                              background: grad.css,
                              boxShadow: drawColor === grad.id
                                ? '0 0 0 2px var(--accent), 0 0 0 3.5px var(--accent-subtle)'
                                : 'inset 0 0 0 1px rgba(128,128,128,0.28)',
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {eraserMode && (
                    <p className="text-[10px] text-[var(--text-tertiary)] text-center leading-relaxed">
                      The eraser only takes a size. Switch to Pen or Highlighter for colour and brush settings.
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Shape options panel — only while placing a new shape; editing an
          existing shape is handled by the left SelectionPanel. */}
      <AnimatePresence>
        {showShapeOptions && mode === 'shape' && (
          <motion.div
            style={{ padding: 16 }}
            className="tool-panel absolute bottom-14 left-1/2 -translate-x-1/2 flex flex-col gap-3 min-w-[280px]"
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
                  { id: 'science', label: 'Science' },
                  { id: 'nature', label: 'Nature' },
                  { id: 'ui', label: 'UI & Layout' },
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
                { id: 'lightbulb-spark', label: 'Idea Spark', domain: 'brainstorm' },
                { id: 'compass', label: 'Compass', domain: 'brainstorm' },
                { id: 'rocket', label: 'Rocket', domain: 'brainstorm' },
                { id: 'radar', label: 'Radar', domain: 'brainstorm' },
                { id: 'prism', label: 'Prism', domain: 'brainstorm' },
                { id: 'light-beam', label: 'Ray', domain: 'brainstorm' },
                { id: 'telescope', label: 'Foresight', domain: 'brainstorm' },
                { id: 'magnifier', label: 'Zoom', domain: 'brainstorm' },
                { id: 'atom-idea', label: 'Idea Atom', domain: 'brainstorm' },
                { id: 'spark-cluster', label: 'Sparks', domain: 'brainstorm' },
                { id: 'anchor', label: 'Anchor', domain: 'brainstorm' },
                { id: 'bridge', label: 'Bridge', domain: 'brainstorm' },

                // Code (Tech)
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
                { id: 'cpu-chip', label: 'Chip', domain: 'code' },
                { id: 'cloud-download', label: 'Cloud In', domain: 'code' },
                { id: 'cloud-upload', label: 'Cloud Out', domain: 'code' },
                { id: 'git-commit', label: 'Commit', domain: 'code' },
                { id: 'binary', label: 'Binary', domain: 'code' },
                { id: 'cube-stack', label: 'Cube Stack', domain: 'code' },
                { id: 'stack', label: 'Tech Stack', domain: 'code' },
                { id: 'network', label: 'Mesh', domain: 'code' },
                { id: 'data-flow', label: 'Stream', domain: 'code' },
                { id: 'bug', label: 'Bug', domain: 'code' },
                { id: 'terminal-box', label: 'Shell', domain: 'code' },
                { id: 'fingerprint', label: 'Biometric', domain: 'code' },
                { id: 'wifi', label: 'Signal', domain: 'code' },
                { id: 'database-stack', label: 'DB Cluster', domain: 'code' },
                { id: 'ai-spark', label: 'AI Model', domain: 'code' },

                // Love (Expressive)
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
                { id: 'fire', label: 'Flame', domain: 'love' },
                { id: 'star-burst', label: 'Supernova', domain: 'love' },
                { id: 'heart-pulse', label: 'Pulse', domain: 'love' },
                { id: 'crown', label: 'Crown', domain: 'love' },
                { id: 'gem', label: 'Jewel', domain: 'love' },
                { id: 'ribbon-award', label: 'Award', domain: 'love' },
                { id: 'peace', label: 'Peace', domain: 'love' },
                { id: 'coffee-cup', label: 'Mug', domain: 'love' },
                { id: 'music-note', label: 'Melody', domain: 'love' },
                { id: 'sunburst', label: 'Radiance', domain: 'love' },
                { id: 'hand-shake', label: 'Pact', domain: 'love' },
                { id: 'party-popper', label: 'Celebrate', domain: 'love' },

                // Usecase (Actions)
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
                { id: 'arrow-up-right', label: 'Trend Up', domain: 'usecase' },
                { id: 'arrow-down-left', label: 'Inflow', domain: 'usecase' },
                { id: 'rotate-cw', label: 'Refresh', domain: 'usecase' },
                { id: 'rotate-ccw', label: 'Undo', domain: 'usecase' },
                { id: 'split', label: 'Split', domain: 'usecase' },
                { id: 'merge', label: 'Join', domain: 'usecase' },
                { id: 'filter-list', label: 'Filter', domain: 'usecase' },
                { id: 'sort', label: 'Sort', domain: 'usecase' },
                { id: 'download', label: 'Download', domain: 'usecase' },
                { id: 'upload', label: 'Upload', domain: 'usecase' },
                { id: 'lock', label: 'Lock', domain: 'usecase' },
                { id: 'unlock', label: 'Unlock', domain: 'usecase' },
                { id: 'eye', label: 'Inspect', domain: 'usecase' },
                { id: 'eye-off', label: 'Hidden', domain: 'usecase' },
                { id: 'layers', label: 'Layers', domain: 'usecase' },

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
                { id: 'hero-cape', label: 'Protagonist', domain: 'story' },
                { id: 'villain-mask', label: 'Antagonist', domain: 'story' },
                { id: 'climax-peak', label: 'Climax', domain: 'story' },
                { id: 'resolution', label: 'Resolution', domain: 'story' },
                { id: 'sub-plot', label: 'Subplot', domain: 'story' },
                { id: 'theme-core', label: 'Motif', domain: 'story' },
                { id: 'flashback', label: 'Flashback', domain: 'story' },
                { id: 'prop', label: 'Artifact', domain: 'story' },
                { id: 'dialogue-bubble', label: 'Dialogue', domain: 'story' },
                { id: 'scroll-manuscript', label: 'Codex', domain: 'story' },
                { id: 'hourglass', label: 'Tension', domain: 'story' },
                { id: 'keyhole', label: 'Mystery', domain: 'story' },
                { id: 'map-location', label: 'Realm', domain: 'story' },
                { id: 'sword-shield', label: 'Conflict', domain: 'story' },
                { id: 'portal', label: 'Portal', domain: 'story' },

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
                { id: 'risk', label: 'Risk', domain: 'system' },
                { id: 'feedback-loop', label: 'Circular Loop', domain: 'system' },
                { id: 'balancing-loop', label: 'Balancing B', domain: 'system' },
                { id: 'reinforcing-loop', label: 'Reinforce R', domain: 'system' },
                { id: 'tipping-point', label: 'Tipping Pt', domain: 'system' },
                { id: 'domino', label: 'Domino', domain: 'system' },
                { id: 'equilibrium', label: 'Equilibrium', domain: 'system' },
                { id: 'entropy', label: 'Entropy', domain: 'system' },
                { id: 'synergy', label: 'Synergy', domain: 'system' },
                { id: 'black-box', label: 'Black Box', domain: 'system' },
                { id: 'flywheel', label: 'Flywheel', domain: 'system' },
                { id: 'funnel-filter', label: 'Filter Funnel', domain: 'system' },
                { id: 'friction', label: 'Friction', domain: 'system' },
                { id: 'oscillation', label: 'Oscillation', domain: 'system' },
                { id: 'bottleneck-pipe', label: 'Choke Point', domain: 'system' },
                { id: 'attractor', label: 'Attractor', domain: 'system' },

                // Science (New Category)
                { id: 'dna', label: 'DNA Helix', domain: 'science' },
                { id: 'atom-core', label: 'Quantum Atom', domain: 'science' },
                { id: 'flask', label: 'Flask', domain: 'science' },
                { id: 'molecule', label: 'Molecule', domain: 'science' },
                { id: 'infinity-loop', label: 'Möbius', domain: 'science' },
                { id: 'pi', label: 'Pi Constant', domain: 'science' },
                { id: 'wave-sine', label: 'Sine Wave', domain: 'science' },
                { id: 'delta', label: 'Delta', domain: 'science' },
                { id: 'scale-balance', label: 'Balance Scale', domain: 'science' },
                { id: 'magnet-field', label: 'Mag Field', domain: 'science' },
                { id: 'orbit', label: 'Orbital', domain: 'science' },
                { id: 'sigma', label: 'Sigma Sum', domain: 'science' },

                // Nature (New Category)
                { id: 'leaf', label: 'Eco Leaf', domain: 'nature' },
                { id: 'tree', label: 'Growth Tree', domain: 'nature' },
                { id: 'mountain', label: 'Peak Mountain', domain: 'nature' },
                { id: 'water-drop', label: 'Water Drop', domain: 'nature' },
                { id: 'sun-rays', label: 'Solar Rays', domain: 'nature' },
                { id: 'snowflake', label: 'Snowflake', domain: 'nature' },
                { id: 'planet-ring', label: 'Saturn Planet', domain: 'nature' },
                { id: 'galaxy', label: 'Galaxy Spiral', domain: 'nature' },
                { id: 'comet', label: 'Shooting Star', domain: 'nature' },
                { id: 'volcano', label: 'Eruption', domain: 'nature' },
                { id: 'sprout', label: 'Seedling', domain: 'nature' },
                { id: 'feather', label: 'Feather', domain: 'nature' },

                // UI & Layout (New Category)
                { id: 'layout-grid', label: 'Grid Matrix', domain: 'ui' },
                { id: 'layout-columns', label: 'Columns', domain: 'ui' },
                { id: 'layout-sidebar', label: 'Sidebar', domain: 'ui' },
                { id: 'modal-box', label: 'Modal Dialog', domain: 'ui' },
                { id: 'card-view', label: 'Content Card', domain: 'ui' },
                { id: 'button-primary', label: 'Action Button', domain: 'ui' },
                { id: 'toggle-switch', label: 'Toggle Switch', domain: 'ui' },
                { id: 'slider-control', label: 'Range Slider', domain: 'ui' },
                { id: 'tab-bar', label: 'Nav Tabs', domain: 'ui' },
                { id: 'search-bar', label: 'Search Bar', domain: 'ui' },
                { id: 'avatar-circle', label: 'User Avatar', domain: 'ui' },
                { id: 'image-placeholder', label: 'Media Frame', domain: 'ui' },
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
                      // Selected only — shapes hold no text to type into.
                      setSelectedId(obj.id);
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

      {/* Frame options panel — only while placing a new frame; editing an
          existing frame is handled by the left SelectionPanel. */}
      <AnimatePresence>
        {showFrameOptions && mode === 'frame' && (
          <motion.div
            style={{ padding: 16 }}
            className="tool-panel absolute bottom-14 left-1/2 -translate-x-1/2 flex flex-col gap-3 min-w-[240px]"
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

    </div>
  );
}
