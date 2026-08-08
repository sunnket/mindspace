/**
 * GLSL for the Universe view.
 *
 * Almost none of the realism here is geometry. A planet is a 32-segment sphere;
 * what makes it read as a world is the shading — a terminator that falls where
 * the sun actually is, atmosphere that scatters at grazing angles, oceans that
 * catch a specular highlight the land does not, and city lights that only
 * appear on the night side. Modelling any of that as mesh would cost thousands
 * of times more and look worse.
 *
 * Everything is procedural and seeded, so a body looks the same every time it
 * is drawn without shipping a single texture.
 */

/* ------------------------------------------------------------------- noise */

/** Value noise + fbm. Compact, tileable enough, and cheap on a sphere. */
export const NOISE = /* glsl */ `
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}

float gnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dot(hash33(i + vec3(0,0,0)), f - vec3(0,0,0)),
            dot(hash33(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
        mix(dot(hash33(i + vec3(0,1,0)), f - vec3(0,1,0)),
            dot(hash33(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
    mix(mix(dot(hash33(i + vec3(0,0,1)), f - vec3(0,0,1)),
            dot(hash33(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
        mix(dot(hash33(i + vec3(0,1,1)), f - vec3(0,1,1)),
            dot(hash33(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
}

float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * gnoise(p);
    n += a;
    p *= 2.02;
    a *= 0.5;
  }
  return s / max(n, 0.0001);
}

/* Ridged fbm — sharp crests instead of soft hills. This is what turns a blob
   of noise into mountain ranges and into the filament structure of a nebula. */
float ridged(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * (1.0 - abs(gnoise(p)));
    n += a;
    p *= 2.07;
    a *= 0.5;
  }
  return s / max(n, 0.0001);
}

/* Worley / cellular noise, returning the two nearest feature distances.
   fbm cannot express a CELL. Convection — on a star, in a lava lake, in a pot
   of soup — packs the surface with discrete cells that are bright in the middle
   and dark at the shared boundary, and the boundary is a ridge in (d2 - d1), a
   quantity fbm has no way to produce. Every procedural sun that looks like a
   lava lamp is one built out of fbm. */
vec3 worley(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      for (int z = -1; z <= 1; z++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = hash33(i + g) * 0.5 + 0.5;
        float d = length(g + o - f);
        if (d < d1) {
          d2 = d1; d1 = d;
          // Which cell won, as a number. Without it every cell is identical
          // apart from its outline, and a field of identical cells reads as a
          // honeycomb rather than as something boiling.
          id = fract(dot(i + g, vec3(11.7, 37.3, 71.9)) * 0.017);
        } else if (d < d2) { d2 = d; }
      }
    }
  }
  return vec3(d1, d2, id);
}
`;

/* ------------------------------------------------------------ rocky planet */

export const PLANET_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vPosL;

