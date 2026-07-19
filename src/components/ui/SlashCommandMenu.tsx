'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { motion, AnimatePresence } from 'framer-motion';
import { newTimeline } from '@/lib/timeline';
import { ingestFolderPickerIntoBlock } from '@/lib/repoIngest';

interface SlashItem {
  id: string;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  keywords: string[];
  action: (objectId: string, updateObject: any, setEditingId: any) => void;
}

const ITEMS: SlashItem[] = [
  {
    id: 'countdown',
    label: 'Countdown',
    sublabel: 'Live timer to a date',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg>),
    keywords: ['countdown', 'timer', 'date', 'launch', 'time'],
    action: (objectId, updateObject, setEditingId) => {
      // Default to 15 days in the future
      const target = new Date();
      target.setDate(target.getDate() + 15);
      target.setHours(9, 0, 0, 0);

      updateObject(objectId, {
        type: 'card',
        width: 250,
        height: 250,
        content: '',
        style: {
          isCountdown: true,
          countdownTitle: 'Launch day',
          countdownDate: target.toISOString()
        }
      });
      setEditingId(null);
    }
  },
  {
    id: 'checklist',
    label: 'Checklist',
    sublabel: 'Trackable todo list',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><polyline points="8 12 11 15 16 9" /></svg>),
    keywords: ['checklist', 'todo', 'tasks', 'progress', 'list'],
    action: (objectId, updateObject, setEditingId) => {
      updateObject(objectId, {
        type: 'card',
        width: 280,
        height: 240,
        content: `Sprint tasks\n[x] Design login screen\n[x] Set up auth API\n[ ] Build onboarding flow\n[ ] Add error handling\n[ ] Write unit tests`,
        style: {
          isTodo: true
        }
      });
      setEditingId(null);
    }
  },
  {
    id: 'callout',
    label: 'Callout',
    sublabel: 'Note / Warning / Idea box — flag what matters',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="8" x2="12" y2="8.01" /></svg>),
    keywords: ['callout', 'note', 'warning', 'idea', 'question', 'success', 'alert', 'info', 'tip'],
    action: (objectId, updateObject, setEditingId) => {
      updateObject(objectId, {
        type: 'card',
        width: 340,
        height: 132,
        content: '',
        style: { isCallout: true, calloutKind: 'note' },
      });
      setEditingId(null);
    }
  },
  {
    id: 'toggle',
    label: 'Toggle List',
    sublabel: 'Collapsible section — hide detail behind a heading',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /><line x1="14" y1="7" x2="20" y2="7" /><line x1="14" y1="17" x2="20" y2="17" /></svg>),
    keywords: ['toggle', 'collapse', 'expand', 'fold', 'accordion', 'details', 'section'],
    action: (objectId, updateObject, setEditingId) => {
      updateObject(objectId, {
        type: 'text',
        width: 460,
        height: 60,
        content: '▸ Toggle heading\n  Hidden details — click the arrow to collapse',
      });
      setEditingId(null);
    }
  },
  {
    id: 'divider',
    label: 'Divider',
    sublabel: 'A horizontal rule to section your notes',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="4" y1="12" x2="20" y2="12" /></svg>),
    keywords: ['divider', 'rule', 'line', 'separator', 'hr', 'section', 'break'],
    action: (objectId, updateObject, setEditingId) => {
      updateObject(objectId, {
        type: 'text',
        width: 460,
        height: 24,
        content: '---',
      });
      setEditingId(null);
    }
  },
  {
    id: 'timer',
    label: 'Focus Timer',
    sublabel: 'Stopwatch for deep work',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></svg>),
    keywords: ['timer', 'focus', 'stopwatch', 'pomodoro', 'work'],
    action: (objectId, updateObject, setEditingId) => {
      updateObject(objectId, {
        type: 'card',
        width: 250,
        height: 190,
        content: '',
        style: { isTimer: true, timerLabel: '' }
      });
      setEditingId(null);
    }
  },
  {
    id: 'decision',
    label: 'Decision Spinner',
    sublabel: 'Let fate pick for you',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>),
    keywords: ['decision', 'spinner', 'random', 'pick', 'choose', 'dice'],
    action: (objectId, updateObject, setEditingId) => {
      updateObject(objectId, {
        type: 'card',
        width: 300,
        height: 240,
        content: '',
        style: { isDecision: true, decisionTitle: '', decisionOptions: ['Option A', 'Option B', 'Option C'] }
      });
      setEditingId(null);
    }
  },
  {
    id: 'progress',
    label: 'Progress Goal',
    sublabel: 'Draggable percent tracker',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /></svg>),
    keywords: ['progress', 'goal', 'percent', 'tracker', 'bar'],
    action: (objectId, updateObject, setEditingId) => {
      updateObject(objectId, {
        type: 'card',
        width: 280,
        height: 190,
        content: '',
        style: { isProgress: true, progressLabel: '', progressValue: 30 }
      });
      setEditingId(null);
    }
  },
  {
    id: 'poll',
    label: 'Interactive Poll',
    sublabel: 'Team vote and choices',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="6" y1="20" x2="6" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="18" y1="20" x2="18" y2="14" /></svg>),
    keywords: ['poll', 'vote', 'choices', 'survey', 'question'],
    action: (objectId, updateObject, setEditingId) => {
      updateObject(objectId, {
        type: 'card',
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
      setEditingId(null);
    }
  },
  {
    id: 'metric',
    label: 'Live Metric',
    sublabel: 'Enter your numbers, get a sparkline',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" /></svg>),
    keywords: ['metric', 'kpi', 'analytics', 'live', 'sparkline', 'number'],
    action: (objectId, updateObject, setEditingId) => {
      // Data-entry first: asks for your numbers before rendering.
      updateObject(objectId, {
        type: 'card',
        width: 260,
        height: 180,
        content: '',
        style: { isLiveMetric: true, metricSetup: true }
      });
      setEditingId(null);
    }
  },
  {
    id: 'chart',
    label: 'Chart',
    sublabel: 'Bar, line, donut or number — from your data',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="8" y1="17" x2="8" y2="12" /><line x1="12" y1="17" x2="12" y2="7" /><line x1="16" y1="17" x2="16" y2="14" /></svg>),
    keywords: ['chart', 'bar', 'line', 'donut', 'pie', 'graph', 'data', 'visualize', 'dashboard'],
    action: (objectId, updateObject, setEditingId) => {
      // Starts on the type picker → then asks for data → then renders.
      updateObject(objectId, {
        type: 'card',
        width: 300,
        height: 280,
        content: '',
        style: { isChart: true }
      });
      setEditingId(null);
    }
  },
  {
    id: 'timeline',
    label: 'Timeline',
    sublabel: 'Roadmap of draggable date bars',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="6" y1="17" x2="12" y2="17" /></svg>),
    keywords: ['timeline', 'gantt', 'roadmap', 'schedule', 'plan', 'milestone', 'dates', 'calendar'],
    action: (objectId, updateObject, setEditingId) => {
      const seed = newTimeline(0, 0);
      updateObject(objectId, {
        type: 'card',
        width: seed.width,
        height: seed.height,
        content: '',
        style: seed.style,
      });
      setEditingId(null);
    }
  },
  {
    id: 'quickdata',
    label: 'Quick Data Table',
    sublabel: 'Key-value properties list',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="14" x2="21" y2="14" /><line x1="10" y1="9" x2="10" y2="20" /></svg>),
    keywords: ['quick', 'data', 'table', 'properties', 'grid', 'values'],
    action: (objectId, updateObject, setEditingId) => {
      updateObject(objectId, {
        type: 'card',
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
      setEditingId(null);
    }
  },
  {
    id: 'reference',
    label: 'Reference Embed',
    sublabel: 'Beautiful link card preview',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>),
    keywords: ['reference', 'embed', 'link', 'preview', 'url', 'web', 'youtube', 'spotify'],
    action: (objectId, updateObject, setEditingId) => {
      // Start empty — the block shows a URL input; paste any link (YouTube,
      // Spotify, article…) and it fetches a live thumbnail preview.
      updateObject(objectId, {
        type: 'card',
        width: 300,
        height: 260,
        content: '',
        style: {
          isLinkPreview: true,
          linkResolved: false,
        }
      });
      setEditingId(null);
    }
  },
  {
    id: 'braindump',
    label: 'Braindump',
    sublabel: 'Talk — AI turns it into cards, checklists & connectors',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>),
    keywords: ['braindump', 'brain', 'dump', 'voice', 'talk', 'speak', 'record', 'structure', 'transcribe'],
    action: (objectId, updateObject, setEditingId) => {
      updateObject(objectId, {
        type: 'card',
        width: 360,
        height: 240,
        content: '',
        style: { isVoiceNote: true, braindump: true, autoRecord: true },
      });
      setEditingId(null);
    }
  },
  {
    id: 'repo',
    label: 'Code Repo',
    sublabel: 'Browse a folder or .zip like a code editor — tree + highlighting',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" /><path d="M8 13h8" /><path d="M8 16h5" /></svg>),
    keywords: ['repo', 'folder', 'code', 'files', 'tree', 'explorer', 'project', 'directory', 'zip', 'source'],
    action: (objectId, updateObject, setEditingId) => {
      updateObject(objectId, {
        type: 'card',
        width: 760,
        height: 500,
        content: '',
        style: { isRepo: true, repoStatus: 'empty' },
      });
      setEditingId(null);
      // Offer the folder picker immediately (still inside the click gesture).
      const input = document.createElement('input');
      input.type = 'file';
      (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
      input.multiple = true;
      input.onchange = (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (files && files.length) void ingestFolderPickerIntoBlock(objectId, files);
      };
      input.click();
    }
  },
  {
    id: 'code',
    label: 'Code Sandbox',
    sublabel: 'Interactive code editor block',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="8 7 3 12 8 17" /><polyline points="16 7 21 12 16 17" /></svg>),
    keywords: ['code', 'sandbox', 'editor', 'coding', 'html', 'javascript'],
    action: (objectId, updateObject, setEditingId) => {
      updateObject(objectId, {
        type: 'card',
        width: 450,
        height: 350,
        content: '',
        style: {
          isCode: true
        }
      });
      setEditingId(null);
    }
  },
  {
    id: 'agent',
    label: 'AI Agent',
    sublabel: 'Type a task, press Enter — it builds on the canvas',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      </svg>
    ),
    keywords: ['ai', 'agent', 'nvidia', 'llama', 'copilot', 'generate', 'build', 'create'],
    action: (objectId) => {
      // Stay inline: seed "/agent " into the block so the user types the task
      // right where they are and Enter launches it (handled in CanvasObject).
      window.dispatchEvent(new CustomEvent('seed-agent-prompt', { detail: { objectId } }));
    }
  }
];

