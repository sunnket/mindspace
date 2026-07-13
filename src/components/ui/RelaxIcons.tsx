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

    case 'bubbles':
      return (
        <svg {...common}>
          <circle cx="9.5" cy="14.2" r="5.2" />
          <circle cx="17.2" cy="7.6" r="3.2" />
          <circle cx="7.4" cy="12" r="1" fill="currentColor" stroke="none" />
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

    case 'ink':
      return (
        <svg {...common}>
          <path d="M12 3.5c3.6 4.2 5.6 6.9 5.6 9.4a5.6 5.6 0 1 1-11.2 0c0-2.5 2-5.2 5.6-9.4Z" />
          <path d="M9.4 13.6a2.6 2.6 0 0 0 2.6 2.6" opacity="0.6" />
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
  }
}
