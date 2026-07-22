'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { useFrameAgentStore } from '@/store/frameAgentStore';
import { CanvasObjectData } from '@/lib/db';
import RichText from './RichText';
import {
  FRAME_KINDS, FrameKind, frameKindMeta, getFrameKind,
  objectsInFrame, strokesInFrame, frameRect, rectToScreen,
} from '@/lib/frames';

/**
 * The control surface for a selected frame.
 *
 * Deliberately rendered in SCREEN space rather than inside the canvas
 * transform: a control strip that scales with zoom becomes unreadable at 30%
 * and absurd at 300%, and this one has to hold a text input. It anchors itself
 * to the frame's projected rectangle and re-derives that every time the camera
 * moves, so it tracks the frame while staying crisp.
 *
 * Inline padding/margins throughout — the app's unlayered global reset kills
 * Tailwind's p-/m- utilities (gap-* and inline styles still work).
 */

const spring = { type: 'spring' as const, stiffness: 340, damping: 30 };
const PANEL_W = { normal: 320, delete: 336, scene: 336, agent: 400 } as const;
const GAP = 14;

export default function FrameHUD() {
  const selectedId = useCanvasStore((s) => s.selectedId);
  const objects = useCanvasStore((s) => s.objects);
  const isTouring = useCanvasStore((s) => s.isTouring);

  const frame = useMemo(
    () => objects.find((o) => o.id === selectedId && o.type === 'frame') || null,
    [objects, selectedId],
  );

  /* Deliberately visible while the title is being typed. A new frame is born in
     rename mode, and hiding the HUD until then meant the only way to dismiss the
     caret — clicking the canvas — also deselected the frame, so its controls
     vanished before they were ever seen. The tab sits above the frame and the
     HUD below it, so nothing overlaps. */
  if (!frame || isTouring) return null;
  return <FrameHUDBody frame={frame} />;
}

