'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { v4 as uuidv4 } from 'uuid';
import { screenToCanvas, randomStickyColor } from '@/lib/utils';

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
  const objects = useCanvasStore((s) => s.objects);
  const setObjects = useCanvasStore((s) => s.setObjects);
  const camera = useCanvasStore((s) => s.camera);

  if (!plusMenuPos) return null;

  // Determine where to spawn the object. If from toolbar, spawn in center.
  const canvasPos = plusMenuPos.isToolbar
    ? {
        x: (-camera.x + window.innerWidth / 2) / camera.zoom,
        y: (-camera.y + window.innerHeight / 2) / camera.zoom - 100, // Slightly above center
      }
    : screenToCanvas(plusMenuPos.x, plusMenuPos.y, camera);

  const items = [
    {
      icon: (<MenuIcon><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></MenuIcon>),
      label: 'Image',
      action: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              addObject({
                type: 'image',
                x: canvasPos.x,
                y: canvasPos.y,
                width: 300,
                height: 200,
                content: ev.target?.result as string,
              });
            };
            reader.readAsDataURL(file);
          }
        };
        input.click();
      },
    },
    {
      icon: (<MenuIcon><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z" /><path d="M15 3v6h6" /></MenuIcon>),
      label: 'Sticky Note',
      action: () => {
        addObject({
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
        addObject({
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
      icon: (<MenuIcon><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></MenuIcon>),
      label: 'Voice Note',
      action: () => {
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 320,
          height: 80,
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
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 260,
          height: 155,
          content: '',
          style: {
            isLiveMetric: true,
            metricTitle: 'Onboarding completion rate',
            metricValue: '71.3%',
            metricTrend: '+3.2% this week',
            metricChartData: [60, 62, 61, 65, 68, 70, 71.3]
          }
        });
      }
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
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        </svg>
      ),
      label: 'AI Canvas Agent',
      action: () => {
        addObject({
          type: 'card',
          x: canvasPos.x,
          y: canvasPos.y,
          width: 380,
          height: 480,
          content: '',
          style: {
            isAgent: true,
            agentPrompt: '',
            agentLogs: ['[Ready] Agent waiting for task...'],
            agentStatus: 'idle',
            apiKeyIndex: 0
          }
        });
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
        <div className="glass-panel py-2 min-w-[180px]">
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

      {/* Backdrop */}
      <div
        key="plus-menu-backdrop"
        className="fixed inset-0 z-[149]"
        onClick={() => setPlusMenuPos(null)}
      />
    </AnimatePresence>
  );
}
