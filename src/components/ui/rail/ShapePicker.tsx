'use client';

import React, { useMemo, useState } from 'react';
import ShapePreview from '@/components/canvas/ShapePreview';
import { SHAPE_COUNT, SHAPE_DOMAINS, filterShapes, type ShapeDomain } from '@/lib/shapeCatalog';
import { PillTabs, SearchBox } from './RailKit';

/**
 * The shape catalogue, as a rail control.
 *
 * Two hundred glyphs behind ten domain tabs was already a lot to hunt through,
 * and there are two thousand now — so search stopped being a convenience and
 * became the primary way in. It is ranked rather than filtered (see
 * filterShapes) because at this size a plain substring match buries `star`
 * under forty `starship`s, and it matches keywords as well as names, so
 * "storage" finds the database and "launch" finds the rocket.
 *
 * The tabs are still there for browsing: the ten hand-authored domains first,
 * then the library's twenty-one genres. Both the Shape tool and a selected
 * shape use this same picker, so swapping a shape you already placed works
 * exactly like placing one.
 *
 * The grid is capped rather than virtualised: two thousand buttons is more DOM
 * than any picker needs, and nobody scrolls past the first hundred without
 * typing instead.
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

  /* Capped. Rendering two thousand buttons costs more than it is worth — the
     answer is always in the first screenful or it is a search, not a scroll. */
  const all = useMemo(() => filterShapes(domain, query), [domain, query]);
  const shapes = useMemo(() => all.slice(0, 240), [all]);

  return (
    <div className="flex flex-col gap-2">
      <SearchBox value={query} onChange={setQuery} placeholder={`Search ${SHAPE_COUNT.toLocaleString()} shapes…`} />

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

        {all.length > shapes.length && (
          <span className="text-[9px] text-[var(--text-muted)]" style={{ gridColumn: '1 / -1', padding: '6px 2px 2px' }}>
            {(all.length - shapes.length).toLocaleString()} more — keep typing to narrow it.
          </span>
        )}

        {shapes.length === 0 && (
          <span className="text-[10px] text-[var(--text-muted)]" style={{ gridColumn: '1 / -1', padding: '8px 2px' }}>
            No shape matches &ldquo;{query}&rdquo;.
          </span>
        )}
      </div>
    </div>
  );
}