void main() {
  vPosL = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const PLANET_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec3 uSea;
uniform float uSeaLevel;
uniform float uSeed;
uniform float uIce;
uniform float uTime;
uniform float uCityLights;
uniform float uSunI;

varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vPosL;

${NOISE}

void main() {
  vec3 sp = normalize(vPosL) * 2.1 + vec3(uSeed);

  /* Continents. Two octave sets multiplied rather than added: the low-frequency
     one decides WHERE land is at all, the ridged one gives that land relief.
     Adding them instead produces the even, all-over lumpiness that makes
     procedural planets look like golf balls. */
  float base = fbm(sp, 5) * 0.5 + 0.5;
  float relief = ridged(sp * 3.1, 5);
  float h = base * 0.78 + relief * 0.30 * base;

  float land = smoothstep(uSeaLevel - 0.012, uSeaLevel + 0.012, h);
  float depth = smoothstep(uSeaLevel, uSeaLevel - 0.24, h);

  vec3 ocean = mix(uSea, uSea * 0.34, depth);
  vec3 ground = mix(uLow, uMid, smoothstep(uSeaLevel, uSeaLevel + 0.16, h));
  ground = mix(ground, uHigh, smoothstep(uSeaLevel + 0.15, uSeaLevel + 0.34, h));
  // A little dirt variation so continents are not flat colour fields.
  ground *= 0.86 + 0.28 * (fbm(sp * 7.3, 3) * 0.5 + 0.5);

  vec3 albedo = mix(ocean, ground, land);

  // Ice caps, pushed around by noise so the edge is not a latitude line.
  float lat = abs(normalize(vPosL).y);
  float ice = smoothstep(uIce, uIce + 0.16, lat + fbm(sp * 4.0, 3) * 0.09);
  albedo = mix(albedo, vec3(0.92, 0.95, 0.99), ice * 0.94);

  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunDir);
  float lam = dot(N, L);

  /* The terminator. A hard step reads as a CG sphere; real ones are softened
     by atmosphere over a few degrees, and warmed where the light grazes. */
  float day = smoothstep(-0.12, 0.22, lam);
  vec3 warm = mix(vec3(1.0), vec3(1.0, 0.72, 0.46), smoothstep(0.34, -0.06, lam));

  vec3 col = albedo * day * uSunI * warm;

  // Ocean specular — only water is smooth enough to throw a highlight.
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 62.0) * (1.0 - land) * (1.0 - ice) * day;
  col += vec3(0.85, 0.92, 1.0) * spec * 0.85;

  /* Night side. Cities cluster on habitable land, so they are gated on being
     low, dry and ice-free — which puts them on coastlines, where they are. */
  float night = 1.0 - day;
  float pop = smoothstep(0.62, 0.95, fbm(sp * 13.0, 4) * 0.5 + 0.5);
  float lights = pop * land * (1.0 - ice) * smoothstep(0.42, 0.2, h);
  col += vec3(1.0, 0.78, 0.42) * lights * night * uCityLights;

  /* Starlight. Space is not a darkroom — a world with its day side turned away
     is still lit by the rest of the galaxy, faintly and coldly. Without this a
     night-facing planet renders as a perfectly black disc, which reads as a
     hole punched in the sky rather than as a world. */
  col += albedo * 0.03 + vec3(0.012, 0.017, 0.032) * (0.4 + 0.6 * night);

  gl_FragColor = vec4(col, 1.0);
}
`;

/* -------------------------------------------------------------- gas giant */

export const GAS_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uBandA;
uniform vec3 uBandB;
uniform vec3 uStorm;
uniform float uSeed;
uniform float uTime;
uniform float uSunI;

varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vPosL;

${NOISE}

void main() {
  vec3 n = normalize(vPosL);

  /* Banding is latitude plus turbulence. The turbulence has to be stretched
     hard along longitude (x,z scaled down, y scaled up) or the bands come out
     as blobs — zonal winds smear structure sideways, they do not swirl it. */
  float turb = fbm(vec3(n.x * 1.6, n.y * 7.0, n.z * 1.6) + uSeed, 5);
  float lat = n.y * 5.4 + turb * 0.85;
  float band = sin(lat * 3.14159) * 0.5 + 0.5;
  band = smoothstep(0.18, 0.82, band);

  vec3 albedo = mix(uBandA, uBandB, band);
  albedo *= 0.88 + 0.24 * (fbm(vec3(n.x * 3.0, n.y * 12.0, n.z * 3.0) + uSeed * 2.0, 4) * 0.5 + 0.5);

  // A single great storm, elongated the way a real one is.
  vec2 sc = vec2(atan(n.z, n.x), asin(clamp(n.y, -1.0, 1.0)));
  vec2 sp2 = vec2(sc.x - 1.1, (sc.y + 0.34) * 2.6);
  float storm = 1.0 - smoothstep(0.0, 0.42, length(vec2(sp2.x * 0.55, sp2.y)));
  albedo = mix(albedo, uStorm, storm * 0.85);

  vec3 N = normalize(vNormalW);
  float lam = dot(N, normalize(uSunDir));
  float day = smoothstep(-0.14, 0.24, lam);

  // Limb darkening — a thick atmosphere dims toward the edge of the disc.
  vec3 V = normalize(cameraPosition - vPosW);
  float limb = pow(max(dot(N, V), 0.0), 0.42);

  vec3 col = albedo * day * limb * uSunI;
  col += albedo * 0.02;
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ------------------------------------------------------------- atmosphere */

/** A shell just outside the planet, back faces, additive. */
export const ATMO_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uColor;
uniform float uPower;
uniform float uStrength;

varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vPosL;

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);

  /* Rim falloff. Air is only visible where you are looking through a lot of it,
     which is at the limb — hence the Fresnel term rather than a flat glow. */
  float rim = pow(1.0 - max(dot(N, V), 0.0), uPower);

  float lam = dot(N, normalize(uSunDir));
  float lit = smoothstep(-0.42, 0.34, lam);

  /* Forward scattering: the atmosphere flares where the sun is behind the limb,
     which is the bright crescent you see from orbit at dawn. */
  float fwd = pow(max(dot(V, -normalize(uSunDir)), 0.0), 3.0);

  vec3 col = uColor * rim * (lit * 0.85 + fwd * 0.6) * uStrength;
  gl_FragColor = vec4(col, 1.0);
}
`;

/* -------------------------------------------------------------------- sun */

/**
 * The photosphere.
 *
 * A star in white light is not an orange glow. It is a SURFACE — the sharpest
 * edge in astronomy, because the gas goes from opaque to transparent over a few
 * hundred kilometres out of seven hundred thousand — and it is covered in
 * structure that a photograph resolves plainly: granules, spots with umbra and
 * penumbra, bright faculae crowding the limb. Anything that softens that edge
 * or flattens that structure stops being a star and becomes a light bulb.
 *
 * Nothing here is toned for the screen. The disc is deliberately brighter than
 * white and the tone mapper is left to roll it off, because that is what a real
 * exposure of a star does.
 */
export const SUN_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uHot;
uniform vec3 uCool;
uniform vec3 uSpot;
uniform float uSeed;
uniform float uActivity;

varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vPosL;

${NOISE}

