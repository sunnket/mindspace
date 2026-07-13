'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useSpring } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';

// Fixed target in screen space — bottom-left corner
const TARGET_X = 44;
const TARGET_Y = typeof window !== 'undefined' ? window.innerHeight - 30 : 900;

function seededRandom(seed: number) {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

interface PileCard {
  id: string;
  label: string;
  color?: string;
  rotation: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  zIndex: number;
}

interface FlyingCard {
  id: string;
  label: string;
  color?: string;
  originX: number;
  originY: number;
  addedAt: number;
}

interface FlyingBackCard {
  id: string;
  label: string;
  color?: string;
  targetX: number;
  targetY: number;
}

// ─── Flying crumple card (To Trash) ───────────────────────────────────────────
function FlyingPaperCard({
  card,
  onLanded,
}: {
  card: FlyingCard;
  onLanded: (id: string) => void;
}) {
  const [phase, setPhase] = useState<'crumple' | 'fly'>('crumple');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('fly'), 280);
    const t2 = setTimeout(() => onLanded(card.id), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [card.id, onLanded]);

  const dx = TARGET_X - card.originX;
  const dy = TARGET_Y - card.originY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  return (
    <motion.div
      className="fixed pointer-events-none select-none"
      style={{
        left: card.originX - 60,
        top: card.originY - 30,
        width: 120,
        height: 60,
        zIndex: 9998,
        willChange: 'transform, opacity, filter',
        originX: '50%',
        originY: '50%',
      }}
      animate={
        phase === 'crumple'
          ? {
              scaleX: [1, 1.18, 0.65, 0.52],
              scaleY: [1, 0.65, 1.12, 0.52],
              rotate: [0, -6, 12, -8],
              opacity: 1,
              x: 0,
              y: 0,
              filter: 'blur(0px)',
            }
          : {
              x: dx,
              y: dy,
              scaleX: 0.35,
              scaleY: 0.35,
              rotate: angle + 90,
              opacity: 0,
              filter: `blur(${Math.min(dist / 500, 2)}px)`,
            }
      }
      transition={
        phase === 'crumple'
          ? { duration: 0.26, ease: 'easeOut' }
          : {
              duration: 0.58,
              ease: [0.6, 0, 0.98, 0.4] as [number, number, number, number],
              opacity: { duration: 0.5, ease: 'easeIn' },
              filter: { duration: 0.58 },
            }
      }
    >
      <div
        className="w-full h-full rounded-xl relative overflow-hidden flex items-center justify-center"
        style={{
          background: card.color
            ? `${card.color}cc`
            : 'linear-gradient(140deg, #ffffff 0%, #f1f5f9 100%)',
          border: '1px solid rgba(0,0,0,0.09)',
          boxShadow: '0 6px 24px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.07)',
        }}
      >
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 120 60" preserveAspectRatio="none">
          <motion.line x1="18" y1="3" x2="44" y2="57" stroke="rgba(0,0,0,0.08)" strokeWidth="0.9"
            initial={{ opacity: 0 }} animate={{ opacity: phase === 'crumple' ? 1 : 0 }} transition={{ duration: 0.2 }} />
          <motion.line x1="82" y1="2" x2="58" y2="58" stroke="rgba(0,0,0,0.06)" strokeWidth="0.7"
            initial={{ opacity: 0 }} animate={{ opacity: phase === 'crumple' ? 1 : 0 }} transition={{ duration: 0.2, delay: 0.04 }} />
          <motion.line x1="105" y1="12" x2="15" y2="48" stroke="rgba(0,0,0,0.05)" strokeWidth="0.6"
            initial={{ opacity: 0 }} animate={{ opacity: phase === 'crumple' ? 1 : 0 }} transition={{ duration: 0.2, delay: 0.07 }} />
        </svg>
        <span className="text-[10px] font-medium text-center px-3 truncate max-w-full relative z-10"
          style={{ color: 'rgba(0,0,0,0.4)', fontFamily: "'Inter', sans-serif" }}>
          {card.label || 'Card'}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Flying back paper card (From Trash to Canvas) ────────────────────────────
function FlyingBackPaperCard({
  card,
  onLanded,
}: {
  card: FlyingBackCard;
  onLanded: (id: string) => void;
}) {
  const startX = TARGET_X;
  const startY = typeof window !== 'undefined' ? window.innerHeight - 50 : 800;

  useEffect(() => {
    const t = setTimeout(() => onLanded(card.id), 750);
    return () => clearTimeout(t);
  }, [card.id, onLanded]);

  const dx = card.targetX - startX;
  const dy = card.targetY - startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  return (
    <motion.div
      className="fixed pointer-events-none select-none"
      style={{
        left: startX - 60,
        top: startY - 30,
        width: 120,
        height: 60,
        zIndex: 9999,
        willChange: 'transform, opacity, filter',
        originX: '50%',
        originY: '50%',
      }}
      initial={{
        x: 0,
        y: 0,
        scaleX: 0.35,
        scaleY: 0.35,
        rotate: angle + 90,
        opacity: 0,
        filter: 'blur(3px)',
      }}
      animate={{
        x: dx,
        y: dy,
        scaleX: [0.35, 0.7, 1.1, 1],
        scaleY: [0.35, 1.2, 0.9, 1],
        rotate: [angle + 90, 180, -10, 0],
        opacity: [0, 1, 1, 1],
        filter: 'blur(0px)',
      }}
      transition={{
        duration: 0.75,
        ease: [0.25, 1, 0.5, 1],
      }}
    >
      <div
        className="w-full h-full rounded-xl relative overflow-hidden flex items-center justify-center animate-pulse"
        style={{
          background: card.color
            ? `${card.color}dd`
            : 'linear-gradient(140deg, #ffffff 0%, #f1f5f9 100%)',
          border: '1px solid rgba(0,0,0,0.12)',
          boxShadow: '0 6px 24px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.07)',
        }}
      >
        <span className="text-[10px] font-semibold text-center px-3 truncate max-w-full relative z-10"
          style={{ color: 'rgba(0,0,0,0.6)', fontFamily: "'Inter', sans-serif" }}>
          {card.label || 'Card'}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Single resting card in the pile ─────────────────────────────────────────
function PileItem({
  card,
  justLanded,
}: {
  card: PileCard;
  justLanded: boolean;
}) {
  return (
    <motion.div
      className="absolute rounded-lg"
      style={{
        width: 52,
        height: 34,
        bottom: card.offsetY,
        left: card.offsetX,
        zIndex: card.zIndex,
        originX: '50%',
        originY: '50%',
        background: card.color
          ? `${card.color}bb`
          : 'linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)',
        border: '1px solid rgba(0,0,0,0.07)',
        boxShadow: '0 3px 12px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06)',
      }}
      initial={justLanded ? { rotate: card.rotation + 50, scale: 1.4, y: -40, opacity: 0 } : false}
      animate={{ rotate: card.rotation, scale: card.scale, y: 0, opacity: 1 }}
      transition={{
        type: 'spring',
        stiffness: justLanded ? 340 : 180,
        damping: justLanded ? 16 : 28,
        mass: 0.7,
      }}
    >
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 52 34" preserveAspectRatio="none">
        <line x1={6 + seededRandom(card.zIndex) * 8} y1="3"
          x2={18 + seededRandom(card.zIndex + 1) * 14} y2="31"
          stroke="rgba(0,0,0,0.05)" strokeWidth="0.7" />
        <line x1={38 + seededRandom(card.zIndex + 2) * 8} y1="2"
          x2={28 + seededRandom(card.zIndex + 3) * 8} y2="32"
          stroke="rgba(0,0,0,0.04)" strokeWidth="0.5" />
      </svg>
    </motion.div>
  );
}

// ─── Main TrashPile component ─────────────────────────────────────────────────
export default function TrashPile() {
  const trashItems = useCanvasStore((s) => s.trashItems);
  const clearOldTrash = useCanvasStore((s) => s.clearOldTrash);
  const restoreObject = useCanvasStore((s) => s.restoreObject);
  const deleteFromTrashPermanently = useCanvasStore((s) => s.deleteFromTrashPermanently);
  const emptyTrash = useCanvasStore((s) => s.emptyTrash);

  const [flyingCards, setFlyingCards] = useState<FlyingCard[]>([]);
  const [flyingBackCards, setFlyingBackCards] = useState<FlyingBackCard[]>([]);
  const [retrievingIds, setRetrievingIds] = useState<Set<string>>(new Set());

  const [pileCards, setPileCards] = useState<PileCard[]>([]);
  const [justLandedId, setJustLandedId] = useState<string | null>(null);
  const [isPileVisible, setIsPileVisible] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  
  const processedIds = useRef<Set<string>>(new Set());
  const pileCardsRef = useRef<PileCard[]>([]);

  // Keep ref in sync with state so handleLanded closure always sees latest pile
  useEffect(() => { pileCardsRef.current = pileCards; }, [pileCards]);

  // Spring for pile bounce
  const pileScale = useSpring(1, { stiffness: 450, damping: 18, mass: 0.5 });

  // Watch for new trashItems and enqueue them as flying cards
  useEffect(() => {
    trashItems.forEach((item) => {
      if (processedIds.current.has(item.id)) return;
      processedIds.current.add(item.id);
      setFlyingCards((prev) => {
        if (prev.some((c) => c.id === item.id)) return prev;
        return [...prev, item];
      });
      setIsPileVisible(true);
    });
  }, [trashItems]);

  // Synchronize pile cards on mount or when trashItems is updated
  useEffect(() => {
    const flyingIds = new Set(flyingCards.map((c) => c.id));
    const visibleItems = trashItems.filter((t) => !retrievingIds.has(t.id) && !flyingIds.has(t.id));
    
    setPileCards((prev) => {
      // Keep existing pile cards that are still in trashItems
      const filteredPrev = prev.filter((p) => visibleItems.some((t) => t.id === p.id));
      
      // Add missing items to the pile
      const missingItems = visibleItems.filter((t) => !filteredPrev.some((p) => p.id === t.id));
      
      const newPileItems = missingItems.map((item, index) => {
        const idx = filteredPrev.length + index;
        const r  = seededRandom(idx * 7.31);
        const r2 = seededRandom(idx * 3.17 + 5);
        const r3 = seededRandom(idx * 5.93 + 2);
        
        return {
          id: item.id,
          label: item.label,
          color: item.color,
          rotation: (r - 0.5) * 56,
          offsetX: (r2 - 0.5) * 20,
          offsetY: 6 + idx * 2 + r3 * 5,
          scale: 0.93 + r * 0.14,
          zIndex: idx + 1,
        };
      });
      
      const combined = [...filteredPrev, ...newPileItems];
      return Array.from(new Map(combined.map((p) => [p.id, p])).values());
    });

    if (visibleItems.length > 0 || flyingCards.length > 0) {
      setIsPileVisible(true);
    } else {
      setIsPileVisible(false);
      setIsTrashOpen(false);
    }
  }, [trashItems, retrievingIds, flyingCards]);

  // Periodic cleanup (cleans items older than 30 mins)
  useEffect(() => {
    const id = setInterval(clearOldTrash, 60_000);
    return () => clearInterval(id);
  }, [clearOldTrash]);

  const handleLanded = useCallback((id: string) => {
    setFlyingCards((prev) => prev.filter((c) => c.id !== id));

    const item = trashItems.find((t) => t.id === id);
    if (!item) return;

    setPileCards((prev) => {
      if (prev.some((p) => p.id === id)) return prev;

      const idx = prev.length;
      const r  = seededRandom(idx * 7.31);
      const r2 = seededRandom(idx * 3.17 + 5);
      const r3 = seededRandom(idx * 5.93 + 2);

      const newCard: PileCard = {
        id,
        label: item.label || '',
        color: item.color,
        rotation: (r - 0.5) * 56,
        offsetX: (r2 - 0.5) * 20,
        offsetY: 6 + idx * 2 + r3 * 5,
        scale: 0.93 + r * 0.14,
        zIndex: idx + 1,
      };
      return [...prev, newCard];
    });
    setJustLandedId(id);

    // Pile squash-and-stretch on landing
    pileScale.set(1.18);
    setTimeout(() => pileScale.set(1), 60);
    setTimeout(() => setJustLandedId(null), 700);
  }, [trashItems, pileScale]);

  // Trigger fly back to canvas
  const handleRetrieveItem = (id: string) => {
    const item = trashItems.find((t) => t.id === id);
    if (!item) return;

    // Calculate target coordinates in screen space
    const camera = useCanvasStore.getState().camera;
    const canvasX = item.objectData ? item.objectData.x : 0;
    const canvasY = item.objectData ? item.objectData.y : 0;
    const w = item.objectData ? (item.objectData.width ?? 200) : 200;
    const h = item.objectData ? (item.objectData.height ?? 120) : 120;

    const screenX = canvasX * camera.zoom + camera.x + (w / 2) * camera.zoom;
    const screenY = canvasY * camera.zoom + camera.y + (h / 2) * camera.zoom;

    // Mark as retrieving in local state to instantly hide it
    setRetrievingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    // Start flying back animation
    setFlyingBackCards((prev) => {
      const backId = id + '-back';
      if (prev.some((c) => c.id === backId)) return prev;
      return [
        ...prev,
        {
          id: backId,
          label: item.label,
          color: item.color,
          targetX: screenX,
          targetY: screenY,
        },
      ];
    });
  };

  const handleBackLanded = useCallback((flyBackId: string) => {
    const originalId = flyBackId.replace('-back', '');

    // Stop flying animation
    setFlyingBackCards((prev) => prev.filter((c) => c.id !== flyBackId));

    // Restore to canvas objects list
    restoreObject(originalId);

    // Unmark as retrieving
    setRetrievingIds((prev) => {
      const next = new Set(prev);
      next.delete(originalId);
      return next;
    });
  }, [restoreObject]);

  const handleEmptyAll = () => {
    emptyTrash();
    setPileCards([]);
    setFlyingCards([]);
    processedIds.current.clear();
    setIsTrashOpen(false);
  };

  const handleDeletePermanently = (id: string) => {
    deleteFromTrashPermanently(id);
  };

  const getRelativeTime = (time: number) => {
    const diff = Math.max(0, Date.now() - time);
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    return `${mins}m ago`;
  };

  // Helper to draw item thumbnail preview inside list rows
  const renderItemThumbnail = (item: any) => {
    const bg = item.color || '#ffffff';
    const type = item.objectData?.type || 'text';
    
    return (
      <div 
        className="w-10 h-7 rounded flex items-center justify-center shadow-sm border border-black/5 shrink-0"
        style={{ background: bg }}
      >
        {type === 'voice-note' && <span className="text-[11px] flex items-center"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /></svg></span>}
        {type === 'code-sandbox' && <span className="text-[11px] flex items-center"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="8 7 3 12 8 17" /><polyline points="16 7 21 12 16 17" /></svg></span>}
        {type === 'todo-list' && <span className="text-[11px] flex items-center"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><polyline points="8 12 11 15 16 9" /></svg></span>}
        {type === 'quote' && <span className="text-[11px]">“</span>}
        {type === 'shape' && (
          <div 
            className="w-3.5 h-3.5 border border-black/20"
            style={{
              borderRadius: item.objectData?.style?.shapeType === 'circle' ? '50%' : '2px',
              backgroundColor: 'rgba(0,0,0,0.05)'
            }}
          />
        )}
        {type === 'arrow' && <span className="text-[11px] rotate-45 inline-block">→</span>}
        {type === 'workflow-node' && <span className="text-[11px] flex items-center"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3v12a6 6 0 0 0 6 6h0" /><circle cx="6" cy="3" r="2" /><circle cx="18" cy="9" r="2" /></svg></span>}
        {type === 'text' && <span className="text-[9px] font-mono font-bold opacity-30">Ab</span>}
        {type === 'heading' && <span className="text-[9px] font-mono font-bold opacity-45">H1</span>}
      </div>
    );
  };

  const visibleTrashItems = Array.from(
    new Map(
      trashItems
        .filter((t) => !retrievingIds.has(t.id))
        .map((item) => [item.id, item])
    ).values()
  );

  return (
    <>
      {/* Flying crumple cards (To Trash) */}
      <AnimatePresence>
        {flyingCards.map((card) => (
          <FlyingPaperCard key={card.id} card={card} onLanded={handleLanded} />
        ))}
      </AnimatePresence>

      {/* Flying back cards (To Canvas) */}
      <AnimatePresence>
        {flyingBackCards.map((card) => (
          <FlyingBackPaperCard key={card.id} card={card} onLanded={handleBackLanded} />
        ))}
      </AnimatePresence>

      {/* Trash bin popup viewer */}
      <AnimatePresence>
        {isTrashOpen && visibleTrashItems.length > 0 && (
          <motion.div
            className="fixed bottom-24 left-6 z-[9995] flex flex-col w-[340px] max-h-[420px] bg-[#FAF6F1]/95 dark:bg-[#191714]/95 backdrop-blur-xl border border-black/10 dark:border-white/10 rounded-2xl shadow-xl overflow-hidden pointer-events-auto"
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: 'spring', stiffness: 350, damping: 26 }}
            style={{ boxShadow: '0 20px 50px rgba(45, 42, 38, 0.15)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#EDE5D8]/40 dark:bg-white/5 border-b border-black/5 dark:border-white/5">
              <div className="flex items-center gap-1.5">
                <span className="font-serif italic text-lg text-[var(--accent)]">Deleted Items</span>
                <span className="text-[10px] bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold px-2 py-0.5 rounded-full">
                  {visibleTrashItems.length}
                </span>
              </div>
              <button 
                onClick={handleEmptyAll}
                className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:text-red-500 transition-colors"
              >
                Empty bin
              </button>
            </div>

            {/* Scrollable list */}
            <div className="overflow-y-auto max-h-[340px] p-3 space-y-2.5 custom-scrollbar bg-[#FAF6F1]/50 dark:bg-transparent">
              {visibleTrashItems.map((item) => {
                const itemType = item.objectData?.type as any;
                const itemTypeName = 
                  itemType === 'voice-note' ? 'Voice Recording' :
                  itemType === 'code-sandbox' ? 'Code Block' :
                  itemType === 'todo-list' ? 'Todo List' :
                  itemType === 'quote' ? 'Quote Block' :
                  itemType === 'shape' ? `${(item.objectData?.style as any)?.shapeType || 'Shape'}` :
                  itemType === 'arrow' ? 'Connection Line' :
                  itemType === 'workflow-node' ? 'Workflow Node' :
                  itemType === 'heading' ? 'Heading Card' : 'Text Card';

                return (
                  <motion.div
                    key={item.id}
                    layoutId={`trash-row-${item.id}`}
                    className="group flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 hover:border-[var(--accent-light)] hover:shadow-sm transition-all"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                  >
                    {/* Visual Preview */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      {renderItemThumbnail(item)}
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold truncate text-[var(--text-primary)] pr-2">
                          {item.label || 'Empty Note'}
                        </span>
                        <span className="text-[9px] text-[var(--text-tertiary)] flex items-center gap-1.5 mt-0.5">
                          <span className="capitalize">{itemTypeName}</span>
                          <span>•</span>
                          <span>{getRelativeTime(item.addedAt)}</span>
                        </span>
                      </div>
                    </div>

                    {/* Quick actions */}
                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity shrink-0">
                      {/* Retrieve */}
                      <button
                        onClick={() => handleRetrieveItem(item.id)}
                        className="w-7 h-7 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white hover:scale-105 active:scale-95 transition-all"
                        title="Retrieve to canvas"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 7v6h6" />
                          <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                        </svg>
                      </button>

                      {/* Delete permanently */}
                      <button
                        onClick={() => handleDeletePermanently(item.id)}
                        className="w-7 h-7 rounded-full bg-[#FFE4E6]/50 dark:bg-red-500/15 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white hover:scale-105 active:scale-95 transition-all"
                        title="Delete permanently"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trash bin + pile in bottom-left */}
      <AnimatePresence>
        {isPileVisible && (
          <motion.div
            className="fixed bottom-[-24px] left-4 z-[9990] flex flex-col items-center pointer-events-auto"
            initial={{ opacity: 0, scale: 0.5, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            whileHover={{ y: -20 }}
            exit={{ opacity: 0, scale: 0.5, y: 30 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            {/* Pile of cards stacked above the bin */}
            <motion.div
              className="relative w-16 h-10 mb-0.5"
              style={{ scale: pileScale }}
            >
              <AnimatePresence>
                {pileCards.slice(-10).map((card) => (
                  <PileItem key={card.id} card={card} justLanded={card.id === justLandedId} />
                ))}
              </AnimatePresence>

              {/* Badge for large piles */}
              {pileCards.length > 10 && (
                <motion.div
                  className="absolute -top-2 -left-2 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center shadow z-50"
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                >
                  {pileCards.length}
                </motion.div>
              )}
            </motion.div>

            {/* Trash bin icon */}
            <motion.button
              className="relative w-14 h-14 flex items-center justify-center"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => setIsTrashOpen(!isTrashOpen)}
              title={`${pileCards.length} deleted item${pileCards.length !== 1 ? 's' : ''} — click to view`}
              style={{
                filter: isTrashOpen ? 'drop-shadow(0 0 8px rgba(var(--accent-rgb),0.4))' : 'none'
              }}
            >
              <svg viewBox="0 0 56 56" className="w-full h-full drop-shadow-xl" fill="none">
                {/* Body */}
                <rect x="8" y="18" width="40" height="32" rx="5"
                  fill="url(#trash-body)" stroke="rgba(0,0,0,0.1)" strokeWidth="1" />
                {/* Vertical lines */}
                <line x1="20" y1="24" x2="18" y2="44" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="28" y1="24" x2="28" y2="44" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="36" y1="24" x2="38" y2="44" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" />
                {/* Lid */}
                <motion.g
                  animate={{
                    rotate: justLandedId || isTrashOpen ? [-3, 8, -3, 0] : 0,
                    y: justLandedId || isTrashOpen ? [0, -5, 2, 0] : 0,
                  }}
                  transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                  style={{ transformOrigin: '28px 16px' }}
                >
                  <rect x="4" y="12" width="48" height="8" rx="4"
                    fill="url(#trash-lid)" stroke="rgba(0,0,0,0.1)" strokeWidth="1" />
                  {/* Handle */}
                  <rect x="20" y="7" width="16" height="7" rx="3.5"
                    fill="url(#trash-lid)" stroke="rgba(0,0,0,0.1)" strokeWidth="1" />
                </motion.g>

                <defs>
                  <linearGradient id="trash-body" x1="8" y1="18" x2="48" y2="50" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#94a3b8" />
                    <stop offset="100%" stopColor="#475569" />
                  </linearGradient>
                  <linearGradient id="trash-lid" x1="4" y1="12" x2="52" y2="20" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#b0bec5" />
                    <stop offset="100%" stopColor="#607d8b" />
                  </linearGradient>
                </defs>
              </svg>

              {/* Count label */}
              {pileCards.length > 0 && (
                <motion.span
                  className="absolute -bottom-4 left-0 right-0 text-center text-[9px] font-medium text-[var(--text-tertiary)] tabular-nums"
                  initial={{ opacity: 0 }} animate={{ opacity: 0.65 }}
                >
                  {pileCards.length}
                </motion.span>
              )}

              {/* Ground shadow */}
              <div
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full opacity-25"
                style={{
                  width: 40, height: 6,
                  background: 'radial-gradient(ellipse at center, #000 0%, transparent 80%)',
                  filter: 'blur(3px)',
                }}
              />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
