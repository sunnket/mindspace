import { create } from 'zustand';

/**
 * The notice layer.
 *
 * Before this the app had exactly two ways to tell you something had happened,
 * and both were wrong.
 *
 *  · Anything that FAILED went to `console.error` — which is to say nowhere. A
 *    cloud flush that never landed (syncService), a delete that didn't reach the
 *    server (db.ts), an export that threw: the board looked pixel-identical
 *    whether the write succeeded or not. The one state a local-first app must
 *    never be silent about is the one where the local copy and the cloud copy
 *    have quietly diverged.
 *  · The one thing that DID speak used `alert()` — a modal browser dialog that
 *    freezes the page, cannot be styled, and lands like a 1998 popup on top of a
 *    hand-tuned clay-and-glass interface.
 *
 * A toast is the honest middle. It appears, says one specific thing, and leaves
 * on its own without taking the board hostage.
 *
 * Two decisions here are load-bearing rather than cosmetic:
 *
 *  1. `key` DEDUPES. The sync loop retries on a timer, so a Supabase project
 *     that is paused or unreachable would otherwise stack one identical toast
 *     per attempt until the notice column was taller than the screen. A toast
 *     posted with a key that is already on screen REPLACES it in place and
 *     restarts its timer, so a repeating failure reads as one persistent
 *     condition — which is what it is — instead of a flood.
 *  2. `duration: 0` means STICKY. Anything the user must act on (offline,
 *     sync failed) stays until it is resolved or dismissed, because a message
 *     that vanishes before it is read is the same as no message.
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  /** Return `false` to keep the toast on screen; anything else dismisses it. */
  onClick: () => void | boolean;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  /** Optional second line — the detail, when the headline alone isn't actionable. */
  detail?: string;
  /** Stable identity for a recurring condition. Re-posting the same key replaces. */
  key?: string;
  /** ms on screen. 0 = sticky until dismissed or replaced. */
  duration: number;
  action?: ToastAction;
  createdAt: number;
}

/** How long each kind lingers by default.
 *
 *  An error gets more than double a success because they are read differently:
 *  a success only has to be GLIMPSED (you already knew what you did — the toast
 *  just confirms it landed), while an error has to be READ, and often names a
 *  thing you now have to decide about. */
const DEFAULT_MS: Record<ToastKind, number> = {
  success: 2600,
  info: 4000,
  error: 6500,
};

export interface ToastInput {
  message: string;
  detail?: string;
  kind?: ToastKind;
  key?: string;
  duration?: number;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  push: (input: ToastInput | string) => string;
  dismiss: (id: string) => void;
  /** Remove by `key` — for a condition that has RESOLVED (back online, sync caught up). */
  dismissKey: (key: string) => void;
  clear: () => void;
}

/** The screen holds a few notices at once; past that the oldest fall off the top.
 *  A stack taller than this stops being a notification and starts being a wall. */
const MAX_VISIBLE = 4;

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  push: (input) => {
    const cfg: ToastInput = typeof input === 'string' ? { message: input } : input;
    const kind = cfg.kind ?? 'info';
    const id = `t${++seq}`;
    const toast: Toast = {
      id,
      kind,
      message: cfg.message,
      detail: cfg.detail,
      key: cfg.key,
      duration: cfg.duration ?? DEFAULT_MS[kind],
      action: cfg.action,
      createdAt: Date.now(),
    };

    set((s) => {
      // A keyed re-post is the SAME condition speaking again, not a new event:
      // swap it where it stands so the column doesn't reshuffle under the eye.
      if (cfg.key) {
        const at = s.toasts.findIndex((t) => t.key === cfg.key);
        if (at !== -1) {
          const next = s.toasts.slice();
          next[at] = { ...toast, id: s.toasts[at].id };
          return { toasts: next };
        }
      }
      return { toasts: [...s.toasts, toast].slice(-MAX_VISIBLE) };
    });

    return id;
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  dismissKey: (key) => set((s) => ({ toasts: s.toasts.filter((t) => t.key !== key) })),
  clear: () => set({ toasts: [] }),
}));

/**
 * Imperative helpers, so a plain module (syncService, db, exportBoard) can raise
 * a notice without being a React component or importing the store shape. This is
 * the form every call site should use.
 */
export const toast = {
  show: (input: ToastInput | string) => useToastStore.getState().push(input),
  success: (message: string, extra?: Omit<ToastInput, 'message' | 'kind'>) =>
    useToastStore.getState().push({ ...extra, message, kind: 'success' }),
  error: (message: string, extra?: Omit<ToastInput, 'message' | 'kind'>) =>
    useToastStore.getState().push({ ...extra, message, kind: 'error' }),
  info: (message: string, extra?: Omit<ToastInput, 'message' | 'kind'>) =>
    useToastStore.getState().push({ ...extra, message, kind: 'info' }),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  /** The condition cleared — take its notice down. */
  resolve: (key: string) => useToastStore.getState().dismissKey(key),
};