void main() {
  vec3 n = normalize(vPosL);
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  // mu: the cosine of the angle between the surface and the line of sight.
  // 1 at the centre of the disc, 0 at the limb. Every term below keys off it.
  float mu = clamp(dot(N, V), 0.0, 1.0);

  /* GRANULATION.
     Convection columns about a thousand kilometres across: hot gas rises in the
     middle of each cell and sinks in the dark lane at its edge. So the pattern
     is cellular — bright polygons separated by a dark network — and it renews
     itself every few minutes, which is why it is allowed to move at all. */
  float superg = fbm(n * 6.0 + vec3(uTime * 0.010) + uSeed * 1.7, 4) * 0.5 + 0.5;
  /* Granules are not all the same size, and a lattice of identical cells is the
     giveaway — it reads as crazed glaze on a pot rather than as boiling gas. So
     the sampling frequency is itself modulated by the supergranular field. */
  float freq = 30.0 + 26.0 * superg;
  vec3 gp = n * freq + vec3(0.0, uTime * 0.05, uTime * 0.018) + uSeed;
  vec3 cell = worley(gp);
  float edge = cell.y - cell.x;              // 0 on a cell boundary
  float lane = smoothstep(0.0, 0.11, edge);  // 0 in the lane, 1 in the cell body
  // Bright in the middle of a cell, because that is where the gas is rising.
  float dome = 1.0 - smoothstep(0.0, 0.7, cell.x) * 0.30;
  // And no two cells the same brightness — each is its own convection column,
  // at its own point in its own few-minute life.
  float gran = mix(0.30, 1.0, lane) * dome * (0.78 + 0.44 * cell.z);

  /* Detail has to switch itself off before it goes under a pixel.
     Granules are about a thousandth of the star across, so pull the camera back
     and each cell is a fraction of a pixel — the shader then samples one
     arbitrary point inside a cell per pixel and the disc comes back as orange
     STATIC. This is what mip-mapping does for a texture, done by hand: measure
     how much of the pattern one pixel covers, and fade to the pattern's average
     once that exceeds about a cell. The sun keeps its texture up close and goes
     smooth at a distance, which is exactly what a real one does. */
  float perPixel = length(fwidth(n)) * freq;
  gran = mix(gran, 0.74, smoothstep(0.18, 0.72, perPixel));

  // A slow, much larger convection pattern underneath makes whole regions of
  // cells hotter than their neighbours.
  gran *= 0.68 + 0.60 * superg;

  /* SUNSPOTS.
     A rope of magnetic field punches through the surface and stops convection
     underneath it, so the gas there cannot be resupplied with heat — a spot is
     genuinely about two thousand degrees cooler than its surroundings. It has a
     near-black umbra and a penumbra of filaments combed radially outward.
     They appear in two mid-latitude belts, never at the poles or the equator. */
  float region = fbm(n * 2.4 + uSeed * 5.3, 4) * 0.5 + 0.5;
  float lat = abs(n.y);
  float belt = exp(-pow((lat - 0.28) * 5.4, 2.0));
  float act = region * belt * uActivity;
  float umbra = smoothstep(0.50, 0.60, act);
  float penum = smoothstep(0.36, 0.52, act);
  // Filaments in the penumbra run out of the spot, so they are sampled at high
  // frequency against the same field that placed it.
  float fil = ridged(n * 40.0 + uSeed * 2.0, 3);
  penum = clamp(penum - umbra, 0.0, 1.0) * (0.5 + 0.5 * fil);

  /* FACULAE.
     Magnetic bright points sitting down inside the intergranular lanes. At disc
     centre you are looking straight down into a lane and see nothing; near the
     limb you see the hot WALL of it side-on, so faculae light up exactly where
     limb darkening is dimming everything else. That crossover is why a real
     sun's edge is mottled and bright rather than a clean dark rim. */
  float fac = (1.0 - lane) * smoothstep(0.85, 0.16, mu) * smoothstep(0.40, 0.72, region);

  float temp = gran * (1.0 - umbra * 0.80) * (1.0 - penum * 0.34) + fac * 0.34;

  /* LIMB DARKENING, in the Eddington form: I(mu) / I(0) = 0.3 + 0.7 * mu.
     Looking at the edge of the disc your sight line skims the surface and never
     reaches the deep, hot layers, so you see shallower and cooler gas. It also
     goes REDDER there, and strongly — blue photons come from further down. A
     star rendered with the dimming but not the reddening still looks metallic;
     the two together are most of what sells it as a ball of gas. */
  float ld = 0.26 + 0.74 * mu;
  float redden = 1.0 - pow(mu, 0.45);

  vec3 col = mix(uCool, uHot, smoothstep(0.24, 0.90, temp));
  col = mix(col, uSpot, umbra * 0.92);
  col *= ld;
  col = mix(col, col * vec3(1.10, 0.66, 0.34), redden * 0.80);

  /* Hot, but only just.
     A star should be overexposed — that is honest — and the temptation is to
     hand the tone mapper a huge number and let it deal with it. That is exactly
     wrong, and it is what made the first attempt at this a featureless white
     ball: ACES maps 2.0 to 0.93 and 3.4 to 0.98, so past about two everything
     lands in the same five percent of the output range and every granule, spot
     and facula computed above is quantised into flat white. The disc has to sit
     just far enough over 1.0 to blow out and bloom while the limb, at a third
     of that, still has somewhere to fall. */
  gl_FragColor = vec4(col * 1.34, 1.0);
}
`;

/* ------------------------------------------------------------- star field */

/**
 * Stars, drawn with real inverse-square attenuation.
 *
 * This is the shader the Milky Way is made of, and the reason the old one could
 * never have produced it. Before, every star was drawn at a fixed screen size
 * and a fixed brightness — which was harmless while they all sat on one shell
 * at the same distance, and became the whole problem the moment the stars were
 * arranged into an actual galactic disk with the camera inside it.
 *
 * The band across the sky is not a texture and never was. It is a few hundred
 * thousand stars too far away to resolve individually, each landing on a
 * fraction of a pixel, SUMMING. Looking along the plane of the disk you look
 * through the long axis of the galaxy and that sum is large; looking out of the
 * plane you are through it in a few hundred parsecs and the sky is nearly
 * empty. Attenuation is the mechanism. Give every star the same brightness
 * regardless of distance and no arrangement of them will ever make a band.
 */
export const STARS_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
uniform float uTime;
uniform float uPixelRatio;
uniform float uTwinkle;
uniform float uRefDist;
uniform float uAtten;
uniform float uGain;
varying vec3 vColor;
varying float vAlpha;
varying float vBright;

void main() {
  vColor = aColor;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;

  float d = max(-mv.z, 1.0);
  /* aSize is the star's apparent size at the reference distance, so aSize*aSize
     is its luminosity in those units, and the flux reaching us is that over
     distance squared. uAtten switches the law off for things that are not
     stars — a comet tail is metres from the camera in scene units and would
     otherwise arrive as a single blinding pixel. */
  float flux = aSize * aSize * mix(1.0, (uRefDist * uRefDist) / (d * d), uAtten) * uGain;
  float px = sqrt(max(flux, 0.0));

  /* Below one pixel a star must FADE rather than shrink. A point smaller than
     the sample grid does not dim gracefully — it flickers as it crosses from
     one texel to the next, and a hundred thousand of them flickering is a
     snowstorm. So the size floors at a pixel and alpha carries the rest of the
     falloff, which also happens to conserve total flux: above a pixel the area
     grows as px*px at full alpha, below it the area is fixed and alpha is
     px*px. The light is right either way. */
  gl_PointSize = clamp(px, 1.0, 30.0) * uPixelRatio;
  float sub = min(1.0, px * px);

  /* No scintillation in space, and this is not pedantry — it is the difference
     between a sky and a Christmas tree. Twinkling is AIR: pockets of different
     density drifting across the line of sight and bending it. There is no air
     out here, so a star seen from a spacecraft is dead steady, and every render
     that twinkles them is quietly telling you it was made on the ground. Kept
     as a uniform only so the comet tails can still shimmer. */
  float wob = 1.0 - 0.35 * uTwinkle * (0.5 + 0.5 * sin(uTime * 1.7 + aPhase));

  vAlpha = sub * wob;
  // Only genuinely bright stars earn diffraction spikes downstream. Set this
  // gate low and the whole field turns to glitter — it has to be the handful
  // you would actually be able to name.
  vBright = smoothstep(9.0, 22.0, px);
}
`;

