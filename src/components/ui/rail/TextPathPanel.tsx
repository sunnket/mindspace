'use client';

import React, { useMemo, useState } from 'react';
import type { CanvasObjectData } from '@/lib/db';
import {
  readTextPath, defaultTextPath, applyShape, pathD, splineD, polylineD,
  PATH_SHAPES, PATH_ANIMS, DEFAULT_3D,
  type TextPathConfig, type PathAlign, type GuideStyle,
} from '@/lib/textPath';
import { Icon, Group, Field, OptBtn, RowBtn, Slider, Segmented, Swatch, Toggle, QUICK_COLORS } from './RailKit';

/**
 * Everything a run of text written on a curve can be.
 *
 * Four groups, in the order the question actually comes up: WHERE the letters
 * sit on the line, WHAT the line is, whether it has DEPTH, and whether it
 * MOVES. Each one writes straight into `obj.style.textPath` — the same config
 * the renderer reads, so nothing here needs a preview of its own: the block on
 * the board is the preview.
 */

const ALIGN_OPTIONS: { value: PathAlign; label: string; title: string }[] = [
  { value: 'above', label: 'Above', title: 'Letters stand on the line' },
  { value: 'on', label: 'On', title: 'The line runs through the letters' },
  { value: 'below', label: 'Below', title: 'Letters hang under the line' },
];

