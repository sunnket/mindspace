/**
 * Artwork for the Stress Reliefer's pond and drift effects.
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

/** Seen from above, so a koi may bank and turn in the plane of the water —
 *  but never tip, which would read as the sprite being squashed. */
export const RELAX_KOI: readonly string[] = [
  '/relax/koi/clown-fish--color.png',
  '/relax/koi/clown-fish--deco-color.png',
  '/relax/koi/clown-fish--fluent.png',
  '/relax/koi/clown-fish--papercut.png',
  '/relax/koi/clown-fish--pieces.png',
  '/relax/koi/clown-fish--plasticine.png',
  '/relax/koi/koi-fish--color.png',
  '/relax/koi/koi-fish--fluent.png',
  '/relax/koi/koi-fish--papercut.png',
  '/relax/koi/koi-fish--pieces.png',
  '/relax/koi/tropical-fish--emoji.png',
];

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
