'use client';

import React from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import ShapePreview from '@/components/canvas/ShapePreview';
import RailShell from './RailShell';
import { Icon, Group, Field, Hint } from './RailKit';
import ShapePicker from './ShapePicker';
import { SHAPE_CATALOG } from '@/lib/shapeCatalog';

/**
 * The shape tool: pick a glyph, pick its finish, click the board.
 *
 * The catalogue is two hundred shapes deep, which a bottom flyout could only
 * show sixteen of at a time behind ten tabs and no search. Up here it gets a
 * search box, the full height of the rail, and a preview of exactly what will
 * land when you click.
 */

const STYLES = [
  { name: 'Cream', bg: 'rgba(255, 252, 248, 0.75)', border: 'var(--accent-light)' },
  { name: 'Peach', bg: 'rgba(232, 169, 123, 0.15)', border: 'var(--accent)' },
  { name: 'Sage', bg: 'rgba(69, 183, 97, 0.15)', border: 'rgba(69, 183, 97, 0.5)' },
  { name: 'Sky', bg: 'rgba(74, 144, 217, 0.15)', border: 'rgba(74, 144, 217, 0.5)' },
  { name: 'Amethyst', bg: 'rgba(155, 89, 182, 0.15)', border: 'rgba(155, 89, 182, 0.5)' },
];

export default function ShapeRail() {
  const setMode = useCanvasStore((s) => s.setMode);
  const selectedShapeType = useCanvasStore((s) => s.selectedShapeType);
  const setSelectedShapeType = useCanvasStore((s) => s.setSelectedShapeType);
  const shapeStyle = useCanvasStore((s) => s.shapeStyle);
  const setShapeStyle = useCanvasStore((s) => s.setShapeStyle);

  const current = SHAPE_CATALOG.find((s) => s.id === selectedShapeType);
  const fill = (shapeStyle?.color as string) || STYLES[0].bg;
  const stroke = (shapeStyle?.borderColor as string) || STYLES[0].border;

  return (
    <RailShell
      railKey="shape-tool"
      icon={<Icon size={14}><circle cx="8.5" cy="8.5" r="5" /><rect x="10" y="10" width="10" height="10" rx="2" /></Icon>}
      title="Shape"
      subtitle={current ? current.label : 'Pick one, then click the board'}
      onClose={() => setMode('select')}
      closeTitle="Back to the select tool"
    >
      <Hint>Choose a shape, then click anywhere on the board to place it.</Hint>

      {/* What's loaded, at the size it'll be stamped. */}
      <div
        className="flex items-center gap-3 rounded-[12px]"
        style={{ marginTop: 10, padding: 10, background: 'var(--well)' }}
      >
        <span
          className="shrink-0 flex items-center justify-center rounded-[10px]"
          style={{ width: 46, height: 46, background: fill, boxShadow: `inset 0 0 0 1.5px ${stroke}` }}
        >
          <ShapePreview type={selectedShapeType || 'square'} size={26} fill="transparent" stroke={stroke} />
        </span>
        <span className="flex flex-col gap-[3px] min-w-0">
          <span className="text-[12px] font-extrabold text-[var(--text-primary)] truncate">{current?.label || 'Square'}</span>
          <span className="text-[9.5px] font-semibold text-[var(--text-tertiary)]">Loaded — click to place</span>
        </span>
      </div>

      <Group id="shape-catalog" label="Catalogue">
        <ShapePicker value={selectedShapeType} onPick={(id) => setSelectedShapeType(id)} />
      </Group>

      <Group id="shape-finish" label="Finish">
        <Field label="Fill & stroke">
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(5, 34px)', justifyContent: 'start' }}>
            {STYLES.map((s) => {
              const active = fill === s.bg;
              return (
                <button
                  key={s.name}
                  onClick={() => setShapeStyle({ color: s.bg, borderColor: s.border })}
                  title={s.name}
                  className="rounded-[9px] transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                  style={{
                    height: 30,
                    background: s.bg,
                    boxShadow: active
                      ? `inset 0 0 0 1.5px ${s.border}, 0 0 0 2px var(--accent)`
                      : `inset 0 0 0 1.5px ${s.border}`,
                  }}
                />
              );
            })}
          </div>
        </Field>
      </Group>
    </RailShell>
  );
}
