'use client';

import type { RelaxEffectId } from '@/lib/relaxEffects';

/**
 * Line icons for the Stress Reliefer picker. The cursors in globals.css
 * (`.canvas-container.mode-relax.relax-*`) draw the same glyphs — keep the two
 * in step if you change one.
 */
export default function RelaxIcon({ id, size = 18 }: { id: RelaxEffectId; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (id) {
    case 'flowers':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="2.4" />
          <ellipse cx="12" cy="6.4" rx="2.3" ry="3.3" />
          <ellipse cx="12" cy="17.6" rx="2.3" ry="3.3" />
          <ellipse cx="6.4" cy="12" rx="3.3" ry="2.3" />
          <ellipse cx="17.6" cy="12" rx="3.3" ry="2.3" />
        </svg>
      );

    case 'rain':
      return (
        <svg {...common}>
          <path d="M7 14.5h10a3.6 3.6 0 0 0 .3-7.2 5.2 5.2 0 0 0-9.9-1.3A4 4 0 0 0 7 14.5Z" />
          <path d="M8.6 17.4 7.6 20.4" />
          <path d="M12.5 17.4 11.5 20.4" />
          <path d="M16.4 17.4 15.4 20.4" />
        </svg>
      );

    case 'fireworks':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="1.5" />
          <path d="M12 3.2v3.4M12 17.4v3.4M3.2 12h3.4M17.4 12h3.4" />
          <path d="m5.8 5.8 2.4 2.4M15.8 15.8l2.4 2.4M18.2 5.8l-2.4 2.4M8.2 15.8l-2.4 2.4" />
        </svg>
      );

    case 'galaxy':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="12" rx="9" ry="4.2" transform="rotate(-22 12 12)" />
          <circle cx="12" cy="12" r="1.7" />
        </svg>
      );

    case 'koi':
      return (
        <svg {...common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 3s-4.05 1.75-6 3c-2.4 1.55-5 3.07-7.5 5.5C7.03 13.9 6 16.5 6 18c0 .8.2 1.5.5 2L3 22l2.5-3.5c.5.3 1.2.5 2 .5 1.5 0 4.1-.97 6.5-3.5 2.43-2.5 3.95-5.1 5.5-7.5 1.25-1.95 3-6 3-6Z" />
          <path d="M18 8.5c-.5.8-1.5 1.5-2.5 2M8.5 18c.8-.5 1.5-1.5 2-2.5" />
        </svg>
      );

    case 'bubblewrap':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="2.9" />
          <circle cx="16.8" cy="7" r="2.9" />
          <circle cx="7" cy="16.8" r="2.9" />
          <circle cx="16.8" cy="16.8" r="2.9" opacity="0.35" />
        </svg>
      );

    case 'chimes':
      return (
        <svg {...common}>
          <path d="M3.5 4h17" />
          <path d="M7 4.5v14" />
          <path d="M12 4.5v10.5" />
          <path d="M17 4.5v7" />
        </svg>
      );

    case 'ripples':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="12" r="5.8" opacity="0.7" />
          <circle cx="12" cy="12" r="9.4" opacity="0.4" />
        </svg>
      );

    case 'ocean':
      return (
        <svg {...common}>
          <path d="M2.5 16.5c1.6 0 1.6-1.8 3.2-1.8s1.6 1.8 3.2 1.8 1.6-1.8 3.2-1.8 1.6 1.8 3.2 1.8 1.6-1.8 3.2-1.8 1.6 1.8 3.2 1.8" />
          <path d="M2.5 20.4c1.6 0 1.6-1.8 3.2-1.8s1.6 1.8 3.2 1.8 1.6-1.8 3.2-1.8 1.6 1.8 3.2 1.8 1.6-1.8 3.2-1.8 1.6 1.8 3.2 1.8" opacity="0.5" />
          <circle cx="17.5" cy="6.5" r="2.8" />
        </svg>
      );

    case 'handpan':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="12.5" rx="9.2" ry="7.6" />
          <circle cx="12" cy="12.5" r="2.2" />
          <circle cx="12" cy="6.6" r="1" fill="currentColor" stroke="none" />
          <circle cx="18" cy="12.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="6" cy="12.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="18.4" r="1" fill="currentColor" stroke="none" />
        </svg>
      );

    case 'snow':
      return (
        <svg {...common}>
          <path d="M12 2.8v18.4M4 7.4l16 9.2M20 7.4 4 16.6" />
          <path d="m9.6 4.4 2.4 2.2 2.4-2.2M9.6 19.6l2.4-2.2 2.4 2.2" />
        </svg>
      );

    case 'fireflies':
      return (
        <svg {...common}>
          <circle cx="8" cy="8.5" r="1.9" />
          <circle cx="16.5" cy="6.8" r="1.3" opacity="0.7" />
          <circle cx="15.2" cy="15.4" r="2.2" />
          <circle cx="6.6" cy="16.8" r="1.3" opacity="0.7" />
          <path d="M8 5.4v-1.6M15.2 12v-1.6" opacity="0.5" />
        </svg>
      );

    case 'lanterns':
      return (
        <svg {...common}>
          <path d="M8.4 9.2c0-2.2 1.6-4 3.6-4s3.6 1.8 3.6 4c0 2.6-1.4 4.6-3.6 6.4-2.2-1.8-3.6-3.8-3.6-6.4Z" />
          <path d="M10.2 16.6h3.6" />
          <path d="M12 19v2.2" opacity="0.6" />
          <circle cx="19.4" cy="5.4" r="1.5" opacity="0.55" />
          <circle cx="4.6" cy="7.2" r="1.2" opacity="0.4" />
        </svg>
      );

    case 'gate':
      return (
        <svg {...common}>
          {/* the swooping roof, then the wall of characters under it */}
          <path d="M2.6 8.4c2.6-.3 4-1.5 5.6-3.1 1.5-1.5 5.9-1.5 7.6 0 1.6 1.6 3 2.8 5.6 3.1" />
          <path d="M4.6 10.6h14.8" />
          <path d="M7 14h2M11 14h2M15 14h2M7 17.6h2M11 17.6h2M15 17.6h2" opacity="0.7" />
        </svg>
      );

    case 'breathing':
      return (
        <svg {...common}>
          {/* Pulsing breathing ring icon */}
          <circle cx="12" cy="12" r="7" strokeDasharray="3 3" opacity="0.6" />
          <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="9.5" />
        </svg>
      );

    case 'aurora':
      return (
        <svg {...common}>
          <path d="M4.6 3.6c-1 4.2-1 9.6 1.2 15.4" />
          <path d="M10 3c-.8 4.8-.4 10 1.6 16" opacity="0.75" />
          <path d="M15.6 3.6c-.6 4.6.2 9.8 2 14.8" opacity="0.5" />
          <path d="M20.4 5c-.4 3.8 0 7.6 1 11" opacity="0.35" />
        </svg>
      );
  }
}
