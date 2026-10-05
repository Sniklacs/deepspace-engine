// Solar math — GLOBE WAVE 3 (WS5: real day/night cycle), Hans Oct 4 2026.
// "If it's getting dark where I am, my colony gets dark; when it's getting
// light out, my colony gets light." This file is the server's first real
// clock: pure, deterministic functions that turn a UTC date into the
// subsolar point. No I/O, no Date.now() inside — the caller owns the clock
// (WorldGlobe drives it from the device clock, updated every 60s and on
// visibility regain).
//
// WHAT WE IMPLEMENT (documented, not hidden):
// - Solar declination: the standard low-precision approximation
//   δ ≈ −23.44° × cos(2π × (dayOfYear + 10) / 365).
//   Good to ~±1° — plenty for a terminator line on a game globe.
// - Subsolar longitude: λ = 180° − 15° × UTC_hours, normalized to
//   (−180°, 180°]. At 12:00 UTC the subsolar point sits at 0° (the
//   prime-meridian convention); at 00:00 UTC it sits at ±180°.
// - We deliberately SKIP the equation of time (±15 min of solar-time
//   wobble) and atmospheric refraction/twilight modeling: invisible at the
//   fidelity a canvas terminator needs, and every term we skip is one fewer
//   surprise for the next reader.
//
// MAPPING CHOICE (Hans's ask, documented for the record):
// The game globe is NOT Earth — there is no reason the sun should rise over
// Greenwich. So the day/night PHASE is anchored to the PLAYER, not to a
// planet: `anchoredSubsolarPoint(homeLonDeg, date)` rotates the whole
// lighting phase so the home colony's local solar time equals the player's
// DEVICE-local time. Device clock reads midnight → the colony sits at the
// antimeridian of the sun (full dark). Device clock reads noon → the
// subsolar point sits over the colony (full light).
//
// Limits of this choice (say them out loud):
// 1. It ignores the player's real longitude — phase comes from device clock
//    + colony globe longitude only. Flying across time zones moves your
//    colony's daylight with you. That is the requested behavior.
// 2. Subsolar LATITUDE stays the real solar declination, so the terminator
//    still tilts with the seasons — the globe keeps a real yearly rhythm.
// 3. Hive relocation changes homeLon → the phase re-anchors (the sun
//    updater picks it up on its next tick).

/** 1-based day of year in UTC (Jan 1 = 1). Pure. */
export function dayOfYearUTC(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / 86_400_000) + 1;
}

/** Normalize degrees to (−180, 180]. Pure. */
export function normalizeLon180(deg: number): number {
  let l = deg % 360;
  if (l <= -180) l += 360;
  else if (l > 180) l -= 360;
  return l;
}

/**
 * Solar declination in degrees — the subsolar latitude.
 * δ ≈ −23.44° × cos(2π × (dayOfYear + 10) / 365).
 * June solstice → ≈ +23.44°, December solstice → ≈ −23.44°,
 * equinoxes → ≈ 0°. Pure.
 */
export function solarDeclinationDeg(date: Date): number {
  const doy = dayOfYearUTC(date);
  return -23.44 * Math.cos((2 * Math.PI * (doy + 10)) / 365);
}

/**
 * Earth-convention subsolar longitude: 180° − 15° × UTC_hours,
 * normalized to (−180, 180°]. 12:00 UTC → 0°, 00:00 UTC → ±180°.
 * Pure. (The game globe does not use this directly — see
 * `anchoredSubsolarPoint` — but it is the honest Earth reference and the
 * unit-test anchor for the convention.)
 */
export function subsolarLongitudeDeg(date: Date): number {
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return normalizeLon180(180 - 15 * utcHours);
}

/** Earth-convention subsolar point (reference; see mapping note above). Pure. */
export function subsolarPoint(date: Date): { lat: number; lon: number } {
  return { lat: solarDeclinationDeg(date), lon: subsolarLongitudeDeg(date) };
}

/**
 * Player-anchored subsolar point — the one WorldGlobe actually renders.
 * Rotates the lighting phase so the home colony (globe longitude
 * `homeLonDeg`) experiences device-local midnight as darkest night and
 * device-local noon as full daylight:
 *
 *   lon = homeLon + 180° − 15° × deviceLocalHours   (normalized)
 *
 * Latitude stays the real solar declination (seasonal terminator tilt).
 * Pure — the device-local hour comes from the passed date, so tests can
 * pin it with `new Date(y, m, d, h, …)` regardless of the runner's TZ.
 */
export function anchoredSubsolarPoint(
  homeLonDeg: number,
  date: Date,
): { lat: number; lon: number } {
  const localHours =
    date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  return {
    lat: solarDeclinationDeg(date),
    lon: normalizeLon180(homeLonDeg + 180 - 15 * localHours),
  };
}

/**
 * Night factor for a surface point, in view space. `p` is the unit surface
 * normal (projectGlobe's x/y/z — the globe IS the normal field); `s` is the
 * unit sun vector in the same space (the projected subsolar point).
 * Returns 0 in full daylight → 1 in full night, with a soft twilight band
 * around the terminator (dot ≈ 0). Pure.
 */
export function nightFactor(
  px: number, py: number, pz: number,
  sx: number, sy: number, sz: number,
): number {
  const d = px * sx + py * sy + pz * sz;
  // dot > +0.12 → day, dot < −0.12 → night; smooth between.
  const t = (0.12 - d) / 0.24;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/**
 * Unit sun vector in view space from a subsolar lat/lon and the current
 * spin/tilt. This is the SAME math as projectGlobe (globe-layers.ts) minus
 * the screen-space y-flip — factored out so the render loop can get the
 * sun direction without projecting a dummy point. Pure.
 */
export function sunViewVector(
  subLatDeg: number,
  subLonDeg: number,
  spinDeg: number,
  tiltDeg: number,
): { x: number; y: number; z: number } {
  const phi = (subLatDeg * Math.PI) / 180;
  const lam = (subLonDeg * Math.PI) / 180;
  let x = Math.cos(phi) * Math.sin(lam);
  let y = Math.sin(phi);
  let z = Math.cos(phi) * Math.cos(lam);
  const s = (spinDeg * Math.PI) / 180;
  const x1 = x * Math.cos(s) + z * Math.sin(s);
  const z1 = -x * Math.sin(s) + z * Math.cos(s);
  x = x1;
  z = z1;
  const t = (tiltDeg * Math.PI) / 180;
  const y1 = y * Math.cos(t) - z * Math.sin(t);
  const z2 = y * Math.sin(t) + z * Math.cos(t);
  // projectGlobe flips y for screen space; the night-factor dot product
  // needs the same convention, so flip here too (both sides consistent).
  return { x, y: -y1, z: z2 };
}
