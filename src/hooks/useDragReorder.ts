'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Drag-to-reorder for a vertical list inside a canvas block.
 *
 * Rows are found by a `data-reorder-index` attribute on the scroll container, so
 * the hook needs no registration step and no refs per row — it measures the real
 * DOM at grab time, which also means it stays correct when rows have different
 * heights (a wrapped two-line todo next to a one-line one).
 *
 * The insertion point is decided by row MIDPOINTS rather than by which row the
 * cursor is over: dragging past halfway is the moment a row should move, and it
 * gives an unambiguous answer at the very top and very bottom of the list.
 *
 * Everything stops propagation, hard. A canvas block is itself draggable, so
 * without that, grabbing a row handle would slide the whole block across the
 * board instead of reordering anything.
 */
export interface DragReorderState {
  /** Index being carried, or null when idle. */
  dragIndex: number | null;
  /** Index the row would land at, or null. */
  dropIndex: number | null;
  /** Attach to a row's handle: `onPointerDown={(e) => startDrag(e, i)}`. */
  startDrag: (e: React.PointerEvent, index: number) => void;
}

export function useDragReorder(
  containerRef: React.RefObject<HTMLElement | null>,
  onReorder: (from: number, to: number) => void,
): DragReorderState {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // Read inside listeners without re-binding them every render.
  const dropRef = useRef<number | null>(null);

  const startDrag = useCallback((e: React.PointerEvent, index: number) => {
    // A reorder is not a block drag and not a text selection.
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;

    setDragIndex(index);
    setDropIndex(index);
    dropRef.current = index;

    /** Midpoints of every row, in viewport coordinates, measured once. */
    const rows = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>('[data-reorder-index]') ?? [],
    );
    const mids = rows.map((r) => {
      const box = r.getBoundingClientRect();
      return box.top + box.height / 2;
    });

    const onMove = (ev: PointerEvent) => {
      // Button released somewhere we couldn't see — don't carry the row forever.
      if (ev.buttons === 0) { finish(); return; }
      // How many midpoints the cursor has passed = where it would be inserted.
      let target = 0;
      while (target < mids.length && ev.clientY > mids[target]) target++;
      /* Landing just after yourself is where you already are. Collapsing it
         means no visible "drop here" hint appears for a no-op move. */
      if (target > index) target -= 1;
      if (target !== dropRef.current) {
        dropRef.current = target;
        setDropIndex(target);
      }
    };

    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      const to = dropRef.current;
      setDragIndex(null);
      setDropIndex(null);
      dropRef.current = null;
      if (to !== null && to !== index) onReorder(index, to);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
  }, [containerRef, onReorder]);

  return { dragIndex, dropIndex, startDrag };
}

/** Move one item of an array to another index, returning a new array. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}
