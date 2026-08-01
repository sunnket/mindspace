'use client';

import React from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import RailShell from './RailShell';
import {
  Icon, Group, Field, OptBtn, Slider, Toggle, Select, ColorRows, Hint, type ColorTarget,
} from './RailKit';

/**
 * The brush.
 *
 * This was an 840px-wide flyout across the bottom of the canvas with a
 * "Simple / Advanced Mode" switch, because a horizontal panel could hold three
 * sliders or twelve, never both. The rail has a column, so there is no mode:
 * the tool, its size and its colour are at the top where your hand is, and the
 * eight dynamics that make a brush feel like a brush are one group below —
 * always there, never in the way.
 */

const DRAW_SIZES = [2, 4, 6, 10, 16];

/** Gradient strokes — SVG paint servers defined once in the canvas layer. */
const GRADIENTS = [
  { id: 'url(#sunset-grad)', css: 'linear-gradient(135deg, #FF512F 0%, #DD2476 100%)', label: 'Sunset' },
  { id: 'url(#ocean-grad)', css: 'linear-gradient(135deg, #02AAB0 0%, #00CDAC 100%)', label: 'Ocean' },
  { id: 'url(#fire-grad)', css: 'linear-gradient(135deg, #F5576C 0%, #F08080 100%)', label: 'Fire' },
  { id: 'url(#lavender-grad)', css: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)', label: 'Lavender' },
  { id: 'url(#cosmic-grad)', css: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)', label: 'Cosmic' },
];

const PenIcon = <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>;
const MarkerIcon = <><path d="M9 11l-6 6v3h9l3-3" /><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" /></>;
const EraserIcon = <><path d="M20 20H8.5L3 14.5a2 2 0 0 1 0-2.8l7.7-7.7a2 2 0 0 1 2.8 0l6.5 6.5a2 2 0 0 1 0 2.8L13 20" /><line x1="8.5" y1="8.5" x2="15.5" y2="15.5" /></>;

