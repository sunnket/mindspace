'use client';

import { useRef } from 'react';
import { useCanvasStore } from '@/store/canvasStore';

export type ZoomTier = 'far' | 'mid' | 'near';

// Tier thresholds (canvas scale). A small hysteresis band keeps the tier from
// flickering when the user hovers a zoom gesture right on a boundary.
const FAR_MAX = 0.4;
const NEAR_MIN = 0.9;
const H = 0.04;

function computeTier(zoom: number, current: ZoomTier): ZoomTier {
  switch (current) {
    case 'near':
      if (zoom < NEAR_MIN - H) return zoom < FAR_MAX - H ? 'far' : 'mid';
      return 'near';
    case 'mid':
      if (zoom >= NEAR_MIN + H) return 'near';
      if (zoom < FAR_MAX - H) return 'far';
      return 'mid';
    case 'far':
      if (zoom >= NEAR_MIN + H) return 'near';
      if (zoom >= FAR_MAX + H) return 'mid';
      return 'far';
  }
}

/**
 * Fathom's levels-of-detail signal. Returns 'far' | 'mid' | 'near' from the
 * current camera scale, with hysteresis so it never flaps mid-gesture.
 * Only changes at the two thresholds, so downstream components can memoize on it.
 */
export function useZoomTier(): ZoomTier {
  const zoom = useCanvasStore((s) => s.camera.zoom);
  const tierRef = useRef<ZoomTier>('near');
  tierRef.current = computeTier(zoom, tierRef.current);
  return tierRef.current;
}
