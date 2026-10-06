// Unit tests for the battle-SFX pure mappings (no audio needed).

import { describe, expect, test } from "bun:test";
import { blastGain, blastCutoff, stingerForPhase, BED, battleSfx } from "./battle-sfx";

describe("blastGain", () => {
  test("point-blank is near full", () => {
    expect(blastGain(0, false)).toBeGreaterThan(0.8);
  });
  test("falls off with distance", () => {
    const near = blastGain(0.1, false);
    const mid = blastGain(0.5, false);
    const far = blastGain(1.0, false);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(far).toBeLessThan(0.12);
  });
  test("ground cam hits harder at the same distance", () => {
    expect(blastGain(0.5, true)).toBeGreaterThan(blastGain(0.5, false));
  });
  test("clamps out-of-range inputs", () => {
    expect(blastGain(-1, false)).toBeCloseTo(blastGain(0, false), 5);
    expect(blastGain(5, false)).toBeCloseTo(blastGain(1.2, false), 5);
    expect(blastGain(1.2, true)).toBeLessThan(1.000001);
  });
});

describe("blastCutoff", () => {
  test("near blasts keep their top end, far blasts are muffled", () => {
    const near = blastCutoff(0);
    const far = blastCutoff(1);
    expect(near).toBeGreaterThan(7000);
    expect(far).toBeLessThan(500);
    expect(blastCutoff(0.5)).toBeGreaterThan(far);
    expect(blastCutoff(0.5)).toBeLessThan(near);
  });
  test("clamps out-of-range inputs", () => {
    expect(blastCutoff(-2)).toBe(blastCutoff(0));
    expect(blastCutoff(99)).toBe(blastCutoff(1.2));
  });
});

describe("stingerForPhase", () => {
  test("maps each doctrine phase to its stinger", () => {
    expect(stingerForPhase("approach")).toBe("approach");
    expect(stingerForPhase("touchdown")).toBe("touchdown");
    expect(stingerForPhase("contact")).toBe("contact");
    expect(stingerForPhase("weapons-free")).toBe("weaponsFree");
  });
  test("resolved earns no stinger (victor() owns the ending)", () => {
    expect(stingerForPhase("resolved")).toBeNull();
  });
});

describe("trigger surface", () => {
  // Every scene event the battle wires must have a live trigger method.
  // (Owner 2026-10-05: a silent battle traced to trigger wiring, so the
  // surface itself is pinned here.)
  test("exposes a trigger for every scene event", () => {
    for (const m of [
      "attach", "detach", "reset", "setCamera",
      "phase", "explosion", "tracer", "dropship", "flankCrash",
      "orderAccepted", "orderRejected", "uiClick", "victor",
    ] as const) {
      expect(typeof (battleSfx as any)[m]).toBe("function");
    }
  });
});

describe("BED shaping", () => {
  // The bed must read as wind + distant war on a phone speaker — highs
  // rolled off hard, punch in the low-mids, never narrow hiss ("rain").
  test("filter params stay within sane bounds", () => {
    expect(BED.rumbleCutoff).toBeLessThan(121);
    expect(BED.rumbleCutoff).toBeGreaterThan(40);
    expect(BED.rumbleGain).toBeLessThan(0.1001);
    expect(BED.windFreq).toBeLessThan(401);
    expect(BED.windFreq).toBeGreaterThan(149);
    expect(BED.windQ).toBeLessThan(1.5); // broad band — narrow Q whistles/hisses
    expect(BED.windGain).toBeLessThan(0.0301);
  });
});
