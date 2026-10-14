// Action sounds — the audible half of the Click Law (owner, 2026-10-14).
//
// The law: every press answers in BOTH channels — a visual stamp AND a
// sound. His field report: "the sounds ARE there — just turn them up, make
// them louder or something." Measured, he was right: the legacy UI blips
// peaked at 0.05–0.09 (−26…−21 dBFS) under a 0.8-volume music program —
// present on paper, gone in the room, and doubly gone through a phone
// speaker that cannot reproduce the low fundamentals those recipes leaned
// on. This layer is the fix:
//
//   • LEVELS — recipes peak where a player can hear them over music
//     (ACTION_MIX below), rendered on a dedicated action bus under the
//     master limiter in game/sound.ts.
//   • PHONE TRUTH — every recipe carries a noise transient and/or energy
//     at 700 Hz–4 kHz, the band a phone speaker actually reproduces.
//   • FICTION VERBS — the receipt sounds speak the game's own words:
//     forge = an anvil strike, build = a stocked thock, buy = crate and
//     latch, refusal = a low blunt knock. A refusal is AUDIBLE on purpose:
//     a silent "no" is what tonight's complaints were made of.
//   • DUCKING — receipts, refusals and accepted orders dip the battle bed
//     (sound.duckBed) so the answer cuts through the war.
//   • DATA, NOT CODE — a surface registers a sound by naming one id from
//     SOUND_MAP (ActionButton/RowButton take a `sound` prop; anything else
//     calls playAction("forge")). One line, no new wiring.
//
// Mute governs everything here: playAction routes through SoundManager,
// which refuses while muted and whose master the toggle zeroes. Autoplay:
// the context only exists after the first user gesture (SoundManager.start
// is called inside the press handlers themselves), so nothing in this file
// can sound before the player has touched the game. No audio files, no
// synthesized VOICE — SFX are synthesized per the owner's doctrine; all
// music and all voices are his.

import { sound } from "../sound";

/** Every action sound in the game. Add an id here + a recipe below, and any
 *  surface can speak it in one line. */
export type ActionSoundId =
  | "press" // an ordinary button answering
  | "pressHeavy" // a weighty/destructive press
  | "tab" // switching tabs/sections
  | "open" // a sheet/panel opening
  | "close" // a sheet/panel closing
  | "forge" // FORGED — the anvil strike (forge roll, craft at the forge)
  | "build" // BUILT/STOCKED — supplies and materials taking shape
  | "buy" // LOADED — crate-and-latch of a purchase
  | "spend" // resources leaving the ledger (melt, costs)
  | "receipt" // a completed action's stamp (generic success receipt)
  | "error" // a REFUSAL — the game saying no, out loud
  | "order"; // a battle order accepted — comms chirp + stamp

/** One layer of a recipe. `gain` is the layer's peak on the action bus. */
export interface SoundLayer {
  kind: "tone" | "noise";
  /** tone: oscillator start frequency (Hz). noise: ignored. */
  freq?: number;
  /** tone: pitch-slide target (Hz). */
  slideTo?: number;
  type?: OscillatorType;
  dur: number;
  gain: number;
  delay?: number;
  /** tone: lowpass cutoff (Hz). */
  lowpass?: number;
  /** noise: filter shape. */
  filterType?: BiquadFilterType;
  filterFreq?: number;
  filterQ?: number;
  /** noise: sweep the filter to this frequency over the layer. */
  sweepTo?: number;
}

export interface SoundRecipe {
  layers: SoundLayer[];
  /** Dip the battle bed while this speaks (receipts, refusals, orders). */
  duck?: boolean;
}

/** The mix, in one place — the numbers the owner's "turn them up" bought.
 *  Peaks are recipe peaks on the action bus (bus gain 1.0, master limiter
 *  at −8 dBFS in game/sound.ts). For scale: the battle BED sits at
 *  0.012–0.055 (battle-sfx BED) and the intro music program runs at 0.8
 *  element volume — a receipt at 0.42 with the bed ducked to 42% is the
 *  loudest voice in the room for its half-second, which is the point. */
