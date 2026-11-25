/**
 * Real-Time Solar System Ephemeris (Moon with live phase + 7 Planets via J2000)
 * & Real-Time NORAD GP/OMM Satellite Propagator (with J2 orbital precession).
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const OBLIQUITY = 23.439291 * DEG2RAD;
const J2 = 1.08262668e-3;
const R_EARTH_KM = 6378.137;
const GM_EARTH = 398600.4418;

function normDeg(d) {
  let r = d % 360;
  return r < 0 ? r + 360 : r;
}

function daysSinceJ2000(date = new Date()) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  return jd - 2451545.0;
}

function solveKepler(Mrad, e) {
  let E = Mrad + e * Math.sin(Mrad);
  for (let i = 0; i < 6; i++) {
    const f = E - e * Math.sin(E) - Mrad;
    const fp = 1 - e * Math.cos(E);
    E -= f / fp;
  }
  return E;
}

function helioEclipticXYZ(el, d) {
  const N = normDeg(el.N0 + el.Nd * d) * DEG2RAD;
  const i = (el.i0 + el.id * d) * DEG2RAD;
  const w = normDeg(el.w0 + el.wd * d) * DEG2RAD;
  const a = el.a;
  const e = el.e0 + el.ed * d;
  const M = normDeg(el.M0 + el.Md * d) * DEG2RAD;

  const E = solveKepler(M, e);
  const xv = a * (Math.cos(E) - e);
  const yv = a * Math.sqrt(Math.max(0, 1 - e * e)) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);

  const vw = v + w;
  const cosN = Math.cos(N), sinN = Math.sin(N);
  const cosVW = Math.cos(vw), sinVW = Math.sin(vw);
  const cosI = Math.cos(i), sinI = Math.sin(i);

  return [
    r * (cosN * cosVW - sinN * sinVW * cosI),
    r * (sinN * cosVW + cosN * sinVW * cosI),
    r * (sinVW * sinI),
  ];
}

function eclipticToEquatorial(xe, ye, ze) {
  const cosE = Math.cos(OBLIQUITY);
  const sinE = Math.sin(OBLIQUITY);
  const xeq = xe;
  const yeq = ye * cosE - ze * sinE;
  const zeq = ye * sinE + ze * cosE;
  const ra = normDeg(Math.atan2(yeq, xeq) * RAD2DEG);
  const dec = Math.atan2(zeq, Math.hypot(xeq, yeq)) * RAD2DEG;
  return { ra, dec };
}

const EARTH_EL = {
  N0: 0.0, Nd: 0.0, i0: 0.0, id: 0.0,
  w0: 102.9372, wd: 4.70935e-5, a: 1.000000,
  e0: 0.016709, ed: -1.151e-9, M0: 356.0470, Md: 0.9856002585,
};

// bodyType indices match BODIES_FS procedural shader IDs:
// 0=Moon, 1=Mercury, 2=Venus, 3=Mars, 4=Jupiter, 5=Saturn, 6=Uranus, 7=Neptune,
// 8=Satellite, 9=Emission Nebula, 10=Planetary/SNR, 11=Galaxy, 12=Cluster, 13=Sun
// Base pxRadius values are intentionally refined so planets blend naturally with
// stars & nebulae at wide-sky zoom and reveal rich surface detail as you zoom in!
const PLANET_ELEMENTS = [
  {
    id: "mercury", bodyType: 1, name: "Mercury", subtitle: "Terrestrial Planet", mag: -0.2, pxRadius: 7.2,
    el: { N0: 48.3313, Nd: 3.24587e-5, i0: 7.0047, id: 5.00e-8, w0: 29.1241, wd: 1.01444e-5, a: 0.387098, e0: 0.205635, ed: 5.59e-10, M0: 168.6562, Md: 4.0923344368 },
  },
  {
    id: "venus", bodyType: 2, name: "Venus", subtitle: "Terrestrial Planet", mag: -4.1, pxRadius: 9.6,
    el: { N0: 76.6799, Nd: 2.46590e-5, i0: 3.3946, id: 2.75e-8, w0: 54.8910, wd: 1.38374e-5, a: 0.723330, e0: 0.006773, ed: -1.302e-9, M0: 48.0052, Md: 1.6021302244 },
  },
  {
    id: "mars", bodyType: 3, name: "Mars", subtitle: "Red Planet", mag: -0.6, pxRadius: 8.8,
    el: { N0: 49.5574, Nd: 2.11081e-5, i0: 1.8497, id: -1.78e-8, w0: 286.5016, wd: 2.92961e-5, a: 1.523688, e0: 0.093405, ed: 2.516e-9, M0: 18.6021, Md: 0.5240207766 },
  },
  {
    id: "jupiter", bodyType: 4, name: "Jupiter", subtitle: "Gas Giant", mag: -2.4, pxRadius: 11.4,
    el: { N0: 100.4542, Nd: 2.76854e-5, i0: 1.3030, id: -1.557e-7, w0: 273.8777, wd: 1.64505e-5, a: 5.20256, e0: 0.048498, ed: 4.469e-9, M0: 19.8950, Md: 0.0830853001 },
  },
  {
    id: "saturn", bodyType: 5, name: "Saturn", subtitle: "Ringed Gas Giant", mag: 0.4, pxRadius: 16.5,
    el: { N0: 113.6634, Nd: 2.38980e-5, i0: 2.4886, id: -1.081e-7, w0: 339.3939, wd: 2.97661e-5, a: 9.55475, e0: 0.055546, ed: -9.499e-9, M0: 316.9670, Md: 0.0334442282 },
  },
  {
    id: "uranus", bodyType: 6, name: "Uranus", subtitle: "Ice Giant", mag: 5.7, pxRadius: 8.2,
    el: { N0: 74.0005, Nd: 1.3978e-5, i0: 0.7733, id: 1.9e-8, w0: 96.6612, wd: 3.0565e-5, a: 19.18171, e0: 0.047318, ed: 7.45e-9, M0: 142.5905, Md: 0.011725806 },
  },
  {
    id: "neptune", bodyType: 7, name: "Neptune", subtitle: "Ice Giant", mag: 7.8, pxRadius: 7.8,
    el: { N0: 131.7806, Nd: 3.0173e-5, i0: 1.7700, id: -2.55e-7, w0: 272.8461, wd: -6.027e-6, a: 30.05826, e0: 0.008606, ed: 2.15e-9, M0: 260.2471, Md: 0.005995147 },
  },
];

function moonPhaseName(elongDeg) {
  if (elongDeg < 15 || elongDeg > 345) return "New Moon";
  if (elongDeg < 75) return "Waxing Crescent";
  if (elongDeg < 105) return "First Quarter";
  if (elongDeg < 165) return "Waxing Gibbous";
  if (elongDeg < 195) return "Full Moon";
  if (elongDeg < 255) return "Waning Gibbous";
  if (elongDeg < 285) return "Last Quarter";
  return "Waning Crescent";
}

function computeMoon(d, sunLonDeg) {
  const N = normDeg(125.1228 - 0.0529538083 * d) * DEG2RAD;
  const i = 5.1454 * DEG2RAD;
  const w = normDeg(318.0634 + 0.1643573223 * d) * DEG2RAD;
  const e = 0.054900;
  const M = normDeg(115.3654 + 13.0649929509 * d) * DEG2RAD;

  const E = solveKepler(M, e);
  const xv = Math.cos(E) - e;
  const yv = Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  const vw = v + w;

  const xe = Math.cos(N) * Math.cos(vw) - Math.sin(N) * Math.sin(vw) * Math.cos(i);
  const ye = Math.sin(N) * Math.cos(vw) + Math.cos(N) * Math.sin(vw) * Math.cos(i);
  const ze = Math.sin(vw) * Math.sin(i);
  const moonLonDeg = normDeg(Math.atan2(ye, xe) * RAD2DEG);
  const elongDeg = normDeg(moonLonDeg - sunLonDeg);
  const illumPct = Math.round(((1 - Math.cos(elongDeg * DEG2RAD)) * 0.5) * 100);
  const { ra, dec } = eclipticToEquatorial(xe, ye, ze);

  return {
    id: "moon",
    bodyType: 0,
    kind: "moon",
    name: "The Moon",
    subtitle: `${moonPhaseName(elongDeg)} · ${illumPct}% lit · Live`,
    mag: -11.5,
    pxRadius: 14.5,
    phaseParam: elongDeg * DEG2RAD, // Exact Sun-Moon elongation angle for realistic terminator!
    ra,
    dec,
  };
}

/** Compute exact live geocentric (RA, Dec, AU distance, phase) of Sun + Moon + 7 Planets right now! */
export function computeSolarSystemBodies(date = new Date()) {
  const d = daysSinceJ2000(date);
  const [ex, ey, ez] = helioEclipticXYZ(EARTH_EL, d);
  const sunDistAU = Math.hypot(ex, ey, ez);
  const sunEq = eclipticToEquatorial(-ex, -ey, -ez);
  const sunLonDeg = normDeg(Math.atan2(-ey, -ex) * RAD2DEG);

  const sunBody = {
    id: "sun",
    bodyType: 13,
    kind: "sun",
    name: "The Sun",
    subtitle: `G2V Star · ${sunDistAU.toFixed(3)} AU · Live`,
    mag: -26.7,
    pxRadius: 18.0,
    phaseParam: 0.0,
    ra: sunEq.ra,
    dec: sunEq.dec,
  };

  const bodies = [sunBody, computeMoon(d, sunLonDeg)];

  for (const p of PLANET_ELEMENTS) {
    const [px, py, pz] = helioEclipticXYZ(p.el, d);
    const gx = px - ex, gy = py - ey, gz = pz - ez;
    const distAU = Math.hypot(gx, gy, gz);
    const { ra, dec } = eclipticToEquatorial(gx, gy, gz);
    // Sun-Planet-Earth phase angle for subtle realistic phase shading
    const dot = (px * gx + py * gy + pz * gz) / (Math.hypot(px, py, pz) * distAU || 1);
    const phaseRad = Math.acos(Math.max(-1, Math.min(1, dot)));

    bodies.push({
      id: p.id,
      bodyType: p.bodyType,
      kind: "planet",
      name: p.name,
      subtitle: `${p.subtitle} · ${distAU.toFixed(2)} AU · Live`,
      mag: p.mag,
      pxRadius: p.pxRadius,
      phaseParam: phaseRad,
      ra,
      dec,
    });
  }
  return bodies;
}

