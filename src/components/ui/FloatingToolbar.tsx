'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useCanvasStore, InteractionMode } from '@/store/canvasStore';
import { useAgentChatStore } from '@/store/agentChatStore';
import { useVoiceStore } from '@/store/voiceStore';
import { useSpeechRecognition, warmVoiceEngine } from '@/hooks/useSpeechRecognition';

/**
 * The toolbar: which tool you're holding, and nothing else.
 *
 * It used to carry a thousand lines of flyout with it — the brush panel, the
 * shape catalogue, frame kinds, the corkboard palette, the workflow library —
 * all of them unfolding upward over the canvas from a bar pinned to the bottom
 * of it. Every one of those now lives in the properties rail on the right,
 * which follows the current mode, so this file is back to being what its name
 * says: a row of tools.
 *
 * The buttons toggle the TOOL now rather than a panel. Clicking the tool you're
 * already holding puts it down (back to select) instead of hiding its options
 * while leaving you holding it — which is what "click draw again" used to do,
 * and why people kept drawing by accident.
 */

export default function FloatingToolbar() {
  const mode = useCanvasStore((s) => s.mode);
  const setMode = useCanvasStore((s) => s.setMode);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const undoStack = useCanvasStore((s) => s.undoStack);
  const redoStack = useCanvasStore((s) => s.redoStack);
  const setPlusMenuPos = useCanvasStore((s) => s.setPlusMenuPos);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);
  const setCommentMode = useCanvasStore((s) => s.setCommentMode);
  const setThreadsSidebarOpen = useCanvasStore((s) => s.setThreadsSidebarOpen);
  const workflowOpen = useCanvasStore((s) => s.workflowOpen);
  const setWorkflowOpen = useCanvasStore((s) => s.setWorkflowOpen);

  /* The AI agent chat owns this slot. Human-to-human DMs used to be here, but
     the agent is the thing you reach for constantly while working a board — a
     conversation with a teammate is an occasional errand, so it moved into the
     insert (+) menu and the slash menu where the other occasional things live. */
  const agentChatOpen = useAgentChatStore((s) => s.panelOpen);
  const toggleAgentChat = useAgentChatStore((s) => s.toggle);
  const agentStreaming = useAgentChatStore((s) => s.streaming);

  /* Selector, not the whole store: dictation updates level, pending and hearing
     constantly, and subscribing to all of it re-rendered the entire toolbar
     several times a second for a button that only cares whether the mic is on. */
  const isListening = useVoiceStore((s) => s.isListening);
  const { startRecognition, stopRecognition } = useSpeechRecognition();

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
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5" cy="6" r="2.2" fill="currentColor" />
          <circle cx="19" cy="17" r="2.2" fill="currentColor" />
          <path d="M5 6c5.5 1.5 2.5 10.5 14 11" strokeWidth="2" />
          <path d="M18 4.5v4.5a1.8 1.8 0 0 1-3.6 0v-3" opacity="0.65" />
        </svg>
      ),
    },
  ];

  return (
    <div className="floating-toolbar">
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
            setWorkflowOpen(false);
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
          const active = mode === tool.id || (tool.id === 'voice' as unknown as InteractionMode && isListening) || (tool.id === 'workflow' as unknown as InteractionMode && workflowOpen);
          return (
            <motion.button
              key={tool.id}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              /* The moment the pointer lands on the mic, start fetching the
                 on-device model. A cold start is a download, a runtime boot and
                 a first inference; the half-second of travel between deciding
                 to dictate and clicking is free time to spend on it. */
              onPointerEnter={
                tool.id === 'voice' as unknown as InteractionMode ? () => warmVoiceEngine() : undefined
              }
              onClick={() => {
                setCommentMode(false);
                setThreadsSidebarOpen(false);

                if (tool.id === 'voice' as unknown as InteractionMode) {
                  setWorkflowOpen(false);
                  if (isListening) stopRecognition();
                  else startRecognition();
                  return;
                }

                if (tool.id === 'workflow' as unknown as InteractionMode) {
                  // Workflows aren't a canvas mode — you stay in select while
                  // you browse them, so this is a straight toggle.
                  const wasOpen = useCanvasStore.getState().workflowOpen;
                  setWorkflowOpen(!wasOpen);
                  if (!wasOpen) setMode('select');
                  return;
                }

                /* Picking a tool no longer opens anything here: its options are
                   already docked in the rail, which follows `mode`. Clicking the
                   tool you're in drops back to select, so the button is still a
                   toggle — it just toggles the TOOL now, not a flyout. */
                setWorkflowOpen(false);
                setMode(mode === (tool.id as InteractionMode) ? 'select' : (tool.id as InteractionMode));
                if (tool.id === 'arrow') setSelectedId(null);
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

        {/* Plugins used to live here, and Canvas background, Stress Reliefer
            and Flow Mode used to sit here too. They all moved to the ▾ menu
            beside the canvas name, alongside Scenes, Share, Skill Set and
            Collaborate — board-level things belong with the board's name, not
            in the drawing toolbar. */}

        {/* AI Agent chat — opens the resizable panel on the right. This is the
            slot the DM chat used to hold; the agent earns it because it's the
            one conversation you have constantly while building a board. */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            setWorkflowOpen(false);
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
    </div>
  );
}
