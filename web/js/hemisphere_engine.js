/**
 * Astralis 3D Interactive Real-Time Observatory Dome.
 *
 * - ALL 88 official IAU constellations (767 real Hipparcos stars)
 * - 1,350 REAL Hipparcos naked-eye background stars rotating in true 3D lock-step!
 * - True 3D Milky Way galactic plane synchronized to the 3D camera!
 * - Realistic procedural Planets (Mars, Jupiter bands, Saturn with 26.7° Cassini rings,
 *   Venus, Mercury, Uranus, Neptune), live-phased Moon, and LIVE NORAD CelesTrak Satellites
 *   rendered via a dedicated alpha-blended shader (ZERO white globs!).
 * - Gimbal-lock-free orthonormal 3D camera + distortion-free Azimuthal Equidistant projection!
 */

import { CONSTELLATIONS, CONSTELLATION_KEYS } from "./constellations.js";
import { HIP_BG_STARS } from "./bg_stars_hip.js";
import { getStarFunFact } from "./astronomy_facts.js";
import {
  computeEclipticUnitVectors,
  computeSolarSystemBodies,
  DEEP_SKY_CATALOG,
  FALLBACK_SATELLITES,
  propagateNoradSatellite,
  spectralClassFromTemp,
} from "./celestial_objects.js";

// 767 IAU stars + 1,350 real Hipparcos 3D sky stars = 2,117 real stars in one GPU draw call!
export const HEMI_MAX_STARS = 2200;
export const HEMI_MAX_EDGES = 800;
export const HEMI_TRAIL_LEN = 5;
export const HEMI_MAX_METEORS = 4;
export const MAX_RENDER_BODIES = 64; // 8 Solar System + 9 Satellites + 21 Deep-Sky Nebulae/Galaxies/Clusters!

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Crisp, visibly proportional astronomical photometry curve (consistent across ALL stars: IAU & Hipparcos!).
 * Sirius (-1.46) -> 7.4, Vega (0.0) -> 6.0, Alnilam (1.7) -> 4.4, Mag 3.5 -> 2.9, Mag 5.0 -> 1.75.
 */
function magToStarSize(mag) {
  const m = typeof mag === "number" ? mag : 4.2;
  const t = clamp((5.6 - m) / 7.1, 0.0, 1.0);
  return 1.55 + 5.95 * Math.pow(t, 1.25);
}

function magToStarBright(mag) {
  const m = typeof mag === "number" ? mag : 4.2;
  const t = clamp((5.6 - m) / 7.1, 0.0, 1.0);
  return 0.34 + 0.66 * Math.pow(t, 0.92);
}

function normalize3(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function cross3(ax, ay, az, bx, by, bz) {
  return [
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx,
  ];
}

function raDecDegToUnitVec(raDeg, decDeg) {
  const ra = (raDeg * Math.PI) / 180.0;
  const dec = (decDeg * Math.PI) / 180.0;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), Math.sin(dec), cd * Math.sin(ra)];
}

function rotateAroundAxis(vx, vy, vz, kx, ky, kz, theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const dot = vx * kx + vy * ky + vz * kz;
  const [cx, cy, cz] = cross3(kx, ky, kz, vx, vy, vz);
  return [
    vx * c + cx * s + kx * dot * (1 - c),
    vy * c + cy * s + ky * dot * (1 - c),
    vz * c + cz * s + kz * dot * (1 - c),
  ];
}

function slerpUnitVec(a, b, t) {
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1.0, 1.0);
  if (dot > 0.9995) {
    return normalize3(
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    );
  }
  if (dot < -0.9995) {
    // Antipodal: pick an orthogonal pivot vector
    const perp = Math.abs(a[1]) < 0.9 ? cross3(a[0], a[1], a[2], 0, 1, 0) : cross3(a[0], a[1], a[2], 1, 0, 0);
    const p = normalize3(perp[0], perp[1], perp[2]);
    const ang = Math.PI * t;
    const c = Math.cos(ang), s = Math.sin(ang);
    return normalize3(a[0] * c + p[0] * s, a[1] * c + p[1] * s, a[2] * c + p[2] * s);
  }
  const omega = Math.acos(dot);
  const sinO = Math.sin(omega);
  const w0 = Math.sin((1.0 - t) * omega) / sinO;
  const w1 = Math.sin(t * omega) / sinO;
  return [a[0] * w0 + b[0] * w1, a[1] * w0 + b[1] * w1, a[2] * w0 + b[2] * w1];
}

function buildIdealBasis(forwardVec) {
  const [fx, fy, fz] = normalize3(forwardVec[0], forwardVec[1], forwardVec[2]);
  const worldUp = Math.abs(fy) > 0.96 ? [0, 0, 1] : [0, 1, 0];
  const right = normalize3(...cross3(worldUp[0], worldUp[1], worldUp[2], fx, fy, fz));
  const up = normalize3(...cross3(fx, fy, fz, right[0], right[1], right[2]));
  return { forward: [fx, fy, fz], right, up };
}

function formatRaDec(raDeg, decDeg) {
  const h = Math.floor(raDeg / 15);
  const m = Math.floor(((raDeg / 15) - h) * 60);
  const sign = decDeg >= 0 ? "+" : "−";
  return `RA ${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")}m · Dec ${sign}${Math.abs(decDeg).toFixed(1)}°`;
}

export class HemisphereEngine {
  constructor() {
    this.isHemisphere = true;
    this.count = HEMI_MAX_STARS;
    this.maxEdges = HEMI_MAX_EDGES;
    this.trailLen = HEMI_TRAIL_LEN;
    this.maxMeteors = HEMI_MAX_METEORS;

    this.environmentDim = 0.55; // Real 3D Milky Way dust lane brightness multiplier
    this.showPlanetsAndSats = true;
    this.showDeepSky = true;
    this.showEcliptic = true;
    this.viewingMode = false; // Observatory pattern clarity mode (all 88 constellation patterns crisp!)
    this.trackedTarget = null; // Live Lock-On target: { kind, id, catnr?, name, subtitle? }
    this.eclipticVecs = computeEclipticUnitVectors(96);
    this.eclipticSegs = []; // Projected [x0, y0, a0, x1, y1, a1, ...] for WebGL Pass 3
    this.transitionDotSegs = []; // Projected 3D dotted great-circle arc connecting constellation transitions!
    this.domeTransition = {
      active: false,
      samples: [],
      progress: 1.0,
      alpha: 0.0,
      speed: 2.5,
    };
    this.isDragging = false;
    this.constellationLabels = []; // Projected visible constellation names for the sky-atlas overlay
    this.starNameLabels = [];      // Projected bright proper star names (toggleable ON/OFF!)

    // 3D celestial sphere star arrays (IAU constellation stars + real Hipparcos 3D sky stars)
    this.sx3 = new Float32Array(HEMI_MAX_STARS);
    this.sy3 = new Float32Array(HEMI_MAX_STARS);
    this.sz3 = new Float32Array(HEMI_MAX_STARS);
    this.starOwner = new Int16Array(HEMI_MAX_STARS);
    this.baseSize = new Float32Array(HEMI_MAX_STARS);
    this.baseBright = new Float32Array(HEMI_MAX_STARS);
    this.isPrimary = new Uint8Array(HEMI_MAX_STARS);
    this.meta = new Array(HEMI_MAX_STARS).fill(null);

    // Projected 2D star buffers (shared contract with WebGLConstellationEngine)
    this.x = new Float32Array(HEMI_MAX_STARS);
    this.y = new Float32Array(HEMI_MAX_STARS);
    this.size = new Float32Array(HEMI_MAX_STARS);
    this.bright = new Float32Array(HEMI_MAX_STARS);
    this.flare = new Float32Array(HEMI_MAX_STARS);
    this.musicGlow = new Float32Array(HEMI_MAX_STARS);
    this.temp = new Float32Array(HEMI_MAX_STARS);
    this.phase = new Float32Array(HEMI_MAX_STARS);
    this.band = new Uint8Array(HEMI_MAX_STARS);
    this.role = new Uint8Array(HEMI_MAX_STARS);
    this._starVis = new Float32Array(HEMI_MAX_STARS);
    this._starTheta = new Float32Array(HEMI_MAX_STARS);

    // Satellite motion trails (small dedicated slots [0..15])
    this.trailX = new Float32Array(MAX_RENDER_BODIES * HEMI_TRAIL_LEN);
    this.trailY = new Float32Array(MAX_RENDER_BODIES * HEMI_TRAIL_LEN);
    this.trailEnergy = new Float32Array(MAX_RENDER_BODIES);
    this._satTrailAccum = 0;

    // Dedicated realistic Solar System & Satellite objects (rendered in Pass 6 BODIES — NO white globs!)
    this.solarBodies = computeSolarSystemBodies(new Date());
    this.satellites = FALLBACK_SATELLITES.map((s) => ({ ...s }));
    this.satellitesLive = false;
    this._lastPlanetRefresh = Date.now();
    this._pausedWallMs = null;
    this.renderBodies = []; // Filled each step: [{ x, y, pxSize, bodyType, phaseParam, angle, alpha, meta }]

    this.edges = [];
    this.edgeOwner = new Int16Array(HEMI_MAX_EDGES);
    for (let i = 0; i < HEMI_MAX_EDGES; i++) {
      this.edges.push({
        active: false,
        a: 0,
        b: 0,
        draw: 1.0,
        retracting: false,
        delay: 0,
        speed: 2.0,
        alpha: 0,
        targetAlpha: 0.10,
        pulse: -1,
        pulseSpeed: 2.4,
        weight: 0.78,
      });
      this.edgeOwner[i] = -1;
    }

    this.meteors = [];
    for (let i = 0; i < HEMI_MAX_METEORS; i++) {
      this.meteors.push({
        active: false,
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, len: 0.16,
      });
    }

    this.starHop = {
      active: false,
      fromStar: -1,
      toStar: -1,
      progress: 1.0,
      speed: 4.8,
      alpha: 0.0,
      bend: 1.0,
    };
    this.recentHops = []; // Last 3 star hops linger as a pretty fading starlight ribbon!
    this._hopBendSign = 1.0;
    this.beatBlink = 0.0;
    this.beatPunch = 0.0;
    this.kickPunch = 0.0;
    this._lastBeatSeq = 0;
    this.spotlightFlash = 0.0;
    this.songIntensity = 0.0; // Rolling 0..1 music drive (0 = calm/ambient, 1 = rock/energetic!)
    this._rockPulseCooldown = 0.0;

    this.constellationMeta = new Map();
    this.focusedId = "orion";
    this.focusedIdx = 0;
    this.hoveredCenterId = "orion";
    this.hoveredStarIdx = -1;
    this.hoveredBodyId = "";
    this.tourCursor = 0;
    this.spotlightStar = -1;
    this.prevSpotlightStar = -1;
    this.prevPrevSpotlightStar = -1;

    // Gimbal-lock-free Orthonormal 3D Camera Frame
    this.camForward = [0, 0, 1];
    this.camRight = [1, 0, 0];
    this.camUp = [0, 1, 0];
    this.renderRight = [1, 0, 0];
    this.renderUp = [0, 1, 0];
    this.targetForward = [0, 0, 1];
    this.targetUp = [0, 1, 0];

    this.freeLook = false;
    this.velYaw = 0.0;
    this.velPitch = 0.0;
    this.zoom = 1.15;
    this.targetZoom = 1.15;
    this.domeScale = 1.12;

    // Reactive 3D Dome Dynamics (calm = chill tide; rock/bass = hard beat-zoom, shockwave ripples & groove roll)
    this.beatActivity = 0.0; // Volume-invariant drum cadence drive (0 = calm, 1 = driving beat!)
    this.domeKick = 0.0;
    this.domeZoomOffset = 0.0;
    this.domeZoomVel = 0.0;
    this.domeRoll = 0.0;
    this.domeRollVel = 0.0;
    this._beatToggle = 1;
    // Physical Beat Impact Shake & Sub-Bass Tremor Vibration (locked across entire 3D dome!)
    this.domeShakeX = 0.0;
    this.domeShakeY = 0.0;
    this._shakePosX = 0.0;
    this._shakePosY = 0.0;
    this._shakeVelX = 0.0;
    this._shakeVelY = 0.0;
    this._shakeAngle = 0.7;
    this.domeWave1Pos = 2.0;
    this.domeWave1Amp = 0.0;
    this.domeWave2Pos = 2.0;
    this.domeWave2Amp = 0.0;
    this._waveNextSlot = 0;

    this.musicGlowStrength = 1.0;
    this.transitionSpeedMul = 1.0;
    this.activeSlewRate = 2.4;
    this.time = 0;
    this.breathScale = 1.0;

    this.palette = {
      a: [0.006, 0.009, 0.026],
      b: [0.022, 0.024, 0.068],
      c: [0.14, 0.28, 0.54],
      starTint: [0.84, 0.91, 1.0],
      lineTint: [0.36, 0.62, 0.90],
    };
    this.targetPalette = {
      a: [...this.palette.a],
      b: [...this.palette.b],
      c: [...this.palette.c],
      starTint: [...this.palette.starTint],
      lineTint: [...this.palette.lineTint],
    };

    this._buildRealSkyVault();
    this.focusConstellation("orion", { instant: true });
  }