/** A preset's curve, drawn small. Free — it's the same geometry the block uses. */
function ShapeThumb({ id, active }: { id: string; active: boolean }) {
  const d = useMemo(() => {
    const s = PATH_SHAPES.find((p) => p.id === id);
    if (!s) return '';
    const pts = s.points.map((p) => ({ x: 3 + p.x * 42, y: 3 + p.y * 26 }));
    return (s.curve === 'sharp' ? polylineD : splineD)(pts, !!s.closed);
  }, [id]);
  return (
    <svg width="48" height="32" viewBox="0 0 48 32" fill="none" aria-hidden>
      <path
        d={d}
        stroke={active ? 'var(--accent)' : 'currentColor'}
        strokeWidth={active ? 2 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={active ? 1 : 0.75}
      />
    </svg>
  );
}

export default function TextPathPanel({
  obj, patch,
}: {
  obj: CanvasObjectData;
  patch: (kv: Record<string, unknown>) => void;
}) {
  const cfg = readTextPath(obj.style?.textPath);
  const [shapesOpen, setShapesOpen] = useState(false);

  if (!cfg) return null;

  const write = (kv: Partial<TextPathConfig>) => patch({ textPath: { ...cfg, ...kv } });
  const write3D = (kv: Partial<typeof DEFAULT_3D>) =>
    write({ three: { ...DEFAULT_3D, ...(cfg.three || {}), ...kv } });

  const three = { ...DEFAULT_3D, ...(cfg.three || {}) };
  const anim = cfg.anim?.preset || '';
  const shownShapes = shapesOpen ? PATH_SHAPES : PATH_SHAPES.slice(0, 8);

  return (
    <>
      {/* ---------------------------------------------------------- PATH -- */}
      <Group id="tp-path" label="On the path">
        <Field label="Align on path">
          <Segmented
            value={cfg.align}
            onChange={(v) => write({ align: v })}
            options={ALIGN_OPTIONS}
          />
        </Field>

        <Field label="Direction">
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <OptBtn
              active={cfg.reversed}
              title="Run the text the other way along the curve"
              onClick={() => write({ reversed: !cfg.reversed })}
            >
              <Icon size={12}><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></Icon>
              <span className="text-[10.5px]">Reverse</span>
            </OptBtn>
            <OptBtn
              active={cfg.curve === 'sharp'}
              title={cfg.curve === 'sharp' ? 'Corners — straight between points' : 'Smooth — a curve through every point'}
              onClick={() => write({ curve: cfg.curve === 'sharp' ? 'smooth' : 'sharp', shape: '' })}
            >
              <Icon size={12}>{cfg.curve === 'sharp' ? <polyline points="3 17 9 7 15 15 21 6" /> : <path d="M3 16c6-12 12-12 18 0" />}</Icon>
              <span className="text-[10.5px]">{cfg.curve === 'sharp' ? 'Corners' : 'Smooth'}</span>
            </OptBtn>
          </div>
        </Field>

        <Toggle
          label="Fill the line"
          hint="Spread the letters over the whole curve"
          checked={cfg.fit}
          onChange={(v) => write({ fit: v })}
        />

        <Slider
          label="Start"
          value={cfg.startOffset}
          min={-100} max={100} step={1}
          format={(v) => `${Math.round(v)}%`}
          onChange={(v) => write({ startOffset: v })}
        />
        <Slider
          label="Distance from line"
          value={cfg.offset}
          min={-80} max={80} step={1}
          format={(v) => `${Math.round(v)}px`}
          onChange={(v) => write({ offset: v })}
        />
        <Slider
          label="Letter spacing"
          value={cfg.spacing}
          min={-8} max={40} step={0.5}
          format={(v) => `${v.toFixed(1)}px`}
          onChange={(v) => write({ spacing: v })}
        />
        <Slider
          label="Word spacing"
          value={cfg.wordSpacing}
          min={0} max={60} step={1}
          format={(v) => `${Math.round(v)}px`}
          onChange={(v) => write({ wordSpacing: v })}
        />

        <Field label="Anchored">
          <Segmented
            value={cfg.anchor}
            onChange={(v) => write({ anchor: v })}
            options={[
              { value: 'start', label: 'Start', title: 'The run begins at the start of the curve' },
              { value: 'middle', label: 'Centre', title: 'The run is centred on the curve' },
              { value: 'end', label: 'End', title: 'The run finishes at the end of the curve' },
            ]}
          />
        </Field>

        <RowBtn
          onClick={() => write({ startOffset: 0, offset: 0, spacing: 0, wordSpacing: 0, anchor: 'middle', reversed: false, fit: false })}
          title="Put every placement control back to where it started"
          icon={<Icon size={12}><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 4 3 9 8 9" /></Icon>}
        >
          Reset placement
        </RowBtn>
      </Group>

      {/* --------------------------------------------------------- SHAPE -- */}
      <Group id="tp-shape" label="Shape of the line">
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          {shownShapes.map((s) => {
            const active = cfg.shape === s.id;
            return (
              <button
                key={s.id}
                onClick={() => write(applyShape(cfg, s.id))}
                title={s.name}
                aria-pressed={active}
                className={`rounded-[9px] flex flex-col items-center justify-center gap-0.5 transition-all duration-150 cursor-pointer active:scale-[0.96] ${
                  active
                    ? 'clay-inset text-[var(--accent)]'
                    : 'bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:brightness-[0.97]'
                }`}
                style={{ height: 46 }}
              >
                <ShapeThumb id={s.id} active={active} />
                <span className="text-[8px] font-bold uppercase tracking-wide truncate w-full text-center" style={{ paddingBottom: 2 }}>{s.name}</span>
              </button>
            );
          })}
        </div>

        <OptBtn height={26} onClick={() => setShapesOpen((v) => !v)} title={shapesOpen ? 'Show fewer' : 'Show every shape'}>
          <span className="text-[10px]">{shapesOpen ? 'Fewer shapes' : `All ${PATH_SHAPES.length} shapes`}</span>
        </OptBtn>

        <Field label="Guide line" hint={cfg.guide === 'off' ? 'hidden' : cfg.guide}>
          <Segmented
            value={cfg.guide}
            onChange={(v: GuideStyle) => write({ guide: v })}
            height={26}
            options={[
              { value: 'off', label: 'Off', title: 'The curve is invisible — only the letters show' },
              { value: 'solid', label: 'Solid', title: 'Draw the curve as a solid line' },
              { value: 'dashed', label: 'Dashed', title: 'Draw the curve as a dashed line' },
              { value: 'dotted', label: 'Dotted', title: 'Draw the curve as a dotted line' },
            ]}
          />
        </Field>

        {cfg.guide !== 'off' && (
          <>
            <Slider
              label="Line width"
              value={cfg.guideWidth}
              min={0.5} max={14} step={0.5}
              format={(v) => `${v}px`}
              onChange={(v) => write({ guideWidth: v })}
            />
            <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(8, minmax(0, 1fr))' }}>
              {QUICK_COLORS.map((c) => (
                <Swatch key={c} color={c} active={(cfg.guideColor || '').toLowerCase() === c.toLowerCase()} onClick={() => write({ guideColor: c })} />
              ))}
            </div>
          </>
        )}

        <p className="text-[9.5px] leading-relaxed text-[var(--text-muted)]">
          Drag the white dots on the board to bend the line. Drag a small dot to
          add a point there, Alt-click a white one to remove it.
        </p>
      </Group>

      {/* ------------------------------------------------------------ 3D -- */}
      <Group id="tp-3d" label="3D">
        <Slider
          label="Depth"
          value={three.depth}
          min={0} max={24} step={1}
          format={(v) => (v === 0 ? 'flat' : `${Math.round(v)}px`)}
          onChange={(v) => write3D({ depth: v })}
        />
        {three.depth > 0 && (
          <>
            <Slider
              label="Light from"
              value={three.angle}
              min={0} max={360} step={1}
              format={(v) => `${Math.round(v)}°`}
              onChange={(v) => write3D({ angle: v })}
            />
            <Field label="Side colour">
              <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(8, minmax(0, 1fr))' }}>
                {QUICK_COLORS.map((c) => (
                  <Swatch key={c} color={c} active={(three.color || '').toLowerCase() === c.toLowerCase()} onClick={() => write3D({ color: c })} />
                ))}
              </div>
            </Field>
            {three.color && (
              <OptBtn height={26} onClick={() => write3D({ color: undefined })} title="Derive the side colour from the ink again">
                <span className="text-[10px]">Match the text colour</span>
              </OptBtn>
            )}
          </>
        )}

        <Slider
          label="Lean back"
          value={three.tiltX}
          min={-60} max={60} step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={(v) => write3D({ tiltX: v })}
        />
        <Slider
          label="Turn"
          value={three.tiltY}
          min={-60} max={60} step={1}
          format={(v) => `${Math.round(v)}°`}
          onChange={(v) => write3D({ tiltY: v })}
        />
        {(three.tiltX !== 0 || three.tiltY !== 0) && (
          <Slider
            label="Perspective"
            value={three.perspective}
            min={300} max={2400} step={50}
            format={(v) => `${Math.round(v)}`}
            onChange={(v) => write3D({ perspective: v })}
          />
        )}

        <RowBtn
          active={three.shine}
          onClick={() => write3D({ shine: !three.shine })}
          title="A chrome highlight band across the face of the letters"
          icon={<Icon size={12}><path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></Icon>}
        >
          {three.shine ? 'Chrome shine on' : 'Chrome shine'}
        </RowBtn>

        {(three.depth || three.tiltX || three.tiltY || three.shine) ? (
          <OptBtn height={26} onClick={() => write({ three: { ...DEFAULT_3D } })} title="Back to flat">
            <span className="text-[10px]">Flatten</span>
          </OptBtn>
        ) : null}
      </Group>

      {/* -------------------------------------------------------- MOTION -- */}
      <Group id="tp-motion" label="Motion">
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <OptBtn height={28} active={!anim} title="No animation" onClick={() => write({ anim: undefined })}>
            <span className="text-[10px]">None</span>
          </OptBtn>
          {PATH_ANIMS.map((a) => (
            <OptBtn
              key={a.id}
              height={28}
              active={anim === a.id}
              title={a.hint}
              onClick={() => write({ anim: { preset: a.id, speed: cfg.anim?.speed || 1 } })}
            >
              <span className="text-[10px] truncate">{a.name}</span>
            </OptBtn>
          ))}
        </div>
        {anim && (
          <Slider
            label="Speed"
            value={cfg.anim?.speed || 1}
            min={0.25} max={3} step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => write({ anim: { preset: anim, speed: v } })}
          />
        )}
      </Group>
    </>
  );
}

/* -------------------------------------------------------------- creation -- */

/**
 * Drop a ready-made curve on the board, for people who'd rather pick than draw.
 * Shared by the rail's shape grid and the insert menu.
 */
export function makePathTextObject(
  shapeId: string,
  centre: { x: number; y: number },
  textStyle: { fontSize: number; fontFamily: string; fontWeight: number; textColor: string },
) {
  const width = 520;
  const height = 300;
  /* Sized to the box the preset lands in, on the same "about fifteen characters
     across" rule the freehand tool uses — not inherited from body text. */
  const fontSize = 44;
  return {
    type: 'text' as const,
    x: centre.x - width / 2,
    y: centre.y - height / 2,
    width,
    height,
    content: '',
    style: {
      fontFamily: textStyle.fontFamily,
      fontWeight: Math.max(600, textStyle.fontWeight || 600),
      textColor: textStyle.textColor,
      fontSize,
      isResized: true,
      textPath: applyShape(defaultTextPath(), shapeId),
    },
  };
}

/** The `d` of a preset at a given size — used by previews outside this file. */
export function previewD(cfg: TextPathConfig, w: number, h: number) {
  return pathD(cfg, w, h);
}
