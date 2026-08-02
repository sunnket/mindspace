import type { MetadataRoute } from 'next';

/**
 * The install manifest.
 *
 * The root layout has declared `appleWebApp: { capable: true }` for a while,
 * which is half a promise: it tells iOS how to present the app once it has been
 * added to the home screen, but nothing ever told a browser the app was
 * installable in the first place. Chrome and Edge require a manifest with a
 * ≥192px icon before they will offer it at all, so on desktop and Android the
 * option simply never appeared.
 *
 * `display: 'standalone'` matters more here than it does for most sites. This
 * is an infinite canvas with its own pan, its own zoom and its own gestures —
 * see THE PHONE CONTRACT in layout.tsx — and a browser's back-swipe, pull-to-
 * refresh and URL bar all compete with those. Installed, the chrome is gone and
 * the board gets the whole screen, which is the way it was designed to be used.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'canvabrains — Your Infinite Thinking Space',
    short_name: 'canvabrains',
    description:
      'An infinite canvas for creative thinking. Draw, write, and organize your thoughts in a beautiful spatial mind space.',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    /* Matches the literal `#000` the body paints on the very first frame
       (globals.css), so the OS splash and the app's own boot screen are the
       same colour and there is no flash between them. */
    background_color: '#000000',
    theme_color: '#000000',
    categories: ['productivity', 'education', 'graphics'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      /* A separate maskable variant, not the same file re-declared. Android
         crops an icon to whatever shape the launcher uses, so a rounded-square
         plate with its own padding gets its corners shaved twice and ends up
         visibly smaller than every other icon on the home screen. The maskable
         art is full-bleed with the mark held inside the safe circle. */
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
