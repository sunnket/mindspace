'use client';

/**
 * READING ROOMS — the world the page sits inside.
 *
 * The old rooms were a gradient plus some particles, which is why they read as
 * wallpaper rather than as a place. Every room here is a small stage built out
 * of ordered layers, the way a photograph is:
 *
 *   sky   → the light of the place
 *   far   → distance: ridges, treelines, city — blurred, low contrast, cool
 *   mid   → the architecture the reader is actually in: shelves, a window, walls
 *   key   → the one light that motivates the glow on the page
 *   fore  → the darkest layer, nearest the eye: a desk edge, a frame, leaves
 *
 * That foreground layer is what sells it. A page floating on a gradient is a
 * texture; a page above a desk edge, under a lamp, beside a rain-streaked
 * window is a room.
 *
 * Everything is CSS and a few generated SVG silhouettes — no images, no canvas —
 * so switching rooms is free and every scene scales to any viewport. The same
 * components draw the picker previews (`still` drops particles and blur so 40
 * live thumbnails stay cheap).
 *
 * Composition rule: the page sits centred and takes roughly the middle third,
 * so scenery lives in the side gutters, along the bottom, and across the top.
 */

import React from 'react';

/* ------------------------------------------------------------------ types -- */

export type Atmos =
  /* Study */
  | 'clean' | 'focus' | 'library' | 'study' | 'candle' | 'fireplace' | 'cafe'
  | 'attic' | 'cabin' | 'parchment' | 'noir' | 'greenhouse'
  /* Nature */
  | 'rain' | 'storm' | 'snow' | 'forest' | 'autumn' | 'sakura' | 'meadow'
  | 'ocean' | 'lake' | 'mountain' | 'desert' | 'bamboo' | 'reef'
  /* Cosmos */
  | 'night' | 'moonlit' | 'aurora' | 'cosmos' | 'observatory' | 'orbit'
  /* Journey */
  | 'train' | 'plane' | 'tent'
  /* Mood */
  | 'sunset' | 'dusk' | 'romance' | 'lavender' | 'zen' | 'neon';

type PKind =
  | 'none' | 'dust' | 'ember' | 'rain' | 'snow' | 'leaf' | 'petal' | 'bokeh'
  | 'star' | 'gold' | 'pollen' | 'firefly' | 'bubble' | 'ash';

export type RoomGroup = 'Study' | 'Nature' | 'Cosmos' | 'Journey' | 'Mood';

export interface Room {
  key: Atmos;
  label: string;
  group: RoomGroup;
  /** One line in the picker — what the place feels like, not what it contains. */
  blurb: string;
  /** "r,g,b" — drives every accent in the reader UI and the page's light spill. */
  accent: string;
  /** UI text colour, for rooms too pale for the default warm white. */
  ink?: string;
  /** How much of the room's light lands on the page edge (0–1). */
  glow?: number;
  /** Ambient bed, played only while the room is open and sound is on. */
  sound?: 'rain' | 'ocean' | 'wind' | 'drone';
  fx: { kind: PKind; n?: number; color?: string };
  scene: () => React.ReactNode;
}

/* ------------------------------------------------------------- generators -- */

/** mulberry32 — deterministic, so shelves and stars don't reshuffle on render. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r: () => number, a: number, b: number) => a + r() * (b - a);
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length) % xs.length];
const n2 = (v: number) => Math.round(v * 100) / 100;

/* A ragged conifer treeline in a 100×40 box. Trees overlap by a random amount
   rather than marching at a fixed step — evenly spaced trees read as a sawtooth,
   which is the single fastest way to make a landscape look drawn. */
function firline(seed: number, count: number, minH: number, maxH: number): string {
  const r = rng(seed);
  const avg = 100 / count;
  let d = 'M0 40 L0 34';
  let x = -avg * 0.5;
  while (x < 100) {
    const w = avg * between(r, 0.55, 1.7);
    const h = between(r, minH, maxH);
    d += ` L${n2(x)} 34 L${n2(x + w / 2)} ${n2(34 - h)} L${n2(x + w)} 34`;
    x += w * between(r, 0.5, 0.95);
  }
  return `${d} L100 34 L100 40 Z`;
}

/* A city skyline: blocks of varying height and width across a 100×40 box. */
function skyline(seed: number, count: number, minH: number, maxH: number): string {
  const r = rng(seed);
  let x = 0;
  let d = 'M0 40 L0 34';
  while (x < 100) {
    const w = between(r, 4, 12);
    const h = between(r, minH, maxH);
    d += ` L${n2(x)} ${n2(40 - h)} L${n2(Math.min(100, x + w))} ${n2(40 - h)}`;
    x += w;
  }
  return `${d} L100 40 Z`;
}

const FIR_FAR = firline(11, 26, 6, 16);
const FIR_NEAR = firline(29, 14, 12, 26);
const FIR_DENSE = firline(83, 30, 5, 14);
const SKY_FAR = skyline(7, 20, 8, 26);
const SKY_NEAR = skyline(23, 14, 14, 34);

/* Lit windows scattered over a skyline — the thing that makes a city read as
   inhabited rather than as a black shape. */
const CITY_LIGHTS = (() => {
  const r = rng(404);
  return Array.from({ length: 80 }, () => ({
    left: `${n2(between(r, 1, 99))}%`,
    bottom: `${n2(between(r, 2, 26))}%`,
    width: `${n2(between(r, 1.4, 3))}px`,
    height: `${n2(between(r, 2, 4))}px`,
    opacity: n2(between(r, 0.25, 0.95)),
    background: pick(r, ['#ffd9a0', '#ffe9c4', '#cfe4ff', '#ffc98a']),
    animationDelay: `${n2(between(r, -14, 0))}s`,
  }));
})();

/* A wall of books: five shelves, each a row of spines of varied width, height,
   colour and lean. Cheap, and unmistakably a library at a glance. */
const SPINES = ['#6d3b2a', '#3f4f3a', '#2f3d55', '#5a4a2c', '#4a2f3a', '#33333b', '#7a5a34', '#25404a', '#7c3b31', '#464a2e'];
const SHELVES = (() => {
  const r = rng(1975);
  return Array.from({ length: 5 }, () =>
    Array.from({ length: 22 }, () => ({
      w: n2(between(r, 7, 16)),
      h: n2(between(r, 58, 92)),
      c: pick(r, SPINES),
      lean: r() > 0.9 ? n2(between(r, -9, 9)) : 0,
      band: r() > 0.45,
    })),
  );
})();

