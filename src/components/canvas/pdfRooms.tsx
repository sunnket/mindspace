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
  | 'attic' | 'cabin' | 'parchment' | 'noir' | 'greenhouse' | 'bath'
  /* Nature */
  | 'rain' | 'storm' | 'snow' | 'forest' | 'autumn' | 'sakura' | 'meadow'
  | 'ocean' | 'lake' | 'mountain' | 'desert' | 'bamboo' | 'reef'
  | 'waterfall' | 'canyon'
  /* Cosmos */
  | 'night' | 'moonlit' | 'aurora' | 'cosmos' | 'observatory' | 'orbit'
  | 'ringed' | 'eclipse'
  /* Journey */
  | 'train' | 'plane' | 'tent' | 'ferry' | 'motel' | 'balloon'
  /* Mood */
  | 'sunset' | 'dusk' | 'romance' | 'lavender' | 'zen' | 'neon'
  | 'rooftop' | 'hammock' | 'fog'
  /* Genre — rooms that match what you're reading */
  | 'crypt' | 'manor' | 'stakeout' | 'oakroom' | 'poetseat' | 'carrel'
  | 'bridge' | 'tower' | 'tavern' | 'warroom' | 'chapel' | 'fort'
  | 'maproom' | 'lab' | 'office' | 'kitchen' | 'arcade'
  | 'parlour' | 'chambers' | 'newsroom' | 'captain' | 'bunker' | 'safehouse'
  | 'temple' | 'gallery' | 'musicroom' | 'dorm' | 'bedtime' | 'workshop'
  | 'porch' | 'tatami' | 'anatomy' | 'archive' | 'sunroom';

type PKind =
  | 'none' | 'dust' | 'ember' | 'rain' | 'snow' | 'leaf' | 'petal' | 'bokeh'
  | 'star' | 'gold' | 'pollen' | 'firefly' | 'bubble' | 'ash';

export type RoomGroup = 'Genre' | 'Study' | 'Nature' | 'Cosmos' | 'Journey' | 'Mood';

