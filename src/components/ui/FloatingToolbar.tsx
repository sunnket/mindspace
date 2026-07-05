'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore, InteractionMode } from '@/store/canvasStore';
import { useVoiceStore } from '@/store/voiceStore';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import WorkflowMenu from './WorkflowMenu';

const DRAW_COLORS = [
  '#2D2A26', '#0B57D0', '#D93025', '#188038', // Classics
  '#FFB300', '#FF7043', '#D81B60', '#9B59B6', // Warm creative
  '#3F51B5', '#00ACC1', '#8EAC8A', '#4E342E', // Cool earth
  '#F48FB1', '#FFF59D', '#A5D6A7', '#B39DDB', // Pastels
  '#00E5FF', '#D500F9', '#00E676', '#FF3D00'  // Neons
];

const DRAW_SIZES = [2, 4, 6, 10, 16];

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
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const undoStack = useCanvasStore((s) => s.undoStack);
  const redoStack = useCanvasStore((s) => s.redoStack);
  const setPlusMenuPos = useCanvasStore((s) => s.setPlusMenuPos);
  
  const textFont = useCanvasStore((s) => s.textFont);
  const setTextFont = useCanvasStore((s) => s.setTextFont);
  const textSize = useCanvasStore((s) => s.textSize);
  const setTextSize = useCanvasStore((s) => s.setTextSize);
  const selectedId = useCanvasStore((s) => s.selectedId);
  const updateObject = useCanvasStore((s) => s.updateObject);
  const objects = useCanvasStore((s) => s.objects);
  const addObject = useCanvasStore((s) => s.addObject);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);
  const setEditingId = useCanvasStore((s) => s.setEditingId);
  const selectedObject = objects.find(o => o.id === selectedId);
  const camera = useCanvasStore((s) => s.camera);
  const checkpoint = useCanvasStore((s) => s.checkpoint);
  const setCheckpoint = useCanvasStore((s) => s.setCheckpoint);

  const [showDrawOptions, setShowDrawOptions] = useState(false);
  const [showTextOptions, setShowTextOptions] = useState(false);
  const [showShapeOptions, setShowShapeOptions] = useState(false);
  const [showArrowOptions, setShowArrowOptions] = useState(false);
  const [showWorkflowMenu, setShowWorkflowMenu] = useState(false);
  const [selectedShapeDomain, setSelectedShapeDomain] = useState<'all' | 'brainstorm' | 'code' | 'love' | 'usecase' | 'story' | 'system'>('all');
  const selectedShapeType = useCanvasStore((s) => s.selectedShapeType);
  const setSelectedShapeType = useCanvasStore((s) => s.setSelectedShapeType);
  const selectedArrowPointerType = useCanvasStore((s) => s.selectedArrowPointerType);
  const setSelectedArrowPointerType = useCanvasStore((s) => s.setSelectedArrowPointerType);

  // When selectedObject changes, sync the toolbar state (but don't auto-open)
  React.useEffect(() => {
    if (selectedObject && (selectedObject.type === 'text' || selectedObject.type === 'heading' || selectedObject.type === 'card' || selectedObject.type === 'sticky')) {
      if (selectedObject.style?.fontFamily && selectedObject.style.fontFamily !== textFont) {
        setTextFont(selectedObject.style.fontFamily as string);
      }
      if (selectedObject.style?.fontSize && selectedObject.style.fontSize !== textSize) {
        setTextSize(selectedObject.style.fontSize as number);
      }
    }
  }, [selectedObject, textFont, textSize, setTextFont, setTextSize]);

  const handleFontChange = (font: string) => {
    setTextFont(font);
    if (selectedId && selectedObject) {
      updateObject(selectedId, { style: { ...selectedObject.style, fontFamily: font } });
    }
  };

  const handleSizeChange = (size: number) => {
    setTextSize(size);
    if (selectedId && selectedObject) {
      updateObject(selectedId, { style: { ...selectedObject.style, fontSize: size } });
    }
  };

  const tools: { id: InteractionMode | 'workflow'; icon: string; label: string }[] = [
    { id: 'select', icon: '↗', label: 'Select (V)' },
    { id: 'text', icon: 'Aa', label: 'Text (T)' },
    { id: 'voice' as any, icon: '🎤', label: 'Voice Typing' },
    { id: 'draw', icon: '✎', label: 'Draw (D)' },
    { id: 'workflow' as any, icon: '🔀', label: 'Workflow' },
    { id: 'pan', icon: '✋', label: 'Pan (Space)' },
    { id: 'arrow', icon: '➔', label: 'Arrow (A)' },
    { id: 'shape', icon: 'shape_mixture', label: 'Shape (S)' },
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
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
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
        {tools.map((tool) => (
          <motion.button
            key={tool.id}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              if (tool.id === 'voice' as any) {
                if (isListening) stopRecognition();
                else startRecognition();
                return;
              }
              if (tool.id === 'workflow' as any) {
                setShowWorkflowMenu(!showWorkflowMenu);
                setShowDrawOptions(false);
                setShowTextOptions(false);
                setShowShapeOptions(false);
                setShowArrowOptions(false);
                setMode('select');
                return;
              }
              setMode(tool.id as InteractionMode);
              setShowWorkflowMenu(false);
              if (tool.id === 'draw') {
                setShowDrawOptions(true);
                setShowTextOptions(false);
                setShowShapeOptions(false);
                setShowArrowOptions(false);
              } else if (tool.id === 'text') {
                setShowTextOptions(true);
                setShowDrawOptions(false);
                setShowShapeOptions(false);
                setShowArrowOptions(false);
              } else if (tool.id === 'shape') {
                setShowShapeOptions(true);
                setShowDrawOptions(false);
                setShowTextOptions(false);
                setShowArrowOptions(false);
              } else if (tool.id === 'arrow') {
                setShowArrowOptions(true);
                setShowDrawOptions(false);
                setShowTextOptions(false);
                setShowShapeOptions(false);
              } else {
                setShowDrawOptions(false);
                setShowTextOptions(false);
                setShowShapeOptions(false);
                setShowArrowOptions(false);
              }
            }}
            className={`relative w-9 h-9 rounded-lg flex items-center justify-center text-sm font-medium transition-all ${
              mode === tool.id || (tool.id === 'voice' as any && isListening) || (tool.id === 'workflow' as any && showWorkflowMenu)
                ? 'bg-[var(--accent)] text-white shadow-md'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
            }`}
            title={tool.label}
          >
            {tool.id === 'voice' as any ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="22"></line>
              </svg>
            ) : tool.id === 'shape' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="11" width="9" height="9" rx="1.5" stroke="currentColor" fill="none" strokeWidth="2" />
                <circle cx="17" cy="16" r="4.5" stroke="currentColor" fill="none" strokeWidth="2" />
                <polygon points="12,2 21,11 3,11" stroke="currentColor" fill="none" strokeWidth="2" />
              </svg>
            ) : (
              <span className="text-sm font-bold">{tool.icon}</span>
            )}
          </motion.button>
        ))}

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
            className="glass-panel absolute bottom-14 left-1/2 -translate-x-1/2 p-3 flex flex-col gap-3 min-w-[260px]"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Tool Switcher */}
            <div className="flex bg-[var(--bg-tertiary)] p-1 rounded-lg border border-[var(--border)] gap-1">
              <button
                onClick={() => {
                  setEraserMode(false);
                  setHighlighterMode(false);
                }}
                className={`flex-1 py-1.5 px-2.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  !eraserMode && !highlighterMode
                    ? 'bg-white text-[var(--accent)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span>✎</span> Pen
              </button>
              <button
                onClick={() => {
                  setHighlighterMode(true);
                  setEraserMode(false);
                }}
                className={`flex-1 py-1.5 px-2.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  highlighterMode
                    ? 'bg-white text-[var(--accent)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span>🖍</span> Highlighter
              </button>
              <button
                onClick={() => {
                  setEraserMode(true);
                  setHighlighterMode(false);
                }}
                className={`flex-1 py-1.5 px-2.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  eraserMode
                    ? 'bg-white text-[var(--accent)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span>⌫</span> Eraser
              </button>
            </div>

            {/* Colors (Pen / Highlighter only) */}
            {!eraserMode && (
              <div className="grid grid-cols-10 gap-1.5 justify-center">
                {DRAW_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => {
                      setDrawColor(color);
                    }}
                    className="w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                    style={{
                      background: color,
                      borderColor: drawColor === color ? 'var(--accent)' : 'transparent',
                      boxShadow: drawColor === color ? '0 0 0 2px var(--accent-subtle)' : 'none',
                    }}
                  />
                ))}
              </div>
            )}

            {/* Sizes */}
            <div className="flex items-center gap-2">
              {DRAW_SIZES.map((size) => (
                <button
                  key={size}
                  onClick={() => setDrawSize(size)}
                  className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all ${
                    drawSize === size
                      ? 'bg-[var(--accent-subtle)]'
                      : 'hover:bg-[var(--bg-tertiary)]'
                  }`}
                >
                  <div
                    className="rounded-full bg-current"
                    style={{
                      width: Math.max(4, size),
                      height: Math.max(4, size),
                      color: eraserMode ? 'var(--text-secondary)' : drawColor,
                      opacity: highlighterMode ? 0.35 : 1,
                    }}
                  />
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Text options panel */}
      <AnimatePresence>
        {showTextOptions && mode === 'text' && (
          <motion.div
            className="glass-panel absolute bottom-14 left-1/2 -translate-x-1/2 p-3 flex flex-col gap-3 min-w-[280px]"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Fonts */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider">Font Family</span>
              <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                {[
                  { label: 'Inter', value: "'Inter', sans-serif" },
                  { label: 'Roboto', value: "'Roboto', sans-serif" },
                  { label: 'Outfit', value: "'Outfit', sans-serif" },
                  { label: 'Lora', value: "'Lora', serif" },
                  { label: 'Merriweather', value: "'Merriweather', serif" },
                  { label: 'Playfair', value: "'Playfair Display', serif" },
                  { label: 'JetBrains', value: "'JetBrains Mono', monospace" },
                  { label: 'Fira Code', value: "'Fira Code', monospace" },
                  { label: 'Caveat', value: "'Caveat', cursive" },
                  { label: 'Pacifico', value: "'Pacifico', cursive" },
                  { label: 'Montserrat', value: "'Montserrat', sans-serif" },
                  { label: 'Oswald', value: "'Oswald', sans-serif" },
                  { label: 'Bebas Neue', value: "'Bebas Neue', sans-serif" },
                  { label: 'Anton', value: "'Anton', sans-serif" },
                  { label: 'Alfa Slab', value: "'Alfa Slab One', cursive" },
                  { label: 'Fredoka', value: "'Fredoka', sans-serif" },
                  { label: 'Comfortaa', value: "'Comfortaa', cursive" },
                  { label: 'Quicksand', value: "'Quicksand', sans-serif" },
                  { label: 'Cinzel', value: "'Cinzel', serif" },
                  { label: 'Sacramento', value: "'Sacramento', cursive" },
                  { label: 'Shadows Into', value: "'Shadows Into Light', cursive" },
                  { label: 'Gloria Hal.', value: "'Gloria Hallelujah', cursive" },
                  { label: 'Marker Felt', value: "'Permanent Marker', cursive" },
                  { label: 'Spicy Rice', value: "'Spicy Rice', cursive" },
                  { label: 'Lobster', value: "'Lobster', cursive" },
                  { label: 'Abril Fat.', value: "'Abril Fatface', serif" },
                  { label: 'Righteous', value: "'Righteous', sans-serif" },
                  { label: 'Press Start', value: "'Press Start 2P', monospace" },
                  { label: 'Creepster', value: "'Creepster', cursive" },
                  { label: 'Arch. Daughter', value: "'Architects Daughter', cursive" },
                  { label: 'Dancing Script', value: "'Dancing Script', cursive" },
                  { label: 'Amatic SC', value: "'Amatic SC', sans-serif" },
                  { label: 'Bangers', value: "'Bangers', sans-serif" },
                  { label: 'Chewy', value: "'Chewy', cursive" },
                  { label: 'Cinzel Dec.', value: "'Cinzel Decorative', serif" },
                  { label: 'Special Elite', value: "'Special Elite', monospace" },
                  { label: 'Monoton', value: "'Monoton', sans-serif" },
                  { label: 'Poiret One', value: "'Poiret One', sans-serif" },
                  
                  { label: 'Shrikhand', value: "'Shrikhand', cursive" },
                  { label: 'Ultra', value: "'Ultra', serif" },
                  { label: 'VT323', value: "'VT323', monospace" },
                  { label: 'Bungee', value: "'Bungee', sans-serif" },
                  { label: 'Fredericka', value: "'Fredericka the Great', serif" },
                  { label: 'Luckiest Guy', value: "'Luckiest Guy', cursive" },
                  { label: 'Pinyon Script', value: "'Pinyon Script', cursive" },
                  { label: 'Kelly Slab', value: "'Kelly Slab', cursive" },
                  { label: 'Kranky', value: "'Kranky', cursive" },
                  { label: 'Slackey', value: "'Slackey', cursive" },
                  { label: 'Rye', value: "'Rye', cursive" },
                  { label: 'Pirata One', value: "'Pirata One', cursive" },
                  { label: 'Uncial Antiqua', value: "'Uncial Antiqua', cursive" },
                  { label: 'Nosifer', value: "'Nosifer', cursive" },
                  { label: 'Eater', value: "'Eater', cursive" },
                  { label: 'Monofett', value: "'Monofett', monospace" },
                  { label: 'Syne Tactile', value: "'Syne Tactile', sans-serif" },
                  { label: 'Butcherman', value: "'Butcherman', cursive" },
                  { label: 'Codystar', value: "'Codystar', cursive" },
                  { label: 'Fascinate', value: "'Fascinate Inline', cursive" },
                  { label: 'Beastly', value: "'Rubik Beastly', cursive" }
                ].map((font) => (
                  <button
                    key={font.value}
                    onClick={() => handleFontChange(font.value)}
                    style={{ fontFamily: font.value }}
                    className={`text-left px-2 py-1.5 rounded-md text-xs truncate transition-all ${
                      textFont === font.value
                        ? 'bg-[var(--accent)] text-white shadow-sm'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {font.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="w-full h-px bg-[var(--border)]" />

            {/* Sizes */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider">Font Size</span>
              <div className="flex flex-wrap gap-1.5">
                {[12, 14, 16, 20, 24, 32, 48, 64].map((size) => (
                  <button
                    key={size}
                    onClick={() => handleSizeChange(size)}
                    className={`w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all ${
                      textSize === size
                        ? 'bg-[var(--accent)] text-white shadow-sm'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shape options panel */}
      <AnimatePresence>
        {(mode === 'shape' || selectedObject?.type === 'shape') && (
          <motion.div
            className="glass-panel absolute bottom-14 left-1/2 -translate-x-1/2 p-4 flex flex-col gap-3 min-w-[280px]"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider px-1">Shape Domain</span>
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
                    onClick={() => setSelectedShapeDomain(domain.id as any)}
                    className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-all ${
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
                { id: 'lightbulb', icon: '💡', label: 'Lightbulb', domain: 'brainstorm' },
                { id: 'sticky', icon: '📝', label: 'Sticky', domain: 'brainstorm' },
                { id: 'cloud', icon: '☁️', label: 'Cloud', domain: 'brainstorm' },
                { id: 'star', icon: '⭐', label: 'Star', domain: 'brainstorm' },
                { id: 'sun', icon: '☀️', label: 'Sun', domain: 'brainstorm' },
                { id: 'moon', icon: '🌙', label: 'Moon', domain: 'brainstorm' },
                { id: 'target', icon: '🎯', label: 'Target', domain: 'brainstorm' },
                { id: 'puzzle', icon: '🧩', label: 'Puzzle', domain: 'brainstorm' },
                { id: 'gear', icon: '⚙️', label: 'Gear', domain: 'brainstorm' },
                { id: 'funnel', icon: '⏳', label: 'Funnel', domain: 'brainstorm' },
                { id: 'magnet', icon: '🧲', label: 'Magnet', domain: 'brainstorm' },
                { id: 'square', icon: '⬜', label: 'Square', domain: 'brainstorm' },
                { id: 'circle', icon: '⚪', label: 'Circle', domain: 'brainstorm' },
                { id: 'triangle', icon: '▲', label: 'Triangle', domain: 'brainstorm' },
                { id: 'diamond', icon: '❖', label: 'Diamond', domain: 'brainstorm' },
                { id: 'octagon', icon: '🛑', label: 'Stop', domain: 'brainstorm' },

                // Code
                { id: 'terminal', icon: '💻', label: 'Terminal', domain: 'code' },
                { id: 'brackets', icon: '{}', label: 'Brackets', domain: 'code' },
                { id: 'api', icon: '🔌', label: 'API', domain: 'code' },
                { id: 'server', icon: '🛢️', label: 'Server', domain: 'code' },
                { id: 'cube', icon: '🧊', label: 'Cube', domain: 'code' },
                { id: 'branch', icon: '🌱', label: 'Branch', domain: 'code' },
                { id: 'terminal-prompt', icon: '🐚', label: 'Prompt', domain: 'code' },
                { id: 'cpu', icon: '🧠', label: 'CPU', domain: 'code' },
                { id: 'globe', icon: '🌐', label: 'Globe', domain: 'code' },
                { id: 'key', icon: '🔑', label: 'Key', domain: 'code' },
                { id: 'database', icon: '🗄️', label: 'Database', domain: 'code' },
                { id: 'document', icon: '📄', label: 'Doc', domain: 'code' },
                { id: 'folder', icon: '📁', label: 'Folder', domain: 'code' },
                { id: 'queue', icon: '🥞', label: 'Queue', domain: 'code' },
                { id: 'webhook', icon: '🪝', label: 'Webhook', domain: 'code' },
                { id: 'cache', icon: '🗄️', label: 'Cache', domain: 'code' },
                { id: 'event', icon: '🔔', label: 'Event', domain: 'code' },
                { id: 'pipeline', icon: '⛓️', label: 'Pipeline', domain: 'code' },
                { id: 'auth', icon: '🔒', label: 'Auth', domain: 'code' },
                { id: 'diff', icon: '⚖️', label: 'Diff', domain: 'code' },
                { id: 'hash', icon: '#', label: 'Hash', domain: 'code' },
                { id: 'branch-merge', icon: '🔱', label: 'Git Merge', domain: 'code' },
                { id: 'token', icon: '🪙', label: 'Token', domain: 'code' },

                // Love
                { id: 'heart', icon: '❤️', label: 'Heart', domain: 'love' },
                { id: 'smile', icon: '😊', label: 'Smile', domain: 'love' },
                { id: 'thumbs-up', icon: '👍', label: 'Up', domain: 'love' },
                { id: 'thumbs-down', icon: '👎', label: 'Down', domain: 'love' },
                { id: 'flower', icon: '🌸', label: 'Flower', domain: 'love' },
                { id: 'sparkles', icon: '✨', label: 'Sparkles', domain: 'love' },
                { id: 'trophy', icon: '🏆', label: 'Trophy', domain: 'love' },
                { id: 'medal', icon: '🏅', label: 'Medal', domain: 'love' },
                { id: 'gift', icon: '🎁', label: 'Gift', domain: 'love' },
                { id: 'balloon', icon: '🎈', label: 'Balloon', domain: 'love' },
                { id: 'clapping', icon: '👏', label: 'Clap', domain: 'love' },
                { id: 'coffee', icon: '☕', label: 'Coffee', domain: 'love' },
                { id: 'check-circle', icon: '✅', label: 'Check', domain: 'love' },
                { id: 'cross-circle', icon: '❌', label: 'Cross', domain: 'love' },

                // Usecase
                { id: 'speech', icon: '💬', label: 'Speech', domain: 'usecase' },
                { id: 'message', icon: '✉️', label: 'Mail', domain: 'usecase' },
                { id: 'cross', icon: '➕', label: 'Cross', domain: 'usecase' },
                { id: 'lightning', icon: '⚡', label: 'Flash', domain: 'usecase' },
                { id: 'shield', icon: '🛡️', label: 'Shield', domain: 'usecase' },
                { id: 'arrow-left', icon: '⬅️', label: 'Left', domain: 'usecase' },
                { id: 'arrow-right', icon: '➡️', label: 'Right', domain: 'usecase' },
                { id: 'arrow-up', icon: '⬆️', label: 'Up', domain: 'usecase' },
                { id: 'arrow-down', icon: '⬇️', label: 'Down', domain: 'usecase' },
                { id: 'tag', icon: '🏷️', label: 'Tag', domain: 'usecase' },
                { id: 'banner', icon: '🔖', label: 'Banner', domain: 'usecase' },
                { id: 'user', icon: '👤', label: 'User', domain: 'usecase' },
                { id: 'clock', icon: '🕒', label: 'Clock', domain: 'usecase' },
                { id: 'calendar', icon: '📅', label: 'Calendar', domain: 'usecase' },
                { id: 'card', icon: '💳', label: 'Card', domain: 'usecase' },
                { id: 'chart', icon: '📊', label: 'Chart', domain: 'usecase' },
                { id: 'cart', icon: '🛒', label: 'Cart', domain: 'usecase' },
                { id: 'play', icon: '▶️', label: 'Play', domain: 'usecase' },
                { id: 'pause', icon: '⏸️', label: 'Pause', domain: 'usecase' },
                { id: 'stop', icon: '⏹️', label: 'Stop', domain: 'usecase' },
                { id: 'infinity', icon: '∞', label: 'Infinity', domain: 'usecase' },

                // Story
                { id: 'beat', icon: '〰️', label: 'Beat', domain: 'story' },
                { id: 'scene', icon: '🎬', label: 'Scene', domain: 'story' },
                { id: 'arc', icon: '⏜', label: 'Arc', domain: 'story' },
                { id: 'twist', icon: '🔀', label: 'Twist', domain: 'story' },
                { id: 'stakes', icon: '🔺', label: 'Stakes', domain: 'story' },
                { id: 'character', icon: '🎭', label: 'Character', domain: 'story' },
                { id: 'whisper', icon: '🤫', label: 'Whisper', domain: 'story' },
                { id: 'foreshadow', icon: '🔮', label: 'Foreshadow', domain: 'story' },
                { id: 'world', icon: '🌍', label: 'World', domain: 'story' },
                { id: 'voice', icon: '🗣️', label: 'Voice', domain: 'story' },

                // System
                { id: 'feedback', icon: '🔄', label: 'Feedback', domain: 'system' },
                { id: 'bottleneck', icon: '⏳', label: 'Bottleneck', domain: 'system' },
                { id: 'cascade', icon: '📉', label: 'Cascade', domain: 'system' },
                { id: 'threshold', icon: '🎚️', label: 'Threshold', domain: 'system' },
                { id: 'trade-off', icon: '⚖️', label: 'Trade-off', domain: 'system' },
                { id: 'pareto', icon: '📊', label: 'Pareto', domain: 'system' },
                { id: 'pivot', icon: '🗼', label: 'Pivot', domain: 'system' },
                { id: 'lever', icon: '⚖️', label: 'Lever', domain: 'system' },
                { id: 'compound', icon: '📈', label: 'Compound', domain: 'system' },
                { id: 'risk', icon: '⚠️', label: 'Risk', domain: 'system' }
              ].filter((sOption) => selectedShapeDomain === 'all' || sOption.domain === selectedShapeDomain)
               .map((sOption) => (
                <button
                  key={sOption.id}
                  onClick={() => {
                    setSelectedShapeType(sOption.id as any);
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
                  <span className="text-xl mb-1">{sOption.icon}</span>
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

      {/* Arrow options panel */}
      <AnimatePresence>
        {(mode === 'arrow' || selectedObject?.type === 'arrow') && (
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
                { id: 'line', icon: '⎯', label: 'Line' },
                { id: 'arrow', icon: '➔', label: 'Arrow' },
                { id: 'dot', icon: '●', label: 'Dot' },
                { id: 'diamond', icon: '◆', label: 'Diamond' }
              ].map((aOption) => (
                <button
                  key={aOption.id}
                  onClick={() => {
                    setSelectedArrowPointerType(aOption.id as any);
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
                  <span className="text-lg mb-0.5">{aOption.icon}</span>
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
    </div>
  );
}
