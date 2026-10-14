// Star map UI sound effects — DOLBY-level. Tactile sci-fi "puck" clicks with
// sub-bass punch, deep resonant booms on select, and a grand entrance swell.
// Entirely WebAudio-synthesized, no audio files. Built on game/audio/audio-core
// (shared context, cathedral reverb, compressor).
//
// Browser autoplay rule: the AudioContext is only created/resumed on the first
// user gesture — inert until then.

import { tone, noiseBurst, subDrop, boom } from "./audio-core";

/**
 * Hover tick — barely-there tactile tick when the pointer crosses a planet.
 * Throttled by the caller (StarMap only fires on planet-enter).
 */
export function playHover(): void {
  tone(3200, { type: "sine", dur: 0.025, gain: 0.04, wet: 0.3 });
}

/**
 * Click — the "puck": mechanical keycap noise + short mid blip,
 * now with a subtle low-end punch underneath.
 * (Levels lifted 2026-10-14, owner's field report: SFX existed but sat
 * inaudible under the music — these peaked at 0.06–0.1, ≈ −20 dBFS.)
 */
export function playClick(): void {
  noiseBurst({ dur: 0.035, gain: 0.15, filterType: "highpass", filterFreq: 2200, wet: 0.2 });
  tone(1400, { type: "triangle", dur: 0.05, gain: 0.11, slideTo: 900, wet: 0.25 });
  // low-end punch
  tone(140, { type: "sine", dur: 0.09, gain: 0.16, slideTo: 70, wet: 0.2 });
}

/**
 * Select — planet chosen: deep sub-bass drop + resonant boom + rising shimmer.
 * Should rattle speakers.
 */
export function playSelect(): void {
  // keycap attack
  noiseBurst({ dur: 0.05, gain: 0.1, filterType: "highpass", filterFreq: 900, wet: 0.3 });
  // the drop — 58Hz down to 30Hz
  subDrop({ from: 58, to: 30, dur: 1.1, gain: 0.5, wet: 0.3 });
  // resonant body
  tone(110, { type: "sine", dur: 0.5, gain: 0.2, slideTo: 55, wet: 0.5 });
  tone(220, { type: "triangle", dur: 0.35, gain: 0.11, slideTo: 110, wet: 0.5 });
  // shimmer rising out of the boom (the part a phone speaker hears — lifted
  // hardest, 2026-10-14; the sub-drop alone is invisible on small speakers)
  tone(880, { type: "sine", dur: 0.4, gain: 0.07, delay: 0.1, wet: 0.7 });
  tone(1320, { type: "sine", dur: 0.5, gain: 0.055, delay: 0.18, wet: 0.7 });
  tone(1760, { type: "sine", dur: 0.6, gain: 0.045, delay: 0.26, wet: 0.7 });
  tone(2640, { type: "sine", dur: 0.7, gain: 0.03, delay: 0.34, wet: 0.8 });
}

/** Deselect — the boom in reverse: falling tone, soft close. */
export function playDeselect(): void {
  tone(520, { type: "triangle", dur: 0.14, gain: 0.055, slideTo: 300, wet: 0.4 });
  tone(180, { type: "sine", dur: 0.2, gain: 0.09, slideTo: 90, wet: 0.3 });
  noiseBurst({ dur: 0.03, gain: 0.05, filterType: "highpass", filterFreq: 2000, wet: 0.2 });
}

/**
 * Confirm — "Claim Colony Here": mechanical double-click with bass,
 * then a rising confirmation swell.
 */
export function playConfirm(): void {
  noiseBurst({ dur: 0.04, gain: 0.11, filterType: "highpass", filterFreq: 1600, wet: 0.25 });
  tone(1100, { type: "triangle", dur: 0.06, gain: 0.07, slideTo: 800, wet: 0.3 });
  tone(150, { type: "sine", dur: 0.1, gain: 0.12, slideTo: 75, wet: 0.2 });
  noiseBurst({ dur: 0.04, gain: 0.12, delay: 0.09, filterType: "highpass", filterFreq: 1400, wet: 0.25 });
  tone(1650, { type: "triangle", dur: 0.09, gain: 0.075, delay: 0.09, slideTo: 1200, wet: 0.3 });
  tone(160, { type: "sine", dur: 0.12, gain: 0.12, delay: 0.09, slideTo: 80, wet: 0.2 });
  // confirmation swell
  subDrop({ from: 50, to: 36, dur: 0.9, gain: 0.3, delay: 0.2, wet: 0.4 });
  tone(2200, { type: "sine", dur: 0.4, gain: 0.035, delay: 0.25, wet: 0.8 });
  tone(3300, { type: "sine", dur: 0.5, gain: 0.022, delay: 0.33, wet: 0.8 });
}

/** Error / denied — low buzz for tapping a down/soon planet's claim button.
 *  (Lifted 2026-10-14: a refusal must be AUDIBLE — it was the quietest
 *  sound in the game, which is exactly backwards.) */
export function playDenied(): void {
  tone(200, { type: "square", dur: 0.1, gain: 0.09, lowpass: 900, wet: 0.3 });
  tone(160, { type: "square", dur: 0.15, gain: 0.09, delay: 0.09, lowpass: 800, wet: 0.3 });
  tone(90, { type: "sine", dur: 0.2, gain: 0.16, delay: 0.02, slideTo: 60, wet: 0.2 });
}

/** Spin whoosh — airy sweep when the user flings the map. */
export function playWhoosh(): void {
  noiseBurst({
    dur: 0.4, gain: 0.07,
    filterType: "bandpass", filterFreq: 400, filterQ: 1.1,
    sweepTo: 2600, wet: 0.5,
  });
}

/**
 * GRAND ENTRANCE — "You have arrived." Rising orchestral swell over ~3s,
 * cresting in a deep resonant boom with a long cathedral tail.
 * Call once when the star map first appears (after a user gesture).
 */
export function playEntrance(): void {
  // low rumble bed rising
  tone(36, { type: "sine", dur: 3.2, gain: 0.22, delay: 0, wet: 0.4 });
  tone(55, { type: "sine", dur: 3.2, gain: 0.14, delay: 0.1, wet: 0.4 });

  // rising brass swell — stacked saws, D minor
  const chord = [146.83, 174.61, 220.0, 293.66];
  for (const f of chord) {
    tone(f, { type: "sawtooth", dur: 2.6, gain: 0.028, delay: 0.15, lowpass: 1400, wet: 0.75 });
    tone(f * 2, { type: "sawtooth", dur: 2.6, gain: 0.014, delay: 0.3, lowpass: 2200, wet: 0.75 });
  }

  // riser — filtered noise climbing into the boom
  noiseBurst({
    dur: 2.2, gain: 0.1, delay: 0.2,
    filterType: "bandpass", filterFreq: 200, filterQ: 2.5,
    sweepTo: 4000, wet: 0.6,
  });

  // THE BOOM at the crest
  boom(2.4, 1.25);

  // halo shimmer after
  tone(880, { type: "sine", dur: 2.0, gain: 0.03, delay: 2.6, wet: 0.9 });
  tone(1174.66, { type: "sine", dur: 2.4, gain: 0.024, delay: 2.75, wet: 0.9 });
  tone(1760, { type: "sine", dur: 2.8, gain: 0.016, delay: 2.9, wet: 0.9 });

}