/* Star fields — three, so cosmos rooms don't all share the same constellation. */
function starfield(seed: number, count: number, top: [number, number], sizeMax = 2.2) {
  const r = rng(seed);
  return Array.from({ length: count }, () => {
    const s = between(r, 0.9, sizeMax);
    return {
      left: `${n2(between(r, 0, 100))}%`,
      top: `${n2(between(r, top[0], top[1]))}%`,
      width: `${n2(s)}px`,
      height: `${n2(s)}px`,
      opacity: n2(between(r, 0.3, 1)),
      animationDuration: `${n2(between(r, 2.4, 6))}s`,
      animationDelay: `${n2(between(r, -6, 0))}s`,
    };
  });
}
const STARS_A = starfield(3, 110, [0, 78]);
const STARS_B = starfield(51, 70, [0, 55], 1.8);
const STARS_C = starfield(97, 150, [0, 100], 2.6);

/* Rain on glass: still beads that sit on the pane, plus a few that run. */
const BEADS = (() => {
  const r = rng(66);
  return Array.from({ length: 64 }, () => {
    const s = between(r, 2, 7);
    return {
      left: `${n2(between(r, 1, 97))}%`,
      top: `${n2(between(r, 1, 96))}%`,
      width: `${n2(s)}px`,
      height: `${n2(s * between(r, 1, 1.35))}px`,
      opacity: n2(between(r, 0.35, 0.9)),
    };
  });
})();
const RUNNERS = (() => {
  const r = rng(88);
  return Array.from({ length: 9 }, () => ({
    left: `${n2(between(r, 4, 94))}%`,
    height: `${n2(between(r, 16, 44))}%`,
    animationDuration: `${n2(between(r, 2.6, 6.5))}s`,
    animationDelay: `${n2(between(r, -6, 0))}s`,
  }));
})();

/* --------------------------------------------------------------- helpers -- */

type S = React.CSSProperties;
const v = (o: Record<string, string | number>) => o as S;

/** A flat silhouette layer. `d` is drawn in a 100×40 box and stretched to fit. */
function Sil({ d, fill, style, cls = '' }: { d: string; fill: string; style?: S; cls?: string }) {
  return (
    <svg className={`rs-sil ${cls}`} viewBox="0 0 100 40" preserveAspectRatio="none" style={style} aria-hidden>
      <path d={d} fill={fill} />
    </svg>
  );
}

/** A window: the view sits behind glass, mullions and frame sit in front. */
function Win({
  side = 'right', top = 10, w = 32, h = 56, glass = 'plain', bars = 'cross', wood = '#2a1d13', view,
}: {
  side?: 'left' | 'right'; top?: number; w?: number; h?: number;
  glass?: 'plain' | 'rain' | 'frost'; bars?: 'cross' | 'grid' | 'none' | 'oval';
  wood?: string; view: React.ReactNode;
}) {
  return (
    <div className={`rs-win glass-${glass}${bars === 'oval' ? ' oval' : ''}`} style={v({ [side]: '3%', top: `${top}%`, width: `${w}%`, height: `${h}%`, '--wood': wood })}>
      <div className="view">{view}</div>
      <div className="glass" />
      {glass === 'rain' && (
        <>
          <div className="beads">{BEADS.map((b, i) => <i key={i} style={b as S} />)}</div>
          <div className="runs">{RUNNERS.map((b, i) => <i key={i} style={b as S} />)}</div>
        </>
      )}
      {glass === 'frost' && <div className="frost" />}
      {bars !== 'none' && bars !== 'oval' && (
        <div className="bars">
          <i className="vb" />
          <i className="hb" style={{ top: '34%' }} />
          {bars === 'grid' && <i className="hb" style={{ top: '67%' }} />}
        </div>
      )}
      <div className="frame" />
      {bars !== 'oval' && <div className="sill" />}
    </div>
  );
}

/** A hanging or standing lamp: shade, hot bulb, and the cone it throws. */
function Lamp({ x, y = 4, size = 1, cone = 1, warm = '255,196,120', drop = 0 }: { x: string; y?: number; size?: number; cone?: number; warm?: string; drop?: number }) {
  return (
    <div className="rs-lamp" style={v({ left: x, top: `${y}%`, '--s': size, '--warm': warm })}>
      {drop > 0 && <i className="cord" style={{ height: `${drop}px` }} />}
      <i className="shade" />
      <i className="bulb" />
      <i className="cone" style={{ opacity: 0.55 * cone }} />
    </div>
  );
}

/** A candle standing on something — anchored from its base, never floating. */
function Candle({ x, bottom, h = 46, s = 1 }: { x: string; bottom: string; h?: number; s?: number }) {
  return (
    <div className="rs-candle" style={v({ left: x, bottom, '--h': `${h}px`, '--s': s })}>
      <i className="plate" />
      <i className="stick" />
      <i className="wick" />
      <i className="flame" />
      <i className="halo" />
      <i className="pool" />
    </div>
  );
}

/** A tree trunk seen close up: near-black, rimmed by whatever light there is. */
function Trunk({ side, at, w, tilt = 0, far = 0 }: { side: 'left' | 'right'; at: string; w: number; tilt?: number; far?: number }) {
  return <div className="rs-trunk" style={v({ [side]: at, '--w': `${w}px`, '--tilt': `${tilt}deg`, filter: far ? `blur(${far}px)` : 'none', opacity: far ? 0.7 : 1 })} />;
}

/** The desk / table / floor the whole scene rests on. */
function Surface({ h = 16, cls = 'oak', children }: { h?: number; cls?: string; children?: React.ReactNode }) {
  return (
    <div className={`rs-surface ${cls}`} style={{ height: `${h}%` }}>
      <i className="lip" />
      {children}
    </div>
  );
}

/** Layered sea. Each band drifts at its own speed, which reads as depth. */
function Sea({ top = 58, tint = ['#0b2c33', '#0f3b44', '#155059'] }: { top?: number; tint?: [string, string, string] | string[] }) {
  return (
    <div className="rs-sea" style={{ top: `${top}%` }}>
      <Sil cls="w1" d="M0 40 L0 18 Q10 12 20 18 T40 18 T60 18 T80 18 T100 18 L100 40 Z" fill={tint[0]} style={{ height: '46%' }} />
      <Sil cls="w2" d="M0 40 L0 20 Q14 13 28 20 T56 20 T84 20 T100 17 L100 40 Z" fill={tint[1]} style={{ height: '62%', top: '18%' }} />
      <Sil cls="w3" d="M0 40 L0 22 Q18 14 36 22 T72 22 T100 19 L100 40 Z" fill={tint[2]} style={{ height: '80%', top: '34%' }} />
      <i className="foam" />
    </div>
  );
}

