'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';

interface Bbox { south: number; north: number; west: number; east: number; }
interface Place { lat: number; lng: number; name: string; label: string; kind: string; bbox: Bbox | null; }

// OSM export-embed layers. Standard always works; the others are best-effort.
const STYLES = [
  { id: 'mapnik', label: 'Standard' },
  { id: 'hot', label: 'Humanitarian' },
  { id: 'cyclosm', label: 'Cycle' },
] as const;
type StyleId = (typeof STYLES)[number]['id'];

function embedUrl(lat: number, lng: number, bbox: Bbox | null, style: StyleId): string {
  // Tighten a giant bbox (whole cities) a touch, and give a lone point a sane frame.
  const b = bbox ?? { south: lat - 0.01, north: lat + 0.01, west: lng - 0.016, east: lng + 0.016 };
  const p = `bbox=${b.west}%2C${b.south}%2C${b.east}%2C${b.north}&layer=${style}&marker=${lat}%2C${lng}`;
  return `https://www.openstreetmap.org/export/embed.html?${p}`;
}

const PinIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" />
  </svg>
);

export default function MapBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const style = obj.style || {};
  const lat = style.mapLat as number | undefined;
  const lng = style.mapLng as number | undefined;
  const label = (style.mapLabel as string) || '';
  const name = (style.mapName as string) || label.split(',')[0] || '';
  const bbox = (style.mapBbox as Bbox | undefined) || null;
  const mapStyle = ((style.mapStyle as StyleId) || 'mapnik');
  const hasLocation = typeof lat === 'number' && typeof lng === 'number';

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const debounce = useRef<NodeJS.Timeout | null>(null);
  const reqId = useRef(0);

  const patch = useCallback((updates: Record<string, unknown>, content?: string) => {
    const cur = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
    updateObject(obj.id, { ...(content !== undefined ? { content } : {}), style: { ...cur?.style, ...updates } });
  }, [obj.id, updateObject]);

  const choose = useCallback((p: Place) => {
    patch({ isMap: true, mapLat: p.lat, mapLng: p.lng, mapLabel: p.label, mapName: p.name, mapBbox: p.bbox, mapKind: p.kind }, p.name || p.label);
    setQuery('');
    setSuggestions([]);
    setOpen(false);
    setError('');
  }, [patch]);

  // Debounced type-ahead against the geocoder.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const term = query.trim();
    if (term.length < 2) { setSuggestions([]); return; }
    debounce.current = setTimeout(async () => {
      const id = ++reqId.current;
      setBusy(true);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(term)}&limit=6`);
        const data = await res.json();
        if (id !== reqId.current) return; // a newer keystroke won
        setSuggestions(Array.isArray(data.results) ? data.results : []);
        setOpen(true);
      } catch {
        if (id === reqId.current) setError('Search failed');
      } finally {
        if (id === reqId.current) setBusy(false);
      }
    }, 320);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query]);

  const submitTop = () => {
    if (suggestions[0]) choose(suggestions[0]);
  };

  const locateMe = () => {
    if (!('geolocation' in navigator)) { setError('Location not available'); return; }
    setBusy(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const res = await fetch(`/api/geocode?lat=${latitude}&lng=${longitude}`);
          const data = await res.json();
          const p: Place = data.results?.[0] || { lat: latitude, lng: longitude, name: 'My location', label: 'My location', kind: 'place', bbox: null };
          choose({ ...p, lat: latitude, lng: longitude, name: p.name || 'My location' });
        } catch {
          choose({ lat: latitude, lng: longitude, name: 'My location', label: 'My location', kind: 'place', bbox: null });
        } finally {
          setBusy(false);
        }
      },
      () => { setBusy(false); setError('Could not get your location'); },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const cycleStyle = () => {
    const idx = STYLES.findIndex((s) => s.id === mapStyle);
    patch({ mapStyle: STYLES[(idx + 1) % STYLES.length].id });
  };

  const copyCoords = () => {
    if (!hasLocation) return;
    navigator.clipboard?.writeText(`${(lat as number).toFixed(5)}, ${(lng as number).toFixed(5)}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  };

  const styleLabel = STYLES.find((s) => s.id === mapStyle)?.label || 'Standard';

  return (
    <div
      className="w-full h-full rounded-2xl overflow-hidden bg-[rgba(255,252,248,0.7)] dark:bg-black/25 backdrop-blur-xl border border-white/25 dark:border-white/10 shadow-lg flex flex-col relative"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      {/* Search header (its bare background doubles as the card's drag handle) */}
      <div className="relative z-20 shrink-0 px-2 pt-2">
        <div
          className="flex items-center gap-1.5 rounded-full bg-white/85 dark:bg-black/40 border border-white/40 dark:border-white/10 shadow-sm px-2.5 py-1.5"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="text-[var(--accent)] shrink-0"><PinIcon /></span>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setError(''); }}
            onFocus={() => suggestions.length && setOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitTop(); } if (e.key === 'Escape') setOpen(false); }}
            placeholder={hasLocation ? name || 'Search a place' : 'Search any place…'}
            className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
          {busy && <span className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />}
          <button
            onClick={locateMe}
            title="Use my location"
            className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-colors cursor-pointer"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
          </button>
        </div>

        {/* Type-ahead suggestions */}
        <AnimatePresence>
          {open && suggestions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              onMouseDown={(e) => e.stopPropagation()}
              className="absolute left-2 right-2 mt-1.5 z-30 rounded-2xl bg-white/95 dark:bg-[#211d1a]/95 backdrop-blur-xl border border-white/50 dark:border-white/10 shadow-xl overflow-hidden max-h-[164px] overflow-y-auto"
            >
              {suggestions.map((p, i) => (
                <button
                  key={`${p.lat}-${p.lng}-${i}`}
                  onClick={() => choose(p)}
                  className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-[var(--accent-subtle)] transition-colors cursor-pointer border-b border-black/5 dark:border-white/5 last:border-0"
                >
                  <span className="text-[var(--accent)] mt-0.5 shrink-0"><PinIcon size={12} /></span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-semibold text-[var(--text-primary)] truncate">{p.name}</span>
                    <span className="block text-[10px] text-[var(--text-tertiary)] truncate">{p.label}</span>
                  </span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        {error && <div className="px-3 pt-1 text-[10px] text-red-500/80" onMouseDown={(e) => e.stopPropagation()}>{error}</div>}
      </div>

      {/* Map */}
      <div className="relative flex-1 min-h-0 mt-2 overflow-hidden">
        {hasLocation ? (
          <iframe
            key={`${lat}-${lng}-${mapStyle}`}
            title={name || 'Map'}
            src={embedUrl(lat as number, lng as number, bbox, mapStyle)}
            className="absolute top-0 left-0 w-full h-[calc(100%+40px)] border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 bg-[radial-gradient(circle_at_50%_35%,var(--accent-subtle),transparent_70%)]">
            <span className="text-[var(--accent)] opacity-80"><PinIcon size={28} /></span>
            <span className="text-[12px] font-semibold text-[var(--text-secondary)]">Search any place to drop it on the map</span>
            <span className="text-[10px] text-[var(--text-tertiary)]">a landmark, an address, a city — or tap the ⊕ to use your location</span>
          </div>
        )}

        {/* bottom scrim for overlay legibility */}
        {hasLocation && <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/25 to-transparent pointer-events-none" />}

        {/* place chip */}
        {hasLocation && (
          <button
            onClick={copyCoords}
            onMouseDown={(e) => e.stopPropagation()}
            title="Copy coordinates"
            className="absolute left-2 bottom-2 max-w-[62%] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur-md border border-white/50 dark:border-white/10 shadow-md cursor-pointer hover:bg-white transition-colors group"
          >
            <span className="text-[var(--accent)] shrink-0"><PinIcon size={11} /></span>
            <span className="min-w-0 text-left">
              <span className="block text-[11px] font-bold text-[var(--text-primary)] truncate leading-tight">{name}</span>
              <span className="block text-[9px] text-[var(--text-tertiary)] tabular-nums leading-tight">
                {copied ? 'Copied!' : `${(lat as number).toFixed(4)}, ${(lng as number).toFixed(4)}`}
              </span>
            </span>
          </button>
        )}

        {/* actions */}
        {hasLocation && (
          <div className="absolute right-2 bottom-2 flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
            <button
              onClick={cycleStyle}
              title={`Map style: ${styleLabel}`}
              className="px-2.5 py-1.5 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur-md border border-white/50 dark:border-white/10 shadow-md text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
            >
              {styleLabel}
            </button>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Directions"
              className="w-8 h-8 rounded-full bg-white/90 dark:bg-black/60 backdrop-blur-md border border-white/50 dark:border-white/10 shadow-md flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11" /></svg>
            </a>
            <a
              href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in OpenStreetMap"
              className="w-8 h-8 rounded-full bg-[var(--accent)] shadow-md flex items-center justify-center text-white hover:brightness-105 transition-all cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