function FrameHUDBody({ frame }: { frame: CanvasObjectData }) {
  const camera = useCanvasStore((s) => s.camera);
  const objects = useCanvasStore((s) => s.objects);
  const strokes = useCanvasStore((s) => s.strokes);
  const updateObject = useCanvasStore((s) => s.updateObject);

  const kind = getFrameKind(frame);
  const meta = frameKindMeta(kind);
  const width = PANEL_W[kind];

  const contained = useMemo(() => objectsInFrame(objects, frame), [objects, frame]);
  const containedStrokes = useMemo(() => strokesInFrame(strokes, frame), [strokes, frame]);

  /* Anchor below the frame, flipping above when there's no room, and always
     clamped inside the viewport so a frame dragged off-screen keeps its HUD. */
  const [vp, setVp] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const sync = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const screen = rectToScreen(frameRect(frame), camera);
  const estHeight = kind === 'agent' ? 340 : kind === 'normal' ? 120 : 190;
  const below = screen.y + screen.height + GAP;
  const flip = below + estHeight > vp.h - 90;
  const top = flip
    ? Math.max(12, screen.y - estHeight - GAP)
    : Math.min(below, vp.h - estHeight - 90);
  const left = Math.max(12, Math.min(screen.x, vp.w - width - 12));

  const setKind = (next: FrameKind) => {
    updateObject(frame.id, { style: { ...(frame.style || {}), frameKind: next === 'normal' ? undefined : next } });
  };

  return (
    <>
      {/* A delete frame shows its blast radius the whole time it's selected —
          you should never have to guess what "delete everything inside" means. */}
      {kind === 'delete' && (
        <DoomedOverlay objects={contained} camera={camera} color={meta.color} />
      )}

      <motion.div
        key={frame.id}
        initial={{ opacity: 0, y: flip ? 8 : -8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={spring}
        className="fixed z-[135] pointer-events-auto flow-hideable clay-card rounded-[20px] flex flex-col gap-2.5"
        style={{ left, top, width, padding: 12, fontFamily: "'Outfit', sans-serif" }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Kind picker */}
        <div className="flex items-center gap-1">
          {FRAME_KINDS.map((k) => {
            const active = k.id === kind;
            return (
              <button
                key={k.id}
                onClick={() => setKind(k.id)}
                title={k.blurb}
                aria-pressed={active}
                className="flex-1 rounded-lg text-[10px] font-extrabold transition-all duration-150 cursor-pointer active:scale-95 whitespace-nowrap"
                style={{
                  padding: '6px 4px',
                  background: active ? k.color : 'var(--well)',
                  color: active ? '#fff' : 'var(--text-secondary)',
                  boxShadow: active ? `0 6px 14px -8px ${k.color}` : 'inset 0 1px 2px rgba(90,62,40,0.06)',
                }}
              >
                {k.label}
              </button>
            );
          })}
        </div>

        <p className="text-[10px] leading-snug text-[var(--text-tertiary)]">{meta.blurb}</p>

        {kind === 'delete' && (
          <DeleteZone frame={frame} objectCount={contained.length} strokeCount={containedStrokes.length} color={meta.color} />
        )}
        {kind === 'scene' && <SceneZone frame={frame} color={meta.color} />}
        {kind === 'agent' && <AgentZone frame={frame} contained={contained} color={meta.color} />}
      </motion.div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 *  Delete frame
 * ------------------------------------------------------------------ */

function DoomedOverlay({
  objects, camera, color,
}: { objects: CanvasObjectData[]; camera: { x: number; y: number; zoom: number }; color: string }) {
  return (
    <div className="fixed inset-0 z-[118] pointer-events-none">
      {objects.map((o) => {
        const r = rectToScreen({ x: o.x, y: o.y, width: o.width, height: o.height }, camera);
        return (
          <div
            key={o.id}
            className="absolute rounded-lg"
            style={{
              left: r.x, top: r.y, width: r.width, height: r.height,
              border: `2px solid ${color}`,
              background: `${color}1F`,
            }}
          />
        );
      })}
    </div>
  );
}

function DeleteZone({
  frame, objectCount, strokeCount, color,
}: { frame: CanvasObjectData; objectCount: number; strokeCount: number; color: string }) {
  const deleteRegion = useCanvasStore((s) => s.deleteRegion);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);
  const [keepFrame, setKeepFrame] = useState(false);
  const [swept, setSwept] = useState<number | null>(null);

  const total = objectCount + strokeCount;

  /* Arming records WHICH capture was confirmed, not just "armed: true".
     Resizing the frame changes what's caught, so the old confirmation is stale
     and must not carry over onto a different set of blocks — comparing the
     signature invalidates it without an effect. */
  const capture = `${objectCount}:${strokeCount}`;
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const armed = armedFor === capture;

  // Disarm on its own — a primed delete button left sitting there is a trap.
  useEffect(() => {
    if (!armedFor) return;
    const t = setTimeout(() => setArmedFor(null), 4000);
    return () => clearTimeout(t);
  }, [armedFor]);

  const run = () => {
    if (total === 0) return;
    if (!armed) { setArmedFor(capture); return; }
    const n = deleteRegion(frame.id, { keepFrame });
    setSwept(n);
    setArmedFor(null);
    if (!keepFrame) setSelectedId(null);
    setTimeout(() => setSwept(null), 2600);
  };

  if (swept !== null) {
    return (
      <div className="rounded-xl text-[11px] font-bold text-center" style={{ padding: 10, background: 'var(--well)', color: 'var(--text-secondary)' }}>
        Swept {swept} item{swept === 1 ? '' : 's'} · <span style={{ color: 'var(--accent)' }}>Ctrl+Z</span> puts it all back
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl flex items-center justify-between" style={{ padding: '8px 10px', background: 'var(--well)' }}>
        <span className="text-[11px] font-bold text-[var(--text-primary)]">
          {objectCount} block{objectCount === 1 ? '' : 's'}
          {strokeCount > 0 && ` · ${strokeCount} stroke${strokeCount === 1 ? '' : 's'}`}
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">captured</span>
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none" style={{ paddingLeft: 2 }}>
        <input
          type="checkbox"
          checked={keepFrame}
          onChange={(e) => setKeepFrame(e.target.checked)}
          className="cursor-pointer"
          style={{ accentColor: color, width: 13, height: 13 }}
        />
        <span className="text-[10px] font-semibold text-[var(--text-secondary)]">Keep the frame afterwards</span>
      </label>

      <button
        onClick={run}
        disabled={total === 0}
        className="w-full rounded-full text-[11px] font-extrabold text-white transition-all duration-150 cursor-pointer active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          padding: '9px 12px',
          background: armed ? '#B02A2A' : color,
          boxShadow: armed ? `0 0 0 3px ${color}44` : `0 8px 18px -8px ${color}`,
        }}
      >
        {total === 0
          ? 'Nothing inside this frame yet'
          : armed
            ? `Click again to delete ${total} item${total === 1 ? '' : 's'}`
            : `Delete everything inside (${total})`}
      </button>

      <p className="text-[9px] leading-snug text-[var(--text-tertiary)] text-center">
        Drag the frame&apos;s handles to change what gets caught.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Scene frame
 * ------------------------------------------------------------------ */

function SceneZone({ frame, color }: { frame: CanvasObjectData; color: string }) {
  const scenes = useCanvasStore((s) => s.scenes);
  const addSceneFromFrame = useCanvasStore((s) => s.addSceneFromFrame);
  const syncSceneFrames = useCanvasStore((s) => s.syncSceneFrames);
  const removeScene = useCanvasStore((s) => s.removeScene);
  const objects = useCanvasStore((s) => s.objects);

  const ordered = [...scenes].sort((a, b) => a.order - b.order);
  const linked = ordered.find((s) => s.frameId === frame.id);
  const index = linked ? ordered.indexOf(linked) + 1 : 0;

  const otherFrames = objects.filter(
    (o) => o.type === 'frame' && o.parentId === frame.parentId && o.style?.frameKind === 'scene',
  ).length;

  return (
    <div className="flex flex-col gap-2">
      {linked ? (
        <>
          <div className="rounded-xl flex items-center justify-between" style={{ padding: '8px 10px', background: 'var(--well)' }}>
            <span className="text-[11px] font-bold text-[var(--text-primary)] truncate" style={{ maxWidth: 200 }}>
              Slide {index} · {linked.name}
            </span>
            <button
              onClick={() => removeScene(linked.id)}
              title="Remove this slide"
              className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] hover:text-red-500 transition-colors cursor-pointer shrink-0"
            >
              Remove
            </button>
          </div>
          <p className="text-[9px] leading-snug text-[var(--text-tertiary)]">
            Renaming or resizing this frame updates the slide automatically.
          </p>
        </>
      ) : (
        <button
          onClick={() => addSceneFromFrame(frame.id)}
          className="w-full rounded-full text-[11px] font-extrabold text-white transition-all duration-150 cursor-pointer active:scale-[0.98]"
          style={{ padding: '9px 12px', background: color, boxShadow: `0 8px 18px -8px ${color}` }}
        >
          Add this region as a slide
        </button>
      )}

      {otherFrames > 1 && (
        <button
          onClick={() => syncSceneFrames()}
          className="w-full rounded-full text-[10px] font-bold transition-all duration-150 cursor-pointer active:scale-[0.98] bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          style={{ padding: '7px 12px' }}
        >
          Sync all {otherFrames} scene frames into the tour
        </button>
      )}

      {ordered.length > 0 && (
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('play-scene-tour'))}
          className="w-full rounded-full text-[10px] font-bold transition-all duration-150 cursor-pointer active:scale-[0.98] flex items-center justify-center gap-1.5 bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--accent)]"
          style={{ padding: '7px 12px' }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>
          Play tour ({ordered.length})
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Agent frame
 * ------------------------------------------------------------------ */

const AGENT_SUGGESTIONS = [
  'Summarise everything in here',
  'Turn this into a schedule',
  'What am I missing?',
  'Organise these neatly',
];

function AgentZone({
  frame, contained, color,
}: { frame: CanvasObjectData; contained: CanvasObjectData[]; color: string }) {
  const session = useFrameAgentStore((s) => s.sessions[frame.id]);
  const setDraft = useFrameAgentStore((s) => s.setDraft);
  const ask = useFrameAgentStore((s) => s.ask);
  const stop = useFrameAgentStore((s) => s.stop);
  const reset = useFrameAgentStore((s) => s.reset);

  const draft = session?.draft ?? '';
  // Memoised: a fresh `[]` fallback each render would re-fire the scroll effect
  // (and, through it, re-render) on every keystroke.
  const turns = useMemo(() => session?.turns ?? [], [session?.turns]);
  const status = session?.status ?? 'idle';
  const busy = status === 'reading' || status === 'looking' || status === 'thinking';

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const imageCount = contained.filter((o) => o.type === 'image').length;

  const statusLabel =
    status === 'reading' ? `Reading ${contained.length} block${contained.length === 1 ? '' : 's'}…`
    : status === 'looking' ? `Looking at ${session?.visionDone ?? 0}/${session?.visionTotal ?? 0} image${(session?.visionTotal ?? 0) === 1 ? '' : 's'}…`
    : status === 'thinking' ? 'Thinking…'
    : '';

  const submit = () => {
    if (!draft.trim() || busy) return;
    void ask(frame.id, draft);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* What the agent is about to read — sets the expectation that it sees everything. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Chip>{contained.length} block{contained.length === 1 ? '' : 's'}</Chip>
        {imageCount > 0 && <Chip>{imageCount} image{imageCount === 1 ? '' : 's'} · reads them</Chip>}
        {turns.length > 0 && (
          <button
            onClick={() => reset(frame.id)}
            className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            style={{ marginLeft: 'auto' }}
          >
            Clear
          </button>
        )}
      </div>

      {turns.length > 0 && (
        <div
          ref={scrollRef}
          className="flex flex-col gap-2 overflow-y-auto custom-scrollbar clay-inset rounded-xl"
          style={{ maxHeight: 260, padding: 10 }}
        >
          {turns.map((t, i) => (
            <div key={i} className="flex flex-col gap-1">
              {t.role === 'user' ? (
                <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color }}>You</span>
              ) : (
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">Agent</span>
              )}
              {t.role === 'user' ? (
                <p className="text-[12px] leading-relaxed text-[var(--text-primary)]">{t.content}</p>
              ) : t.content ? (
                <div className="agent-md text-[var(--text-primary)]" style={{ fontSize: 12, lineHeight: 1.6 }}>
                  <RichText content={t.content} />
                </div>
              ) : (
                <span className="text-[11px] text-[var(--text-tertiary)]">{statusLabel || 'Working…'}</span>
              )}
              {t.built && (
                <span className="text-[9px] font-bold" style={{ color }}>✎ Updating the canvas…</span>
              )}
            </div>
          ))}
        </div>
      )}

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-1">
          {AGENT_SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => { setDraft(frame.id, s); void ask(frame.id, s); }}
              className="rounded-full text-[9.5px] font-semibold bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              style={{ padding: '5px 9px' }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(frame.id, e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="Ask anything about what's inside this frame…"
          className="flex-1 min-w-0 resize-none clay-inset rounded-xl outline-none text-[12px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] custom-scrollbar"
          style={{ padding: 9, fontFamily: "'Outfit', sans-serif" }}
        />
        <button
          onClick={busy ? stop : submit}
          disabled={!busy && !draft.trim()}
          title={busy ? 'Stop' : 'Ask (Enter)'}
          aria-label={busy ? 'Stop' : 'Ask'}
          className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-white transition-all duration-150 cursor-pointer active:scale-95 disabled:opacity-35 disabled:cursor-not-allowed"
          style={{ background: color, boxShadow: `0 8px 18px -8px ${color}` }}
        >
          {busy ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
          )}
        </button>
      </div>

      <AnimatePresence>
        {busy && statusLabel && (
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="text-[9.5px] font-semibold text-center" style={{ color }}
          >
            {statusLabel}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded-full text-[9px] font-bold text-[var(--text-secondary)] bg-[var(--well)] whitespace-nowrap"
      style={{ padding: '3px 7px' }}
    >
      {children}
    </span>
  );
}
