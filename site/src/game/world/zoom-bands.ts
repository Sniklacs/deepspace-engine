// zoom-bands.ts — THE SEAMLESS-WORLD ZOOM CONTINUUM (Phase 2, slice 1).
//
// One continuous camera parameter `z` (the ViewState.scale axis in
// WorldGlobe.tsx), extended in BOTH directions: up into the already-shipped
// solar-system layer (game/system-view.ts) and down from the globe surface
// to the ground. There are no mode switches — only LOD bands on `z`.
//
// This module is the PURE kernel other agents import: band thresholds,
// band lookup, octave math, the sphere→plane morph factor, and the extended
// scale clamp. No I/O, no DOM, no Date.now() inside. WorldGlobe (canvas)
// only draws what these functions return.
//
// Scale conventions (increasing z = closer):
//   z < SYSTEM_GLOBE_SCALE (0.62)  → Z0 solar system (system-view.ts owns it)
//   0.62 ≤ z < BAND_Z2 (2)         → Z1 orbit (the globe, as it always was)
//   BAND_Z2 ≤ z < BAND_Z3 (6)      → Z2 high altitude (region view)
//   BAND_Z3 ≤ z < BAND_Z4 (14)     → Z3 low altitude (battle overview)
//   BAND_Z4 ≤ z ≤ ZOOM_SCALE_MAX    → Z4 ground (the battle scene)

import { SCALE_MIN, SYSTEM_GLOBE_SCALE } from "../system-view";

// ---------------------------------------------------------------------------
// Band thresholds
// ---------------------------------------------------------------------------

/** The five LOD bands of the zoom continuum, orbit → ground. */
export type ZoomBand = "Z0" | "Z1" | "Z2" | "Z3" | "Z4";

/** Z1 → Z2 boundary: the globe fills the frame and the sphere→plane morph
 *  begins. Past the old SCALE_MAX (3) — the axis now extends downward. */
export const BAND_Z2 = 2;
/** Z2 → Z3 boundary: the battle overview. */
export const BAND_Z3 = 6;
/** Z3 → Z4 boundary: the ground — full battle scene / cradle interior. */
export const BAND_Z4 = 14;
/** Deepest zoom: the bottom of the continuum. Past this, pinch-in holds. */
export const ZOOM_SCALE_MAX = 24;

/** The sphere→plane morph runs over the first half-octave of Z2, so each
 *  band still renders fully at its crossover scale (no stuck-between-bands). */
export const MORPH_START = BAND_Z2;
export const MORPH_END = BAND_Z2 + 1;

/** Human labels for the (temporary, dev) band readout + future headers. */
export const ZOOM_BAND_LABEL: Record<ZoomBand, string> = {
  Z0: "SYSTEM",
  Z1: "ORBIT",
  Z2: "HIGH ALT",
  Z3: "LOW ALT",
  Z4: "GROUND",
};

// ---------------------------------------------------------------------------
// Band lookup
// ---------------------------------------------------------------------------

/** Which LOD band a zoom scale sits in. Pure. */
export function bandForScale(z: number): ZoomBand {
  if (!Number.isFinite(z)) return "Z1";
  if (z < SYSTEM_GLOBE_SCALE) return "Z0";
  if (z < BAND_Z2) return "Z1";
  if (z < BAND_Z3) return "Z2";
  if (z < BAND_Z4) return "Z3";
  return "Z4";
}

/** A representative scale inside a band — tap-to-focus "ease z toward Z3"
 *  style targets. Pure. */
export function bandCenter(band: ZoomBand): number {
  switch (band) {
    case "Z0":
      return 0.3;
    case "Z1":
      return 1;
    case "Z2":
      return 3.5;
    case "Z3":
      return 9;
    case "Z4":
      return 18;
  }
}

// ---------------------------------------------------------------------------
// Octave math — pinch sensitivity is logarithmic: each doubling of finger
// distance = one octave of z (matches the existing smoothed targetScale
// easing in WorldGlobe).
// ---------------------------------------------------------------------------

/** Zoom scale → octaves (log2). Pure. */
export function octavesOf(z: number): number {
  return Math.log2(Math.max(1e-6, z));
}

/** Octaves → zoom scale. Pure. */
export function scaleOfOctaves(octaves: number): number {
  return Math.pow(2, octaves);
}

/** Octaves between two scales (signed). Pure. */
export function octavesBetween(from: number, to: number): number {
  return octavesOf(to) - octavesOf(from);
}

/** Smoothstep 0→1 over [a, b]. Pure. */
export function smoothstepBand(a: number, b: number, x: number): number {
  if (x <= a) return 0;
  if (x >= b) return 1;
  const t = (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/** Sphere→plane morph factor: 0 = pure globe projection, 1 = fully planar
 *  region view over the focus point. Smoothstepped so the curvature
 *  flattens without a pop or a cut. Pure. */
export function morphTFromScale(z: number): number {
  return smoothstepBand(MORPH_START, MORPH_END, z);
}

// ---------------------------------------------------------------------------
// Scale clamping — mirrors clampScale (system-view.ts) but extends the range
// DOWNWARD past the old SCALE_MAX (3) to ZOOM_SCALE_MAX. The solar-system
// side (SCALE_MIN) is untouched.
// ---------------------------------------------------------------------------

/** Clamp a zoom scale into the full continuum range. Pure. */
export function clampZoomScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(ZOOM_SCALE_MAX, Math.max(SCALE_MIN, scale));
}

/** True once the camera has left orbit for the high-altitude region view
 *  (the morph is underway or complete). Pure. */
export function isRegionDominant(z: number): boolean {
  return morphTFromScale(z) > 0.6;
}

/** True at ground level, where the full battle-scene / cradle command UI
 *  belongs (never at Z3's overview). Pure. */
export function isGroundLevel(z: number): boolean {
  return bandForScale(z) === "Z4";
}