export const ACTION_MIX = {
  /** an ordinary press must clear the bed without shouting */
  pressPeak: 0.24,
  /** receipts are the loudest short sounds in the UI */
  receiptPeak: 0.42,
  /** a refusal is blunt, not shrill — level with receipts, lower in pitch */
  refusalPeak: 0.34,
  /** battle-bed gain multiplier while a ducked sound speaks */
  duckDepth: 0.42,
  /** how long the bed stays dipped for a ducked sound */
  duckHoldMs: 420,
} as const;

const T = (
  freq: number,
  gain: number,
  dur: number,
  opts: Partial<SoundLayer> = {}
): SoundLayer => ({ kind: "tone", freq, gain, dur, ...opts });

const N = (
  gain: number,
  dur: number,
  opts: Partial<SoundLayer> = {}
): SoundLayer => ({ kind: "noise", gain, dur, ...opts });

export const SOUND_MAP: Record<ActionSoundId, SoundRecipe> = {
  press: {
    layers: [
      N(0.1, 0.03, { filterFreq: 2600 }),
      T(1250, 0.12, 0.055, { type: "triangle", slideTo: 820 }),
      T(170, 0.12, 0.07, { slideTo: 95 }),
    ],
  },
  pressHeavy: {
    layers: [
      N(0.16, 0.04, { filterFreq: 1800 }),
      T(300, 0.13, 0.07, { type: "square", slideTo: 150, lowpass: 1200 }),
      T(120, 0.22, 0.11, { slideTo: 60 }),
    ],
  },
  tab: {
    layers: [
      T(640, 0.15, 0.07, { type: "triangle" }),
      T(960, 0.1, 0.08, { type: "sine", delay: 0.03 }),
    ],
  },
  open: {
    layers: [
      N(0.08, 0.12, { filterType: "bandpass", filterFreq: 900, filterQ: 1.1, sweepTo: 2400 }),
      T(520, 0.1, 0.1, { slideTo: 880 }),
    ],
  },
  close: {
    layers: [
      T(760, 0.1, 0.09, { slideTo: 420 }),
      N(0.08, 0.025, { filterFreq: 2000 }),
    ],
  },
  forge: {
    duck: true,
    layers: [
      // the strike — a hammer transient a phone speaker can actually carry
      N(0.2, 0.05, { filterFreq: 3200 }),
      // the anvil — inharmonic partials, the ring of struck metal
      T(523.25, 0.1, 0.5, { type: "triangle" }),
      T(1244, 0.07, 0.38),
      T(2093, 0.04, 0.3),
      // the body — low ring under the partials
      T(196, 0.12, 0.55, { slideTo: 98 }),
    ],
  },
  build: {
    duck: true,
    layers: [
      // the thock — lowpassed noise body + a falling sine, a thing set down
      N(0.22, 0.12, { filterType: "lowpass", filterFreq: 480 }),
      T(210, 0.2, 0.12, { slideTo: 100 }),
      // the settle — a late tick as it lands in the stack
      N(0.1, 0.02, { filterFreq: 2400, delay: 0.09 }),
      T(320, 0.06, 0.06, { delay: 0.09 }),
    ],
  },
  buy: {
    duck: true,
    layers: [
      // the crate set down…
      N(0.18, 0.1, { filterType: "lowpass", filterFreq: 520 }),
      T(190, 0.16, 0.1, { slideTo: 95 }),
      // …and the latch snapping shut, twice-checked
      N(0.12, 0.02, { filterFreq: 3000, delay: 0.07 }),
      N(0.1, 0.02, { filterFreq: 3000, delay: 0.13 }),
      T(1560, 0.06, 0.05, { delay: 0.13 }),
    ],
  },
  spend: {
    layers: [
      N(0.14, 0.035, { filterFreq: 2000 }),
      T(880, 0.08, 0.06, { type: "square", slideTo: 660, lowpass: 2000, delay: 0.05 }),
      T(130, 0.24, 0.13, { slideTo: 65 }),
    ],
  },
  receipt: {
    duck: true,
    layers: [
      T(784, 0.22, 0.09, { type: "triangle" }),
      T(1175, 0.26, 0.14, { type: "triangle", delay: 0.07 }),
      T(1568, 0.1, 0.2, { delay: 0.07 }),
    ],
  },
  error: {
    duck: true,
    layers: [
      // a low blunt knock, twice — the sound of a door that won't open.
      // The woody noise body is what carries it through a phone speaker;
      // the low tones alone would vanish there.
      N(0.16, 0.05, { filterType: "lowpass", filterFreq: 900 }),
      T(138, 0.2, 0.11, { type: "square", lowpass: 650 }),
      T(86, 0.22, 0.14, { slideTo: 60 }),
      N(0.13, 0.05, { filterType: "lowpass", filterFreq: 900, delay: 0.12 }),
      T(138, 0.18, 0.11, { type: "square", lowpass: 650, delay: 0.12 }),
      T(86, 0.2, 0.14, { slideTo: 60, delay: 0.12 }),
    ],
  },
  order: {
    duck: true,
    layers: [
      // comms chirp — two blips, handset-bright…
      T(1568, 0.14, 0.05),
      T(1175, 0.14, 0.05, { delay: 0.06 }),
      // …and the stamp that says it was received and entered
      T(180, 0.18, 0.09, { slideTo: 90, delay: 0.12 }),
      N(0.08, 0.025, { filterFreq: 2600, delay: 0.12 }),
    ],
  },
};

