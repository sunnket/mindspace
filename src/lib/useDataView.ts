'use client';

import { useCallback, useMemo } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { CanvasObjectData } from '@/lib/db';
import { DataColumn, DataRow, ViewState, readView } from '@/lib/dataTools';

/**
 * The wiring every data block repeats: read its view out of `style`, write
 * changes back, and run an AI fill against its own columns.
 *
 * The view lives in the object's `style` rather than component state on
 * purpose — a sort you set is part of how the board looks, so it has to
 * survive a reload, ride along to collaborators, and land in an export the
 * same way the data does.
 */
export function useDataView(obj: CanvasObjectData, key = 'dataView') {
  const updateObject = useCanvasStore((s) => s.updateObject);

  const view = useMemo<ViewState>(() => readView(obj.style?.[key]), [obj.style, key]);

  const setView = useCallback(
    (next: ViewState) => updateObject(obj.id, { style: { ...obj.style, [key]: next } }),
    [obj.id, obj.style, updateObject, key]
  );

  return { view, setView };
}

export interface AiFillArgs {
  mode: 'complete' | 'extend';
  subject: string;
  columns: DataColumn[];
  rows: DataRow[];
  /** How many rows to invent in "extend" mode. */
  count?: number;
}

/**
 * Ask the server to fill in data. Returns rows keyed by column id:
 * in "complete" mode one entry per input row holding ONLY the cells it
 * filled; in "extend" mode brand-new fully-populated rows.
 *
 * Values are clamped to a select column's allowed options here rather than
 * trusting the model — a status of "Doing" in a board whose options are
 * "To do / In progress / Done" would render as an unstyled pill and quietly
 * break sorting and filtering on that column.
 */
export async function requestAiFill({
  mode, subject, columns, rows, count,
}: AiFillArgs): Promise<Record<string, string>[]> {
  /* The model runs on a free tier that can stall outright. Without a deadline
     the toolbar would spin forever with no way back; 75s is well past a
     healthy response and still short enough to retry inside a train of
     thought. */
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), 75_000);

  let res: Response;
  try {
    res = await fetch('/api/data-fill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abort.signal,
      body: JSON.stringify({
        mode,
        subject,
        count,
        columns: columns.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          options: c.options?.map((o) => o.label),
        })),
        rows: rows.map((r) => r.cells),
      }),
    });
  } catch (e) {
    throw new Error(
      (e as Error)?.name === 'AbortError'
        ? 'The model took too long. Try again.'
        : 'Could not reach the AI. Check your connection.'
    );
  } finally {
    clearTimeout(deadline);
  }

  const data = (await res.json().catch(() => null)) as { rows?: Record<string, string>[]; error?: string } | null;
  if (!res.ok || !data?.rows) {
    throw new Error(data?.error || 'AI fill failed. Try again.');
  }
  if (data.rows.length === 0) {
    throw new Error('The model returned nothing to add.');
  }

  const byId = new Map(columns.map((c) => [c.id, c]));
  return data.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      const col = byId.get(k);
      if (!col) continue;
      let value = String(v ?? '').trim();
      if (col.options?.length && col.kind === 'select') {
        const hit = col.options.find((o) => o.label.toLowerCase() === value.toLowerCase());
        // Unknown label → drop the cell rather than poison the column.
        if (!hit) continue;
        value = hit.label;
      }
      if (col.kind === 'number') {
        const n = parseFloat(value.replace(/[^0-9.eE+-]/g, ''));
        if (isNaN(n)) continue;
        value = String(n);
      }
      out[k] = value;
    }
    return out;
  });
}
