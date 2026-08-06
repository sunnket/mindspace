'use client';

import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useToastStore, type Toast } from '@/store/toastStore';

/**
 * Where notices live.
 *
 * POSITION is the whole design problem here, because every other edge of this
 * app is already spoken for: the toolbar owns bottom-centre, the trash pile
 * bottom-left, and the minimap and properties rail together own the entire
 * right-hand column (see the `.props-rail` note in globals.css). The one lane
 * that is free in every state is directly ABOVE the toolbar — which is also
 * where the eye already is, since the toolbar is the app's home base.
 *
 * The container is `pointer-events: none` and only the cards themselves take
 * clicks, so a notice floating over the board can never swallow a drag, a
 * marquee, or a toolbar flyout opening underneath it.
 *
 * A single `aria-live="polite"` region wraps the stack so a screen reader
 * announces each notice as it arrives without interrupting what is being read —
 * the whole point of this layer is that it informs without seizing control, and
 * that has to be true whether you are looking at it or listening to it.
 */

function Icon({ kind }: { kind: Toast['kind'] }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (kind === 'success') {
    return <svg {...common}><path d="M20 6 9 17l-5-5" /></svg>;
  }
  if (kind === 'error') {
    return <svg {...common}><path d="M12 8v5" /><path d="M12 16.5v.01" /><circle cx="12" cy="12" r="9" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.5v.01" /></svg>;
}

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const hovered = useRef(false);

  /* The dismiss timer restarts whenever the toast's IDENTITY or duration
     changes — which is exactly what a keyed re-post does (same slot, new
     content), so a recurring condition keeps its notice alive instead of
     letting a stale timer from the first occurrence pull it out from under the
     newest message. `duration: 0` opts out entirely: sticky until acted on. */
  useEffect(() => {
    if (!toast.duration) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = (ms: number) => { timer = setTimeout(() => {
      // Never yank a notice out from under a pointer that is resting on it —
      // hovering is the universal "I am reading this / about to click this".
      if (hovered.current) { arm(600); return; }
      dismiss(toast.id);
    }, ms); };
    arm(toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, toast.createdAt, dismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.97, transition: { duration: 0.16 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      className={`toast toast-${toast.kind}`}
      onMouseEnter={() => { hovered.current = true; }}
      onMouseLeave={() => { hovered.current = false; }}
    >
      <span className="toast-icon" aria-hidden="true"><Icon kind={toast.kind} /></span>

      <div className="toast-body">
        <span className="toast-message">{toast.message}</span>
        {toast.detail && <span className="toast-detail">{toast.detail}</span>}
      </div>

      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            const keep = toast.action!.onClick();
            if (keep !== false) dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}

      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss notification"
        onClick={() => dismiss(toast.id)}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </motion.div>
  );
}

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);

  return (
    <div className="toaster" role="region" aria-label="Notifications">
      <div aria-live="polite" aria-atomic="false" className="toaster-stack">
        <AnimatePresence initial={false}>
          {toasts.map((t) => <ToastCard key={t.id} toast={t} />)}
        </AnimatePresence>
      </div>
    </div>
  );
}
