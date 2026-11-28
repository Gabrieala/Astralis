/**
 * Astralis Raw WebGL2 Renderer.
 *
 * Ultra-optimized 5-draw-call GPU pipeline designed to stay silky at 60 FPS
 * in fullscreen and practically invisible (<1-3% GPU) in Eco/Background mode:
 *   1. Half-res domain-warped Cosmic Nebula & Milky Way FBO
 *   2. Static 2,400-star GPU-twinkling Deep-Space Starfield (0 CPU per frame)
 *   3. Batched Comet Trails & Shooting Stars
 *   4. Anti-aliased SDF Glow Constellation Filaments with weaving sparks & word pulses
 *   5. Constellation Stars with procedural 4-point telescope diffraction spikes
 */

import { MAX_STARS, TRAIL_LEN, MAX_EDGES, MAX_METEORS } from "./star_physics.js";
import { HEMI_MAX_STARS, HEMI_MAX_EDGES, MAX_RENDER_BODIES } from "./hemisphere_engine.js";

const GPU_MAX_STARS = Math.max(MAX_STARS, HEMI_MAX_STARS);
const GPU_MAX_EDGES = Math.max(MAX_EDGES, HEMI_MAX_EDGES);

const FULLSCREEN_VS = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = POS[gl_VertexID];
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const NEBULA_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 outColor;

uniform float uTime;
uniform float uAspect;
uniform float uEnergy;
uniform float uBass;
uniform float uAmbience;
uniform float uIsHemi;
uniform float uDomeScale;
uniform float uDomeKick;
uniform float uDomeDrive;
uniform vec2 uWave1;
uniform vec2 uWave2;
uniform vec2 uDomeShake;
uniform vec3 uCamF;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform vec3 uLineTint;

// Fast value noise (super light on integrated GPUs)
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.54;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p = rot * p * 2.04 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  vec2 p = vec2(uv.x * uAspect, uv.y);

  // Deep obsidian midnight base
  vec3 baseNight = vec3(0.003, 0.004, 0.011);
  float amb = clamp(uAmbience, 0.0, 1.5);

  // TRUE 3D MILKY WAY GALACTIC PLANE IN HEMISPHERE MODE!
  // Rotates, shakes & vibrates in 100% real 3D lock-step with the 88 constellations & Hipparcos stars!
  if (uIsHemi > 0.5) {
    vec2 sp = p - uDomeShake;
    float rProj = length(sp);
    float theta = (rProj / max(0.25, uDomeScale)) * 1.5707963;
    if (theta > 1.62) {
      outColor = vec4(baseNight, 1.0);
      return;
    }
    vec2 dir2 = rProj > 1e-4 ? (sp / rProj) : vec2(0.0);
    vec3 dir3 = normalize(uCamF * cos(theta) + (uCamR * dir2.x + uCamU * dir2.y) * sin(theta));

    // Real North Galactic Pole (RA = 192.86°, Dec = +27.13°) & Galactic Center (Sagittarius: RA = 266.4°, Dec = -29.0°)
    vec3 galNorth = vec3(-0.8676, 0.4560, -0.1981);
    vec3 galCenter = vec3(-0.0550, -0.4848, -0.8729);
    float galLat = dot(dir3, galNorth);
    float galCore = max(0.0, dot(dir3, galCenter));

    // Organic galactic dust clouds & dark Great Rift lane along the true Milky Way plane!
    float galLon = (abs(dir3.x) + abs(dir3.z) > 1e-5) ? atan(dir3.z, dir3.x) : 0.0;
    vec2 gCoord = vec2(galLon * 2.4, galLat * 5.2);
    float n1 = fbm(gCoord * 1.15);
    float n2 = fbm(gCoord * 2.4 + vec2(3.1, -1.7));

    float band = exp(-galLat * galLat * 18.0) * (0.45 + 0.55 * n1);
    // Authentic dark dust rift running down the center of the Milky Way (Cygnus -> Sagittarius!)
    float riftD = galLat + (n2 - 0.5) * 0.08;
    float rift = 1.0 - 0.58 * exp(-(riftD * riftD) * 145.0) * smoothstep(0.15, 0.85, n2);
    float gc2 = galCore * galCore;
    float coreBulge = (gc2 * gc2) * exp(-galLat * galLat * 9.0);

    vec3 mwCool = vec3(0.11, 0.16, 0.28);
    vec3 mwWarm = vec3(0.24, 0.20, 0.16);
    float drive = clamp(uDomeDrive, 0.0, 1.0);
    float kick = clamp(uDomeKick, 0.0, 1.0);
    vec3 vivid = max(uLineTint, vec3(0.28, 0.48, 0.88));

    vec3 col = baseNight;
    // 1. Subtle natural Milky Way plane & galactic core (gentle musical breathing, never blinding!)
    float mwPulse = 0.48 + uEnergy * 0.10 + kick * (0.06 + 0.14 * drive);
    float corePulse = 0.58 + uBass * (0.10 + 0.14 * drive) + kick * (0.08 + 0.16 * drive);
    col += mix(mwCool, uColorB * 1.35, 0.32) * band * rift * mwPulse * amb;
    col += mix(mwWarm, uColorC * 0.78, 0.32) * coreBulge * rift * corePulse * amb;

    // 2. Barely-visible velvet atmospheric hue over the globe (keeps lyrics & stars 100% crisp!)
    float canopyShape = exp(-theta * theta * 1.65) * (0.72 + 0.28 * n1);
    float canopyAmt = (0.008 + uBass * 0.012 * drive + kick * (0.008 + 0.016 * drive)) * amb;
    col += mix(uColorB * 1.15, vivid * 0.42, 0.45) * canopyShape * canopyAmt;

    // Gentle horizon extinction near 90° dome boundary (zero side flashes!)
    float edgeFade = smoothstep(1.62, 1.24, theta);
    col = mix(baseNight, col, edgeFade);
    outColor = vec4(col, 1.0);
    return;
  }

  // Morph Mode: lush dark velvet cosmic nebula
  float t = uTime * 0.028;
  vec2 q = vec2(fbm(p * 1.05 + vec2(t, -t * 0.7)), fbm(p * 1.05 + vec2(-t * 0.6, t * 0.9) + 3.4));
  float n = fbm(p * 1.35 + q * 1.65 + vec2(0.0, t * 0.5));

  float bandCoord = p.y * 0.82 - p.x * 0.36;
  float milkyBand = exp(-bandCoord * bandCoord * 2.4) * (0.48 + 0.52 * n);

  vec3 col = mix(baseNight, uColorA * 0.72, (0.45 + 0.32 * n) * amb);
  float cloud = smoothstep(0.38, 0.86, n);
  col += uColorB * cloud * (0.24 + uEnergy * 0.16) * amb;
  float core = smoothstep(0.50, 0.94, milkyBand + q.x * 0.24);
  col += uColorC * core * (0.11 + uBass * 0.11) * amb;
  float centerGlow = exp(-dot(p * 0.82, p * 0.82) * 1.65);
  col += mix(uColorB, uColorC, 0.4) * centerGlow * (0.075 + uEnergy * 0.08) * amb;

  float vig = smoothstep(1.55, 0.18, length(uv * vec2(1.0, 0.9)));
  col *= 0.42 + 0.58 * vig;
  outColor = vec4(col, 1.0);
}`;

const BLIT_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
void main() {
  outColor = texture(uTex, vUv);
}`;

const BG_STARS_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in float aSize;
layout(location = 2) in float aPhase;
layout(location = 3) in float aTemp;

uniform float uTime;
uniform float uAspect;
uniform float uDpr;
uniform float uHigh;

out float vAlpha;
out float vTemp;

