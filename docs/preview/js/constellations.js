/**
 * Astralis Complete 88 Official IAU Star Atlas.
 *
 * Exposes all 88 official IAU constellations with authentic Hipparcos/IAU
 * spherical (RA, Dec) positions, real visual magnitudes, B-V stellar color
 * temperatures, and normalized 2D star-chart coordinates for both Morph Mode
 * and 3D Rotating Hemisphere Dome Mode.
 */

import { IAU_88_RAW } from "./iau88_data.js";

export const PALETTES = {
  astral: {
    name: "Astral Indigo",
    a: [0.015, 0.022, 0.072],
    b: [0.058, 0.050, 0.165],
    c: [0.22, 0.46, 0.88],
    starTint: [0.80, 0.91, 1.0],
    lineTint: [0.46, 0.75, 1.0],
  },
  solar: {
    name: "Solar Gold",
    a: [0.048, 0.024, 0.014],
    b: [0.155, 0.080, 0.032],
    c: [0.86, 0.62, 0.24],
    starTint: [1.0, 0.92, 0.72],
    lineTint: [1.0, 0.78, 0.42],
  },
  rose: {
    name: "Rose Nebula",
    a: [0.050, 0.015, 0.042],
    b: [0.155, 0.048, 0.115],
    c: [0.86, 0.40, 0.62],
    starTint: [1.0, 0.85, 0.93],
    lineTint: [0.96, 0.58, 0.78],
  },
  aurora: {
    name: "Aurora Teal",
    a: [0.007, 0.036, 0.048],
    b: [0.028, 0.120, 0.140],
    c: [0.18, 0.82, 0.72],
    starTint: [0.82, 1.0, 0.96],
    lineTint: [0.36, 0.92, 0.84],
  },
  ember: {
    name: "Crimson Ember",
    a: [0.054, 0.012, 0.015],
    b: [0.175, 0.040, 0.032],
    c: [0.90, 0.34, 0.18],
    starTint: [1.0, 0.84, 0.68],
    lineTint: [1.0, 0.54, 0.32],
  },
  lunar: {
    name: "Lunar Silver",
    a: [0.015, 0.022, 0.046],
    b: [0.065, 0.085, 0.145],
    c: [0.62, 0.72, 0.90],
    starTint: [0.93, 0.96, 1.0],
    lineTint: [0.72, 0.82, 0.98],
  },
  violet: {
    name: "Violet Dream",
    a: [0.032, 0.015, 0.068],
    b: [0.115, 0.048, 0.215],
    c: [0.62, 0.40, 0.92],
    starTint: [0.92, 0.85, 1.0],
    lineTint: [0.76, 0.56, 1.0],
  },
  ocean: {
    name: "Abyssal Sapphire",
    a: [0.007, 0.028, 0.065],
    b: [0.024, 0.095, 0.19],
    c: [0.18, 0.62, 0.88],
    starTint: [0.80, 0.96, 1.0],
    lineTint: [0.34, 0.78, 1.0],
  },
};

export const CONSTELLATIONS = {};

for (const [key, raw] of Object.entries(IAU_88_RAW)) {
  CONSTELLATIONS[key] = {
    iau: raw.iau,
    name: raw.name,
    en: raw.en,
    title: raw.title,
    palette: PALETTES[raw.pal] || PALETTES.astral,
    transition: raw.tr || "orbital",
    center: raw.c, // [raDeg, decDeg]
    points: raw.p.map(([x, y, ra, dec, primary, size, mag, temp, pname, desig]) => {
      const bayer = desig && !desig.startsWith("HIP ") && !desig.endsWith(" Star")
        ? `${desig} ${raw.iau}`
        : (desig || `${raw.iau}`);
      return {
        x,
        y,
        ra,
        dec,
        primary: Boolean(primary),
        size,
        mag,
        temp,
        name: pname || bayer,
        properName: pname || "",
        desig: bayer,
      };
    }),
    edges: raw.e,
  };
}

export const CONSTELLATION_KEYS = Object.keys(CONSTELLATIONS);