// ---------------------------------------------------------------------------
// Pure helpers — unit-tested, no audio needed.
// ---------------------------------------------------------------------------

/** The recipe's approximate peak: the largest sum of layer gains sounding at
 *  the same moment. Layers are grouped by their delay (layers sharing a
 *  delay start together); the peak is the biggest group's sum — envelopes
 *  decay, so this is a ceiling, which is what a mix budget wants. */
export function recipePeak(recipe: SoundRecipe): number {
  const byDelay = new Map<number, number>();
  for (const layer of recipe.layers) {
    const d = layer.delay ?? 0;
    byDelay.set(d, (byDelay.get(d) ?? 0) + layer.gain);
  }
  return Math.max(0, ...byDelay.values());
}

/** True when a layer can be heard through a phone speaker: a noise
 *  transient, or tonal energy in/above the 700 Hz–4 kHz carry band. */
export function layerCarriesOnPhone(layer: SoundLayer): boolean {
  if (layer.kind === "noise") return true;
  return (layer.freq ?? 0) >= 700;
}

/** The bed gain while ducked (pure form of the duckBed math in sound.ts). */
export function duckedBedGain(base: number, ducked: boolean): number {
  return ducked ? base * ACTION_MIX.duckDepth : base;
}

/** The gate every play passes: never muted, never before a window exists
 *  (SSR/first paint), never from a non-gesture cold start — SoundManager
 *  additionally creates its context only inside gesture handlers. */
export function shouldPlay(muted: boolean, hasWindow: boolean): boolean {
  return !muted && hasWindow;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

let duckTimer: ReturnType<typeof setTimeout> | null = null;

/** Play an action sound by id. Safe anywhere: inert on the server, inert
 *  while muted, inert until the first gesture has created the context. */
export function playAction(id: ActionSoundId): void {
  if (!shouldPlay(sound.muted, typeof window !== "undefined")) return;
  const recipe = SOUND_MAP[id];
  if (!recipe) return;
  if (recipe.duck) {
    sound.duckBed(true);
    if (duckTimer) clearTimeout(duckTimer);
    duckTimer = setTimeout(() => {
      duckTimer = null;
      sound.duckBed(false);
    }, ACTION_MIX.duckHoldMs);
  }
  for (const layer of recipe.layers) {
    if (layer.kind === "noise") {
      sound.noiseFx({
        dur: layer.dur,
        gain: layer.gain,
        delay: layer.delay ?? 0,
        filterType: layer.filterType ?? "highpass",
        filterFreq: layer.filterFreq ?? 2000,
        filterQ: layer.filterQ ?? 0.8,
        sweepTo: layer.sweepTo,
      });
    } else {
      sound.toneFx(layer.freq ?? 440, {
        type: layer.type ?? "sine",
        dur: layer.dur,
        gain: layer.gain,
        delay: layer.delay ?? 0,
        slideTo: layer.slideTo,
        lowpass: layer.lowpass,
      });
    }
  }
}
