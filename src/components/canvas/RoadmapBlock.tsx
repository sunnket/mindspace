'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import DataToolbar from './DataToolbar';
import { useDataView, requestAiFill } from '@/lib/useDataView';
import {
  ColumnKind,
  DataColumn,
  DataRow,
  applyView,
  initials,
  makeRowId,
  newRoadmapColumns,
  newRoadmapRows,
  personColor,
  PILL_COLORS,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
} from '@/lib/dataTools';

/* ------------------------------------------------------------------
   ROADMAP — a real database view on the canvas.

   Rows of typed cells: text, single-select pills, people, numbers,
   dates, checkboxes. Every cell edits where it sits — click a status
   and pick from a menu, click a number and type. The sort / search /
   filter / hide / AI-fill tools ride in the top-left corner and only
   appear when you're over the block.

   The one structural rule that matters: a sorted or filtered view is a
   LENS, never a reordering of the stored rows. Everything the grid
   renders carries the index it came from, and every edit writes back
   through that index — otherwise sorting a board and then typing lands
   your text in whatever row happens to be in that visual position.
   ------------------------------------------------------------------ */

const TINT = '#5B6BD6';
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

const ROW_NUM_W = 30;
const ADD_COL_W = 30;

function Icon({ children, size = 11 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const KIND_ICON: Record<ColumnKind, React.ReactNode> = {
  text: <><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="16" y2="12" /><line x1="4" y1="17" x2="12" y2="17" /></>,
  number: <><path d="M9 4 7 20M17 4l-2 16M4.5 9h15M3.5 15h15" /></>,
  select: <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.5 11 15l4.5-5" /></>,
  person: <><circle cx="12" cy="8" r="3.6" /><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" /></>,
  date: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><line x1="3.5" y1="10" x2="20.5" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" /></>,
  check: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8.5 12.5 11 15l4.5-5" /></>,
};

const KIND_LABEL: Record<ColumnKind, string> = {
  text: 'Text', number: 'Number', select: 'Select',
  person: 'Person', date: 'Date', check: 'Checkbox',
};

export default function RoadmapBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const { view, setView } = useDataView(obj);
  const rootRef = useRef<HTMLDivElement>(null);

  const title = (obj.style?.roadmapTitle as string) || '';

  const columns = useMemo<DataColumn[]>(() => {
    const raw = obj.style?.roadmapCols;
    return Array.isArray(raw) && raw.length ? (raw as DataColumn[]) : newRoadmapColumns();
  }, [obj.style]);

  const rows = useMemo<DataRow[]>(() => {
    const raw = obj.style?.roadmapRows;
    if (!Array.isArray(raw)) return newRoadmapRows();
    return (raw as DataRow[]).map((r, i) => ({
      id: typeof r?.id === 'string' ? r.id : `r${i}`,
      cells: (r?.cells && typeof r.cells === 'object') ? r.cells : {},
    }));
  }, [obj.style]);

  const patch = (kv: Record<string, unknown>) =>
    updateObject(obj.id, { style: { ...obj.style, ...kv } });

  /* --------------------------- mutations --------------------------- */

  const setCell = (rowIndex: number, colId: string, value: string) =>
    patch({
      roadmapRows: rows.map((r, i) =>
        i === rowIndex ? { ...r, cells: { ...r.cells, [colId]: value } } : r
      ),
    });

  const addRow = () => {
    const blank: DataRow = { id: makeRowId(), cells: {} };
    // A new row inherits the defaults of every select column, so it lands
    // looking like a task rather than a row of empty grey holes.
    for (const c of columns) {
      if (c.kind === 'select' && c.options?.length) blank.cells[c.id] = c.options[0].label;
    }
    patch({ roadmapRows: [...rows, blank] });
    requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector<HTMLInputElement>(`[data-cell="${rows.length}:${columns[0]?.id}"]`);
      el?.focus();
    });
  };

  const removeRow = (rowIndex: number) =>
    patch({ roadmapRows: rows.filter((_, i) => i !== rowIndex) });

  const addColumn = () => {
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    patch({ roadmapCols: [...columns, { id, name: '', kind: 'text' as ColumnKind, width: 150 }] });
  };

  const patchColumn = (colId: string, p: Partial<DataColumn>) =>
    patch({ roadmapCols: columns.map((c) => (c.id === colId ? { ...c, ...p } : c)) });

  const removeColumn = (colId: string) => {
    if (columns.length <= 1) return;
    patch({
      roadmapCols: columns.filter((c) => c.id !== colId),
      roadmapRows: rows.map((r) => {
        const cells = { ...r.cells };
        delete cells[colId];
        return { ...r, cells };
      }),
    });
  };

  /** Switching a column's type re-homes its options so pills keep working. */
  const setColumnKind = (colId: string, kind: ColumnKind) => {
    const col = columns.find((c) => c.id === colId);
    if (!col) return;
    let options = col.options;
    if (kind === 'select' && !options?.length) {
      // Seed from the column's own existing values so nothing is lost.
      const seen = Array.from(new Set(rows.map((r) => (r.cells[colId] || '').trim()).filter(Boolean)));
      const ramp = Object.values(PILL_COLORS);
      options = seen.length
        ? seen.slice(0, 12).map((label, i) => ({ label, color: ramp[i % ramp.length] }))
        : STATUS_OPTIONS;
    }
    patchColumn(colId, { kind, options });
  };

  /* ---------------------------- AI fill ---------------------------- */

  const visibleCols = columns.filter((c) => !view.hidden.includes(c.id));
  const blankCount = rows.reduce(
    (n, r) => n + (columns.some((c) => !(r.cells[c.id] || '').trim()) ? 1 : 0), 0
  );

  const aiFill = async (mode: 'complete' | 'extend') => {
    const subject = title.trim() || 'a product roadmap / task board';
    if (mode === 'complete') {
      const filled = await requestAiFill({ mode, subject, columns, rows });
      patch({
        roadmapRows: rows.map((r, i) => {
          const add = filled[i];
          if (!add) return r;
          const cells = { ...r.cells };
          for (const [k, v] of Object.entries(add)) {
            // Only ever fill a BLANK. The user's own words are untouchable.
            if (!(cells[k] || '').trim()) cells[k] = v;
          }
          return { ...r, cells };
        }),
      });
    } else {
      const made = await requestAiFill({ mode, subject, columns, rows, count: 5 });
      if (!made.length) throw new Error('The model returned nothing to add.');
      patch({
        roadmapRows: [...rows, ...made.map((cells) => ({ id: makeRowId(), cells }))],
      });
    }
  };

  /* ----------------------------- render ---------------------------- */

  const visible = useMemo(() => applyView(rows, columns, view), [rows, columns, view]);
  const template = `${ROW_NUM_W}px ${visibleCols.map((c) => `${c.width || 150}px`).join(' ')} ${ADD_COL_W}px`;
  const gridMinW = ROW_NUM_W + visibleCols.reduce((w, c) => w + (c.width || 150), 0) + ADD_COL_W;
  const hiddenCount = rows.length - visible.length;

  return (
    <div
      className="relative flex flex-col h-full w-full rounded-2xl pointer-events-auto has-data-toolbar bg-[#FFFDFA] dark:bg-[var(--bg-secondary)] border border-[rgba(var(--accent-rgb),0.16)] dark:border-white/10 shadow-[inset_0_1.5px_0_rgba(255,255,255,0.95),0_14px_28px_-14px_rgba(90,62,40,0.22),0_3px_8px_-4px_rgba(90,62,40,0.08)] dark:shadow-[0_14px_28px_-14px_rgba(0,0,0,0.6),0_3px_8px_-4px_rgba(0,0,0,0.5)]"
      style={{ color: 'var(--text-primary)', fontFamily: "'Outfit', sans-serif", padding: '12px 14px' }}
    >
      <DataToolbar
        columns={columns}
        view={view}
        onView={setView}
        onAiFill={aiFill}
        aiHint={blankCount > 0 ? `${blankCount} row${blankCount === 1 ? '' : 's'} still have blanks.` : 'Every row is filled in.'}
      />

      {/* header: type label (fades out for the tools) + live counts */}
      <div className="block-head flex items-center justify-between shrink-0" style={{ marginBottom: 8 }}>
        <div className="block-head-id flex items-center gap-1.5 min-w-0">
          <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
            style={{ background: `${TINT}1E`, color: TINT }}>
            <Icon><path d="M4 6h7M4 12h13M4 18h9" /><circle cx="19" cy="6" r="1.6" /><circle cx="20" cy="18" r="1.6" /></Icon>
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)] truncate">
            roadmap
          </span>
        </div>
        <span className="rounded-full text-[9px] font-extrabold uppercase tracking-wider shrink-0 tabular-nums"
          style={{ background: `${TINT}1A`, color: TINT, padding: '2.5px 8px' }}>
          {hiddenCount > 0 ? `${visible.length} of ${rows.length}` : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <input
        type="text"
        value={title}
        placeholder="Roadmap title…"
        onChange={(e) => patch({ roadmapTitle: e.target.value })}
        onMouseDown={stop} onPointerDown={stop} onClick={stop}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-full min-w-0 bg-transparent outline-none border-b border-transparent hover:border-[var(--border-strong)] focus:border-[var(--accent)] transition-colors cursor-text text-[12.5px] font-bold placeholder:text-[var(--text-muted)]"
      />

      <div
        ref={rootRef}
        className="flex-1 min-h-0 overflow-auto custom-scrollbar rounded-xl border border-[var(--border)] bg-[#FCF8F3] dark:bg-black/20"
        style={{ marginTop: 8 }}
        onWheel={stop}
        onPointerDown={stop}
        onMouseDown={stop}
      >
        <div style={{ minWidth: gridMinW }}>
          {/* ---------------- header row ---------------- */}
          <div
            className="sticky top-0 z-20 grid bg-[#F5EFE7] dark:bg-[#26221E] border-b border-[var(--border-strong)]"
            style={{ gridTemplateColumns: template }}
          >
            <div className="flex items-center justify-center border-r border-[var(--border)]">
              <span className="text-[9px] font-extrabold text-[var(--text-muted)]">#</span>
            </div>
            {visibleCols.map((col) => (
              <HeaderCell
                key={col.id}
                col={col}
                sorted={view.sort?.columnId === col.id ? view.sort.dir : null}
                onSort={() =>
                  setView({
                    ...view,
                    sort: view.sort?.columnId !== col.id ? { columnId: col.id, dir: 'asc' }
                      : view.sort.dir === 'asc' ? { columnId: col.id, dir: 'desc' }
                      : null,
                  })
                }
                onRename={(name) => patchColumn(col.id, { name })}
                onKind={(k) => setColumnKind(col.id, k)}
                onHide={() => setView({ ...view, hidden: [...view.hidden, col.id] })}
                onRemove={columns.length > 1 ? () => removeColumn(col.id) : undefined}
                onWidth={(w) => patchColumn(col.id, { width: w })}
              />
            ))}
            <button
              onClick={(e) => { stop(e); addColumn(); }}
              onMouseDown={stop} onPointerDown={stop}
              title="Add a column"
              aria-label="Add a column"
              className="flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors cursor-pointer"
            >
              <Icon size={11}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>
            </button>
          </div>

          {/* ---------------- body ---------------- */}
          {visible.map(({ row, index }, n) => (
            <div
              key={row.id}
              className="group/rw grid border-b border-[var(--border)] last:border-b-0 transition-colors"
              style={{ gridTemplateColumns: template }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(91,107,214,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div className="relative flex items-center justify-center border-r border-[var(--border)]">
                <span className="text-[9.5px] font-bold text-[var(--text-muted)] tabular-nums group-hover/rw:opacity-0 transition-opacity">
                  {n + 1}
                </span>
                <button
                  onClick={(e) => { stop(e); removeRow(index); }}
                  onMouseDown={stop} onPointerDown={stop}
                  title="Delete row"
                  aria-label="Delete row"
                  className="absolute inset-0 items-center justify-center text-[var(--text-muted)] hover:text-red-500 hidden group-hover/rw:flex cursor-pointer"
                >
                  <Icon size={10}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Icon>
                </button>
              </div>
              {visibleCols.map((col) => (
                <Cell
                  key={col.id}
                  col={col}
                  value={row.cells[col.id] ?? ''}
                  rowIndex={index}
                  onChange={(v) => setCell(index, col.id, v)}
                  onAddOption={(label, color) =>
                    patchColumn(col.id, { options: [...(col.options || []), { label, color }] })
                  }
                />
              ))}
              <div />
            </div>
          ))}

          {visible.length === 0 && (
            <div className="flex items-center justify-center text-[11px] font-semibold text-[var(--text-muted)]"
              style={{ padding: '22px 10px' }}>
              {rows.length === 0 ? 'No rows yet — add one below.' : 'Nothing matches the current search or filters.'}
            </div>
          )}
        </div>
      </div>

      {/* ---------------- footer ---------------- */}
      <div className="flex items-center justify-between shrink-0" style={{ paddingTop: 8 }}>
        <button
          onClick={(e) => { stop(e); addRow(); }}
          onMouseDown={stop} onPointerDown={stop}
          className="flex items-center gap-1 rounded-lg text-[10px] font-bold text-[var(--text-tertiary)] hover:text-[var(--accent)] border border-dashed border-[var(--border-strong)] cursor-pointer transition-colors"
          style={{ padding: '3px 9px' }}
        >
          <Icon size={10}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>
          New row
        </button>
        <span className="text-[9px] font-semibold text-[var(--text-muted)] select-none tabular-nums">
          {hiddenCount > 0
            ? `${hiddenCount} hidden by view`
            : view.sort
            ? `sorted by ${columns.find((c) => c.id === view.sort!.columnId)?.name || 'column'}`
            : 'click any cell to edit'}
        </span>
      </div>
    </div>
  );
}

/* ========================== header cell ========================== */

function HeaderCell({
  col, sorted, onSort, onRename, onKind, onHide, onRemove, onWidth,
}: {
  col: DataColumn;
  sorted: 'asc' | 'desc' | null;
  onSort: () => void;
  onRename: (v: string) => void;
  onKind: (k: ColumnKind) => void;
  onHide: () => void;
  onRemove?: () => void;
  onWidth: (w: number) => void;
}) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    const t = setTimeout(() => document.addEventListener('mousedown', away), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', away); };
  }, [menu]);

  /** Drag the right edge to resize the column. */
  const startResize = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = col.width || 150;
    const move = (m: MouseEvent) => {
      if (m.buttons === 0) { up(); return; }   // lost mouseup — see lib/utils dragState
      onWidth(Math.max(64, Math.min(560, startW + (m.clientX - startX))));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', up);
  };

  return (
    <div ref={ref} className="group/th relative flex items-center gap-1 border-r border-[var(--border)] min-w-0"
      style={{ padding: '0 4px 0 7px' }}>
      <span className="shrink-0" style={{ color: TINT, opacity: 0.75, display: 'flex' }}>
        <Icon size={10}>{KIND_ICON[col.kind]}</Icon>
      </span>
      <input
        type="text"
        value={col.name}
        placeholder="Name"
        onChange={(e) => onRename(e.target.value)}
        onMouseDown={stop} onPointerDown={stop} onClick={stop}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="min-w-0 flex-1 bg-transparent outline-none text-[10px] font-extrabold uppercase tracking-[0.07em] cursor-text placeholder:normal-case placeholder:tracking-normal placeholder:text-[var(--text-muted)]"
        style={{ padding: '7px 0', color: 'var(--text-secondary)' }}
      />
      <button
        onClick={(e) => { stop(e); onSort(); }}
        onMouseDown={stop} onPointerDown={stop}
        title={sorted === 'asc' ? 'Sorted ascending — click for descending' : sorted === 'desc' ? 'Sorted descending — click to clear' : 'Sort by this column'}
        aria-label="Sort by this column"
        className={`shrink-0 cursor-pointer transition-opacity ${sorted ? 'opacity-100' : 'opacity-0 group-hover/th:opacity-100'}`}
        style={{ color: sorted ? 'var(--accent)' : 'var(--text-muted)', display: 'flex' }}
      >
        {sorted === 'desc'
          ? <Icon size={10}><path d="M12 20V4" /><path d="M6 14l6 6 6-6" /></Icon>
          : <Icon size={10}><path d="M12 4v16" /><path d="M6 10l6-6 6 6" /></Icon>}
      </button>
      <button
        onClick={(e) => { stop(e); setMenu((v) => !v); }}
        onMouseDown={stop} onPointerDown={stop}
        title="Column options"
        aria-label="Column options"
        className={`shrink-0 cursor-pointer transition-opacity ${menu ? 'opacity-100' : 'opacity-0 group-hover/th:opacity-100'}`}
        style={{ color: 'var(--text-muted)', display: 'flex' }}
      >
        <Icon size={11}><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></Icon>
      </button>

      {/* right-edge resize grip */}
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        className="absolute top-0 right-0 h-full cursor-col-resize"
        style={{ width: 5 }}
      />

      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.13 }}
            onMouseDown={stop} onPointerDown={stop} onClick={stop} onWheel={stop}
            className="absolute rounded-xl border border-[var(--border-strong)] shadow-[0_16px_36px_-14px_rgba(90,62,40,0.4)]"
            style={{ top: 30, left: 0, width: 176, zIndex: 50, background: 'var(--bg-secondary)', padding: 6 }}
          >
            <div className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[var(--text-tertiary)]"
              style={{ padding: '2px 5px 5px' }}>Type</div>
            {(Object.keys(KIND_LABEL) as ColumnKind[]).map((k) => (
              <button key={k} onMouseDown={stop} onClick={(e) => { stop(e); onKind(k); setMenu(false); }}
                className="w-full flex items-center gap-2 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors"
                style={{ padding: '4px 6px', color: col.kind === k ? 'var(--accent)' : 'var(--text-secondary)', background: col.kind === k ? 'rgba(var(--accent-rgb),0.1)' : 'transparent' }}>
                <Icon size={11}>{KIND_ICON[k]}</Icon> {KIND_LABEL[k]}
              </button>
            ))}
            <div style={{ height: 1, background: 'var(--border)', margin: '5px 2px' }} />
            <button onMouseDown={stop} onClick={(e) => { stop(e); onHide(); setMenu(false); }}
              className="w-full flex items-center gap-2 rounded-lg text-[11px] font-semibold text-[var(--text-secondary)] cursor-pointer"
              style={{ padding: '4px 6px' }}>
              <Icon size={11}><path d="M3 3l18 18" /><path d="M10.6 6.2A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.9M6.5 8.1A17 17 0 0 0 2.5 12S6 18 12 18a9.4 9.4 0 0 0 3.6-.7" /></Icon>
              Hide column
            </button>
            {onRemove && (
              <button onMouseDown={stop} onClick={(e) => { stop(e); onRemove(); setMenu(false); }}
                className="w-full flex items-center gap-2 rounded-lg text-[11px] font-semibold cursor-pointer"
                style={{ padding: '4px 6px', color: '#DC5A4B' }}>
                <Icon size={11}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Icon>
                Delete column
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============================== cells ============================== */

function Cell({
  col, value, rowIndex, onChange, onAddOption,
}: {
  col: DataColumn;
  value: string;
  rowIndex: number;
  onChange: (v: string) => void;
  onAddOption: (label: string, color: string) => void;
}) {
  const common = `data-cell-${col.kind}`;

  if (col.kind === 'select' || col.kind === 'person') {
    return (
      <PickerCell col={col} value={value} rowIndex={rowIndex} onChange={onChange} onAddOption={onAddOption} />
    );
  }

  if (col.kind === 'check') {
    const on = value === 'true' || value === '1' || value.toLowerCase() === 'yes';
    return (
      <div className="flex items-center border-r border-[var(--border)] min-w-0" style={{ padding: '0 9px' }}>
        <button
          onClick={(e) => { stop(e); onChange(on ? '' : 'true'); }}
          onMouseDown={stop} onPointerDown={stop}
          role="checkbox"
          aria-checked={on}
          className="flex items-center justify-center rounded cursor-pointer transition-colors"
          style={{
            width: 15, height: 15,
            border: `1.6px solid ${on ? TINT : 'var(--border-strong)'}`,
            background: on ? TINT : 'transparent', color: '#fff',
          }}
        >
          {on && <Icon size={9}><polyline points="20 6 9 17 4 12" /></Icon>}
        </button>
      </div>
    );
  }

  const numeric = col.kind === 'number';
  return (
    <div className={`flex items-center border-r border-[var(--border)] min-w-0 ${common}`}>
      <input
        type="text"
        value={value}
        data-cell={`${rowIndex}:${col.id}`}
        inputMode={numeric ? 'decimal' : undefined}
        onChange={(e) => onChange(e.target.value)}
        onMouseDown={stop} onPointerDown={stop} onClick={stop}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
        placeholder={col.kind === 'date' ? 'YYYY-MM-DD' : ''}
        className={`w-full min-w-0 bg-transparent outline-none text-[11.5px] font-medium text-[var(--text-primary)] cursor-text focus:bg-[rgba(91,107,214,0.08)] placeholder:text-[var(--text-muted)] ${numeric ? 'text-right tabular-nums' : ''}`}
        style={{ padding: '7px 9px' }}
      />
    </div>
  );
}

/** A select / person cell: shows a pill, opens a menu, can invent new options. */
function PickerCell({
  col, value, rowIndex, onChange, onAddOption,
}: {
  col: DataColumn; value: string; rowIndex: number;
  onChange: (v: string) => void; onAddOption: (label: string, color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const isPerson = col.kind === 'person';

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setDraft(''); } };
    const t = setTimeout(() => document.addEventListener('mousedown', away), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', away); };
  }, [open]);

  const options = col.options || [];
  const known = options.find((o) => o.label.toLowerCase() === value.trim().toLowerCase());
  // A value the column has never seen (typed by hand, or written by the AI)
  // still deserves a pill — colour it deterministically instead of dropping it.
  const color = known?.color || (value.trim() ? personColor(value) : 'transparent');

  const commitNew = () => {
    const label = draft.trim();
    if (!label) return;
    if (!options.some((o) => o.label.toLowerCase() === label.toLowerCase())) {
      onAddOption(label, personColor(label));
    }
    onChange(label);
    setDraft('');
    setOpen(false);
  };

  const matches = draft.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(draft.trim().toLowerCase()))
    : options;

  return (
    <div ref={ref} className="relative flex items-center border-r border-[var(--border)] min-w-0" style={{ padding: '0 6px' }}>
      <button
        onClick={(e) => { stop(e); setOpen((v) => !v); }}
        onMouseDown={stop} onPointerDown={stop}
        data-cell={`${rowIndex}:${col.id}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full min-w-0 flex items-center gap-1.5 rounded-md cursor-pointer transition-colors text-left"
        style={{ padding: '4px 4px' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {value.trim() === '' ? (
          <span className="text-[11px] font-medium text-[var(--text-muted)]">—</span>
        ) : isPerson ? (
          <>
            <span className="shrink-0 rounded-full flex items-center justify-center text-[8px] font-extrabold text-white"
              style={{ width: 17, height: 17, background: color }}>
              {initials(value)}
            </span>
            <span className="truncate text-[11px] font-semibold text-[var(--text-primary)]">{value}</span>
          </>
        ) : (
          <span className="truncate rounded-full text-[10px] font-bold"
            style={{ background: `${color}22`, color, padding: '2.5px 8px' }}>
            {value}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.13 }}
            onMouseDown={stop} onPointerDown={stop} onClick={stop} onWheel={stop}
            className="absolute rounded-xl border border-[var(--border-strong)] shadow-[0_16px_36px_-14px_rgba(90,62,40,0.45)]"
            style={{ top: '100%', left: 2, width: 186, zIndex: 55, background: 'var(--bg-secondary)', padding: 6 }}
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitNew();
                if (e.key === 'Escape') { setOpen(false); setDraft(''); }
              }}
              placeholder={isPerson ? 'Find or add a person…' : 'Find or add…'}
              className="w-full min-w-0 bg-transparent outline-none text-[11px] font-semibold text-[var(--text-primary)] rounded-lg border border-[var(--border)] placeholder:text-[var(--text-muted)]"
              style={{ padding: '4px 7px', marginBottom: 5 }}
            />
            <div style={{ maxHeight: 176, overflowY: 'auto' }}>
              {value.trim() !== '' && (
                <button onMouseDown={stop} onClick={(e) => { stop(e); onChange(''); setOpen(false); }}
                  className="w-full flex items-center gap-2 rounded-lg text-[11px] font-semibold text-[var(--text-muted)] cursor-pointer"
                  style={{ padding: '4px 6px' }}>
                  <Icon size={10}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Icon>
                  Clear
                </button>
              )}
              {matches.map((o) => (
                <button key={o.label} onMouseDown={stop}
                  onClick={(e) => { stop(e); onChange(o.label); setOpen(false); setDraft(''); }}
                  className="w-full flex items-center gap-2 rounded-lg cursor-pointer transition-colors"
                  style={{ padding: '4px 6px' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.08)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  {isPerson ? (
                    <span className="shrink-0 rounded-full flex items-center justify-center text-[8px] font-extrabold text-white"
                      style={{ width: 17, height: 17, background: o.color }}>{initials(o.label)}</span>
                  ) : (
                    <span className="shrink-0 rounded-full" style={{ width: 9, height: 9, background: o.color }} />
                  )}
                  <span className="truncate text-[11px] font-semibold text-[var(--text-primary)]">{o.label}</span>
                </button>
              ))}
              {draft.trim() && !options.some((o) => o.label.toLowerCase() === draft.trim().toLowerCase()) && (
                <button onMouseDown={stop} onClick={(e) => { stop(e); commitNew(); }}
                  className="w-full flex items-center gap-2 rounded-lg text-[11px] font-bold cursor-pointer"
                  style={{ padding: '4px 6px', color: 'var(--accent)' }}>
                  <Icon size={10}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>
                  Add “{draft.trim()}”
                </button>
              )}
              {matches.length === 0 && !draft.trim() && (
                <div className="text-[10.5px] font-semibold text-[var(--text-muted)]" style={{ padding: '6px' }}>
                  Type a name to add the first one.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Re-exported so the plus menu can seed a new roadmap with real defaults. */
export { newRoadmapColumns, newRoadmapRows, STATUS_OPTIONS, PRIORITY_OPTIONS };
