'use client';

import React from 'react';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import { ZoomTier } from '@/hooks/useZoomTier';

interface Described {
  kind: 'text' | 'image' | 'block';
  tag?: string;
  title: string;
  summary?: string;
  tint: string;
  heading?: boolean;
  stickyColor?: string;
}

function s(obj: CanvasObjectData, key: string): string {
  const v = obj.style?.[key];
  return typeof v === 'string' ? v : '';
}

/** Reduces any object to the minimal info shown when zoomed out. */
function describe(obj: CanvasObjectData): Described {
  const style = obj.style || {};
  const firstLine = (obj.content || '').split('\n')[0].trim();
  const rest = (obj.content || '').split('\n').slice(1).join(' ').trim();
  const summary = obj.summary || rest;

  if (obj.type === 'image') return { kind: 'image', tag: 'Image', title: '', tint: '#9E9790' };

  if (obj.type === 'card') {
    if (style.isPoll) return { kind: 'block', tag: 'Poll', title: s(obj, 'pollQuestion') || 'Poll', tint: '#8B5FBF' };
    if (style.isCountdown) return { kind: 'block', tag: 'Countdown', title: s(obj, 'countdownTitle') || 'Countdown', tint: '#C97B4B' };
    if (style.isLiveMetric) return { kind: 'block', tag: 'Metric', title: s(obj, 'metricTitle') || s(obj, 'metricValue') || 'Metric', tint: '#2F9E6E' };
    if (style.isQuickData) return { kind: 'block', tag: 'Data', title: 'Quick data', tint: '#C9904B' };
    if (style.isTimer) return { kind: 'block', tag: 'Timer', title: s(obj, 'timerLabel') || 'Focus timer', tint: '#3E63DD' };
    if (style.isDecision) return { kind: 'block', tag: 'Decide', title: s(obj, 'decisionTitle') || 'Decision', tint: '#E93D82' };
    if (style.isProgress) return { kind: 'block', tag: 'Goal', title: s(obj, 'progressLabel') || 'Progress', tint: '#2F9E6E' };
    if (style.isTodo) return { kind: 'block', tag: 'Checklist', title: firstLine || 'Checklist', tint: '#3E63DD' };
    if (style.isCode) return { kind: 'block', tag: 'Code', title: firstLine || 'Code', tint: '#2D2A26' };
    if (style.isQuote) return { kind: 'block', tag: 'Quote', title: firstLine || 'Quote', tint: '#C97B4B' };
    if (style.isVoiceNote) return { kind: 'block', tag: 'Voice', title: firstLine || 'Voice note', tint: '#8B5FBF' };
    if (style.isCheckpoint) return { kind: 'block', tag: 'Flag', title: obj.content || 'Checkpoint', tint: '#E5484D' };
  }

  if (obj.type === 'heading') return { kind: 'text', title: firstLine || 'Heading', summary, tint: 'var(--accent)', heading: true };
  if (obj.type === 'sticky') return { kind: 'text', title: firstLine || 'Note', summary, tint: '#C9904B', stickyColor: s(obj, 'color') || 'var(--sticky-yellow)' };
  if (obj.type === 'workflow-node') return { kind: 'text', title: firstLine || 'Node', summary, tint: s(obj, 'borderColor') || 'var(--accent)' };

  return { kind: 'text', title: firstLine || (obj.type === 'text' ? 'Text' : 'Card'), summary, tint: 'var(--accent)' };
}

const CLAY_STYLE: React.CSSProperties = {
  background: '#FFFDFA',
  border: '1px solid rgba(201,123,75,0.14)',
  boxShadow:
    'inset 0 1.5px 0 rgba(255,255,255,0.95), 0 12px 24px -14px rgba(90,62,40,0.20), 0 3px 8px -5px rgba(90,62,40,0.08)',
};

/**
 * Fathom's stand-in for a full CanvasObject at far/mid zoom. Renders a tiny,
 * legible summary instead of the heavy real component — which makes a 500-card
 * board read like a calm table of contents (and renders far fewer DOM nodes).
 * Clicking it selects the object, which promotes it back to the full render.
 */
function SemanticCardImpl({ obj, tier }: { obj: CanvasObjectData; tier: ZoomTier }) {
  const setSelectedId = useCanvasStore((st) => st.setSelectedId);
  const animateCamera = useCanvasStore((st) => st.animateCamera);
  const d = describe(obj);

  const select = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedId(obj.id);
  };
  const zoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    animateCamera(
      {
        x: window.innerWidth / 2 - (obj.x + obj.width / 2),
        y: window.innerHeight / 2 - (obj.y + obj.height / 2),
        zoom: 1,
      },
      600
    );
    setSelectedId(obj.id);
  };

  const positioned: React.CSSProperties = {
    left: obj.x,
    top: obj.y,
    width: obj.width,
    height: obj.height,
    zIndex: obj.zIndex || 1,
    rotate: obj.rotation ? `${obj.rotation}deg` : undefined,
  };

  /* ---------------- FAR: title only, large & legible ---------------- */
  if (tier === 'far') {
    const fontSize = Math.max(15, Math.min(obj.height * 0.34, obj.width / 6, 46));
    const bg = d.stickyColor || (d.kind === 'block' ? `${d.tint}14` : '#FFFDFA');
    return (
      <div className="canvas-object absolute semantic-fade cursor-pointer select-none" style={positioned} onMouseDown={select} onDoubleClick={zoomIn}>
        <div
          className="w-full h-full rounded-[18px] flex items-center justify-center px-5 overflow-hidden"
          style={{ ...CLAY_STYLE, background: bg }}
        >
          {d.kind === 'image' ? (
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#9E9790" strokeWidth="1.5" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          ) : (
            <span
              className="font-bold text-center leading-tight line-clamp-3"
              style={{
                fontSize,
                color: d.heading ? 'var(--accent)' : 'var(--text-primary)',
                fontFamily: d.heading ? "'Instrument Serif', serif" : "'Outfit', sans-serif",
              }}
            >
              {d.title}
            </span>
          )}
        </div>
      </div>
    );
  }

  /* ---------------- MID: title + summary + thumbnail ---------------- */
  return (
    <div className="canvas-object absolute semantic-fade cursor-pointer select-none" style={positioned} onMouseDown={select} onDoubleClick={zoomIn}>
      <div
        className="w-full h-full rounded-[18px] overflow-hidden flex flex-col"
        style={{ ...CLAY_STYLE, background: d.stickyColor || '#FFFDFA' }}
      >
        {d.kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={obj.content} alt="" className="w-full h-full object-cover" draggable={false} />
        ) : (
          <div className="flex flex-col h-full p-4 gap-1.5">
            {d.tag && (
              <span
                className="self-start px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider shrink-0"
                style={{ background: `${d.tint}1A`, color: d.tint }}
              >
                {d.tag}
              </span>
            )}
            <h4
              className="font-bold leading-tight line-clamp-2 shrink-0"
              style={{
                fontSize: d.heading ? 20 : 15,
                color: d.heading ? 'var(--accent)' : 'var(--text-primary)',
                fontFamily: d.heading ? "'Instrument Serif', serif" : "'Outfit', sans-serif",
              }}
            >
              {d.title}
            </h4>
            {d.summary && (
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed line-clamp-4 flex-1" style={{ fontFamily: "'Outfit', sans-serif" }}>
                {d.summary}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(SemanticCardImpl);
