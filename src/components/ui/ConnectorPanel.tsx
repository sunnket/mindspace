'use client';

import React, { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import {
  CAPS,
  DASHES,
  DEFAULT_VARIANT,
  INKS,
  SHAPES,
  VARIANTS,
  WEIGHTS,
  buildConnector,
  capGeom,
  dashArray,
  previewConnector,
  rectOf,
  resolveConnector,
  type CapGeom,
  type ConnectorCap,
  type ConnectorShape,
  type ConnectorStyle,
} from '@/lib/connectors';

/**
 * The connector options panel — everything about a link, on top of the screen.
 *
 * It has one surface and two jobs, which is the point:
 *
 *   · In connector mode with nothing selected it's the TOOL. Whatever you set
 *     here is what the next link you draw looks like, and the header tells you
 *     where you are in the two-tap gesture.
 *   · Click any link on the board and the same panel becomes an EDITOR for
 *     that one, in place, with its current settings already showing.
 *
 * Every swatch is drawn by the real geometry from `lib/connectors`, on two toy
 * cards — so a preview physically cannot disagree with what lands on the board,
 * including how the line attaches to the card edge.
 *
 * Spacing is inline throughout. Tailwind's `p-*` / `m-*` utilities are dead in
 * this project (an unlayered global reset wins), and a dead padding here would
 * clip the swatches against the panel's rounded corners.
 */

/* ---------- shared bits ---------- */

function CapMarks({ cap, weight, color }: { cap: CapGeom | null; weight: number; color: string }) {
  if (!cap) return null;
  if (cap.kind === 'dot') return <circle cx={cap.cx} cy={cap.cy} r={cap.r} fill={color} />;
  if (cap.kind === 'fill') return <path d={cap.d} fill={color} stroke="none" />;
  return <path d={cap.d} fill="none" stroke={color} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" />;
}

/** A miniature of the actual connector, cards and all. */
function ConnectorSwatch({ cfg, w = 52, h = 32, showCards = true }: { cfg: ConnectorStyle; w?: number; h?: number; showCards?: boolean }) {
  const { built, a, b, weight } = useMemo(() => previewConnector(cfg, w, h), [cfg, w, h]);
  const ink = 'currentColor';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible', display: 'block' }} aria-hidden="true">
      {/* The two cards are drawn in the chip's own colour, so the swatch shows
          the thing that matters most here: HOW the line meets a block. */}
      {showCards && [a, b].map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} rx={2.5}
          fill="currentColor" fillOpacity={0.12} stroke="currentColor" strokeOpacity={0.34} strokeWidth={0.9} />
      ))}
      <path d={built.d} fill="none" stroke={ink} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={dashArray({ ...cfg, weight })} />
      <CapMarks cap={capGeom(cfg.startCap, built.tipStart, built.startAngle + Math.PI, weight)} weight={weight} color={ink} />
      <CapMarks cap={capGeom(cfg.endCap, built.tipEnd, built.endAngle, weight)} weight={weight} color={ink} />
    </svg>
  );
}

/** A line with one cap on it — the picker swatch for an end. */
function CapSwatch({ cap, side, weight = 1.7 }: { cap: ConnectorCap; side: 'start' | 'end'; weight?: number }) {
  const w = 28;
  const h = 14;
  const a = rectOf({ x: side === 'start' ? -2 : w - 4, y: h / 2 - 5, width: 6, height: 10 });
  const b = rectOf({ x: side === 'start' ? w - 4 : -2, y: h / 2 - 5, width: 6, height: 10 });
  const cfg: ConnectorStyle = {
    shape: 'straight', variant: 'direct', rounded: false,
    startCap: side === 'start' ? cap : 'none',
    endCap: side === 'start' ? 'none' : cap,
    dash: 'solid', weight, color: null, flow: false, label: '',
  };
  // `a` is always the FROM box, so for a start cap the drawing runs right→left.
  const from = side === 'start' ? a : b;
  const to = side === 'start' ? b : a;
  const built = buildConnector(from, to, cfg);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible', display: 'block' }} aria-hidden="true">
      <path d={built.d} fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" />
      <CapMarks cap={capGeom(cfg.startCap, built.tipStart, built.startAngle + Math.PI, weight)} weight={weight} color="currentColor" />
      <CapMarks cap={capGeom(cfg.endCap, built.tipEnd, built.endAngle, weight)} weight={weight} color="currentColor" />
    </svg>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5" style={{ minHeight: 30 }}>
      <span
        className="shrink-0 text-[8.5px] uppercase font-extrabold tracking-[0.14em] text-[var(--text-tertiary)] select-none text-right"
        style={{ width: 40 }}
      >
        {label}
      </span>
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">{children}</div>
    </div>
  );
}