export const STARS_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vBright;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  // Soft airy-disc falloff plus a hot core, rather than a flat dot.
  float core = smoothstep(0.5, 0.0, r);
  float halo = pow(core, 3.5);

  /* Diffraction spikes — the telescope, not the star. A point source hitting
     the vanes that hold a secondary mirror comes out as a cross, and the effect
     is fixed in strength, so it only shows on sources bright enough to lift it
     above the noise. Gating on brightness is the whole trick: put a cross on
     every star and the field turns into glitter. */
  float cross = pow(max(0.0, 1.0 - abs(d.x) * 13.0), 3.0)
              + pow(max(0.0, 1.0 - abs(d.y) * 13.0), 3.0);
  cross *= core * vBright;

  gl_FragColor = vec4(
    vColor * (halo * 0.95 + core * 0.26 + cross * 0.55),
    vAlpha * max(core, cross * 0.5)
  );
}
`;

/* ------------------------------------------------------- galaxy / nebula */

/**
 * The unresolved component of the home galaxy.
 *
 * "How is the Milky Way visible when you are inside it" has an answer, and the
 * answer is: that is the ONLY place it is visible as a band. You are in a disk
 * roughly a thousand times wider than it is thick, two thirds of the way out
 * from the middle. Look along the plane and your sight line stays inside the
 * disk for a hundred thousand light years and crosses a colossal number of
 * stars; look perpendicular and you are out of it almost immediately. The band
 * is not a thing in the sky, it is the shape of the room you are standing in.
 *
 * So this shader is not free to invent a band. It is handed the SAME galactic
 * pole and centre direction as the star particles, and it draws only what those
 * particles cannot: the light of the stars too faint and too numerous to be
 * resolved as points at all. It is deliberately dim, because in this scene most
 * of the band's brightness is real geometry now.
 *
 * And it fades. `uFade` goes to zero as the camera leaves the disk, because
 * once you are outside your own galaxy there is no band — there is a galaxy,
 * behind you, and you can see it from out there as a galaxy.
 */
export const SKYDOME_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uBandColor;
uniform vec3 uCoreColor;
uniform vec3 uDust;
uniform vec3 uPole;
uniform vec3 uCoreDir;
uniform float uSeed;
uniform float uFade;
varying vec3 vPosL;

${NOISE}

void main() {
  vec3 n = normalize(vPosL);

  // The plane the star particles were built on. Passed in, never guessed —
  // a dome that disagrees with the geometry is worse than no dome at all.
  float d = abs(dot(n, normalize(uPole)));
  float band = pow(1.0 - smoothstep(0.0, 0.34, d), 1.9);

  /* The band is not uniform along its length. Two thirds of the galaxy's stars
     are on the far side of the centre from us, so the half of the sky facing
     the nucleus is markedly brighter and warmer — that is Sagittarius, and its
     absence is what makes most rendered skies read as a symmetric smear. */
  float toCore = max(dot(n, normalize(uCoreDir)), 0.0);
  float core = pow(toCore, 3.0);

  float clouds = fbm(n * 3.2 + uSeed, 5) * 0.5 + 0.5;
  float fine = ridged(n * 8.5 + uSeed * 2.0, 4);

  /* Dialled down hard. This layer used to BE the Milky Way and now it is only
     the part of it that cannot be resolved into stars — half a million points
     carry the band itself. Left at its old strength it sits over them as a
     smooth tan wash and takes back exactly the graininess that made the band
     look photographed. */
  vec3 col = mix(uBandColor, uCoreColor, core * 0.7)
           * band * (clouds * 0.8 + fine * 0.45) * (0.22 + core * 0.75);

  /* Dust. The Milky Way's most recognisable feature is not its light, it is the
     dark cutting across it — the Great Rift running from Cygnus to Sagittarius
     is a cloud in the way, not a gap in the stars. It has to SUBTRACT, and it
     has to be strongest toward the centre, where there is the most galaxy
     behind it to hide. */
  float lane = smoothstep(0.40, 0.74, ridged(n * 4.6 + vec3(11.0) + uSeed, 4));
  col *= 1.0 - lane * band * 0.88;
  col = max(col - uDust * lane * band * (0.3 + core * 0.5), vec3(0.0));

  // Faint all-sky floor so the void is never a dead flat black — real deep sky
  // has airglow-free but non-zero background from everything at once.
  vec3 floorGlow = vec3(0.009, 0.012, 0.024) * (0.6 + 0.4 * clouds);

  gl_FragColor = vec4(col * uFade + floorGlow * mix(0.35, 1.0, uFade), 1.0);
}
`;

