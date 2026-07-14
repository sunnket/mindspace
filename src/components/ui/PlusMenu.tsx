'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { v4 as uuidv4 } from 'uuid';
import { screenToCanvas, randomStickyColor } from '@/lib/utils';
import { ingestFile } from '@/lib/fileIngest';
import { newTimeline } from '@/lib/timeline';

// One consistent outline icon family for the insert menu
function MenuIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export default function PlusMenu() {
  const plusMenuPos = useCanvasStore((s) => s.plusMenuPos);
  const setPlusMenuPos = useCanvasStore((s) => s.setPlusMenuPos);
  const addObject = useCanvasStore((s) => s.addObject);
  const camera = useCanvasStore((s) => s.camera);

  /* Dismiss on an outside click.
     This used to be a full-screen backdrop <div>, which also swallowed every
     wheel event on its way to the canvas — so with the menu open the board was
     frozen: you couldn't scroll or zoom to find the spot you wanted to insert
     into. A listener costs nothing and leaves the canvas fully live underneath.
     The toolbar's + button is excluded so its own click can toggle the menu
     shut instead of this closing it and the click immediately reopening it. */
  useEffect(() => {
    if (!plusMenuPos) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('.plus-menu') || el?.closest?.('[data-plus-button]')) return;
      setPlusMenuPos(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [plusMenuPos, setPlusMenuPos]);

  if (!plusMenuPos) return null;

  // Determine where to spawn the object. If from toolbar, spawn in center.
  const canvasPos = plusMenuPos.isToolbar
    ? {
        x: (-camera.x + window.innerWidth / 2) / camera.zoom,
        y: (-camera.y + window.innerHeight / 2) / camera.zoom - 100, // Slightly above center
      }
    : screenToCanvas(plusMenuPos.x, plusMenuPos.y, camera);

  /** Drop the block in and put the caret in it — you came here to write. */
  const spawnEditable = (partial: Parameters<typeof addObject>[0]) => {
    const block = addObject(partial);
    useCanvasStore.getState().setSelectedId(block.id);
    useCanvasStore.getState().setEditingId(block.id);
  };

  const items = [
    {
      // "Image" is gone from this menu: Drop a File already takes an image and
      // gives it the same rich image block, plus everything else. Two entries for
      // one job is just a fork in the road with no destination.
      icon: (<MenuIcon><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" /><path d="M9 13h6" /><path d="M9 17h4" /></MenuIcon>),
      label: 'Drop a File',
      action: () => {
        // Any file type — image, pdf, doc, docx, pptx, xlsx, zip, code… The agent reads it.
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = (e) => {
          const files = Array.from((e.target as HTMLInputElement).files || []);
          files.forEach((file, i) => {
            ingestFile(file, canvasPos.x + (i % 3) * 330, canvasPos.y + Math.floor(i / 3) * 170);
          });
        };
        input.click();
      },
    },
    {
      icon: (<MenuIcon><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4.5" cy="6" r="1.4" fill="currentColor" /><circle cx="4.5" cy="12" r="1.4" fill="currentColor" /><circle cx="4.5" cy="18" r="1.4" fill="currentColor" /></MenuIcon>),
      label: 'Bullet List',
      action: () => {
        // Seed the first bullet and drop straight into editing — Enter then
        // carries the bullet onto each new line (see the list-continuation
        // handler in CanvasObject).
        spawnEditable({
          type: 'text',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 420,
          height: 44,
          content: '- ',
        });
      },
    },
    {
      icon: (<MenuIcon><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="6" y1="17" x2="12" y2="17" /></MenuIcon>),
      label: 'Timeline',
      action: () => {
        addObject(newTimeline(canvasPos.x, canvasPos.y));
      },
    },
    {
      icon: (<MenuIcon><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z" /><path d="M15 3v6h6" /></MenuIcon>),
      label: 'Sticky Note',
      action: () => {
        spawnEditable({
          type: 'sticky',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 200,
          height: 160,
          content: '',
          style: { color: randomStickyColor() },
        });
      },
    },
    {
      icon: (<MenuIcon><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></MenuIcon>),
      label: 'Connectors',
      action: () => {
        useCanvasStore.getState().setMode('connector');
      },
    },
    {
      icon: (<MenuIcon><rect x="3" y="5" width="18" height="14" rx="2" /><line x1="7" y1="10" x2="17" y2="10" /><line x1="7" y1="14" x2="13" y2="14" /></MenuIcon>),
      label: 'Card',
      action: () => {
        spawnEditable({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 300,
          height: 200,
          content: '',
        });
      },
    },
    {
      icon: (<MenuIcon><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></MenuIcon>),
      label: 'Map',
      action: () => {
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 360,
          height: 340,
          content: '',
          style: { isMap: true },
        });
      },
    },
    {
      icon: (<MenuIcon><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></MenuIcon>),
      label: 'Mermaid Diagram',
      action: () => {
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 500,
          height: 400,
          content: 'graph TD;\n    A[Start] --> B{Is it powerful?};\n    B -- Yes --> C[Awesome!];\n    B -- No --> D[Make it goated];',
          style: { isMermaid: true },
        });
      },
    },
    {
      icon: (<MenuIcon><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></MenuIcon>),
      label: 'Voice Note',
      action: () => {
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 340,
          height: 150,
          content: '',
          style: { isVoiceNote: true },
        });
      },
    },
    {
      icon: (<MenuIcon><rect x="3" y="3" width="18" height="18" rx="4" /><polyline points="8 12 11 15 16 9" /></MenuIcon>),
      label: 'To-Do List',
      action: () => {
        const initialItems = [
          { id: uuidv4(), text: 'Rebuild messenger: premium font', done: true },
          { id: uuidv4(), text: 'Create premium doodle pattern', done: false },
          { id: uuidv4(), text: 'Verify and deliver', done: false },
        ];
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 320,
          height: 380,
          content: JSON.stringify(initialItems),
          style: { isTodo: true, todoTitle: 'todos' },
        });
      },
    },
    {
      icon: (<MenuIcon><polyline points="8 7 3 12 8 17" /><polyline points="16 7 21 12 16 17" /></MenuIcon>),
      label: 'Code Block',
      action: () => {
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 500,
          height: 300,
          content: '// Code block placeholder\nfunction hello() {\n  console.log("Hello, World!");\n}',
          style: { isCode: true },
        });
      },
    },
    {
      icon: (<MenuIcon><path d="M10 8c-2.2 0-4 1.8-4 4v4h4v-4H8c0-1.1.9-2 2-2V8z" fill="currentColor" stroke="none" /><path d="M18 8c-2.2 0-4 1.8-4 4v4h4v-4h-2c0-1.1.9-2 2-2V8z" fill="currentColor" stroke="none" /></MenuIcon>),
      label: 'Quote',
      action: () => {
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 400,
          height: 180,
          content: '',
          style: { isQuote: true },
        });
      },
    },
    {
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon>
          <line x1="8" y1="2" x2="8" y2="18"></line>
          <line x1="16" y1="6" x2="16" y2="22"></line>
        </svg>
      ),
      label: 'Checkpoint',
      action: () => {
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 220,
          height: 44,
          content: 'Checkpoint',
          style: { isCheckpoint: true },
        });
      },
    },
    {
      icon: (<MenuIcon><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></MenuIcon>),
      label: 'Countdown',
      action: () => {
        const target = new Date();
        target.setDate(target.getDate() + 15);
        target.setHours(9, 0, 0, 0);
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 250,
          height: 250,
          content: '',
          style: {
            isCountdown: true,
            countdownTitle: 'Launch day',
            countdownDate: target.toISOString()
          }
        });
      }
    },
    {
      icon: (<MenuIcon><line x1="6" y1="20" x2="6" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="18" y1="20" x2="18" y2="14" /></MenuIcon>),
      label: 'Interactive Poll',
      action: () => {
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 280,
          height: 260,
          content: '',
          style: {
            isPoll: true,
            pollQuestion: 'Which onboarding approach?',
            pollOptions: [
              { id: '1', text: 'Progressive', votes: 2 },
              { id: '2', text: 'Single page', votes: 1 },
              { id: '3', text: 'Gamified', votes: 1 }
            ]
          }
        });
      }
    },
    {
      icon: (<MenuIcon><polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" /></MenuIcon>),
      label: 'Live Metric',
      action: () => {
        // Data-entry first: the block asks for your numbers before it renders.
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 260,
          height: 180,
          content: '',
          style: { isLiveMetric: true, metricSetup: true }
        });
      }
    },
    {
      icon: (<MenuIcon><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="8" y1="17" x2="8" y2="12" /><line x1="12" y1="17" x2="12" y2="7" /><line x1="16" y1="17" x2="16" y2="14" /></MenuIcon>),
      label: 'Chart',
      action: () => {
        // Starts on the chart-type picker → then asks for your data → then renders.
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 300,
          height: 280,
          content: '',
          style: { isChart: true },
        });
      },
    },
    {
      icon: (<MenuIcon><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></MenuIcon>),
      label: 'Dashboard',
      action: () => {
        const ox = canvasPos.x;
        const oy = canvasPos.y;
        // A titled dashboard: a backdrop frame + heading + a number, a live metric,
        // a bar chart and a donut chart — each asks for real data before rendering.
        addObject({
          type: 'frame', x: ox - 24, y: oy - 24, width: 812, height: 596, content: 'Dashboard',
          zIndex: 0, style: { frameColor: '#C97B4B' },
        });
        addObject({ type: 'heading', x: ox, y: oy, width: 500, height: 60, content: 'Dashboard' });
        addObject({
          type: 'card', x: ox, y: oy + 78, width: 240, height: 150, content: '',
          style: { isChart: true, chartType: 'number', chartTitle: 'Headline number', chartReady: false },
        });
        addObject({
          type: 'card', x: ox + 268, y: oy + 78, width: 260, height: 180, content: '',
          style: { isLiveMetric: true, metricSetup: true },
        });
        addObject({
          type: 'card', x: ox, y: oy + 268, width: 360, height: 280, content: '',
          style: { isChart: true, chartType: 'bar', chartTitle: 'By category', chartReady: false },
        });
        addObject({
          type: 'card', x: ox + 400, y: oy + 268, width: 360, height: 280, content: '',
          style: { isChart: true, chartType: 'donut', chartTitle: 'Breakdown', chartReady: false },
        });
      },
    },
    {
      icon: (<MenuIcon><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></MenuIcon>),
      label: 'Focus Timer',
      action: () => {
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 250,
          height: 190,
          content: '',
          style: {
            isTimer: true,
            timerLabel: '',
          }
        });
      }
    },
    {
      icon: (<MenuIcon><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></MenuIcon>),
      label: 'Decision Spinner',
      action: () => {
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 300,
          height: 240,
          content: '',
          style: {
            isDecision: true,
            decisionTitle: '',
            decisionOptions: ['Pizza', 'Sushi', 'Tacos'],
          }
        });
      }
    },
    {
      icon: (<MenuIcon><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /></MenuIcon>),
      label: 'Progress Goal',
      action: () => {
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 280,
          height: 190,
          content: '',
          style: {
            isProgress: true,
            progressLabel: '',
            progressValue: 30,
          }
        });
      }
    },
    {
      icon: (<MenuIcon><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="14" x2="21" y2="14" /><line x1="10" y1="9" x2="10" y2="20" /></MenuIcon>),
      label: 'Quick Data Table',
      action: () => {
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 250,
          height: 210,
          content: '',
          style: {
            isQuickData: true,
            quickDataRows: [
              { key: 'Status', value: 'In progress' },
              { key: 'Owner', value: 'Priya D.' },
              { key: 'Due', value: 'June 14' },
              { key: 'Priority', value: 'High' },
              { key: 'Sprint', value: 'Sprint 7' },
              { key: 'Points', value: '8' }
            ]
          }
        });
      }
    },
    {
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      ),
      label: 'Whiteboard',
      action: () => {
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 400,
          height: 320,
          content: 'untitled whiteboard',
          style: {
            isWhiteboard: true,
            whiteboardBg: '#ffffff',
            whiteboardStrokes: [],
          }
        });
      }
    },
    {
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        </svg>
      ),
      label: 'AI Agent',
      action: () => {
        // Inline agent prompt: a seeded text block — type the task, Enter runs it
        const block = addObject({
          type: 'text',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 460,
          height: 44,
          content: '/agent ',
        });
        useCanvasStore.getState().setEditingId(block.id);
      }
    },
  ];

  return (
    <AnimatePresence>
      <motion.div
        key="plus-menu-content"
        className="plus-menu"
        style={{
          left: plusMenuPos.isToolbar ? plusMenuPos.x : plusMenuPos.x,
          top: plusMenuPos.isToolbar ? undefined : plusMenuPos.y,
          bottom: plusMenuPos.isToolbar ? window.innerHeight - plusMenuPos.y + 10 : undefined,
        }}
        initial={{ opacity: 0, scale: 0.9, y: plusMenuPos.isToolbar ? 5 : -5 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: plusMenuPos.isToolbar ? 5 : -5 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="glass-panel py-2 min-w-[180px] max-h-[70vh] overflow-y-auto overscroll-contain">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                item.action();
                setPlusMenuPos(null);
              }}
              className="w-full px-4 py-2.5 flex items-center gap-3 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <span className="w-5 text-center text-xs">{item.icon}</span>
              <span className="font-light">{item.label}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