export interface Room {
  key: Atmos;
  label: string;
  group: RoomGroup;
  /** One line in the picker — what the place feels like, not what it contains. */
  blurb: string;
  /**
   * The kind of book this room was built for, printed on the card as an
   * overline. Rooms that suit anything leave it off — a room labelled for
   * everything is a room labelled for nothing.
   */
  reads?: string;
  /**
   * What someone might type looking for this place: authors, moods, the words
   * a bookshop puts on the shelf edge. Never shown; only searched.
   */
  tags?: string[];
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

/* -- Genre: rooms that match what you're reading --------------------------- */

/* Horror. The rule for a scary room is restraint: one small light, a great deal
   of dark, and something in it that is *almost* a figure. */
const S_crypt = () => (
  <>
    {sky}
    <div className="rs-cryptwall" />
    <div className="rs-arches" />
    <div className="rs-figure" />
    <div className="rs-cobweb left" />
    <div className="rs-cobweb right" />
    <Surface h={15} cls="cryptfloor" />
    <Candle x="14%" bottom="13%" h={54} s={1.1} />
    <div className="rs-key" style={v({ background: 'radial-gradient(40% 34% at 14% 62%, rgba(255,170,90,0.14), transparent 66%)' })} />
    <div className="rs-breath" />
  </>
);

const S_manor = () => (
  <>
    {sky}
    <div className="rs-panel" />
    <div className="rs-portrait" />
    <Win side="right" top={8} w={34} h={58} glass="rain" bars="grid" wood="#1a120c"
      view={<><div className="rs-street night" /><Sil d={FIR_NEAR} fill="#070c12" style={{ bottom: 0, height: '62%' }} /></>} />
    <div className="rs-flash" />
    <div className="rs-cobweb left" />
    <Surface h={16} cls="oak" />
    <Candle x="12%" bottom="14%" h={60} s={1.05} />
    <div className="rs-breath" />
  </>
);

const S_stakeout = () => (
  <>
    {sky}
    <div className="rs-plaster cold" />
    <div className="rs-blinds" />
    <div className="rs-blinds floor" />
    <div className="rs-corkcase" />
    <Lamp x="86%" y={26} size={1.15} cone={0.8} warm="226,222,204" />
    <div className="rs-smoke" />
    <Surface h={16} cls="dark">
      <i className="rs-mug" style={{ left: '16%' }} />
      <i className="rs-papers" style={{ left: '72%' }} />
    </Surface>
  </>
);

/* Classics & study. These are the opposite problem: nothing spooky, everything
   solid — deep wood, brass, green glass, the light of a lamp you own. */
const S_oakroom = () => (
  <>
    {sky}
    <div className="rs-panel" />
    <div className="rs-wainscot" />
    <Shelf side="left" />
    <div className="rs-frame art" style={{ right: '9%' }} />
    <div className="rs-bankers" />
    <div className="rs-key" style={v({ background: 'radial-gradient(38% 34% at 76% 44%, rgba(140,255,190,0.10), transparent 66%)' })} />
    <Surface h={19} cls="oak">
      <i className="rs-papers" style={{ left: '20%' }} />
      <i className="rs-mug" style={{ left: '84%' }} />
    </Surface>
  </>
);

const S_poetseat = () => (
  <>
    {sky}
    <div className="rs-plaster cold" />
    <div className="rs-recess" />
    <Win side="right" top={13} w={30} h={52} glass="rain" bars="grid" wood="#2b2822"
      view={<><div className="rs-street" /><Sil d={FIR_FAR} fill="#1c2733" style={{ bottom: 0, height: '54%' }} /></>} />
    <div className="rs-cushion" />
    <div className="rs-key" style={v({ background: 'radial-gradient(44% 40% at 74% 34%, rgba(176,206,236,0.16), transparent 64%)' })} />
    <Surface h={13} cls="planks">
      <i className="rs-mug steam" style={{ left: '18%' }} />
    </Surface>
  </>
);

const S_carrel = () => (
  <>
    {sky}
    <div className="rs-carrelwalls" />
    <Shelf side="right" />
    <Lamp x="24%" y={20} size={1.3} cone={1.1} warm="255,214,150" />
    <div className="rs-pinboard" />
    <div className="rs-key" style={v({ background: 'radial-gradient(34% 40% at 26% 34%, rgba(255,206,140,0.2), transparent 62%)' })} />
    <Surface h={20} cls="carreldesk">
      <i className="rs-papers" style={{ left: '12%' }} />
      <i className="rs-mug steam" style={{ left: '66%' }} />
      <i className="rs-bookstack" style={{ left: '84%' }} />
    </Surface>
  </>
);

/* Sci-fi. You are on watch: instruments below, everything else out there. */
const S_bridge = () => (
  <>
    {sky}
    <div className="rs-viewport"><Stars set={STARS_C} /><div className="rs-nebula faint" /></div>
    <div className="rs-hull" />
    <div className="rs-console" />
    <div className="rs-key" style={v({ background: 'radial-gradient(60% 30% at 50% 96%, rgba(120,200,255,0.16), transparent 66%)' })} />
    <Surface h={9} cls="deck" />
  </>
);

/* Fantasy. Stone, star charts, and candles that never asked for a table. */
const S_tower = () => (
  <>
    {sky}
    <div className="rs-stonewall" />
    <div className="rs-archwin"><Stars set={STARS_B} /><div className="rs-moon sm"><i className="crater a" /></div></div>
    <div className="rs-chart" style={{ left: '5%', top: '16%' }} />
    <div className="rs-chart sm" style={{ left: '20%', top: '46%', transform: 'rotate(4deg)' }} />
    <Candle x="13%" bottom="62%" h={38} s={0.9} />
    <Candle x="24%" bottom="72%" h={30} s={0.75} />
    <Candle x="84%" bottom="58%" h={34} s={0.85} />
    <div className="rs-key" style={v({ background: 'radial-gradient(46% 42% at 50% 40%, rgba(180,160,255,0.14), transparent 66%)' })} />
    <Surface h={15} cls="dark" />
  </>
);

const S_tavern = () => (
  <>
    {sky}
    <div className="rs-panel warm" />
    <div className="rs-beam tav" style={{ left: '-4%' }} />
    <div className="rs-beam tav" style={{ right: '-4%' }} />
    <div className="rs-tankards" />
    <div className="rs-hearthglow" />
    <Lamp x="50%" y={0} size={0.9} drop={70} warm="255,182,96" />
    <div className="rs-firelight" />
    <Surface h={18} cls="oak">
      <i className="rs-mug" style={{ left: '14%' }} />
      <i className="rs-mug" style={{ left: '86%', transform: 'scale(0.9)' }} />
    </Surface>
  </>
);

/* History and war. One light, a table of maps, and the blackout up. */
const S_warroom = () => (
  <>
    {sky}
    <div className="rs-plaster cold" />
    <div className="rs-pinmaps" />
    <Lamp x="50%" y={0} size={1.4} cone={1.3} drop={40} warm="255,226,180" />
    <div className="rs-maptable" />
    <Surface h={12} cls="dark" />
  </>
);

/* Philosophy, scripture, the long classics. Colour arrives through glass. */
const S_chapel = () => (
  <>
    {sky}
    <div className="rs-stonewall" />
    <div className="rs-stained" />
    <div className="rs-colorcast" />
    <div className="rs-pews" />
    <Candle x="10%" bottom="16%" h={64} s={1.1} />
    <Candle x="90%" bottom="16%" h={56} s={1} />
    <Surface h={15} cls="stonefloor" />
  </>
);

/* Children's and YA. Sheets over chairs, a torch, and no bedtime. */
const S_fort = () => (
  <>
    {sky}
    <div className="rs-sheet" />
    <div className="rs-fairy" />
    <div className="rs-cushions" />
    <div className="rs-key" style={v({ background: 'radial-gradient(46% 42% at 50% 62%, rgba(255,212,140,0.22), transparent 68%)' })} />
    <div className="rs-torch" />
  </>
);

/* Travel and adventure. Charts, a globe, brass, somewhere to be going. */
const S_maproom = () => (
  <>
    {sky}
    <div className="rs-panel" />
    <div className="rs-chart big" style={{ left: '4%', top: '10%' }} />
    <div className="rs-chart" style={{ right: '6%', top: '14%', transform: 'rotate(-3deg)' }} />
    <div className="rs-globe" />
    <Lamp x="22%" y={14} size={1.2} cone={1} warm="255,206,140" />
    <Surface h={18} cls="oak">
      <i className="rs-papers" style={{ left: '62%' }} />
    </Surface>
  </>
);

/* Science and medicine. Cold, clean, and lit from directly above. */
const S_lab = () => (
  <>
    {sky}
    <div className="rs-tiles" />
    <div className="rs-shelfglass" />
    <div className="rs-glassware" />
    <div className="rs-key" style={v({ background: 'linear-gradient(180deg, rgba(200,240,255,0.16), transparent 44%)' })} />
    <Surface h={16} cls="bench" />
  </>
);

/* Business, biography, the late working night. The city is the wallpaper. */
const S_office = () => (
  <>
    {sky}
    <div className="rs-curtainwall">
      <div className="rs-street night" />
      <Sil d={SKY_FAR} fill="#0a1018" style={{ bottom: 0, height: '54%', filter: 'blur(1.5px)' }} />
      <Sil d={SKY_NEAR} fill="#05070d" style={{ bottom: 0, height: '44%' }} />
      <CityLights />
    </div>
    <div className="rs-mullions" />
    <Lamp x="16%" y={22} size={1.1} cone={0.8} warm="255,214,160" />
    <Surface h={16} cls="marble" />
  </>
);

/* Cookery and memoir. Somebody has been in here all afternoon. */
const S_kitchen = () => (
  <>
    {sky}
    <div className="rs-tilesplash" />
    <Win side="right" top={12} w={26} h={38} bars="grid" wood="#5a4630" view={<div className="rs-daylight" />} />
    <div className="rs-pans" />
    <div className="rs-herbs" />
    <div className="rs-key" style={v({ background: 'radial-gradient(50% 46% at 82% 30%, rgba(255,238,200,0.24), transparent 64%)' })} />
    <Surface h={18} cls="butcher">
      <i className="rs-mug steam" style={{ left: '24%' }} />
    </Surface>
  </>
);

/* Comics, manga, games. Every light in here is a screen. */
const S_arcade = () => (
  <>
    {sky}
    <div className="rs-carpet" />
    <div className="rs-cab" style={v({ left: '2%', '--c': '255,60,120' })} />
    <div className="rs-cab" style={v({ left: '16%', '--c': '90,220,255', height: '58%' })} />
    <div className="rs-cab" style={v({ right: '3%', '--c': '160,110,255' })} />
    <div className="rs-cab" style={v({ right: '17%', '--c': '255,190,60', height: '56%' })} />
    <div className="rs-crt" />
    <div className="rs-scan" />
  </>
);

/* ===================== genre, the second wing =============================
   The first set covered the big shelves. These are the rooms the rest of the
   library is written in or set in — one per kind of reading, and the card now
   says which, so you pick a room the way you pick a book. Same house rules:
   the side gutters and the bottom edge do the work, the middle stays clear. */

/* Mystery. Fog on the glass, a fire in here, and the one chair that gets sat
   in. Nothing is happening yet, which is the point. */
const S_parlour = () => (
  <>
    {sky}
    <div className="rs-panel warm" />
    <div className="rs-wainscot" />
    <Win side="right" top={9} w={29} h={50} bars="grid" wood="#241a12"
      view={<><div className="rs-street night" /><div className="rs-gaslamp" /><div className="rs-fogbank a" /></>} />
    <div className="rs-frame art" style={{ left: '6%' }} />
    <div className="rs-violin" />
    <Lamp x="21%" y={16} size={1.15} cone={0.9} warm="255,204,146" />
    <div className="rs-wingchair" />
    <div className="rs-key" style={v({ background: 'radial-gradient(38% 40% at 22% 30%, rgba(255,198,138,0.18), transparent 64%)' })} />
    <Surface h={17} cls="oak">
      <i className="rs-papers" style={{ left: '10%' }} />
      <i className="rs-mug steam" style={{ left: '74%' }} />
    </Surface>
  </>
);

/* Legal. Calf-bound reports by the yard, briefs tied in pink ribbon, and a
   window onto a courtyard nobody crosses. */
const S_chambers = () => (
  <>
    {sky}
    <div className="rs-panel" />
    <Shelf side="left" />
    <Win side="right" top={7} w={27} h={56} bars="grid" wood="#2a2018"
      view={<><div className="rs-street" /><Sil d={SKY_FAR} fill="#1a222c" style={{ bottom: 0, height: '42%' }} /></>} />
    <div className="rs-briefs" />
    <div className="rs-bankers" style={{ right: '30%', bottom: '20%', transform: 'scale(0.86)' }} />
    <div className="rs-key" style={v({ background: 'radial-gradient(34% 32% at 60% 46%, rgba(140,255,190,0.10), transparent 66%)' })} />
    <Surface h={19} cls="oak">
      <i className="rs-papers" style={{ left: '14%' }} />
    </Surface>
  </>
);

/* Journalism and reportage. Monitors, a wall of clocks set to cities you are
   not in, and the copy still open. */
const S_newsroom = () => (
  <>
    {sky}
    <div className="rs-curtainwall">
      <div className="rs-street night" />
      <Sil d={SKY_NEAR} fill="#05070d" style={{ bottom: 0, height: '46%' }} />
      <CityLights />
    </div>
    <div className="rs-mullions" />
    <div className="rs-clockwall" />
    <div className="rs-monitors" />
    <Lamp x="13%" y={22} size={0.95} cone={0.42} warm="236,226,200" />
    <div className="rs-key" style={v({ background: 'radial-gradient(52% 24% at 50% 78%, rgba(150,200,255,0.12), transparent 64%)' })} />
    <Surface h={15} cls="dark">
      <i className="rs-papers" style={{ left: '80%' }} />
    </Surface>
  </>
);

/* Sea stories. Stern windows onto your own wake, and a lantern that keeps
   telling you which way the ship is leaning. */
const S_captain = () => (
  <>
    {sky}
    <div className="rs-panel warm" />
    <div className="rs-sternwin">
      <Stars set={STARS_B} />
      <Sea top={44} tint={['#08202e', '#0b2a3a', '#0f3647']} />
      <div className="rs-wake" />
    </div>
    <div className="rs-swinglamp"><i /></div>
    <div className="rs-chart" style={{ left: '3%', top: '46%', transform: 'rotate(-3deg)' }} />
    <div className="rs-sextant" />
    <div className="rs-key" style={v({ background: 'radial-gradient(44% 40% at 50% 24%, rgba(255,196,130,0.16), transparent 64%)' })} />
    <Surface h={17} cls="oak">
      <i className="rs-papers" style={{ left: '78%' }} />
    </Surface>
  </>
);

/* Dystopia. Poured concrete, a strip light with a fault in it, and a door
   built to be shut from this side. */
const S_bunker = () => (
  <>
    {sky}
    <div className="rs-concrete" />
    <div className="rs-pipes" />
    <div className="rs-blastdoor" />
    <div className="rs-stencil" />
    <div className="rs-striplight" />
    <Surface h={13} cls="concretefloor" />
  </>
);

/* Espionage. One bulb, tape on the glass so it does not go everywhere, and a
   set you are not supposed to have. */
const S_safehouse = () => (
  <>
    {sky}
    <div className="rs-plaster cold" />
    <div className="rs-peel" />
    <Win side="right" top={12} w={28} h={44} bars="none" wood="#1a1a1c"
      view={<><div className="rs-street night" /><CityLights /></>} />
    <div className="rs-tape" />
    <div className="rs-bulb" />
    <div className="rs-radio" />
    <div className="rs-key" style={v({ background: 'radial-gradient(34% 34% at 50% 12%, rgba(255,226,180,0.16), transparent 62%)' })} />
    <Surface h={14} cls="dark">
      <i className="rs-papers" style={{ left: '18%' }} />
    </Surface>
  </>
);

/* Myth and epic. Columns, an olive going silver, and the sea going dark
   below the steps. */
const S_temple = () => (
  <>
    {sky}
    <Sil d="M0 40 L0 30 Q16 24 34 28 T66 26 T100 30 L100 40 Z" fill="#3c3550" style={{ bottom: '40%', height: '22%', filter: 'blur(3px)', opacity: 0.65 }} />
    <Sea top={54} tint={['#1a2340', '#20304e', '#2a3d5e']} />
    <div className="rs-pediment" />
    <div className="rs-column" style={{ left: '2%' }} />
    <div className="rs-column" style={{ left: '16%', transform: 'scale(0.9)', filter: 'blur(0.6px)' }} />
    <div className="rs-column" style={{ right: '2%' }} />
    <div className="rs-column" style={{ right: '17%', transform: 'scale(0.92)', filter: 'blur(0.6px)' }} />
    <div className="rs-olive" />
    <div className="rs-key" style={v({ background: 'radial-gradient(50% 38% at 50% 60%, rgba(255,190,130,0.14), transparent 66%)' })} />
    <Surface h={14} cls="stonefloor" />
  </>
);

/* Art, design, photography. A wall you may stand in front of for as long as
   you like, and a bench that expects you to. */
const S_gallery = () => (
  <>
    {sky}
    <div className="rs-plaster bright" />
    <div className="rs-picwall" />
    <div className="rs-canvasart tall" style={{ left: '3%' }} />
    <div className="rs-canvasart" style={{ left: '19%' }} />
    <div className="rs-canvasart wide" style={{ right: '3%' }} />
    <div className="rs-canvasart" style={{ right: '21%' }} />
    <div className="rs-piclight" />
    <div className="rs-bench" />
    <Surface h={14} cls="parquet" />
  </>
);

/* Music, and the lives of musicians. The lid up, the light low, something
   still open on the stand. */
const S_musicroom = () => (
  <>
    {sky}
    <div className="rs-panel warm" />
    <Win side="right" top={9} w={25} h={46} bars="cross" wood="#241a12"
      view={<><div className="rs-street night" /><CityLights /></>} />
    <div className="rs-piano" />
    <div className="rs-stand" />
    <Lamp x="15%" y={13} size={1.15} cone={0.9} warm="255,206,150" />
    <div className="rs-key" style={v({ background: 'radial-gradient(40% 42% at 17% 26%, rgba(255,200,140,0.18), transparent 64%)' })} />
    <Surface h={14} cls="parquet" />
  </>
);

/* Young adult and contemporary. String lights, a laptop nobody closed, and
   somebody's laundry on the end of the bed. */
const S_dorm = () => (
  <>
    {sky}
    <div className="rs-plaster cold" />
    <div className="rs-posters" />
    <Win side="right" top={13} w={23} h={32} bars="cross" wood="#3a3a3c"
      view={<><div className="rs-street night" /><CityLights /></>} />
    <div className="rs-fairy" />
    <div className="rs-laptop" />
    <div className="rs-bunk" />
    <div className="rs-key" style={v({ background: 'radial-gradient(46% 40% at 50% 26%, rgba(255,186,150,0.16), transparent 66%)' })} />
    <Surface h={15} cls="dormfloor" />
  </>
);

/* Picture books, read to somebody. The ceiling is the sky and the light is a
   very small one. */
const S_bedtime = () => (
  <>
    {sky}
    <div className="rs-projected"><Stars set={STARS_B} /></div>
    <div className="rs-moon sm" style={{ left: '11%', top: '11%' }}><i className="crater a" /></div>
    <div className="rs-toys" />
    <div className="rs-nightlight" />
    <div className="rs-duvet" />
    <div className="rs-key" style={v({ background: 'radial-gradient(38% 34% at 80% 56%, rgba(255,196,146,0.2), transparent 66%)' })} />
  </>
);

/* Making things, and the books about making things. Brass, oil, and a gauge
   that has been past the red at least once. */
const S_workshop = () => (
  <>
    {sky}
    <div className="rs-plaster warm" />
    <div className="rs-pegboard" />
    <div className="rs-pipes brass" />
    <div className="rs-gears" />
    <div className="rs-gauge" />
    <Lamp x="78%" y={14} size={1.1} cone={0.95} warm="255,196,120" />
    <div className="rs-key" style={v({ background: 'radial-gradient(40% 40% at 78% 28%, rgba(255,190,110,0.18), transparent 64%)' })} />
    <Surface h={17} cls="workbench">
      <i className="rs-bookstack" style={{ left: '13%' }} />
    </Surface>
  </>
);

/* Westerns and the American road. A screen door, a lantern, and the last of
   the day's heat coming back off the ground. */
const S_porch = () => (
  <>
    {sky}
    <div className="rs-sun low" style={{ left: '46%', top: '48%' }} />
    <Sil d="M0 40 L0 30 C18 22 34 32 54 28 C72 24 86 18 100 26 L100 40 Z" fill="#5a3a24" style={{ bottom: '28%', height: '24%', filter: 'blur(2px)', opacity: 0.85 }} />
    <Sil d="M0 40 L0 32 C24 26 44 36 66 32 C82 29 92 26 100 30 L100 40 Z" fill="#2b1a0e" style={{ bottom: '20%', height: '24%' }} />
    <div className="rs-porchroof" />
    <div className="rs-porchpost" style={{ left: '5%' }} />
    <div className="rs-porchpost" style={{ right: '5%' }} />
    <div className="rs-lantern" style={{ right: '17%', top: '13%', transform: 'scale(0.78)' }} />
    <div className="rs-rocker" />
    <Surface h={16} cls="planks" />
  </>
);

/* Manga, and fiction that arrived in translation. A small room, a low table,
   and the city coming in through one wet pane. */
const S_tatami = () => (
  <>
    {sky}
    <div className="rs-shoji" />
    <Win side="right" top={15} w={21} h={29} glass="rain" bars="grid" wood="#2a231c"
      view={<><div className="rs-street night" /><div className="rs-neonsign" style={v({ left: '12%', top: '26%', transform: 'scale(0.42)', '--c': '255,60,120' })}><i /></div><CityLights /></>} />
    <div className="rs-paperlamp" />
    <div className="rs-lowtable" />
    <div className="rs-key" style={v({ background: 'radial-gradient(38% 38% at 23% 38%, rgba(255,214,170,0.16), transparent 66%)' })} />
    <Surface h={16} cls="tatami" />
  </>
);

/* Medicine and the body. Tiered rails, a cold light straight down, and the
   rest of the room left in the dark where it belongs. */
const S_anatomy = () => (
  <>
    {sky}
    <div className="rs-tiers" />
    <div className="rs-skeleton" />
    <div className="rs-jars" />
    <div className="rs-overhead" />
    <div className="rs-key" style={v({ background: 'radial-gradient(28% 40% at 50% 0%, rgba(210,235,255,0.2), transparent 62%)' })} />
    <Surface h={14} cls="slab" />
  </>
);

/* Biography, history, anything with sources. Stacks on rails, grey boxes, and
   exactly one lamp switched on. */
const S_archive = () => (
  <>
    {sky}
    <div className="rs-stacks left" />
    <div className="rs-stacks right" />
    <div className="rs-railtrack" />
    <div className="rs-boxrow" />
    <Lamp x="23%" y={0} size={1.05} cone={1.15} drop={76} warm="255,214,160" />
    <div className="rs-key" style={v({ background: 'radial-gradient(34% 40% at 23% 34%, rgba(255,206,150,0.2), transparent 64%)' })} />
    <Surface h={13} cls="lino" />
  </>
);

/* Wellbeing, and everything read early. Linen, plants, and a morning nobody
   has used yet. */
const S_sunroom = () => (
  <>
    {sky}
    <div className="rs-plaster bright" />
    <div className="rs-frenchdoor" />
    <div className="rs-castshadow" />
    <div className="rs-plant left" />
    <div className="rs-hanging" style={{ right: '7%', transform: 'scale(0.76)' }} />
    <div className="rs-wicker" />
    <div className="rs-key" style={v({ background: 'radial-gradient(54% 62% at 76% 18%, rgba(255,250,238,0.5), transparent 64%)' })} />
    <Surface h={15} cls="linen">
      <i className="rs-mug steam" style={{ left: '19%' }} />
    </Surface>
  </>
);

/* ==================== the rest of the house, extended =====================
   A few more places to be that are not tied to a genre: the bath, weather
   that hides things, two more skies, three more journeys. */

/* The one place where a paperback going soft is an acceptable cost. */
const S_bath = () => (
  <>
    {sky}
    <div className="rs-tilewall" />
    <div className="rs-tub" />
    <div className="rs-bathsteam" />
    <Candle x="7%" bottom="34%" h={40} s={0.9} />
    <Candle x="14%" bottom="32%" h={28} s={0.7} />
    <Candle x="90%" bottom="34%" h={34} s={0.85} />
    <div className="rs-key" style={v({ background: 'radial-gradient(46% 40% at 50% 70%, rgba(255,184,110,0.14), transparent 66%)' })} />
  </>
);

const S_waterfall = () => (
  <>
    {sky}
    <div className="rs-cliff left" />
    <div className="rs-cliff right" />
    <div className="rs-fall" />
    <div className="rs-spray" />
    <div className="rs-godrays green" />
    <div className="rs-fern left" />
    <div className="rs-fern right" />
    <Surface h={13} cls="moss" />
  </>
);

const S_canyon = () => (
  <>
    {sky}
    <div className="rs-slot left" />
    <div className="rs-slot right" />
    <div className="rs-shaft" />
    <div className="rs-sandfall" />
    <Surface h={12} cls="sand" />
  </>
);

const S_ringed = () => (
  <>
    {sky}
    <Stars set={STARS_C} />
    <div className="rs-giant" />
    <div className="rs-rings" />
    <div className="rs-strut" />
    <div className="rs-portframe" />
  </>
);

const S_eclipse = () => (
  <>
    {sky}
    <Stars set={STARS_B} cls="faint" />
    <div className="rs-corona" />
    <div className="rs-disc" />
    <div className="rs-horizonglow" />
    <Sil d={SKY_NEAR} fill="#05060c" style={{ bottom: 0, height: '32%' }} />
  </>
);

const S_ferry = () => (
  <>
    {sky}
    <Sil d="M0 40 L0 30 L14 22 L28 30 L44 24 L60 31 L78 25 L100 31 L100 40 Z" fill="#1c2b34" style={{ bottom: '48%', height: '18%', filter: 'blur(2.4px)', opacity: 0.75 }} />
    <Sea top={54} tint={['#12303c', '#17414f', '#1d5262']} />
    <div className="rs-gull" />
    <div className="rs-railing" />
    <div className="rs-deckbench" />
    <Surface h={14} cls="deckplanks" />
  </>
);

const S_motel = () => (
  <>
    {sky}
    <div className="rs-plaster warm" />
    <Win side="right" top={13} w={29} h={40} bars="none" wood="#2c2622"
      view={<><div className="rs-street night" /><div className="rs-lot" /><div className="rs-vacancy" /></>} />
    <div className="rs-motellight" />
    <Lamp x="22%" y={26} size={1} cone={0.85} warm="255,206,150" />
    <div className="rs-headboard" />
    <Surface h={16} cls="dark">
      <i className="rs-bookstack" style={{ left: '13%' }} />
    </Surface>
  </>
);

const S_balloon = () => (
  <>
    {sky}
    <Sil d="M0 40 L0 32 L16 26 L30 33 L48 27 L66 34 L84 28 L100 33 L100 40 Z" fill="#4a5a70" style={{ bottom: '12%', height: '22%', filter: 'blur(3px)', opacity: 0.55 }} />
    <div className="rs-clouddeck" style={{ bottom: '14%', opacity: 0.7 }} />
    <div className="rs-envelope" />
    <div className="rs-burner" />
    <div className="rs-basket" />
  </>
);

const S_rooftop = () => (
  <>
    {sky}
    <Sil d={SKY_FAR} fill="#1a2036" style={{ bottom: '24%', height: '34%', filter: 'blur(2px)', opacity: 0.8 }} />
    <Sil d={SKY_NEAR} fill="#0b0e1c" style={{ bottom: '16%', height: '40%' }} />
    <CityLights />
    <div className="rs-festoon" />
    <div className="rs-parapet" />
    <div className="rs-deckchair" />
    <Surface h={13} cls="roofdeck" />
  </>
);

const S_hammock = () => (
  <>
    {sky}
    <div className="rs-sun low" style={{ left: '58%', top: '50%' }} />
    <Sea top={58} tint={['#0e4a58', '#12606e', '#1a7a84']} />
    <div className="rs-palm left" />
    <div className="rs-palm right" />
    <div className="rs-hammock" />
    <Surface h={13} cls="sand" />
  </>
);

const S_fog = () => (
  <>
    {sky}
    <Sil d={FIR_FAR} fill="#39434a" style={{ bottom: '34%', height: '24%', filter: 'blur(6px)', opacity: 0.45 }} />
    <Sil d={FIR_NEAR} fill="#242c33" style={{ bottom: '26%', height: '30%', filter: 'blur(2.4px)', opacity: 0.8 }} />
    <div className="rs-fogbank a" />
    <div className="rs-fogbank b" />
    <Trunk side="left" at="1%" w={72} tilt={-1} />
    <Trunk side="right" at="0%" w={84} tilt={1} />
    <Surface h={12} cls="moss" />
  </>
);

/* ================================ registry ================================ */

export const ROOMS: Room[] = [
  /* -- Genre: pick the room that matches the book. `reads` is printed on the
     card, so the grid answers "what do I read in here" without a hover. -- */
  { key: 'crypt', label: 'The Crypt', group: 'Genre', reads: 'Horror', blurb: 'One candle, and a great deal of dark', tags: ['horror', 'ghost', 'scary', 'gothic', 'supernatural', 'king'], accent: '255,152,74', glow: 0.5, fx: { kind: 'dust', n: 28 }, scene: S_crypt },
  { key: 'parlour', label: 'The Parlour', group: 'Genre', reads: 'Mystery', blurb: 'Fog at the glass, a fire, and one chair that gets sat in', tags: ['mystery', 'detective', 'whodunit', 'crime', 'cosy', 'cozy', 'sherlock', 'christie', 'victorian'], accent: '255,196,132', glow: 0.46, fx: { kind: 'dust', n: 24 }, scene: S_parlour },
  { key: 'stakeout', label: 'The Stakeout', group: 'Genre', reads: 'Thriller', blurb: 'Blinds, cold coffee, a case wall', tags: ['thriller', 'crime', 'true crime', 'noir', 'police', 'suspense'], accent: '214,220,228', glow: 0.32, fx: { kind: 'dust', n: 20 }, scene: S_stakeout },
  { key: 'safehouse', label: 'Safe House', group: 'Genre', reads: 'Espionage', blurb: 'One bulb, tape on the glass, a set you should not have', tags: ['spy', 'espionage', 'cold war', 'thriller', 'le carre', 'conspiracy'], accent: '236,214,168', glow: 0.34, fx: { kind: 'dust', n: 18 }, scene: S_safehouse },
  { key: 'chambers', label: 'Barrister’s Chambers', group: 'Genre', reads: 'Legal', blurb: 'Calf-bound reports and briefs tied in pink ribbon', tags: ['legal', 'law', 'court', 'courtroom', 'trial', 'grisham', 'justice'], accent: '164,232,192', glow: 0.4, fx: { kind: 'dust', n: 22 }, scene: S_chambers },
  { key: 'bridge', label: "Ship's Bridge", group: 'Genre', reads: 'Science fiction', blurb: 'Your watch, and everything else out there', tags: ['sci fi', 'science fiction', 'space opera', 'future', 'starship'], accent: '130,200,255', ink: '#e8f2fc', sound: 'drone', glow: 0.4, fx: { kind: 'none' }, scene: S_bridge },
  { key: 'bunker', label: 'The Bunker', group: 'Genre', reads: 'Dystopia', blurb: 'Concrete, a fault in the strip light, a door that seals', tags: ['dystopia', 'post apocalyptic', 'apocalypse', 'survival', 'orwell', 'grimdark'], accent: '196,208,206', ink: '#e9eeed', glow: 0.26, fx: { kind: 'dust', n: 22 }, scene: S_bunker },
  { key: 'tower', label: "Wizard's Tower", group: 'Genre', reads: 'Fantasy', blurb: 'Star charts, old stone, candles that float', tags: ['fantasy', 'magic', 'epic fantasy', 'wizard', 'tolkien', 'dragons'], accent: '196,172,255', ink: '#efeafc', glow: 0.48, fx: { kind: 'ember', n: 16 }, scene: S_tower },
  { key: 'temple', label: 'Temple Steps', group: 'Genre', reads: 'Myth & epic', blurb: 'Columns, an olive going silver, the sea going dark', tags: ['mythology', 'myth', 'epic', 'greek', 'roman', 'homer', 'ancient', 'classics'], accent: '246,206,150', glow: 0.42, fx: { kind: 'dust', n: 20 }, scene: S_temple },
  { key: 'tavern', label: 'The Tavern', group: 'Genre', reads: 'Adventure', blurb: 'Low beams, a fire, someone telling it wrong', tags: ['adventure', 'quest', 'swashbuckling', 'rpg', 'dungeons'], accent: '255,178,96', glow: 0.55, fx: { kind: 'ember', n: 22 }, scene: S_tavern },
  { key: 'captain', label: "Captain's Cabin", group: 'Genre', reads: 'Sea stories', blurb: 'Stern windows onto your own wake', tags: ['nautical', 'sea', 'maritime', 'sailing', 'naval', 'obrian', 'melville', 'pirates'], accent: '255,200,140', glow: 0.44, sound: 'ocean', fx: { kind: 'dust', n: 18 }, scene: S_captain },
  { key: 'manor', label: 'Storm Manor', group: 'Genre', reads: 'Gothic', blurb: 'Rain on old glass, lightning behind it', tags: ['gothic', 'bronte', 'romance', 'haunted', 'victorian', 'du maurier'], accent: '206,182,150', sound: 'rain', glow: 0.4, fx: { kind: 'none' }, scene: S_manor },
  { key: 'oakroom', label: 'The Oak Room', group: 'Genre', reads: 'Classics', blurb: 'Green glass, brass, deep panelling', tags: ['classics', 'literary fiction', 'canon', 'austen', 'dickens', 'literature'], accent: '150,236,190', glow: 0.42, fx: { kind: 'dust', n: 26 }, scene: S_oakroom },
  { key: 'poetseat', label: "Poet's Window", group: 'Genre', reads: 'Poetry', blurb: 'A window seat, rain, tea going cold', tags: ['poetry', 'verse', 'poems', 'essays', 'letters', 'quiet'], accent: '176,206,236', ink: '#eaf1f8', sound: 'rain', glow: 0.34, fx: { kind: 'none' }, scene: S_poetseat },
  { key: 'chapel', label: 'The Chapel', group: 'Genre', reads: 'Philosophy', blurb: 'Colour arriving through very old glass', tags: ['philosophy', 'theology', 'scripture', 'religion', 'spiritual', 'stoic'], accent: '226,196,140', glow: 0.44, fx: { kind: 'dust', n: 30 }, scene: S_chapel },
  { key: 'warroom', label: 'The War Room', group: 'Genre', reads: 'History', blurb: 'One lamp over a table of maps', tags: ['history', 'war', 'military', 'strategy', 'politics'], accent: '255,222,170', glow: 0.42, fx: { kind: 'dust', n: 26 }, scene: S_warroom },
  { key: 'archive', label: 'The Archive', group: 'Genre', reads: 'Biography', blurb: 'Stacks on rails, grey boxes, one lamp switched on', tags: ['biography', 'memoir', 'history', 'research', 'genealogy', 'sources', 'nonfiction'], accent: '246,208,156', glow: 0.4, fx: { kind: 'dust', n: 30 }, scene: S_archive },
  { key: 'newsroom', label: 'The Newsroom', group: 'Genre', reads: 'Reportage', blurb: 'A wall of clocks set to cities you are not in', tags: ['journalism', 'reportage', 'news', 'current affairs', 'politics', 'essays', 'nonfiction'], accent: '186,214,246', ink: '#eaf1fa', glow: 0.32, fx: { kind: 'none' }, scene: S_newsroom },
  { key: 'lab', label: 'The Laboratory', group: 'Genre', reads: 'Science', blurb: 'Cold, clean, and lit from directly above', tags: ['science', 'physics', 'chemistry', 'textbook', 'research', 'stem'], accent: '186,226,244', ink: '#eaf4fa', glow: 0.3, fx: { kind: 'none' }, scene: S_lab },
  { key: 'anatomy', label: 'Anatomy Theatre', group: 'Genre', reads: 'Medicine', blurb: 'Tiered rails, and a light that comes straight down', tags: ['medicine', 'medical', 'anatomy', 'biology', 'nursing', 'body', 'health'], accent: '206,230,246', ink: '#ecf5fb', glow: 0.28, fx: { kind: 'dust', n: 16 }, scene: S_anatomy },
  { key: 'carrel', label: 'The Carrel', group: 'Genre', reads: 'Study', blurb: 'A library cubicle at two in the morning', tags: ['study', 'revision', 'exam', 'thesis', 'academic', 'university', 'notes'], accent: '255,206,140', glow: 0.46, fx: { kind: 'dust', n: 22 }, scene: S_carrel },
  { key: 'office', label: 'Corner Office', group: 'Genre', reads: 'Business', blurb: 'The city doing the work of a wallpaper', tags: ['business', 'economics', 'finance', 'startup', 'management', 'strategy'], accent: '226,206,180', glow: 0.36, fx: { kind: 'none' }, scene: S_office },
  { key: 'workshop', label: 'The Workshop', group: 'Genre', reads: 'Making', blurb: 'Brass, oil, and a gauge that has been past the red', tags: ['steampunk', 'engineering', 'diy', 'craft', 'how to', 'making', 'maker', 'tinker'], accent: '255,190,110', glow: 0.46, fx: { kind: 'dust', n: 26 }, scene: S_workshop },
  { key: 'maproom', label: 'The Map Room', group: 'Genre', reads: 'Travel', blurb: 'Charts, a globe, somewhere to be going', tags: ['travel', 'exploration', 'geography', 'expedition', 'atlas'], accent: '246,200,132', glow: 0.44, fx: { kind: 'dust', n: 22 }, scene: S_maproom },
  { key: 'porch', label: 'The Porch', group: 'Genre', reads: 'Westerns', blurb: 'A lantern, and the day’s heat coming back off the ground', tags: ['western', 'americana', 'frontier', 'southern', 'road', 'cormac'], accent: '255,182,110', glow: 0.46, sound: 'wind', fx: { kind: 'gold', n: 18 }, scene: S_porch },
  { key: 'kitchen', label: 'Kitchen Table', group: 'Genre', reads: 'Cookery', blurb: 'Somebody has been in here all afternoon', tags: ['cookery', 'cooking', 'food', 'recipes', 'memoir', 'baking'], accent: '255,224,164', glow: 0.42, fx: { kind: 'dust', n: 20 }, scene: S_kitchen },
  { key: 'sunroom', label: 'The Sunroom', group: 'Genre', reads: 'Wellbeing', blurb: 'Linen, plants, and a morning nobody has used yet', tags: ['self help', 'wellbeing', 'wellness', 'mindfulness', 'health', 'habits', 'morning'], accent: '255,238,206', glow: 0.34, fx: { kind: 'dust', n: 20 }, scene: S_sunroom },
  { key: 'gallery', label: 'The Gallery', group: 'Genre', reads: 'Art & design', blurb: 'A wall you may stand in front of for as long as you like', tags: ['art', 'design', 'photography', 'architecture', 'museum', 'painting'], accent: '236,226,210', glow: 0.3, fx: { kind: 'dust', n: 18 }, scene: S_gallery },
  { key: 'musicroom', label: 'The Music Room', group: 'Genre', reads: 'Music', blurb: 'The lid up, the light low, something still on the stand', tags: ['music', 'jazz', 'classical', 'opera', 'band', 'biography', 'lyrics'], accent: '255,204,150', glow: 0.44, fx: { kind: 'dust', n: 22 }, scene: S_musicroom },
  { key: 'tatami', label: 'Tokyo Room', group: 'Genre', reads: 'Manga', blurb: 'A low table, and the city through one wet pane', tags: ['manga', 'anime', 'japan', 'japanese', 'translated', 'murakami', 'light novel'], accent: '255,206,164', sound: 'rain', glow: 0.4, fx: { kind: 'none' }, scene: S_tatami },
  { key: 'arcade', label: 'The Arcade', group: 'Genre', reads: 'Comics & games', blurb: 'Every light in here is a screen', tags: ['comics', 'graphic novel', 'games', 'gaming', 'retro', 'cyberpunk'], accent: '255,110,180', ink: '#fbe9f4', glow: 0.5, fx: { kind: 'none' }, scene: S_arcade },
  { key: 'dorm', label: 'Dorm Room', group: 'Genre', reads: 'Young adult', blurb: 'String lights, and a laptop nobody closed', tags: ['ya', 'young adult', 'romance', 'contemporary', 'college', 'coming of age', 'booktok'], accent: '255,178,158', glow: 0.42, fx: { kind: 'bokeh', n: 7 }, scene: S_dorm },
  { key: 'fort', label: 'Blanket Fort', group: 'Genre', reads: 'Middle grade', blurb: 'Sheets, fairy lights, no bedtime', tags: ['children', 'kids', 'middle grade', 'adventure', 'family'], accent: '255,206,150', glow: 0.5, fx: { kind: 'bokeh', n: 8 }, scene: S_fort },
  { key: 'bedtime', label: 'Bedtime', group: 'Genre', reads: 'Picture books', blurb: 'The ceiling is the sky and the light is a small one', tags: ['children', 'picture book', 'bedtime', 'kids', 'toddler', 'read aloud', 'nursery'], accent: '255,196,146', glow: 0.4, fx: { kind: 'star', n: 0 }, scene: S_bedtime },

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
  { key: 'bath', label: 'The Long Bath', group: 'Study', blurb: 'Steam, tile, and a paperback going soft', tags: ['bath', 'soak', 'relax', 'unwind', 'candles', 'evening'], accent: '255,184,124', glow: 0.44, fx: { kind: 'dust', n: 16 }, scene: S_bath },

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
  { key: 'waterfall', label: 'The Falls', group: 'Nature', blurb: 'Green light, wet rock, and a noise you stop hearing', accent: '158,224,196', ink: '#e8f7f0', sound: 'ocean', glow: 0.34, fx: { kind: 'pollen', n: 20 }, scene: S_waterfall },
  { key: 'canyon', label: 'Slot Canyon', group: 'Nature', blurb: 'Sandstone, and one shaft of noon getting in', accent: '255,168,96', glow: 0.46, fx: { kind: 'gold', n: 26 }, scene: S_canyon },

  /* -- Cosmos -- */
  { key: 'night', label: 'Starfield', group: 'Cosmos', blurb: 'The Milky Way over a treeline', accent: '178,186,255', ink: '#eaebfc', glow: 0.34, fx: { kind: 'firefly', n: 18 }, scene: S_night },
  { key: 'moonlit', label: 'Moonlit', group: 'Cosmos', blurb: 'A path of light across the water', accent: '196,208,240', ink: '#eaeff8', sound: 'ocean', glow: 0.36, fx: { kind: 'star', n: 0 }, scene: S_moonlit },
  { key: 'aurora', label: 'Aurora', group: 'Cosmos', blurb: 'Green curtains over the snow', accent: '130,240,200', ink: '#e6f6ee', sound: 'wind', glow: 0.4, fx: { kind: 'snow', n: 18 }, scene: S_aurora },
  { key: 'cosmos', label: 'Deep Space', group: 'Cosmos', blurb: 'Nebula dust, a planet on the edge', accent: '190,170,255', ink: '#efe9fb', sound: 'drone', glow: 0.42, fx: { kind: 'none' }, scene: S_cosmos },
  { key: 'observatory', label: 'Observatory', group: 'Cosmos', blurb: 'The dome open on a cold sky', accent: '196,184,240', ink: '#eee9fa', sound: 'drone', glow: 0.3, fx: { kind: 'dust', n: 16 }, scene: S_observatory },
  { key: 'orbit', label: 'Low Orbit', group: 'Cosmos', blurb: 'Earthrise through the port', accent: '150,196,255', ink: '#e9f0fc', sound: 'drone', glow: 0.44, fx: { kind: 'none' }, scene: S_orbit },
  { key: 'ringed', label: 'Ring System', group: 'Cosmos', blurb: 'A gas giant on its side, and its ice edge-on', accent: '246,214,164', ink: '#f6efe2', sound: 'drone', glow: 0.42, fx: { kind: 'none' }, scene: S_ringed },
  { key: 'eclipse', label: 'Totality', group: 'Cosmos', blurb: 'Two minutes of the wrong kind of night', accent: '255,236,196', ink: '#f6f0e4', glow: 0.38, fx: { kind: 'star', n: 0 }, scene: S_eclipse },

  /* -- Journey -- */
  { key: 'train', label: 'Night Train', group: 'Journey', blurb: 'Poles going past, a reading lamp on', accent: '246,190,124', glow: 0.42, fx: { kind: 'dust', n: 14 }, scene: S_train },
  { key: 'plane', label: 'Window Seat', group: 'Journey', blurb: 'Cloud deck at dawn, cabin dim', accent: '244,190,160', glow: 0.36, fx: { kind: 'none' }, scene: S_plane },
  { key: 'ferry', label: 'Ferry Deck', group: 'Journey', blurb: 'A rail, a wake, and an hour with nothing to do', accent: '166,214,230', ink: '#eaf4f8', sound: 'ocean', glow: 0.32, fx: { kind: 'bokeh', n: 6 }, scene: S_ferry },
  { key: 'balloon', label: 'Basket', group: 'Journey', blurb: 'Above the cloud deck, and only the burner for company', accent: '255,200,140', glow: 0.44, fx: { kind: 'none' }, scene: S_balloon },
  { key: 'motel', label: 'Roadside Motel', group: 'Journey', blurb: 'A sign you can read through the curtain', accent: '255,164,140', glow: 0.4, fx: { kind: 'dust', n: 16 }, scene: S_motel },
  { key: 'tent', label: 'Campsite', group: 'Journey', blurb: 'Fire at the door, stars past it', accent: '255,170,96', sound: 'wind', glow: 0.5, fx: { kind: 'ember', n: 26 }, scene: S_tent },

  /* -- Mood -- */
  { key: 'sunset', label: 'Golden Hour', group: 'Mood', blurb: 'Twenty minutes of good light', accent: '255,168,110', glow: 0.55, fx: { kind: 'gold', n: 24 }, scene: S_sunset },
  { key: 'dusk', label: 'Blue Hour', group: 'Mood', blurb: 'Windows coming on across town', accent: '214,170,220', ink: '#f2e9f7', glow: 0.34, fx: { kind: 'bokeh', n: 8 }, scene: S_dusk },
  { key: 'romance', label: 'Rose Light', group: 'Mood', blurb: 'Heavy drapes, candles, petals', accent: '255,158,190', ink: '#fbe9ef', glow: 0.5, fx: { kind: 'petal', n: 18 }, scene: S_romance },
  { key: 'lavender', label: 'Lavender Field', group: 'Mood', blurb: 'Rows running to a hazy sun', accent: '198,178,240', ink: '#efeafb', sound: 'wind', glow: 0.38, fx: { kind: 'pollen', n: 24 }, scene: S_lavender },
  { key: 'zen', label: 'Zen Garden', group: 'Mood', blurb: 'Raked sand, stones, paper screens', accent: '226,204,164', glow: 0.3, fx: { kind: 'leaf', n: 10, color: '#c4593a' }, scene: S_zen },
  { key: 'neon', label: 'Neon Rain', group: 'Mood', blurb: 'Signs bleeding into wet asphalt', accent: '255,110,180', ink: '#fbe9f4', sound: 'rain', glow: 0.46, fx: { kind: 'rain', n: 64 }, scene: S_neon },
  { key: 'rooftop', label: 'Rooftop', group: 'Mood', blurb: 'Festoon bulbs, and the whole town below them', accent: '255,198,148', glow: 0.42, fx: { kind: 'bokeh', n: 9 }, scene: S_rooftop },
  { key: 'hammock', label: 'Hammock', group: 'Mood', blurb: 'Palms, a slow sea, and no reason to sit up', accent: '255,204,140', sound: 'ocean', glow: 0.46, fx: { kind: 'gold', n: 16 }, scene: S_hammock },
  { key: 'fog', label: 'Sea Fog', group: 'Mood', blurb: 'Everything past the second tree, gone', accent: '198,210,216', ink: '#eef2f4', sound: 'wind', glow: 0.24, fx: { kind: 'dust', n: 18 }, scene: S_fog },
];

export const ROOM_GROUPS: RoomGroup[] = ['Genre', 'Study', 'Nature', 'Cosmos', 'Journey', 'Mood'];
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

/**
 * A room reduced to a card — the real scene, scaled down.
 *
 * `live` wakes one card up: rain falls, the candle gutters, the fog moves.
 * Eighty-five of those at once would melt the tab, so the picker only ever
 * passes it for the card under the cursor.
 */
export function RoomPreview({ atmos, live = false }: { atmos: Atmos; live?: boolean }) {
  return (
    <div className={`rs-preview${live ? ' live' : ''}`}>
      <div className="rs-preview-stage"><RoomScene atmos={atmos} still={!live} /></div>
    </div>
  );
}
