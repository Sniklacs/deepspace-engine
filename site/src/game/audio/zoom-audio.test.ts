// Unit tests for the zoom-band audio LOD pure mappings (no audio needed).

import { describe, expect, test } from "bun:test";
import { zoomBusGain, zoomVirtualRadius, clampZoomBand, type ZoomBand } from "./zoom-audio";
import { battleSfx } from "../war/battle-sfx";

const BANDS: ZoomBand[] = [1, 2, 3, 4];

describe("zoomBusGain", () => {
  test("Z1 orbit is exactly silent — from orbit you see the dust, not the war", () => {
    expect(zoomBusGain(1)).toBe(0);
  });
  test("Z4 ground is exactly full", () => {
    expect(zoomBusGain(4)).toBe(1);
  });
  test("gain rises strictly as altitude drops", () => {
    let prev = -1;
    for (const b of BANDS) {
      const g = zoomBusGain(b);
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
  });
  test("Z2 is a threshold shimmer, not a whisper of full volume", () => {
    expect(zoomBusGain(2)).toBeGreaterThan(0.04);
    expect(zoomBusGain(2)).toBeLessThan(0.11);
  });
  test("Z3 is a distant rumble", () => {
    expect(zoomBusGain(3)).toBeGreaterThan(0.19);
    expect(zoomBusGain(3)).toBeLessThan(0.51);
  });
});

describe("zoomVirtualRadius", () => {
  test("Z4 returns 0 — no override, the live camera's own radius drives", () => {
    expect(zoomVirtualRadius(4)).toBe(0);
  });
  test("altitude bands use a positive virtual radius", () => {
    expect(zoomVirtualRadius(1)).toBeGreaterThan(0);
    expect(zoomVirtualRadius(2)).toBeGreaterThan(0);
    expect(zoomVirtualRadius(3)).toBeGreaterThan(0);
  });
  test("radius opens as you descend — the cutoff blooms into Z4", () => {
    expect(zoomVirtualRadius(2)).toBeLessThan(zoomVirtualRadius(3));
  });
});

describe("clampZoomBand", () => {
  test("clamps out-of-range bands to the nearest end", () => {
    expect(clampZoomBand(0)).toBe(1);
    expect(clampZoomBand(-3)).toBe(1);
    expect(clampZoomBand(5)).toBe(4);
    expect(clampZoomBand(99)).toBe(4);
  });
  test("rounds fractional bands to the nearest", () => {
    expect(clampZoomBand(2.4)).toBe(2);
    expect(clampZoomBand(2.6)).toBe(3);
  });
  test("non-finite fails safe to silent Z1", () => {
    expect(clampZoomBand(NaN)).toBe(1);
    expect(clampZoomBand(Infinity)).toBe(1);
  });
});

describe("sibling interface", () => {
  test("battleSfx exposes setZoomAudioLevel and it is safe to call unattached", () => {
    // The sibling scene calls this from the frame loop with the current
    // zoom band. No AudioContext exists in tests — it must not throw.
    expect(typeof battleSfx.setZoomAudioLevel).toBe("function");
    battleSfx.setZoomAudioLevel(1);
    battleSfx.setZoomAudioLevel(2);
    battleSfx.setZoomAudioLevel(4);
    expect(battleSfx.setZoomAudioLevel).toBeDefined();
  });
});
