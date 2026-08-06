'use client';

import React from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { PATH_SHAPES, splineD, polylineD } from '@/lib/textPath';
import RailShell from './RailShell';
import { Icon, Group, Hint, OptBtn } from './RailKit';
import { makePathTextObject } from './TextPathPanel';

/**
 * The rail while the text-on-path tool is up.
 *
 * Drawing your own line is the point of the tool, so the instructions come
 * first — but "draw something" is a cold start, and half the time what someone
 * wants is a circle. The catalogue is right here, one tap, no drawing.
 */

function Thumb({ id }: { id: string }) {
  const s = PATH_SHAPES.find((p) => p.id === id);
  if (!s) return null;
  const pts = s.points.map((p) => ({ x: 3 + p.x * 46, y: 3 + p.y * 26 }));
  const d = (s.curve === 'sharp' ? polylineD : splineD)(pts, !!s.closed);
  return (
    <svg width="52" height="32" viewBox="0 0 52 32" fill="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function TextPathRail() {
  const setMode = useCanvasStore((s) => s.setMode);
  const addObject = useCanvasStore((s) => s.addObject);
  const setSelectedId = useCanvasStore((s) => s.setSelectedId);
  const setEditingId = useCanvasStore((s) => s.setEditingId);

  const place = (shapeId: string) => {
    const st = useCanvasStore.getState();
    const { camera } = st;
    const centre = {
      x: (-camera.x + window.innerWidth / 2) / camera.zoom,
      y: (-camera.y + window.innerHeight / 2) / camera.zoom,
    };
    const obj = addObject(makePathTextObject(shapeId, centre, st.textStyle));
    setMode('select');
    setSelectedId(obj.id);
    setEditingId(obj.id);
  };

  return (
    <RailShell
      railKey="textpath"
      icon={<Icon size={14}><path d="M3 16c5-11 13-11 18 0" /><path d="M7 12.5h.01M12 10.6h.01M17 12.5h.01" /></Icon>}
      title="Text on a path"
      subtitle="Draw the line, then write"
      closeTitle="Put the tool down"
      onClose={() => setMode('select')}
    >
      <Hint>
        Click to drop points along the line you want — double-click to finish.
        Or press and drag to draw it freehand. Then just type.
      </Hint>

      <Group id="tp-tool-shapes" label="Or start from a shape">
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {PATH_SHAPES.map((s) => (
            <button
              key={s.id}
              onClick={() => place(s.id)}
              title={`${s.name} — placed in the middle of the view`}
              className="rounded-[9px] flex flex-col items-center justify-center gap-0.5 bg-[var(--well)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:brightness-[0.97] transition-all duration-150 cursor-pointer active:scale-[0.96]"
              style={{ height: 50 }}
            >
              <Thumb id={s.id} />
              <span className="text-[8px] font-bold uppercase tracking-wide truncate w-full text-center" style={{ paddingBottom: 3 }}>{s.name}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group id="tp-tool-keys" label="While you draw">
        <div className="flex flex-col gap-1">
          {[
            ['Click', 'Drop a point'],
            ['Drag', 'Draw it freehand'],
            ['Double-click', 'Finish the line'],
            ['First dot', 'Close it into a loop'],
            ['Enter / Esc', 'Finish / start over'],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 rounded-[8px] bg-[var(--well)]" style={{ padding: '5px 8px' }}>
              <span className="text-[9.5px] font-extrabold uppercase tracking-wide text-[var(--text-tertiary)] shrink-0" style={{ minWidth: 78 }}>{k}</span>
              <span className="text-[10px] font-semibold text-[var(--text-secondary)] truncate">{v}</span>
            </div>
          ))}
        </div>
        <OptBtn height={26} onClick={() => setMode('select')} title="Back to the select tool">
          <span className="text-[10px]">Done</span>
        </OptBtn>
      </Group>
    </RailShell>
  );
}
