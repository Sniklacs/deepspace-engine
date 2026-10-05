// Tests for the snap-to-site focus math (components/WorldGlobe.tsx) —
// owner 2026-10-04: tapping an incoming raid's location eases the globe to
// center the raided site. The easing itself runs in the canvas frame loop;
// these tests cover the pure kernel: spin/tilt targeting + shortest-path
// deltas. Run: bun test site/src/components/WorldGlobe.test.ts
import { describe, expect, test } from "bun:test";
import { ARENA_MARKER_SIZE, focusViewTarget, shortestSpinDelta } from "./WorldGlobe";
import { projectGlobe } from "../game/globe-layers";

describe("focusViewTarget", () => {
  test("centers the target: projection lands dead-center on screen", () => {
    const cases: [number, number][] = [
      [10, 40],
      [-25, -120],
      [50, 179],
      [0, 0],
      [-50, 90],
      [14, -73.5],
    ];
    for (const [lat, lon] of cases) {
      const { spin, tilt } = focusViewTarget(lat, lon);
      const p = projectGlobe(lat, lon, spin, tilt);
      expect(p.visible).toBe(true);
      expect(Math.abs(p.x)).toBeLessThan(1e-9);
      expect(Math.abs(p.y)).toBeLessThan(1e-9);
      expect(p.z).toBeGreaterThan(0.99);
    }
  });

  test("spin is normalized to [0, 360)", () => {
    expect(focusViewTarget(0, -50).spin).toBe(50);
    expect(focusViewTarget(0, 370).spin).toBe(350);
    expect(focusViewTarget(0, 180).spin).toBe(180);
    for (const lon of [-180, -0.5, 0, 45, 179.9, 360, 725]) {
      const s = focusViewTarget(10, lon).spin;
      expect(s >= 0 && s < 360).toBe(true);
    }
  });

  test("tilt clamps to the globe's drag range", () => {
    expect(focusViewTarget(80, 0).tilt).toBe(55);
    expect(focusViewTarget(-80, 0).tilt).toBe(-55);
    expect(focusViewTarget(20, 0).tilt).toBe(20);
  });
});

describe("shortestSpinDelta", () => {
  test("takes the short way around the meridian", () => {
    expect(shortestSpinDelta(350, 10)).toBe(20);
    expect(shortestSpinDelta(10, 350)).toBe(-20);
    expect(shortestSpinDelta(0, 90)).toBe(90);
    expect(shortestSpinDelta(90, 0)).toBe(-90);
  });

  test("result stays within [-180, 180]", () => {
    const pairs: [number, number][] = [
      [0, 180],
      [720, -540],
      [123.4, 456.7],
      [-45, -45],
    ];
    for (const [from, to] of pairs) {
      const d = shortestSpinDelta(from, to);
      expect(d >= -180 && d <= 180).toBe(true);
    }
  });

  test("same angle gives zero", () => {
    expect(shortestSpinDelta(42, 42)).toBe(0);
    expect(shortestSpinDelta(10, 370)).toBe(0);
  });
});

describe("WS-A ARENA_MARKER_SIZE", () => {
  test("stadium renders ~2-3x the dot-icon size (reads at small size)", () => {
    const DOT_ICON_PX = 20;
    expect(ARENA_MARKER_SIZE.normal >= 2 * DOT_ICON_PX).toBe(true);
    expect(ARENA_MARKER_SIZE.normal <= 3 * DOT_ICON_PX).toBe(true);
    expect(ARENA_MARKER_SIZE.selected).toBeGreaterThan(ARENA_MARKER_SIZE.normal);
  });
});
