// Unit tests for the action-sound layer (owner 2026-10-14, the Click Law's
// audible half). Pure data/math only — no AudioContext is created here.

import { describe, expect, test } from "bun:test";
import {
  ACTION_MIX,
  SOUND_MAP,
  duckedBedGain,
  layerCarriesOnPhone,
  recipePeak,
  shouldPlay,
  type ActionSoundId,
} from "./action-sounds";

const ALL_IDS: ActionSoundId[] = [
  "press", "pressHeavy", "tab", "open", "close",
  "forge", "build", "buy", "spend", "receipt", "error", "order",
];

describe("SOUND_MAP completeness", () => {
  test("every action sound id has a recipe", () => {
    for (const id of ALL_IDS) {
      expect(SOUND_MAP[id]).toBeDefined();
      expect(SOUND_MAP[id].layers.length).toBeGreaterThan(0);
    }
    expect(Object.keys(SOUND_MAP).sort()).toEqual([...ALL_IDS].sort());
  });

  test("every layer is well-formed", () => {
    for (const id of ALL_IDS) {
      for (const layer of SOUND_MAP[id].layers) {
        expect(layer.gain).toBeGreaterThan(0);
        expect(layer.dur).toBeGreaterThan(0);
        if (layer.kind === "tone") expect(layer.freq).toBeGreaterThan(0);
      }
    }
  });
});

describe("the mix — the owner's 'turn them up', as numbers", () => {
  test("a press peaks at the press target, not the old whisper (≤0.09)", () => {
    expect(recipePeak(SOUND_MAP.press) >= ACTION_MIX.pressPeak * 0.9).toBe(true);
  });

  test("receipts peak at the receipt target and out-speak a press", () => {
    expect(recipePeak(SOUND_MAP.receipt) >= ACTION_MIX.receiptPeak * 0.55).toBe(true);
    expect(recipePeak(SOUND_MAP.receipt)).toBeGreaterThan(recipePeak(SOUND_MAP.press));
    expect(recipePeak(SOUND_MAP.forge)).toBeGreaterThan(recipePeak(SOUND_MAP.press));
  });

  test("the refusal is blunt and present — near receipt level, never shrill", () => {
    expect(recipePeak(SOUND_MAP.error) >= ACTION_MIX.refusalPeak * 0.8).toBe(true);
    // blunt = its loudest layers live low; the peak group is not a high tone
    const peak = recipePeak(SOUND_MAP.error);
    const highLayers = SOUND_MAP.error.layers.filter((l) => (l.freq ?? 0) > 700);
    expect(highLayers.every((l) => l.gain < peak)).toBe(true);
  });

  test("no recipe can slam the limiter — every peak stays under 0.9", () => {
    for (const id of ALL_IDS) {
      expect(recipePeak(SOUND_MAP[id]) <= 0.9).toBe(true);
    }
  });

  test("receipts, refusals and orders duck the bed; plain presses don't", () => {
    for (const id of ["forge", "build", "buy", "receipt", "error", "order"] as ActionSoundId[]) {
      expect(SOUND_MAP[id].duck).toBe(true);
    }
    expect(SOUND_MAP.press.duck ?? false).toBe(false);
    expect(SOUND_MAP.tab.duck ?? false).toBe(false);
  });

  test("duck math: bed dips to the duck depth and restores whole", () => {
    expect(duckedBedGain(0.9, true)).toBeCloseTo(0.9 * ACTION_MIX.duckDepth, 5);
    expect(duckedBedGain(0.9, false)).toBe(0.9);
    expect(ACTION_MIX.duckDepth).toBeGreaterThan(0);
    expect(ACTION_MIX.duckDepth).toBeLessThan(1);
  });
});

describe("phone-speaker truth", () => {
  test("every recipe carries at least one layer a phone speaker reproduces", () => {
    for (const id of ALL_IDS) {
      expect(SOUND_MAP[id].layers.some(layerCarriesOnPhone)).toBe(true);
    }
  });
});

describe("fiction verbs", () => {
  test("forge rings an anvil — inharmonic partials, not a scale", () => {
    const freqs = SOUND_MAP.forge.layers.filter((l) => l.kind === "tone").map((l) => l.freq);
    expect(freqs.includes(523.25)).toBe(true);
    expect(freqs.includes(1244)).toBe(true);
    expect(freqs.includes(2093)).toBe(true);
    expect(SOUND_MAP.forge.layers.some((l) => l.kind === "noise")).toBe(true);
  });

  test("buy ends with the latch — late ticks after the crate lands", () => {
    const ticks = SOUND_MAP.buy.layers.filter((l) => (l.delay ?? 0) >= 0.07);
    expect(ticks.length >= 2).toBe(true);
  });

  test("order chirps twice, then stamps", () => {
    const tones = SOUND_MAP.order.layers.filter((l) => l.kind === "tone");
    expect(tones.map((l) => l.freq)).toEqual([1568, 1175, 180]);
  });
});

describe("the gate", () => {
  test("muted never plays; windowless never plays", () => {
    expect(shouldPlay(true, true)).toBe(false);
    expect(shouldPlay(false, false)).toBe(false);
    expect(shouldPlay(false, true)).toBe(true);
  });
});