/**
 * An emission nebula.
 *
 * Nebulae do not come in arbitrary colours. A cloud of hydrogen lit by hot
 * young stars inside it re-emits on specific atomic lines and essentially
 * nowhere else: hydrogen-alpha deep in the red at 656nm, doubly ionised oxygen
 * as a blue-green at 501nm, and that is most of what you get. Real ones are
 * crimson shading to teal in the hottest cores, which is why the purple-and-
 * magenta pass this replaces read as an album cover — those are the two hues
 * the physics cannot produce.
 *
 * The other half of it is that a nebula is mostly opaque. The dark lanes are
 * not gaps between the bright parts, they are cold dust in front of them, and
 * carving them OUT of the emission is what gives the cloud depth instead of
 * making it a glowing smudge.
 */
export const NEBULA_FRAG = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uSeed;
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;

${NOISE}

void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  if (r > 1.0) discard;

  /* Four octaves, not six. A nebula billboard can cover half the viewport, so
     every octave here is a full-screen cost — and at this softness the top
     octaves are invisible anyway. */
  vec3 q = vec3(p * 3.0, uSeed);
  float fil = ridged(q * 1.7 + vec3(0.0, 0.0, uTime * 0.008), 4);
  float body = fbm(q * 3.2 - vec3(0.0, 0.0, uTime * 0.011), 3) * 0.5 + 0.5;

  /* Ionisation falls off from the hot stars in the middle, so the core is
     oxygen-teal and the cool outer envelope is hydrogen-red. Mapping colour to
     DENSITY instead would tint the filaments at the rim the same as the core,
     and the whole thing would come out one flat hue. */
  float ionised = pow(max(0.0, 1.0 - r), 2.4) * (0.5 + body);
  vec3 col = mix(uColorA, uColorB, clamp(ionised * 1.5, 0.0, 1.0));

  float glow = pow(1.0 - r, 2.1) * (fil * 0.8 + body * 0.45);

  /* Dust in front. Subtracted, not blended — this is absorption. */
  float dust = smoothstep(0.46, 0.78, ridged(q * 2.9 + vec3(7.0, 3.0, uSeed), 3));
  glow *= 1.0 - dust * 0.72;

  gl_FragColor = vec4(col * glow * 2.4, clamp(glow * uOpacity, 0.0, 1.0));
}
`;

/* -------------------------------------------------------- accretion disk */

export const DISK_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uInner;
uniform vec3 uOuter;
uniform float uRin;
uniform float uRout;
uniform vec3 uViewLocal;
varying vec3 vPosL;

${NOISE}

void main() {
  /* RingGeometry is authored in the XY plane with z = 0 — the mesh is then
     rotated into place. Sampling xz here (as if it were already flat in the
     world) makes the radius come out as |x|, which discards everything near the
     vertical axis and leaves two side lobes instead of a disk. */
  float r = length(vPosL.xy);
  float t = (r - uRin) / max(uRout - uRin, 0.0001);
  if (t < 0.0 || t > 1.0) discard;

  float ang = atan(vPosL.y, vPosL.x);

  /* Differential rotation. The inner disk orbits far faster than the outer —
     Keplerian shear is what winds the gas into spirals, and it is the single
     thing that stops an accretion disk looking like a painted CD. */
  float shear = uTime * (0.9 / pow(max(r, 0.2), 1.5));
  vec3 q = vec3(cos(ang + shear), sin(ang + shear), 0.0) * (r * 0.7);

  float gas = fbm(q * 2.4, 5) * 0.5 + 0.5;
  float fil = ridged(q * 5.5, 4);
  float dens = gas * 0.7 + fil * 0.55;

  // Hotter and brighter toward the inside, by a steep falloff.
  float heat = pow(1.0 - t, 2.6);
  /* Hot, but not so hot that the bloom pass turns the whole disk into a white
     card. The inner edge should read as incandescent against an outer edge that
     still has colour in it. */
  vec3 col = mix(uOuter, uInner, heat) * (0.4 + dens * 0.85) * (0.22 + heat * 1.35);

  /* RELATIVISTIC BEAMING.
     Gas in the inner disk is going a good fraction of the speed of light, and
     light from something moving toward you is bunched forward: the side of the
     disk rotating toward the camera is several times brighter and measurably
     bluer, the receding side dimmer and redder. It is the single most
     recognisable thing about a real black hole image — the reason the Event
     Horizon Telescope's picture is a crescent and not a ring — and a disk
     rendered at uniform brightness all the way round reads as a painted CD
     no matter how good the turbulence on it is.
     Speed goes as r^-0.5, so the asymmetry is strongest at the inner edge. */
  vec3 tang = normalize(vec3(-vPosL.y, vPosL.x, 0.0));
  vec3 toEye = normalize(uViewLocal - vPosL);
  float beta = 0.62 * pow(1.0 - t, 0.5);
  float dop = 1.0 + beta * dot(tang, toEye);
  col *= pow(max(dop, 0.05), 3.2);
  // Approaching gas is blue-shifted, receding gas red-shifted.
  col *= mix(vec3(1.18, 1.02, 0.86), vec3(0.86, 0.97, 1.16), clamp((dop - 1.0) * 1.6 + 0.5, 0.0, 1.0));

  /* The outer edge fades over most of the disk's width. A ring mesh seen nearly
     edge-on shows its own rim as two straight lines meeting at a point, so a
     tight falloff there hands you a hard orange diamond — the geometry made
     visible. Gas thins out; it does not stop. */
  float edge = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.55, t);
  gl_FragColor = vec4(col, edge * (0.45 + dens * 0.55));
}
`;

