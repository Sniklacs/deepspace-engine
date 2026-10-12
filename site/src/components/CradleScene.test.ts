// Tests for the Cradle scene's pure helpers (components/CradleScene.tsx).
// The pan math and the building→destination map are DOM-free; the component
// itself is verified by the parent's live browser run.
import { describe, expect, test } from "bun:test";
import {
  CRADLE_HOTSPOTS,
  WORLD_W,
  WORLD_H,
  clampPan,
  minZoom,
} from "./CradleScene";

describe("minZoom", () => {
  test("covers the viewport on a phone-wide view", () => {
    // 390x700 phone viewport against the 1920x1080 world.
    const z = minZoom(390, 700);
    expect(WORLD_W * z).toBeGreaterThan(389);
    expect(WORLD_H * z).toBeGreaterThan(699);
  });
  test("zero view is safe", () => {
    expect(minZoom(0, 0)).toBe(1);
  });
});

describe("clampPan", () => {
  test("keeps the world covering the viewport", () => {
    const z = minZoom(390, 700);
    // Try to fling far out of bounds in every direction.
    const c = clampPan(-99999, -99999, z, 390, 700);
    expect(WORLD_W * z + c.x).toBeGreaterThan(389);
    expect(WORLD_H * z + c.y).toBeGreaterThan(699);
    expect(c.x).toBeLessThan(1);
    expect(c.y).toBeLessThan(1);
    const c2 = clampPan(99999, 99999, z, 390, 700);
    expect(c2.x).toBeLessThan(1);
    expect(c2.y).toBeLessThan(1);
  });
  test("in-bounds pan passes through", () => {
    const z = minZoom(390, 700) * 1.5; // zoomed in: room to pan in both axes
    const c = clampPan(-50, -80, z, 390, 700);
    expect(c.x).toBe(-50);
    expect(c.y).toBe(-80);
  });
});

describe("CRADLE_HOTSPOTS", () => {
  test("every module Hans named has a building", () => {
    const ids = CRADLE_HOTSPOTS.map((h) => h.id);
    for (const id of ["lab", "forge", "barracks", "alliance", "formations", "shipyard", "store"]) {
      expect(ids.indexOf(id) !== -1).toBe(true);
    }
  });
  test("destinations are real tabs or wired scene actions", () => {
    const tabs = ["lab", "troops", "alliance", "formations", "expeditions"];
    for (const h of CRADLE_HOTSPOTS) {
      const ok =
        tabs.includes(h.target) ||
        h.target === "forge" ||
        h.target === "store" ||
        h.target === "business" ||
        h.target === "shipyard";
      expect(ok).toBe(true);
    }
  });
  test("hotspot positions are on the canvas", () => {
    for (const h of CRADLE_HOTSPOTS) {
      expect(h.x).toBeGreaterThan(-1);
      expect(h.x).toBeLessThan(101);
      expect(h.y).toBeGreaterThan(-1);
      expect(h.y).toBeLessThan(101);
    }
  });
  test("ids are unique", () => {
    const ids = CRADLE_HOTSPOTS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
