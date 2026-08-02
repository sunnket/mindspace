'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * ONE definition of "this is a phone", shared by CSS and by JS.
 *
 * `PHONE_QUERY` below is character-for-character the media query every block in
 * `app/mobile.css` is written against, and that is the point: a layout CSS has
 * already collapsed into a sheet must not still be a 300px sidebar as far as
 * React is concerned. Every disagreement between the two is a panel stuck
 * half-way between two designs.
 *
 * Two clauses, because width alone is not enough:
 *
 *   · 820px rather than a round 768 — a landscape phone is ~740–850 CSS px
 *     wide and is, for every purpose in this app, still a phone.
 *   · Short AND not-wide, which is the case width alone misses: an iPhone
 *     turned sideways is 844×390. Too wide for the first clause, and 390px of
 *     height cannot hold a thirteen-button toolbar and a minimap.
 *
 * The `and (max-width: 1024px)` on the second clause is what keeps real desktops
 * out: a 1440px window that happens to be short is still a desktop.
 *
 * Tablets in portrait (821–1024 wide, tall) match neither, and keep the desktop
 * layout — which fits there comfortably.
 */
export const PHONE_MAX = 820;

/** Wider than a phone but too narrow for the docked rail + minimap together. */
export const TABLET_MAX = 1024;

export const PHONE_QUERY =
  `(max-width: ${PHONE_MAX}px), (max-height: 520px) and (max-width: ${TABLET_MAX}px)`;

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener('change', onChange);
  /* Orientation changes fire `resize` before `matchMedia` settles on some
     Android browsers, and the visual viewport shrinks (keyboard) without either
     firing. Listening to all three costs nothing — the snapshot is a pure read
     and React bails out when it is unchanged. */
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  return () => {
    mq.removeEventListener('change', onChange);
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}

function getSnapshot() {
  return window.matchMedia(PHONE_QUERY).matches;
}

/* The server has no width. Rendering the phone layout there and the desktop one
   on the client (or vice-versa) is a hydration mismatch, so the server always
   answers "not a phone" and the first client commit corrects it. Every consumer
   of this hook renders inside `dynamic(..., { ssr: false })` anyway, so in
   practice that correction happens before anything is on screen. */
const getServerSnapshot = () => false;

/** True on phone-sized viewports. Re-renders on rotate/resize. */
export function useIsPhone() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * True when the primary input is a finger rather than a mouse.
 *
 * Kept separate from `useIsPhone` because they answer different questions: a
 * touchscreen laptop is coarse-pointered but has room for the full desktop
 * layout, and a phone browser in "desktop site" mode is narrow-ish but reports
 * a fine pointer. Layout follows width; hit-target size follows this.
 */
export function useIsTouch() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const sync = () => setTouch(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return touch;
}

/** Non-reactive read, for event handlers and imperative code. */
export function isPhoneViewport() {
  return typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches;
}

/** Non-reactive read of "finger-driven", for gesture code. */
export function isCoarsePointer() {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}
