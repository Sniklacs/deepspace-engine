// Zoom-band audio LOD — pure mappings for the battle soundscape
// (seamless-world spec §5, Phase 2 slice 5).
//
// Owner doctrine, literal: "the closer you get, the more detail renders and
// the sound fades in — from space you see the dust, on the ground you hear
// the war."
//
//   Z1 (orbit):         silent — from orbit you see the dust, not the war.
//   Z2 (high altitude): threshold shimmer — the faintest rumble below.
//   Z3 (low altitude):  distant rumble — bombardment reads as distant.
//   Z4 (ground):        the full soundscape; the live camera drives.
//
// These are presentation-only pure functions: no audio, no sim. The battle
// bus (game/war/battle-sfx.ts) applies zoomBusGain onto its bus gain and
// feeds zoomVirtualRadius into the EXISTING blastGain/blastCutoff distance
// curve — one curve, fed by zoom, never a second distance model. The mute
// toggle is untouched (master still governs the bus).

/** Seamless-world zoom bands with battle audio: Z1 orbit … Z4 ground.
 *  (Z0, the solar-system layer, has no battle audio — it maps to Z1.) */
export type ZoomBand = 1 | 2 | 3 | 4;

/** Zoom-driven battle bus gain multiplier. Exactly 0 at Z1 (silent), exactly
 *  1 at Z4 (full), strictly increasing as altitude drops. */
export function zoomBusGain(band: ZoomBand): number {
  switch (band) {
    case 1: return 0;
    case 2: return 0.08;
    case 3: return 0.35;
    case 4: return 1;
  }
}

/** Zoom-driven virtual camera radius, fed into dist() so the EXISTING
 *  blastGain/blastCutoff curve does the altitude work. At altitude the audio
 *  pretends the view radius is small, so every explosion reads at/beyond the
 *  view edge on the same exponential falloff: far-field whisper, highs
 *  rolled off. The radius grows as you descend, so the lowpass cutoff OPENS
 *  continuously into Z4 — where 0 means "no override, the live camera's own
 *  radius drives." Z1's value is inert (bus gain is 0 — silence). */
export function zoomVirtualRadius(band: ZoomBand): number {
  switch (band) {
    case 1: return 0.3;
    case 2: return 0.35;
    case 3: return 0.8;
    case 4: return 0;
  }
}

/** Resolve any frame-loop zoom value to a band. Out-of-range clamps to the
 *  nearest band (Z0 system view → Z1 silent); non-finite fails safe to Z1 —
 *  a broken zoom value must never blast the full soundscape. */
export function clampZoomBand(z: number): ZoomBand {
  if (!Number.isFinite(z)) return 1;
  const b = Math.round(z);
  if (b <= 1) return 1;
  if (b >= 4) return 4;
  return b as ZoomBand;
}
