'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { v4 as uuidv4 } from 'uuid';
import { screenToCanvas, randomStickyColor } from '@/lib/utils';

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
      icon: '🖼',
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
      icon: '📝',
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
      icon: '🔗',
      label: 'Connectors',
      action: () => {
        useCanvasStore.getState().setMode('connector');
      },
    },
    {
      icon: '▭',
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
      icon: '🎤',
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
      icon: '✓',
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
      icon: '</>',
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
      icon: '“',
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
      icon: '⏳',
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
      icon: '📊',
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
      icon: '📈',
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
      icon: '📁',
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
