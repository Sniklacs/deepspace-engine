// camera-flights.ts — CINEMATIC CAMERA FLIGHTS for the seamless-world globe.
//
// Adapted from God's Eye View's camera techniques (MIT, Bilawal Sidhu):
//   - camera.js: flyTo with eased flights between viewpoints
//   - cameraVerbs.js: one motion at a time; ANY manual input cancels the
//     active flight (the "cancelFlight reflex")
//   - cameraGroundGuard.js: never leave the camera buried in the surface
//
// This is the PURE kernel: easing functions, flight state, and stepping.
// WorldGlobe.tsx owns the ViewState and the frame loop; this module only
// computes where the camera should be. No I/O, no DOM, no Date.now().

import { clampZoomScale, ZOOM_SCALE_MAX } from "./zoom-bands";
import { SCALE_MIN } from "../system-view";

// ---------------------------------------------------------------------------
// Easing functions (Cesium.EasingFunction equivalents, dependency-free)
// ---------------------------------------------------------------------------

export type EasingFn = (t: number) => number;

/** Linear — no easing. */
export const easeLinear: EasingFn = (t) => t;
/** Quadratic ease-in: slow start, accelerating. */
export const easeQuadIn: EasingFn = (t) => t * t;
/** Quadratic ease-out: fast start, decelerating into the target. */
export const easeQuadOut: EasingFn = (t) => t * (2 - t);
/** Cubic in-out: slow start, fast middle, gentle landing. GEV's default. */
export const easeCubicInOut: EasingFn = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
/** Quartic out: strong deceleration — for short hops that should "settle". */
export const easeQuartOut: EasingFn = (t) => 1 - Math.pow(1 - t, 4);

// ---------------------------------------------------------------------------
// Flight model
// ---------------------------------------------------------------------------

/** A camera waypoint: spin (deg), tilt (deg), scale (zoom). */
export interface CameraPose {
  spin: number;
  tilt: number;
  scale: number;
}

/** An active cinematic flight between two poses. */
export interface CameraFlight {
  from: CameraPose;
  to: CameraPose;
  /** Spin delta taking the shortest path (precomputed, handles wraparound). */
  spinDelta: number;
  durationS: number;
  elapsedS: number;
  easing: EasingFn;
  /** Monotonic id — lets callers detect stale flights. */
  id: number;
}

let flightIdCounter = 0;

/** Shortest signed angular delta in degrees (handles 0/360 wraparound). */
export function shortestDegDelta(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * Duration for a flight, scaled by how far the camera travels.
 * Short hops are quick; cross-globe dives take longer. Clamped so
 * nothing feels sluggish or rushed. (GEV tunes flyTo duration similarly.)
 */
export function flightDurationS(from: CameraPose, to: CameraPose): number {
  const spinDeg = Math.abs(shortestDegDelta(from.spin, to.spin));
  const tiltDeg = Math.abs(to.tilt - from.tilt);
  const zoomOctaves = Math.abs(Math.log2(Math.max(1e-6, to.scale) / Math.max(1e-6, from.scale)));
  // Weight: a full 180° spin ≈ 2 octaves of zoom ≈ 45° of tilt.
  const distance = spinDeg / 90 + tiltDeg / 45 + zoomOctaves / 2;
  return Math.min(4.5, Math.max(0.9, 0.9 + distance * 0.55));
}

/**
 * Begin a cinematic flight from the current pose to a destination.
 * Replaces any in-progress flight (one motion at a time — GEV rule).
 */
export function startFlight(
  from: CameraPose,
  to: CameraPose,
  opts?: { durationS?: number; easing?: EasingFn },
): CameraFlight {
  const clampedTo: CameraPose = {
    spin: to.spin,
    tilt: Math.max(-60, Math.min(60, to.tilt)),
    scale: clampZoomScale(to.scale),
  };
  return {
    from: { ...from },
    to: clampedTo,
    spinDelta: shortestDegDelta(from.spin, clampedTo.spin),
    durationS: opts?.durationS ?? flightDurationS(from, clampedTo),
    elapsedS: 0,
    easing: opts?.easing ?? easeCubicInOut,
    id: ++flightIdCounter,
  };
}

/** Flight result after stepping. */
export interface FlightStep {
  pose: CameraPose;
  /** True when the flight reached its destination this step. */
  done: boolean;
}

/**
 * Advance a flight by dt seconds. Returns the interpolated pose.
 * Pure — the caller writes the pose into its ViewState.
 */
export function stepFlight(flight: CameraFlight, dt: number): FlightStep {
  const elapsed = Math.min(flight.durationS, flight.elapsedS + dt);
  const t = flight.durationS > 0 ? elapsed / flight.durationS : 1;
  const e = flight.easing(Math.max(0, Math.min(1, t)));
  // Zoom interpolates in octave (log) space so the dive feels constant —
  // linear scale interpolation would rush the end and crawl the start.
  const fromOct = Math.log2(Math.max(1e-6, flight.from.scale));
  const toOct = Math.log2(Math.max(1e-6, flight.to.scale));
  const pose: CameraPose = {
    spin: flight.from.spin + flight.spinDelta * e,
    tilt: flight.from.tilt + (flight.to.tilt - flight.from.tilt) * e,
    scale: Math.pow(2, fromOct + (toOct - fromOct) * e),
  };
  return {
    pose,
    done: elapsed >= flight.durationS,
  };
}

// ---------------------------------------------------------------------------
// Ground guard (adapted from GEV's cameraGroundGuard.js)
// ---------------------------------------------------------------------------

/**
 * Minimum usable scale: the camera eye must stay above the rendered
 * surface. Below this the globe fills the frame and further zoom is
 * the planar region view (the morph handles the visual), not a dive
 * through the mesh. Returns the guarded scale.
 */
export function guardScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(ZOOM_SCALE_MAX, Math.max(SCALE_MIN, scale));
}
