// pov-projection.test.ts — the command-ship POV pinhole camera (owner
// 2026-10-12 phase 2): project/unproject round-trips, the horizon, depth
// ordering, haze. Pure math — if these break, the view is a lie.
import { describe, expect, test } from "bun:test";
import {
  createPovCamera,
  groundEllipse,
  hazeFactor,
  horizonY,
  POV_HOVER_UNITS,
  POV_MAX_DEPTH,
  projectPoint,
  unprojectToGround,
} from "./pov-projection";

const W = 800;
const H = 600;

describe("pov camera", () => {
  test("hovers at 50ft in world units", () => {
    const cam = createPovCamera(0.75, 1.35);
    expect(cam.h).toBeCloseTo(POV_HOVER_UNITS, 6);
    expect(cam.h).toBeCloseTo(0.1, 6);
  });

  test("a point straight ahead at camera height lands on the horizon", () => {
    const cam = createPovCamera(0.75, 1.35);
    const p = projectPoint(cam, W, H, 0.75, 0.35, cam.h); // 1 unit north, level
    expect(p.visible).toBe(true);
    expect(p.sx).toBeCloseTo(W / 2, 4);
    expect(p.sy).toBeCloseTo(horizonY(cam, H), 4);
  });

  test("ground points rise toward the horizon with distance", () => {
    const cam = createPovCamera(0.75, 1.35);
    const near = projectPoint(cam, W, H, 0.75, 1.15); // 0.2 ahead
    const mid = projectPoint(cam, W, H, 0.75, 0.75); // 0.6 ahead
    const far = projectPoint(cam, W, H, 0.75, -0.6); // 1.95 ahead
    expect(near.visible && mid.visible && far.visible).toBe(true);
    // nearer = lower on screen (bigger sy), farther = closer to horizon
    expect(near.sy).toBeGreaterThan(mid.sy);
    expect(mid.sy).toBeGreaterThan(far.sy);
    expect(far.sy).toBeGreaterThan(horizonY(cam, H));
  });

  test("near troops are LARGE, far troops small — perspective scale", () => {
    const cam = createPovCamera(0.75, 1.35);
    const near = projectPoint(cam, W, H, 0.75, 1.15);
    const far = projectPoint(cam, W, H, 0.75, 0.35);
    expect(near.scale).toBeGreaterThan(far.scale * 3);
  });

  test("points behind the camera are not visible", () => {
    const cam = createPovCamera(0.75, 1.35);
    const behind = projectPoint(cam, W, H, 0.75, 1.6); // south = behind
    expect(behind.visible).toBe(false);
  });

  test("heading turns the view: east is to the right when facing north", () => {
    const cam = createPovCamera(0.75, 1.35);
    const east = projectPoint(cam, W, H, 1.35, 0.75);
    const west = projectPoint(cam, W, H, 0.15, 0.75);
    expect(east.sx).toBeGreaterThan(W / 2);
    expect(west.sx).toBeLessThan(W / 2);
    // turn east: the eastern point centers
    const camE = { ...cam, heading: Math.PI / 2 };
    const ahead = projectPoint(camE, W, H, 1.35, 1.35);
    expect(ahead.sx).toBeCloseTo(W / 2, 4);
  });

  test("project → unproject round-trips on the ground plane", () => {
    const cam = { ...createPovCamera(0.6, 1.3), heading: 0.3, pitch: 0.26 };
    for (const [wx, wy] of [
      [0.6, 0.9],
      [0.2, 0.4],
      [1.1, 0.2],
      [0.75, 1.05],
    ] as const) {
      const p = projectPoint(cam, W, H, wx, wy, 0);
      expect(p.visible).toBe(true);
      const back = unprojectToGround(cam, W, H, p.sx, p.sy);
      expect(back).not.toBeNull();
      expect(back!.x).toBeCloseTo(wx, 5);
      expect(back!.y).toBeCloseTo(wy, 5);
    }
  });

  test("unproject above the horizon returns null (sky taps)", () => {
    const cam = createPovCamera(0.75, 1.35);
    expect(unprojectToGround(cam, W, H, W / 2, 10)).toBeNull();
    expect(unprojectToGround(cam, W, H, W / 2, H - 10)).not.toBeNull();
  });

  test("haze grows with depth and saturates at the fog wall", () => {
    expect(hazeFactor(0.1)).toBe(0);
    expect(hazeFactor(1.2)).toBeGreaterThan(0);
    expect(hazeFactor(1.2)).toBeLessThan(1);
    expect(hazeFactor(POV_MAX_DEPTH)).toBe(1);
    expect(hazeFactor(9)).toBe(1);
  });

  test("ground ellipse foreshortens: wider than tall at grazing range", () => {
    const cam = createPovCamera(0.75, 1.35);
    const e = groundEllipse(cam, W, H, 0.75, 0.75, 0.05);
    expect(e).not.toBeNull();
    expect(e!.rx).toBeGreaterThan(e!.ry);
    // behind the camera → null
    expect(groundEllipse(cam, W, H, 0.75, 1.6, 0.05)).toBeNull();
  });
});