export default function DrawRail() {
  const setMode = useCanvasStore((s) => s.setMode);
  const drawColor = useCanvasStore((s) => s.drawColor);
  const setDrawColor = useCanvasStore((s) => s.setDrawColor);
  const drawSize = useCanvasStore((s) => s.drawSize);
  const setDrawSize = useCanvasStore((s) => s.setDrawSize);
  const eraserMode = useCanvasStore((s) => s.eraserMode);
  const setEraserMode = useCanvasStore((s) => s.setEraserMode);
  const highlighterMode = useCanvasStore((s) => s.highlighterMode);
  const setHighlighterMode = useCanvasStore((s) => s.setHighlighterMode);
  const drawOpacity = useCanvasStore((s) => s.drawOpacity);
  const setDrawOpacity = useCanvasStore((s) => s.setDrawOpacity);
  const drawFlow = useCanvasStore((s) => s.drawFlow);
  const setDrawFlow = useCanvasStore((s) => s.setDrawFlow);
  const drawHardness = useCanvasStore((s) => s.drawHardness);
  const setDrawHardness = useCanvasStore((s) => s.setDrawHardness);
  const drawStabilization = useCanvasStore((s) => s.drawStabilization);
  const setDrawStabilization = useCanvasStore((s) => s.setDrawStabilization);
  const drawPressure = useCanvasStore((s) => s.drawPressure);
  const setDrawPressure = useCanvasStore((s) => s.setDrawPressure);
  const drawSmoothing = useCanvasStore((s) => s.drawSmoothing);
  const setDrawSmoothing = useCanvasStore((s) => s.setDrawSmoothing);
  const drawTexture = useCanvasStore((s) => s.drawTexture);
  const setDrawTexture = useCanvasStore((s) => s.setDrawTexture);
  const drawBlendMode = useCanvasStore((s) => s.drawBlendMode);
  const setDrawBlendMode = useCanvasStore((s) => s.setDrawBlendMode);

  const tool = eraserMode ? 'eraser' : highlighterMode ? 'highlighter' : 'pen';
  const isGradient = drawColor.startsWith('url(');
  const inkPreview = isGradient
    ? (GRADIENTS.find((g) => g.id === drawColor)?.css ?? 'var(--accent)')
    : drawColor;

  const pick = (next: 'pen' | 'highlighter' | 'eraser') => {
    setEraserMode(next === 'eraser');
    setHighlighterMode(next === 'highlighter');
  };

  const colorTargets: ColorTarget[] = [
    { id: 'ink', label: 'Ink', value: isGradient ? undefined : drawColor, onChange: setDrawColor },
  ];

  return (
    <RailShell
      railKey={`draw:${tool}`}
      icon={<Icon size={14}>{tool === 'eraser' ? EraserIcon : tool === 'highlighter' ? MarkerIcon : PenIcon}</Icon>}
      title={tool === 'eraser' ? 'Eraser' : tool === 'highlighter' ? 'Highlighter' : 'Pen'}
      subtitle={`${drawSize}px${tool === 'eraser' ? '' : ` · ${Math.round(drawOpacity * 100)}% opacity`}`}
      onClose={() => setMode('select')}
      closeTitle="Put the pen down"
    >
      <Group id="draw-tool" label="Tool">
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {([
            ['pen', 'Pen', PenIcon],
            ['highlighter', 'Marker', MarkerIcon],
            ['eraser', 'Eraser', EraserIcon],
          ] as const).map(([id, label, icon]) => (
            <OptBtn key={id} height={34} active={tool === id} title={label} onClick={() => pick(id)}>
              <span className="flex flex-col items-center gap-0.5">
                <Icon size={13}>{icon}</Icon>
                <span className="text-[8.5px] uppercase tracking-wider">{label}</span>
              </span>
            </OptBtn>
          ))}
        </div>
      </Group>

      {/* SIZE — a live nib, because "6" means nothing and a dot this big does. */}
      <Group id="draw-size" label="Size">
        <div className="flex items-center gap-2">
          <span
            className="shrink-0 rounded-lg flex items-center justify-center"
            style={{ width: 40, height: 40, background: 'var(--well)' }}
          >
            <span
              className="rounded-full"
              style={{
                width: Math.min(32, Math.max(3, drawSize)),
                height: Math.min(32, Math.max(3, drawSize)),
                background: tool === 'eraser' ? 'var(--text-tertiary)' : inkPreview,
                opacity: tool === 'highlighter' ? 0.4 : drawOpacity,
                /* A ring, because the nib is showing you a SIZE and near-black
                   ink on a dark board is an honest preview of nothing. */
                boxShadow: '0 0 0 1px rgba(128,128,128,0.45)',
              }}
            />
          </span>
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <Slider label="Nib" value={drawSize} min={1} max={64} step={1} format={(v) => `${Math.round(v)}px`} onChange={setDrawSize} />
            <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
              {DRAW_SIZES.map((s) => (
                <OptBtn key={s} height={24} active={drawSize === s} title={`${s}px`} onClick={() => setDrawSize(s)}>
                  <span className="text-[9.5px] tabular-nums">{s}</span>
                </OptBtn>
              ))}
            </div>
          </div>
        </div>
      </Group>

      {tool !== 'eraser' && (
        <Group id="draw-colour" label="Ink">
          <ColorRows targets={colorTargets} />
          <Field label="Gradients">
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(5, 26px)', justifyContent: 'start' }}>
              {GRADIENTS.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setDrawColor(g.id)}
                  title={g.label}
                  className="rounded-full transition-transform hover:scale-110 active:scale-95 cursor-pointer"
                  style={{
                    width: 26, height: 26,
                    background: g.css,
                    boxShadow: drawColor === g.id
                      ? '0 0 0 2px var(--accent), 0 0 0 3.5px var(--accent-subtle)'
                      : 'inset 0 0 0 1px rgba(128,128,128,0.28)',
                  }}
                />
              ))}
            </div>
          </Field>
        </Group>
      )}

      {/* DYNAMICS — the difference between a stroke and a line. */}
      {tool !== 'eraser' && (
        <Group id="draw-dynamics" label="Dynamics" defaultOpen={false}>
          <Slider label="Opacity" value={drawOpacity} format={(v) => `${Math.round(v * 100)}%`} onChange={setDrawOpacity} />
          <Slider label="Flow" value={drawFlow} format={(v) => `${Math.round(v * 100)}%`} onChange={setDrawFlow} />
          <Slider label="Hardness" value={drawHardness} format={(v) => `${Math.round(v * 100)}%`} onChange={setDrawHardness} />
          <Slider label="Smoothing" value={drawSmoothing} format={(v) => `${Math.round(v * 100)}%`} onChange={setDrawSmoothing} />
          <Slider label="Stabilize" value={drawStabilization} format={(v) => `${Math.round(v * 100)}%`} onChange={setDrawStabilization} />
          <Toggle
            label="Pressure"
            hint="Stylus tilt & press vary the width"
            checked={drawPressure}
            onChange={setDrawPressure}
          />
        </Group>
      )}

      {tool !== 'eraser' && (
        <Group id="draw-media" label="Medium" defaultOpen={false}>
          <Field label="Texture">
            <Select
              value={drawTexture}
              onChange={(v) => setDrawTexture(v as typeof drawTexture)}
              options={[
                { value: 'none', label: 'Smooth' },
                { value: 'chalk', label: 'Chalk' },
                { value: 'watercolor', label: 'Watercolour' },
                { value: 'noise', label: 'Grain' },
                { value: 'splatter', label: 'Splatter' },
              ]}
            />
          </Field>
          <Field label="Blend">
            <Select
              value={drawBlendMode}
              onChange={(v) => setDrawBlendMode(v as typeof drawBlendMode)}
              options={[
                { value: 'normal', label: 'Normal' },
                { value: 'multiply', label: 'Multiply' },
                { value: 'screen', label: 'Screen' },
                { value: 'overlay', label: 'Overlay' },
                { value: 'darken', label: 'Darken' },
                { value: 'lighten', label: 'Lighten' },
              ]}
            />
          </Field>
        </Group>
      )}

      {tool === 'eraser' && (
        <Hint>Drag across a stroke to rub it out. Size sets how wide the rubber is.</Hint>
      )}
    </RailShell>
  );
}
