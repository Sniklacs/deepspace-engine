// battle-camera.test.ts — camera-origin model + deployment zone + LOD gating.
// (Seamless World Phase 2, slices 7 + 12.)
import { describe, expect, test } from "bun:test";
import {
  audioBandFor,
  bandForContinuumScale,
  defaultBattleCamera,
  DEPLOY_CX,
  DEPLOY_CY,
  DEPLOY_H,
  DEPLOY_W,
  detailForBand,
  DOCTRINE_LANES,
  MANEUVER_MARGIN,
  rebaseOrigin,
  screenToWorld,
  softClampX,
  softClampY,
  worldToScreen,
  type BattleCamera,
} from "./battle-camera";
import { WORLD_CX, WORLD_CY, WORLD_H, WORLD_W } from "./battle-scene-model";

describe("deployment zone", () => {
  test("preserves the old 1.5×1.5 field constants verbatim", () => {
    expect(DEPLOY_W).toBe(1.5);
    expect(DEPLOY_H).toBe(1.5);
    expect(DEPLOY_W).toBe(WORLD_W);
    expect(DEPLOY_H).toBe(WORLD_H);
    expect(DEPLOY_CX).toBe(WORLD_CX);
    expect(DEPLOY_CY).toBe(WORLD_CY);
  });

  test("doctrine lanes resolve every vector relative to the zone", () => {
    const vectors = ["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"] as const;
    expect(Object.keys(DOCTRINE_LANES)).toHaveLength(5);
    for (const v of vectors) {
      expect(DOCTRINE_LANES[v]).toBeDefined();
      expect(DOCTRINE_LANES[v].x).toBeGreaterThan(0);
      expect(DOCTRINE_LANES[v].x).toBeLessThan(DEPLOY_W);
      expect(DOCTRINE_LANES[v].spread).toBeGreaterThan(0);
    }
  });
});

describe("soft clamps", () => {
  test("keep in-zone values untouched", () => {
    expect(softClampX(0.75)).toBe(0.75);
    expect(softClampY(1.2)).toBe(1.2);
    expect(softClampX(0.06)).toBe(0.06);
    expect(softClampY(1.44)).toBe(1.44);
  });

  test("allow orders beyond the old hard walls (0.06..1.44)", () => {
    // The old walls snapped these back; the soft clamp lets them stand.
    expect(softClampX(1.8)).toBe(1.8);
    expect(softClampX(-0.2)).toBe(-0.2);
    expect(softClampY(1.9)).toBe(1.9);
    expect(softClampY(-0.4)).toBe(-0.4);
  });

  test("still clamp far outside the maneuver area", () => {
    expect(softClampX(9)).toBe(DEPLOY_W + MANEUVER_MARGIN);
    expect(softClampX(-9)).toBe(-MANEUVER_MARGIN);
    expect(softClampY(9)).toBe(DEPLOY_H + MANEUVER_MARGIN);
    expect(softClampY(-9)).toBe(-MANEUVER_MARGIN);
  });
});

describe("world↔screen transforms", () => {
  const cam: BattleCamera = { ...defaultBattleCamera(), zoom: 2, ysq: 0.8, fy: 0.6 };

  test("round-trip world→screen→world, including beyond the old bounds", () => {
    const pts: Array<[number, number]> = [
      [0.75, 0.75],
      [0, 0],
      [1.5, 1.5],
      [2.3, -0.4],
      [-1.1, 3.3],
    ];
    for (const [x, y] of pts) {
      const s = worldToScreen(cam, 800, 600, x, y);
      const w = screenToWorld(cam, 800, 600, s.sx, s.sy);
      expect(w.x).toBeCloseTo(x, 10);
      expect(w.y).toBeCloseTo(y, 10);
    }
  });

  test("the camera origin lands on the focus point", () => {
    const s = worldToScreen(cam, 800, 600, cam.ox, cam.oy);
    expect(s.sx).toBeCloseTo(400, 10);
    expect(s.sy).toBeCloseTo(600 * 0.6, 10);
  });

  test("default camera centers on the deployment zone", () => {
    const d = defaultBattleCamera();
    expect(d.ox).toBe(DEPLOY_CX);
    expect(d.oy).toBe(DEPLOY_CY);
    expect(d.tileX).toBe(0);
    expect(d.tileY).toBe(0);
  });

  test("rebase keeps the origin near zero without moving anything on screen", () => {
    const far: BattleCamera = { ...cam, ox: 12.4, oy: -7.1 };
    const rebased = rebaseOrigin(far, 1.5);
    expect(Math.abs(rebased.ox)).toBeLessThan(0.75 + 1e-9);
    expect(Math.abs(rebased.oy)).toBeLessThan(0.75 + 1e-9);
    expect(rebased.tileX).toBeCloseTo(-12, 10);
    expect(rebased.tileY).toBeCloseTo(7.5, 10);
    for (const [x, y] of [[12.0, -7.0], [0.75, 0.75], [2.3, -0.4]] as const) {
      const a = worldToScreen(far, 800, 600, x, y);
      const b = worldToScreen(rebased, 800, 600, x, y);
      expect(b.sx).toBeCloseTo(a.sx, 10);
      expect(b.sy).toBeCloseTo(a.sy, 10);
    }
  });

  test("rebase is a no-op for a bad tile size", () => {
    expect(rebaseOrigin(cam, 0)).toEqual(cam);
    expect(rebaseOrigin(cam, -2)).toEqual(cam);
  });
});

describe("zoom-band detail LOD", () => {
  test("Z3 and above render shapes; only Z4 renders full models", () => {
    expect(detailForBand("Z0")).toBe("shapes");
    expect(detailForBand("Z1")).toBe("shapes");
    expect(detailForBand("Z2")).toBe("shapes");
    expect(detailForBand("Z3")).toBe("shapes");
    expect(detailForBand("Z4")).toBe("full");
  });

  test("bandForContinuumScale maps the continuum axis; standalone stays Z4", () => {
    expect(bandForContinuumScale(null)).toBe("Z4");
    expect(bandForContinuumScale(undefined)).toBe("Z4");
    expect(bandForContinuumScale(1)).toBe("Z1");
    expect(bandForContinuumScale(9)).toBe("Z3");
    expect(bandForContinuumScale(18)).toBe("Z4");
    expect(bandForContinuumScale(Number.NaN)).toBe("Z4");
  });

  test("audioBandFor maps bands to the bus's 1..4 audio LOD (Z0 silent)", () => {
    expect(audioBandFor("Z0")).toBe(1);
    expect(audioBandFor("Z1")).toBe(1);
    expect(audioBandFor("Z2")).toBe(2);
    expect(audioBandFor("Z3")).toBe(3);
    expect(audioBandFor("Z4")).toBe(4);
  });
});
