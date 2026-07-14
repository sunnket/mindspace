'use client';

import React, { useState, useRef, useMemo } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import { motion, AnimatePresence } from 'framer-motion';
import CanvasObject from './CanvasObject';

export default function BinderBlock({ obj }: { obj: CanvasObjectData }) {
  const objects = useCanvasStore((s) => s.objects);
  const updateObject = useCanvasStore((s) => s.updateObject);

  const [title, setTitle] = useState(obj.content || 'New Binder');
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'files' | 'notes' | 'tasks'>('all');

  const modalWorkspaceRef = useRef<HTMLDivElement>(null);

  // Filter children bound to this binder
  const boundItems = useMemo(() => {
    return objects.filter((o) => o.parentId === obj.id);
  }, [objects, obj.id]);

  // Group bound items type-wise
  const groupedStats = useMemo(() => {
    let filesCount = 0;
    let notesCount = 0;
    let tasksCount = 0;

    boundItems.forEach((item) => {
      if (item.style?.isFile || item.type === 'image') {
        filesCount++;
      } else if (item.type === 'text' || item.type === 'heading' || item.type === 'sticky') {
        notesCount++;
      } else if (item.style?.isTodo) {
        tasksCount++;
      }
    });

    return {
      all: boundItems.length,
      files: filesCount,
      notes: notesCount,
      tasks: tasksCount,
    };
  }, [boundItems]);

  // Filter items for the active tab inside open view
  const filteredItems = useMemo(() => {
    return boundItems.filter((item) => {
      if (activeTab === 'all') return true;
      const isFile = item.style?.isFile || item.type === 'image';
      const isNote = item.type === 'text' || item.type === 'heading' || item.type === 'sticky';
      const isTask = item.style?.isTodo;

      if (activeTab === 'files') return isFile;
      if (activeTab === 'notes') return isNote;
      if (activeTab === 'tasks') return isTask;
      return true;
    });
  }, [boundItems, activeTab]);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    updateObject(obj.id, { content: val });
  };

  // Eject/revert single item back to parent workspace
  const ejectItem = (itemId: string) => {
    updateObject(itemId, {
      parentId: undefined, // Restore to root/parent board
      x: obj.x + obj.width + 40,
      y: obj.y + Math.random() * 60,
    });
  };

  // Revert all items
  const ejectAll = () => {
    boundItems.forEach((item, index) => {
      updateObject(item.id, {
        parentId: undefined,
        x: obj.x + obj.width + 40,
        y: obj.y + index * 40 + Math.random() * 20,
      });
    });
  };

  return (
    <>
      {/* Minimized card view on main canvas */}
      <div
        className="w-full h-full flex flex-col rounded-2xl border border-[rgba(var(--accent-rgb),0.3)] shadow-xl overflow-hidden bg-[rgba(var(--accent-rgb),0.05)] backdrop-blur-md transition-all select-none p-4 relative justify-between"
        onDoubleClick={() => setIsOpen(true)}
      >
        {/* Binder Ring Spine Graphic on Left */}
        <div className="absolute left-0 top-0 bottom-0 w-3 flex flex-col justify-around py-3 bg-black/15 dark:bg-white/10 rounded-l-2xl border-r border-black/5">
          <div className="w-1.5 h-3 rounded-full bg-gradient-to-r from-gray-400 to-gray-200 shadow-sm mx-auto" />
          <div className="w-1.5 h-3 rounded-full bg-gradient-to-r from-gray-400 to-gray-200 shadow-sm mx-auto" />
          <div className="w-1.5 h-3 rounded-full bg-gradient-to-r from-gray-400 to-gray-200 shadow-sm mx-auto" />
        </div>

        {/* Main Content inside Binder Card */}
        <div className="ml-3 flex-1 flex flex-col justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs">📁</span>
              <input
                type="text"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className="bg-transparent border-none outline-none font-bold text-xs text-[var(--text-primary)] w-full placeholder:opacity-40"
              />
            </div>
            <p className="text-[10px] text-[var(--text-secondary)] italic">
              Drag other items on top of this card to bind them.
            </p>
          </div>

          {/* Grouped counts preview */}
          <div className="grid grid-cols-2 gap-1.5 py-2">
            <div className="bg-black/5 dark:bg-white/5 rounded-lg px-2 py-1 flex items-center justify-between text-[10px] border border-black/5">
              <span className="text-[var(--text-secondary)]">📄 Files</span>
              <span className="font-bold text-[var(--text-primary)]">{groupedStats.files}</span>
            </div>
            <div className="bg-black/5 dark:bg-white/5 rounded-lg px-2 py-1 flex items-center justify-between text-[10px] border border-black/5">
              <span className="text-[var(--text-secondary)]">📝 Notes</span>
              <span className="font-bold text-[var(--text-primary)]">{groupedStats.notes}</span>
            </div>
            <div className="bg-black/5 dark:bg-white/5 rounded-lg px-2 py-1 flex items-center justify-between text-[10px] border border-black/5">
              <span className="text-[var(--text-secondary)]">🎯 Tasks</span>
              <span className="font-bold text-[var(--text-primary)]">{groupedStats.tasks}</span>
            </div>
            <div className="bg-black/5 dark:bg-white/5 rounded-lg px-2 py-1 flex items-center justify-between text-[10px] border border-black/5">
              <span className="text-[var(--text-secondary)]">📦 Total</span>
              <span className="font-bold text-[var(--text-primary)]">{groupedStats.all}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsOpen(true)}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full py-1.5 rounded-xl bg-[rgba(var(--accent-rgb),0.15)] border border-[rgba(var(--accent-rgb),0.3)] text-[var(--text-primary)] hover:bg-[rgba(var(--accent-rgb),0.25)] transition-colors text-[10px] font-bold cursor-pointer uppercase tracking-wider"
          >
            Open Binder
          </button>
        </div>
      </div>

      {/* Cinematic 7x7 cm Binder workspace dialog */}
      <AnimatePresence>
        {isOpen && (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Folder layout wrapper */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-[650px] h-[650px] rounded-3xl border border-[rgba(var(--accent-rgb),0.4)] shadow-2xl bg-[#FCF8F2] dark:bg-[#1a1714] text-[var(--text-primary)] flex overflow-hidden"
            >
              {/* Binder spine details (rings on left) */}
              <div className="w-12 bg-stone-200 dark:bg-[#151310] flex flex-col justify-around py-12 relative border-r border-stone-300 dark:border-stone-800 shadow-inner shrink-0">
                <div className="absolute right-0 top-0 bottom-0 w-[3px] bg-gradient-to-r from-black/20 to-transparent" />
                {[1, 2, 3, 4, 5].map((idx) => (
                  <div key={idx} className="relative w-8 h-4 mx-auto flex items-center">
                    {/* Metal binder clip arc */}
                    <div className="absolute -left-1 w-8 h-6 rounded-full border-r-4 border-t-2 border-b-2 border-stone-400 dark:border-stone-600 shadow-md transform rotate-12" />
                    <div className="w-3 h-3 rounded-full bg-stone-500 mx-auto border border-stone-600" />
                  </div>
                ))}
              </div>

              {/* Main folder content */}
              <div className="flex-1 flex flex-col p-6 min-w-0 bg-[#FDFAF6] dark:bg-[#1E1A17]">
                {/* Header row */}
                <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 pb-4 mb-4 shrink-0">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">📁</span>
                      <h2 className="font-extrabold text-lg tracking-tight">{title}</h2>
                    </div>
                    <span className="text-[10px] text-stone-500 italic mt-0.5">
                      Double-click items inside the folder to revert them back to the main workspace.
                    </span>
                  </div>

                  {/* Top action buttons */}
                  <div className="flex gap-2">
                    {boundItems.length > 0 && (
                      <button
                        type="button"
                        onClick={ejectAll}
                        className="px-3 py-1.5 rounded-xl border border-red-200 dark:border-red-900 bg-red-500/10 hover:bg-red-500/25 text-red-500 text-[10px] font-bold uppercase transition-colors"
                      >
                        Revert All
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      className="w-8 h-8 rounded-full border border-stone-300 dark:border-stone-800 bg-stone-100 dark:bg-stone-900 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-800 flex items-center justify-center text-sm font-bold shadow-sm"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Sub-tab Filter Bar */}
                <div className="flex gap-1.5 border-b border-stone-200 dark:border-stone-800 pb-2 mb-4 shrink-0 overflow-x-auto select-none">
                  {(['all', 'files', 'notes', 'tasks'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1 rounded-full text-[10px] font-semibold border transition-all uppercase tracking-wider ${
                        activeTab === tab
                          ? 'bg-[var(--accent)] border-[var(--accent)] text-white shadow-sm font-bold'
                          : 'bg-stone-100 dark:bg-stone-950 border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-800'
                      }`}
                    >
                      {tab} ({groupedStats[tab]})
                    </button>
                  ))}
                </div>

                {/* Grid Workspace / Scrollable Sub-canvas area */}
                <div
                  ref={modalWorkspaceRef}
                  className="flex-1 rounded-2xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-[#151210] overflow-y-auto relative p-4 grid grid-cols-2 gap-4 content-start min-h-0"
                >
                  <AnimatePresence>
                    {filteredItems.map((item) => (
                      <motion.div
                        key={item.id}
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="relative rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#1E1A17] p-3 shadow-md group flex flex-col justify-between min-h-[140px]"
                        onDoubleClick={() => ejectItem(item.id)}
                      >
                        {/* Type Icon Badge */}
                        <div className="flex justify-between items-start">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-[10px] text-stone-500 font-bold uppercase tracking-wider">
                            {item.style?.isFile || item.type === 'image'
                              ? 'File'
                              : item.style?.isTodo
                              ? 'Task'
                              : 'Note'}
                          </span>

                          <button
                            type="button"
                            onClick={() => ejectItem(item.id)}
                            title="Revert back to main canvas"
                            className="w-5 h-5 rounded-full bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white flex items-center justify-center text-[10px] border border-red-500/20 font-bold transition-all opacity-0 group-hover:opacity-100"
                          >
                            ⎗
                          </button>
                        </div>

                        {/* Card Preview Details */}
                        <div className="my-3 flex-1 min-w-0">
                          <p className="text-[11px] font-semibold text-[var(--text-primary)] line-clamp-3 leading-relaxed break-words">
                            {item.content || `Untitled ${item.type}`}
                          </p>
                          {item.style?.isFile === true && (
                            <div className="mt-1 flex items-center gap-1 text-[9px] text-stone-500">
                              <span>📁</span>
                              <span className="truncate">{(item.style?.fileName as string) || 'document'}</span>
                            </div>
                          )}
                        </div>

                        {/* Extra Metadata/Actions */}
                        <div className="border-t border-stone-100 dark:border-stone-850 pt-2 flex items-center justify-between text-[8px] text-stone-400">
                          <span>ID: {item.id.slice(0, 8)}</span>
                          <span>{new Date(item.createdAt || Date.now()).toLocaleDateString()}</span>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  {filteredItems.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center select-none pointer-events-none">
                      <span className="text-3xl mb-2">📁</span>
                      <p className="text-xs text-stone-400 font-medium">This section is currently empty.</p>
                      <p className="text-[10px] text-stone-500 mt-1">
                        Go back and drag files on top of the binder to store them.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