/* --------------------------------------------------- gravitational lensing */

/**
 * Screen-space lensing around the black hole.
 *
 * The honest way to do this is to trace null geodesics per pixel, which is not
 * a real-time budget. This uses the weak-field deflection instead — light bends
 * by an angle proportional to 1/b, where b is the impact parameter — and applies
 * it as a UV pull toward the hole. That single term is what produces the
 * recognisable image: the star field smeared into rings, and the far side of the
 * accretion disk lifted up and over the shadow, because the disk is already in
 * the texture being warped.
 */
export const LENSING_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uHole;        // black hole centre, screen uv
uniform float uRadius;     // shadow radius in uv
uniform float uStrength;
uniform float uAspect;
uniform vec3 uRingColor;
uniform float uVisible;

varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  vec2 d = uv - uHole;
  d.x *= uAspect;
  float r = length(d);

  if (uVisible < 0.5 || r > uRadius * 14.0) {
    gl_FragColor = texture2D(tDiffuse, uv);
    return;
  }

  vec2 dir = r > 0.00001 ? d / r : vec2(0.0);

  /* Deflection goes as 1/b — the impact parameter — and the exponent is not a
     detail to be approximated away. The first pass used 1/b squared, which dies
     far too quickly with distance and is correspondingly violent close in: at
     the shadow's edge it displaced the image by more than a shadow radius, so
     the same patch of sky got sampled at three different radii at once and the
     hole came back as a set of concentric bullseye rings. A black hole bends
     light; it does not tile it. */
  float defl = uStrength * uRadius * uRadius / max(r, uRadius * 0.55);
  vec2 warped = uv - dir * defl * vec2(1.0 / uAspect, 1.0);

  vec4 col = texture2D(tDiffuse, warped);

  /* The shadow. Nothing inside it escapes, so it is not dark, it is BLACK —
     the only truly black thing in the frame, and the contrast against the ring
     immediately outside is most of the image. */
  float shadow = smoothstep(uRadius * 1.03, uRadius * 0.96, r);
  col.rgb *= 1.0 - shadow;

  /* The photon ring: light that went into orbit around the hole and came back
     out toward us. It is thin — a real one is a hair's width — and putting a
     soft wide band there instead is what makes a rendered black hole look like
     a doughnut. */
  float ring = exp(-pow((r - uRadius * 1.055) / (uRadius * 0.045), 2.0));
  col.rgb += uRingColor * ring * 1.6;

  gl_FragColor = col;
}
`;

/* ------------------------------------------------------------ film finish */

/** Grain, vignette, chromatic aberration and an anamorphic streak, in one pass. */
export const FILM_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
uniform float uAberration;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;

  /* Chromatic aberration scaled by distance from centre — a real lens is
     corrected on axis and falls apart at the edge, so a uniform split reads as
     a filter while this reads as glass. */
  float ab = uAberration * dot(c, c);
  vec3 col;
  col.r = texture2D(tDiffuse, uv + c * ab).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - c * ab).b;

  float vig = 1.0 - smoothstep(0.36, 0.96, length(c) * 1.32);
  col *= mix(1.0, vig, uVignette);

  // Grain sits on the mids: film has almost none in the blacks or the highlights.
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  float mids = 1.0 - abs(lum - 0.45) * 1.8;
  float g = hash12(uv * 900.0 + fract(uTime) * 431.0) - 0.5;
  col += g * uGrain * clamp(mids, 0.0, 1.0);

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ==================================================================== galaxy */

/**
 * A spiral galaxy, built entirely on the GPU.
 *
 * Every star is stored in POLAR coordinates and turned into a position in the
 * vertex shader, which is what makes the whole thing affordable: three hundred
 * thousand stars rotate differentially — the core sweeping round far faster
 * than the rim, exactly as a real galaxy does — without the CPU touching a
 * single vertex. Winding the arms on the CPU would mean rewriting a 3.6MB
 * buffer every frame.
 *
 * The arms are logarithmic spirals (theta grows with log r), because that is
 * the shape real arms take, and the scatter around each arm is scaled by radius
 * so the arms are tight in the middle and fray at the edge.
 */
export const GALAXY_VERT = /* glsl */ `
attribute float aRadius;
attribute float aTheta;
attribute float aZ;
attribute float aSize;
attribute vec3 aColor;
attribute float aSeed;

uniform float uTime;
uniform float uPixelRatio;
uniform float uSpin;

varying vec3 vColor;
varying float vAlpha;
varying float vCore;

