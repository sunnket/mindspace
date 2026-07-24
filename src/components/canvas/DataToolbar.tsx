'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DataColumn,
  FilterOp,
  FilterRule,
  ViewState,
  viewIsActive,
} from '@/lib/dataTools';

/* ------------------------------------------------------------------
   The mini toolbar that appears on the top-left edge of a data block.

   Design rules it has to obey, because it sits on top of blocks that
   were already finished:
   - INVISIBLE AT REST. It fades in on hover of its host block and
     leaves nothing behind, so a board full of tables looks exactly
     the way it did before this existed.
   - Except when a tool is actually DOING something. A hidden sort or
     an active filter that you can't see is a trap, so any live tool
     keeps its dot lit and the bar stays faintly present.
   - It floats OUTSIDE the block's padding box, hugging the corner, so
     it costs the block no layout and can never reflow its contents.
   ------------------------------------------------------------------ */

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

function Icon({ children, size = 12 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const ICONS = {
  search: <><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.7" y2="16.7" /></>,
  sort: <><path d="M7 4v16" /><path d="M3.5 16.5 7 20l3.5-3.5" /><path d="M17 20V4" /><path d="M13.5 7.5 17 4l3.5 3.5" /></>,
  filter: <><path d="M3 5h18l-7 8v6l-4 2v-8Z" /></>,
  ai: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="M12 8.5 13.4 11l2.6 1-2.6 1L12 15.5 10.6 13 8 12l2.6-1Z" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  close: <><path d="M18 6 6 18M6 6l12 12" /></>,
  check: <><polyline points="20 6 9 17 4 12" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  spin: <><path d="M21 12a9 9 0 1 1-6.2-8.6" /></>,
};

type ToolId = 'search' | 'sort' | 'filter' | 'ai' | 'hide';

/** One small square button in the bar. */
function ToolButton({
  title, active, live, onClick, children,
}: {
  title: string; active: boolean; live: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={stop}
      onPointerDown={stop}
      onClick={(e) => { stop(e); onClick(); }}
      className="relative flex items-center justify-center rounded-[6px] transition-colors cursor-pointer"
      style={{
        width: 21, height: 21,
        background: active ? 'rgba(var(--accent-rgb),0.16)' : 'transparent',
        color: active ? 'var(--accent)' : live ? 'var(--accent)' : 'var(--text-tertiary)',
      }}
    >
      {children}
      {/* a live tool keeps a dot lit even with its popover shut */}
      {live && !active && (
        <span
          className="absolute rounded-full"
          style={{ width: 4, height: 4, right: 1.5, top: 1.5, background: 'var(--accent)' }}
        />
      )}
    </button>
  );
}

function Popover({ children, width = 232 }: { children: React.ReactNode; width?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -5, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -5, scale: 0.97 }}
      transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
      onMouseDown={stop}
      onPointerDown={stop}
      onClick={stop}
      onWheel={stop}
      className="absolute left-0 rounded-xl border border-[var(--border-strong)] shadow-[0_16px_36px_-14px_rgba(90,62,40,0.4)] dark:shadow-[0_16px_36px_-14px_rgba(0,0,0,0.7)]"
      style={{
        top: 26, width, zIndex: 60,
        background: 'var(--bg-secondary)',
        padding: 8,
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      {children}
    </motion.div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[var(--text-tertiary)]"
      style={{ padding: '2px 4px 5px' }}>
      {children}
    </div>
  );
}

/** A full-width row inside a popover. */
function Row({
  onClick, active = false, children, danger = false,
}: {
  onClick: () => void; active?: boolean; children: React.ReactNode; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={stop}
      onClick={(e) => { stop(e); onClick(); }}
      className="w-full flex items-center gap-2 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer text-left"
      style={{
        padding: '5px 7px',
        color: danger ? '#DC5A4B' : active ? 'var(--accent)' : 'var(--text-secondary)',
        background: active ? 'rgba(var(--accent-rgb),0.1)' : 'transparent',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.07)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}

export interface DataToolbarProps {
  columns: DataColumn[];
  view: ViewState;
  onView: (next: ViewState) => void;
  /** Runs the ✨ fill. Resolve when done; reject/throw to show the error. */
  onAiFill?: (mode: 'complete' | 'extend') => Promise<void>;
  /** Hide tools this block has no use for (a chart can't hide columns). */
  tools?: ToolId[];
  /** Extra note under the AI menu, e.g. "fills blank cells in 4 rows". */
  aiHint?: string;
}

const ALL_TOOLS: ToolId[] = ['search', 'sort', 'filter', 'ai', 'hide'];

export default function DataToolbar({
  columns, view, onView, onAiFill, tools = ALL_TOOLS, aiHint,
}: DataToolbarProps) {
  const [open, setOpen] = useState<ToolId | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Click anywhere else on the board and the popover goes away — it's a
  // transient tool, not a panel.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    // Deferred: the click that OPENED it must not immediately close it.
    const t = setTimeout(() => document.addEventListener('mousedown', away), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', away); };
  }, [open]);

  useEffect(() => {
    if (open === 'search') requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => setErr(null), 4000);
    return () => clearTimeout(t);
  }, [err]);

  const set = (patch: Partial<ViewState>) => onView({ ...view, ...patch });
  const active = viewIsActive(view);

  const runFill = async (mode: 'complete' | 'extend') => {
    if (!onAiFill || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onAiFill(mode);
      setOpen(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Fill failed.');
    } finally {
      setBusy(false);
    }
  };

  const has = (t: ToolId) => tools.includes(t);

  return (
    <div
      ref={rootRef}
      className="data-toolbar absolute flex items-center"
      style={{
        top: 6, left: 8, zIndex: 40,
        // At rest the bar is fully transparent and non-interactive; the host
        // block's :hover (see globals.css) fades it in. A live tool pins it on.
        opacity: active || open ? 1 : undefined,
        pointerEvents: 'auto',
      }}
      data-live={active || open ? 'on' : undefined}
      onMouseDown={stop}
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      <div
        className="flex items-center gap-0.5 rounded-[9px] border border-[var(--border)]"
        style={{
          padding: 2,
          background: 'color-mix(in srgb, var(--bg-secondary) 88%, transparent)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {has('search') && (
          <ToolButton title="Search rows" active={open === 'search'} live={view.search.trim() !== ''}
            onClick={() => setOpen(open === 'search' ? null : 'search')}>
            <Icon>{ICONS.search}</Icon>
          </ToolButton>
        )}
        {has('sort') && (
          <ToolButton title="Sort" active={open === 'sort'} live={!!view.sort}
            onClick={() => setOpen(open === 'sort' ? null : 'sort')}>
            <Icon>{ICONS.sort}</Icon>
          </ToolButton>
        )}
        {has('filter') && (
          <ToolButton title="Filter" active={open === 'filter'} live={view.filters.length > 0}
            onClick={() => setOpen(open === 'filter' ? null : 'filter')}>
            <Icon>{ICONS.filter}</Icon>
          </ToolButton>
        )}
        {has('ai') && onAiFill && (
          <ToolButton title="AI fill" active={open === 'ai'} live={busy}
            onClick={() => setOpen(open === 'ai' ? null : 'ai')}>
            <span style={{ display: 'flex', animation: busy ? 'dt-spin 0.9s linear infinite' : undefined }}>
              <Icon>{busy ? ICONS.spin : ICONS.ai}</Icon>
            </span>
          </ToolButton>
        )}
        {has('hide') && (
          <ToolButton title="Hide columns" active={open === 'hide'} live={view.hidden.length > 0}
            onClick={() => setOpen(open === 'hide' ? null : 'hide')}>
            <Icon>{ICONS.eye}</Icon>
          </ToolButton>
        )}
      </div>

      <style>{`@keyframes dt-spin { to { transform: rotate(360deg); } }`}</style>

      <AnimatePresence>
        {open === 'search' && (
          <Popover key="search" width={218}>
            <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border-strong)]"
              style={{ padding: '4px 7px' }}>
              <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}><Icon size={11}>{ICONS.search}</Icon></span>
              <input
                ref={searchRef}
                value={view.search}
                onChange={(e) => set({ search: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Escape') { set({ search: '' }); setOpen(null); } e.stopPropagation(); }}
                placeholder="Find in rows…"
                className="w-full min-w-0 bg-transparent outline-none text-[11.5px] font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
              {view.search && (
                <button onMouseDown={stop} onClick={(e) => { stop(e); set({ search: '' }); }}
                  className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer flex">
                  <Icon size={11}>{ICONS.close}</Icon>
                </button>
              )}
            </div>
          </Popover>
        )}

        {open === 'sort' && (
          <Popover key="sort">
            <Label>Sort by</Label>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {columns.map((c) => {
                const on = view.sort?.columnId === c.id;
                const dir = on ? view.sort!.dir : null;
                return (
                  <Row key={c.id} active={on}
                    onClick={() => set({
                      // Click cycles: ascending → descending → off. One control,
                      // no separate direction picker to hunt for.
                      sort: !on ? { columnId: c.id, dir: 'asc' }
                        : dir === 'asc' ? { columnId: c.id, dir: 'desc' }
                        : null,
                    })}>
                    <span className="flex-1 truncate">{c.name || 'Untitled'}</span>
                    {on && (
                      <span className="text-[9px] font-extrabold uppercase tracking-wider shrink-0">
                        {dir === 'asc' ? 'A→Z' : 'Z→A'}
                      </span>
                    )}
                  </Row>
                );
              })}
            </div>
            {view.sort && (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '5px 2px' }} />
                <Row onClick={() => set({ sort: null })} danger>
                  <Icon size={11}>{ICONS.close}</Icon> Clear sort
                </Row>
              </>
            )}
          </Popover>
        )}

        {open === 'filter' && (
          <FilterPanel columns={columns} view={view} set={set} />
        )}

        {open === 'ai' && onAiFill && (
          <Popover key="ai" width={244}>
            <Label>AI fill</Label>
            <Row onClick={() => runFill('complete')}>
              <Icon size={11}>{ICONS.check}</Icon>
              <span className="flex-1">Complete the blanks</span>
            </Row>
            <Row onClick={() => runFill('extend')}>
              <Icon size={11}>{ICONS.plus}</Icon>
              <span className="flex-1">Add more rows</span>
            </Row>
            {(aiHint || busy || err) && (
              <div className="text-[9.5px] font-semibold" style={{ padding: '5px 6px 1px', color: err ? '#DC5A4B' : 'var(--text-muted)', lineHeight: 1.4 }}>
                {err || (busy ? 'Thinking…' : aiHint)}
              </div>
            )}
          </Popover>
        )}

        {open === 'hide' && (
          <Popover key="hide">
            <Label>Show columns</Label>
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {columns.map((c) => {
                const shown = !view.hidden.includes(c.id);
                return (
                  <Row key={c.id} active={false}
                    onClick={() => set({
                      hidden: shown
                        // Never let the last column vanish — an empty grid has
                        // no affordance left to bring anything back.
                        ? (view.hidden.length >= columns.length - 1 ? view.hidden : [...view.hidden, c.id])
                        : view.hidden.filter((h) => h !== c.id),
                    })}>
                    <span
                      className="flex items-center justify-center rounded shrink-0"
                      style={{
                        width: 14, height: 14,
                        border: `1.5px solid ${shown ? 'var(--accent)' : 'var(--border-strong)'}`,
                        background: shown ? 'var(--accent)' : 'transparent',
                        color: '#fff',
                      }}
                    >
                      {shown && <Icon size={9}>{ICONS.check}</Icon>}
                    </span>
                    <span className="flex-1 truncate">{c.name || 'Untitled'}</span>
                  </Row>
                );
              })}
            </div>
          </Popover>
        )}
      </AnimatePresence>
    </div>
  );
}

/* --------------------------- filter panel --------------------------- */

const OPS: { id: FilterOp; label: string; needsValue: boolean; numeric?: boolean }[] = [
  { id: 'is', label: 'is', needsValue: true },
  { id: 'is-not', label: 'is not', needsValue: true },
  { id: 'contains', label: 'contains', needsValue: true },
  { id: 'gt', label: '>', needsValue: true, numeric: true },
  { id: 'lt', label: '<', needsValue: true, numeric: true },
  { id: 'not-empty', label: 'is not empty', needsValue: false },
  { id: 'empty', label: 'is empty', needsValue: false },
];

function FilterPanel({
  columns, view, set,
}: {
  columns: DataColumn[]; view: ViewState; set: (p: Partial<ViewState>) => void;
}) {
  const addFilter = () => {
    const c = columns[0];
    if (!c) return;
    set({ filters: [...view.filters, { columnId: c.id, op: 'is', value: '' }] });
  };
  const patch = (i: number, p: Partial<FilterRule>) =>
    set({ filters: view.filters.map((f, idx) => (idx === i ? { ...f, ...p } : f)) });
  const drop = (i: number) => set({ filters: view.filters.filter((_, idx) => idx !== i) });

  const selectCls =
    'bg-transparent outline-none text-[10.5px] font-bold text-[var(--text-primary)] cursor-pointer rounded border border-[var(--border)]';

  return (
    <Popover key="filter" width={268}>
      <Label>Filters</Label>
      {view.filters.length === 0 && (
        <div className="text-[10.5px] font-semibold text-[var(--text-muted)]" style={{ padding: '2px 6px 7px' }}>
          Nothing filtered — every row is showing.
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {view.filters.map((f, i) => {
          const col = columns.find((c) => c.id === f.columnId) || columns[0];
          const opDef = OPS.find((o) => o.id === f.op);
          return (
            <div key={i} className="flex items-center gap-1">
              <select value={f.columnId} onMouseDown={stop}
                onChange={(e) => patch(i, { columnId: e.target.value, value: '' })}
                className={selectCls} style={{ padding: '3px 2px', maxWidth: 86 }}>
                {columns.map((c) => <option key={c.id} value={c.id}>{c.name || 'Untitled'}</option>)}
              </select>
              <select value={f.op} onMouseDown={stop}
                onChange={(e) => patch(i, { op: e.target.value as FilterOp })}
                className={selectCls} style={{ padding: '3px 2px' }}>
                {OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              {opDef?.needsValue && (
                col?.options?.length ? (
                  <select value={f.value} onMouseDown={stop}
                    onChange={(e) => patch(i, { value: e.target.value })}
                    className={selectCls} style={{ padding: '3px 2px', flex: 1, minWidth: 0 }}>
                    <option value="">—</option>
                    {col.options.map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
                  </select>
                ) : (
                  <input value={f.value} onMouseDown={stop} onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => patch(i, { value: e.target.value })}
                    placeholder="value"
                    className="min-w-0 flex-1 bg-transparent outline-none text-[10.5px] font-semibold text-[var(--text-primary)] rounded border border-[var(--border)] placeholder:text-[var(--text-muted)]"
                    style={{ padding: '3px 5px' }} />
                )
              )}
              <button onMouseDown={stop} onClick={(e) => { stop(e); drop(i); }}
                title="Remove filter"
                className="shrink-0 text-[var(--text-muted)] hover:text-red-500 cursor-pointer flex">
                <Icon size={11}>{ICONS.close}</Icon>
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ height: 1, background: 'var(--border)', margin: '7px 2px 5px' }} />
      <Row onClick={addFilter}>
        <Icon size={11}>{ICONS.plus}</Icon> Add a filter
      </Row>
      {view.filters.length > 0 && (
        <Row onClick={() => set({ filters: [] })} danger>
          <Icon size={11}>{ICONS.close}</Icon> Clear all
        </Row>
      )}
    </Popover>
  );
}