export default function SlashCommandMenu() {
  const slashMenu = useCanvasStore((s) => s.slashMenu);
  const setSlashMenu = useCanvasStore((s) => s.setSlashMenu);
  const updateObject = useCanvasStore((s) => s.updateObject);
  const setEditingId = useCanvasStore((s) => s.setEditingId);

  const [activeIndex, setActiveIndex] = useState(0);

  const query = slashMenu?.query || '';

  // Filter items based on query
  const filtered = useMemo(() => {
    if (!query) return ITEMS;
    const lower = query.toLowerCase();
    return ITEMS.filter((item) =>
      item.label.toLowerCase().includes(lower) ||
      item.keywords.some((kw) => kw.includes(lower))
    );
  }, [query]);

  // Keep index in bound
  useEffect(() => {
    setActiveIndex(0);
  }, [filtered]);

  // Listen to keyboard event dispatches from CanvasObject keydown handler
  useEffect(() => {
    if (!slashMenu) return;

    const handleDown = () => {
      setActiveIndex((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0));
    };

    const handleUp = () => {
      setActiveIndex((prev) => (filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0));
    };

    const handleSelect = () => {
      if (filtered[activeIndex]) {
        filtered[activeIndex].action(slashMenu.objectId, updateObject, setEditingId);
        setSlashMenu(null);
      }
    };

    window.addEventListener('slash-menu-down', handleDown);
    window.addEventListener('slash-menu-up', handleUp);
    window.addEventListener('slash-menu-select', handleSelect);

    return () => {
      window.removeEventListener('slash-menu-down', handleDown);
      window.removeEventListener('slash-menu-up', handleUp);
      window.removeEventListener('slash-menu-select', handleSelect);
    };
  }, [slashMenu, filtered, activeIndex, updateObject, setEditingId, setSlashMenu]);

  if (!slashMenu) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.96 }}
        transition={{ duration: 0.12 }}
        className="fixed z-[9999] bg-[#18181b]/95 border border-white/10 rounded-xl shadow-2xl p-1.5 min-w-[220px] pointer-events-auto"
        style={{
          left: `${slashMenu.x}px`,
          top: `${slashMenu.y}px`,
          backdropFilter: 'blur(12px)'
        }}
        onMouseDown={(e) => e.stopPropagation()} // Prevent deselections
      >
        <div className="text-[10px] text-white/40 px-2 py-1 font-bold uppercase tracking-wider border-b border-white/5 mb-1 select-none">
          Add canvas extension
        </div>
        
        {filtered.length === 0 ? (
          <div className="text-xs text-white/40 italic px-3 py-2 select-none">
            No extensions match &ldquo;{query}&rdquo;
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 max-h-[220px] overflow-y-auto">
            {filtered.map((item, idx) => {
              const isActive = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => {
                    item.action(slashMenu.objectId, updateObject, setEditingId);
                    setSlashMenu(null);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center gap-2.5 transition-all select-none cursor-pointer ${
                    isActive 
                      ? 'bg-white/10 text-white border border-white/5' 
                      : 'text-white/70 hover:text-white border border-transparent'
                  }`}
                >
                  <span className="text-base select-none">{item.icon}</span>
                  <div className="flex flex-col select-none">
                    <span className="text-xs font-bold leading-tight">{item.label}</span>
                    <span className={`text-[9px] mt-0.5 ${isActive ? 'text-white/60' : 'text-white/40'}`}>
                      {item.sublabel}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
