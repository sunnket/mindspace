'use client';

import React, { useMemo, useState } from 'react';
import ShapePreview from '@/components/canvas/ShapePreview';
import { SHAPE_DOMAINS, filterShapes, type ShapeDomain } from '@/lib/shapeCatalog';
import { PillTabs, SearchBox } from './RailKit';

/**
 * The shape catalogue, as a rail control.
 *
 * Two hundred glyphs behind ten domain tabs is a lot to hunt through, and the
 * old flyout offered no way to search them — you picked a tab and scanned. A
 * search box costs one row and turns "where's the funnel" from a scan into a
 * word. Both the Shape tool and a selected shape use this same picker, so
 * swapping a shape you already placed works exactly like placing one.
 */
export default function ShapePicker({
  value, onPick, columns = 4,
}: {
  value?: string;
  onPick: (id: string) => void;
  columns?: number;
}) {
  const [domain, setDomain] = useState<ShapeDomain | 'all'>('all');
  const [query, setQuery] = useState('');

  const shapes = useMemo(() => filterShapes(domain, query), [domain, query]);

  return (
    <div className="flex flex-col gap-2">
      <SearchBox value={query} onChange={setQuery} placeholder="Search 200+ shapes…" />

      {/* Searching spans every domain — a tab filter on top of a text query is
          two ways of narrowing the same list and mostly hides the answer. */}
      {!query.trim() && (
        <PillTabs options={SHAPE_DOMAINS} value={domain} onChange={setDomain} />
      )}

      <div
        className="grid gap-1.5 overflow-y-auto props-rail-scroll"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, maxHeight: 268 }}
      >
        {shapes.map((s) => {
          const active = value === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              title={s.label}
              aria-pressed={active}
              className={`flex flex-col items-center justify-center gap-1 rounded-[10px] transition-all duration-150 cursor-pointer active:scale-95 ${
                active
                  ? 'clay-inset text-[var(--accent)]'
                  : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:brightness-[0.97]'
              }`}
              style={{ padding: '7px 2px 5px' }}
            >
              <ShapePreview
                type={s.id}
                size={22}
                fill={active ? 'var(--accent-subtle)' : 'transparent'}
                stroke="currentColor"
              />
              <span className="text-[7.5px] uppercase tracking-[0.06em] font-bold truncate w-full text-center">{s.label}</span>
            </button>
          );
        })}

        {shapes.length === 0 && (
          <span className="text-[10px] text-[var(--text-muted)]" style={{ gridColumn: '1 / -1', padding: '8px 2px' }}>
            No shape matches &ldquo;{query}&rdquo;.
          </span>
        )}
      </div>
    </div>
  );
}
