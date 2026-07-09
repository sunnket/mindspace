'use client';

import React, { useState } from 'react';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';

interface Bbox { south: number; north: number; west: number; east: number; }

function embedUrl(lat: number, lng: number, bbox: Bbox | null): string {
  const b = bbox ?? { south: lat - 0.012, north: lat + 0.012, west: lng - 0.02, east: lng + 0.02 };
  const params = `bbox=${b.west}%2C${b.south}%2C${b.east}%2C${b.north}&layer=mapnik&marker=${lat}%2C${lng}`;
  return `https://www.openstreetmap.org/export/embed.html?${params}`;
}

export default function MapBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const style = obj.style || {};
  const lat = style.mapLat as number | undefined;
  const lng = style.mapLng as number | undefined;
  const label = (style.mapLabel as string) || '';
  const bbox = (style.mapBbox as Bbox | undefined) || null;
  const hasLocation = typeof lat === 'number' && typeof lng === 'number';

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const search = async (q: string) => {
    const term = q.trim();
    if (!term) return;
    setSearching(true);
    setError('');
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(term)}`);
      const data = await res.json();
      if (!res.ok || typeof data.lat !== 'number') {
        setError(data.error || 'Place not found');
      } else {
        const cur = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
        updateObject(obj.id, {
          content: data.label || term,
          style: { ...cur?.style, isMap: true, mapLat: data.lat, mapLng: data.lng, mapLabel: data.label || term, mapBbox: data.bbox || null },
        });
        setShowSearch(false);
        setQuery('');
      }
    } catch {
      setError('Search failed — check your connection');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div
      className="w-full h-full rounded-2xl overflow-hidden bg-[rgba(255,252,248,0.6)] dark:bg-black/20 backdrop-blur-xl border border-white/25 dark:border-white/5 shadow-lg flex flex-col"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      {/* Header / place label + search toggle */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-[var(--border)]">
        <span className="text-[var(--accent)] shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></svg>
        </span>
        <span className="text-[11px] font-semibold text-[var(--text-primary)] truncate flex-1" title={label}>
          {label || 'Drop a pin — search a place'}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setShowSearch((v) => !v || !hasLocation); if (!hasLocation) setShowSearch(true); }}
          onMouseDown={(e) => e.stopPropagation()}
          className="text-[10px] font-bold text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors cursor-pointer shrink-0"
          title="Search a place"
        >
          {hasLocation ? 'Change' : 'Search'}
        </button>
      </div>

      {/* Search field */}
      {(showSearch || !hasLocation) && (
        <div className="px-3 py-2 shrink-0 flex flex-col gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(query); } }}
              placeholder="e.g. Eiffel Tower, Paris"
              className="flex-1 min-w-0 px-3 py-1.5 rounded-full bg-white/70 dark:bg-white/5 border border-[var(--border)] outline-none text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-light)]"
            />
            <button
              onClick={(e) => { e.stopPropagation(); search(query); }}
              disabled={searching || !query.trim()}
              className="px-3 py-1.5 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold uppercase tracking-wider shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
            >
              {searching ? '…' : 'Go'}
            </button>
          </div>
          {error && <span className="text-[10px] text-red-500/80">{error}</span>}
        </div>
      )}

      {/* Map embed */}
      <div className="flex-1 min-h-0 relative">
        {hasLocation ? (
          <>
            <iframe
              title={label || 'Map'}
              src={embedUrl(lat as number, lng as number, bbox)}
              className="w-full h-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
            <a
              href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`}
              target="_blank"
              rel="noopener noreferrer"
              onMouseDown={(e) => e.stopPropagation()}
              className="absolute bottom-2 right-2 px-2.5 py-1 rounded-full bg-white/85 dark:bg-black/60 backdrop-blur text-[9px] font-bold text-[var(--text-secondary)] hover:text-[var(--accent)] shadow-sm cursor-pointer"
            >
              Open ↗
            </a>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[11px] text-[var(--text-tertiary)]">
            Search a place to drop it on the map
          </div>
        )}
      </div>
    </div>
  );
}
