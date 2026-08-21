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

    // A bloom on a stalk with one leaf — the growing plant, not the loose head.
    case 'blooming':
      return (
        <svg {...common}>
          <path d="M12 21v-8.2" />
          <path d="M12 12.8c-3.3 0-5-1.8-5-4s1.7-4 5-4 5 1.8 5 4-1.7 4-5 4Z" />
          <path d="M12 17.6c-1.9-1.5-3.6-1.8-5.1-1.3" />
        </svg>
      );

    // Three petals falling, each at a different angle.
    case 'petalfall':
      return (
        <svg {...common}>
          <path d="M6.4 3.4c3 1 4.4 3 4.2 5.7-2.4.4-4.2-1.3-4.2-5.7Z" />
          <path d="M16.9 9.5c1.6 2.8 1.2 5.1-.8 6.7-1.9-1.6-2-4 .8-6.7Z" />
          <path d="M8.5 15.3c2.6-.4 4.3.8 4.7 3.3-2.3 1.1-4-.2-4.7-3.3Z" />
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

    /* A fish seen from above, curled — which is how the pond reads. */
    case 'koi':
      return (
        <svg {...common}>
          <path d="M15.4 8.2c2.6 1 3.7 3.4 3 5.9-.8 2.6-3.3 4-6 3.4-2.6-.6-4.2-3-3.7-5.6.5-2.6 3-4.5 6.7-3.7Z" />
          <path d="M9 12.6 4.6 9.4v6.4L9 13.4" />
          <circle cx="15.2" cy="11.4" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );

    /* A drop, and the bloom under it. */
    case 'ink':
      return (
        <svg {...common}>
          <path d="M12 3.2c1.8 2.4 3 4 3 5.4a3 3 0 0 1-6 0c0-1.4 1.2-3 3-5.4Z" />
          <path d="M7.2 14.6c1.6-1 3.2-1.2 4.8-1.2s3.2.2 4.8 1.2" opacity="0.7" />
          <path d="M4.8 18.2c2.4-1.6 4.8-2 7.2-2s4.8.4 7.2 2" opacity="0.45" />
        </svg>
      );

    /* Two films with their highlights. */
    case 'soap':
      return (
        <svg {...common}>
          <circle cx="9.4" cy="13.6" r="5.6" />
          <circle cx="16.6" cy="7.8" r="3.4" />
          <path d="M6.6 10.8a3.6 3.6 0 0 1 1.8-1.4" opacity="0.75" />
          <path d="M15.2 6.4a2 2 0 0 1 1.1-.8" opacity="0.6" />
        </svg>
      );

    /* A pane, a bead that is still sitting, and one that has gone. */
    case 'glassrain':
      return (
        <svg {...common}>
          <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2" opacity="0.5" />
          <path d="M9 7.6c0 1-1.4 1.7-1.4 3a1.4 1.4 0 0 0 2.8 0c0-1.3-1.4-2-1.4-3Z" />
          <path d="M15.2 6.6c0 1.1-1.5 1.9-1.5 3.3a1.5 1.5 0 0 0 3 0c0-1.4-1.5-2.2-1.5-3.3Z" />
          <path d="M15.2 11.4v5.8" opacity="0.55" />
        </svg>
      );

    /* The clock, half gone. */
    case 'dandelion':
      return (
        <svg {...common}>
          <path d="M11 21v-8" />
          <circle cx="11" cy="10" r="3.4" strokeDasharray="1.6 2.2" />
          <path d="M17.4 4.6 15.6 6.4M20.4 8.2l-2.4.8M18.6 12.8l-2.2-.6" opacity="0.7" />
          <circle cx="18.4" cy="3.6" r="1.1" opacity="0.8" />
          <circle cx="21" cy="7" r="0.9" opacity="0.6" />
        </svg>
      );

    /* Six-fold symmetry — the thing itself. */
    case 'kaleido':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.6" opacity="0.55" />
          <path d="M12 3.4 16.4 12 12 20.6 7.6 12Z" />
          <path d="M4 8.6 20 15.4M20 8.6 4 15.4" opacity="0.5" />
        </svg>
      );

    /* Three, getting smaller. */
    case 'stones':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="18.4" rx="7.4" ry="2.6" />
          <ellipse cx="12" cy="13.2" rx="5.4" ry="2.2" />
          <ellipse cx="12" cy="8.6" rx="3.4" ry="1.8" />
        </svg>
      );

    /* A bed of coals with two sparks off it. */
    case 'embers':
      return (
        <svg {...common}>
          <path d="M3.6 19.4c2.4-2 5.2-3 8.4-3s6 1 8.4 3" />
          <path d="M6.6 16.2c1.6-1 3.4-1.5 5.4-1.5s3.8.5 5.4 1.5" opacity="0.6" />
          <circle cx="9" cy="8.4" r="1.2" />
          <circle cx="15.2" cy="5.4" r="0.9" opacity="0.7" />
          <circle cx="13" cy="10.6" r="0.7" opacity="0.5" />
        </svg>
      );

    /* Bell and tentacles. */
    case 'jellyfish':
      return (
        <svg {...common}>
          <path d="M5 12a7 7 0 0 1 14 0Z" />
          <path d="M8 12.4c0 2-.9 2.6-.9 4.2s.9 2 .9 3.4" opacity="0.8" />
          <path d="M12 12.4c0 2.2-1 2.8-1 4.6s1 2.2 1 3.6" opacity="0.65" />
          <path d="M16 12.4c0 2-.9 2.6-.9 4.2s.9 2 .9 3.4" opacity="0.5" />
        </svg>
      );

    /* One lit, one that has been put out. */
    case 'candles':
      return (
        <svg {...common}>
          <rect x="4.6" y="10.4" width="4.4" height="10" rx="1" />
          <path d="M6.8 9.6c1.4-1.2 1.9-2.2 1.9-3.1a1.9 1.9 0 0 0-3.8 0c0 .9.5 1.9 1.9 3.1Z" />
          <rect x="14.4" y="12.4" width="4" height="8" rx="1" opacity="0.65" />
          <path d="M16.4 11.4c.7-.8.3-1.6-.3-2.2" opacity="0.5" />
        </svg>
      );
  }
}