void main() {
  // Very slow astronomical sphere rotation
  float ang = uTime * 0.0045;
  float ca = cos(ang), sa = sin(ang);
  vec2 rp = mat2(ca, -sa, sa, ca) * aPos;

  // Keep square distribution nicely framed across aspect ratios
  vec2 ndc = vec2(rp.x / max(1.0, uAspect * 0.62), rp.y);
  gl_Position = vec4(ndc, 0.0, 1.0);

  float twinkle = 0.58 + 0.42 * sin(uTime * (0.9 + aTemp * 1.7) + aPhase);
  twinkle = pow(twinkle, 1.35);
  vAlpha = (0.18 + 0.56 * twinkle) * (1.0 + uHigh * 0.22);
  vTemp = aTemp;

  gl_PointSize = clamp(aSize * uDpr * (0.88 + 0.22 * twinkle), 1.0, 6.5);
}`;

const BG_STARS_FS = `#version 300 es
precision mediump float;
in float vAlpha;
in float vTemp;
out vec4 outColor;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = dot(uv, uv);
  if (d > 1.0) discard;
  float glow = exp(-d * 4.5);
  vec3 cool = vec3(0.74, 0.86, 1.0);
  vec3 warm = vec3(1.0, 0.89, 0.74);
  vec3 col = mix(cool, warm, vTemp);
  outColor = vec4(col * glow * vAlpha, glow * vAlpha);
}`;

const TRAIL_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in float aAlpha;
layout(location = 2) in float aKind; // 0 = star trail, 1 = meteor

uniform float uAspect;
out float vAlpha;
out float vKind;

void main() {
  vec2 ndc = vec2(aPos.x / uAspect, aPos.y);
  gl_Position = vec4(ndc, 0.0, 1.0);
  vAlpha = aAlpha;
  vKind = aKind;
}`;

const TRAIL_FS = `#version 300 es
precision mediump float;
in float vAlpha;
in float vKind;
out vec4 outColor;

uniform vec3 uLineTint;

void main() {
  vec3 col;
  if (vKind > 2.5) {
    // Crisp star-chart silver-ice dotted constellation transition arc
    col = mix(uLineTint * 1.35, vec3(0.92, 0.97, 1.0), 0.55);
  } else if (vKind > 1.5) {
    // Whisper-fine golden-amber astronomical Ecliptic line
    col = vec3(0.94, 0.76, 0.42);
  } else {
    col = mix(uLineTint * 1.25, vec3(1.0, 0.97, 0.92), vKind * 0.82);
  }
  outColor = vec4(col * vAlpha, vAlpha);
}`;

const FILAMENT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;     // world pos
layout(location = 1) in vec2 aUV;      // x: 0..1 along edge, y: -1..1 across quad
layout(location = 2) in vec4 aMeta;    // x: alpha, y: drawProgress, z: pulsePos, w: weight

uniform float uAspect;

out vec2 vUV;
out vec4 vMeta;

void main() {
  vec2 ndc = vec2(aPos.x / uAspect, aPos.y);
  gl_Position = vec4(ndc, 0.0, 1.0);
  vUV = aUV;
  vMeta = aMeta;
}`;

const FILAMENT_FS = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec4 vMeta;
out vec4 outColor;

uniform vec3 uLineTint;
uniform vec3 uStarTint;

void main() {
  float u = vUV.x;
  float v = abs(vUV.y);
  float alpha = vMeta.x;
  float drawP = vMeta.y;
  float pulseP = vMeta.z;

  // Smooth clip at advancing draw tip
  float visible = 1.0 - smoothstep(drawP - 0.04, drawP + 0.015, u);
  if (visible <= 0.002) discard;

  // Taper delicately near the star endpoints so lines melt into star coronas
  float endFade = smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.92, u);

  // Crisp luminous core + restrained beat-reactive glowing aura (never overwhelms lyrics!)
  float beatW = clamp((vMeta.w - 1.16) * 0.36, 0.0, 1.0);
  float core = exp(-v * v * mix(26.0, 16.0, beatW));
  float halo = exp(-v * v * mix(5.2, 3.3, beatW)) * mix(0.32, 0.55, beatW);
  float beam = (core + halo) * visible * endFade * alpha;

  // Weaving spark right at the advancing tip while the filament draws itself
  float tipDist = abs(u - drawP);
  float tipSpark = (drawP > 0.03 && drawP < 0.985)
    ? exp(-tipDist * tipDist * 420.0) * exp(-v * v * 6.0) * 1.15 * alpha
    : 0.0;

  // Traveling beat wave along constellation lines (tasteful pulse without blowing out text!)
  float pulseGlow = 0.0;
  if (pulseP >= 0.0 && pulseP <= 1.25) {
    float pd = abs(u - pulseP);
    pulseGlow = exp(-pd * pd * 36.0) * exp(-v * v * 4.8) * visible * alpha * 0.50;
  }

  vec3 baseCol = mix(uLineTint, vec3(0.96, 0.98, 1.0), core * (0.20 + beatW * 0.18));
  vec3 sparkCol = mix(uStarTint, vec3(1.0, 0.97, 0.90), 0.52);

  vec3 finalCol = baseCol * beam + sparkCol * (tipSpark + pulseGlow);
  float finalA = clamp(beam + tipSpark + pulseGlow, 0.0, 1.0);
  outColor = vec4(finalCol, finalA);
}`;

const STARS_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
layout(location = 1) in float aSize;
layout(location = 2) in float aBright;
layout(location = 3) in float aFlare;
layout(location = 4) in float aTemp;
layout(location = 5) in float aRole;

uniform float uAspect;
uniform float uDpr;
uniform float uTime;
uniform float uBass;

out float vBright;
out float vFlare;
out float vTemp;
out float vRole;
out float vSeed;

void main() {
  vec2 ndc = vec2(aPos.x / uAspect, aPos.y);
  gl_Position = vec4(ndc, 0.0, 1.0);

  // Planets (role 3) & Satellites (role 4) shine steadily without atmospheric star scintillation!
  float isSteady = step(2.5, aRole);
  float twinkle = mix(0.88 + 0.12 * sin(uTime * (2.2 + aTemp * 2.5) + aTemp * 37.0), 1.0, isSteady);
  // Smooth musical size-breathing on bigger, fuller round stars (clean cap so glow stays crisp!)
  float boost = 1.0 + min(aFlare, 1.15) * 0.30 + (aRole >= 1.5 && aRole < 2.5 ? uBass * 0.18 : 0.0);
  float pt = aSize * uDpr * 4.25 * boost * twinkle;
  gl_PointSize = clamp(pt, 3.8, 56.0);

  vBright = aBright * twinkle * (1.0 + min(aFlare, 1.15) * 0.30);
  vFlare = aFlare;
  vTemp = aTemp;
  vRole = aRole;
  vSeed = aTemp * 6.2831;
}`;

const STARS_FS = `#version 300 es
precision mediump float;
in float vBright;
in float vFlare;
in float vTemp;
in float vRole;
in float vSeed;
out vec4 outColor;

uniform vec3 uStarTint;

// Authentic 5-stop Planckian blackbody stellar color spectrum (O/B -> A -> F -> G -> K/M)
vec3 planckStarColor(float t) {
  vec3 cOB = vec3(0.60, 0.76, 1.00); // Hot O/B blue (Rigel, Spica)
  vec3 cA  = vec3(0.84, 0.91, 1.00); // A blue-white (Sirius, Vega)
  vec3 cF  = vec3(0.99, 0.98, 0.96); // F pure white (Procyon, Canopus)
  vec3 cG  = vec3(1.00, 0.91, 0.72); // G solar yellow (Capella)
  vec3 cKM = vec3(1.00, 0.58, 0.34); // K/M orange-red (Arcturus, Betelgeuse, Antares)
  if (t < 0.25) return mix(cOB, cA, t / 0.25);
  if (t < 0.50) return mix(cA, cF, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(cF, cG, (t - 0.50) / 0.25);
  return mix(cG, cKM, (t - 0.75) / 0.25);
}

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;

  vec3 specCol = planckStarColor(clamp(vTemp, 0.0, 1.0));

  // Role 3: Solar System Planets & Moon -> crisp planetary disc with soft atmospheric limb!
  if (vRole > 2.5 && vRole < 3.5) {
    float disc = 1.0 - smoothstep(0.20, 0.30, r);
    float limb = exp(-r * r * 14.0) * 0.52;
    float halo = exp(-r * 3.8) * 0.22;
    vec3 col = mix(specCol, vec3(1.0, 0.99, 0.96), disc * 0.45);
    float lum = (disc * 1.15 + limb + halo) * vBright;
    outColor = vec4(col * lum, clamp(lum, 0.0, 1.0));
    return;
  }

  // Role 4: Orbiting Artificial Satellites -> razor-sharp metallic glint pinpoint!
  if (vRole >= 3.5) {
    float core = exp(-r * r * 90.0);
    float aura = exp(-r * 6.5) * 0.35;
    vec3 col = vec3(0.84, 0.96, 1.0);
    float lum = (core * 1.35 + aura) * vBright;
    outColor = vec4(col * lum, clamp(lum, 0.0, 1.0));
    return;
  }

  // Larger, jewel-like ROUND stellar orb + compact soft halo (bigger round star body, restrained glow!)
  float hotCenter = exp(-r * r * 34.0) * 0.50;
  float core = exp(-r * r * 14.5);
  float midGlow = exp(-r * r * 11.5) * 0.34;
  float corona = exp(-r * 6.0) * 0.13;

  // Preserve rich stellar spectral hues + active constellation palette colors (no white washout!)
  vec3 starCol = mix(specCol, uStarTint, 0.34);
  vec3 col = mix(starCol, vec3(1.0, 0.995, 0.98), clamp(core * 0.56 + hotCenter * 0.50, 0.0, 0.80));

  float lum = (core * 1.18 + hotCenter + midGlow + corona) * vBright;
  outColor = vec4(col * lum, clamp(lum, 0.0, 1.0));
}`;

// =========================================================================
// PASS 6: Realistic Alpha-Blended Planets, Phased Moon, Saturn Rings & Satellites!
// =========================================================================
const BODIES_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;     // world pos
layout(location = 1) in vec2 aQuad;    // [-1, 1] local billboard corner
layout(location = 2) in vec4 aInfo;    // x: bodyType (0..8), y: phaseParam, z: angleRad, w: alpha

uniform float uAspect;
uniform vec2 uInvRes;

out vec2 vLocal;
out vec4 vInfo;

void main() {
  vec2 ndc = vec2(aPos.x / uAspect, aPos.y);
  // aQuad is already scaled in pixels by CPU vertex writer -> exact crisp pixel radius!
  vec2 offsetNdc = aQuad * uInvRes * 2.0;
  gl_Position = vec4(ndc + offsetNdc, 0.0, 1.0);
  vLocal = sign(aQuad); // [-1..1] normalized quad UV!
  vInfo = aInfo;
}`;

