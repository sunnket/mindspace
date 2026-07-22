'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { v4 as uuidv4 } from 'uuid';
import { screenToCanvas, randomStickyColor } from '@/lib/utils';
import { ingestFile } from '@/lib/fileIngest';
import { createRepoBlock, ingestFolderPickerIntoBlock } from '@/lib/repoIngest';
import { newTimeline } from '@/lib/timeline';
import { pendingCameraStart } from '@/components/canvas/MirrorBlock';

// NOTE ON SPACING: the app's global `* { margin:0; padding:0 }` reset is
// unlayered, so Tailwind's padding/margin utilities are dead here. Every
// padding in this file is an inline style on purpose — do not "clean them up"
// into classes. gap-* still works (the reset doesn't touch gap).

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

type Item = {
  icon: React.ReactNode;
  label: string;
  desc: string;
  keywords?: string;
  action: () => void;
};

type Section = {
  title: string;
  tint: string;
  items: Item[];
};

const PANEL_W = 460;

export default function PlusMenu() {
  const plusMenuPos = useCanvasStore((s) => s.plusMenuPos);
  const setPlusMenuPos = useCanvasStore((s) => s.setPlusMenuPos);
  const addObject = useCanvasStore((s) => s.addObject);
  const camera = useCanvasStore((s) => s.camera);

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  // Fresh open → clear the search and put the caret in it: you can type a
  // block's name straight away and hit Enter, command-palette style.
  useEffect(() => {
    if (plusMenuPos) {
      setQuery('');
      setActiveIdx(0);
      // after the entry animation has mounted the input
      const t = setTimeout(() => searchRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [plusMenuPos]);

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

  const sections: Section[] = [
    {
      title: 'Essentials',
      tint: '#C97B4B',
      items: [
        {
          icon: (<MenuIcon><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" /><path d="M9 13h6" /><path d="M9 17h4" /></MenuIcon>),
          label: 'Drop a File',
          desc: 'Any file — the agent reads it',
          keywords: 'image pdf doc upload attach',
          action: () => {
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
          icon: (<MenuIcon><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z" /><path d="M15 3v6h6" /></MenuIcon>),
          label: 'Sticky Note',
          desc: 'A classic square of paper',
          keywords: 'post-it note paper',
          action: () => {
            spawnEditable({
              type: 'sticky',
              x: canvasPos.x, y: canvasPos.y, width: 200, height: 160,
              content: '',
              style: { color: randomStickyColor() },
            });
          },
        },
        {
          icon: (<MenuIcon><rect x="3" y="5" width="18" height="14" rx="2" /><line x1="7" y1="10" x2="17" y2="10" /><line x1="7" y1="14" x2="13" y2="14" /></MenuIcon>),
          label: 'Card',
          desc: 'A framed panel for longer notes',
          keywords: 'panel box note',
          action: () => {
            spawnEditable({ type: 'card', x: canvasPos.x, y: canvasPos.y, width: 300, height: 200, content: '' });
          },
        },
        {
          icon: (<MenuIcon><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></MenuIcon>),
          label: 'Connectors',
          desc: 'Draw arrows between blocks',
          keywords: 'arrow line link edge',
          action: () => { useCanvasStore.getState().setMode('connector'); },
        },
        {
          icon: (<MenuIcon><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></MenuIcon>),
          label: 'AI Agent',
          desc: 'Type a task, Enter runs it',
          keywords: 'assistant prompt build generate',
          action: () => {
            const block = addObject({
              type: 'text',
              x: canvasPos.x, y: canvasPos.y, width: 460, height: 44,
              content: '/agent ',
            });
            useCanvasStore.getState().setEditingId(block.id);
          },
        },
      ],
    },
    {
      title: 'Write',
      tint: '#3E63DD',
      items: [
        {
          icon: (<MenuIcon><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4.5" cy="6" r="1.4" fill="currentColor" /><circle cx="4.5" cy="12" r="1.4" fill="currentColor" /><circle cx="4.5" cy="18" r="1.4" fill="currentColor" /></MenuIcon>),
          label: 'Bullet List',
          desc: 'Bullets that continue as you type',
          keywords: 'list points',
          action: () => {
            spawnEditable({ type: 'text', x: canvasPos.x, y: canvasPos.y, width: 420, height: 44, content: '- ' });
          },
        },
        {
          icon: (<MenuIcon><polyline points="9 18 15 12 9 6" /><line x1="14" y1="7" x2="20" y2="7" /><line x1="14" y1="17" x2="20" y2="17" /></MenuIcon>),
          label: 'Toggle List',
          desc: 'A heading that hides its details',
          keywords: 'collapse expand accordion',
          action: () => {
            spawnEditable({
              type: 'text', x: canvasPos.x, y: canvasPos.y, width: 460, height: 60,
              content: '▸ Toggle heading\n  Hidden details — click the arrow to collapse',
            });
          },
        },
        {
          icon: (<MenuIcon><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="8" x2="12" y2="8.01" /></MenuIcon>),
          label: 'Callout',
          desc: 'Note, warning, idea or question',
          keywords: 'alert info attention',
          action: () => {
            spawnEditable({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 340, height: 132,
              content: '',
              style: { isCallout: true, calloutKind: 'note' },
            });
          },
        },
        {
          icon: (<MenuIcon><path d="M10 8c-2.2 0-4 1.8-4 4v4h4v-4H8c0-1.1.9-2 2-2V8z" fill="currentColor" stroke="none" /><path d="M18 8c-2.2 0-4 1.8-4 4v4h4v-4h-2c0-1.1.9-2 2-2V8z" fill="currentColor" stroke="none" /></MenuIcon>),
          label: 'Quote',
          desc: 'Set a line apart, with attribution',
          keywords: 'blockquote citation',
          action: () => {
            addObject({ type: 'card', x: canvasPos.x, y: canvasPos.y, width: 400, height: 180, content: '', style: { isQuote: true } });
          },
        },
        {
          icon: (<MenuIcon><line x1="4" y1="12" x2="20" y2="12" /><circle cx="4.5" cy="12" r="0.6" fill="currentColor" /><circle cx="19.5" cy="12" r="0.6" fill="currentColor" /></MenuIcon>),
          label: 'Divider',
          desc: 'A rule to section your thoughts',
          keywords: 'separator hr line',
          action: () => {
            addObject({ type: 'text', x: canvasPos.x, y: canvasPos.y, width: 460, height: 24, content: '---' });
          },
        },
        {
          icon: (<MenuIcon><path d="M9.9 4.24A9 9 0 0 1 12 4c7 0 10 8 10 8a13 13 0 0 1-1.67 2.68" /><path d="M6.6 6.6A13 13 0 0 0 2 12s3 8 10 8a9 9 0 0 0 5.4-1.6" /><line x1="2" y1="2" x2="22" y2="22" /></MenuIcon>),
          label: 'Spoiler',
          desc: 'Hidden until clicked',
          keywords: 'secret hide reveal',
          action: () => {
            spawnEditable({ type: 'text', x: canvasPos.x, y: canvasPos.y, width: 420, height: 44, content: '||hidden — click to reveal||' });
          },
        },
        {
          icon: (<MenuIcon><rect x="3" y="4" width="18" height="16" rx="2" /><polyline points="9 9 7 12 9 15" /><polyline points="15 9 17 12 15 15" /></MenuIcon>),
          label: 'Code Snippet',
          desc: 'Inline monospace formatting',
          keywords: 'monospace pre snippet',
          action: () => {
            spawnEditable({
              type: 'text', x: canvasPos.x, y: canvasPos.y, width: 460, height: 96,
              content: '```\nconst greeting = "hello";\nconsole.log(greeting);\n```',
            });
          },
        },
      ],
    },
    {
      title: 'Plan & Track',
      tint: '#2F9E6E',
      items: [
        {
          icon: (<MenuIcon><rect x="3" y="3" width="18" height="18" rx="4" /><polyline points="8 12 11 15 16 9" /></MenuIcon>),
          label: 'To-Do List',
          desc: 'Checklist with live progress',
          keywords: 'task check todo',
          action: () => {
            const initialItems = [{ id: uuidv4(), text: '', done: false }];
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 320, height: 340,
              content: JSON.stringify(initialItems),
              style: { isTodo: true, todoTitle: 'todos' },
            });
          },
        },
        {
          icon: (<MenuIcon><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="6" y1="17" x2="12" y2="17" /></MenuIcon>),
          label: 'Timeline',
          desc: 'Draggable roadmap with today line',
          keywords: 'gantt roadmap schedule',
          action: () => { addObject(newTimeline(canvasPos.x, canvasPos.y)); },
        },
        {
          icon: (<MenuIcon><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /></MenuIcon>),
          label: 'Progress Goal',
          desc: 'Track toward a target',
          keywords: 'goal percent tracker',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 280, height: 210,
              content: '',
              style: { isProgress: true, progressLabel: '', progressValue: 30 },
            });
          },
        },
        {
          icon: (<MenuIcon><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></MenuIcon>),
          label: 'Focus Timer',
          desc: 'Pomodoro with breaks',
          keywords: 'pomodoro stopwatch work session',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 260, height: 280,
              content: '',
              style: { isTimer: true, timerLabel: '' },
            });
          },
        },
        {
          icon: (<MenuIcon><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></MenuIcon>),
          label: 'Countdown',
          desc: 'Ticking clock to a date',
          keywords: 'deadline launch date',
          action: () => {
            const target = new Date();
            target.setDate(target.getDate() + 15);
            target.setHours(9, 0, 0, 0);
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 250, height: 250,
              content: '',
              style: { isCountdown: true, countdownTitle: 'Launch day', countdownDate: target.toISOString() },
            });
          },
        },
        {
          icon: (<MenuIcon><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></MenuIcon>),
          label: 'Checkpoint',
          desc: 'A named point to jump back to',
          keywords: 'bookmark flag marker',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 220, height: 44,
              content: 'Checkpoint',
              style: { isCheckpoint: true },
            });
          },
        },
      ],
    },
    {
      title: 'Data & Insight',
      tint: '#8B5FBF',
      items: [
        {
          icon: (<MenuIcon><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="14" x2="21" y2="14" /><line x1="9" y1="4" x2="9" y2="20" /><line x1="15" y1="4" x2="15" y2="20" /></MenuIcon>),
          label: 'Table',
          desc: 'Real rows and columns',
          keywords: 'spreadsheet grid cells csv',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 480, height: 280,
              content: '',
              style: {
                isTable: true,
                tableCols: ['Item', 'Owner', 'Status'],
                tableRows: [['', '', ''], ['', '', ''], ['', '', '']],
              },
            });
          },
        },
        {
          icon: (<MenuIcon><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="8" y1="17" x2="8" y2="12" /><line x1="12" y1="17" x2="12" y2="7" /><line x1="16" y1="17" x2="16" y2="14" /></MenuIcon>),
          label: 'Chart',
          desc: 'Bar, line, area, donut & more',
          keywords: 'graph viz bar pie line area',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 320, height: 300,
              content: '',
              style: { isChart: true },
            });
          },
        },
        {
          icon: (<MenuIcon><polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" /></MenuIcon>),
          label: 'Live Metric',
          desc: 'Headline number + sparkline',
          keywords: 'kpi stat number',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 260, height: 180,
              content: '',
              style: { isLiveMetric: true, metricSetup: true },
            });
          },
        },
        {
          icon: (<MenuIcon><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="14" x2="21" y2="14" /><line x1="10" y1="9" x2="10" y2="20" /></MenuIcon>),
          label: 'Quick Data',
          desc: 'Key → value properties',
          keywords: 'properties fields metadata',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 250, height: 210,
              content: '',
              style: {
                isQuickData: true,
                quickDataRows: [
                  { key: 'Status', value: 'In progress' },
                  { key: 'Owner', value: 'Priya D.' },
                  { key: 'Due', value: 'June 14' },
                  { key: 'Priority', value: 'High' },
                ],
              },
            });
          },
        },
        {
          icon: (<MenuIcon><line x1="6" y1="20" x2="6" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="18" y1="20" x2="18" y2="14" /></MenuIcon>),
          label: 'Interactive Poll',
          desc: 'Ask, vote, see results',
          keywords: 'vote survey question',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 280, height: 260,
              content: '',
              style: {
                isPoll: true,
                pollQuestion: 'Which onboarding approach?',
                pollOptions: [
                  { id: '1', text: 'Progressive', votes: 2 },
                  { id: '2', text: 'Single page', votes: 1 },
                  { id: '3', text: 'Gamified', votes: 1 },
                ],
              },
            });
          },
        },
        {
          icon: (<MenuIcon><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></MenuIcon>),
          label: 'Dashboard',
          desc: 'A framed set of charts',
          keywords: 'kpi board metrics overview',
          action: () => {
            const ox = canvasPos.x;
            const oy = canvasPos.y;
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
          icon: (<MenuIcon><circle cx="12" cy="12" r="9" /><path d="M12 3v9l6.5 3.5" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /></MenuIcon>),
          label: 'Decision Spinner',
          desc: 'Spin a wheel, let fate pick',
          keywords: 'random wheel choose picker',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 300, height: 360,
              content: '',
              style: { isDecision: true, decisionTitle: '', decisionOptions: ['Pizza', 'Sushi', 'Tacos'] },
            });
          },
        },
      ],
    },
    {
      title: 'Media & Tools',
      tint: '#C9904B',
      items: [
        {
          icon: (<MenuIcon><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></MenuIcon>),
          label: 'Map',
          desc: 'Search any place on Earth',
          keywords: 'location pin place osm',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 360, height: 340,
              content: '',
              style: { isMap: true },
            });
          },
        },
        {
          icon: (<MenuIcon><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></MenuIcon>),
          label: 'Mermaid Diagram',
          desc: 'Flowcharts from text, with templates',
          keywords: 'diagram flowchart sequence graph',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 520, height: 420,
              content: 'graph TD;\n    A[Start] --> B{Is it powerful?};\n    B -- Yes --> C[Awesome!];\n    B -- No --> D[Make it goated];',
              style: { isMermaid: true },
            });
          },
        },
        {
          icon: (<MenuIcon><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></MenuIcon>),
          label: 'Whiteboard',
          desc: 'Freehand sketch space',
          keywords: 'draw sketch pen',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 400, height: 320,
              content: 'untitled whiteboard',
              style: { isWhiteboard: true, whiteboardBg: '#ffffff', whiteboardStrokes: [] },
            });
          },
        },
        {
          icon: (<MenuIcon><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></MenuIcon>),
          label: 'Camera Mirror',
          desc: 'Your webcam, framed live',
          keywords: 'video webcam selfie',
          action: () => {
            const block = addObject({
              type: 'mirror', x: canvasPos.x, y: canvasPos.y, width: 280, height: 340,
              content: '',
              style: { mirrorShape: 'original' },
            });
            pendingCameraStart.add(block.id);
            useCanvasStore.getState().setSelectedId(block.id);
          },
        },
        {
          icon: (<MenuIcon><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></MenuIcon>),
          label: 'Voice Note',
          desc: 'Record and transcribe',
          keywords: 'audio record speech',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 340, height: 150,
              content: '',
              style: { isVoiceNote: true },
            });
          },
        },
        {
          icon: (<MenuIcon><polyline points="8 7 3 12 8 17" /><polyline points="16 7 21 12 16 17" /></MenuIcon>),
          label: 'Code Block',
          desc: 'Editor with syntax highlighting',
          keywords: 'editor javascript python source',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 500, height: 300,
              content: '// Code block\nfunction hello() {\n  console.log("Hello, World!");\n}',
              style: { isCode: true },
            });
          },
        },
        {
          icon: (<MenuIcon><path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" /><path d="M8 13h8" /><path d="M8 16h5" /></MenuIcon>),
          label: 'Code Repo',
          desc: 'Browse a folder like VS Code',
          keywords: 'folder explorer zip source tree',
          action: () => {
            const block = createRepoBlock(canvasPos.x, canvasPos.y);
            const input = document.createElement('input');
            input.type = 'file';
            (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
            input.multiple = true;
            input.onchange = (e) => {
              const files = (e.target as HTMLInputElement).files;
              if (files && files.length) void ingestFolderPickerIntoBlock(block.id, files);
            };
            input.click();
          },
        },
        {
          icon: (<MenuIcon><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></MenuIcon>),
          label: 'Binder',
          desc: 'A canvas inside a canvas',
          keywords: 'nested space folder book',
          action: () => {
            addObject({
              type: 'card', x: canvasPos.x, y: canvasPos.y, width: 280, height: 180,
              content: 'New Binder',
              style: { isBinder: true },
            });
          },
        },
      ],
    },
  ];

  // Filtered view: search flattens the sections into one ranked list.
  const q = query.trim().toLowerCase();
  const visibleSections: Section[] = q
    ? [{
        title: 'Results',
        tint: '#C97B4B',
        items: sections.flatMap((s) => s.items).filter((it) => {
          const hay = `${it.label} ${it.desc} ${it.keywords || ''}`.toLowerCase();
          return q.split(/\s+/).every((word) => hay.includes(word));
        }),
      }]
    : sections;

  const flatItems = visibleSections.flatMap((s) => s.items.map((it) => ({ ...it, tint: s.tint })));
  const clampedActive = Math.min(activeIdx, Math.max(0, flatItems.length - 1));

  const run = (item: Item) => {
    item.action();
    setPlusMenuPos(null);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { setPlusMenuPos(null); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, flatItems.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, flatItems.length - 1)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && flatItems[clampedActive]) { e.preventDefault(); run(flatItems[clampedActive]); }
  };

  // Keep the active row visible as arrows move it.
  const scrollActiveIntoView = (el: HTMLButtonElement | null, isActive: boolean) => {
    if (el && isActive) el.scrollIntoView({ block: 'nearest' });
  };

  // Clamp the (now much wider) panel to the viewport.
  const left = Math.max(8, Math.min(plusMenuPos.x, window.innerWidth - PANEL_W - 12));

  let flatIdx = -1; // running index across sections for keyboard nav

  return (
    <AnimatePresence>
      <motion.div
        key="plus-menu-content"
        className="plus-menu"
        style={{
          left,
          top: plusMenuPos.isToolbar ? undefined : Math.min(plusMenuPos.y, Math.max(8, window.innerHeight - 420)),
          bottom: plusMenuPos.isToolbar ? window.innerHeight - plusMenuPos.y + 10 : undefined,
          width: PANEL_W,
        }}
        initial={{ opacity: 0, scale: 0.96, y: plusMenuPos.isToolbar ? 6 : -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: plusMenuPos.isToolbar ? 6 : -6 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="glass-panel overflow-hidden flex flex-col" style={{ maxHeight: 'min(64vh, 560px)' }}>
          {/* Search */}
          <div className="shrink-0 border-b border-[var(--border)]" style={{ padding: '10px 12px' }}>
            <div
              className="flex items-center gap-2 rounded-xl bg-[var(--well,#F5EFE7)]"
              style={{ padding: '7px 11px', boxShadow: 'var(--well-inset)' }}
            >
              <span className="text-[var(--text-tertiary)] shrink-0">
                <MenuIcon><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></MenuIcon>
              </span>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
                onKeyDown={onSearchKeyDown}
                placeholder="Search blocks… (↑↓ to pick, Enter to insert)"
                className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                style={{ fontFamily: "'Outfit', sans-serif" }}
              />
              {query && (
                <button
                  onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                  className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  aria-label="Clear search"
                >
                  <MenuIcon><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></MenuIcon>
                </button>
              )}
            </div>
          </div>

          {/* Sections */}
          <div ref={listRef} className="overflow-y-auto overscroll-contain custom-scrollbar" style={{ padding: '10px 12px 14px' }}>
            {flatItems.length === 0 && (
              <div className="text-center text-[12px] text-[var(--text-tertiary)]" style={{ padding: '28px 0' }}>
                Nothing matches “{query}”
              </div>
            )}
            {visibleSections.map((section) => (
              section.items.length > 0 && (
                <div key={section.title}>
                  <div
                    className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-[var(--text-tertiary)] select-none"
                    style={{ padding: '10px 6px 6px' }}
                  >
                    {section.title}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {section.items.map((item) => {
                      flatIdx += 1;
                      const idx = flatIdx;
                      const isActive = idx === clampedActive;
                      return (
                        <button
                          key={item.label}
                          ref={(el) => scrollActiveIntoView(el, isActive)}
                          onClick={() => run(item)}
                          onMouseEnter={() => setActiveIdx(idx)}
                          className="flex items-center gap-2.5 rounded-xl text-left transition-colors cursor-pointer"
                          style={{
                            padding: '8px 9px',
                            background: isActive ? 'var(--well, #F5EFE7)' : 'transparent',
                          }}
                        >
                          <span
                            className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
                            style={{ background: `${section.tint}1C`, color: section.tint }}
                          >
                            {item.icon}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[12px] font-semibold text-[var(--text-primary)] leading-tight truncate" style={{ fontFamily: "'Outfit', sans-serif" }}>
                              {item.label}
                            </span>
                            <span className="block text-[10px] text-[var(--text-tertiary)] leading-tight truncate">
                              {item.desc}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )
            ))}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