void main() {
  /* Differential rotation. Orbital speed goes as r^-0.5, so the inner disk
     laps the outer one and the arms wind up over time. A rigid rotation — one
     angular speed for the whole disk — is the classic tell of a fake galaxy:
     it reads as a spinning image rather than as matter in orbit. */
  float w = uSpin / sqrt(max(aRadius, 0.06));
  float th = aTheta + uTime * w;

  vec3 p = vec3(cos(th) * aRadius, aZ, sin(th) * aRadius);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  /* Size attenuates with distance, but is floored: a star that shrinks below a
     pixel does not fade gracefully, it flickers as it crosses the sample grid,
     and three hundred thousand of them flickering is a snowstorm.
     Below that floor the falloff moves into ALPHA, and that correction is what
     turns this from confetti into a galaxy. Standing off far enough to hold the
     whole disk in frame, every one of these stars wants to be a hundredth of a
     pixel — clamp the size and stop there, as the first version did, and each
     one is instead a fully opaque dot, so the galaxy arrives as a few hundred
     thousand hard specks with black between them. Fading them lets them sum. */
  /* The constant sets the distance at which a star of unit size is one pixel,
     and it has to be scaled to the standoff the camera actually uses to frame a
     galaxy. At the old value the brightest star in the disk came out at a
     hundredth of a pixel from there, so once the sub-pixel fade below was
     added — correctly — every point went to zero and the resolved population
     disappeared, leaving only the smooth sheet. */
  float d = max(-mv.z, 0.001);
  float px = aSize * (22000.0 / d);
  gl_PointSize = clamp(px, 1.0, 22.0) * uPixelRatio;
  float sub = min(1.0, px * px);

  vColor = aColor;
  vCore = smoothstep(0.34, 0.03, aRadius);
  vAlpha = (0.42 + 0.58 * smoothstep(0.0, 0.25, aSize)) * sub;
}
`;

/**
 * The galaxy's unresolved light.
 *
 * Points alone cannot make a galaxy, and the arithmetic says why: standing back
 * far enough to frame a spiral, a few hundred thousand stars land at well under
 * one star per pixel. Real galaxies are a hundred BILLION stars — what you
 * actually see in a photograph is a continuous sheet of light with the few
 * brightest resolving out of it, so the sheet has to be drawn as a sheet.
 *
 * This is that sheet: an exponential disk with logarithmic arms wound by the
 * same differential rotation the particles use, so the smooth light and the
 * resolved stars stay locked together instead of shearing past each other.
 */
export const GALAXY_DISC_FRAG = /* glsl */ `
uniform vec3 uArm;
uniform vec3 uCore;
uniform vec3 uDust;
uniform float uArms;
uniform float uTight;
uniform float uRadius;
uniform float uR0;
uniform float uSpin;
uniform float uTime;
varying vec2 vUv;

${NOISE}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;

  float ang = atan(p.y, p.x);
  float rw = max(r * uRadius, 0.06);

  /* The SAME rotation law as the particles, in the particles' units. Getting
     this wrong is invisible on frame one and obvious after ten seconds: the
     smooth arms and the star arms drift apart and the galaxy comes to pieces. */
  float th = ang + uTime * (uSpin / sqrt(rw));

  // Logarithmic spiral, phased so an arm ridge lands where the stars were put.
  float lr = log(max(rw / uR0, 1.0001));
  float phase = uArms * (th - uTight * lr);
  float arm = pow(max(0.0, cos(phase)), 1.7);
  // Tight at the hub, frayed at the rim.
  arm = mix(arm, arm * 0.45 + 0.3, smoothstep(0.3, 1.0, r));

  float grain = fbm(vec3(p * 5.5, uTime * 0.006), 4) * 0.5 + 0.5;
  float fil = ridged(vec3(p * 11.0, 3.0), 3);

  float disk = exp(-r * 3.0);
  float core = exp(-r * 12.0);

  float dens = disk * (0.30 + arm * 0.95) * (0.5 + grain * 0.95) * (0.75 + fil * 0.5);

  /* Dust on the INNER edge of each arm — offset in phase, not centred on it.
     Gas piles up against the leading side of the density wave and the new stars
     light up just behind it, which is why the dark lanes in a real spiral run
     ALONGSIDE the bright arms rather than between them. Centre the dust on the
     arm and you get a galaxy with stripes; offset it and you get a galaxy. */
  float lane = smoothstep(0.3, 0.95, cos(phase + 0.85))
             * smoothstep(0.05, 0.28, r) * (0.45 + grain * 0.75);
  dens *= 1.0 - lane * 0.62;

  vec3 col = mix(uArm, uCore, clamp(core * 2.4 + smoothstep(0.45, 0.0, r) * 0.55, 0.0, 1.0));
  col = max(col - uDust * lane * 0.55, vec3(0.0));

  // Forced to nothing before the quad runs out, or the plane's own edge shows.
  float edge = smoothstep(1.0, 0.66, r);
  gl_FragColor = vec4(col * (dens * 1.25 + core * 1.7) * edge, 1.0);
}
`;

export const GALAXY_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vCore;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float f = 1.0 - r2 * 4.0;
  // Tight bright centre, wide faint skirt — the skirts of a few hundred
  // thousand stars are what fuse into a luminous disk rather than a dot screen.
  /* Deliberately dim per star.
     Additive blending SUMS, and in the arms thousands of these overlap — at any
     useful per-star brightness every channel clips to 1 and the galaxy turns
     into a white smear, taking the blue arms and pink HII knots with it. Colour
     in a dense additive field survives only if each contributor is faint enough
     that the sum lands below clipping. */
  float core = pow(f, 5.0);
  float halo = pow(f, 1.4);
  gl_FragColor = vec4(vColor * (core * 0.46 + halo * 0.11), (core * 0.62 + halo * 0.14) * vAlpha);
}
`;

/** The galactic bulge — old, dense, yellow-white, and far brighter than the disk. */
export const BULGE_FRAG = /* glsl */ `
uniform vec3 uInner;
uniform vec3 uOuter;
uniform float uTime;
varying vec2 vUv;

${NOISE}

void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  if (r > 1.0) discard;

  float core = pow(1.0 - r, 3.4);
  float glow = pow(1.0 - r, 1.15);

  // A little structure so the bulge is not a perfect airbrushed ball.
  float grain = fbm(vec3(p * 7.0, 3.0), 3) * 0.5 + 0.5;

  vec3 col = mix(uOuter, uInner, core) * (core * 1.15 + glow * 0.26) * (0.82 + grain * 0.36);
  gl_FragColor = vec4(col, clamp(core * 1.5 + glow * 0.34, 0.0, 1.0));
}
`;

/* ------------------------------------------------- chromosphere and corona */