const Stars = ({ set = STARS_A, cls = '' }: { set?: typeof STARS_A; cls?: string }) => (
  <div className={`rs-stars ${cls}`} aria-hidden>{set.map((s, i) => <i key={i} style={s as S} />)}</div>
);

const CityLights = () => <div className="rs-citylights" aria-hidden>{CITY_LIGHTS.map((s, i) => <i key={i} style={s as S} />)}</div>;

function Shelf({ side }: { side: 'left' | 'right' }) {
  return (
    <div className={`rs-shelf ${side}`}>
      {SHELVES.map((row, i) => (
        <div className="row" key={i}>
          <div className="books">
            {row.map((b, j) => (
              <i key={j} className={b.band ? 'bk band' : 'bk'} style={{ width: `${b.w}px`, height: `${b.h}%`, background: b.c, transform: b.lean ? `rotate(${b.lean}deg)` : undefined }} />
            ))}
          </div>
          <div className="board" />
        </div>
      ))}
    </div>
  );
}

/* ================================= scenes ================================= */
/* Each returns the layers between the sky and the vignette. Order matters:
   far (blurred) → mid → key light → foreground. */

const sky = <div className="rs-sky" />;

/* -- Study ---------------------------------------------------------------- */

const S_clean = () => (
  <>
    {sky}
    <div className="rs-plaster bright" />
    <div className="rs-softwin" />
    <div className="rs-castshadow" />
    <div className="rs-key" style={v({ background: 'radial-gradient(56% 64% at 8% 18%, rgba(255,253,248,0.55), transparent 64%)' })} />
    <div className="rs-foliage right pale" />
    <Surface h={15} cls="pale">
      <i className="rs-mug" style={{ left: '80%' }} />
    </Surface>
  </>
);

const S_focus = () => (
  <>
    {sky}
    <div className="rs-key" style={v({ background: 'radial-gradient(26% 30% at 50% 42%, rgba(255,236,206,0.20), transparent 66%)' })} />
    <div className="rs-spot" />
  </>
);

const S_library = () => (
  <>
    {sky}
    <div className="rs-panel" />
    <Shelf side="left" />
    <Shelf side="right" />
    <div className="rs-ladder" />
    <Lamp x="22%" y={2} size={1.15} drop={54} />
    <Lamp x="78%" y={2} size={1.15} drop={54} />
    <div className="rs-key" style={v({ background: 'radial-gradient(48% 34% at 50% 4%, rgba(255,206,132,0.22), transparent 64%)' })} />
    <Surface h={17} cls="oak">
      <i className="rs-mug" style={{ left: '17%' }} />
    </Surface>
  </>
);

const S_study = () => (
  <>
    {sky}
    <div className="rs-panel warm" />
    <div className="rs-cork" />
    <Lamp x="14%" y={16} size={1.5} cone={1.25} drop={0} />
    <Shelf side="right" />
    <div className="rs-key" style={v({ background: 'radial-gradient(40% 44% at 16% 26%, rgba(255,200,124,0.26), transparent 62%)' })} />
    <Surface h={19} cls="oak">
      <i className="rs-mug" style={{ left: '78%' }} />
      <i className="rs-papers" style={{ left: '8%' }} />
    </Surface>
  </>
);

const S_candle = () => (
  <>
    {sky}
    <div className="rs-stonewall" />
    <Surface h={17} cls="oak" />
    <Candle x="12%" bottom="15%" h={78} s={1.15} />
    <Candle x="19%" bottom="14%" h={44} s={0.85} />
    <Candle x="87%" bottom="15%" h={62} s={1} />
    <div className="rs-key" style={v({ background: 'radial-gradient(52% 44% at 50% 66%, rgba(255,176,92,0.14), transparent 66%)' })} />
  </>
);

const S_fireplace = () => (
  <>
    {sky}
    <div className="rs-brick" />
    <div className="rs-hearth">
      <i className="mantel" />
      <i className="mouth" />
      <div className="fire">
        <i style={{ left: '30%', animationDelay: '-0.2s' }} />
        <i style={{ left: '44%', animationDelay: '-0.6s', transform: 'scale(1.25)' }} />
        <i style={{ left: '58%', animationDelay: '-0.9s' }} />
        <i style={{ left: '50%', animationDelay: '-1.4s', transform: 'scale(0.8)' }} />
      </div>
      <i className="logs" />
    </div>
    <div className="rs-firelight" />
    <div className="rs-chair" />
    <Surface h={14} cls="dark" />
  </>
);

const S_cafe = () => (
  <>
    {sky}
    <div className="rs-plaster warm" />
    <Win side="right" top={10} w={30} h={50} bars="cross" wood="#20160f" view={<><div className="rs-street" /><CityLights /></>} />
    <Lamp x="16%" y={0} size={0.85} drop={92} warm="255,186,104" />
    <Lamp x="30%" y={0} size={0.7} drop={128} warm="255,186,104" />
    <div className="rs-plant left" />
    <Surface h={17} cls="marble">
      <i className="rs-mug steam" style={{ left: '22%' }} />
    </Surface>
  </>
);

const S_attic = () => (
  <>
    {sky}
    <div className="rs-slope l" />
    <div className="rs-slope r" />
    <div className="rs-rafter" style={{ left: '18%' }} />
    <div className="rs-rafter" style={{ right: '18%', transform: 'rotate(-3deg)' }} />
    <Win side="right" top={12} w={24} h={32} bars="cross" wood="#2b2119" view={<div className="rs-daylight" />} />
    <div className="rs-shaft" />
    <div className="rs-boxes" />
    <Surface h={15} cls="planks" />
  </>
);

const S_cabin = () => (
  <>
    {sky}
    <div className="rs-logs" />
    <Win side="right" top={12} w={26} h={38} glass="frost" bars="grid" wood="#3a2617" view={<><div className="rs-snowfield" /><Sil d={FIR_FAR} fill="#1a2632" style={{ bottom: '26%', height: '52%' }} /></>} />
    <Lamp x="18%" y={6} size={1.1} drop={64} warm="255,178,96" />
    <div className="rs-firelight low" />
    <Surface h={16} cls="planks">
      <i className="rs-rug" />
    </Surface>
  </>
);

const S_parchment = () => (
  <>
    {sky}
    <div className="rs-stonewall" />
    <div className="rs-arch" />
    <div className="rs-key" style={v({ background: 'radial-gradient(56% 44% at 50% 8%, rgba(255,214,148,0.18), transparent 62%)' })} />
    <Surface h={18} cls="oak">
      <i className="rs-papers" style={{ left: '76%' }} />
    </Surface>
    <Candle x="11%" bottom="16%" h={66} s={1.05} />
    <Candle x="89%" bottom="16%" h={52} s={0.95} />
  </>
);