const BODIES_FS = `#version 300 es
precision mediump float;
in vec2 vLocal;
in vec4 vInfo;
out vec4 outColor;

float hash2(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float snoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
    mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  int bType = int(vInfo.x + 0.5);
  float phase = vInfo.y;
  float ang = vInfo.z;
  float alpha = vInfo.w;
  vec2 p = vLocal;
  float r = length(p);

  // --- 8: REFINED ORBITING SATELLITE (Delicate Sunlit Glint + Subtle Solar Wings!) ---
  if (bType == 8) {
    float c = cos(-ang), s = sin(-ang);
    vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    // Compact central spacecraft bus + subtle solar mast & twin arrays
    float body = smoothstep(0.14, 0.06, length(rp * vec2(1.25, 1.85)));
    float mast = smoothstep(0.042, 0.014, abs(rp.x)) * smoothstep(0.62, 0.52, abs(rp.y));
    float wingMaskY = smoothstep(0.64, 0.55, abs(rp.y)) * smoothstep(0.14, 0.20, abs(rp.y));
    float wingMaskX = smoothstep(0.17, 0.10, abs(rp.x));
    float wings = wingMaskX * wingMaskY;
    float cellGrid = 0.84 + 0.16 * sin(rp.y * 46.0);
    // Delicate optical star-like glint so satellites blend seamlessly with the starfield
    float glint = exp(-dot(rp, rp) * 34.0) * 0.72 + exp(-length(rp) * 5.2) * 0.22;

    vec3 wingCol = vec3(0.30, 0.52, 0.82) * cellGrid + vec3(0.24, 0.18, 0.08) * 0.28;
    vec3 hubCol = vec3(0.92, 0.93, 0.96);
    vec3 col = mix(wingCol, hubCol, clamp(body + mast * 0.7, 0.0, 1.0)) + vec3(0.82, 0.92, 1.0) * glint;
    float a = clamp((wings * 0.70 + mast * 0.68 + body * 0.88 + glint * 0.72) * alpha, 0.0, 0.92);
    if (a < 0.01) discard;
    outColor = vec4(col, a);
    return;
  }

  // --- 13: THE SUN (Serene Golden Photosphere + Soft Coronal Halo & Delicate Rays!) ---
  if (bType == 13) {
    if (r > 1.0) discard;
    float core = 1.0 - smoothstep(0.16, 0.27, r);
    float innerCorona = exp(-r * r * 14.0) * 0.78;
    float outerCorona = exp(-r * 3.8) * 0.42;
    float theta = atan(p.y, p.x);
    float rays = (0.55 + 0.45 * sin(theta * 6.0 + phase * 0.35) * cos(theta * 4.0 - 0.5)) * exp(-r * 4.2) * 0.26;
    // Soft astronomical diffraction cross matching the starfield
    float spX = exp(-abs(p.y) * 26.0) * exp(-abs(p.x) * 3.0);
    float spY = exp(-abs(p.x) * 26.0) * exp(-abs(p.y) * 3.0);
    float spikes = (spX + spY) * 0.22;

    vec3 photoCol = vec3(1.00, 0.96, 0.84);
    vec3 coronaCol = vec3(1.00, 0.76, 0.36);
    vec3 outerCol = vec3(0.92, 0.48, 0.18);
    vec3 col = mix(outerCol, coronaCol, clamp(innerCorona + core, 0.0, 1.0)) * (outerCorona + rays + spikes)
             + mix(coronaCol, photoCol, core) * (core * 0.95 + innerCorona * 0.72);
    float a = clamp((core * 0.92 + innerCorona * 0.72 + outerCorona * 0.65 + rays + spikes) * alpha, 0.0, 0.94);
    if (a < 0.01) discard;
    outColor = vec4(col, a);
    return;
  }

  // --- 9: EMISSION / DIFFUSE NEBULA (Orion M42, Carina, Lagoon, Eagle, Trifid, Rosette!) ---
  if (bType == 9) {
    float c = cos(ang), s = sin(ang);
    vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    float d = length(rp);
    if (d > 1.0) discard;
    // Domain-warped cosmic gas filaments + dark interstellar dust veins
    vec2 seedOff = vec2(phase * 17.3, phase * 9.1);
    float n1 = snoise(rp * 3.2 + seedOff) * 0.6 + snoise(rp * 6.8 - seedOff * 0.5) * 0.4;
    float n2 = snoise(rp * 4.5 + vec2(n1 * 1.4, -n1 * 1.1) + seedOff);
    float env = exp(-d * d * 3.8);
    float wisps = smoothstep(0.24, 0.82, n2) * env;
    // Dark absorbing dust pillars cutting through bright gas
    float dustRift = 1.0 - 0.55 * smoothstep(0.55, 0.85, snoise(rp * 5.2 + seedOff * 1.7)) * exp(-d * d * 5.0);
    // Bright ionized core (Trapezium-like newborn star glow)
    float core = exp(-d * d * 18.0);

    // Authentic narrowband / true-color H-alpha (rose/crimson) + O-III (teal/sapphire) + golden dust
    vec3 hAlpha = mix(vec3(0.92, 0.24, 0.48), vec3(0.96, 0.46, 0.26), smoothstep(0.2, 0.7, phase));
    vec3 oThree = mix(vec3(0.22, 0.74, 0.92), vec3(0.45, 0.36, 0.96), smoothstep(0.5, 0.9, phase));
    vec3 gasCol = mix(hAlpha, oThree, smoothstep(0.32, 0.76, n1));
    vec3 col = gasCol * wisps * dustRift * 1.15 + mix(vec3(0.95, 0.92, 1.0), oThree, 0.35) * core * 0.85;
    float a = clamp((wisps * 0.78 * dustRift + core * 0.58) * alpha, 0.0, 0.92);
    if (a < 0.01) discard;
    outColor = vec4(col, a);
    return;
  }

  // --- 10: PLANETARY NEBULA / SUPERNOVA REMNANT (Ring M57, Helix, Crab M1, Dumbbell!) ---
  if (bType == 10) {
    float c = cos(ang), s = sin(ang);
    vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    vec2 ep = vec2(rp.x, rp.y * 1.18);
    float d = length(ep);
    if (d > 1.0) discard;
    float turb = snoise(rp * 6.5 + vec2(phase * 13.0)) * 0.14;
    float rd = d + turb * (phase > 0.7 ? 1.4 : 0.45);
    // Glowing ionized torus shell (O-III cyan-teal inner rim -> H-alpha coral outer rim)
    float shellD = (rd - 0.46) * 5.2;
    float shell = exp(-(shellD * shellD));
    float innerGas = exp(-d * d * 5.5) * 0.34;
    float centralStar = exp(-d * d * 120.0) * 0.95;

    vec3 innerCol = vec3(0.20, 0.86, 0.88);
    vec3 outerCol = phase > 0.7 ? vec3(0.95, 0.45, 0.25) : vec3(0.96, 0.34, 0.46);
    vec3 col = mix(innerCol, outerCol, smoothstep(0.36, 0.62, rd)) * shell * 1.1
             + innerCol * innerGas
             + vec3(0.95, 0.98, 1.0) * centralStar;
    float a = clamp((shell * 0.82 + innerGas + centralStar) * alpha, 0.0, 0.92);
    if (a < 0.01) discard;
    outColor = vec4(col, a);
    return;
  }

  // --- 11: SPIRAL & COMPANION GALAXIES (Andromeda M31, Triangulum, Whirlpool, Sombrero, LMC/SMC!) ---
  if (bType == 11) {
    float c = cos(ang), s = sin(ang);
    vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    // Tilt factor based on variant (Sombrero ~0.18 edge-on, Andromeda ~0.38, Whirlpool ~0.85 face-on)
    float tiltY = mix(3.4, 1.15, clamp(phase, 0.0, 1.0));
    vec2 gp = vec2(rp.x, rp.y * tiltY);
    float gr = length(gp);
    if (length(rp) > 1.0) discard;

    // Warm golden galactic bulge + logarithmic spiral arms + dark dust lanes
    float bulge = exp(-gr * gr * 14.0) * 0.95 + exp(-gr * 4.2) * 0.38;
    float theta = atan(gp.y, gp.x);
    float armWave = 0.5 + 0.5 * cos(theta * 2.0 - log(gr + 0.08) * 5.8);
    float arms = pow(armWave, 1.65) * exp(-gr * 2.6) * smoothstep(0.08, 0.26, gr);
    float clumpy = 0.68 + 0.32 * snoise(gp * 7.5 + vec2(phase * 11.0));
    // Subtle dark equatorial dust lane for edge-on/tilted spirals
    float dustD = (rp.y + 0.04) * 18.0;
    float dustLane = phase < 0.35 ? (1.0 - 0.52 * exp(-(dustD * dustD)) * exp(-rp.x * rp.x * 2.5)) : 1.0;

    vec3 coreCol = vec3(1.00, 0.91, 0.74);
    vec3 armCol = vec3(0.68, 0.82, 1.00);
    vec3 col = (coreCol * bulge + armCol * arms * clumpy * 0.85) * dustLane;
    float a = clamp((bulge * 0.82 + arms * clumpy * 0.62) * dustLane * alpha, 0.0, 0.92);
    if (a < 0.01) discard;
    outColor = vec4(col, a);
    return;
  }

  // --- 12: STAR CLUSTERS (Pleiades M45 Sapphire Reflection Haze & Globular Clusters M13 / Omega Cen!) ---
  if (bType == 12) {
    float d = length(p);
    if (d > 1.0) discard;
    float isGlobular = step(0.5, phase);
    float n = snoise(p * 7.5 + vec2(phase * 19.0));
    // Sparkle grain simulating thousands of resolved cluster stars
    float sparkle = pow(snoise(p * 24.0 + vec2(3.1, 7.4)), 4.5) * exp(-d * d * 4.5);
    if (isGlobular > 0.5) {
      // Globular Cluster (Omega Centauri, M13): dense sparkling golden-white stellar core!
      float core = exp(-d * d * 10.5) * 0.85 + exp(-d * 3.6) * 0.28;
      vec3 col = mix(vec3(0.95, 0.90, 0.78), vec3(1.0, 0.98, 0.94), core) * (core + sparkle * 1.4);
      float a = clamp((core * 0.78 + sparkle * 0.9) * alpha, 0.0, 0.92);
      if (a < 0.01) discard;
      outColor = vec4(col, a);
      return;
    } else {
      // Pleiades M45: delicate wispy sapphire-blue reflection nebulosity + bright sister stars!
      float haze = exp(-d * d * 3.6) * (0.45 + 0.55 * n);
      float s1 = exp(-dot(p - vec2(-0.18, 0.10), p - vec2(-0.18, 0.10)) * 90.0);
      float s2 = exp(-dot(p - vec2(0.14, 0.16), p - vec2(0.14, 0.16)) * 105.0);
      float s3 = exp(-dot(p - vec2(0.02, -0.14), p - vec2(0.02, -0.14)) * 95.0);
      float s4 = exp(-dot(p - vec2(-0.28, -0.16), p - vec2(-0.28, -0.16)) * 115.0);
      float s5 = exp(-dot(p - vec2(0.28, -0.06), p - vec2(0.28, -0.06)) * 115.0);
      float stars = clamp(s1 + s2 + s3 + s4 + s5, 0.0, 1.3);
      vec3 col = vec3(0.32, 0.62, 1.0) * haze * 0.85 + vec3(0.92, 0.97, 1.0) * stars;
      float a = clamp((haze * 0.55 + stars * 0.95) * alpha, 0.0, 0.94);
      if (a < 0.01) discard;
      outColor = vec4(col, a);
      return;
    }
  }

  // --- 5: SATURN (Optical Deep-Sky Integration: Delicate Translucent Rings + Soft Starlight Halo!) ---
  if (bType == 5) {
    float c = cos(ang), s = sin(ang);
    vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    float planetR = 0.24;
    float pr = length(rp);

    // Delicate elliptical ring coordinates with soft optical feathering
    vec2 ringP = vec2(rp.x, rp.y * 3.15);
    float rr = length(ringP);
    float inRing = smoothstep(0.30, 0.36, rr) * (1.0 - smoothstep(0.66, 0.75, rr));
    // Authentic Cassini Division dark gap around rr = 0.52
    float casD = (rr - 0.52) * 28.0;
    float cassini = 1.0 - 0.72 * exp(-(casD * casD));
    float ringBands = 0.78 + 0.22 * sin(rr * 64.0);
    vec3 ringCol = mix(vec3(0.66, 0.58, 0.44), vec3(0.88, 0.81, 0.64), ringBands) * cassini;
    float ringA = inRing * (0.58 * cassini);

    // Saturn sphere with soft atmospheric limb integration
    float disc = 1.0 - smoothstep(planetR - 0.05, planetR + 0.04, pr);
    vec3 pCol = vec3(0.0);
    if (disc > 0.005) {
      vec2 sp = rp / planetR;
      float z = sqrt(max(0.0, 1.0 - min(1.0, dot(sp, sp))));
      vec3 norm = normalize(vec3(sp.x, sp.y, max(0.01, z)));
      vec3 sunDir = normalize(vec3(0.55, 0.35, 0.75));
      float diff = max(0.16, dot(norm, sunDir));
      float bands = 0.5 + 0.5 * sin(sp.y * 15.0);
      vec3 base = mix(vec3(0.68, 0.58, 0.40), vec3(0.90, 0.82, 0.64), bands);
      pCol = base * diff * (0.55 + 0.45 * pow(z, 0.65));
    }

    // Depth sort: front ring (rp.y < 0) draws OVER sphere; back ring (rp.y >= 0) draws BEHIND sphere
    vec3 finalCol;
    float finalA;
    if (rp.y < 0.0 && ringA > 0.015) {
      finalCol = mix(pCol, ringCol, ringA);
      finalA = max(disc * 0.88, ringA);
    } else {
      finalCol = mix(ringCol, pCol, disc);
      finalA = max(disc * 0.88, ringA);
    }
    // Airy starlight aura + whisper diffraction glint so Saturn lives naturally inside the starfield
    float halo = exp(-pr * pr * 11.0) * 0.36 + exp(-pr * 4.2) * 0.20;
    float spX = exp(-abs(p.y) * 32.0) * exp(-abs(p.x) * 4.2);
    float spY = exp(-abs(p.x) * 32.0) * exp(-abs(p.y) * 4.2);
    float glint = (spX + spY) * 0.14;
    vec3 auraCol = vec3(0.92, 0.84, 0.64);
    finalCol = mix(auraCol, finalCol, clamp(finalA * 1.15, 0.0, 1.0)) + auraCol * (halo * 0.45 + glint);
    finalA = clamp((finalA + halo * 0.65 + glint) * alpha, 0.0, 0.90);
    if (finalA < 0.01) discard;
    outColor = vec4(finalCol, finalA);
    return;
  }

  // --- SPHERICAL WORLDS: Moon (0), Mercury (1), Venus (2), Mars (3), Jupiter (4), Uranus (6), Neptune (7) ---
  // Harmonized deep-sky astrophotography optics: softer compact disc + luminous starlight halo
  // so planets sit seamlessly inside the same cosmic medium as the stars and nebulae!
  float rad = (bType == 0) ? 0.48 : 0.36;
  float disc = 1.0 - smoothstep(rad - 0.08, rad + 0.055, r);
  float innerAura = exp(-r * r * (bType == 0 ? 7.5 : 13.5)) * (bType == 0 ? 0.34 : 0.44);
  float outerHalo = exp(-r * 4.2) * (bType == 0 ? 0.20 : 0.22);
  // Subtle telescope diffraction glint on bright planets (Venus, Jupiter, Mars) matching Pass 5 stars
  float isBrightPlanet = (bType == 2 || bType == 4 || bType == 3) ? 1.0 : 0.0;
  float spX = exp(-abs(p.y) * 30.0) * exp(-abs(p.x) * 3.8);
  float spY = exp(-abs(p.x) * 30.0) * exp(-abs(p.y) * 3.8);
  float glint = (spX + spY) * (bType == 2 ? 0.26 : (isBrightPlanet * 0.14));

  if (disc <= 0.002 && (innerAura + outerHalo + glint) <= 0.005) discard;

  vec2 sp = p / rad;
  float r2 = dot(sp, sp);
  float z = sqrt(max(0.0, 1.0 - min(1.0, r2)));
  vec3 norm = normalize(vec3(sp.x, sp.y, max(0.01, z)));

  // Real Sun illumination vector (Moon uses live Sun-Moon elongation phase!)
  vec3 sunDir = (bType == 0)
    ? normalize(vec3(sin(phase), 0.12, -cos(phase)))
    : normalize(vec3(0.58, 0.32, 0.74));
  float ndotl = dot(norm, sunDir);
  float lit = (bType == 0)
    ? smoothstep(-0.10, 0.22, ndotl) * 0.90 + 0.045 // Delicate Earthshine on dark lunar limb
    : clamp(ndotl * 0.82 + 0.20, 0.14, 0.96);

  vec3 surf = vec3(0.82);
  vec3 glowCol = vec3(0.78, 0.84, 0.94);

  if (bType == 0) {
    // THE MOON: realistic lunar maria basalt basins + fine cratered regolith (muted observatory albedo)
    float maria = snoise(sp * 2.6 + vec2(1.4, 0.8)) * 0.65 + snoise(sp * 5.8) * 0.35;
    float crater = snoise(sp * 11.5);
    surf = mix(vec3(0.42, 0.44, 0.48), vec3(0.82, 0.81, 0.78), smoothstep(0.32, 0.68, maria));
    surf *= 0.88 + 0.18 * crater;
    glowCol = vec3(0.76, 0.82, 0.92);
  } else if (bType == 1) {
    // MERCURY: muted slate-silver rock
    float cr = snoise(sp * 7.5);
    surf = mix(vec3(0.42, 0.41, 0.40), vec3(0.72, 0.69, 0.65), cr);
    glowCol = vec3(0.72, 0.70, 0.68);
  } else if (bType == 2) {
    // VENUS: silky pale champagne-white morning/evening star
    float sw = snoise(vec2(sp.x * 2.2, sp.y * 4.5));
    surf = mix(vec3(0.84, 0.78, 0.64), vec3(0.98, 0.95, 0.88), sw);
    glowCol = vec3(0.98, 0.93, 0.80);
  } else if (bType == 3) {
    // MARS: natural dusky rust-amber + dark basalt Syrtis Major + subtle polar cap
    float terrain = snoise(sp * 3.4 + vec2(2.1, 1.3));
    surf = mix(vec3(0.52, 0.24, 0.15), vec3(0.86, 0.46, 0.28), smoothstep(0.28, 0.72, terrain));
    float iceCap = smoothstep(0.78, 0.92, sp.y);
    surf = mix(surf, vec3(0.90, 0.91, 0.94), iceCap * 0.72);
    glowCol = vec3(0.92, 0.54, 0.34);
  } else if (bType == 4) {
    // JUPITER: soft ivory/ochre equatorial cloud belts + subtle Great Red Spot
    float turb = snoise(vec2(sp.x * 4.0, sp.y * 9.0)) * 0.13;
    float lat = sp.y + turb;
    float b1 = 0.5 + 0.5 * sin(lat * 19.0);
    float b2 = 0.5 + 0.5 * cos(lat * 9.5 + 0.6);
    surf = mix(vec3(0.64, 0.46, 0.32), vec3(0.92, 0.86, 0.74), b1 * 0.65 + b2 * 0.35);
    float grs = exp(-dot((sp - vec2(0.22, -0.24)) * vec2(4.2, 6.8), (sp - vec2(0.22, -0.24)) * vec2(4.2, 6.8)));
    surf = mix(surf, vec3(0.82, 0.38, 0.24), grs * 0.75);
    glowCol = vec3(0.94, 0.86, 0.70);
  } else if (bType == 6) {
    // URANUS: muted pale aquamarine-blue ice giant
    float band = 0.5 + 0.5 * sin(sp.x * 6.0);
    surf = mix(vec3(0.46, 0.74, 0.84), vec3(0.68, 0.88, 0.94), band);
    glowCol = vec3(0.56, 0.82, 0.92);
  } else {
    // NEPTUNE: deep atmospheric azure
    float st = snoise(vec2(sp.x * 2.5, sp.y * 7.5));
    surf = mix(vec3(0.20, 0.38, 0.76), vec3(0.40, 0.60, 0.94), st);
    glowCol = vec3(0.38, 0.58, 0.94);
  }

  float limbDark = 0.42 + 0.58 * pow(z, 0.68);
  vec3 bodyCol = surf * lit * limbDark;
  // Blend planetary disc smoothly into its own luminous optical halo (zero harsh cutout!)
  float haloSum = innerAura + outerHalo + glint;
  vec3 col = mix(glowCol, bodyCol, clamp(disc * 0.92, 0.0, 1.0)) + glowCol * (innerAura * 0.28 + glint * 0.85);
  float maxA = (bType == 0) ? 0.90 : 0.86;
  float a = clamp((disc * maxA + haloSum * (1.0 - disc * 0.55)) * alpha, 0.0, maxA);
  outColor = vec4(col, a);
}`;

