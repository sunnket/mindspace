'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useSpring } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';

/* ───────────────────────────────────────────────────────────────────────────
   Where the bin sits, in one place.

   The bin is SUNK into the bottom-left corner: only its mouth breaks the fold,
   like a real bin standing just out of frame. Everything geometric about it is
   derived from these four numbers so the flight path, the resting heap and the
   drawing can never drift apart.

   These were module-level constants read once at import time, which meant the
   drop target was computed against whatever the window height happened to be on
   first load and never moved again — resize the window and every deleted card
   flew to a point in mid-air.
   ─────────────────────────────────────────────────────────────────────────── */
const BIN_LEFT = 16;        // container's `left`
const BIN_SIZE = 64;        // the bin button is 64×64
/* px of the bin hidden below the viewport at rest.
   At 30 a good third of the barrel stood above the floor line, which read as a
   bin parked on the board rather than one just out of frame. 44 leaves ~20px —
   the lip and a sliver of the body, nothing more. Hovering still lifts the
   whole thing into view, so the click target never shrinks with it. */
const BIN_SUNK = 44;
/** Mouth centre inside the 72-unit viewBox, as a fraction of the bin's height. */
const MOUTH_AT = 14.6 / 72;

/** Screen-space centre of the bin's opening — what deleted things fall into. */
function mouthPoint(): { x: number; y: number } {
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  return {
    x: BIN_LEFT + BIN_SIZE / 2,
    // Bin top edge = vh - (BIN_SIZE - BIN_SUNK); the mouth is a bit below that.
    y: vh - (BIN_SIZE - BIN_SUNK) + BIN_SIZE * MOUTH_AT,
  };
}

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

  // Aim a few px BELOW the lip so the ball reads as dropping in, not landing on.
  const target = mouthPoint();
  const dx = target.x - card.originX;
  const dy = target.y + 6 - card.originY;
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
              // Shrinks almost to nothing at the mouth: the ball goes IN, it
              // doesn't just fade out somewhere near the bin.
              scaleX: 0.12,
              scaleY: 0.12,
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
              // Hold the ball solid until it's over the mouth, then snuff it
              // out fast — the last 25% of the flight is inside the bin.
              opacity: { duration: 0.16, delay: 0.42, ease: 'easeIn' },
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
  // Climbs back out of the same hole it fell into.
  const { x: startX, y: startY } = mouthPoint();

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
  /* A crumpled ball, not a small white rectangle.
     The pile used to be flat rounded cards with a couple of hairline creases,
     which on a dark board read as a stack of glowing white tiles rather than
     rubbish. A ball is what a thrown-away page actually looks like, and it also
     solves the contrast problem on its own: the shading gives it an edge and a
     shadow side, so it sits on any background instead of blazing against black.

     The facets are seeded off the card's z-index, so every ball is a different
     crumple but the SAME ball every render — re-randomising on each frame made
     the pile shimmer. */
  const seed = card.zIndex;
  const r = (n: number) => seededRandom(seed + n);
  const base = card.color || '#F2EFE9';

  return (
    <motion.div
      className="absolute"
      style={{
        width: 34,
        height: 34,
        bottom: card.offsetY,
        // Centred in the 64px-wide pile box (offsetX is a signed jitter, not a
        // position), so the heap sits over the bin instead of off to one side.
        left: 15 + card.offsetX,
        zIndex: card.zIndex,
        originX: '50%',
        originY: '50%',
        filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.38))',
      }}
      initial={justLanded ? { rotate: card.rotation + 90, scale: 1.5, y: -46, opacity: 0 } : false}
      animate={{ rotate: card.rotation, scale: card.scale, y: 0, opacity: 1 }}
      transition={{
        type: 'spring',
        stiffness: justLanded ? 340 : 180,
        damping: justLanded ? 16 : 28,
        mass: 0.7,
      }}
    >
      <svg viewBox="0 0 40 40" className="w-full h-full">
        <defs>
          <radialGradient id={`crumple-${seed}`} cx="36%" cy="30%" r="72%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor={base} />
            <stop offset="100%" stopColor="#9a938a" />
          </radialGradient>
        </defs>

        {/* Lumpy silhouette — a polygon with jittered radii reads as paper;
            a circle would read as a stone. */}
        <polygon
          points={Array.from({ length: 11 }, (_, i) => {
            const a = (i / 11) * Math.PI * 2;
            const rad = 15 + r(i) * 4.5;
            return `${20 + Math.cos(a) * rad},${20 + Math.sin(a) * rad}`;
          }).join(' ')}
          fill={`url(#crumple-${seed})`}
          stroke="rgba(0,0,0,0.22)"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />

        {/* Creases: a few catching the light, a few in shadow. */}
        <g strokeLinecap="round" fill="none">
          <path d={`M${10 + r(1) * 4},${13 + r(2) * 4} L${20 + r(3) * 3},${20 + r(4) * 2} L${13 + r(5) * 4},${29 + r(6) * 3}`}
            stroke="rgba(0,0,0,0.16)" strokeWidth="0.8" />
          <path d={`M${20 + r(7) * 3},${20 + r(8) * 2} L${30 + r(9) * 3},${15 + r(10) * 4}`}
            stroke="rgba(0,0,0,0.13)" strokeWidth="0.7" />
          <path d={`M${21 + r(11) * 3},${21 + r(12) * 2} L${27 + r(13) * 3},${30 + r(14) * 3}`}
            stroke="rgba(0,0,0,0.11)" strokeWidth="0.6" />
          <path d={`M${13 + r(15) * 3},${16 + r(16) * 3} L${18 + r(17) * 3},${12 + r(18) * 2}`}
            stroke="rgba(255,255,255,0.75)" strokeWidth="0.8" />
          <path d={`M${24 + r(19) * 3},${24 + r(20) * 3} L${29 + r(21) * 2},${23 + r(22) * 2}`}
            stroke="rgba(255,255,255,0.5)" strokeWidth="0.7" />
        </g>
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
          rotation: (r - 0.5) * 90,
          offsetX: (r2 - 0.5) * 26,
          /* Wrapped, not cumulative. `6 + idx * 2` climbed forever, so after a
             few dozen deletions the "pile" was a column of paper hovering a
             hundred pixels above the bin. It stays a heap now. */
          offsetY: 4 + (idx % 5) * 3 + r3 * 5,
          scale: 0.88 + r * 0.2,
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
        // Wrapped like the sync path above — `idx * 2` climbed forever and
        // turned the heap into a column hovering over the bin.
        offsetY: 4 + (idx % 5) * 3 + r3 * 5,
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

  /* What the bin can swallow before it starts spilling.
     Below this the corner stays clean: things you delete simply disappear into
     the mouth, which is the whole point of a bin. Past it, one crumpled ball
     appears per extra item (capped, so a hundred deletions don't build a tower)
     — the pile IS the "you should empty this" signal, so no badge is needed. */
  const BIN_CAPACITY = 9;
  const MAX_VISIBLE_BALLS = 10;
  const overflow = Math.max(0, pileCards.length - BIN_CAPACITY);
  const overflowCards = overflow > 0
    ? pileCards.slice(-Math.min(overflow, MAX_VISIBLE_BALLS))
    : [];

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
            className="trash-drawer fixed bottom-24 left-6 z-[9995] flex flex-col w-[340px] max-h-[420px] bg-[#FAF6F1]/95 dark:bg-[#191714]/95 backdrop-blur-xl border border-black/10 dark:border-white/10 rounded-2xl shadow-xl overflow-hidden pointer-events-auto"
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

      {/* The bin, sunk into the bottom-left corner.

          It used to wear a domed lid with a handle, which is the one part of a
          bin you can't throw anything through — so the animation had to flap it
          open on every delete, and at rest the corner was occupied by a big
          grey cap with a heap balanced on top of it.

          Now it's an open bin seen from just above the floor line: the lip and
          the dark mouth break the fold, everything else is below it. Deleted
          things fall straight in and are gone. Only when it's genuinely full
          (ten or more) does rubbish start piling out over the rim — which is
          the board telling you to empty it, without a number anywhere. */}
      <AnimatePresence>
        {isPileVisible && (
          <motion.div
            className="trash-bin fixed z-[9990] flex flex-col items-center pointer-events-auto"
            style={{ left: BIN_LEFT, bottom: -BIN_SUNK }}
            initial={{ opacity: 0, y: 34 }}
            animate={{ opacity: 1, y: 0 }}
            /* Hover pulls the whole bin up out of the floor so you can see what
               you're clicking — and so the click target isn't a 30px sliver. */
            whileHover={{ y: -BIN_SUNK - 4 }}
            exit={{ opacity: 0, y: 34 }}
            transition={{ type: 'spring', stiffness: 300, damping: 22 }}
          >
            {/* Overflow heap. Negative margin so the balls rest ON the lip
                rather than hovering above it. */}
            <motion.div
              className="relative w-16 h-10"
              style={{ scale: pileScale, marginBottom: -12 }}
            >
              <AnimatePresence>
                {overflowCards.map((card) => (
                  <PileItem key={card.id} card={card} justLanded={card.id === justLandedId} />
                ))}
              </AnimatePresence>
            </motion.div>

            <motion.button
              className="relative flex items-center justify-center"
              style={{
                width: BIN_SIZE,
                height: BIN_SIZE,
                filter: isTrashOpen ? 'drop-shadow(0 0 8px rgba(var(--accent-rgb),0.4))' : 'none',
              }}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.94 }}
              /* A soft thunk as something lands, from the bin itself — the lid
                 that used to carry this reaction no longer exists. */
              animate={{ scaleY: justLandedId ? [1, 0.93, 1.02, 1] : 1 }}
              transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => setIsTrashOpen(!isTrashOpen)}
              title="Deleted items — click to open"
              aria-label="Open deleted items"
            >
              <svg viewBox="0 0 72 72" className="w-full h-full drop-shadow-2xl" fill="none">
                <defs>
                  <linearGradient id="bin-body" x1="14" y1="14" x2="58" y2="72" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#6E7681" />
                    <stop offset="42%" stopColor="#495059" />
                    <stop offset="100%" stopColor="#2C3138" />
                  </linearGradient>
                  <linearGradient id="bin-rim" x1="10" y1="9" x2="62" y2="20" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#C2CAD4" />
                    <stop offset="55%" stopColor="#828B96" />
                    <stop offset="100%" stopColor="#525A65" />
                  </linearGradient>
                  {/* The hole. Darker at the far edge so it reads as depth. */}
                  <radialGradient id="bin-mouth" cx="50%" cy="86%" r="78%">
                    <stop offset="0%" stopColor="#1B1F25" />
                    <stop offset="70%" stopColor="#0B0E12" />
                    <stop offset="100%" stopColor="#05070A" />
                  </radialGradient>
                </defs>

                {/* Tapered barrel, hanging below the lip — a bin narrows to its
                    base. Most of this is under the fold at rest. */}
                <path
                  d="M10.5 14.6 L61.5 14.6 L54 70 Q53.6 72 51.6 72 L20.4 72 Q18.4 72 18 70 Z"
                  fill="url(#bin-body)"
                  stroke="rgba(0,0,0,0.35)"
                  strokeWidth="1"
                  strokeLinejoin="round"
                />

                {/* Ribs, following the taper. */}
                <g stroke="rgba(255,255,255,0.12)" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M26 26 L24 66" /><path d="M36 26 L36 66" /><path d="M46 26 L48 66" />
                </g>

                {/* The lip: an outer ellipse for the metal, an inner one for the
                    opening. This pair IS the "tip of the bin" you see. */}
                <ellipse cx="36" cy="14.6" rx="25.8" ry="7" fill="url(#bin-rim)" stroke="rgba(0,0,0,0.34)" strokeWidth="1" />
                <ellipse cx="36" cy="15.4" rx="22" ry="5.2" fill="url(#bin-mouth)" />
                {/* Front inner wall catching a little light, so the hole has a floor. */}
                <path d="M14.6 16.6 Q36 23.4 57.4 16.6 Q36 21.8 14.6 16.6 Z" fill="rgba(255,255,255,0.07)" />
                {/* Specular along the back-left of the lip. */}
                <path d="M15 11.6 Q24 7.6 36 7.6" stroke="rgba(255,255,255,0.5)" strokeWidth="1.7" strokeLinecap="round" fill="none" />
              </svg>
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
