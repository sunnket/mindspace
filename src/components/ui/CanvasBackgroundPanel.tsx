'use client';

import React from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import {
  CANVAS_PRESETS,
  CUSTOM_SWATCHES,
  DEFAULT_BACKGROUND,
  type CanvasThemePreset,
} from '@/lib/canvasTheme';

export default function CanvasBackgroundPanel() {
  const bg = useCanvasStore((s) => s.canvasBackground);
  const setBg = useCanvasStore((s) => s.setCanvasBackground);

  const applyPreset = (p: CanvasThemePreset) =>
    setBg({ presetId: p.id, color: p.color, opacity: p.opacity, dark: p.dark, accent: p.accent, name: p.name });

  // Custom colors: let the surface tone (dark/light text) be inferred from the
  // color so any pick stays legible, and keep the current intensity.
  const applyCustom = (color: string) =>
    setBg({ presetId: 'custom', color, opacity: bg.opacity || 0.65, name: 'Custom' });

  const setOpacity = (opacity: number) => setBg({ ...bg, opacity });

  const activeName = bg.name || (bg.presetId === 'custom' ? 'Custom' : 'Cream');
  const intensityPct = Math.round((bg.opacity ?? 1) * 100);

  return (
    <div className="flex flex-col gap-3 w-[280px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
            <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
            <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
            <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1.4 0 2.5-1.1 2.5-2.5 0-.6-.2-1.1-.5-1.5-.4-.4-.6-.9-.6-1.4 0-1.1.9-2 2-2H18c2.2 0 4-1.8 4-4a10 10 0 0 0-10-8.6Z" />
          </svg>
          Canvas Background
        </span>
        <span className="text-[10px] font-medium text-[var(--text-secondary)] truncate max-w-[110px]">{activeName}</span>
      </div>

      {/* Preset themes */}
      <div className="grid grid-cols-6 gap-1.5">
        {CANVAS_PRESETS.map((p) => {
          const active = bg.presetId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              title={p.name}
              className={`relative aspect-square rounded-lg border transition-all hover:scale-105 ${
                active ? 'border-[var(--accent)] shadow-sm' : 'border-black/10'
              }`}
              style={{
                background: `linear-gradient(140deg, ${p.swatch[0]} 0%, ${p.swatch[1]} 100%)`,
                boxShadow: active ? '0 0 0 2px var(--accent-subtle)' : undefined,
              }}
            >
              {active && (
                <span
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ color: p.dark ? '#fff' : '#2D2A26' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="w-full h-px bg-[var(--border)]" />

      {/* Custom color */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider">Custom color</span>
        <div className="flex items-center gap-2">
          {/* Native color well */}
          <label
            className="relative w-8 h-8 rounded-lg overflow-hidden border border-[var(--border-strong)] cursor-pointer shrink-0 shadow-sm"
            style={{ background: bg.color }}
            title="Pick any color"
          >
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(bg.color) ? bg.color : '#C97B4B'}
              onChange={(e) => applyCustom(e.target.value)}
              className="absolute -inset-2 w-[200%] h-[200%] cursor-pointer opacity-0"
            />
          </label>
          {/* Curated swatches */}
          <div className="grid grid-cols-6 gap-1.5 flex-1">
            {CUSTOM_SWATCHES.map((c) => {
              const active = bg.presetId === 'custom' && bg.color.toLowerCase() === c.toLowerCase();
              return (
                <button
                  key={c}
                  onClick={() => applyCustom(c)}
                  title={c}
                  className={`w-full aspect-square rounded-full border transition-all hover:scale-110 ${
                    active ? 'border-[var(--accent)]' : 'border-black/10'
                  }`}
                  style={{
                    background: c,
                    boxShadow: active ? '0 0 0 2px var(--accent-subtle)' : undefined,
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Intensity */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider">Intensity</span>
          <span className="text-[10px] font-mono text-[var(--text-secondary)]">{intensityPct}%</span>
        </div>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={bg.opacity ?? 1}
          onChange={(e) => setOpacity(Number(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-[var(--bg-tertiary)]"
          style={{ accentColor: 'var(--accent)' }}
        />
      </div>

      {/* Reset */}
      <button
        onClick={() => setBg({ ...DEFAULT_BACKGROUND })}
        className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors self-start"
      >
        ↺ Reset to Cream
      </button>
    </div>
  );
}
