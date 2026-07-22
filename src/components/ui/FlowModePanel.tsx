'use client';

import React from 'react';
import { useFlowStore, type FlowPrefs, type FlowMood, type FlowProgressStyle } from '@/store/flowStore';

/**
 * Flow Mode preferences — the popover behind the toolbar's Flow icon. A master
 * switch plus a toggle for each sub-experience, an intensity dial, and a live
 * read-out of the current mood + session words. Styling follows the clay design
 * language; spacing is inline (the global reset neutralises Tailwind padding &
 * margin utilities, so they're avoided here).
 */

const FEATURES: { key: Exclude<keyof FlowPrefs, 'progressStyle'>; title: string; blurb: string }[] = [
  { key: 'spotlight', title: 'Spotlight & frame', blurb: 'A warm light follows your caret; the rest dims away.' },
  { key: 'chromeFade', title: 'Melt the chrome', blurb: 'Toolbar & panels fade out while you type.' },
  { key: 'momentum', title: 'Momentum ember', blurb: 'A living ember that flares with your typing rhythm.' },
  { key: 'semanticWeather', title: 'Semantic weather', blurb: 'The room shifts to match the mood of your words.' },
  { key: 'livingProgress', title: 'Living progress', blurb: 'A candle, tree or cup that lives with your words. Drag it anywhere.' },
];

const MOOD_DOT: Record<FlowMood, string> = {
  calm: '#e2a86b', warm: '#ffb46e', cold: '#96beff', rain: '#96c8f0',
  night: '#a5afff', fire: '#ff9646', ocean: '#78dce6', forest: '#96e696',
};