const S_noir = () => (
  <>
    {sky}
    <div className="rs-plaster cold" />
    <div className="rs-blinds" />
    <div className="rs-blinds floor" />
    <Lamp x="84%" y={30} size={1.25} cone={0.9} warm="230,226,210" />
    <div className="rs-smoke" />
    <Surface h={15} cls="dark" />
  </>
);

const S_greenhouse = () => (
  <>
    {sky}
    <div className="rs-glassroof" />
    <div className="rs-glasswall" />
    <div className="rs-shaft soft" />
    <div className="rs-foliage left" />
    <div className="rs-foliage right" />
    <div className="rs-hanging" style={{ left: '13%' }} />
    <div className="rs-hanging" style={{ right: '11%', transform: 'scale(0.82)' }} />
    <div className="rs-mist" />
    <Surface h={16} cls="terracotta">
      <i className="rs-pot" style={{ left: '10%' }} />
      <i className="rs-pot" style={{ left: '86%', transform: 'scale(0.8)' }} />
    </Surface>
  </>
);

/* -- Nature --------------------------------------------------------------- */

const S_rain = () => (
  <>
    {sky}
    <div className="rs-plaster cold" />
    <Win side="right" top={8} w={36} h={62} glass="rain" bars="cross" wood="#241b16"
      view={<><div className="rs-street night" /><CityLights /><Sil d={SKY_FAR} fill="#0d1520" style={{ bottom: 0, height: '46%' }} /></>} />
    <div className="rs-key" style={v({ background: 'radial-gradient(50% 46% at 78% 30%, rgba(150,190,236,0.14), transparent 64%)' })} />
    <Surface h={15} cls="dark">
      <i className="rs-mug steam" style={{ left: '20%' }} />
    </Surface>
  </>
);

const S_storm = () => (
  <>
    {sky}
    <div className="rs-clouds" />
    <Sil d={SKY_FAR} fill="#0a1018" style={{ bottom: '14%', height: '34%', filter: 'blur(2px)' }} />
    <Sil d={SKY_NEAR} fill="#050810" style={{ bottom: '8%', height: '44%' }} />
    <CityLights />
    <div className="rs-flash" />
    <Surface h={10} cls="wet" />
  </>
);

const S_snow = () => (
  <>
    {sky}
    <Sil d={FIR_FAR} fill="#2b3a52" style={{ bottom: '30%', height: '26%', filter: 'blur(3px)', opacity: 0.75 }} />
    <Sil d={FIR_NEAR} fill="#141f30" style={{ bottom: '24%', height: '34%' }} />
    <div className="rs-snowfield" />
    <div className="rs-drift" />
    <div className="rs-key" style={v({ background: 'radial-gradient(60% 46% at 50% 0%, rgba(214,232,255,0.18), transparent 66%)' })} />
  </>
);

const S_forest = () => (
  <>
    {sky}
    <div className="rs-woods" />
    <Sil d={FIR_FAR} fill="#16281b" style={{ bottom: '22%', height: '34%', filter: 'blur(4px)', opacity: 0.8 }} />
    <div className="rs-godrays" />
    <div className="rs-mist band low" />
    <div className="rs-canopy" />
    <Trunk side="left" at="15%" w={26} tilt={1.5} far={2} />
    <Trunk side="right" at="23%" w={20} tilt={-2} far={2.4} />
    <Trunk side="left" at="-2%" w={116} tilt={-1} />
    <Trunk side="right" at="-1%" w={132} tilt={1} />
    <div className="rs-fern left" />
    <div className="rs-fern right" />
    <Surface h={13} cls="moss" />
  </>
);

const S_autumn = () => (
  <>
    {sky}
    <div className="rs-woods warm" />
    <Sil d={FIR_FAR} fill="#5a3a1c" style={{ bottom: '26%', height: '28%', filter: 'blur(4px)', opacity: 0.7 }} />
    <div className="rs-godrays warm" />
    <div className="rs-mist band low" />
    <div className="rs-canopy autumn" />
    <Trunk side="left" at="18%" w={22} tilt={2} far={2.2} />
    <Trunk side="left" at="-2%" w={104} tilt={-1.5} />
    <Trunk side="right" at="-1%" w={120} tilt={1} />
    <div className="rs-path" />
    <Surface h={14} cls="leaflitter" />
  </>
);

const S_sakura = () => (
  <>
    {sky}
    <Sil d={FIR_FAR} fill="#3a2a38" style={{ bottom: '30%', height: '26%', filter: 'blur(3px)', opacity: 0.6 }} />
    <div className="rs-blossom top" />
    <div className="rs-branch" />
    <div className="rs-lantern" style={{ left: '9%' }} />
    <div className="rs-lantern" style={{ right: '11%', transform: 'scale(0.85)' }} />
    <div className="rs-key" style={v({ background: 'radial-gradient(50% 42% at 50% 6%, rgba(255,206,224,0.22), transparent 64%)' })} />
    <Surface h={11} cls="petalpath" />
  </>
);

const S_meadow = () => (
  <>
    {sky}
    <div className="rs-sun" style={{ left: '68%', top: '16%' }} />
    <Sil d="M0 40 L0 26 Q14 17 30 24 T60 22 T86 26 T100 21 L100 40 Z" fill="#3e6a44" style={{ bottom: '22%', height: '30%', filter: 'blur(2px)' }} />
    <Sil d="M0 40 L0 28 Q20 20 40 27 T78 25 T100 29 L100 40 Z" fill="#2c5033" style={{ bottom: '12%', height: '34%' }} />
    <div className="rs-grass" />
    <div className="rs-godrays warm" />
  </>
);

const S_ocean = () => (
  <>
    {sky}
    <div className="rs-sun" style={{ left: '50%', top: '38%' }} />
    <div className="rs-glitter" />
    <Sea top={46} />
    <Surface h={13} cls="sand" />
  </>
);

const S_lake = () => (
  <>
    {sky}
    <Sil d="M0 40 L0 22 L12 8 L22 18 L34 4 L46 16 L58 6 L72 18 L86 8 L100 20 L100 40 Z" fill="#2b3a4e" style={{ bottom: '46%', height: '30%', filter: 'blur(2px)' }} />
    <Sil d={FIR_NEAR} fill="#16212e" style={{ bottom: '44%', height: '18%' }} />
    <div className="rs-mist band" />
    <div className="rs-reflect" />
    <div className="rs-dock" />
  </>
);

