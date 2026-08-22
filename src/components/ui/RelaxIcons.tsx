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

    case 'stargaze':
      return (
        <svg {...common}>
          <path d="M3 16.6c4.4-2.2 8.2-3 12-3s5.6.4 6.8.8"/><circle cx="7.4" cy="7.6" r="0.9"/><circle cx="13" cy="5.4" r="1.1"/><circle cx="18" cy="9" r="0.9"/><circle cx="10.4" cy="11" r="0.7"/>
        </svg>
      );

    case 'moonrise':
      return (
        <svg {...common}>
          <path d="M3 20h18"/><path d="M16.6 4.4a6.6 6.6 0 1 0 3 8.8 5.2 5.2 0 0 1-3-8.8Z"/>
        </svg>
      );

    case 'meteors':
      return (
        <svg {...common}>
          <path d="M4 12 9.6 6.4M9 17l4.4-4.4M14.6 19.6 18 16.2"/><circle cx="10.4" cy="5.6" r="1"/><circle cx="14.6" cy="11.4" r="0.9"/><circle cx="19" cy="15.4" r="0.8"/>
        </svg>
      );

    case 'duskwash':
      return (
        <svg {...common}>
          <path d="M3 15h18"/><path d="M7.2 15a4.8 4.8 0 0 1 9.6 0"/><path d="M12 4.4v2.2M5.6 7.2l1.6 1.6M18.4 7.2l-1.6 1.6"/><path d="M3 19h18" opacity="0.5"/>
        </svg>
      );

    case 'clouds':
      return (
        <svg {...common}>
          <path d="M6 15.4h9.4a3.2 3.2 0 0 0 .3-6.4 4.8 4.8 0 0 0-9-1.2A3.6 3.6 0 0 0 6 15.4Z"/><path d="M3 19.4h12" opacity="0.6"/>
        </svg>
      );

    case 'fogbank':
      return (
        <svg {...common}>
          <path d="M3.4 8.4h17.2M5.4 12h13.2M3.4 15.6h17.2M6.6 19.2h11"/>
        </svg>
      );

    case 'tide':
      return (
        <svg {...common}>
          <path d="M3 9.4h18"/><path d="M3 14c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/><path d="M3 18.4c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0" opacity="0.6"/>
        </svg>
      );

    case 'deepwater':
      return (
        <svg {...common}>
          <path d="M3 5.4c2.2-1.6 4.4-1.6 6.6 0s4.4 1.6 6.6 0 3.6-1.2 4.8-.4"/><path d="M8.6 21V9.4M15 21v-8"/><circle cx="11.8" cy="15" r="0.9" opacity="0.7"/>
        </svg>
      );

    case 'bioluminescence':
      return (
        <svg {...common}>
          <path d="M3 16c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/><circle cx="7" cy="11" r="1.1"/><circle cx="12.6" cy="8.4" r="0.9"/><circle cx="17.4" cy="11.6" r="1"/><circle cx="10" cy="6.6" r="0.7" opacity="0.7"/>
        </svg>
      );

    case 'godrays':
      return (
        <svg {...common}>
          <path d="M4 3h16"/><path d="M7.4 3 4.6 21M11.4 3l-1.2 18M15.4 3l1.6 18M19 3l3 18" opacity="0.85"/>
        </svg>
      );

    case 'shoji':
      return (
        <svg {...common}>
          <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="1"/><path d="M12 3.6v16.8M3.6 12h16.8"/><path d="M17.6 6.6c-1.6 1.4-2.6 3-3 4.6" opacity="0.6"/>
        </svg>
      );

    case 'wheat':
      return (
        <svg {...common}>
          <path d="M3 21h18"/><path d="M6.4 21c-.6-4 0-7.4 1.6-10.6M11.2 21c-.4-4.4.4-8 2.2-11.4M16.4 21c-.2-3.8.8-7 2.6-9.8"/>
        </svg>
      );

    case 'blossomstorm':
      return (
        <svg {...common}>
          <path d="M5.4 4.6 7 6.6M11 3.4l1 2.4M17.6 5.2l-1.4 2M4.4 12.6l2.2.8M13.6 11.6l2 1.2M8 18.4l1.6 1.6M18 17l-1.4 1.8"/><circle cx="9.4" cy="9.6" r="1.4"/><circle cx="15" cy="16" r="1.2"/>
        </svg>
      );

    case 'wisteria':
      return (
        <svg {...common}>
          <path d="M3 4.6h18"/><path d="M7 4.6v11M12 4.6v14.4M17 4.6v9.6" opacity="0.55"/><circle cx="7" cy="9" r="1.5"/><circle cx="12" cy="11.4" r="1.7"/><circle cx="17" cy="8.4" r="1.4"/><circle cx="12" cy="16.4" r="1.2"/>
        </svg>
      );

    case 'sandgarden':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="12" rx="9" ry="5.4"/><ellipse cx="12" cy="12" rx="5.6" ry="3.2" opacity="0.7"/><ellipse cx="12" cy="12" rx="2" ry="1.2"/>
        </svg>
      );

    case 'citynight':
      return (
        <svg {...common}>
          <circle cx="8" cy="9" r="3.2"/><circle cx="16.4" cy="7.4" r="2"/><circle cx="14" cy="15.6" r="3.8" opacity="0.6"/><circle cx="5.6" cy="17.4" r="1.6" opacity="0.7"/>
        </svg>
      );

    case 'silk':
      return (
        <svg {...common}>
          <path d="M2.4 8c4-3.2 7.6 3.2 11.6 0s5.6-2 7.6-.8"/><path d="M2.4 13c4-3.2 7.6 3.2 11.6 0s5.6-2 7.6-.8" opacity="0.7"/><path d="M2.4 18c4-3.2 7.6 3.2 11.6 0s5.6-2 7.6-.8" opacity="0.45"/>
        </svg>
      );

    case 'lavalamp':
      return (
        <svg {...common}>
          <path d="M8.4 3h7.2l1.4 18H7z"/><ellipse cx="12" cy="15.4" rx="2.8" ry="2"/><ellipse cx="11.2" cy="9.4" rx="1.8" ry="1.4" opacity="0.7"/>
        </svg>
      );

    case 'prism':
      return (
        <svg {...common}>
          <path d="M11 3 3.4 19h15.2z"/><path d="M13.6 11h8M13.6 13.6h8" opacity="0.7"/><path d="M13.6 16.2h8" opacity="0.45"/>
        </svg>
      );

    case 'steamroom':
      return (
        <svg {...common}>
          <path d="M3 21h18"/><path d="M8 17c0-2 1.6-2.6 1.6-4.4S8 9.4 8 7.4M13 17c0-2.4 1.8-3 1.8-5S13 8.4 13 6.4M18 17c0-1.8 1.2-2.4 1.2-4" opacity="0.9"/>
        </svg>
      );
 
    /* ---- the 2026-08-22 additions ---- */
    case 'mountains':
      return (
        <svg {...common}>
          <path d="M2 19l6-9 4 5.4 3-4 7 7.6z"/><path d="M8 10l2.6 3.6" opacity="0.5"/>
        </svg>
      );

    case 'campfire':
      return (
        <svg {...common}>
          <path d="M12 3c2.4 3 3.6 5 3.6 6.8a3.6 3.6 0 0 1-7.2 0C8.4 8 9.6 6 12 3Z"/><path d="M4 20l16-4M4 16l16 4" opacity="0.7"/>
        </svg>
      );

    case 'snowfield':
      return (
        <svg {...common}>
          <path d="M2 20l6-6 4 3 4-5 6 8z"/><path d="M12 3v6M9.4 4.6l5.2 2.8M14.6 4.6L9.4 7.4" opacity="0.8"/>
        </svg>
      );

    case 'desert':
      return (
        <svg {...common}>
          <path d="M2 18c4-4 7-4 10 0s6 4 10 0v4H2z"/><circle cx="16" cy="8" r="3" opacity="0.8"/>
        </svg>
      );

    case 'bamboo':
      return (
        <svg {...common}>
          <path d="M7 2v20M12 2v20M17 2v20"/><path d="M5.6 8h2.8M10.6 12h2.8M15.6 6h2.8M5.6 16h2.8M15.6 15h2.8" opacity="0.75"/>
        </svg>
      );

    case 'rainwindow':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 9v3M12 7v4M16 10v3" opacity="0.8"/><circle cx="8" cy="15" r="1.2"/><circle cx="15" cy="17" r="1"/>
        </svg>
      );

    case 'lanternriver':
      return (
        <svg {...common}>
          <rect x="9" y="4" width="6" height="8" rx="1.4"/><path d="M12 4V2" opacity="0.7"/><path d="M2 17c3-2 5 2 8 0s5-2 8 0 4 0 4 0" opacity="0.8"/><path d="M2 21c3-2 5 2 8 0s5-2 8 0" opacity="0.5"/>
        </svg>
      );

    case 'waterfall':
      return (
        <svg {...common}>
          <path d="M6 2v14M9.4 2v13M12 2v15M14.6 2v13M18 2v14"/><path d="M3 19c3-2 5 2 9 0s6 2 9 0" opacity="0.8"/>
        </svg>
      );

    case 'nebula':
      return (
        <svg {...common}>
          <path d="M12 4a8 8 0 1 0 8 8c-2 2-5 1-6-1s-2-3-2-7Z"/><circle cx="17" cy="6" r="0.9" fill="currentColor" stroke="none"/><circle cx="6" cy="17" r="0.7" fill="currentColor" stroke="none"/>
        </svg>
      );

    case 'autumn':
      return (
        <svg {...common}>
          <path d="M12 21C6 17 4 12 6 6c6-2 11 0 13 6-2 5-4 7-7 9Z"/><path d="M12 21 8 9" opacity="0.7"/>
        </svg>
      );

    case 'harbour':
      return (
        <svg {...common}>
          <circle cx="7" cy="6" r="1.6"/><circle cx="15" cy="7" r="1.2"/><path d="M7 12v7M15 12v6" opacity="0.6"/><path d="M2 11h20" opacity="0.8"/>
        </svg>
      );

    case 'thunderhead':
      return (
        <svg {...common}>
          <path d="M5 13a4 4 0 0 1 1.6-6.6A5 5 0 0 1 16 6a3.6 3.6 0 0 1 2 6.8"/><path d="M12 12l-2.4 4H12l-1.6 4"/>
        </svg>
      );

    case 'cavepool':
      return (
        <svg {...common}>
          <path d="M2 4h20M10 4l-3 12M14 4l3 12" opacity="0.9"/><path d="M3 18c3-2 5 2 9 0s6 2 9 0" opacity="0.8"/>
        </svg>
      );

    case 'aurorafield':
      return (
        <svg {...common}>
          <path d="M3 4c2 5 4 7 3 12M9 3c2 6 3 8 2 13M15 4c2 5 3 8 2 12M21 5c1 5 1 7 0 11" opacity="0.9"/><path d="M2 21h20" opacity="0.6"/>
        </svg>
      );

    case 'sunbeam':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="18" rx="1" opacity="0.8"/><path d="M11 5l9 4-4 12-6-4z" opacity="0.9"/>
        </svg>
      );

    case 'tidepool':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="13" rx="9" ry="7"/><circle cx="10" cy="13" r="2"/><path d="M10 11v-2M8.4 12l-2-1M11.6 12l2-1M10 15v2" opacity="0.7"/>
        </svg>
      );

    case 'mossforest':
      return (
        <svg {...common}>
          <path d="M4 20v-5M8 20v-8M12 20v-6M16 20v-9M20 20v-5"/><circle cx="8" cy="11.4" r="1"/><circle cx="16" cy="10.4" r="1"/><path d="M2 20h20" opacity="0.6"/>
        </svg>
      );

    case 'hotspring':
      return (
        <svg {...common}>
          <path d="M3 16c3-2 5 2 9 0s6 2 9 0" /><path d="M3 20c3-2 5 2 9 0s6 2 9 0" opacity="0.6"/><path d="M8 11c0-2 1.6-2.4 1.6-4S8 4.4 8 3M15 11c0-2 1.6-2.4 1.6-4S15 4.4 15 3" opacity="0.8"/>
        </svg>
      );

    case 'dominoes':
      return (
        <svg {...common}>
          <rect x="3" y="6" width="4" height="13" rx="1" transform="rotate(-14 5 12)"/><rect x="10" y="6" width="4" height="13" rx="1"/><rect x="17" y="6" width="4" height="13" rx="1" opacity="0.7"/>
        </svg>
      );

    case 'newton':
      return (
        <svg {...common}>
          <path d="M4 4h16"/><path d="M7 4v9M12 4v9M17 4v9" opacity="0.7"/><circle cx="7" cy="16" r="2.6"/><circle cx="12" cy="16" r="2.6"/><circle cx="17" cy="16" r="2.6"/>
        </svg>
      );

    case 'pendulum':
      return (
        <svg {...common}>
          <path d="M3 4h18"/><path d="M6 4l2 10M12 4v11M18 4l-2 9" opacity="0.7"/><circle cx="8" cy="16" r="1.8"/><circle cx="12" cy="17" r="1.8"/><circle cx="16" cy="15" r="1.8"/>
        </svg>
      );

    case 'plasma':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M13.6 10.4 18 7M10.6 10.6 6.4 7.6M12 14v4.4M14 13.6l3.6 3" opacity="0.8"/>
        </svg>
      );

    case 'pinart':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="1.2"/><circle cx="12" cy="6" r="1.2"/><circle cx="18" cy="6" r="1.2"/><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="2.4"/><circle cx="18" cy="12" r="1.2"/><circle cx="6" cy="18" r="1.2"/><circle cx="12" cy="18" r="1.2"/><circle cx="18" cy="18" r="1.2"/>
        </svg>
      );

    case 'spirograph':
      return (
        <svg {...common}>
          <path d="M12 3c5 3 8 6 6 10s-7 4-10 1-3-8 1-10 8 1 8 6-4 8-8 7"/>
        </svg>
      );

    case 'skipstone':
      return (
        <svg {...common}>
          <path d="M2 16c2-5 4-5 6 0s4 4 6-1 4-4 6 1" opacity="0.9"/><path d="M2 19h20" opacity="0.7"/><ellipse cx="18" cy="14" rx="2.4" ry="1.2"/>
        </svg>
      );

    case 'bubbleblow':
      return (
        <svg {...common}>
          <circle cx="9" cy="14" r="5"/><circle cx="17" cy="8" r="3.4"/><circle cx="6" cy="6" r="2"/><path d="M6.6 11.6a3.4 3.4 0 0 1 2-2" opacity="0.7"/>
        </svg>
      );

    case 'mushrooms':
      return (
        <svg {...common}>
          <path d="M4 11a8 5.4 0 0 1 16 0z"/><path d="M10 11v6.4a2 2 0 0 0 4 0V11"/><circle cx="9" cy="8.6" r="1" opacity="0.8"/><circle cx="15" cy="8" r="0.8" opacity="0.8"/>
        </svg>
      );

    case 'frost':
      return (
        <svg {...common}>
          <path d="M12 2v20M3.4 7l17.2 10M20.6 7 3.4 17"/><path d="M9 4.6 12 6l3-1.4M9 19.4 12 18l3 1.4" opacity="0.75"/>
        </svg>
      );

    case 'balloons':
      return (
        <svg {...common}>
          <path d="M12 15c3.4 0 6-2.8 6-6.4S15.4 2 12 2 6 4.8 6 8.6 8.6 15 12 15Z"/><path d="M12 15v2"/><path d="M12 17c-2 2 2 3 0 5" opacity="0.8"/>
        </svg>
      );

    case 'kites':
      return (
        <svg {...common}>
          <path d="M12 2 20 9l-8 8-8-8z"/><path d="M4 9h16M12 2v15" opacity="0.6"/><path d="M12 17c-2 1.6 2 2.6 0 4.4" opacity="0.8"/>
        </svg>
      );

    case 'sparkler':
      return (
        <svg {...common}>
          <path d="M4 20 12 12" /><circle cx="14" cy="10" r="2.4"/><path d="M14 4v2.6M14 13.4V16M8.6 10H6M22 10h-2.6M17.8 6.2 16 8M10.2 13.8 12 12" opacity="0.8"/>
        </svg>
      );

    case 'flare':
      return (
        <svg {...common}>
          <path d="M3 21C5 10 10 4 20 3" opacity="0.7"/><circle cx="19" cy="4.4" r="2.4"/><path d="M16.4 2.4h5.2" opacity="0.8"/>
        </svg>
      );

    case 'zenrake':
      return (
        <svg {...common}>
          <path d="M2 7c4-2 6 2 10 0s6-2 10 0M2 12c4-2 6 2 10 0s6-2 10 0M2 17c4-2 6 2 10 0s6-2 10 0"/>
        </svg>
      );

    case 'singingbowl':
      return (
        <svg {...common}>
          <path d="M5 11h14a7 7 0 0 1-14 0Z"/><path d="M3 8.4c1.6-1.6 3-2.4 3-2.4M21 8.4c-1.6-1.6-3-2.4-3-2.4" opacity="0.7"/><path d="M7 20h10" opacity="0.6"/>
        </svg>
      );

    case 'hourglass':
      return (
        <svg {...common}>
          <path d="M6 3h12M6 21h12"/><path d="M7 3c0 5 5 7 5 9s-5 4-5 9M17 3c0 5-5 7-5 9s5 4 5 9"/><path d="M10.6 14.6h2.8" opacity="0.7"/>
        </svg>
      );

    case 'snowglobe':
      return (
        <svg {...common}>
          <circle cx="12" cy="10" r="8"/><path d="M6 19h12l-1 3H7z"/><path d="M12 6l3 6H9z" opacity="0.8"/>
        </svg>
      );
  }
}