function Switch({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      disabled={disabled}
      className="relative shrink-0 transition-all duration-200 cursor-pointer"
      style={{
        width: 38, height: 22, borderRadius: 999,
        background: on ? 'var(--accent)' : 'var(--well)',
        boxShadow: on ? '0 0 0 1px rgba(var(--accent-rgb),0.5), 0 2px 8px -2px rgba(var(--accent-rgb),0.6)' : 'inset 0 1px 3px rgba(90,62,40,0.18)',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span
        className="absolute top-1/2 transition-all duration-200"
        style={{
          width: 16, height: 16, borderRadius: '50%', background: '#fff',
          left: 3, transform: `translateY(-50%) translateX(${on ? 16 : 0}px)`,
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </button>
  );
}

export default function FlowModePanel({ onClose }: { onClose: () => void }) {
  const enabled = useFlowStore((s) => s.enabled);
  const prefs = useFlowStore((s) => s.prefs);
  const intensity = useFlowStore((s) => s.intensity);
  const mood = useFlowStore((s) => s.mood);
  const words = useFlowStore((s) => s.session.words);
  const toggle = useFlowStore((s) => s.toggle);
  const setPref = useFlowStore((s) => s.setPref);
  const setIntensity = useFlowStore((s) => s.setIntensity);

  return (
    <div
      className="clay-card rounded-2xl"
      style={{ width: 320, maxWidth: '92vw', fontFamily: "'Outfit', sans-serif", overflow: 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* header + master switch */}
      <div
        className="flex items-center justify-between"
        style={{
          padding: '13px 15px',
          background: enabled
            ? 'linear-gradient(120deg, rgba(var(--accent-rgb),0.16), rgba(var(--accent-rgb),0.04))'
            : 'transparent',
          transition: 'background 300ms ease',
        }}
      >
        <div className="flex items-center gap-2.5">
          <span style={{ display: 'inline-flex', width: 30, height: 30, borderRadius: 10, background: 'var(--accent-subtle)', color: 'var(--accent)', alignItems: 'center', justifyContent: 'center' }}>
            <FlowIcon size={17} />
          </span>
          <div>
            <div className="font-extrabold" style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.1 }}>Flow Mode</div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>Live the moment you write</div>
          </div>
        </div>
        <Switch on={enabled} onClick={toggle} />
      </div>

      {/* live status */}
      {enabled && (
        <div
          className="flex items-center justify-between"
          style={{ padding: '8px 15px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: MOOD_DOT[mood], boxShadow: `0 0 8px ${MOOD_DOT[mood]}` }} />
            <span style={{ textTransform: 'capitalize' }}>{mood}</span>
            {prefs.semanticWeather ? null : <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>· weather off</span>}
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{words.toLocaleString()} words</div>
        </div>
      )}

      {/* feature toggles */}
      <div style={{ padding: '6px 7px 8px' }}>
        {FEATURES.map((f) => {
          const on = prefs[f.key];
          return (
            <div
              key={f.key}
              className="flex items-center justify-between gap-3 rounded-xl"
              style={{ padding: '8px 8px', opacity: enabled ? 1 : 0.5, transition: 'opacity 200ms ease' }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="font-bold" style={{ fontSize: 12, color: 'var(--text-primary)' }}>{f.title}</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.35, marginTop: 1 }}>{f.blurb}</div>
              </div>
              <Switch on={on} disabled={!enabled} onClick={() => setPref(f.key, !on)} />
            </div>
          );
        })}

        {/* progress metaphor selector */}
        {enabled && prefs.livingProgress && (
          <div style={{ padding: '4px 9px 2px' }}>
            <div className="uppercase font-extrabold" style={{ fontSize: 9, letterSpacing: '0.13em', color: 'var(--text-tertiary)', marginBottom: 6 }}>Progress metaphor</div>
            <div className="flex gap-1.5">
              {(['candle', 'tree', 'coffee'] as FlowProgressStyle[]).map((st) => {
                const on = prefs.progressStyle === st;
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setPref('progressStyle', st)}
                    className="flex-1 flex flex-col items-center gap-1 rounded-xl cursor-pointer transition-all duration-150 active:scale-95"
                    style={{
                      padding: '8px 4px',
                      background: on ? 'var(--accent-subtle)' : 'var(--well)',
                      boxShadow: on ? '0 0 0 1.5px var(--accent)' : 'inset 0 1px 2px rgba(90,62,40,0.07)',
                      color: on ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    <MetaIcon style={st} />
                    <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'capitalize', letterSpacing: '0.02em' }}>{st}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* intensity */}
        <div className="flex items-center gap-3" style={{ padding: '10px 9px 4px', opacity: enabled && prefs.spotlight ? 1 : 0.5 }}>
          <span className="uppercase font-extrabold shrink-0" style={{ fontSize: 9, letterSpacing: '0.13em', color: 'var(--text-tertiary)' }}>Depth</span>
          <input
            type="range" min={0.4} max={1} step={0.05} value={intensity}
            disabled={!enabled || !prefs.spotlight}
            onChange={(e) => setIntensity(parseFloat(e.target.value))}
            className="flex-1 accent-[var(--accent)] cursor-pointer"
            style={{ height: 4 }}
          />
          <span className="tabular-nums font-bold text-right" style={{ fontSize: 10, width: 30, color: 'var(--text-secondary)' }}>{Math.round(intensity * 100)}%</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="w-full text-[11px] font-bold cursor-pointer transition-colors"
        style={{ padding: '9px', borderTop: '1px solid var(--border)', color: 'var(--text-tertiary)' }}
      >
        Done
      </button>
    </div>
  );
}

function MetaIcon({ style }: { style: FlowProgressStyle }) {
  if (style === 'candle') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3c1.4 1.2 1.4 2.6 0 3.6C10.6 5.6 10.6 4.2 12 3Z" fill="currentColor" stroke="none" />
        <rect x="9" y="9" width="6" height="11" rx="1.4" />
        <path d="M12 6.8V9" />
        <path d="M8 20h8" />
      </svg>
    );
  }
  if (style === 'tree') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 21v-6" />
        <path d="M12 15 8.5 11.5M12 13l3-3" />
        <circle cx="12" cy="8" r="5" fill="currentColor" fillOpacity="0.18" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 9h12v4a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V9Z" />
      <path d="M17 10h2.2a2 2 0 0 1 0 4H17" />
      <path d="M8.5 5.5c.6-.7.6-1.3 0-2M12 5.5c.6-.7.6-1.3 0-2" />
    </svg>
  );
}

export function FlowIcon({ size = 18 }: { size?: number }) {
  // An aperture / focus mark — the room narrowing to a point of light.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3.2 A8.8 8.8 0 0 1 19.6 7.6 L12 12 Z" opacity="0.55" />
      <path d="M20.5 14.4 A8.8 8.8 0 0 1 12 20.8 L12 12 Z" opacity="0.35" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
