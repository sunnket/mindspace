/**
 * Deep-field bodies for the Constellation View.
 *
 * 27 planets and moons from the Icons8 catalogue (icons8.com) via its MCP
 * server, in the four art styles that draw a body as a LIT SPHERE — a visible
 * terminator between day and night side — rather than as a flat disc. That
 * shading is the whole reason they read as objects sitting in a void instead of
 * as stickers on a backdrop.
 *
 * Aspect ratio is carried per body because Saturn's rings make it half again as
 * wide as it is tall; the renderer scales by the long edge.
 *
 * Icons8 assets carry Icons8's licence; keep the attribution in the app's credits.
 */

export interface DeepBody {
  src: string;
  w: number;
  h: number;
}

export const DEEP_BODIES: readonly DeepBody[] = [
  { src: '/sky/planets/earth-planet--color.png', w: 210, h: 210 },
  { src: '/sky/planets/earth-planet--fluent.png', w: 200, h: 200 },
  { src: '/sky/planets/earth-planet--office80.png', w: 234, h: 234 },
  { src: '/sky/planets/earth-planet-v2--color.png', w: 200, h: 200 },
  { src: '/sky/planets/earth-planet-v2--fluent.png', w: 200, h: 200 },
  { src: '/sky/planets/earth-planet-v2--office80.png', w: 222, h: 222 },
  { src: '/sky/planets/full-moon--color.png', w: 200, h: 200 },
  { src: '/sky/planets/full-moon--deco-color.png', w: 200, h: 200 },
  { src: '/sky/planets/full-moon--fluent.png', w: 200, h: 200 },
  { src: '/sky/planets/full-moon--office80.png', w: 228, h: 228 },
  { src: '/sky/planets/jupiter-planet--color.png', w: 190, h: 190 },
  { src: '/sky/planets/mars-planet--color.png', w: 190, h: 190 },
  { src: '/sky/planets/mercury-planet--color.png', w: 190, h: 190 },
  { src: '/sky/planets/moon-satellite--color.png', w: 190, h: 190 },
  { src: '/sky/planets/neptune-planet--color.png', w: 190, h: 190 },
  { src: '/sky/planets/new-moon--color.png', w: 200, h: 200 },
  { src: '/sky/planets/new-moon--deco-color.png', w: 200, h: 200 },
  { src: '/sky/planets/new-moon--fluent.png', w: 200, h: 200 },
  { src: '/sky/planets/new-moon--office80.png', w: 228, h: 228 },
  { src: '/sky/planets/pluto-dwarf-planet--color.png', w: 190, h: 190 },
  { src: '/sky/planets/saturn-planet--color.png', w: 210, h: 210 },
  { src: '/sky/planets/uranus-planet--color.png', w: 180, h: 240 },
  { src: '/sky/planets/venus-planet--color.png', w: 190, h: 190 },
  { src: '/sky/planets/waning-crescent--color.png', w: 200, h: 200 },
  { src: '/sky/planets/waning-crescent--deco-color.png', w: 200, h: 200 },
  { src: '/sky/planets/waning-crescent--fluent.png', w: 200, h: 200 },
  { src: '/sky/planets/waxing-crescent--color.png', w: 200, h: 200 },
];
