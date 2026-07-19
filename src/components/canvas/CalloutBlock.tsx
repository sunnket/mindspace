'use client';

import React from 'react';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import RichText from './RichText';

/**
 * A writer's "pay attention here" box — distinct from Quote (someone else's
 * words) and Sticky (freeform). Five kinds, each with its own accent + icon.
 * Tap the icon to cycle the kind. Its body is ordinary rich text, so bold,
 * highlight, math and @-mentions all work inside it.
 */

type CalloutKind = 'note' | 'warning' | 'idea' | 'question' | 'success';

const KIND_ORDER: CalloutKind[] = ['note', 'warning', 'idea', 'question', 'success'];

const KINDS: Record<CalloutKind, { label: string; accent: string; rgb: string; icon: React.ReactNode }> = {
  note: {
    label: 'Note', accent: '#3B82F6', rgb: '59, 130, 246',
    icon: (<><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="7.5" x2="12" y2="7.6" /></>),
  },
  warning: {
    label: 'Warning', accent: '#F59E0B', rgb: '245, 158, 11',
    icon: (<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12" y2="17.01" /></>),
  },
  idea: {
    label: 'Idea', accent: '#8B5CF6', rgb: '139, 92, 246',
    icon: (<><path d="M9 18h6" /><path d="M10 22h4" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" /></>),
  },
  question: {
    label: 'Question', accent: '#6366F1', rgb: '99, 102, 241',
    icon: (<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3" /><line x1="12" y1="17" x2="12" y2="17.01" /></>),
  },
  success: {
    label: 'Success', accent: '#22C55E', rgb: '34, 197, 94',
    icon: (<><circle cx="12" cy="12" r="9" /><polyline points="8.5 12 11 14.5 15.5 9.5" /></>),
  },
};

export default function CalloutBlock({ obj, isEditing, onBlur, innerRef }: {
  obj: CanvasObjectData;
  isEditing: boolean;
  onBlur: () => void;
  innerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const kind: CalloutKind = (KINDS[obj.style?.calloutKind as CalloutKind] ? (obj.style?.calloutKind as CalloutKind) : 'note');
  const conf = KINDS[kind];

  const cycleKind = () => {
    const next = KIND_ORDER[(KIND_ORDER.indexOf(kind) + 1) % KIND_ORDER.length];
    updateObject(obj.id, { style: { ...obj.style, calloutKind: next } });
  };

  return (
    <div
      className="w-full h-full flex items-stretch gap-3"
      style={{
        padding: '14px 16px',
        borderRadius: 12,
        borderLeft: `4px solid ${conf.accent}`,
        background: `rgba(${conf.rgb}, 0.12)`,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        title={`${conf.label} — click to change`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); cycleKind(); }}
        style={{
          flexShrink: 0, width: 24, height: 24, marginTop: 1,
          color: conf.accent, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {conf.icon}
        </svg>
      </button>

      <div className="flex flex-col min-w-0" style={{ flex: 1, overflow: 'hidden' }}>
        <span
          className="select-none"
          style={{ color: conf.accent, fontWeight: 700, fontSize: 12, letterSpacing: '0.02em', marginBottom: 3 }}
        >
          {conf.label}
        </span>
        {isEditing ? (
          <div
            key="edit"
            ref={innerRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={onBlur}
            className="text-block-editable"
            data-placeholder="Write your note…"
            style={{
              outline: 'none',
              fontFamily: (obj.style?.fontFamily as string) || "'Inter', sans-serif",
              fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '14px',
              color: 'var(--text-primary)',
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          />
        ) : (
          <div
            key="display"
            className="text-block-display select-none"
            style={{
              fontFamily: (obj.style?.fontFamily as string) || "'Inter', sans-serif",
              fontSize: obj.style?.fontSize ? `${obj.style.fontSize}px` : '14px',
              color: 'var(--text-primary)',
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowY: 'auto',
            }}
          >
            <RichText
              content={obj.content || ''}
              persistedCollapsed={obj.style?.toggleCollapsed as Record<string, boolean> | undefined}
              onCollapseChange={(next) => updateObject(obj.id, { style: { ...obj.style, toggleCollapsed: next } })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