/**
 * Everything ABOVE the photosphere, on one camera-facing billboard.
 *
 * The rule this shader exists to enforce: nothing is drawn inside the disc.
 *
 * The previous version of this file put a hot additive core at the centre of
 * this billboard, and that single decision is what wrecked the star. The limb
 * is the sharpest edge in astronomy and it is the entire reason a sun reads as
 * a SPHERE and not as a glow — and it was being painted over, every frame, by a
 * soft radial gradient. No amount of work on the surface shader could survive
 * it. So here `uDisc` is the photosphere's radius in billboard space and the
 * first thing that happens is a hard cut: outside only, always.
 *
 * What is left is the three things you actually see around a star at totality,
 * stacked by height: a scarlet chromosphere a fraction of a percent deep,
 * prominences arcing off the limb, and the pearl-white corona streaming out
 * asymmetrically along the magnetic field.
 */
export const CORONA_FRAG = /* glsl */ `
uniform vec3 uCorona;
uniform vec3 uChromo;
uniform float uTime;
uniform float uSeed;
uniform float uDisc;
varying vec2 vUv;

${NOISE}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;

  // The hole. Everything below is gated on it, and it is a hard edge because
  // the photosphere's edge is a hard edge.
  float outside = smoothstep(uDisc * 0.998, uDisc * 1.012, r);
  if (outside <= 0.001) discard;

  float ang = atan(p.y, p.x);
  // Height above the limb, normalised — 0 at the surface, 1 at the billboard rim.
  float h = (r - uDisc) / max(1.0 - uDisc, 1e-4);

  /* CHROMOSPHERE. The thin scarlet shell you see for two seconds at the start
     of totality, before the corona takes over. It is hydrogen alpha, so it is a
     very specific red, and it is textured by spicules — jets of gas standing up
     off the surface, packed like grass, each one lasting a few minutes. */
  float spic = ridged(vec3(cos(ang) * 14.0, sin(ang) * 14.0, uTime * 0.14 + uSeed), 3);
  /* Nearly smooth, broken up a little, and faint. A spicule is a few hundred
     kilometres across on a body seven hundred thousand wide, so at any distance
     you would actually view a star from they are far below a pixel and the rim
     is a LINE. Modulated hard enough to see, as this was, they come back as a
     ring of short red spines and the star grows a sea urchin. */
  float patchy = 0.35 + 0.65 * (fbm(vec3(cos(ang) * 4.0, sin(ang) * 4.0, uSeed * 3.0), 3) * 0.5 + 0.5);
  float chromo = exp(-h * 170.0) * (0.72 + 0.38 * spic) * patchy * 0.5;

  /* PROMINENCES. Loops of cool dense gas held up out of the surface by magnetic
     field, reaching a good fraction of a stellar radius. Deliberately sparse
     and seeded to a few angles — a star carries a handful at a time, and a
     continuous fringe all the way round reads as a rendering artefact. */
  float loopA = pow(abs(sin(ang * 1.5 + uSeed * 2.1)), 30.0);
  float loopB = pow(abs(sin(ang * 2.5 - uSeed * 1.3)), 46.0);
  float promTex = fbm(vec3(cos(ang) * 10.0, sin(ang) * 10.0, uTime * 0.04 + uSeed), 3) * 0.5 + 0.5;
  float prom = exp(-h * 24.0) * (loopA * 0.85 + loopB * 0.45) * (0.30 + promTex);

  /* CORONA. Not a halo. The field organises it into helmet streamers standing
     over the active belts and open plumes at the poles, so its outline is
     ragged, asymmetric, and different on every star. A radially symmetric glow
     is the single most obvious tell of a fake one. */
  /* Few and broad. Angular noise at high frequency gives a spoke per cycle, so
     a "detailed" corona is a starburst — at thirteen cycles this came back as
     twenty hard rays reaching the frame edge. The sun carries two or three
     helmet streamers at a time and they are wide. */
  float streamer = pow(fbm(vec3(cos(ang) * 1.5, sin(ang) * 1.5, uSeed), 3) * 0.5 + 0.5, 3.0);
  float fine = ridged(vec3(cos(ang) * 2.6, sin(ang) * 2.6, uSeed * 2.0), 2);
  /* Falls off as roughly the inverse cube of radius, which is close to what the
     real K-corona does. An exponential dies too fast and leaves the star inside
     a hard-edged donut; a linear ramp never dies at all and fogs the frame. */
  float fall = pow(uDisc / max(r, uDisc), 2.7);
  float corona = fall * (0.10 + streamer * 0.34 + fine * 0.10);

  /* The lens, not the star. Real glass pointed at something this much brighter
     than the rest of the frame throws fine spikes off the aperture blades.
     Deliberately almost subliminal: at any strength you actually notice, this
     stops being a lens artefact and becomes a sunburst graphic pasted over the
     scene — which is what the previous pass was, and it buried every planet. */
  /* Four spikes, not sixteen. sin(4a) has eight peaks and two of those terms
     gave sixteen — which is not a lens artefact, it is a compass rose, and once
     the bloom got hold of the thin bright lines it was the loudest thing in the
     frame. Two blades crossing make four. */
  float blades = pow(abs(sin(ang * 2.0 + 0.6)), 190.0);
  float spikes = blades * pow(uDisc / max(r, uDisc), 1.5) * 0.045;

  /* Forced to nothing before the billboard runs out.
     Any residual value at r = 1 becomes a hard-edged disc of flat grey the size
     of the quad, sitting over the sky — the discard boundary made visible. It
     is the most conspicuous failure this shader can have, because the eye finds
     a perfect circle instantly, and no falloff curve reaches exactly zero on
     its own. So the whole thing is multiplied out by hand. */
  float cut = smoothstep(1.0, 0.55, r);

  vec3 col = uCorona * (corona + spikes)
           + uChromo * (chromo * 1.7 + prom * 1.25);

  gl_FragColor = vec4(col * outside * cut, 1.0);
}
`;