const S_mountain = () => (
  <>
    {sky}
    <Sil d="M0 40 L0 24 L14 6 L26 20 L38 10 L52 24 L64 12 L78 26 L90 14 L100 24 L100 40 Z" fill="#495e78" style={{ bottom: '38%', height: '38%', filter: 'blur(3px)', opacity: 0.7 }} />
    <Sil d="M0 40 L0 26 L10 12 L20 24 L34 4 L48 22 L60 14 L74 28 L88 16 L100 28 L100 40 Z" fill="#2e3f55" style={{ bottom: '26%', height: '44%' }} />
    <div className="rs-snowcap" />
    <div className="rs-mist band low" />
    <Sil d={FIR_DENSE} fill="#101a24" style={{ bottom: '2%', height: '26%' }} />
  </>
);

const S_desert = () => (
  <>
    {sky}
    <div className="rs-sun low" style={{ left: '58%', top: '44%' }} />
    <Sil d="M0 40 L0 28 C16 18 34 30 52 26 C70 22 84 14 100 22 L100 40 Z" fill="#8a5a34" style={{ bottom: '30%', height: '26%', filter: 'blur(2px)', opacity: 0.8 }} />
    <Sil d="M0 40 L0 30 C22 22 36 34 58 30 C76 27 88 20 100 27 L100 40 Z" fill="#5e3a20" style={{ bottom: '14%', height: '34%' }} />
    <Sil d="M0 40 L0 32 C24 26 44 36 66 32 C82 29 92 26 100 30 L100 40 Z" fill="#33200f" style={{ bottom: 0, height: '30%' }} />
    <div className="rs-shimmer" />
  </>
);

const S_bamboo = () => (
  <>
    {sky}
    <div className="rs-bamboo far" />
    <div className="rs-godrays green" />
    <div className="rs-mist band low" />
    <div className="rs-stalk" style={v({ left: '3%', '--w': '30px', '--tilt': '1deg' })} />
    <div className="rs-stalk" style={v({ left: '11%', '--w': '20px', '--tilt': '-1.5deg' })} />
    <div className="rs-stalk" style={v({ left: '19%', '--w': '13px', '--tilt': '2deg', opacity: 0.7, filter: 'blur(1.6px)' })} />
    <div className="rs-stalk" style={v({ right: '4%', '--w': '34px', '--tilt': '-1deg' })} />
    <div className="rs-stalk" style={v({ right: '13%', '--w': '18px', '--tilt': '1.5deg' })} />
    <div className="rs-stalk" style={v({ right: '21%', '--w': '11px', '--tilt': '-2deg', opacity: 0.65, filter: 'blur(1.8px)' })} />
    <Surface h={12} cls="moss" />
  </>
);

const S_reef = () => (
  <>
    {sky}
    <div className="rs-deep" />
    <div className="rs-caustics" />
    <div className="rs-shaft water a" />
    <div className="rs-shaft water b" />
    <div className="rs-kelp left" />
    <div className="rs-kelp right" />
    <div className="rs-fish" style={{ top: '32%', animationDelay: '-4s' }} />
    <div className="rs-fish sm" style={{ top: '54%', animationDelay: '-14s' }} />
    <div className="rs-fish sm" style={{ top: '22%', animationDelay: '-28s' }} />
    <Surface h={11} cls="seabed" />
  </>
);

/* -- Cosmos --------------------------------------------------------------- */

const S_night = () => (
  <>
    {sky}
    <div className="rs-milkyway" />
    <Stars set={STARS_A} />
    <div className="rs-shoot" />
    <Sil d={FIR_NEAR} fill="#070c14" style={{ bottom: '6%', height: '26%' }} />
    <Surface h={9} cls="meadowdark" />
  </>
);

const S_moonlit = () => (
  <>
    {sky}
    <Stars set={STARS_B} />
    <div className="rs-moon"><i className="crater a" /><i className="crater b" /><i className="crater c" /></div>
    <div className="rs-cloudpass" />
    <div className="rs-moonpath" />
    <Sea top={64} tint={['#0a1626', '#0d1d31', '#12263e']} />
  </>
);

const S_aurora = () => (
  <>
    {sky}
    <Stars set={STARS_B} />
    <div className="rs-aurora">
      <i style={{ left: '4%', width: '30%', animationDelay: '-2s' }} />
      <i style={{ left: '26%', width: '24%', animationDelay: '-7s' }} />
      <i style={{ left: '52%', width: '28%', animationDelay: '-4s' }} />
      <i style={{ left: '74%', width: '22%', animationDelay: '-11s' }} />
    </div>
    <div className="rs-auroraglow" />
    <Sil d={FIR_NEAR} fill="#08111a" style={{ bottom: '20%', height: '26%' }} />
    <div className="rs-snowfield cold" />
  </>
);

const S_cosmos = () => (
  <>
    {sky}
    <div className="rs-nebula" />
    <Stars set={STARS_C} />
    <div className="rs-planet" />
    <div className="rs-dustlane" />
  </>
);

const S_observatory = () => (
  <>
    {sky}
    <div className="rs-slit"><div className="rs-slitsky" /><Stars set={STARS_C} cls="inslit" /></div>
    <div className="rs-dome" />
    <div className="rs-scope" />
    <div className="rs-safelight" />
    <Surface h={13} cls="dark" />
  </>
);

const S_orbit = () => (
  <>
    {sky}
    <Stars set={STARS_C} />
    <div className="rs-earth"><i className="limb" /><i className="term" /><i className="clouds" /></div>
    <div className="rs-strut" />
    <div className="rs-portframe" />
  </>
);

/* -- Journey -------------------------------------------------------------- */

const S_train = () => (
  <>
    {sky}
    <div className="rs-cabinwall" />
    <Win side="right" top={14} w={34} h={40} bars="none" wood="#1b1512"
      view={<><div className="rs-passing" /><Sil d={FIR_FAR} fill="#0c141d" style={{ bottom: 0, height: '60%' }} /><div className="rs-poles" /></>} />
    <Lamp x="20%" y={4} size={0.9} cone={0.85} warm="255,190,120" drop={20} />
    <div className="rs-seat" />
    <Surface h={14} cls="traintable" />
  </>
);