  /** Plug in live CelesTrak NORAD GP satellite orbital elements fetched from /api/celestial */
  setLiveSatellites(liveSats) {
    if (!Array.isArray(liveSats) || liveSats.length === 0) return;
    this.satellites = liveSats.map((s) => ({ ...s, live: true }));
    this.satellitesLive = true;
    this.trailEnergy.fill(0);
  }

  _buildRealSkyVault() {
    let sCursor = 0;
    let eCursor = 0;

    // 1. All 88 Official IAU Constellations (767 real Hipparcos stars)
    CONSTELLATION_KEYS.forEach((cid, cIdx) => {
      const data = CONSTELLATIONS[cid];
      const pts = data.points || [];
      const edges = data.edges || [];
      const localToGlobal = [];

      for (let pi = 0; pi < pts.length && sCursor < HEMI_MAX_STARS; pi++) {
        const p = pts[pi];
        const [ux, uy, uz] = raDecDegToUnitVec(p.ra, p.dec);

        const si = sCursor++;
        this.sx3[si] = ux;
        this.sy3[si] = uy;
        this.sz3[si] = uz;
        this.starOwner[si] = cIdx;
        this.isPrimary[si] = p.primary ? 1 : 0;

        // Physically proportional star radius from true Hipparcos apparent visual magnitude
        const mag = typeof p.mag === "number" ? p.mag : 4.0;
        this.baseSize[si] = magToStarSize(mag);
        this.baseBright[si] = magToStarBright(mag);
        this.temp[si] = typeof p.temp === "number" ? p.temp : 0.35;
        this.phase[si] = (si * 1.6180339) % (Math.PI * 2);
        this.band[si] = p.primary ? (pi % 2) : (1 + (pi % 2));
        this.role[si] = p.primary ? 2 : 1;

        this.meta[si] = {
          kind: "star",
          properName: p.properName || "",
          name: p.properName || p.desig || `${data.name} Star`,
          desig: p.desig || data.iau,
          constellation: data.title,
          subtitle: `${spectralClassFromTemp(this.temp[si])} · Mag ${mag >= 0 ? "+" : ""}${mag.toFixed(2)}`,
          fact: getStarFunFact(p.properName, p.desig, mag, this.temp[si]),
          mag,
          temp: this.temp[si],
        };

        localToGlobal.push(si);
      }

      for (let ei = 0; ei < edges.length && eCursor < HEMI_MAX_EDGES; ei++) {
        const [a, b] = edges[ei];
        if (a < 0 || b < 0 || a >= localToGlobal.length || b >= localToGlobal.length) continue;
        const e = this.edges[eCursor];
        e.active = true;
        e.a = localToGlobal[a];
        e.b = localToGlobal[b];
        e.draw = 1.0;
        e.alpha = 0.06;
        e.targetAlpha = 0.06;
        e.weight = (pts[a].primary && pts[b].primary) ? 0.84 : 0.58;
        this.edgeOwner[eCursor] = cIdx;
        eCursor++;
      }

      const centerVec = data.center
        ? raDecDegToUnitVec(data.center[0], data.center[1])
        : [0, 0, 1];
      // Pick the top 5-7 brightest stars (primaries first, topped up with brightest anchors)
      // so the spotlight highlights iconic stars without ever collapsing into a 2-star ping-pong!
      const ranked = [...localToGlobal].sort((a, b) => {
        const pDiff = this.isPrimary[b] - this.isPrimary[a];
        if (pDiff !== 0) return pDiff;
        return this.baseSize[b] - this.baseSize[a];
      });
      const tourOrder = ranked.slice(0, Math.min(ranked.length, 7));
      // Sort chosen highlight stars in a smooth angular sweep around the constellation center
      if (tourOrder.length >= 3) {
        const basis = buildIdealBasis(centerVec);
        const [rx, ry, rz] = basis.right;
        const [ux, uy, uz] = basis.up;
        tourOrder.sort((a, b) => {
          const ax = this.sx3[a] * rx + this.sy3[a] * ry + this.sz3[a] * rz;
          const ay = this.sx3[a] * ux + this.sy3[a] * uy + this.sz3[a] * uz;
          const bx = this.sx3[b] * rx + this.sy3[b] * ry + this.sz3[b] * rz;
          const by = this.sx3[b] * ux + this.sy3[b] * uy + this.sz3[b] * uz;
          return Math.atan2(ay, ax) - Math.atan2(by, bx);
        });
      }

      this.constellationMeta.set(cid, {
        idx: cIdx,
        name: data.name || cid,
        en: data.en || "",
        centerVec,
        starIndices: localToGlobal,
        tourOrder,
      });
    });

    // 2. 1,350 REAL Hipparcos Naked-Eye Background Stars in true 3D sky positions!
    // (Rotates in 100% authentic 3D lock-step with the constellations & Milky Way!)
    for (let k = 0; k < HIP_BG_STARS.length && sCursor < HEMI_MAX_STARS; k++) {
      const [ra, dec, mag, temp] = HIP_BG_STARS[k];
      const [ux, uy, uz] = raDecDegToUnitVec(ra, dec);
      const si = sCursor++;
      this.sx3[si] = ux;
      this.sy3[si] = uy;
      this.sz3[si] = uz;
      this.starOwner[si] = -1;
      this.isPrimary[si] = 0;
      // Same physical magnitude curve as IAU stars -> luminous, realistic full-sky starfield!
      this.baseSize[si] = magToStarSize(mag) * 0.86;
      this.baseBright[si] = magToStarBright(mag) * 0.68;
      this.temp[si] = temp;
      this.phase[si] = (si * 1.6180339) % (Math.PI * 2);
      this.band[si] = 2;
      this.role[si] = 0;
      this.meta[si] = null;
    }

    this.count = sCursor;
  }