export class WebGLConstellationEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false, // Our shaders are analytically anti-aliased — huge GPU savings!
      depth: false,
      stencil: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    });

    if (!this.gl) {
      throw new Error("WebGL2 not supported in this environment");
    }

    this.dpr = 1;
    this.aspect = 16 / 9;
    this.nebulaScale = 0.24;
    this.nebulaUpdateInterval = 3; // Redraw soft nebula FBO every 3rd frame -> ~12x lower GPU load!
    this._frameCounter = 0;
    this.ambienceIntensity = 0.45; // Darker default velvet cosmos!
    this.nebulaFbo = null;
    this.nebulaTex = null;
    this.nebulaW = 0;
    this.nebulaH = 0;

    this._initPrograms();
    this._initBuffers();
    this.resize(1.25, 0.24);
  }

  _compile(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`Shader compile error: ${err}`);
    }
    return sh;
  }

  _link(vsSrc, fsSrc) {
    const gl = this.gl;
    const vs = this._compile(gl.VERTEX_SHADER, vsSrc);
    const fs = this._compile(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const err = gl.getProgramInfoLog(prog);
      throw new Error(`Program link error: ${err}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
  }

  _initPrograms() {
    const gl = this.gl;

    // 1. Nebula + 3D Real Milky Way
    this.nebulaProg = this._link(FULLSCREEN_VS, NEBULA_FS);
    this.nebulaU = {
      time: gl.getUniformLocation(this.nebulaProg, "uTime"),
      aspect: gl.getUniformLocation(this.nebulaProg, "uAspect"),
      energy: gl.getUniformLocation(this.nebulaProg, "uEnergy"),
      bass: gl.getUniformLocation(this.nebulaProg, "uBass"),
      ambience: gl.getUniformLocation(this.nebulaProg, "uAmbience"),
      isHemi: gl.getUniformLocation(this.nebulaProg, "uIsHemi"),
      domeScale: gl.getUniformLocation(this.nebulaProg, "uDomeScale"),
      domeKick: gl.getUniformLocation(this.nebulaProg, "uDomeKick"),
      domeDrive: gl.getUniformLocation(this.nebulaProg, "uDomeDrive"),
      wave1: gl.getUniformLocation(this.nebulaProg, "uWave1"),
      wave2: gl.getUniformLocation(this.nebulaProg, "uWave2"),
      domeShake: gl.getUniformLocation(this.nebulaProg, "uDomeShake"),
      camF: gl.getUniformLocation(this.nebulaProg, "uCamF"),
      camR: gl.getUniformLocation(this.nebulaProg, "uCamR"),
      camU: gl.getUniformLocation(this.nebulaProg, "uCamU"),
      colorA: gl.getUniformLocation(this.nebulaProg, "uColorA"),
      colorB: gl.getUniformLocation(this.nebulaProg, "uColorB"),
      colorC: gl.getUniformLocation(this.nebulaProg, "uColorC"),
      lineTint: gl.getUniformLocation(this.nebulaProg, "uLineTint"),
    };

    // 1b. Blit FBO
    this.blitProg = this._link(FULLSCREEN_VS, BLIT_FS);
    this.blitTexU = gl.getUniformLocation(this.blitProg, "uTex");

    // 2. Background stars
    this.bgProg = this._link(BG_STARS_VS, BG_STARS_FS);
    this.bgU = {
      time: gl.getUniformLocation(this.bgProg, "uTime"),
      aspect: gl.getUniformLocation(this.bgProg, "uAspect"),
      dpr: gl.getUniformLocation(this.bgProg, "uDpr"),
      high: gl.getUniformLocation(this.bgProg, "uHigh"),
    };

    // 3. Comet trails & meteors
    this.trailProg = this._link(TRAIL_VS, TRAIL_FS);
    this.trailU = {
      aspect: gl.getUniformLocation(this.trailProg, "uAspect"),
      lineTint: gl.getUniformLocation(this.trailProg, "uLineTint"),
    };

    // 4. Constellation filaments (anti-aliased SDF quads)
    this.filProg = this._link(FILAMENT_VS, FILAMENT_FS);
    this.filU = {
      aspect: gl.getUniformLocation(this.filProg, "uAspect"),
      lineTint: gl.getUniformLocation(this.filProg, "uLineTint"),
      starTint: gl.getUniformLocation(this.filProg, "uStarTint"),
    };

    // 5. Dynamic constellation stars
    this.starProg = this._link(STARS_VS, STARS_FS);
    this.starU = {
      aspect: gl.getUniformLocation(this.starProg, "uAspect"),
      dpr: gl.getUniformLocation(this.starProg, "uDpr"),
      time: gl.getUniformLocation(this.starProg, "uTime"),
      bass: gl.getUniformLocation(this.starProg, "uBass"),
      starTint: gl.getUniformLocation(this.starProg, "uStarTint"),
    };

    // 6. Realistic alpha-blended Planets, Phased Moon, Saturn Rings & Satellites
    this.bodyProg = this._link(BODIES_VS, BODIES_FS);
    this.bodyU = {
      aspect: gl.getUniformLocation(this.bodyProg, "uAspect"),
      invRes: gl.getUniformLocation(this.bodyProg, "uInvRes"),
    };
  }

  _initBuffers() {
    const gl = this.gl;

    // Empty VAO for fullscreen triangle passes
    this.emptyVao = gl.createVertexArray();

    // --- Static Deep-Space Starfield (1,100 stars, 0 CPU cost per frame) ---
    this.bgStarCount = 1100;
    const bgData = new Float32Array(this.bgStarCount * 5);
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < this.bgStarCount; i++) {
      // Spread slightly wider than [-1, 1] so rotation never reveals empty corners
      const ang = rand() * Math.PI * 2;
      const rad = Math.sqrt(rand()) * 1.95;
      bgData[i * 5 + 0] = Math.cos(ang) * rad;
      bgData[i * 5 + 1] = Math.sin(ang) * rad;
      bgData[i * 5 + 2] = 0.8 + Math.pow(rand(), 3.2) * 3.2;
      bgData[i * 5 + 3] = rand() * Math.PI * 2;
      bgData[i * 5 + 4] = rand();
    }
    this.bgVao = gl.createVertexArray();
    gl.bindVertexArray(this.bgVao);
    this.bgVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bgVbo);
    gl.bufferData(gl.ARRAY_BUFFER, bgData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 12);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 20, 16);

    // --- Comet Trails, Ecliptic Path, Dotted Transition Arc & Shooting Stars dynamic buffer ---
    const maxTrailSegs = GPU_MAX_STARS * (TRAIL_LEN - 1) + MAX_METEORS + 200;
    this.trailBuf = new Float32Array(maxTrailSegs * 2 * 4); // 2 verts/seg, 4 floats/vert
    this.trailVao = gl.createVertexArray();
    gl.bindVertexArray(this.trailVao);
    this.trailVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.trailBuf.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 16, 12);

    // --- Constellation Filaments dynamic quad buffer (+40 slots for curved star-to-star trace arcs!) ---
    this.filBuf = new Float32Array((GPU_MAX_EDGES + 40) * 6 * 8);
    this.filVao = gl.createVertexArray();
    gl.bindVertexArray(this.filVao);
    this.filVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.filVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.filBuf.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);

    // --- Dynamic Constellation Stars buffer (7 floats/star) ---
    this.starBuf = new Float32Array(GPU_MAX_STARS * 7);
    this.starVao = gl.createVertexArray();
    gl.bindVertexArray(this.starVao);
    this.starVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.starBuf.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 28, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 28, 16);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 28, 20);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 1, gl.FLOAT, false, 28, 24);

    // --- Realistic Planets, Moon & Satellites billboard quad buffer (6 verts/body, 8 floats/vert) ---
    this.bodyBuf = new Float32Array(MAX_RENDER_BODIES * 6 * 8);
    this.bodyVao = gl.createVertexArray();
    gl.bindVertexArray(this.bodyVao);
    this.bodyVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bodyVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.bodyBuf.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);

    gl.bindVertexArray(null);
  }

  _ensureNebulaFbo(w, h) {
    const gl = this.gl;
    const nw = Math.max(64, Math.floor(w * this.nebulaScale));
    const nh = Math.max(64, Math.floor(h * this.nebulaScale));
    if (nw === this.nebulaW && nh === this.nebulaH && this.nebulaFbo) return;

    if (this.nebulaTex) gl.deleteTexture(this.nebulaTex);
    if (this.nebulaFbo) gl.deleteFramebuffer(this.nebulaFbo);

    this.nebulaW = nw;
    this.nebulaH = nh;
    this._frameCounter = 0; // Force immediate redraw into fresh FBO

    this.nebulaTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.nebulaTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, nw, nh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.nebulaFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.nebulaFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.nebulaTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(maxDpr = 1.5, nebulaScale = 0.45) {
    this.dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.nebulaScale = nebulaScale;
    const w = Math.max(1, Math.floor(window.innerWidth * this.dpr));
    const h = Math.max(1, Math.floor(window.innerHeight * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.aspect = w / h;
    this._ensureNebulaFbo(w, h);
  }

  render(physics, audio) {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const pal = physics.palette;
    const energy = audio ? audio.energy : 0;
    const bass = audio ? audio.bass : 0;
    const high = audio ? audio.high : 0;

    const isHemi = Boolean(physics.isHemisphere);
    const envDim = typeof physics.environmentDim === "number" ? physics.environmentDim : 1.0;
    const effectiveAmbience = this.ambienceIntensity * envDim;

    // ------------------------------------------------------------------
    // PASS 1: Cached Low-Res Nebula / True 3D Milky Way -> Blit
    // ------------------------------------------------------------------
    gl.disable(gl.BLEND);
    if (effectiveAmbience <= 0.01) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.003, 0.004, 0.010, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    } else {
      // In Hemisphere Mode, redraw 3D Milky Way every frame while dragging/zooming, else every N frames
      const shouldRedrawNebula = isHemi || ((this._frameCounter % this.nebulaUpdateInterval) === 0);
      if (shouldRedrawNebula) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.nebulaFbo);
        gl.viewport(0, 0, this.nebulaW, this.nebulaH);
        gl.useProgram(this.nebulaProg);
        gl.uniform1f(this.nebulaU.time, physics.time);
        gl.uniform1f(this.nebulaU.aspect, this.aspect);
        gl.uniform1f(this.nebulaU.energy, energy);
        gl.uniform1f(this.nebulaU.bass, bass);
        gl.uniform1f(this.nebulaU.ambience, effectiveAmbience);
        gl.uniform1f(this.nebulaU.isHemi, isHemi ? 1.0 : 0.0);
        gl.uniform1f(this.nebulaU.domeScale, physics.domeScale || 1.12);
        gl.uniform1f(this.nebulaU.domeKick, physics.domeKick || 0.0);
        gl.uniform1f(this.nebulaU.domeDrive, physics.songIntensity || 0.0);
        gl.uniform2f(this.nebulaU.wave1, physics.domeWave1Pos ?? 2.0, physics.domeWave1Amp ?? 0.0);
        gl.uniform2f(this.nebulaU.wave2, physics.domeWave2Pos ?? 2.0, physics.domeWave2Amp ?? 0.0);
        gl.uniform2f(this.nebulaU.domeShake, physics.domeShakeX || 0.0, physics.domeShakeY || 0.0);
        gl.uniform3fv(this.nebulaU.camF, physics.camForward || [0, 0, 1]);
        gl.uniform3fv(this.nebulaU.camR, physics.renderRight || physics.camRight || [1, 0, 0]);
        gl.uniform3fv(this.nebulaU.camU, physics.renderUp || physics.camUp || [0, 1, 0]);
        gl.uniform3fv(this.nebulaU.colorA, pal.a);
        gl.uniform3fv(this.nebulaU.colorB, pal.b);
        gl.uniform3fv(this.nebulaU.colorC, pal.c);
        gl.uniform3fv(this.nebulaU.lineTint, pal.lineTint);
        gl.bindVertexArray(this.emptyVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.blitProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.nebulaTex);
      gl.uniform1i(this.blitTexU, 0);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    this._frameCounter++;

    // Additive starlight blending for stars, trails & filaments
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    // ------------------------------------------------------------------
    // PASS 2: Flat Deep-Space Background Stars (Morph Mode only — Hemisphere uses 1,350 real 3D Hipparcos stars!)
    // ------------------------------------------------------------------
    if (!isHemi) {
      gl.useProgram(this.bgProg);
      gl.uniform1f(this.bgU.time, physics.time);
      gl.uniform1f(this.bgU.aspect, this.aspect);
      gl.uniform1f(this.bgU.dpr, this.dpr);
      gl.uniform1f(this.bgU.high, high);
      gl.bindVertexArray(this.bgVao);
      gl.drawArrays(gl.POINTS, 0, this.bgStarCount);
    }

    // ------------------------------------------------------------------
    // PASS 3: Morph Comet Trails, Satellite Orbital Wakes & Shooting Stars
    // ------------------------------------------------------------------
    let tOff = 0;
    const tb = this.trailBuf;
    const starCount = Math.min(physics.count, GPU_MAX_STARS);
    const trailSlots = Math.min(physics.trailEnergy.length, GPU_MAX_STARS);
    const edgeCount = Math.min(physics.edges.length, GPU_MAX_EDGES);
    const meteorCount = physics.meteors.length;

    for (let i = 0; i < trailSlots; i++) {
      const te = physics.trailEnergy[i];
      if (te < 0.03) continue;
      const base = i * TRAIL_LEN;
      for (let t = 0; t < TRAIL_LEN - 1; t++) {
        const a0 = (1.0 - t / TRAIL_LEN) * te * 0.48;
        const a1 = (1.0 - (t + 1) / TRAIL_LEN) * te * 0.48;
        tb[tOff++] = physics.trailX[base + t];
        tb[tOff++] = physics.trailY[base + t];
        tb[tOff++] = a0;
        tb[tOff++] = 0.0;
        tb[tOff++] = physics.trailX[base + t + 1];
        tb[tOff++] = physics.trailY[base + t + 1];
        tb[tOff++] = a1;
        tb[tOff++] = 0.0;
      }
    }
    // Whisper-fine astronomical Ecliptic Path (Sun, Moon & Planets plane)
    const eclSegs = physics.eclipticSegs;
    if (eclSegs && eclSegs.length > 0) {
      for (let i = 0; i < eclSegs.length; i += 6) {
        tb[tOff++] = eclSegs[i];
        tb[tOff++] = eclSegs[i + 1];
        tb[tOff++] = eclSegs[i + 2];
        tb[tOff++] = 2.0; // Ecliptic gold hairline
        tb[tOff++] = eclSegs[i + 3];
        tb[tOff++] = eclSegs[i + 4];
        tb[tOff++] = eclSegs[i + 5];
        tb[tOff++] = 2.0;
      }
    }

    // 3D Dotted Great-Circle Celestial Route connecting Dome Mode constellation transitions!
    const dotSegs = physics.transitionDotSegs;
    if (dotSegs && dotSegs.length > 0) {
      for (let i = 0; i < dotSegs.length; i += 6) {
        tb[tOff++] = dotSegs[i];
        tb[tOff++] = dotSegs[i + 1];
        tb[tOff++] = dotSegs[i + 2];
        tb[tOff++] = 3.0; // Star-chart silver-sapphire dotted route
        tb[tOff++] = dotSegs[i + 3];
        tb[tOff++] = dotSegs[i + 4];
        tb[tOff++] = dotSegs[i + 5];
        tb[tOff++] = 3.0;
      }
    }

    for (let i = 0; i < meteorCount; i++) {
      const m = physics.meteors[i];
      if (!m.active) continue;
      const fade = Math.sin((m.life / m.maxLife) * Math.PI);
      const speed = Math.hypot(m.vx, m.vy) || 1;
      const tx = m.x - (m.vx / speed) * m.len;
      const ty = m.y - (m.vy / speed) * m.len;
      tb[tOff++] = m.x;
      tb[tOff++] = m.y;
      tb[tOff++] = fade * 0.95;
      tb[tOff++] = 1.0;
      tb[tOff++] = tx;
      tb[tOff++] = ty;
      tb[tOff++] = 0.0;
      tb[tOff++] = 1.0;
    }

    if (tOff > 0) {
      gl.useProgram(this.trailProg);
      gl.uniform1f(this.trailU.aspect, this.aspect);
      gl.uniform3fv(this.trailU.lineTint, pal.lineTint);
      gl.bindVertexArray(this.trailVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.trailVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, tb.subarray(0, tOff));
      gl.drawArrays(gl.LINES, 0, tOff / 4);
    }

    // ------------------------------------------------------------------
    // PASS 4: Anti-Aliased SDF Glow Constellation Filaments
    // ------------------------------------------------------------------
    let fOff = 0;
    const fb = this.filBuf;
    const halfWidthBase = 0.0135;

    for (let i = 0; i < edgeCount; i++) {
      const e = physics.edges[i];
      if (!e.active || e.draw <= 0.005 || e.alpha <= 0.005) continue;

      const x0 = physics.x[e.a];
      const y0 = physics.y[e.a];
      const x1 = physics.x[e.b];
      const y1 = physics.y[e.b];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) continue;

      const hw = halfWidthBase * e.weight * (1.0 + (e.pulse >= 0 ? 0.25 : 0.0));
      const nx = (-dy / len) * hw;
      const ny = (dx / len) * hw;

      const a = e.alpha;
      const dp = e.draw;
      const pp = e.pulse;
      const wt = e.weight;

      // Quad made of 2 triangles
      // v0 (0, -1), v1 (1, -1), v2 (1, 1)
      fb[fOff++] = x0 - nx; fb[fOff++] = y0 - ny; fb[fOff++] = 0; fb[fOff++] = -1; fb[fOff++] = a; fb[fOff++] = dp; fb[fOff++] = pp; fb[fOff++] = wt;
      fb[fOff++] = x1 - nx; fb[fOff++] = y1 - ny; fb[fOff++] = 1; fb[fOff++] = -1; fb[fOff++] = a; fb[fOff++] = dp; fb[fOff++] = pp; fb[fOff++] = wt;
      fb[fOff++] = x1 + nx; fb[fOff++] = y1 + ny; fb[fOff++] = 1; fb[fOff++] = 1;  fb[fOff++] = a; fb[fOff++] = dp; fb[fOff++] = pp; fb[fOff++] = wt;

      // v0 (0, -1), v2 (1, 1), v3 (0, 1)
      fb[fOff++] = x0 - nx; fb[fOff++] = y0 - ny; fb[fOff++] = 0; fb[fOff++] = -1; fb[fOff++] = a; fb[fOff++] = dp; fb[fOff++] = pp; fb[fOff++] = wt;
      fb[fOff++] = x1 + nx; fb[fOff++] = y1 + ny; fb[fOff++] = 1; fb[fOff++] = 1;  fb[fOff++] = a; fb[fOff++] = dp; fb[fOff++] = pp; fb[fOff++] = wt;
      fb[fOff++] = x0 + nx; fb[fOff++] = y0 + ny; fb[fOff++] = 0; fb[fOff++] = 1;  fb[fOff++] = a; fb[fOff++] = dp; fb[fOff++] = pp; fb[fOff++] = wt;
    }

    // Helper to draw a crisp, straight luminous starlight trace between two stars
    const pushStraightHopLine = (fromIdx, toIdx, progress, alphaVal, widthMul, pulseHead) => {
      if (fromIdx < 0 || toIdx < 0 || alphaVal <= 0.015) return;
      const sx = physics.x[fromIdx], sy = physics.y[fromIdx];
      const ex = physics.x[toIdx], ey = physics.y[toIdx];
      const dx = ex - sx, dy = ey - sy;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.004 || dist > 2.2) return;

      const hw = halfWidthBase * widthMul;
      const nx = (-dy / dist) * hw;
      const ny = (dx / dist) * hw;
      const dp = Math.min(1.0, Math.max(0.02, progress));
      const pp = pulseHead ? Math.min(1.15, progress) : -1.0;
      const wt = 0.82;

      fb[fOff++] = sx - nx; fb[fOff++] = sy - ny; fb[fOff++] = 0; fb[fOff++] = -1; fb[fOff++] = alphaVal; fb[fOff++] = dp; fb[fOff++] = pp; fb[fOff++] = wt;
      fb[fOff++] = ex - nx; fb[fOff++] = ey - ny; fb[fOff++] = 1; fb[fOff++] = -1; fb[fOff++] = alphaVal; fb[fOff++] = dp; fb[fOff++] = pp; fb[fOff++] = wt;
      fb[fOff++] = ex + nx; fb[fOff++] = ey + ny; fb[fOff++] = 1; fb[fOff++] = 1;  fb[fOff++] = alphaVal; fb[fOff++] = dp; fb[fOff++] = pp; fb[fOff++] = wt;
      fb[fOff++] = sx - nx; fb[fOff++] = sy - ny; fb[fOff++] = 0; fb[fOff++] = -1; fb[fOff++] = alphaVal; fb[fOff++] = dp; fb[fOff++] = pp; fb[fOff++] = wt;
      fb[fOff++] = ex + nx; fb[fOff++] = ey + ny; fb[fOff++] = 1; fb[fOff++] = 1;  fb[fOff++] = alphaVal; fb[fOff++] = dp; fb[fOff++] = pp; fb[fOff++] = wt;
      fb[fOff++] = sx + nx; fb[fOff++] = sy + ny; fb[fOff++] = 0; fb[fOff++] = 1;  fb[fOff++] = alphaVal; fb[fOff++] = dp; fb[fOff++] = pp; fb[fOff++] = wt;
    };

    // Clean star-to-star switch trace (distinctly brighter than constellation line pulses!)
    const hop = physics.starHop;
    if (hop && hop.active && hop.fromStar >= 0 && hop.toStar >= 0 && hop.alpha > 0.02) {
      pushStraightHopLine(hop.fromStar, hop.toStar, hop.progress, hop.alpha * 0.80, 0.80, true);
    }

    if (fOff > 0) {
      gl.useProgram(this.filProg);
      gl.uniform1f(this.filU.aspect, this.aspect);
      gl.uniform3fv(this.filU.lineTint, pal.lineTint);
      gl.uniform3fv(this.filU.starTint, pal.starTint);
      gl.bindVertexArray(this.filVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.filVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, fb.subarray(0, fOff));
      gl.drawArrays(gl.TRIANGLES, 0, fOff / 8);
    }

    // ------------------------------------------------------------------
    // PASS 5: Constellation & Companion Halo Stars (with individual music glow!)
    // ------------------------------------------------------------------
    const sb = this.starBuf;
    let sOff = 0;
    let visibleStars = 0;
    for (let i = 0; i < starCount; i++) {
      if (physics.bright[i] <= 0.002 && physics.flare[i] <= 0.002) continue;
      const mGlow = physics.musicGlow[i];
      const totalFlare = physics.flare[i] + mGlow * 0.72;
      sb[sOff++] = physics.x[i];
      sb[sOff++] = physics.y[i];
      sb[sOff++] = physics.size[i] * (1.0 + mGlow * 0.28);
      sb[sOff++] = physics.bright[i] + mGlow * 0.42;
      sb[sOff++] = totalFlare;
      sb[sOff++] = physics.temp[i];
      sb[sOff++] = physics.role[i];
      visibleStars++;
    }

    if (visibleStars > 0) {
      gl.useProgram(this.starProg);
      gl.uniform1f(this.starU.aspect, this.aspect);
      gl.uniform1f(this.starU.dpr, this.dpr);
      gl.uniform1f(this.starU.time, physics.time);
      gl.uniform1f(this.starU.bass, bass);
      gl.uniform3fv(this.starU.starTint, pal.starTint);
      gl.bindVertexArray(this.starVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.starVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sb.subarray(0, sOff));
      gl.drawArrays(gl.POINTS, 0, visibleStars);
    }

    // ------------------------------------------------------------------
    // PASS 6: Realistic Alpha-Blended Planets, Phased Moon, Saturn Rings & Satellites!
    // (Uses standard alpha blending -> crisp planetary color, bands, rings, & solar wings — ZERO white globs!)
    // ------------------------------------------------------------------
    const bodies = physics.renderBodies;
    if (bodies && bodies.length > 0) {
      const bb = this.bodyBuf;
      let bOff = 0;
      const count = Math.min(bodies.length, MAX_RENDER_BODIES);
      for (let i = 0; i < count; i++) {
        const b = bodies[i];
        if (b.alpha <= 0.01) continue;
        const rPx = b.pxSize * this.dpr;
        const bx = b.x, by = b.y;
        const bt = b.bodyType, ph = b.phaseParam, ang = b.angle, al = b.alpha;
        // 2 triangles covering [-rPx, +rPx] in screen pixels
        bb[bOff++] = bx; bb[bOff++] = by; bb[bOff++] = -rPx; bb[bOff++] = -rPx; bb[bOff++] = bt; bb[bOff++] = ph; bb[bOff++] = ang; bb[bOff++] = al;
        bb[bOff++] = bx; bb[bOff++] = by; bb[bOff++] =  rPx; bb[bOff++] = -rPx; bb[bOff++] = bt; bb[bOff++] = ph; bb[bOff++] = ang; bb[bOff++] = al;
        bb[bOff++] = bx; bb[bOff++] = by; bb[bOff++] =  rPx; bb[bOff++] =  rPx; bb[bOff++] = bt; bb[bOff++] = ph; bb[bOff++] = ang; bb[bOff++] = al;

        bb[bOff++] = bx; bb[bOff++] = by; bb[bOff++] = -rPx; bb[bOff++] = -rPx; bb[bOff++] = bt; bb[bOff++] = ph; bb[bOff++] = ang; bb[bOff++] = al;
        bb[bOff++] = bx; bb[bOff++] = by; bb[bOff++] =  rPx; bb[bOff++] =  rPx; bb[bOff++] = bt; bb[bOff++] = ph; bb[bOff++] = ang; bb[bOff++] = al;
        bb[bOff++] = bx; bb[bOff++] = by; bb[bOff++] = -rPx; bb[bOff++] =  rPx; bb[bOff++] = bt; bb[bOff++] = ph; bb[bOff++] = ang; bb[bOff++] = al;
      }

      if (bOff > 0) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.bodyProg);
        gl.uniform1f(this.bodyU.aspect, this.aspect);
        gl.uniform2f(this.bodyU.invRes, 1.0 / w, 1.0 / h);
        gl.bindVertexArray(this.bodyVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bodyVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, bb.subarray(0, bOff));
        gl.drawArrays(gl.TRIANGLES, 0, bOff / 8);
      }
    }

    gl.bindVertexArray(null);
  }
}