const S_plane = () => (
  <>
    {sky}
    <div className="rs-cabinwall pale" />
    <Win side="right" top={20} w={26} h={40} bars="oval" wood="#3a3d42"
      view={<><div className="rs-highsky" /><div className="rs-clouddeck" /></>} />
    <div className="rs-key" style={v({ background: 'radial-gradient(44% 44% at 82% 36%, rgba(255,196,150,0.2), transparent 62%)' })} />
    <div className="rs-readlight" />
    <div className="rs-seatrow" />
    <Surface h={14} cls="traytable" />
  </>
);

const S_tent = () => (
  <>
    {sky}
    <Stars set={STARS_A} />
    <Sil d={FIR_NEAR} fill="#0a1219" style={{ bottom: '24%', height: '22%' }} />
    <div className="rs-campfire" />
    <div className="rs-firelight low" />
    <div className="rs-tent" />
  </>
);

/* -- Mood ----------------------------------------------------------------- */

const S_sunset = () => (
  <>
    {sky}
    <div className="rs-sun big" style={{ left: '50%', top: '52%' }} />
    <div className="rs-cloudbands" />
    <Sil d="M0 40 L0 30 Q18 22 36 28 T72 27 T100 31 L100 40 Z" fill="#4a2a2e" style={{ bottom: '14%', height: '26%', filter: 'blur(2px)', opacity: 0.85 }} />
    <Sil d={SKY_NEAR} fill="#1d1018" style={{ bottom: '6%', height: '30%' }} />
    <div className="rs-glitter warm" />
  </>
);

const S_dusk = () => (
  <>
    {sky}
    <Stars set={STARS_B} cls="faint" />
    <Sil d={SKY_FAR} fill="#2a2340" style={{ bottom: '18%', height: '32%', filter: 'blur(2.5px)', opacity: 0.8 }} />
    <Sil d={SKY_NEAR} fill="#140f22" style={{ bottom: '8%', height: '40%' }} />
    <CityLights />
    <div className="rs-mist band low" />
    <Surface h={9} cls="dark" />
  </>
);

const S_romance = () => (
  <>
    {sky}
    <div className="rs-drape left" />
    <div className="rs-drape right" />
    <div className="rs-key" style={v({ background: 'radial-gradient(46% 40% at 50% 40%, rgba(255,150,180,0.14), transparent 64%)' })} />
    <Surface h={16} cls="velvet" />
    <Candle x="15%" bottom="14%" h={62} s={1.05} />
    <Candle x="22%" bottom="13%" h={38} s={0.8} />
    <Candle x="85%" bottom="14%" h={54} s={0.95} />
  </>
);

const S_lavender = () => (
  <>
    {sky}
    <div className="rs-sun" style={{ left: '52%', top: '26%' }} />
    <Sil d="M0 40 L0 28 Q22 21 44 27 T80 26 T100 29 L100 40 Z" fill="#6b5a92" style={{ bottom: '28%', height: '24%', filter: 'blur(2.5px)', opacity: 0.7 }} />
    <div className="rs-rows" />
    <div className="rs-godrays warm" />
  </>
);

const S_zen = () => (
  <>
    {sky}
    <div className="rs-shoji" />
    <div className="rs-bambooshadow" />
    <div className="rs-raked" />
    <div className="rs-stone" style={{ left: '15%' }} />
    <div className="rs-stone sm" style={{ left: '24%' }} />
    <div className="rs-stone" style={{ right: '17%', transform: 'scale(0.9)' }} />
    <div className="rs-branch maple" />
  </>
);

const S_neon = () => (
  <>
    {sky}
    <Sil d={SKY_NEAR} fill="#0a0a14" style={{ bottom: '26%', height: '46%' }} />
    <div className="rs-neonsign" style={v({ left: '6%', top: '16%', '--c': '255,60,120' })}><i /></div>
    <div className="rs-neonsign v" style={v({ left: '17%', top: '30%', '--c': '90,220,255' })}><i /></div>
    <div className="rs-neonsign" style={v({ right: '8%', top: '22%', '--c': '160,110,255' })}><i /></div>
    <div className="rs-neonsign v" style={v({ right: '20%', top: '38%', '--c': '255,190,60' })}><i /></div>
    <div className="rs-wet" />
    <Surface h={12} cls="wet" />
  </>
);

/* ================================ registry ================================ */

