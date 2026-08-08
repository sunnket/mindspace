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

  // A trace of ambient so the dark limb is not pure black against the stars.
  col += albedo * 0.018;

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

export const SUN_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uSeed;

varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vPosL;

${NOISE}

void main() {
  vec3 n = normalize(vPosL);

  // Granulation — convection cells, boiling slowly.
  float g = fbm(n * 8.0 + vec3(0.0, uTime * 0.035, 0.0) + uSeed, 5) * 0.5 + 0.5;
  float fine = ridged(n * 22.0 - vec3(uTime * 0.02), 3);
  float heat = g * 0.72 + fine * 0.34;

  vec3 col = mix(uCool, uHot, smoothstep(0.28, 0.86, heat));

  // Limb darkening, which every star has and which sells the sphere.
  vec3 V = normalize(cameraPosition - vPosW);
  float limb = pow(max(dot(normalize(vNormalW), V), 0.0), 0.42);
  /* Strong limb darkening and a modest gain. A star IS overexposed up close —
     that is honest — but it still has to show its granulation rather than
     clipping to a flat white card the moment you approach. */
  col *= 0.34 + 0.78 * limb;

  gl_FragColor = vec4(col * 0.92, 1.0);
}
`;

/** Additive corona shell around the star. */
export const CORONA_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vPosL;

${NOISE}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  float lick = fbm(normalize(vPosL) * 5.0 + vec3(uTime * 0.08), 4) * 0.5 + 0.5;
  gl_FragColor = vec4(uColor * rim * (0.55 + lick * 0.9) * 0.62, 1.0);
}
`;

/* ------------------------------------------------------------- star field */

export const STARS_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
uniform float uTime;
uniform float uPixelRatio;
uniform float uTwinkle;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = aColor;
  /* Scintillation, weighted to the faint end — a bright star barely wavers.
     Same rule the 2D sky uses, and for the same reason: twinkling everything
     equally reads as tinsel. */
  float faint = 1.0 - clamp(aSize / 3.2, 0.0, 1.0);
  vAlpha = 1.0 - faint * 0.4 * uTwinkle * (0.5 + 0.5 * sin(uTime * (0.7 + faint * 2.2) + aPhase));

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio;
}
`;

export const STARS_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  // Soft airy-disc falloff plus a hot core, rather than a flat dot.
  float core = smoothstep(0.5, 0.0, r);
  float halo = pow(core, 3.5);
  gl_FragColor = vec4(vColor * (halo * 0.95 + core * 0.28), vAlpha * core);
}
`;

/* ------------------------------------------------------- galaxy / nebula */

/** Inside-out sky sphere: the Milky Way, dust lanes, and background glow. */
export const SKYDOME_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uBandColor;
uniform vec3 uDust;
uniform float uSeed;
varying vec3 vPosL;

${NOISE}

void main() {
  vec3 n = normalize(vPosL);

  // Galactic plane, tilted so the band crosses the view diagonally.
  vec3 pole = normalize(vec3(0.36, 0.86, 0.36));
  float d = abs(dot(n, pole));

  float band = 1.0 - smoothstep(0.0, 0.42, d);
  band = pow(band, 1.7);

  // Clumpy star cloud structure along the band.
  float clouds = fbm(n * 3.4 + uSeed, 6) * 0.5 + 0.5;
  float fine = ridged(n * 9.0 + uSeed * 2.0, 5);

  vec3 col = uBandColor * band * (clouds * 0.85 + fine * 0.5) * 1.15;

  /* Dark nebulae. The Milky Way's most recognisable feature is not its light,
     it is the dust cutting across it — subtracting is what makes it read as
     our own galaxy seen edge-on rather than as a bright smear. */
  float lane = smoothstep(0.42, 0.72, ridged(n * 5.2 + vec3(11.0), 4));
  col *= 1.0 - lane * band * 0.85;
  col = max(col - uDust * lane * band * 0.35, vec3(0.0));

  // Faint all-sky glow so the void is never a dead flat black.
  col += vec3(0.012, 0.016, 0.032) * (0.6 + 0.4 * clouds);

  gl_FragColor = vec4(col, 1.0);
}
`;

/** Billboarded volumetric-looking nebula cloud. */
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
  float f = ridged(q * 1.8 + vec3(0.0, 0.0, uTime * 0.01), 4);
  float g = fbm(q * 3.4 - vec3(0.0, 0.0, uTime * 0.014), 3) * 0.5 + 0.5;

  float body = pow(1.0 - r, 2.2) * (f * 0.75 + g * 0.5);
  vec3 col = mix(uColorA, uColorB, clamp(g * 1.3, 0.0, 1.0));

  gl_FragColor = vec4(col * body * 2.2, clamp(body * uOpacity, 0.0, 1.0));
}
`;

/* -------------------------------------------------------- accretion disk */

export const DISK_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uInner;
uniform vec3 uOuter;
uniform float uRin;
uniform float uRout;
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

  float edge = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.82, t);
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

  // Deflection ~ 1/b, softened near the centre so it stays finite.
  float defl = uStrength * uRadius * uRadius / max(r * r, uRadius * uRadius * 0.06);
  vec2 warped = uv - dir * defl * vec2(1.0 / uAspect, 1.0);

  vec4 col = texture2D(tDiffuse, warped);

  /* The photon sphere. Inside it nothing escapes, so it is genuinely black —
     and the thin ring at its edge is light that orbited the hole before
     reaching us, which is why it is the brightest thing in the frame. */
  float shadow = smoothstep(uRadius * 1.02, uRadius * 0.94, r);
  col.rgb *= 1.0 - shadow;

  float ring = smoothstep(uRadius * 1.28, uRadius * 1.06, r) * smoothstep(uRadius * 0.99, uRadius * 1.07, r);
  col.rgb += uRingColor * ring * 2.6;

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