  _orthonormalizeCamera() {
    this.camForward = normalize3(this.camForward[0], this.camForward[1], this.camForward[2]);
    this.camRight = normalize3(...cross3(
      this.camUp[0], this.camUp[1], this.camUp[2],
      this.camForward[0], this.camForward[1], this.camForward[2]
    ));
    this.camUp = normalize3(...cross3(
      this.camForward[0], this.camForward[1], this.camForward[2],
      this.camRight[0], this.camRight[1], this.camRight[2]
    ));
  }

  _rotateCameraFrame(dYaw, dPitch) {
    if (Math.abs(dYaw) > 1e-7) {
      const [ux, uy, uz] = this.camUp;
      this.camForward = rotateAroundAxis(this.camForward[0], this.camForward[1], this.camForward[2], ux, uy, uz, dYaw);
      this.camRight = rotateAroundAxis(this.camRight[0], this.camRight[1], this.camRight[2], ux, uy, uz, dYaw);
    }
    if (Math.abs(dPitch) > 1e-7) {
      const [rx, ry, rz] = this.camRight;
      this.camForward = rotateAroundAxis(this.camForward[0], this.camForward[1], this.camForward[2], rx, ry, rz, dPitch);
      this.camUp = rotateAroundAxis(this.camUp[0], this.camUp[1], this.camUp[2], rx, ry, rz, dPitch);
    }
    this._orthonormalizeCamera();
    this.targetForward = [...this.camForward];
    this.targetUp = [...this.camUp];
  }

  panByPixels(dxPx, dyPx) {
    this.freeLook = true;
    this.trackedTarget = null;
    const sens = 0.0024 / Math.max(0.55, this.zoom);
    const dYaw = -dxPx * sens;
    const dPitch = dyPx * sens;
    this._rotateCameraFrame(dYaw, dPitch);
    this.velYaw = dYaw * 15.0;
    this.velPitch = dPitch * 15.0;
  }

  zoomBy(factor) {
    this.targetZoom = clamp(this.targetZoom * factor, 0.60, 4.8);
  }

  resetView() {
    this.freeLook = false;
    this.trackedTarget = null;
    this.velYaw = 0;
    this.velPitch = 0;
    this.targetZoom = 1.15;
    const meta = this.constellationMeta.get(this.focusedId);
    if (meta) {
      const b = buildIdealBasis(meta.centerVec);
      this.targetForward = b.forward;
      this.targetUp = b.up;
    }
  }

  /**
   * Smoothly slew the 3D dome camera to any real-time celestial object and optionally Lock-On track it!
   * target: { kind: "solar"|"satellite"|"dso"|"constellation", id, catnr?, name, subtitle? }
   */
  flyToTarget(target, opts = {}) {
    if (!target) return false;
    const vec = this._resolveTargetVec3(target, Date.now());
    if (!vec) return false;

    this.freeLook = false;
    this.velYaw = 0;
    this.velPitch = 0;
    this.trackedTarget = { ...target };

    const b = buildIdealBasis(vec);
    this.targetForward = b.forward;
    this.targetUp = b.up;
    if (opts.instant) {
      this.camForward = b.forward;
      this.camRight = b.right;
      this.camUp = b.up;
    }

    // Zoom smoothly into an ideal framing for the target type
    const defaultZoom =
      target.kind === "solar" ? 2.55
      : target.kind === "satellite" ? 2.45
      : target.kind === "dso" ? 2.05
      : 1.25;
    this.targetZoom = clamp(opts.zoom ?? defaultZoom, 0.60, 4.8);

    // Ensure the layer is visible when flying to it
    if (target.kind === "solar" || target.kind === "satellite") {
      this.showPlanetsAndSats = true;
    } else if (target.kind === "dso") {
      this.showDeepSky = true;
    }
    return true;
  }

  releaseTracking() {
    if (!this.trackedTarget) return;
    this.trackedTarget = null;
    this.freeLook = true;
  }

  _resolveTargetVec3(target, nowMs) {
    if (!target) return null;
    if (target.kind === "solar") {
      const body = this.solarBodies.find((b) => b.id === target.id);
      if (!body) return null;
      return raDecDegToUnitVec(body.ra, body.dec);
    }
    if (target.kind === "satellite") {
      const gp = this.satellites.find((s) => s.catnr === target.catnr || `sat_${s.catnr}` === target.id);
      if (!gp) return null;
      const pos = propagateNoradSatellite(gp, nowMs);
      return [pos.x, pos.y, pos.z];
    }
    if (target.kind === "dso") {
      const dso = DEEP_SKY_CATALOG.find((d) => d.id === target.id);
      if (!dso) return null;
      return raDecDegToUnitVec(dso.ra, dso.dec);
    }
    if (target.kind === "constellation") {
      const meta = this.constellationMeta.get(target.id);
      return meta ? meta.centerVec : null;
    }
    return null;
  }

  /** Return structured real-time sky objects catalog for the Live Sky Fly-To navigator */
  getLiveCatalog() {
    const nowMs = Date.now();
    return {
      solar: this.solarBodies.map((b) => ({
        kind: "solar",
        subkind: b.kind,
        id: b.id,
        name: b.name,
        subtitle: b.subtitle,
        coord: formatRaDec(b.ra, b.dec),
      })),
      satellites: this.satellites.map((gp) => {
        const pos = propagateNoradSatellite(gp, nowMs);
        return {
          kind: "satellite",
          id: `sat_${gp.catnr}`,
          catnr: gp.catnr,
          name: gp.name,
          live: Boolean(gp.live),
          subtitle: `${gp.role || "LEO"} · ${gp.alt_km || 410} km`,
          coord: formatRaDec(pos.ra, pos.dec),
        };
      }),
      deepSky: DEEP_SKY_CATALOG.map((d) => ({
        kind: "dso",
        subkind: d.kind,
        id: d.id,
        name: d.name,
        desig: d.desig,
        subtitle: d.subtitle,
        coord: formatRaDec(d.ra, d.dec),
      })),
    };
  }

  getCenteredConstellationId() {
    let bestId = this.focusedId;
    let bestDot = -2;
    const [fx, fy, fz] = this.camForward;
    for (const [cid, meta] of this.constellationMeta.entries()) {
      const c = meta.centerVec;
      const d = c[0] * fx + c[1] * fy + c[2] * fz;
      if (d > bestDot) {
        bestDot = d;
        bestId = cid;
      }
    }
    return bestId;
  }

  /** Spherical angular distance in degrees (0..180) between two real IAU constellations. */
  getAngleDegBetween(cidA, cidB) {
    const a = this.constellationMeta.get(cidA);
    const b = this.constellationMeta.get(cidB);
    if (!a || !b) return 90;
    const dot = clamp(
      a.centerVec[0] * b.centerVec[0] +
      a.centerVec[1] * b.centerVec[1] +
      a.centerVec[2] * b.centerVec[2],
      -1.0,
      1.0
    );
    return (Math.acos(dot) * 180) / Math.PI;
  }

  /**
   * Return nearby constellations within [minDeg, maxDeg] of `fromCid` (or current camera center),
   * sorted closest-first so quick tempo switches glide swiftly without whipping across the whole sky!
   */
  getNearbyConstellations(fromCid = null, minDeg = 16, maxDeg = 68) {
    const refMeta = fromCid ? this.constellationMeta.get(fromCid) : this.constellationMeta.get(this.focusedId);
    const refVec = refMeta ? refMeta.centerVec : this.camForward;
    const out = [];
    for (const [cid, meta] of this.constellationMeta.entries()) {
      if (cid === (fromCid || this.focusedId)) continue;
      const c = meta.centerVec;
      const dot = clamp(c[0] * refVec[0] + c[1] * refVec[1] + c[2] * refVec[2], -1.0, 1.0);
      const deg = (Math.acos(dot) * 180) / Math.PI;
      if (deg >= minDeg && deg <= maxDeg) {
        out.push({ cid, deg });
      }
    }
    out.sort((a, b) => a.deg - b.deg);
    return out.map((x) => x.cid);
  }