export const ROOMS: Room[] = [
  /* -- Study -- */
  { key: 'clean', label: 'Studio', group: 'Study', blurb: 'White walls, north light, nothing else', accent: '206,214,224', glow: 0.2, fx: { kind: 'dust', n: 22 }, scene: S_clean },
  { key: 'focus', label: 'Blackout', group: 'Study', blurb: 'One lamp, and the page', accent: '245,205,140', glow: 0.32, fx: { kind: 'dust', n: 14 }, scene: S_focus },
  { key: 'library', label: 'Old Library', group: 'Study', blurb: 'Oak, leather spines, warm globes', accent: '236,186,116', glow: 0.5, fx: { kind: 'dust', n: 30 }, scene: S_library },
  { key: 'study', label: 'Writing Desk', group: 'Study', blurb: 'A lamp at your left hand, late', accent: '244,192,120', glow: 0.45, fx: { kind: 'dust', n: 24 }, scene: S_study },
  { key: 'candle', label: 'Candlelight', group: 'Study', blurb: 'Three flames against stone', accent: '255,176,92', glow: 0.55, fx: { kind: 'ember', n: 18 }, scene: S_candle },
  { key: 'fireplace', label: 'Hearth', group: 'Study', blurb: 'Brick, embers, a chair pulled close', accent: '255,150,64', glow: 0.62, fx: { kind: 'ember', n: 34 }, scene: S_fireplace },
  { key: 'cafe', label: 'Corner Café', group: 'Study', blurb: 'Edison bulbs and a street outside', accent: '228,172,108', glow: 0.42, fx: { kind: 'bokeh', n: 10 }, scene: S_cafe },
  { key: 'attic', label: 'Attic', group: 'Study', blurb: 'A shaft of dust through the dormer', accent: '226,196,150', glow: 0.35, fx: { kind: 'dust', n: 40 }, scene: S_attic },
  { key: 'cabin', label: 'Log Cabin', group: 'Study', blurb: 'Snow at the glass, fire at your back', accent: '255,182,110', sound: 'wind', glow: 0.5, fx: { kind: 'ember', n: 14 }, scene: S_cabin },
  { key: 'parchment', label: 'Scriptorium', group: 'Study', blurb: 'Vaulted stone and tallow light', accent: '226,188,130', glow: 0.45, fx: { kind: 'dust', n: 26 }, scene: S_parchment },
  { key: 'noir', label: 'Noir', group: 'Study', blurb: 'Blind slats across the wall, rain outside', accent: '206,214,226', glow: 0.3, fx: { kind: 'dust', n: 18 }, scene: S_noir },
  { key: 'greenhouse', label: 'Greenhouse', group: 'Study', blurb: 'Glass overhead, everything growing', accent: '186,224,150', ink: '#eef6e6', glow: 0.35, fx: { kind: 'pollen', n: 26 }, scene: S_greenhouse },

  /* -- Nature -- */
  { key: 'rain', label: 'Rain Window', group: 'Nature', blurb: 'Beads on the pane, city gone soft', accent: '158,200,236', ink: '#e8eff7', sound: 'rain', glow: 0.28, fx: { kind: 'none' }, scene: S_rain },
  { key: 'storm', label: 'Thunderstorm', group: 'Nature', blurb: 'Sheet rain and far-off light', accent: '170,196,230', ink: '#e7eef8', sound: 'rain', glow: 0.3, fx: { kind: 'rain', n: 90 }, scene: S_storm },
  { key: 'snow', label: 'Snowfall', group: 'Nature', blurb: 'Blue hour, firs, no sound at all', accent: '200,220,240', ink: '#eef4fb', sound: 'wind', glow: 0.3, fx: { kind: 'snow', n: 54 }, scene: S_snow },
  { key: 'forest', label: 'Forest Floor', group: 'Nature', blurb: 'Trunks, ferns, light through leaves', accent: '150,214,150', ink: '#e8f2e4', sound: 'wind', glow: 0.34, fx: { kind: 'pollen', n: 30 }, scene: S_forest },
  { key: 'autumn', label: 'Autumn Grove', group: 'Nature', blurb: 'Copper canopy, a path underfoot', accent: '236,150,72', glow: 0.42, fx: { kind: 'leaf', n: 22, color: '#d8792a' }, scene: S_autumn },
  { key: 'sakura', label: 'Sakura', group: 'Nature', blurb: 'Blossom overhead, lanterns below', accent: '255,182,206', ink: '#fbe9ef', glow: 0.4, fx: { kind: 'petal', n: 24 }, scene: S_sakura },
  { key: 'meadow', label: 'Summer Meadow', group: 'Nature', blurb: 'Long grass and a high afternoon', accent: '196,224,120', ink: '#f2f7e4', sound: 'wind', glow: 0.36, fx: { kind: 'pollen', n: 34 }, scene: S_meadow },
  { key: 'ocean', label: 'Seaside', group: 'Nature', blurb: 'Low sun on moving water', accent: '120,214,220', ink: '#e6f5f5', sound: 'ocean', glow: 0.4, fx: { kind: 'bokeh', n: 8 }, scene: S_ocean },
  { key: 'lake', label: 'Still Lake', group: 'Nature', blurb: 'Mountains twice over, mist between', accent: '150,196,214', ink: '#e9f2f6', sound: 'wind', glow: 0.3, fx: { kind: 'firefly', n: 12 }, scene: S_lake },
  { key: 'mountain', label: 'Alpine', group: 'Nature', blurb: 'Ridge behind ridge, thin cold air', accent: '178,204,232', ink: '#edf3fa', sound: 'wind', glow: 0.28, fx: { kind: 'snow', n: 26 }, scene: S_mountain },
  { key: 'desert', label: 'Dunes', group: 'Nature', blurb: 'Last heat coming off the sand', accent: '246,178,110', glow: 0.44, fx: { kind: 'gold', n: 20 }, scene: S_desert },
  { key: 'bamboo', label: 'Bamboo Grove', group: 'Nature', blurb: 'Green light between the stalks', accent: '164,214,138', ink: '#edf6e8', sound: 'wind', glow: 0.34, fx: { kind: 'leaf', n: 16, color: '#8fbf5a' }, scene: S_bamboo },
  { key: 'reef', label: 'Underwater', group: 'Nature', blurb: 'Caustics overhead, everything slow', accent: '110,206,224', ink: '#e4f4f7', sound: 'ocean', glow: 0.36, fx: { kind: 'bubble', n: 26 }, scene: S_reef },

  /* -- Cosmos -- */
  { key: 'night', label: 'Starfield', group: 'Cosmos', blurb: 'The Milky Way over a treeline', accent: '178,186,255', ink: '#eaebfc', glow: 0.34, fx: { kind: 'firefly', n: 18 }, scene: S_night },
  { key: 'moonlit', label: 'Moonlit', group: 'Cosmos', blurb: 'A path of light across the water', accent: '196,208,240', ink: '#eaeff8', sound: 'ocean', glow: 0.36, fx: { kind: 'star', n: 0 }, scene: S_moonlit },
  { key: 'aurora', label: 'Aurora', group: 'Cosmos', blurb: 'Green curtains over the snow', accent: '130,240,200', ink: '#e6f6ee', sound: 'wind', glow: 0.4, fx: { kind: 'snow', n: 18 }, scene: S_aurora },
  { key: 'cosmos', label: 'Deep Space', group: 'Cosmos', blurb: 'Nebula dust, a planet on the edge', accent: '190,170,255', ink: '#efe9fb', sound: 'drone', glow: 0.42, fx: { kind: 'none' }, scene: S_cosmos },
  { key: 'observatory', label: 'Observatory', group: 'Cosmos', blurb: 'The dome open on a cold sky', accent: '196,184,240', ink: '#eee9fa', sound: 'drone', glow: 0.3, fx: { kind: 'dust', n: 16 }, scene: S_observatory },
  { key: 'orbit', label: 'Low Orbit', group: 'Cosmos', blurb: 'Earthrise through the port', accent: '150,196,255', ink: '#e9f0fc', sound: 'drone', glow: 0.44, fx: { kind: 'none' }, scene: S_orbit },

  /* -- Journey -- */
  { key: 'train', label: 'Night Train', group: 'Journey', blurb: 'Poles going past, a reading lamp on', accent: '246,190,124', glow: 0.42, fx: { kind: 'dust', n: 14 }, scene: S_train },
  { key: 'plane', label: 'Window Seat', group: 'Journey', blurb: 'Cloud deck at dawn, cabin dim', accent: '244,190,160', glow: 0.36, fx: { kind: 'none' }, scene: S_plane },
  { key: 'tent', label: 'Campsite', group: 'Journey', blurb: 'Fire at the door, stars past it', accent: '255,170,96', sound: 'wind', glow: 0.5, fx: { kind: 'ember', n: 26 }, scene: S_tent },

  /* -- Mood -- */
  { key: 'sunset', label: 'Golden Hour', group: 'Mood', blurb: 'Twenty minutes of good light', accent: '255,168,110', glow: 0.55, fx: { kind: 'gold', n: 24 }, scene: S_sunset },
  { key: 'dusk', label: 'Blue Hour', group: 'Mood', blurb: 'Windows coming on across town', accent: '214,170,220', ink: '#f2e9f7', glow: 0.34, fx: { kind: 'bokeh', n: 8 }, scene: S_dusk },
  { key: 'romance', label: 'Rose Light', group: 'Mood', blurb: 'Heavy drapes, candles, petals', accent: '255,158,190', ink: '#fbe9ef', glow: 0.5, fx: { kind: 'petal', n: 18 }, scene: S_romance },
  { key: 'lavender', label: 'Lavender Field', group: 'Mood', blurb: 'Rows running to a hazy sun', accent: '198,178,240', ink: '#efeafb', sound: 'wind', glow: 0.38, fx: { kind: 'pollen', n: 24 }, scene: S_lavender },
  { key: 'zen', label: 'Zen Garden', group: 'Mood', blurb: 'Raked sand, stones, paper screens', accent: '226,204,164', glow: 0.3, fx: { kind: 'leaf', n: 10, color: '#c4593a' }, scene: S_zen },
  { key: 'neon', label: 'Neon Rain', group: 'Mood', blurb: 'Signs bleeding into wet asphalt', accent: '255,110,180', ink: '#fbe9f4', sound: 'rain', glow: 0.46, fx: { kind: 'rain', n: 64 }, scene: S_neon },
];

