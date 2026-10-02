// shipyard.test.ts — Alliance Ship Factory tests.
import { describe, expect, test } from "bun:test";
import {
  buildReady,
  createShipBuild,
  emptyPersonalShipyard,
  emptyShipyard,
  ensureShipyard,
  recalcBuildDoneAt,
  shipBuildDurationMs,
  shipFromBuild,
  type AllianceLike,
} from "./shipyard";
import { SHIP_BUILD_MS } from "./worldmap";

function mockAlliance(): AllianceLike & Record<string, unknown> {
  const a: AllianceLike & Record<string, unknown> = {
    name: "Test Alliance",
    banner: "🚀",
    motto: "To the stars",
    members: [],
    applications: [],
    invites: [],
    foundedAt: Date.now(),
    founderId: "col-1",
    homeServerId: "watchers-beta",
    version: 1,
  };
  a.id = "all-1";
  return a;
}

describe("shipBuildDurationMs", () => {
  test("0 contributors = full base time", () => {
    expect(shipBuildDurationMs("scout", 0, 1)).toBe(SHIP_BUILD_MS.scout);
    expect(shipBuildDurationMs("bulwark", 0, 1)).toBe(SHIP_BUILD_MS.bulwark);
  });

  test("more contributors = faster", () => {
    const base = shipBuildDurationMs("frigate", 0, 1);
    const with5 = shipBuildDurationMs("frigate", 5, 1);
    const with10 = shipBuildDurationMs("frigate", 10, 1);
    expect(with5).toBeLessThan(base);
    expect(with10).toBeLessThan(with5);
  });

  test("10 contributors ≈ half time", () => {
    const base = SHIP_BUILD_MS.vanguard;
    const with10 = shipBuildDurationMs("vanguard", 10, 1);
    // 1 + 10*0.1 = 2 → half time
    expect(with10).toBe(Math.round(base / 2));
  });

  test("higher level = faster", () => {
    const l1 = shipBuildDurationMs("herald", 5, 1);
    const l3 = shipBuildDurationMs("herald", 5, 3);
    expect(l3).toBeLessThan(l1);
  });

  test("never below 1 minute", () => {
    expect(shipBuildDurationMs("scout", 100, 10)).toBeGreaterThan(60_000 - 1);
  });
});

describe("emptyShipyard", () => {
  test("starts at level 1 with empty queue", () => {
    const sy = emptyShipyard();
    expect(sy.level).toBe(1);
    expect(sy.queue).toEqual([]);
    expect(sy.ships).toEqual([]);
    expect(sy.seq).toBe(1);
  });
});

describe("ensureShipyard", () => {
  test("backfills missing shipyard", () => {
    const a = mockAlliance();
    const sy = ensureShipyard(a);
    expect(sy.level).toBe(1);
    expect(a.shipyard).toBe(sy);
  });

  test("preserves existing shipyard", () => {
    const a = mockAlliance();
    a.shipyard = { level: 3, queue: [], ships: [], seq: 5 };
    const sy = ensureShipyard(a);
    expect(sy.level).toBe(3);
    expect(sy.seq).toBe(5);
  });
});

describe("createShipBuild", () => {
  test("creates a build with correct duration", () => {
    const now = Date.now();
    const build = createShipBuild("scout", "grays", "col-1", "Commander", 1, 1, now);
    expect(build.shipClass).toBe("scout");
    expect(build.raceId).toBe("grays");
    expect(build.startedAt).toBe(now);
    expect(build.doneAt).toBe(now + shipBuildDurationMs("scout", 1, 1));
    expect(build.contributors).toEqual([]);
  });
});

describe("shipFromBuild", () => {
  test("creates a ready JumpShip with race-specific name", () => {
    const now = Date.now();
    const build = createShipBuild("bulwark", "draconians", "col-1", "Commander", 1, 1, now);
    const ship = shipFromBuild(build, now);
    expect(ship.class).toBe("bulwark");
    expect(ship.raceId).toBe("draconians");
    expect(ship.name).toBe("Ashen Bulwark");
    expect(ship.status).toBe("ready");
  });
});

describe("recalcBuildDoneAt", () => {
  test("contributors only speed up, never slow down", () => {
    const now = Date.now();
    const build = createShipBuild("frigate", "grays", "col-1", "Commander", 0, 1, now);
    const originalDoneAt = build.doneAt;
    build.contributors.push("col-1", "col-2", "col-3");
    recalcBuildDoneAt(build, 1, now);
    expect(build.doneAt).toBeLessThan(originalDoneAt);
  });

  test("never pushes doneAt into the past", () => {
    const now = Date.now();
    const build = createShipBuild("scout", "grays", "col-1", "Commander", 0, 1, now);
    // Simulate 50 contributors joining late
    for (let i = 0; i < 50; i++) build.contributors.push(`col-${i}`);
    recalcBuildDoneAt(build, 1, now + 1000);
    expect(build.doneAt).toBeGreaterThan(now + 1000 + 60_000 - 1);
  });
});

describe("buildReady", () => {
  test("false before doneAt, true after", () => {
    const now = Date.now();
    const build = createShipBuild("scout", "grays", "col-1", "Commander", 0, 1, now);
    expect(buildReady(build, now)).toBe(false);
    expect(buildReady(build, build.doneAt)).toBe(true);
    expect(buildReady(build, build.doneAt + 1000)).toBe(true);
  });
});

describe("emptyPersonalShipyard", () => {
  test("starts empty", () => {
    const psy = emptyPersonalShipyard();
    expect(psy.queue).toEqual([]);
    expect(psy.ships).toEqual([]);
  });
});