  /**
   * Pick the closest visible Planet, Moon, Satellite, or Individual Star near cursor (mx, my).
   */
  pickAtScreen(mx, my, vw, vh, aspect) {
    // 1. Check Planets, Moon & Live Satellites first (priority!)
    let bestBody = null;
    let bestBodyDist = 26;
    for (const b of this.renderBodies) {
      if (b.alpha <= 0.12) continue;
      const px = ((b.x / aspect) * 0.5 + 0.5) * vw;
      const py = (0.5 - b.y * 0.5) * vh;
      const hitR = Math.max(18, b.pxSize * 0.72);
      const d = Math.hypot(px - mx, py - my);
      if (d < hitR && d < bestBodyDist) {
        bestBodyDist = d;
        bestBody = { ...b.meta, px, py };
      }
    }
    if (bestBody) {
      this.hoveredStarIdx = -1;
      this.hoveredBodyId = bestBody.id || bestBody.name;
      return bestBody;
    }
    this.hoveredBodyId = "";

    // 2. Check all 767 named IAU constellation stars
    let bestIdx = -1;
    let bestScore = Infinity;
    const maxRadiusPx = 18;
    for (let i = 0; i < this.count; i++) {
      const m = this.meta[i];
      if (!m || this._starVis[i] <= 0.12) continue;
      const px = ((this.x[i] / aspect) * 0.5 + 0.5) * vw;
      const py = (0.5 - this.y[i] * 0.5) * vh;
      const dist = Math.hypot(px - mx, py - my);
      if (dist > maxRadiusPx) continue;
      const score = dist - (this.isPrimary[i] ? 2.0 : 0.0);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    this.hoveredStarIdx = bestIdx;
    if (bestIdx < 0) return null;
    const px = ((this.x[bestIdx] / aspect) * 0.5 + 0.5) * vw;
    const py = (0.5 - this.y[bestIdx] * 0.5) * vh;
    return { idx: bestIdx, px, py, ...this.meta[bestIdx] };
  }

  setPalette(pal) {
    if (!pal) return;
    for (let k = 0; k < 3; k++) {
      if (pal.a) this.targetPalette.a[k] = pal.a[k] * 0.68;
      if (pal.b) this.targetPalette.b[k] = pal.b[k] * 0.72;
      if (pal.c) this.targetPalette.c[k] = pal.c[k] * 0.80;
      if (pal.starTint) this.targetPalette.starTint[k] = pal.starTint[k];
      if (pal.lineTint) this.targetPalette.lineTint[k] = pal.lineTint[k];
    }
  }

  spawnMeteor(intensity = 1.0) {
    for (let i = 0; i < HEMI_MAX_METEORS; i++) {
      const m = this.meteors[i];
      if (!m.active) {
        const fromLeft = Math.random() > 0.35;
        m.active = true;
        m.x = fromLeft ? -1.1 + Math.random() * 0.8 : 0.3 + Math.random() * 0.8;
        m.y = 0.45 + Math.random() * 0.5;
        const speed = 1.45 + Math.random() * 0.9 * intensity;
        const angle = fromLeft ? (-0.32 - Math.random() * 0.28) : (-Math.PI + 0.32 + Math.random() * 0.28);
        m.vx = Math.cos(angle) * speed;
        m.vy = Math.sin(angle) * speed;
        m.life = 0;
        m.maxLife = 0.52 + Math.random() * 0.4;
        m.len = 0.14 + Math.random() * 0.12;
        return;
      }
    }
  }

  focusConstellation(cid, opts = {}) {
    const meta = this.constellationMeta.get(cid);
    if (!meta) return;

    const prevMeta = this.constellationMeta.get(this.focusedId);
    const prevStartVec = this.freeLook
      ? [...this.camForward]
      : (prevMeta ? prevMeta.centerVec : [...this.camForward]);

    this.focusedId = cid;
    this.focusedIdx = meta.idx;

    // Never yank the sky out of the user's hand while they are actively holding a drag!
    // Once released, the next lyric change smoothly brings them back to the active constellation
    // while preserving their chosen zoom level!
    if (!this.isDragging && (!opts.respectFreeLook || (!this.freeLook && !this.trackedTarget))) {
      this.freeLook = false;
      this.trackedTarget = null;
      this.velYaw = 0;
      this.velPitch = 0;
      const b = buildIdealBasis(meta.centerVec);
      this.targetForward = b.forward;
      this.targetUp = b.up;
      if (opts.instant) {
        this.camForward = b.forward;
        this.camRight = b.right;
        this.camUp = b.up;
        this.activeSlewRate = 2.4;
        this.domeTransition.active = false;
      } else {
        // Build a true 3D spherical great-circle dotted route connecting old view -> new constellation!
        const dot = clamp(
          prevStartVec[0] * meta.centerVec[0] +
          prevStartVec[1] * meta.centerVec[1] +
          prevStartVec[2] * meta.centerVec[2],
          -1.0,
          1.0
        );
        const angleRad = Math.acos(dot);
        // Adapt camera slew rate to the musical arrival budget so we arrive cleanly on beat 1!
        const arrivalSec = clamp(opts.arrivalSec ?? 0.92, 0.36, 1.55);
        const angleFactor = clamp(0.88 + (angleRad / Math.PI) * 0.45, 0.85, 1.35);
        this.activeSlewRate = clamp((2.35 / arrivalSec) * angleFactor, 2.0, 5.4);

        if (angleRad > 0.08) {
          const steps = Math.max(24, Math.min(72, Math.round(angleRad * 34)));
          const samples = [];
          for (let k = 0; k <= steps; k++) {
            samples.push(slerpUnitVec(prevStartVec, meta.centerVec, k / steps));
          }
          this.domeTransition.active = true;
          this.domeTransition.samples = samples;
          this.domeTransition.progress = 0.0;
          this.domeTransition.alpha = 0.92;
          this.domeTransition.speed = clamp(1.38 / arrivalSec, 1.5, 4.4) * this.transitionSpeedMul;
        }
      }
    }

    const data = CONSTELLATIONS[cid];
    if (data && data.palette && !opts.keepPalette) {
      this.setPalette(data.palette);
    }

    // Start on a varied highlight star when focusing a new constellation (never stuck on 0 -> 1!)
    this.tourCursor = meta.tourOrder.length > 0 ? Math.floor(Math.random() * meta.tourOrder.length) : 0;
    this.prevPrevSpotlightStar = this.prevSpotlightStar;
    this.prevSpotlightStar = this.spotlightStar;
    this.spotlightStar = meta.tourOrder.length > 0 ? meta.tourOrder[this.tourCursor] : -1;
    this.recentHops.length = 0;

    for (let i = 0; i < HEMI_MAX_EDGES; i++) {
      if (this.edgeOwner[i] === meta.idx && this.edges[i].active) {
        this.edges[i].pulse = 0.0;
        this.edges[i].pulseSpeed = 2.4 + Math.random() * 0.5;
      }
    }

    if (opts.meteor || Math.random() < 0.28) {
      this.spawnMeteor(0.95);
    }
  }

  advanceWordStar(word = "", intensity = 1.0, resetTour = false) {
    const meta = this.constellationMeta.get(this.focusedId);
    if (!meta || !meta.tourOrder.length) return -1;

    const tour = meta.tourOrder;
    const prevStar = this.spotlightStar;
    const prevPrevStar = this.prevPrevSpotlightStar;

    if (resetTour) {
      this.tourCursor = Math.floor(Math.random() * tour.length);
    } else {
      this.tourCursor = (this.tourCursor + 1) % tour.length;
      if (this.tourCursor === 0 && tour.length >= 4) {
        for (let i = tour.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = tour[i];
          tour[i] = tour[j];
          tour[j] = tmp;
        }
      }
    }

    let nextStar = tour[this.tourCursor];
    // Prevent A -> B -> A ping-pong whenever the constellation has 3+ stars!
    if (tour.length >= 3 && (nextStar === prevStar || nextStar === prevPrevStar)) {
      for (let step = 1; step < tour.length; step++) {
        const idx = (this.tourCursor + step) % tour.length;
        const cand = tour[idx];
        if (cand !== prevStar && cand !== prevPrevStar) {
          this.tourCursor = idx;
          nextStar = cand;
          break;
        }
      }
    }

    this.prevPrevSpotlightStar = prevStar;
    this.prevSpotlightStar = prevStar;
    this.spotlightStar = nextStar;
    this.spotlightFlash = 1.0;

    this.flare[nextStar] = Math.max(this.flare[nextStar], 0.78 * intensity);

    if (prevStar >= 0 && prevStar !== nextStar) {
      this.starHop.active = true;
      this.starHop.fromStar = prevStar;
      this.starHop.toStar = nextStar;
      this.starHop.progress = 0.0;
      this.starHop.speed = 5.4 * this.transitionSpeedMul;
      this.starHop.alpha = 0.65;
    }

    // Only pulse connected constellation lines when music has energy/drive (keep calm songs serene!)
    if (this.songIntensity >= 0.26) {
      for (let i = 0; i < HEMI_MAX_EDGES; i++) {
        const e = this.edges[i];
        if (e.active && (e.a === nextStar || e.b === nextStar)) {
          e.pulse = 0.0;
          e.pulseSpeed = 2.4 + this.songIntensity * 0.8 + Math.random() * 0.4;
        }
      }
    }

    return nextStar;
  }

  getStarPosition(starIdx) {
    if (starIdx < 0 || starIdx >= this.count) return null;
    if (this._starVis[starIdx] <= 0.08) return null;
    return {
      x: this.x[starIdx],
      y: this.y[starIdx],
      tx: this.x[starIdx],
      ty: this.y[starIdx],
      flare: this.flare[starIdx],
    };
  }

  /**
   * Zero-drop lyric anchor for Hemisphere Dome Mode:
   * - If the target star is clearly in view inside the viewport, anchors right beside it!
   * - If the dome is still mid-turn (star momentarily behind horizon or off-edge),
   *   smoothly floats the lyric along the visible leading edge of the dotted path
   *   (or soft center sky) and hands off seamlessly to the star the instant it enters view!
   */
  getLyricAnchorPosition(starIdx, aspect = 1.77) {
    if (starIdx >= 0 && starIdx < this.count && this._starVis[starIdx] > 0.14) {
      const x = this.x[starIdx];
      const y = this.y[starIdx];
      if (Math.abs(x) <= aspect * 0.90 && Math.abs(y) <= 0.86) {
        return { x, y, tx: x, ty: y, flare: this.flare[starIdx], onStar: true };
      }
    }
    // Star is mid-flight outside the dome view -> anchor cleanly near visible leading tip of dotted arc!
    const segs = this.transitionDotSegs;
    if (segs && segs.length >= 6) {
      const lx = segs[segs.length - 3];
      const ly = segs[segs.length - 2];
      const cx = clamp(lx, -aspect * 0.62, aspect * 0.62);
      const cy = clamp(ly, -0.52, 0.56);
      return { x: cx, y: cy, tx: cx, ty: cy, flare: 0.4, onStar: false };
    }
    return { x: 0.0, y: 0.08, tx: 0.0, ty: 0.08, flare: 0.3, onStar: false };
  }

  _projectVec3(px3, py3, pz3, fx, fy, fz, rx, ry, rz, ux, uy, uz, domeScale) {
    const cz = px3 * fx + py3 * fy + pz3 * fz;
    const vis = clamp((cz - 0.02) / 0.28, 0.0, 1.0);
    if (vis <= 0.001) return { vis: 0, x: 9, y: 9, theta: 2.0 };
    const cx = px3 * rx + py3 * ry + pz3 * rz;
    const cy = px3 * ux + py3 * uy + pz3 * uz;
    const theta = Math.acos(clamp(cz, -1.0, 1.0));
    const sinT = Math.hypot(cx, cy);
    const rProj = (theta / (Math.PI * 0.5)) * domeScale;
    const x = (sinT > 1e-6 ? (cx / sinT) * rProj : 0.0) + this.domeShakeX;
    const y = (sinT > 1e-6 ? (cy / sinT) * rProj : 0.0) + this.domeShakeY;
    return { vis, x, y, theta };
  }

  step(dt, audio = null, isPaused = false) {
    const safeDt = clamp(dt, 0.001, 0.05);
    if (!isPaused) {
      this.time += safeDt;
      this._pausedWallMs = null;
    } else if (this._pausedWallMs == null) {
      this._pausedWallMs = Date.now();
    }

    const nowWallMs = isPaused ? this._pausedWallMs : Date.now();
    // Refresh Moon & Planet J2000 positions once per minute (always live when not paused!)
    if (!isPaused && nowWallMs - this._lastPlanetRefresh > 60_000) {
      this._lastPlanetRefresh = nowWallMs;
      this.solarBodies = computeSolarSystemBodies(new Date(nowWallMs));
    }

    const sub = (!isPaused && audio) ? audio.sub : 0;
    const bass = (!isPaused && audio) ? audio.bass : 0;
    const mid = (!isPaused && audio) ? audio.mid : 0;
    const high = (!isPaused && audio) ? audio.high : 0;
    const beat = (!isPaused && audio) ? audio.beat : 0;
    const kick = (!isPaused && audio) ? (audio.kick || 0) : 0;
    const snare = (!isPaused && audio) ? (audio.snare || 0) : 0;
    const energy = (!isPaused && audio) ? audio.energy : 0;
    const glowStr = this.musicGlowStrength;

    const pBlend = 1.0 - Math.exp(-safeDt * 1.4);
    for (let k = 0; k < 3; k++) {
      this.palette.a[k] += (this.targetPalette.a[k] - this.palette.a[k]) * pBlend;
      this.palette.b[k] += (this.targetPalette.b[k] - this.palette.b[k]) * pBlend;
      this.palette.c[k] += (this.targetPalette.c[k] - this.palette.c[k]) * pBlend;
      this.palette.starTint[k] += (this.targetPalette.starTint[k] - this.palette.starTint[k]) * pBlend;
      this.palette.lineTint[k] += (this.targetPalette.lineTint[k] - this.palette.lineTint[k]) * pBlend;
    }

    this.zoom += (this.targetZoom - this.zoom) * (1.0 - Math.exp(-safeDt * 10.0));

    if (this.freeLook) {
      if (Math.abs(this.velYaw) > 0.0004 || Math.abs(this.velPitch) > 0.0004) {
        this._rotateCameraFrame(this.velYaw * safeDt, this.velPitch * safeDt);
        const damp = Math.exp(-safeDt * 5.4);
        this.velYaw *= damp;
        this.velPitch *= damp;
      }
      this.hoveredCenterId = this.getCenteredConstellationId();
    } else if (this.trackedTarget) {
      // Live Lock-On Tracking: continuously follow moving satellites, planets, Sun, Moon, or deep-sky targets!
      const liveVec = this._resolveTargetVec3(this.trackedTarget, nowWallMs);
      if (liveVec) {
        const b = buildIdealBasis(liveVec);
        this.targetForward = b.forward;
        this.targetUp = b.up;
      }
      const slewRate = (this.trackedTarget.kind === "satellite" ? 5.2 : 3.4) * this.transitionSpeedMul;
      const a = 1.0 - Math.exp(-safeDt * slewRate);
      this.camForward = [
        this.camForward[0] + (this.targetForward[0] - this.camForward[0]) * a,
        this.camForward[1] + (this.targetForward[1] - this.camForward[1]) * a,
        this.camForward[2] + (this.targetForward[2] - this.camForward[2]) * a,
      ];
      this.camUp = [
        this.camUp[0] + (this.targetUp[0] - this.camUp[0]) * a,
        this.camUp[1] + (this.targetUp[1] - this.camUp[1]) * a,
        this.camUp[2] + (this.targetUp[2] - this.camUp[2]) * a,
      ];
      this._orthonormalizeCamera();
      this.hoveredCenterId = this.getCenteredConstellationId();
    } else {
      const slewRate = (this.activeSlewRate || 2.4) * this.transitionSpeedMul;
      const a = 1.0 - Math.exp(-safeDt * slewRate);
      // Gently relax adaptive slew back toward serene baseline once settled
      this.activeSlewRate += (2.4 - this.activeSlewRate) * (1.0 - Math.exp(-safeDt * 1.4));
      if (!isPaused) {
        const pumpDrift = clamp((this.songIntensity - 0.16) / 0.65, 0.0, 1.0);
        const sidereal = (0.004 + pumpDrift * 0.011 + bass * pumpDrift * 0.010) * safeDt;
        this.targetForward = rotateAroundAxis(
          this.targetForward[0], this.targetForward[1], this.targetForward[2],
          0, 1, 0, sidereal
        );
        this.targetUp = rotateAroundAxis(
          this.targetUp[0], this.targetUp[1], this.targetUp[2],
          0, 1, 0, sidereal
        );
      }

      this.camForward = [
        this.camForward[0] + (this.targetForward[0] - this.camForward[0]) * a,
        this.camForward[1] + (this.targetForward[1] - this.camForward[1]) * a,
        this.camForward[2] + (this.targetForward[2] - this.camForward[2]) * a,
      ];
      this.camUp = [
        this.camUp[0] + (this.targetUp[0] - this.camUp[0]) * a,
        this.camUp[1] + (this.targetUp[1] - this.camUp[1]) * a,
        this.camUp[2] + (this.targetUp[2] - this.camUp[2]) * a,
      ];
      this._orthonormalizeCamera();
      this.hoveredCenterId = this.focusedId;
    }

    // Detect exact real drum onset — isolate PURE low-frequency bass/kick (22..118 Hz) for the 3D dome!
    const isNewBeat = !isPaused && audio && audio.beat_seq > 0 && audio.beat_seq !== this._lastBeatSeq;
    const lowEnergy = clamp(sub * 0.72 + bass * 0.56, 0.0, 1.0);
    const bassWeight = clamp(Math.max(kick * 1.18, sub * 1.32, bass * 1.12), 0.0, 1.0);

    if (isNewBeat) {
      this._lastBeatSeq = audio.beat_seq;
      const isBassKick = audio.beat_kind === 1 || kick > 0.20;
      const hasRealBass = lowEnergy > 0.14;
      const hitStr = clamp(Math.max(beat, kick, snare) * 1.32, 0.52, 1.0);
      // Stars & focused constellation lines stay crisp on both kicks & snares
      this.beatPunch = Math.max(this.beatPunch, hitStr);
      this.beatBlink = Math.max(this.beatBlink, hitStr);

      // Whole-dome shake, vibration, beat-zoom & shockwaves fire at 100% on bass kicks and 68% on full-kit beats with bass,
      // while staying 0% completely chill on pure vocals/snares with no low-end bass!
      if (isBassKick || hasRealBass) {
        const bassScale = isBassKick ? 1.0 : 0.68;
        const lowHit = clamp(Math.max(kick * 1.35, lowEnergy * 1.25, beat * 0.95 * bassScale), 0.45, 1.0) * bassScale;
        this.kickPunch = Math.max(this.kickPunch, lowHit);
        this.beatActivity = clamp(this.beatActivity + 0.42 * lowHit, 0.0, 1.0);
        const effPump = clamp(Math.max(this.songIntensity, this.beatActivity, lowHit * 0.92), 0.0, 1.0);

        // 1. Silky, subtle 3D Dome Bass-Zoom Breath
        const zoomGain = (0.14 + 0.86 * effPump) * Math.max(0.45, bassWeight) * bassScale * (0.40 + 0.60 * glowStr);
        this.domeZoomVel += zoomGain * 0.45;
        this.domeKick = Math.max(this.domeKick, clamp(Math.max(0.45, bassWeight) * bassScale * (0.22 + 0.78 * effPump), 0.0, 0.85));

        // 2. Whisper-soft critically damped bass micro-kick (~1px tactile feel, zero jitter!)
        if (!this.isDragging && isBassKick) {
          this._shakeAngle += 2.39996;
          const shakeStr = (0.18 + 0.82 * effPump) * Math.max(0.45, bassWeight) * (0.40 + 0.60 * glowStr);
          this._shakeVelX += Math.cos(this._shakeAngle) * shakeStr * 0.045;
          this._shakeVelY += Math.sin(this._shakeAngle) * shakeStr * 0.045;
        }
      }
    }

    const pump = clamp(Math.max((this.songIntensity - 0.12) / 0.58, this.beatActivity * 0.96), 0.0, 1.0);

    if (!isPaused) {
      // Sustained low-frequency 808 / bass drops also keep bassActivity awake (zero vocal/mid bleed!)
      if (lowEnergy > 0.28) {
        this.beatActivity = Math.max(this.beatActivity, clamp((lowEnergy - 0.24) * 1.45, 0.0, 0.92));
      }
      this.beatActivity *= Math.exp(-safeDt * 0.54);

      // Gentle bass swell + calm oceanic tide for the 3D dome spring target
      const calmTide = Math.sin(this.time * 0.85) * 0.005 * (1.0 - pump * 0.75);
      const bassSwell = (sub * 0.014 + bass * 0.010) * (0.25 + 0.75 * pump) * (0.40 + 0.60 * glowStr);
      const targetZoomOff = calmTide + bassSwell;
      const zAcc = (targetZoomOff - this.domeZoomOffset) * 72.0 - this.domeZoomVel * 16.0;
      this.domeZoomVel += zAcc * safeDt;
      this.domeZoomOffset = clamp(this.domeZoomOffset + this.domeZoomVel * safeDt, -0.010, 0.036);

      // Whisper-soft critically damped bass micro-kick (no twirl/roll, zero shockwave rings!)
      this.domeRoll = 0.0;
      this.domeRollVel = 0.0;
      this.domeWave1Pos = 2.0;
      this.domeWave1Amp = 0.0;
      this.domeWave2Pos = 2.0;
      this.domeWave2Amp = 0.0;
      if (this.isDragging) {
        const sd = Math.exp(-safeDt * 18.0);
        this._shakePosX *= sd;
        this._shakePosY *= sd;
        this._shakeVelX = 0.0;
        this._shakeVelY = 0.0;
        this.domeShakeX = this._shakePosX;
        this.domeShakeY = this._shakePosY;
      } else {
        const sxAcc = -this._shakePosX * 260.0 - this._shakeVelX * 32.0;
        const syAcc = -this._shakePosY * 260.0 - this._shakeVelY * 32.0;
        this._shakeVelX += sxAcc * safeDt;
        this._shakeVelY += syAcc * safeDt;
        this._shakePosX = clamp(this._shakePosX + this._shakeVelX * safeDt, -0.0020, 0.0020);
        this._shakePosY = clamp(this._shakePosY + this._shakeVelY * safeDt, -0.0020, 0.0020);

        this.domeShakeX = this._shakePosX;
        this.domeShakeY = this._shakePosY;
      }

      // Keep sustained dome glow subtle & locked to low-frequency sub/bass
      const bassFloor = clamp((sub * 0.65 + bass * 0.48) * (0.20 + 0.80 * pump), 0.0, 0.65);
      this.domeKick = Math.max(this.domeKick * Math.exp(-safeDt * 6.5), bassFloor * 0.42);
    }

    // Build rolled 3D projection axes around camForward so stars, constellations, planets & Milky Way stay in 100% lockstep!
    const [fx, fy, fz] = this.camForward;
    const [crx, cry, crz] = this.camRight;
    const [cux, cuy, cuz] = this.camUp;
    let rx = crx, ry = cry, rz = crz;
    let ux = cux, uy = cuy, uz = cuz;
    if (Math.abs(this.domeRoll) > 1e-5) {
      const cR = Math.cos(this.domeRoll);
      const sR = Math.sin(this.domeRoll);
      rx = crx * cR + cux * sR;
      ry = cry * cR + cuy * sR;
      rz = crz * cR + cuz * sR;
      ux = cux * cR - crx * sR;
      uy = cuy * cR - cry * sR;
      uz = cuz * cR - crz * sR;
    }
    this.renderRight[0] = rx; this.renderRight[1] = ry; this.renderRight[2] = rz;
    this.renderUp[0] = ux; this.renderUp[1] = uy; this.renderUp[2] = uz;

    if (!isPaused) {
      const targetBreath = 1.0 + this.kickPunch * 0.014 * glowStr + bass * 0.008 * glowStr;
      this.breathScale += (targetBreath - this.breathScale) * (1.0 - Math.exp(-safeDt * 12.0));
    }

    if (!isPaused) {
      if (this.starHop.active) {
        this.starHop.progress += this.starHop.speed * safeDt;
        if (this.starHop.progress >= 1.0) {
          this.starHop.alpha *= Math.exp(-safeDt * 7.5);
          if (this.starHop.alpha < 0.02) this.starHop.active = false;
        }
      }

      // Rolling music intensity (0 = calm ballad/acoustic, 1 = rock/bass/energetic — works at ANY volume!)
      const rawDrive = clamp(
        Math.max(
          (energy * 1.18 + bass * 1.15 + sub * 0.80 + beat * 0.95 - 0.30) * 1.75,
          this.beatActivity * 1.05
        ),
        0.0,
        1.0
      );
      const driveRate = rawDrive > this.songIntensity ? 3.2 : 0.60;
      this.songIntensity += (rawDrive - this.songIntensity) * (1.0 - Math.exp(-safeDt * driveRate));

      // Crisp beat-locked punch & blink envelopes (snap on kick/snare, relax cleanly before next beat!)
      if (beat > 0.25) {
        this.beatBlink = Math.max(this.beatBlink, Math.min(1.0, beat * 1.25));
      }
      this.beatBlink *= Math.exp(-safeDt * 8.5);
      this.beatPunch *= Math.exp(-safeDt * 9.5);
      this.kickPunch *= Math.exp(-safeDt * 8.5);
      this.spotlightFlash *= Math.exp(-safeDt * 4.2);

      // Beat-Locked Constellation Line Wave: fires immediately on EVERY real drum onset (even during intros!)
      this._rockPulseCooldown = Math.max(0, this._rockPulseCooldown - safeDt);
      if ((isNewBeat || (this.songIntensity > 0.28 && beat > 0.42)) && this._rockPulseCooldown <= 0) {
        this._rockPulseCooldown = 0.17;
        const activeId = this.freeLook ? this.hoveredCenterId : this.focusedId;
        const targetOwner = this.constellationMeta.get(activeId)?.idx ?? this.focusedIdx;
        for (let k = 0; k < HEMI_MAX_EDGES; k++) {
          const ed = this.edges[k];
          if (ed.active && this.edgeOwner[k] === targetOwner) {
            ed.pulse = 0.0;
            ed.pulseSpeed = 3.0 + this.beatPunch * 1.2 + Math.random() * 0.25;
          }
        }
      }

      if (isNewBeat && kick > 0.68 && Math.random() < 0.22) {
        this.spawnMeteor(0.90 + kick * 0.30);
      }
    } else {
      this.beatBlink *= Math.exp(-safeDt * 6.0);
      this.beatPunch *= Math.exp(-safeDt * 8.0);
      this.kickPunch *= Math.exp(-safeDt * 8.0);
    }

    const bandValues = [sub * 0.6 + bass * 0.4, mid, high, energy];

    const domeScale = 1.12 * this.zoom * (1.0 + this.domeZoomOffset) * this.breathScale;
    this.domeScale = domeScale;
    const starVis = this._starVis;
    const starTheta = this._starTheta;
    const w1Pos = this.domeWave1Pos;
    const w1Amp = this.domeWave1Amp;
    const w2Pos = this.domeWave2Pos;
    const w2Amp = this.domeWave2Amp;
    const hasWaves = w1Amp > 0.008 || w2Amp > 0.008;
    const activeHighlightIdx = this.freeLook
      ? (this.constellationMeta.get(this.hoveredCenterId)?.idx ?? this.focusedIdx)
      : this.focusedIdx;
    const zoomSizeMul = 0.88 + Math.min(0.42, (this.zoom - 1.0) * 0.18);

    // 1. Project all 2,117 REAL stars (767 IAU + 1,350 real Hipparcos sky stars!)
    for (let i = 0; i < this.count; i++) {
      const proj = this._projectVec3(
        this.sx3[i], this.sy3[i], this.sz3[i],
        fx, fy, fz, rx, ry, rz, ux, uy, uz, domeScale
      );
      const vis = proj.vis;
      starVis[i] = vis;
      starTheta[i] = proj.theta;

      if (vis <= 0.001) {
        this.x[i] = 9.0;
        this.y[i] = 9.0;
        this.bright[i] = 0.0;
        this.size[i] = 0.0;
        this.flare[i] = 0.0;
        this.musicGlow[i] = 0.0;
        continue;
      }

      this.x[i] = proj.x;
      this.y[i] = proj.y;

      // 3D Spherical Shockwave hit at this star's true angular distance from dome center!
      let waveHit = 0.0;
      if (hasWaves) {
        if (w1Amp > 0.008) {
          const d1 = (proj.theta - w1Pos) * 6.5;
          if (d1 > -2.6 && d1 < 2.6) waveHit += Math.exp(-d1 * d1) * w1Amp;
        }
        if (w2Amp > 0.008) {
          const d2 = (proj.theta - w2Pos) * 6.5;
          if (d2 > -2.6 && d2 < 2.6) waveHit += Math.exp(-d2 * d2) * w2Amp;
        }
        if (waveHit > 1.2) waveHit = 1.2;
      }

      const owner = this.starOwner[i];
      if (owner === -1) {
        // Real Hipparcos 3D sky background star — calm & restrained subtle bass shimmer
        const bgBeat = this.domeKick * 0.12 * pump * (0.45 + 0.55 * glowStr);
        this.size[i] = this.baseSize[i] * (0.75 + 0.25 * vis) * (1.0 + bgBeat * 0.35);
        this.bright[i] = this.baseBright[i] * (0.25 + 0.75 * vis) * (1.0 + bgBeat * 0.45);
        this.role[i] = 0;
        this.musicGlow[i] = 0.0;
        this.flare[i] = 0.0;
        continue;
      }

      const isHovered = i === this.hoveredStarIdx;
      const isFocused = owner === activeHighlightIdx;
      const isSongStar = owner === this.focusedIdx;
      const isSpotlight = i === this.spotlightStar;
      const focusMul = this.viewingMode
        ? (isFocused ? 1.14 : 0.76)
        : (isFocused ? 1.16 : 0.46);
      const horizonDim = 0.22 + 0.78 * Math.pow(vis, 0.85);
      const bVal = bandValues[this.band[i]] || 0;
      const phWave = 0.65 + 0.35 * Math.sin(this.time * 2.6 + this.phase[i]);

      // Restrained musical round-star pulse (clear beat feel without overwhelming nearby lyrics!)
      const intensityScale = 0.30 + this.songIntensity * 0.55;
      const musicSizePulse = isFocused
        ? (1.0 + (this.beatPunch * 0.28 + this.kickPunch * 0.14 + bVal * 0.16 * intensityScale) * glowStr)
        : (1.0 + (this.domeKick * 0.12 * pump + bVal * 0.04) * (0.45 + 0.55 * glowStr));
      const breathWave = isSpotlight ? (0.5 + 0.5 * Math.sin(this.time * (3.6 + this.songIntensity * 2.0))) : 0.0;
      const spotSizeMul = isSpotlight
        ? (1.22 + breathWave * 0.10 + this.spotlightFlash * 0.16 + this.beatPunch * 0.18 * glowStr)
        : 1.0;
      const spotBrightMul = isSpotlight
        ? (1.18 + breathWave * 0.10 + this.spotlightFlash * 0.16 + this.beatPunch * 0.16 * glowStr)
        : (isFocused
            ? (1.0 + this.beatPunch * 0.16 * glowStr)
            : (1.0 + this.domeKick * 0.14 * pump * (0.45 + 0.55 * glowStr)));

      // Fuller round star proportions that breathe & pulse cleanly with the music!
      this.size[i] = this.baseSize[i] * (isFocused ? 1.24 : 0.96) * (0.80 + 0.20 * vis) * zoomSizeMul * musicSizePulse * spotSizeMul * (isHovered ? 1.24 : 1.0);
      this.bright[i] = this.baseBright[i] * focusMul * horizonDim * spotBrightMul * (isHovered ? 1.24 : 1.0);
      this.role[i] = isSpotlight ? 2 : (isFocused ? (this.isPrimary[i] ? 2 : 1) : ((this.isPrimary[i] && this.baseSize[i] > 4.6) || waveHit > 0.38 ? 1 : 0));

      const roleMult = isSongStar ? 0.52 : (isFocused ? 0.32 : 0.08);
      const targetMG = clamp(((bVal * 0.65 + beat * 0.35) * phWave * roleMult + waveHit * 0.42) * glowStr * vis, 0.0, 0.78);
      this.musicGlow[i] += (targetMG - this.musicGlow[i]) * (1.0 - Math.exp(-safeDt * 12.0));

      if (isSpotlight) {
        // Refined, compact round spotlight glow that breathes gently with the beat (never oversized!)
        const rhythm = 0.42 + breathWave * 0.16 + this.spotlightFlash * 0.28 + this.beatBlink * 0.36 * glowStr;
        this.flare[i] = Math.max(this.flare[i] * Math.exp(-safeDt * 4.8), rhythm * vis);
      } else if (isHovered) {
        this.flare[i] = Math.max(this.flare[i], 0.45);
      } else {
        this.flare[i] *= Math.exp(-safeDt * 4.5);
        if (isFocused && this.isPrimary[i] && beat > 0.45) {
          this.flare[i] = Math.max(this.flare[i], beat * 0.18 * glowStr * vis);
        }
      }
    }

    // 2. Project Subtle Astronomical Ecliptic Line (Path of Sun, Moon & Planets)
    this.eclipticSegs.length = 0;
    if (this.showEcliptic) {
      const ev = this.eclipticVecs;
      const nEcl = ev.length;
      const eclAlphaBase = (this.viewingMode ? 0.16 : 0.095) + this.domeKick * (0.04 + 0.07 * pump) * glowStr;
      let prevP = null;
      for (let k = 0; k <= nEcl; k++) {
        const v = ev[k % nEcl];
        const p = this._projectVec3(v[0], v[1], v[2], fx, fy, fz, rx, ry, rz, ux, uy, uz, domeScale);
        if (prevP && prevP.vis > 0.04 && p.vis > 0.04) {
          if (Math.hypot(p.x - prevP.x, p.y - prevP.y) < 0.65) {
            this.eclipticSegs.push(
              prevP.x, prevP.y, prevP.vis * eclAlphaBase,
              p.x, p.y, p.vis * eclAlphaBase
            );
          }
        }
        prevP = p;
      }
    }

    // 2b. Project 3D Dotted Great-Circle Transition Arc connecting constellation changes!
    this.transitionDotSegs.length = 0;
    if (this.domeTransition.active && this.domeTransition.samples.length >= 4) {
      const dtArc = this.domeTransition;
      if (!isPaused) {
        if (dtArc.progress < 1.0) {
          dtArc.progress = Math.min(1.0, dtArc.progress + dtArc.speed * safeDt);
        } else {
          dtArc.alpha *= Math.exp(-safeDt * 1.15);
          if (dtArc.alpha < 0.02) dtArc.active = false;
        }
      }

      if (dtArc.active) {
        const samples = dtArc.samples;
        const nPts = samples.length;
        const maxIdx = Math.max(2, Math.floor((nPts - 1) * dtArc.progress));
        // Emit crisp alternating dotted/dashed segments along the true 3D spherical great circle!
        for (let k = 0; k < maxIdx; k += 2) {
          const v0 = samples[k];
          const v1 = samples[Math.min(k + 1, nPts - 1)];
          const p0 = this._projectVec3(v0[0], v0[1], v0[2], fx, fy, fz, rx, ry, rz, ux, uy, uz, domeScale);
          const p1 = this._projectVec3(v1[0], v1[1], v1[2], fx, fy, fz, rx, ry, rz, ux, uy, uz, domeScale);
          if (p0.vis <= 0.05 || p1.vis <= 0.05) continue;
          if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 0.35) continue;
          const frac = k / Math.max(1, maxIdx);
          // Graceful fade from start + subtle glowing leading tip racing toward destination!
          const tipBoost = dtArc.progress < 1.0 ? (0.45 + 0.55 * Math.pow(frac, 2.2)) : (0.35 + 0.55 * Math.sin(frac * Math.PI));
          const segA = dtArc.alpha * 0.58 * tipBoost * Math.min(p0.vis, p1.vis);
          this.transitionDotSegs.push(p0.x, p0.y, segA, p1.x, p1.y, segA);
        }
      }
    }

    // 3. Project Deep-Sky Objects (21 Nebulae, Galaxies & Star Clusters) + Solar System + LIVE Satellites!
    this.renderBodies.length = 0;
    if (!isPaused) this._satTrailAccum += safeDt;
    const pushSatTrail = !isPaused && this._satTrailAccum >= 0.09;
    if (pushSatTrail) this._satTrailAccum = 0;

    // Nebulae/galaxies scale naturally with angular sky magnification
    const dsoZoomScale = 0.72 + Math.min(2.1, (this.zoom - 0.6) * 0.56);
    // Planets stay refined & harmonious at wide zoom (1.0x), and reveal full telescopic detail as you zoom in!
    const planetZoomScale = 0.66 + Math.min(2.25, Math.max(0, this.zoom - 0.85) * 0.68);

    // 3a. Deep-Sky Nebulae, Galaxies & Star Clusters (rendered first so planets/satellites float cleanly above!)
    if (this.showDeepSky) {
      const dsoBeatScale = 1.0 + this.domeKick * (0.03 + 0.08 * pump) * glowStr;
      const dsoBeatAlpha = 1.0 + this.domeKick * (0.06 + 0.14 * pump) * glowStr;
      for (const dso of DEEP_SKY_CATALOG) {
        const [dx3, dy3, dz3] = raDecDegToUnitVec(dso.ra, dso.dec);
        const proj = this._projectVec3(dx3, dy3, dz3, fx, fy, fz, rx, ry, rz, ux, uy, uz, domeScale);
        if (proj.vis <= 0.04) continue;
        const isHov = this.hoveredBodyId === dso.id;
        this.renderBodies.push({
          x: proj.x,
          y: proj.y,
          pxSize: dso.pxRadius * dsoZoomScale * dsoBeatScale * (isHov ? 1.16 : 1.0),
          bodyType: dso.bodyType,
          phaseParam: dso.variant,
          angle: dso.angle,
          alpha: clamp(proj.vis * (isHov ? 1.0 : 0.88) * dsoBeatAlpha, 0.0, 1.0),
          meta: {
            id: dso.id,
            kind: dso.kind,
            name: dso.name,
            desig: dso.desig,
            constellation: formatRaDec(dso.ra, dso.dec),
            subtitle: dso.subtitle,
          },
        });
      }
    }

    if (this.showPlanetsAndSats) {

      // Sun + Moon + 7 Planets (real J2000 positions, optically harmonized with stars & nebulae!)
      for (const body of this.solarBodies) {
        const [bx3, by3, bz3] = raDecDegToUnitVec(body.ra, body.dec);
        const proj = this._projectVec3(bx3, by3, bz3, fx, fy, fz, rx, ry, rz, ux, uy, uz, domeScale);
        if (proj.vis <= 0.04) continue;
        const isHov = this.hoveredBodyId === body.id;
        const isTracked = this.trackedTarget && this.trackedTarget.id === body.id;
        const desig = body.kind === "sun" ? "LIVE SOLAR" : body.kind === "moon" ? "LIVE LUNAR" : "LIVE PLANET";
        this.renderBodies.push({
          x: proj.x,
          y: proj.y,
          pxSize: body.pxRadius * planetZoomScale * (isHov ? 1.24 : isTracked ? 1.14 : 1.0),
          bodyType: body.bodyType,
          phaseParam: body.bodyType === 13 ? this.time : (body.phaseParam || 0.4),
          angle: 0.46, // Subtle axial tilt (Saturn rings 26.7°!)
          alpha: proj.vis * (isHov || isTracked ? 1.0 : 0.92),
          meta: {
            id: body.id,
            kind: body.kind,
            name: body.name,
            desig,
            constellation: formatRaDec(body.ra, body.dec),
            subtitle: body.subtitle,
          },
        });
      }

      // Live Real-Time NORAD Satellites (propagated to EXACT current UTC second!)
      for (let si = 0; si < this.satellites.length && si < MAX_RENDER_BODIES; si++) {
        const gp = this.satellites[si];
        const cur = propagateNoradSatellite(gp, nowWallMs);
        const proj = this._projectVec3(cur.x, cur.y, cur.z, fx, fy, fz, rx, ry, rz, ux, uy, uz, domeScale);

        if (proj.vis <= 0.04) {
          this.trailEnergy[si] = 0;
          continue;
        }

        // Compute screen-space travel heading so the miniature spacecraft aligns with its orbital track!
        const nextPos = propagateNoradSatellite(gp, nowWallMs + 4000);
        const projNext = this._projectVec3(nextPos.x, nextPos.y, nextPos.z, fx, fy, fz, rx, ry, rz, ux, uy, uz, domeScale);
        const heading = Math.atan2(projNext.y - proj.y, projNext.x - proj.x);

        const isHov = this.hoveredBodyId === `sat_${gp.catnr}`;
        const isTracked = this.trackedTarget && this.trackedTarget.catnr === gp.catnr;
        this.renderBodies.push({
          x: proj.x,
          y: proj.y,
          pxSize: (gp.catnr === 25544 ? 13.5 : 10.5) * clamp(planetZoomScale, 0.85, 1.85) * (isHov ? 1.30 : isTracked ? 1.20 : 1.0),
          bodyType: 8, // Refined sunlit solar-wing spacecraft shader
          phaseParam: this.time,
          angle: heading,
          alpha: proj.vis * (isHov || isTracked ? 1.0 : 0.90),
          meta: {
            id: `sat_${gp.catnr}`,
            catnr: gp.catnr,
            kind: "satellite",
            name: gp.name,
            desig: gp.live ? `NORAD ${gp.catnr} · LIVE` : `NORAD ${gp.catnr}`,
            constellation: `${formatRaDec(cur.ra, cur.dec)} · ${gp.inclination.toFixed(1)}°`,
            subtitle: `${gp.role || "LEO"} · ${gp.alt_km || 410} km · ${gp.vel_kms || 7.66} km/s`,
          },
        });

        // Subtle orbital track wake behind each satellite
        this.trailEnergy[si] = (isTracked ? 0.42 : 0.24) * proj.vis;
        if (pushSatTrail) {
          const base = si * HEMI_TRAIL_LEN;
          if (Math.hypot(this.trailX[base] - proj.x, this.trailY[base] - proj.y) > 0.25) {
            for (let t = 0; t < HEMI_TRAIL_LEN; t++) {
              this.trailX[base + t] = proj.x;
              this.trailY[base + t] = proj.y;
            }
          } else {
            for (let t = HEMI_TRAIL_LEN - 1; t > 0; t--) {
              this.trailX[base + t] = this.trailX[base + t - 1];
              this.trailY[base + t] = this.trailY[base + t - 1];
            }
            this.trailX[base] = proj.x;
            this.trailY[base] = proj.y;
          }
        }
      }
    }

    // 4. Update constellation filaments (Viewing Mode illuminates all 88 patterns cleanly!)
    for (let i = 0; i < HEMI_MAX_EDGES; i++) {
      const e = this.edges[i];
      if (!e.active) continue;
      const va = starVis[e.a];
      const vb = starVis[e.b];
      const vMin = Math.min(va, vb);
      if (vMin <= 0.05) {
        e.alpha = 0.0;
        continue;
      }

      const isFocusedEdge = this.edgeOwner[i] === activeHighlightIdx;
      const isLitEdge = (e.a === this.spotlightStar || e.b === this.spotlightStar);

      // Whole-dome shockwave illuminates surrounding constellations across the entire 3D vault as each beat ripples outward!
      let edgeWaveHit = 0.0;
      if (!isFocusedEdge && hasWaves) {
        const midT = (starTheta[e.a] + starTheta[e.b]) * 0.5;
        if (w1Amp > 0.008) {
          const d1 = (midT - w1Pos) * 5.8;
          if (d1 > -2.6 && d1 < 2.6) edgeWaveHit += Math.exp(-d1 * d1) * w1Amp;
        }
        if (w2Amp > 0.008) {
          const d2 = (midT - w2Pos) * 5.8;
          if (d2 > -2.6 && d2 < 2.6) edgeWaveHit += Math.exp(-d2 * d2) * w2Amp;
        }
      }

      // Calm tracks keep lines serene; beats give a refined, clean pulse without overpowering lyrics!
      const beatLinePunch = isFocusedEdge
        ? (this.beatPunch * 0.50 + this.kickPunch * 0.28 + this.songIntensity * bass * 0.14) * glowStr
        : (this.domeKick * 0.09 * pump) * (0.45 + 0.55 * glowStr);
      const steadyA = this.viewingMode
        ? (isFocusedEdge ? (0.44 + energy * 0.06 * glowStr) : (0.15 + energy * 0.02 * glowStr))
        : (isFocusedEdge
            ? (0.42 + energy * 0.05 * glowStr) * (isLitEdge ? 1.15 : 1.0)
            : (0.048 + energy * 0.010 * glowStr));
      const targetA = Math.min(0.92, (steadyA + beatLinePunch * (isFocusedEdge ? 0.48 : 0.35)) * vMin);
      const alphaRate = targetA > e.alpha ? 24.0 : 8.5;
      e.alpha += (targetA - e.alpha) * (1.0 - Math.exp(-safeDt * alphaRate));
      e.weight = isFocusedEdge
        ? ((isLitEdge ? 1.22 : 1.04) + beatLinePunch * 0.62)
        : (0.62 + beatLinePunch * 0.25);
      e.draw = 1.0;

      if (!isPaused && e.pulse >= 0) {
        e.pulse += e.pulseSpeed * safeDt;
        if (e.pulse > 1.35) e.pulse = -1;
      }
    }

    if (!isPaused) {
      for (let i = 0; i < HEMI_MAX_METEORS; i++) {
        const m = this.meteors[i];
        if (!m.active) continue;
        m.life += safeDt;
        m.x += m.vx * safeDt;
        m.y += m.vy * safeDt;
        if (m.life >= m.maxLife) m.active = false;
      }
    }

    // 5. Project visible constellation name labels onto the 3D celestial dome!
    this.constellationLabels.length = 0;
    for (const [cid, meta] of this.constellationMeta.entries()) {
      const c = meta.centerVec;
      const proj = this._projectVec3(c[0], c[1], c[2], fx, fy, fz, rx, ry, rz, ux, uy, uz, domeScale);
      if (proj.vis <= 0.14) continue;
      if (Math.abs(proj.x) > 1.95 || Math.abs(proj.y) > 1.05) continue;
      const isFocused = meta.idx === activeHighlightIdx;
      const baseAlpha = isFocused
        ? 0.84
        : (this.viewingMode ? 0.50 : 0.28);
      this.constellationLabels.push({
        cid,
        name: meta.name,
        sub: (isFocused || this.zoom >= 1.55) ? meta.en : "",
        x: proj.x,
        y: proj.y,
        alpha: proj.vis * baseAlpha,
        isFocused,
      });
    }

    // 6. Project toggleable bright proper star names (focused constellation + brightest 1st-mag stars!)
    this.starNameLabels.length = 0;
    const maxMagForBg = this.zoom >= 2.0 ? 2.8 : (this.zoom >= 1.45 ? 2.2 : 1.75);
    for (let i = 0; i < this.count; i++) {
      const m = this.meta[i];
      if (!m || !m.properName) continue;
      const vis = starVis[i];
      if (vis <= 0.24) continue;
      const isFocusedStar = this.starOwner[i] === activeHighlightIdx;
      if (!isFocusedStar && m.mag > maxMagForBg) continue;
      if (Math.abs(this.x[i]) > 1.92 || Math.abs(this.y[i]) > 0.98) continue;
      this.starNameLabels.push({
        id: `st_${i}`,
        name: m.properName,
        mag: m.mag,
        x: this.x[i],
        y: this.y[i],
        alpha: vis * (isFocusedStar ? (this.viewingMode ? 0.56 : 0.38) : (this.viewingMode ? 0.36 : 0.22)),
        isFocused: isFocusedStar,
      });
    }
    this.starNameLabels.sort((a, b) => (b.isFocused ? 1 : 0) - (a.isFocused ? 1 : 0) || a.mag - b.mag);
  }
}