export const ROOM_GROUPS: RoomGroup[] = ['Study', 'Nature', 'Cosmos', 'Journey', 'Mood'];
const BY_KEY = new Map(ROOMS.map((r) => [r.key, r]));
export const getRoom = (k: Atmos | undefined): Room => BY_KEY.get(k as Atmos) ?? BY_KEY.get('library')!;
export const isRoom = (k: unknown): k is Atmos => typeof k === 'string' && BY_KEY.has(k as Atmos);

/* =============================== particles ================================ */

const P_DEFAULTS: Record<PKind, number> = {
  none: 0, dust: 26, ember: 26, rain: 70, snow: 46, leaf: 20, petal: 22,
  bokeh: 12, star: 60, gold: 22, pollen: 28, firefly: 16, bubble: 24, ash: 24,
};

function Particles({ kind, n, color }: { kind: PKind; n?: number; color?: string }) {
  const count = kind === 'none' ? 0 : (n ?? P_DEFAULTS[kind]);
  const items = React.useMemo(() => {
    if (!count) return [];
    const r = rng(kind.length * 977 + count);
    return Array.from({ length: count }, (): S => {
      switch (kind) {
        case 'rain':
          return { left: `${n2(between(r, -6, 100))}%`, height: `${n2(between(r, 60, 130))}px`, animationDuration: `${n2(between(r, 0.45, 0.95))}s`, animationDelay: `${n2(-between(r, 0, 1.2))}s`, opacity: n2(between(r, 0.3, 0.75)) };
        case 'snow':
          return { left: `${n2(between(r, 0, 100))}%`, animationDuration: `${n2(between(r, 6, 14))}s`, animationDelay: `${n2(-between(r, 0, 12))}s`, transform: `scale(${n2(between(r, 0.4, 1.2))})`, opacity: n2(between(r, 0.4, 0.95)) };
        case 'ember':
          return { left: `${n2(between(r, 12, 88))}%`, animationDuration: `${n2(between(r, 3.2, 7))}s`, animationDelay: `${n2(-between(r, 0, 6))}s`, transform: `scale(${n2(between(r, 0.5, 1.3))})` };
        case 'leaf':
        case 'petal':
          return { left: `${n2(between(r, -4, 100))}%`, animationDuration: `${n2(between(r, 8, 16))}s`, animationDelay: `${n2(-between(r, 0, 14))}s`, transform: `scale(${n2(between(r, 0.6, 1.3))})` };
        case 'bokeh': {
          const s = between(r, 70, 220);
          return { left: `${n2(between(r, 2, 92))}%`, top: `${n2(between(r, 6, 88))}%`, width: `${n2(s)}px`, height: `${n2(s)}px`, animationDuration: `${n2(between(r, 9, 18))}s`, animationDelay: `${n2(-between(r, 0, 10))}s` };
        }
        case 'bubble':
          return { left: `${n2(between(r, 2, 98))}%`, animationDuration: `${n2(between(r, 7, 16))}s`, animationDelay: `${n2(-between(r, 0, 14))}s`, transform: `scale(${n2(between(r, 0.4, 1.4))})` };
        case 'firefly':
          return { left: `${n2(between(r, 4, 96))}%`, top: `${n2(between(r, 40, 92))}%`, animationDuration: `${n2(between(r, 5, 11))}s`, animationDelay: `${n2(-between(r, 0, 10))}s` };
        case 'star':
          return { left: `${n2(between(r, 0, 100))}%`, top: `${n2(between(r, 0, 80))}%`, animationDuration: `${n2(between(r, 2.4, 6))}s`, animationDelay: `${n2(-between(r, 0, 6))}s` };
        default:
          return { left: `${n2(between(r, 1, 98))}%`, top: `${n2(between(r, 4, 94))}%`, animationDuration: `${n2(between(r, 8, 18))}s`, animationDelay: `${n2(-between(r, 0, 12))}s`, transform: `scale(${n2(between(r, 0.5, 1.4))})` };
      }
    });
  }, [kind, count]);

  if (!items.length) return null;
  return (
    <div className={`rs-fx rs-fx-${kind}`} aria-hidden style={color ? v({ '--pc': color }) : undefined}>
      {items.map((s, i) => <i key={i} style={s} />)}
    </div>
  );
}

/* ================================= stage ================================== */

/**
 * The room itself. `still` is the picker preview: no particles, no blur, no
 * animation — 40 of these render at once and they need to stay cheap.
 */
export function RoomScene({ atmos, still = false }: { atmos: Atmos; still?: boolean }) {
  const room = getRoom(atmos);
  return (
    <div className={`rs${still ? ' rs-still' : ''}`} data-room={room.key} aria-hidden>
      {room.scene()}
      {!still && <Particles kind={room.fx.kind} n={room.fx.n} color={room.fx.color} />}
      <div className="rs-vig" />
      {!still && <div className="rs-grain" />}
    </div>
  );
}

/** A room reduced to a card — the real scene, scaled down. */
export function RoomPreview({ atmos }: { atmos: Atmos }) {
  return (
    <div className="rs-preview">
      <div className="rs-preview-stage"><RoomScene atmos={atmos} still /></div>
    </div>
  );
}
