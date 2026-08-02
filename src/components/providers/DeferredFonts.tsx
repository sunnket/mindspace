'use client';

import { useEffect } from 'react';

/**
 * The 62 decorative font families, fetched AFTER the page has painted.
 *
 * These are the faces a user can pick for a text block — Lobster, Creepster,
 * Press Start 2P, Pirata One and so on. Not one of them is used by the
 * interface itself, and on most sessions not one of them is ever selected.
 * They used to arrive through a `@import url(...)` at the top of globals.css,
 * which is the worst of all worlds: the browser could not even discover the
 * request until it had parsed that stylesheet, and the response then blocked
 * rendering. Sixty-five families had to be negotiated before the first pixel.
 *
 * Injecting the same <link> from an effect moves the whole cost off the
 * critical path. Every family carries `display=swap`, so a block set to
 * Lobster shows in a fallback for the moment before the real face lands —
 * which is exactly what `swap` is for, and is invisible unless you are already
 * looking at decorative text on the very first frame.
 *
 * `requestIdleCallback` keeps it from competing with hydration; the timeout
 * guarantees it still happens promptly on a busy main thread.
 */

const DECORATIVE_FONTS =
  'https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Anton&family=Bebas+Neue' +
  '&family=Caveat:wght@400..700&family=Fira+Code:wght@300..700' +
  '&family=Lora:ital,wght@400..700;1,400..700' +
  '&family=Merriweather:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400;1,700;1,900' +
  '&family=Montserrat:ital,wght@0,100..900;1,100..900&family=Oswald:wght@200..700&family=Pacifico' +
  '&family=Playfair+Display:ital,wght@0,400..900;1,400..900' +
  '&family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;0,900;1,100;1,300;1,400;1,500;1,700;1,900' +
  '&family=Comfortaa:wght@300..700&family=Fredoka:wght@300..700&family=Quicksand:wght@300..700' +
  '&family=Cinzel:wght@400..900&family=Sacramento&family=Shadows+Into+Light' +
  '&family=Gloria+Hallelujah&family=Permanent+Marker&family=Spicy+Rice&family=Lobster' +
  '&family=Abril+Fatface&family=Righteous&family=Press+Start+2P&family=Creepster' +
  '&family=Architects+Daughter&family=Dancing+Script:wght@400..700&family=Amatic+SC:wght@400;700' +
  '&family=Bangers&family=Chewy&family=Cinzel+Decorative:wght@400;700&family=Special+Elite' +
  '&family=Monoton&family=Poiret+One&family=Shrikhand&family=Ultra&family=VT323&family=Bungee' +
  '&family=Fredericka+the+Great&family=Luckiest+Guy&family=Pinyon+Script&family=Kelly+Slab' +
  '&family=Kranky&family=Slackey&family=Rye&family=Pirata+One&family=Uncial+Antiqua' +
  '&family=Nosifer&family=Eater&family=Monofett&family=Syne+Tactile&family=Butcherman' +
  '&family=Codystar&family=Fascinate+Inline&family=Rubik+Beastly' +
  '&family=Shantell+Sans:ital,wght@0,300..800;1,300..800' +
  '&family=Literata:ital,opsz,wght@0,7..72,200..900;1,7..72,200..900' +
  '&family=EB+Garamond:ital,wght@0,400..800;1,400..800' +
  '&family=Crimson+Pro:ital,wght@0,200..900;1,200..900' +
  '&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400;1,700' +
  '&family=Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800' +
  '&display=swap';

const LINK_ID = 'canvabrains-decorative-fonts';

export default function DeferredFonts() {
  useEffect(() => {
    if (document.getElementById(LINK_ID)) return;

    const inject = () => {
      if (document.getElementById(LINK_ID)) return;
      const link = document.createElement('link');
      link.id = LINK_ID;
      link.rel = 'stylesheet';
      link.href = DECORATIVE_FONTS;
      document.head.appendChild(link);
    };

    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    }).requestIdleCallback;

    if (ric) {
      const id = ric(inject, { timeout: 2000 });
      return () => (window as unknown as { cancelIdleCallback?: (i: number) => void }).cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(inject, 400);
    return () => window.clearTimeout(t);
  }, []);

  return null;
}
