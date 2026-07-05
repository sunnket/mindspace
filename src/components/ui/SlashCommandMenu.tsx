'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { motion, AnimatePresence } from 'framer-motion';

interface SlashItem {
  id: string;
  label: string;
  sublabel: string;
  icon: string;
  keywords: string[];
  action: (objectId: string, updateObject: any, setEditingId: any) => void;
}

const ITEMS: SlashItem[] = [
  {
    id: 'countdown',
    label: 'Countdown',
    sublabel: 'Live timer to a date',
    icon: '⏳',
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
    icon: '☑️',
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
    id: 'poll',
    label: 'Interactive Poll',
    sublabel: 'Team vote and choices',
    icon: '📊',
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
    sublabel: 'Analytics sparkline chart',
    icon: '📈',
    keywords: ['metric', 'graph', 'chart', 'analytics', 'live', 'sparkline'],
    action: (objectId, updateObject, setEditingId) => {
      updateObject(objectId, {
        type: 'card',
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
      setEditingId(null);
    }
  },
  {
    id: 'quickdata',
    label: 'Quick Data Table',
    sublabel: 'Key-value properties list',
    icon: '📁',
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
    icon: '🔗',
    keywords: ['reference', 'embed', 'link', 'preview', 'url', 'web'],
    action: (objectId, updateObject, setEditingId) => {
      updateObject(objectId, {
        type: 'card',
        width: 280,
        height: 280,
        content: '',
        style: {
          isLinkPreview: true,
          linkUrl: 'https://medium.com',
          linkTitle: 'The psychology of onboarding',
          linkDescription: 'Why the first 60 seconds determine if a user stays or leaves...'
        }
      });
      setEditingId(null);
    }
  },
  {
    id: 'code',
    label: 'Code Sandbox',
    sublabel: 'Interactive code editor block',
    icon: '💻',
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