/** Precompute 3D equatorial unit vectors along the astronomical Ecliptic plane (obliquity 23.439°). */
export function computeEclipticUnitVectors(samples = 96) {
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const lon = (i / samples) * Math.PI * 2.0;
    const xe = Math.cos(lon);
    const ye = Math.sin(lon);
    const { ra, dec } = eclipticToEquatorial(xe, ye, 0);
    const raRad = ra * DEG2RAD;
    const decRad = dec * DEG2RAD;
    const cd = Math.cos(decRad);
    // Astralis 3D convention: y = North Pole, x = RA 0h, z = RA 6h
    pts.push([cd * Math.cos(raRad), Math.sin(decRad), cd * Math.sin(raRad)]);
  }
  return pts;
}

// Fallback orbital elements (automatically replaced by live CelesTrak NORAD GP data from /api/celestial!)
export const FALLBACK_SATELLITES = [
  {
    catnr: 25544, name: "ISS (Zarya)", role: "Space Station", mag: -1.8, live: false,
    epoch_ms: Date.UTC(2026, 10, 23, 21, 54, 38), inclination: 51.632, raan: 142.0,
    eccentricity: 0.0005, arg_perigee: 45.0, mean_anomaly: 18.0, mean_motion: 15.4956, alt_km: 416, vel_kms: 7.66,
  },
  {
    catnr: 48274, name: "Tiangong (CSS)", role: "Space Station", mag: -0.6, live: false,
    epoch_ms: Date.UTC(2026, 10, 23, 21, 54, 38), inclination: 41.47, raan: 230.0,
    eccentricity: 0.0005, arg_perigee: 90.0, mean_anomaly: 110.0, mean_motion: 15.58, alt_km: 392, vel_kms: 7.67,
  },
  {
    catnr: 20580, name: "Hubble (HST)", role: "Space Telescope", mag: 1.4, live: false,
    epoch_ms: Date.UTC(2026, 10, 23, 21, 54, 38), inclination: 28.47, raan: 85.0,
    eccentricity: 0.0003, arg_perigee: 120.0, mean_anomaly: 220.0, mean_motion: 15.13, alt_km: 525, vel_kms: 7.60,
  },
  {
    catnr: 40697, name: "Sentinel-2A", role: "ESA Earth Imager", mag: 2.8, live: false,
    epoch_ms: Date.UTC(2026, 10, 23, 21, 54, 38), inclination: 98.57, raan: 35.0,
    eccentricity: 0.0001, arg_perigee: 88.0, mean_anomaly: 40.0, mean_motion: 14.308, alt_km: 786, vel_kms: 7.46,
  },
  {
    catnr: 25994, name: "NASA Terra", role: "Earth Observatory", mag: 2.4, live: false,
    epoch_ms: Date.UTC(2026, 10, 23, 21, 54, 38), inclination: 98.18, raan: 195.0,
    eccentricity: 0.0001, arg_perigee: 92.0, mean_anomaly: 270.0, mean_motion: 14.57, alt_km: 705, vel_kms: 7.50,
  },
  {
    catnr: 43013, name: "NOAA-20", role: "Weather Satellite", mag: 2.7, live: false,
    epoch_ms: Date.UTC(2026, 10, 23, 21, 54, 38), inclination: 98.74, raan: 310.0,
    eccentricity: 0.0001, arg_perigee: 75.0, mean_anomaly: 160.0, mean_motion: 14.19, alt_km: 824, vel_kms: 7.44,
  },
];

