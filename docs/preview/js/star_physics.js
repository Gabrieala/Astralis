/**
 * Zero-Allocation Celestial Physics & Constellation Morph Choreography.
 *
 * - Individual stars glow dynamically with the music (each star reacts to its
 *   assigned audio frequency band: sub/bass/mid/high + beat).
 * - When words change, the spotlight smoothly glides from star to star along
 *   the constellation with a luminous traveling energy arc, keeping the active
 *   star brilliantly lit while the lyric appears right beside it.
 * - Between phrases/constellations, stars stay alive and flow along curved
 *   orbital Bezier arcs with staggered choreography and comet trails.
 */

import { spectralClassFromTemp } from "./celestial_objects.js";
import { getStarFunFact } from "./astronomy_facts.js";

export const MAX_STARS = 130;
export const TRAIL_LEN = 5;
export const MAX_EDGES = 180;
export const MAX_METEORS = 4;

function easeInOutQuart(t) {
  return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export class StarPhysics {
  constructor() {
    this.count = MAX_STARS;

    // Pre-allocated Structure-of-Arrays (SoA) for zero GC overhead
    this.x = new Float32Array(MAX_STARS);
    this.y = new Float32Array(MAX_STARS);
    this.sx = new Float32Array(MAX_STARS);
    this.sy = new Float32Array(MAX_STARS);
    this.cx = new Float32Array(MAX_STARS);
    this.cy = new Float32Array(MAX_STARS);
    this.tx = new Float32Array(MAX_STARS);
    this.ty = new Float32Array(MAX_STARS);

    this.elapsed = new Float32Array(MAX_STARS);
    this.delay = new Float32Array(MAX_STARS);
    this.duration = new Float32Array(MAX_STARS);

    this.size = new Float32Array(MAX_STARS);
    this.startSize = new Float32Array(MAX_STARS);
    this.targetSize = new Float32Array(MAX_STARS);

    this.bright = new Float32Array(MAX_STARS);
    this.startBright = new Float32Array(MAX_STARS);
    this.targetBright = new Float32Array(MAX_STARS);

    this.phase = new Float32Array(MAX_STARS);
    this.temp = new Float32Array(MAX_STARS);
    this.flare = new Float32Array(MAX_STARS);
    this.musicGlow = new Float32Array(MAX_STARS); // Per-star real-time music luminance
    this.band = new Uint8Array(MAX_STARS);        // 0=sub/bass, 1=mid, 2=high, 3=energy
    this.role = new Uint8Array(MAX_STARS);        // 0=companion halo, 1=constellation star, 2=primary anchor
    this.orbitAngle = new Float32Array(MAX_STARS);
    this.orbitRadius = new Float32Array(MAX_STARS);
    this.orbitSpeed = new Float32Array(MAX_STARS);

    // Comet trail ring buffer: [starIndex * TRAIL_LEN + slot]
    this.trailX = new Float32Array(MAX_STARS * TRAIL_LEN);
    this.trailY = new Float32Array(MAX_STARS * TRAIL_LEN);
    this.trailEnergy = new Float32Array(MAX_STARS);
    this._trailAccum = 0;

    // Living filament edges
    this.edges = [];
    for (let i = 0; i < MAX_EDGES; i++) {
      this.edges.push({
        active: false,
        a: 0,
        b: 0,
        draw: 0,
        retracting: false,
        delay: 0,
        speed: 1.5,
        alpha: 0,
        targetAlpha: 0.78,
        pulse: -1,
        pulseSpeed: 1.8,
        weight: 1.0,
      });
    }

    // Shooting stars / meteors pool
    this.meteors = [];
    for (let i = 0; i < MAX_METEORS; i++) {
      this.meteors.push({
        active: false,
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, len: 0.16,
      });
    }

    // Star-to-star spotlight transition arc (glows smoothly between spoken words!)
    this.starHop = {
      active: false,
      fromStar: -1,
      toStar: -1,
      progress: 1.0,
      speed: 2.6,
      alpha: 0.0,
    };

    // Active spotlight star tracking (for star-adjacent lyric labels!)
    this.activeAnchorStars = [];
    this.starTourOrder = [];
    this.tourCursor = 0;
    this.spotlightStar = -1;
    this.prevSpotlightStar = -1;
    this.prevPrevSpotlightStar = -1;
    this.constellationLabels = [];
    this.starNameLabels = [];
    this.recentHops = [];
    this._hopBendSign = 1.0;
    this.beatBlink = 0.0;
    this.beatPunch = 0.0;
    this.kickPunch = 0.0;
    this._lastBeatSeq = 0;
    this.spotlightFlash = 0.0;
    this.songIntensity = 0.0; // Rolling 0..1 music drive (0 = calm/ambient, 1 = rock/energetic!)
    this._rockPulseCooldown = 0.0;
    this._labelMeta = { cid: "orion", name: "Orion", sub: "The Hunter", cx: 0, topY: 0.55 };
    this.hoveredStarIdx = -1;
    this.meta = new Array(MAX_STARS).fill(null);

    // User-tunable intensities
    this.musicGlowStrength = 1.0;
    this.transitionSpeedMul = 1.0;

    // Global celestial motion & darker midnight palette
    this.time = 0;
    this.swirlSign = 1;
    this.globalAngle = 0;
    this.globalAngularVel = 0.01;
    this.breathScale = 1.0;
    this.wordRipple = 0.0;

    this.palette = {
      a: [0.018, 0.026, 0.075],
      b: [0.065, 0.055, 0.18],
      c: [0.22, 0.46, 0.86],
      starTint: [0.80, 0.90, 1.0],
      lineTint: [0.46, 0.74, 1.0],
    };
    this.targetPalette = {
      a: [...this.palette.a],
      b: [...this.palette.b],
      c: [...this.palette.c],
      starTint: [...this.palette.starTint],
      lineTint: [...this.palette.lineTint],
    };

    this._initStars();
  }

  _initStars() {
    for (let i = 0; i < MAX_STARS; i++) {
      const ang = (i / MAX_STARS) * Math.PI * 2 + (i % 7) * 0.37;
      const rad = 0.18 + Math.sqrt((i + 1) / MAX_STARS) * 0.72;
      const px = Math.cos(ang) * rad * 1.15;
      const py = Math.sin(ang) * rad * 0.72;

      this.x[i] = this.sx[i] = this.cx[i] = this.tx[i] = px;
      this.y[i] = this.sy[i] = this.cy[i] = this.ty[i] = py;
      this.elapsed[i] = 1.0;
      this.duration[i] = 1.0;
      this.delay[i] = 0.0;

      this.size[i] = this.startSize[i] = this.targetSize[i] = 1.9 + (i % 5) * 0.5;
      this.bright[i] = this.startBright[i] = this.targetBright[i] = 0.22 + (i % 7) * 0.05;
      this.phase[i] = (i * 1.6180339) % (Math.PI * 2);
      this.temp[i] = (i * 0.381966) % 1.0;
      this.flare[i] = 0.0;
      this.musicGlow[i] = 0.0;
      this.band[i] = i % 4;
      this.role[i] = 0;

      this.orbitAngle[i] = ang;
      this.orbitRadius[i] = 0.55 + ((i * 0.293) % 0.52);
      this.orbitSpeed[i] = (i % 2 === 0 ? 1 : -1) * (0.013 + (i % 11) * 0.0022);

      for (let t = 0; t < TRAIL_LEN; t++) {
        this.trailX[i * TRAIL_LEN + t] = px;
        this.trailY[i * TRAIL_LEN + t] = py;
      }
    }
  }

  setPalette(pal) {
    if (!pal) return;
    for (let k = 0; k < 3; k++) {
      if (pal.a) this.targetPalette.a[k] = pal.a[k];
      if (pal.b) this.targetPalette.b[k] = pal.b[k];
      if (pal.c) this.targetPalette.c[k] = pal.c[k];
      if (pal.starTint) this.targetPalette.starTint[k] = pal.starTint[k];
      if (pal.lineTint) this.targetPalette.lineTint[k] = pal.lineTint[k];
    }
  }

  spawnMeteor(intensity = 1.0) {
    for (let i = 0; i < MAX_METEORS; i++) {
      const m = this.meteors[i];
      if (!m.active) {
        const fromLeft = Math.random() > 0.35;
        m.active = true;
        m.x = fromLeft ? -1.15 + Math.random() * 0.9 : 0.25 + Math.random() * 0.9;
        m.y = 0.45 + Math.random() * 0.55;
        const speed = 1.45 + Math.random() * 0.95 * intensity;
        const angle = fromLeft ? (-0.32 - Math.random() * 0.28) : (-Math.PI + 0.32 + Math.random() * 0.28);
        m.vx = Math.cos(angle) * speed;
        m.vy = Math.sin(angle) * speed;
        m.life = 0;
        m.maxLife = 0.55 + Math.random() * 0.45;
        m.len = 0.14 + Math.random() * 0.12;
        return;
      }
    }
  }

  /**
   * Build a clean 5-7 star highlight tour of the constellation's brightest anchors
   * (never collapsing to just 2 stars, so the spotlight never ping-pongs A <-> B).
   */
  _buildStarTour(anchorStars) {
    if (!anchorStars.length) return [];
    const targetCount = Math.min(anchorStars.length, 7);
    const minCount = Math.min(anchorStars.length, 5);

    // Rank primaries first, then brightest/largest stars so we highlight key landmarks
    // without wandering through every faint secondary star.
    const ranked = [...anchorStars].sort((a, b) => {
      const rDiff = this.role[b] - this.role[a];
      if (rDiff !== 0) return rDiff;
      return this.targetSize[b] - this.targetSize[a];
    });

    // Pick well-spaced highlight stars (relaxing separation if needed so we never collapse to 2 stars)
    let chosen = [];
    for (const minSep of [0.22, 0.14, 0.0]) {
      chosen = [];
      for (const s of ranked) {
        if (chosen.length >= targetCount) break;
        const tooClose = minSep > 0 && chosen.some(
          (c) => Math.hypot(this.tx[s] - this.tx[c], this.ty[s] - this.ty[c]) < minSep
        );
        if (!tooClose) chosen.push(s);
      }
      if (chosen.length >= minCount) break;
    }

    // Order in a graceful angular sweep around the constellation, with a fresh starting offset
    chosen.sort((a, b) => Math.atan2(this.ty[a], this.tx[a]) - Math.atan2(this.ty[b], this.tx[b]));
    if (chosen.length >= 3) {
      const shift = Math.floor(Math.random() * chosen.length);
      chosen = [...chosen.slice(shift), ...chosen.slice(0, shift)];
    }
    return chosen;
  }

  /**
   * Smoothly morph the living starfield into a new constellation.
   */
  morphTo(constellation, opts = {}) {
    const pts = constellation.points || [];
    const edges = constellation.edges || [];
    const speedScale = (opts.speedScale || 1.0) * this.transitionSpeedMul;
    const transition = constellation.transition || "orbital";
    const scale = opts.scale || 1.0;

    if (constellation.palette && !opts.keepPalette) {
      this.setPalette(constellation.palette);
    }

    this.swirlSign = -this.swirlSign;
    this.globalAngularVel = this.swirlSign * (0.016 + Math.random() * 0.012);

    // 1. Gracefully unspool outgoing edges briskly so the new constellation shines on time
    for (let i = 0; i < MAX_EDGES; i++) {
      const e = this.edges[i];
      if (e.active) {
        e.retracting = true;
        e.speed = 4.2 * speedScale;
      }
    }

    // 2. Greedy minimum-distance spatial assignment (primary anchors first)
    const used = new Uint8Array(MAX_STARS);
    const pointOrder = pts.map((_, idx) => idx);
    pointOrder.sort((a, b) => (pts[b].primary ? 1 : 0) - (pts[a].primary ? 1 : 0));

    const nodeToStar = new Int32Array(pts.length);
    nodeToStar.fill(-1);

    for (let oi = 0; oi < pointOrder.length; oi++) {
      const pi = pointOrder[oi];
      const p = pts[pi];
      const tx = p.x * scale;
      const ty = p.y * scale;

      let bestIdx = -1;
      let bestScore = Infinity;

      for (let s = 0; s < MAX_STARS; s++) {
        if (used[s]) continue;
        const dx = this.x[s] - tx;
        const dy = this.y[s] - ty;
        let dist2 = dx * dx + dy * dy;
        if (this.role[s] >= 1) dist2 *= 0.72;
        if (dist2 < bestScore) {
          bestScore = dist2;
          bestIdx = s;
        }
      }

      if (bestIdx >= 0) {
        used[bestIdx] = 1;
        nodeToStar[pi] = bestIdx;
      }
    }

    this.activeAnchorStars = [];
    this.meta.fill(null);

    // 3. Configure crisp, snappy curved orbital trajectories for anchor stars
    const baseDur = clamp(0.68 / speedScale, 0.34, 1.25);

    for (let pi = 0; pi < pts.length; pi++) {
      const s = nodeToStar[pi];
      if (s < 0) continue;
      this.activeAnchorStars.push(s);

      const p = pts[pi];
      const tx = p.x * scale;
      const ty = p.y * scale;

      // Preserve authentic real B-V star color temperature & crisp, clearly visible magnitude proportions!
      if (typeof p.temp === "number") this.temp[s] = p.temp;
      const mag = typeof p.mag === "number" ? p.mag : 3.5;
      const mNorm = clamp((5.6 - mag) / 7.1, 0.0, 1.0);
      const propSize = 2.0 + 5.6 * Math.pow(mNorm, 1.22);
      const propBright = 0.54 + 0.46 * Math.pow(mNorm, 0.90);

      this.meta[s] = {
        kind: "star",
        properName: p.properName || "",
        name: p.properName || p.desig || `${constellation.name || "Star"}`,
        desig: p.desig || constellation.iau || "",
        constellation: constellation.title || "",
        subtitle: `${spectralClassFromTemp(this.temp[s])} · Mag ${mag >= 0 ? "+" : ""}${mag.toFixed(2)}`,
        fact: getStarFunFact(p.properName, p.desig, mag, this.temp[s]),
        mag,
        temp: this.temp[s],
      };

      const r = Math.hypot(tx, ty);
      this.band[s] = p.primary ? (r < 0.25 ? 0 : 1) : (r > 0.45 ? 2 : (pi % 3));

      this._assignCurvedFlight(
        s,
        tx,
        ty,
        p.primary ? 2 : 1,
        propSize,
        propBright,
        transition,
        baseDur,
        pi / Math.max(1, pts.length)
      );
    }

    // Build graceful star-to-star tour for word-by-word spotlighting
    this.starTourOrder = this._buildStarTour(this.activeAnchorStars);
    this.tourCursor = 0;
    this.spotlightStar = this.starTourOrder.length > 0 ? this.starTourOrder[0] : -1;
    this.prevSpotlightStar = -1;
    this.starHop.active = false;
    this.recentHops.length = 0;

    // 4. Gently orbit unused companion halo stars
    let haloCounter = 0;
    const haloTotal = Math.max(1, MAX_STARS - pts.length);
    for (let s = 0; s < MAX_STARS; s++) {
      if (used[s]) continue;
      haloCounter++;
      const frac = haloCounter / haloTotal;
      const ang = frac * Math.PI * 2 * 13.0 + this.time * 0.25;
      const rad = 0.54 + Math.sqrt(frac) * 0.62;
      const hx = Math.cos(ang) * rad * 1.28;
      const hy = Math.sin(ang) * rad * 0.84;

      this.orbitAngle[s] = ang;
      this.orbitRadius[s] = rad;
      this.band[s] = (s % 2 === 0) ? 2 : 3;

      this._assignCurvedFlight(
        s,
        hx,
        hy,
        0,
        1.7 + (s % 5) * 0.5,
        0.14 + (s % 6) * 0.045,
        transition,
        baseDur * 1.25,
        frac
      );
    }

    // 5. Queue incoming constellation filaments to weave themselves star-to-star
    let edgeSlot = 0;
    for (let ei = 0; ei < edges.length; ei++) {
      const [ni, nj] = edges[ei];
      if (ni < 0 || nj < 0 || ni >= nodeToStar.length || nj >= nodeToStar.length) continue;
      const sa = nodeToStar[ni];
      const sb = nodeToStar[nj];
      if (sa < 0 || sb < 0 || sa === sb) continue;

      let slot = -1;
      for (let k = 0; k < MAX_EDGES; k++) {
        const idx = (edgeSlot + k) % MAX_EDGES;
        if (!this.edges[idx].active) {
          slot = idx;
          edgeSlot = (idx + 1) % MAX_EDGES;
          break;
        }
      }
      if (slot < 0) {
        for (let k = 0; k < MAX_EDGES; k++) {
          if (this.edges[k].retracting) {
            slot = k;
            break;
          }
        }
      }
      if (slot < 0) break;

      const e = this.edges[slot];
      e.active = true;
      e.a = sa;
      e.b = sb;
      e.draw = 0.0;
      e.retracting = false;
      e.delay = baseDur * 0.16 + (ei / Math.max(1, edges.length)) * (baseDur * 0.24);
      e.speed = 2.9 * speedScale;
      e.alpha = 0.0;
      e.targetAlpha = (pts[ni].primary || pts[nj].primary) ? 0.56 : 0.36;
      e.pulse = 0.0;
      e.pulseSpeed = 2.4 + Math.random() * 0.6;
      e.weight = (pts[ni].primary && pts[nj].primary) ? 1.25 : 0.88;
    }

    // Compute anchor centroid + top edge so Morph Mode displays a crisp constellation label right above the pattern
    let sumX = 0, maxY = -1;
    for (let pi = 0; pi < pts.length; pi++) {
      sumX += pts[pi].x * scale;
      if (pts[pi].y * scale > maxY) maxY = pts[pi].y * scale;
    }
    this._labelMeta = {
      cid: constellation.iau || constellation.name || "constellation",
      name: constellation.name || (constellation.title ? constellation.title.split("·")[0].trim() : ""),
      sub: constellation.en || "",
      cx: pts.length ? sumX / pts.length : 0,
      topY: clamp(maxY + 0.13, -0.2, 0.78),
    };

    if (opts.meteor || Math.random() < 0.35) {
      this.spawnMeteor(1.0);
    }
  }

  _assignCurvedFlight(s, tx, ty, role, targetSize, targetBright, transition, baseDur, orderFrac) {
    const sx = this.x[s];
    const sy = this.y[s];
    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.hypot(dx, dy);

    const nx = dist > 0.001 ? -dy / dist : 0;
    const ny = dist > 0.001 ? dx / dist : 1;

    let arcMag = clamp(dist * 0.42, 0.05, 0.38) * this.swirlSign;
    let stagger = orderFrac * 0.11;

    if (transition === "bloom") {
      const radAng = Math.atan2(ty, tx);
      arcMag = (0.16 + dist * 0.32) * this.swirlSign;
      stagger = Math.hypot(tx, ty) * 0.14;
      this.cx[s] = (sx + tx) * 0.5 + Math.cos(radAng + 1.3 * this.swirlSign) * Math.abs(arcMag);
      this.cy[s] = (sy + ty) * 0.5 + Math.sin(radAng + 1.3 * this.swirlSign) * Math.abs(arcMag);
    } else if (transition === "vortex") {
      arcMag = clamp(0.24 + dist * 0.48, 0.12, 0.50) * this.swirlSign;
      stagger = (1.0 - orderFrac) * 0.11;
      this.cx[s] = (sx + tx) * 0.5 + nx * arcMag - ty * 0.16 * this.swirlSign;
      this.cy[s] = (sy + ty) * 0.5 + ny * arcMag + tx * 0.16 * this.swirlSign;
    } else if (transition === "sweep") {
      stagger = clamp((tx + 0.9) * 0.08, 0.0, 0.16);
      this.cx[s] = (sx + tx) * 0.5 + nx * arcMag * 0.85;
      this.cy[s] = (sy + ty) * 0.5 + ny * arcMag * 0.85 + 0.10;
    } else {
      const twist = ((s % 5) - 2) * 0.035;
      this.cx[s] = (sx + tx) * 0.5 + nx * (arcMag + twist);
      this.cy[s] = (sy + ty) * 0.5 + ny * (arcMag + twist);
    }

    this.sx[s] = sx;
    this.sy[s] = sy;
    this.tx[s] = tx;
    this.ty[s] = ty;
    this.role[s] = role;

    this.startSize[s] = this.size[s];
    this.targetSize[s] = targetSize;
    this.startBright[s] = this.bright[s];
    this.targetBright[s] = targetBright;

    this.delay[s] = stagger;
    this.elapsed[s] = 0.0;
    this.duration[s] = baseDur * (0.82 + clamp(dist * 0.30, 0.0, 0.30));

    if (role >= 1 && dist > 0.06) {
      this.trailEnergy[s] = clamp(dist * 1.4, 0.35, 1.0);
    }
  }

  /**
   * Advance the glowing spotlight to the next star in the constellation when
   * a word changes, launching a smooth star-to-star transition beam and
   * returning the spotlight star index so the UI can position the word beside it!
   */
  advanceWordStar(word = "", intensity = 1.0, resetTour = false) {
    this.wordRipple = clamp(0.65 + intensity * 0.45, 0.5, 1.25);

    const tour = this.starTourOrder.length > 0 ? this.starTourOrder : this.activeAnchorStars;
    if (tour.length === 0) return -1;

    const prevStar = this.spotlightStar;
    const prevPrevStar = this.prevPrevSpotlightStar;

    if (resetTour) {
      this.tourCursor = 0;
    } else {
      this.tourCursor = (this.tourCursor + 1) % tour.length;
      // When wrapping around a 4+ star tour, gently reshuffle order so it stays organic
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
    // Prevent A -> B -> A ping-pong whenever the tour has 3+ stars!
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

    // Ignite the chosen star cleanly!
    this.flare[nextStar] = Math.max(this.flare[nextStar], 0.78 * intensity);

    // Brief, whisper-fine star-to-star spark that immediately hands focus to the lit star
    if (prevStar >= 0 && prevStar !== nextStar) {
      this.starHop.active = true;
      this.starHop.fromStar = prevStar;
      this.starHop.toStar = nextStar;
      this.starHop.progress = 0.0;
      this.starHop.speed = 5.4 * this.transitionSpeedMul;
      this.starHop.alpha = 0.65;
    }

    // Only pulse filaments on word change when the music has energy (keep calm songs serene!)
    if (this.songIntensity >= 0.26) {
      let pulsed = 0;
      for (let k = 0; k < MAX_EDGES; k++) {
        const e = this.edges[k];
        if (!e.active || e.retracting || e.draw < 0.2) continue;
        if (e.a === nextStar || e.b === nextStar) {
          e.pulse = 0.0;
          e.pulseSpeed = 2.4 + this.songIntensity * 0.8 + Math.random() * 0.4;
          pulsed++;
        }
      }
      if (pulsed === 0) {
        for (let k = 0; k < MAX_EDGES && pulsed < 6; k++) {
          const e = this.edges[k];
          if (e.active && !e.retracting && e.draw > 0.3) {
            e.pulse = 0.0;
            e.pulseSpeed = 2.3 + this.songIntensity * 0.6;
            pulsed++;
          }
        }
      }
    }

    this.globalAngularVel += this.swirlSign * 0.008 * intensity;
    return nextStar;
  }

  /**
   * Return current world-space coordinates of a star (or spotlight star).
   */
  getStarPosition(starIdx) {
    if (starIdx < 0 || starIdx >= MAX_STARS) return null;
    return {
      x: this.x[starIdx],
      y: this.y[starIdx],
      tx: this.tx[starIdx],
      ty: this.ty[starIdx],
      flare: this.flare[starIdx],
    };
  }

  /** Hover hit-test for individual constellation stars in Morph Mode */
  pickAtScreen(mx, my, vw, vh, aspect) {
    let bestIdx = -1;
    let bestDist = 20;
    for (let i = 0; i < this.count; i++) {
      if (!this.meta[i]) continue;
      const px = ((this.x[i] / aspect) * 0.5 + 0.5) * vw;
      const py = (0.5 - this.y[i] * 0.5) * vh;
      const d = Math.hypot(px - mx, py - my);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    this.hoveredStarIdx = bestIdx;
    if (bestIdx < 0) return null;
    const px = ((this.x[bestIdx] / aspect) * 0.5 + 0.5) * vw;
    const py = (0.5 - this.y[bestIdx] * 0.5) * vh;
    return { idx: bestIdx, px, py, ...this.meta[bestIdx] };
  }

  step(dt, audio = null, isPaused = false) {
    const safeDt = clamp(dt, 0.001, 0.05);
    if (!isPaused) {
      this.time += safeDt;
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

    // Detect exact real drum onset (zero randomness — locked 1:1 to kicks & snares!)
    const isNewBeat = !isPaused && audio && audio.beat_seq > 0 && audio.beat_seq !== this._lastBeatSeq;
    if (isNewBeat) {
      this._lastBeatSeq = audio.beat_seq;
      const hitStr = clamp(Math.max(beat, kick, snare) * 1.25, 0.45, 1.0);
      this.beatPunch = Math.max(this.beatPunch, hitStr);
      this.beatBlink = Math.max(this.beatBlink, hitStr);
      if (kick >= snare * 0.85 || audio.beat_kind === 1) {
        this.kickPunch = Math.max(this.kickPunch, clamp(Math.max(kick, beat) * 1.25, 0.5, 1.0));
      }
    }

    // Smoothly blend mood palette
    const pBlend = 1.0 - Math.exp(-safeDt * 1.45);
    for (let k = 0; k < 3; k++) {
      this.palette.a[k] += (this.targetPalette.a[k] - this.palette.a[k]) * pBlend;
      this.palette.b[k] += (this.targetPalette.b[k] - this.palette.b[k]) * pBlend;
      this.palette.c[k] += (this.targetPalette.c[k] - this.palette.c[k]) * pBlend;
      this.palette.starTint[k] += (this.targetPalette.starTint[k] - this.palette.starTint[k]) * pBlend;
      this.palette.lineTint[k] += (this.targetPalette.lineTint[k] - this.palette.lineTint[k]) * pBlend;
    }

    if (!isPaused) {
      this.wordRipple *= Math.exp(-safeDt * 3.0);
      this.globalAngularVel *= Math.exp(-safeDt * 1.1);
      this.globalAngle += (this.globalAngularVel + this.swirlSign * 0.005) * safeDt;

      const targetBreath = 1.0 + Math.sin(this.time * 0.85) * 0.010 + this.kickPunch * 0.076 * glowStr + bass * 0.048 * glowStr + this.beatPunch * 0.032 * glowStr;
      this.breathScale += (targetBreath - this.breathScale) * (1.0 - Math.exp(-safeDt * 14.0));

      if (isNewBeat && kick > 0.68 && Math.random() < 0.24) {
        this.spawnMeteor(0.90 + kick * 0.35);
      }

      // Update brief star-to-star spark + beat blink!
      if (this.starHop.active) {
        this.starHop.progress += this.starHop.speed * safeDt;
        if (this.starHop.progress >= 1.0) {
          this.starHop.alpha *= Math.exp(-safeDt * 7.5);
          if (this.starHop.alpha < 0.02) {
            this.starHop.active = false;
          }
        }
      }
      // Rolling music intensity (0 = calm ballad/acoustic, 1 = rock/driving/energetic!)
      const rawDrive = clamp((energy * 1.15 + bass * 0.90 + beat * 0.85 - 0.16) * 1.60, 0.0, 1.0);
      const driveRate = rawDrive > this.songIntensity ? 2.2 : 0.65;
      this.songIntensity += (rawDrive - this.songIntensity) * (1.0 - Math.exp(-safeDt * driveRate));

      if (beat > 0.25) {
        this.beatBlink = Math.max(this.beatBlink, Math.min(1.0, beat * 1.25));
      }
      this.beatBlink *= Math.exp(-safeDt * 8.5);
      this.beatPunch *= Math.exp(-safeDt * 9.5);
      this.kickPunch *= Math.exp(-safeDt * 8.5);
      this.spotlightFlash *= Math.exp(-safeDt * 4.2);

      // Beat-Locked Constellation Line Wave: fires immediately on EVERY real drum onset!
      this._rockPulseCooldown = Math.max(0, this._rockPulseCooldown - safeDt);
      if ((isNewBeat || (this.songIntensity > 0.28 && beat > 0.42)) && this._rockPulseCooldown <= 0) {
        this._rockPulseCooldown = 0.17;
        for (let k = 0; k < MAX_EDGES; k++) {
          const ed = this.edges[k];
          if (ed.active && !ed.retracting && ed.draw > 0.35) {
            ed.pulse = 0.0;
            ed.pulseSpeed = 3.0 + this.beatPunch * 1.2 + Math.random() * 0.25;
          }
        }
      }
    } else {
      this.beatBlink *= Math.exp(-safeDt * 6.0);
      this.beatPunch *= Math.exp(-safeDt * 8.0);
      this.kickPunch *= Math.exp(-safeDt * 8.0);
    }

    // Trail sampling cadence
    this._trailAccum += isPaused ? 0 : safeDt;
    const pushTrail = !isPaused && this._trailAccum >= 0.022;
    if (pushTrail) this._trailAccum = 0;

    const cosDrift = Math.cos(Math.sin(this.time * 0.22) * 0.032);
    const sinDrift = Math.sin(Math.sin(this.time * 0.22) * 0.032);
    const bandValues = [
      (sub * 0.6 + bass * 0.4), // 0: bass/sub
      mid,                      // 1: vocal mids
      high,                     // 2: sparkle highs
      energy,                   // 3: overall energy
    ];

    for (let i = 0; i < MAX_STARS; i++) {
      if (!isPaused) {
        if (this.delay[i] > 0) {
          this.delay[i] -= safeDt;
        } else if (this.elapsed[i] < this.duration[i]) {
          this.elapsed[i] = Math.min(this.duration[i], this.elapsed[i] + safeDt);
        }
      }

      const rawU = this.duration[i] > 0 ? this.elapsed[i] / this.duration[i] : 1.0;

      if (!isPaused) {
        const u = easeInOutQuart(rawU);
        const invU = 1.0 - u;

        let bx = invU * invU * this.sx[i] + 2 * invU * u * this.cx[i] + u * u * this.tx[i];
        let by = invU * invU * this.sy[i] + 2 * invU * u * this.cy[i] + u * u * this.ty[i];

        if (this.role[i] === 0 && rawU >= 1.0) {
          this.orbitAngle[i] += this.orbitSpeed[i] * safeDt * (1.0 + energy * 1.15);
          const r = this.orbitRadius[i];
          bx = Math.cos(this.orbitAngle[i]) * r * 1.28;
          by = Math.sin(this.orbitAngle[i]) * r * 0.84;
          this.tx[i] = bx;
          this.ty[i] = by;
        } else if (this.role[i] >= 1) {
          const ph = this.phase[i];
          const shimmer = (0.004 + mid * 0.0085 * glowStr) * u;
          const ox = bx * cosDrift - by * sinDrift;
          const oy = bx * sinDrift + by * cosDrift;
          bx = ox * this.breathScale + Math.cos(this.time * 0.9 + ph) * shimmer;
          by = oy * this.breathScale + Math.sin(this.time * 1.1 + ph) * shimmer;
        }

        this.x[i] = bx;
        this.y[i] = by;
      }

      const sEase = easeOutCubic(rawU);
      const bVal = bandValues[this.band[i]] || 0;
      const phWave = 0.65 + 0.35 * Math.sin(this.time * 2.6 + this.phase[i]);
      const isSpot = i === this.spotlightStar;

      // Calm drumless music = serene gentle sway; Real kicks & snares = unmistakable round star pop!
      const intensityScale = 0.35 + this.songIntensity * 0.75;
      const musicSizePulse = this.role[i] >= 1
        ? (1.0 + (this.beatPunch * 0.48 + this.kickPunch * 0.24 + bVal * 0.26 * intensityScale) * glowStr)
        : (1.0 + (this.kickPunch * 0.16 + bVal * 0.08) * glowStr);
      const breathWave = isSpot ? (0.5 + 0.5 * Math.sin(this.time * (3.6 + this.songIntensity * 2.4))) : 0.0;
      const spotBeatMul = isSpot
        ? (1.26 + breathWave * 0.14 + this.spotlightFlash * 0.20 + this.beatPunch * 0.30 * glowStr)
        : 1.0;
      const spotBrightMul = isSpot
        ? (1.24 + breathWave * 0.14 + this.spotlightFlash * 0.22 + this.beatPunch * 0.26 * glowStr)
        : (this.role[i] >= 1 ? (1.0 + this.beatPunch * 0.26 * glowStr) : 1.0);
      const baseSizeBoost = this.role[i] >= 1 ? 1.12 : 1.04;
      this.size[i] = (this.startSize[i] + (this.targetSize[i] - this.startSize[i]) * sEase) * baseSizeBoost * musicSizePulse * spotBeatMul;
      this.bright[i] = (this.startBright[i] + (this.targetBright[i] - this.startBright[i]) * sEase) * spotBrightMul;

      // Per-star real-time music glow!
      const roleMult = this.role[i] === 2 ? 0.92 : (this.role[i] === 1 ? 0.68 : 0.30);
      const targetMusicGlow = clamp((bVal * 0.80 + beat * 0.42) * phWave * roleMult * glowStr, 0.0, 1.05);
      this.musicGlow[i] += (targetMusicGlow - this.musicGlow[i]) * (1.0 - Math.exp(-safeDt * 11.0));

      // Active spotlight star swells smoothly in round size & soft glow without harsh blowout!
      if (isSpot) {
        const sustain = 0.42 + breathWave * 0.16 + this.spotlightFlash * 0.26 + this.beatBlink * 0.36 * glowStr;
        this.flare[i] = Math.max(this.flare[i] * Math.exp(-safeDt * 4.5), sustain);
      } else {
        this.flare[i] *= Math.exp(-safeDt * 4.2);
        if (this.role[i] === 2 && beat > 0.42) {
          this.flare[i] = Math.max(this.flare[i], beat * 0.22 * glowStr);
        }
      }

      if (rawU >= 0.96) {
        this.trailEnergy[i] *= Math.exp(-safeDt * 4.5);
      }

      if (pushTrail) {
        const base = i * TRAIL_LEN;
        for (let t = TRAIL_LEN - 1; t > 0; t--) {
          this.trailX[base + t] = this.trailX[base + t - 1];
          this.trailY[base + t] = this.trailY[base + t - 1];
        }
        this.trailX[base] = this.x[i];
        this.trailY[base] = this.y[i];
      }
    }

    // Update living constellation filaments (paused peacefully when song is paused!)
    if (!isPaused) {
      for (let i = 0; i < MAX_EDGES; i++) {
        const e = this.edges[i];
        if (!e.active) continue;

        if (e.retracting) {
          e.draw -= e.speed * safeDt;
          e.alpha *= Math.exp(-safeDt * 5.0);
          if (e.draw <= 0.01 || e.alpha <= 0.01) {
            e.active = false;
            e.draw = 0;
            e.alpha = 0;
          }
        } else {
          if (e.delay > 0) {
            e.delay -= safeDt;
          } else {
            if (e.draw < 1.0) {
              e.draw = Math.min(1.0, e.draw + e.speed * safeDt);
            }
            const isLitEdge = (e.a === this.spotlightStar || e.b === this.spotlightStar);
            const beatLinePunch = (this.beatPunch * 0.95 + this.kickPunch * 0.55 + this.songIntensity * bass * 0.30) * glowStr;
            const targetA = Math.min(1.35, e.targetAlpha * (0.72 + beatLinePunch * 1.05 + energy * 0.14 * glowStr) * (isLitEdge ? 1.22 : 1.0));
            const alphaRate = targetA > e.alpha ? 28.0 : 8.5;
            e.alpha += (targetA - e.alpha) * (1.0 - Math.exp(-safeDt * alphaRate));
            e.weight = (isLitEdge ? 1.28 : 1.06) + beatLinePunch * 1.45;
          }

          if (e.pulse >= 0) {
            e.pulse += e.pulseSpeed * safeDt;
            if (e.pulse > 1.35) {
              e.pulse = -1;
            }
          }
        }
      }
    }

    // Update shooting stars (paused peacefully when song is paused!)
    if (!isPaused) {
      for (let i = 0; i < MAX_METEORS; i++) {
        const m = this.meteors[i];
        if (!m.active) continue;
        m.life += safeDt;
        m.x += m.vx * safeDt;
        m.y += m.vy * safeDt;
        if (m.life >= m.maxLife) m.active = false;
      }
    }

    // Expose floating constellation name positioned gently above the active pattern
    this.constellationLabels.length = 0;
    if (this._labelMeta && this._labelMeta.name) {
      const cosA = Math.cos(this.globalAngle);
      const sinA = Math.sin(this.globalAngle);
      const lx = this._labelMeta.cx * cosA - this._labelMeta.topY * sinA;
      const ly = this._labelMeta.cx * sinA + this._labelMeta.topY * cosA;
      this.constellationLabels.push({
        cid: this._labelMeta.cid,
        name: this._labelMeta.name,
        sub: this._labelMeta.sub,
        x: lx,
        y: clamp(ly, -0.78, 0.80),
        alpha: 0.62,
        isFocused: true,
      });
    }

    // Expose toggleable proper IAU star names for the featured constellation
    this.starNameLabels.length = 0;
    for (let i = 0; i < this.activeAnchorStars.length; i++) {
      const si = this.activeAnchorStars[i];
      const m = this.meta[si];
      if (!m || !m.properName) continue;
      this.starNameLabels.push({
        id: `m_${si}`,
        name: m.properName,
        mag: m.mag,
        x: this.x[si],
        y: this.y[si],
        alpha: 0.36,
        isFocused: true,
      });
    }
    this.starNameLabels.sort((a, b) => a.mag - b.mag);
  }
}
