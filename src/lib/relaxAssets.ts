/**
 * Artwork for the Stress Reliefer's drift and seed effects.
 *
 * Pulled from the Icons8 catalogue (icons8.com) the same way the bloom library
 * was — MCP search only to learn each icon's true `commonName`, then
 * `https://img.icons8.com/<style>/<size>/<name>.png` probed locally across
 * every art style, keeping whatever came back as artwork. Each file is cropped
 * to its own alpha bounding box: untrimmed Icons8 padding renders a 60px koi at
 * 40px and swims it around the padding's centre rather than the fish's.
 *
 * Generated. Icons8 assets carry Icons8's licence; keep the attribution in the
 * app's credits.
 */

/* The pond used to be eleven stock fish from this library, sliding over the
   canvas on a sine. They are gone: a koi is now built out of a chain of
   ellipses with a stroke running down it (see `koiBody` in relaxEffects), which
   can bend, bank and lag through a turn — none of which a PNG can do, and all
   of which is what a fish IS. Nothing here is fish any more. */

/** Bells and fronds. A jellyfish is drawn hanging, so it only ever scales —
 *  a rotation would turn it upside down and it would stop being a jellyfish. */
export const RELAX_DRIFT: readonly string[] = [
  '/relax/drift/jellyfish--color.png',
  '/relax/drift/jellyfish--cotton.png',
  '/relax/drift/jellyfish--fluent.png',
  '/relax/drift/jellyfish--pieces.png',
];

/** The seed head itself. The seeds that leave it are drawn in CSS — a
 *  parachute is two strokes, and 60 image nodes to say that would be silly. */
export const RELAX_SEEDHEAD: readonly string[] = [
  '/relax/seed/dandelion--color.png',
  '/relax/seed/dandelion--fluent.png',
];