/** A pressed-in pill when active — the same affordance the toolbar uses. */
function Chip({
  active, onClick, title, children, padding = '5px 8px',
}: {
  active?: boolean; onClick: () => void; title: string; children: React.ReactNode; padding?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={!!active}
      className={`rounded-[10px] flex items-center justify-center gap-1 text-[10px] font-bold transition-all cursor-pointer border ${
        active
          ? 'text-[var(--accent)] border-[rgba(var(--accent-rgb),0.5)]'
          : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:border-[var(--border)]'
      }`}
      style={{ padding, background: active ? 'var(--accent-subtle)' : 'transparent' }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 3px' }} />;
}

/* ---------- the panel ---------- */

export default function ConnectorPanel() {
  const mode = useCanvasStore((s) => s.mode);
  const setMode = useCanvasStore((s) => s.setMode);
  const objects = useCanvasStore((s) => s.objects);
  const connections = useCanvasStore((s) => s.connections);
  const connectorSelectedIds = useCanvasStore((s) => s.connectorSelectedIds);
  const selectedConnectionId = useCanvasStore((s) => s.selectedConnectionId);
  const setSelectedConnectionId = useCanvasStore((s) => s.setSelectedConnectionId);
  const connectorStyle = useCanvasStore((s) => s.connectorStyle);
  const setConnectorStyle = useCanvasStore((s) => s.setConnectorStyle);
  const updateConnection = useCanvasStore((s) => s.updateConnection);
  const removeConnection = useCanvasStore((s) => s.removeConnection);

  const selected = useMemo(
    () => connections.find((c) => c.id === selectedConnectionId && !c.style?.thread) || null,
    [connections, selectedConnectionId],
  );
  const editing = !!selected;

  /* Escape closes whichever job the panel is doing: it lets go of the selected
     link first, and only then leaves the tool. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t?.isContentEditable || t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return;
      if (selectedConnectionId) {
        e.stopPropagation();
        setSelectedConnectionId(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selectedConnectionId, setSelectedConnectionId]);

  const visible = mode === 'connector' || editing;
  if (!visible) return null;

  const cfg: ConnectorStyle = editing
    ? resolveConnector(selected!.style, {
        workflow:
          !!selected!.style?.isWorkflowConnection ||
          (objects.find((o) => o.id === selected!.fromId)?.type === 'workflow-node' &&
            objects.find((o) => o.id === selected!.toId)?.type === 'workflow-node'),
      })
    : connectorStyle;

  const apply = (patch: Partial<ConnectorStyle>) => {
    if (editing) updateConnection(selected!.id, patch as Record<string, unknown>);
    else setConnectorStyle(patch);
  };

  const pickShape = (shape: ConnectorShape) => {
    // A subtype only means something inside its own shape, so switching shape
    // lands on that shape's own default rather than an orphaned variant key.
    const keep = VARIANTS[shape].some((v) => v.key === cfg.variant);
    apply({ shape, variant: keep ? cfg.variant : DEFAULT_VARIANT[shape] });
  };

  const nameOf = (id: string) => {
    const o = objects.find((ob) => ob.id === id);
    if (!o) return 'card';
    const first = (o.content || '').split('\n')[0].replace(/^[#>\-*\s]+/, '').trim();
    return (first || o.type).slice(0, 18);
  };

  /* What the header says. In tool mode it narrates the two-tap gesture, because
     a mode with no feedback is a mode you get stuck in. */
  const headline = editing
    ? `${nameOf(selected!.fromId)} → ${nameOf(selected!.toId)}`
    : connectorSelectedIds.length === 1
      ? `${nameOf(connectorSelectedIds[0])} → tap the card to link it to`
      : 'Tap a card, then the card it connects to';

  return (
    <motion.div
      className="connector-panel fixed left-1/2 z-[135] pointer-events-auto"
      style={{ top: 14, translateX: '-50%', maxWidth: '94vw' }}
      initial={{ opacity: 0, y: -14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -14, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 340, damping: 30 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Width is chosen so no row WRAPS. A wrapped options row reads as two
          unrelated groups and the eye has to re-find where a group starts, so
          the panel is sized to the widest row (the twelve end-swatches) rather
          than left to reflow. */}
      <div className="tool-panel flex flex-col gap-1.5" style={{ padding: 12, width: 700, maxWidth: '94vw' }}>
        {/* ---- header ---- */}
        <div className="flex items-center gap-2" style={{ paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
          <span
            className="shrink-0 rounded-[10px] flex items-center justify-center"
            style={{ width: 26, height: 26, background: 'var(--accent-subtle)', color: 'var(--accent)' }}
          >
            <ConnectorSwatch cfg={{ ...cfg, weight: 2.4 }} w={18} h={14} showCards={false} />
          </span>
          <span className="flex flex-col min-w-0 flex-1" style={{ gap: 1 }}>
            <span className="text-[10px] uppercase font-extrabold tracking-[0.16em] text-[var(--text-secondary)] leading-none">
              {editing ? 'Connector' : 'Connector tool'}
            </span>
            <span className="text-[11px] font-semibold text-[var(--text-primary)] truncate leading-tight">
              {headline}
            </span>
          </span>

          {editing && (
            <>
              <button
                type="button"
                onClick={() => apply({ startCap: cfg.endCap, endCap: cfg.startCap })}
                title="Flip the ends around"
                className="shrink-0 rounded-[10px] text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
                style={{ padding: '5px 8px', background: 'var(--well)' }}
              >
                Flip
              </button>
              <button
                type="button"
                onClick={() => {
                  const bag = { ...cfg } as unknown as Record<string, unknown>;
                  connections.forEach((c) => { if (!c.style?.thread) updateConnection(c.id, bag); });
                  setConnectorStyle(cfg);
                }}
                title="Give every link on this board the same look"
                className="shrink-0 rounded-[10px] text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
                style={{ padding: '5px 8px', background: 'var(--well)' }}
              >
                Apply to all
              </button>
              <button
                type="button"
                onClick={() => removeConnection(selected!.id)}
                title="Remove this link"
                aria-label="Remove this link"
                className="shrink-0 rounded-[10px] flex items-center justify-center text-[var(--text-tertiary)] hover:text-white hover:bg-red-500 transition-colors cursor-pointer"
                style={{ width: 26, height: 26, background: 'var(--well)' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                </svg>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              if (editing) setSelectedConnectionId(null);
              else setMode('select');
            }}
            title={editing ? 'Done' : 'Leave connector mode'}
            className="shrink-0 rounded-[10px] text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
            style={{ padding: '6px 10px', background: 'var(--well)' }}
          >
            {editing ? 'Done' : 'Exit'}
          </button>
        </div>

        {/* ---- shape + subtype ---- */}
        <Row label="Line">
          {SHAPES.map((s) => (
            <Chip
              key={s.key}
              active={cfg.shape === s.key}
              onClick={() => pickShape(s.key)}
              title={`${s.label} — ${s.hint}`}
              padding="3px 4px"
            >
              <ConnectorSwatch cfg={{ ...cfg, shape: s.key, variant: DEFAULT_VARIANT[s.key], label: '' }} w={44} h={26} />
            </Chip>
          ))}
          <Divider />
          {VARIANTS[cfg.shape].map((v) => (
            <Chip
              key={v.key}
              active={cfg.variant === v.key}
              onClick={() => apply({ variant: v.key })}
              title={`${v.label} ${SHAPES.find((s) => s.key === cfg.shape)?.label.toLowerCase()}`}
            >
              {v.label}
            </Chip>
          ))}
          {cfg.shape === 'elbow' && (
            <Chip
              active={cfg.rounded}
              onClick={() => apply({ rounded: !cfg.rounded })}
              title="Round the corners off"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 20v-8a8 8 0 0 1 8-8h8" />
              </svg>
              Round
            </Chip>
          )}
        </Row>

        {/* ---- the two ends ---- */}
        <Row label="Ends">
          <span className="text-[8.5px] uppercase font-extrabold tracking-[0.1em] text-[var(--text-muted)] select-none" style={{ paddingRight: 2 }}>
            from
          </span>
          {CAPS.map((c) => (
            <Chip
              key={`s-${c.key}`}
              active={cfg.startCap === c.key}
              onClick={() => apply({ startCap: c.key })}
              title={`${c.label} at the start`}
              padding="4px 2px"
            >
              <CapSwatch cap={c.key} side="start" />
            </Chip>
          ))}
          <Divider />
          <span className="text-[8.5px] uppercase font-extrabold tracking-[0.1em] text-[var(--text-muted)] select-none" style={{ paddingRight: 2 }}>
            to
          </span>
          {CAPS.map((c) => (
            <Chip
              key={`e-${c.key}`}
              active={cfg.endCap === c.key}
              onClick={() => apply({ endCap: c.key })}
              title={`${c.label} at the end`}
              padding="4px 2px"
            >
              <CapSwatch cap={c.key} side="end" />
            </Chip>
          ))}
        </Row>

        {/* ---- stroke ---- */}
        <Row label="Stroke">
          {DASHES.map((d) => (
            <Chip key={d.key} active={cfg.dash === d.key} onClick={() => apply({ dash: d.key })} title={d.label} padding="6px 6px">
              <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true">
                <line x1="1" y1="4" x2="25" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  strokeDasharray={d.key === 'dashed' ? '6 4' : d.key === 'dotted' ? '0.01 4.6' : undefined} />
              </svg>
            </Chip>
          ))}
          <Divider />
          {WEIGHTS.map((wt) => (
            <Chip key={wt.key} active={Math.abs(cfg.weight - wt.key) < 0.2} onClick={() => apply({ weight: wt.key })} title={wt.label} padding="6px 6px">
              <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">
                <line x1="1" y1="4" x2="21" y2="4" stroke="currentColor" strokeWidth={wt.key} strokeLinecap="round" />
              </svg>
            </Chip>
          ))}
          <Divider />
          <Chip active={cfg.flow} onClick={() => apply({ flow: !cfg.flow })} title="Animate the dashes along the line">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M3 12h4M10 12h4M17 12h4" />
            </svg>
            Flow
          </Chip>
          <Divider />
          {INKS.map((ink) => {
            const active = (cfg.color || null) === ink.key;
            return (
              <button
                key={ink.label}
                type="button"
                onClick={() => apply({ color: ink.key })}
                title={ink.label}
                aria-label={ink.label}
                className="rounded-full transition-transform hover:scale-110 cursor-pointer shrink-0"
                style={{
                  width: 18,
                  height: 18,
                  background: ink.css,
                  boxShadow: active
                    ? '0 0 0 2px var(--bg-primary), 0 0 0 3.5px var(--accent)'
                    : 'inset 0 0 0 1px rgba(0,0,0,0.18)',
                }}
              />
            );
          })}
        </Row>

        {/* ---- label ---- */}
        <Row label="Label">
          <input
            value={cfg.label}
            onChange={(e) => apply({ label: e.target.value.slice(0, 40) })}
            placeholder={editing ? 'Name this relationship — "blocks", "feeds", "then"…' : 'Label the next link (optional)'}
            className="rounded-[10px] text-[11px] font-semibold text-[var(--text-primary)] outline-none border border-transparent focus:border-[rgba(var(--accent-rgb),0.5)] transition-colors"
            style={{ padding: '6px 10px', background: 'var(--well)', width: 380 }}
          />
          {cfg.label && (
            <Chip active={false} onClick={() => apply({ label: '' })} title="Clear the label">
              Clear
            </Chip>
          )}
        </Row>
      </div>
    </motion.div>
  );
}