/**
 * Real-time ECI orbital propagator from NORAD GP/OMM elements with J2 nodal & apsidal precession!
 * Returns unit celestial direction [ux, uy, uz] (y = North), plus real RA/Dec in degrees!
 */
export function propagateNoradSatellite(gp, nowMs = Date.now()) {
  const dtSec = (nowMs - (gp.epoch_ms || nowMs)) / 1000.0;
  const nRadSec = ((gp.mean_motion || 15.0) * 2.0 * Math.PI) / 86400.0;
  const aKm = Math.cbrt(GM_EARTH / (nRadSec * nRadSec));
  const e = gp.eccentricity || 0.0005;
  const inc = (gp.inclination || 51.6) * DEG2RAD;
  const pKm = aKm * (1 - e * e);

  // J2 secular perturbation rates (rad/s)
  const j2Factor = 1.5 * J2 * nRadSec * Math.pow(R_EARTH_KM / pKm, 2);
  const raanDot = -j2Factor * Math.cos(inc);
  const argpDot = j2Factor * (2.0 - 2.5 * Math.sin(inc) * Math.sin(inc));

  const raan = (gp.raan || 0) * DEG2RAD + raanDot * dtSec;
  const argp = (gp.arg_perigee || 0) * DEG2RAD + argpDot * dtSec;
  const M = ((gp.mean_anomaly || 0) * DEG2RAD + nRadSec * dtSec) % (2.0 * Math.PI);
  const E = solveKepler(M < 0 ? M + 2 * Math.PI : M, e);

  const cosE = Math.cos(E), sinE = Math.sin(E);
  const v = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e);
  const u = argp + v;

  const cosO = Math.cos(raan), sinO = Math.sin(raan);
  const cosU = Math.cos(u), sinU = Math.sin(u);
  const cosI = Math.cos(inc), sinI = Math.sin(inc);

  // ECI Equatorial unit vector (where Astralis uses y = North Pole, x = RA 0h, z = RA 6h)
  const x = cosO * cosU - sinO * sinU * cosI;
  const z = sinO * cosU + cosO * sinU * cosI;
  const y = sinU * sinI;

  const ra = normDeg(Math.atan2(z, x) * RAD2DEG);
  const dec = Math.asin(Math.max(-1, Math.min(1, y))) * RAD2DEG;
  return { x, y, z, ra, dec };
}

export function spectralClassFromTemp(temp) {
  if (temp < 0.14) return "O/B Blue Giant";
  if (temp < 0.30) return "A Blue-White";
  if (temp < 0.48) return "F Yellow-White";
  if (temp < 0.64) return "G Solar Yellow";
  if (temp < 0.82) return "K Warm Orange";
  return "M Red Supergiant";
}

/**
 * 21 Authentic Deep-Sky Objects (Messier & NGC Nebulae, Spiral Galaxies,
 * Magellanic Clouds, Reflection & Globular Star Clusters) at exact J2000 (RA, Dec).
 *
 * bodyType:
 *   9  = Emission / Diffuse Nebula (H-alpha rose/magenta + O-III teal wisps + dust lanes)
 *   10 = Planetary Nebula / Supernova Remnant (glowing O-III teal/coral shell + central star)
 *   11 = Spiral / Irregular Galaxy (golden core + inclined logarithmic dusty spiral arms)
 *   12 = Reflection / Globular Star Cluster (sapphire reflection haze or sparkling core)
 *
 * phaseParam packs a color variant seed (0.0..1.0) so each nebula/galaxy has its authentic palette!
 */
export const DEEP_SKY_CATALOG = [
  // --- Emission & Diffuse Nebulae (bodyType 9) ---
  {
    id: "m42", bodyType: 9, kind: "nebula", name: "Orion Nebula", desig: "M42 · NGC 1976",
    ra: 83.82, dec: -5.39, pxRadius: 34, angle: 0.4, variant: 0.12,
    subtitle: "Emission Nebula · 1,344 ly · Orion's Sword",
  },
  {
    id: "ngc3372", bodyType: 9, kind: "nebula", name: "Carina Nebula", desig: "NGC 3372",
    ra: 161.26, dec: -59.87, pxRadius: 40, angle: -0.6, variant: 0.38,
    subtitle: "Giant H II Nebula · 8,500 ly · Carina",
  },
  {
    id: "m8", bodyType: 9, kind: "nebula", name: "Lagoon Nebula", desig: "M8 · NGC 6523",
    ra: 270.92, dec: -24.38, pxRadius: 32, angle: 0.25, variant: 0.22,
    subtitle: "Emission Nebula · 4,100 ly · Sagittarius",
  },
  {
    id: "m16", bodyType: 9, kind: "nebula", name: "Eagle Nebula", desig: "M16 · Pillars of Creation",
    ra: 274.70, dec: -13.81, pxRadius: 28, angle: 0.9, variant: 0.55,
    subtitle: "Star-Forming Nebula · 5,700 ly · Serpens",
  },
  {
    id: "m20", bodyType: 9, kind: "nebula", name: "Trifid Nebula", desig: "M20 · NGC 6514",
    ra: 270.67, dec: -23.03, pxRadius: 24, angle: -0.3, variant: 0.78,
    subtitle: "Emission & Reflection · 4,100 ly · Sagittarius",
  },
  {
    id: "ngc7000", bodyType: 9, kind: "nebula", name: "North America Nebula", desig: "NGC 7000",
    ra: 314.75, dec: 44.33, pxRadius: 36, angle: 0.15, variant: 0.08,
    subtitle: "Emission Nebula · 2,590 ly · Cygnus",
  },
  {
    id: "ngc2237", bodyType: 9, kind: "nebula", name: "Rosette Nebula", desig: "NGC 2237",
    ra: 98.00, dec: 4.95, pxRadius: 31, angle: 1.1, variant: 0.30,
    subtitle: "Floral H II Region · 5,200 ly · Monoceros",
  },
  {
    id: "ngc2070", bodyType: 9, kind: "nebula", name: "Tarantula Nebula", desig: "NGC 2070 · 30 Dor",
    ra: 84.68, dec: -69.10, pxRadius: 28, angle: -0.8, variant: 0.65,
    subtitle: "Starburst Nebula · 160,000 ly · Dorado",
  },

  // --- Planetary Nebulae & Supernova Remnants (bodyType 10) ---
  {
    id: "m57", bodyType: 10, kind: "nebula", name: "Ring Nebula", desig: "M57 · NGC 6720",
    ra: 283.40, dec: 33.03, pxRadius: 18, angle: 0.5, variant: 0.15,
    subtitle: "Planetary Nebula · 2,567 ly · Lyra",
  },
  {
    id: "ngc7293", bodyType: 10, kind: "nebula", name: "Helix Nebula", desig: "NGC 7293 · Eye of God",
    ra: 337.41, dec: -20.84, pxRadius: 26, angle: -0.35, variant: 0.48,
    subtitle: "Planetary Nebula · 655 ly · Aquarius",
  },
  {
    id: "m1", bodyType: 10, kind: "nebula", name: "Crab Nebula", desig: "M1 · NGC 1952",
    ra: 83.63, dec: 22.01, pxRadius: 22, angle: 0.72, variant: 0.85,
    subtitle: "Supernova Remnant (1054 AD) · 6,500 ly · Taurus",
  },
  {
    id: "m27", bodyType: 10, kind: "nebula", name: "Dumbbell Nebula", desig: "M27 · NGC 6853",
    ra: 299.90, dec: 22.72, pxRadius: 22, angle: -0.5, variant: 0.30,
    subtitle: "Planetary Nebula · 1,360 ly · Vulpecula",
  },

  // --- Spiral & Companion Galaxies (bodyType 11) ---
  {
    id: "m31", bodyType: 11, kind: "galaxy", name: "Andromeda Galaxy", desig: "M31 · NGC 224",
    ra: 10.68, dec: 41.27, pxRadius: 48, angle: 0.62, variant: 0.25,
    subtitle: "Barred Spiral Galaxy · 2.54M ly · Andromeda",
  },
  {
    id: "m33", bodyType: 11, kind: "galaxy", name: "Triangulum Galaxy", desig: "M33 · NGC 598",
    ra: 23.46, dec: 30.66, pxRadius: 30, angle: -0.4, variant: 0.75,
    subtitle: "Spiral Galaxy · 2.73M ly · Triangulum",
  },
  {
    id: "m51", bodyType: 11, kind: "galaxy", name: "Whirlpool Galaxy", desig: "M51 · NGC 5194",
    ra: 202.47, dec: 47.20, pxRadius: 26, angle: 0.2, variant: 0.85,
    subtitle: "Grand-Design Spiral · 23M ly · Canes Venatici",
  },
  {
    id: "m104", bodyType: 11, kind: "galaxy", name: "Sombrero Galaxy", desig: "M104 · NGC 4594",
    ra: 189.99, dec: -11.62, pxRadius: 28, angle: 0.12, variant: 0.10,
    subtitle: "Edge-On Spiral · 31M ly · Virgo",
  },
  {
    id: "lmc", bodyType: 11, kind: "galaxy", name: "Large Magellanic Cloud", desig: "LMC · ESO 56-115",
    ra: 80.89, dec: -69.76, pxRadius: 46, angle: -0.3, variant: 0.62,
    subtitle: "Satellite Dwarf Galaxy · 163,000 ly · Dorado",
  },
  {
    id: "smc", bodyType: 11, kind: "galaxy", name: "Small Magellanic Cloud", desig: "SMC · NGC 292",
    ra: 13.19, dec: -72.83, pxRadius: 34, angle: 0.55, variant: 0.58,
    subtitle: "Satellite Dwarf Galaxy · 200,000 ly · Tucana",
  },

  // --- Iconic Star Clusters (bodyType 12) ---
  {
    id: "m45", bodyType: 12, kind: "cluster", name: "Pleiades (Seven Sisters)", desig: "M45",
    ra: 56.75, dec: 24.12, pxRadius: 30, angle: 0.2, variant: 0.15,
    subtitle: "Open Cluster & Reflection Nebula · 444 ly · Taurus",
  },
  {
    id: "omega_cen", bodyType: 12, kind: "cluster", name: "Omega Centauri", desig: "NGC 5139",
    ra: 201.70, dec: -47.48, pxRadius: 24, angle: 0.0, variant: 0.85,
    subtitle: "Globular Cluster (~10M stars) · 17,090 ly · Centaurus",
  },
  {
    id: "m13", bodyType: 12, kind: "cluster", name: "Hercules Globular Cluster", desig: "M13 · NGC 6205",
    ra: 250.42, dec: 36.46, pxRadius: 21, angle: 0.0, variant: 0.82,
    subtitle: "Globular Cluster (~300k stars) · 22,200 ly · Hercules",
  },
];
