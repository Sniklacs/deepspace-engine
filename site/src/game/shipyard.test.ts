// shipyard.test.ts — Alliance Ship Factory tests.
import { describe, expect, test } from "bun:test";
import {
  buildReady,
  contributeAllianceShip,
  createShipBuild,
  emptyPersonalShipyard,
  emptyShipyard,
  ensurePersonalShipyard,
  ensureShipyard,
  orderAllianceShip,
  payShipCost,
  recalcBuildDoneAt,
  shipBuildDurationMs,
  shipCostBlocker,
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

describe("shipCostBlocker / payShipCost", () => {
  const rich = {
    resources: { supplies: 100_000, alloys: 100, mats: { draconians: 500 } as Record<string, number> },
    race: "draconians",
  };
  test("affordable scout returns null", () => {
    expect(shipCostBlocker(rich, "scout")).toBeNull();
  });
  test("missing supplies reported first", () => {
    const poor = { resources: { supplies: 10, alloys: 100, mats: { draconians: 500 } as Record<string, number> }, race: "draconians" };
    const b = shipCostBlocker(poor, "frigate");
    expect(b?.kind).toBe("supplies");
    expect(b?.need).toBe(1000);
    expect(b?.have).toBe(10);
  });
  test("missing race material reported", () => {
    const p = { resources: { supplies: 100_000, alloys: 100, mats: { draconians: 1 } as Record<string, number> }, race: "draconians" };
    expect(shipCostBlocker(p, "frigate")?.kind).toBe("raceMaterial");
  });
  test("missing alloys reported", () => {
    const p = { resources: { supplies: 100_000, alloys: 0, mats: { draconians: 500 } as Record<string, number> }, race: "draconians" };
    expect(shipCostBlocker(p, "frigate")?.kind).toBe("alloys");
  });
  test("payShipCost deducts all three", () => {
    const p = { resources: { supplies: 100_000, alloys: 100, mats: { draconians: 500 } as Record<string, number> }, race: "draconians" };
    payShipCost(p, "frigate");
    expect(p.resources.supplies).toBe(99_000);
    expect(p.resources.mats["draconians"]).toBe(480);
    expect(p.resources.alloys).toBe(98);
  });
});

describe("orderAllianceShip", () => {
  test("member can order a warship; orderer auto-crews", () => {
    const a = mockAlliance() as unknown as import("./shipyard").ShipyardAlliance;
    a.members = [{ colonyId: "col-1" }];
    const r = orderAllianceShip(a, { shipClass: "frigate", raceId: "draconians", orderedBy: "col-1", orderedByName: "Warchief", now: Date.now() });
    expect(r.ok).toBe(true);
    expect(r.build?.contributors).toEqual(["col-1"]);
    expect(ensureShipyard(a).queue.length).toBe(1);
  });
  test("non-member is rejected", () => {
    const a = mockAlliance() as unknown as import("./shipyard").ShipyardAlliance;
    a.members = [{ colonyId: "col-9" }];
    const r = orderAllianceShip(a, { shipClass: "frigate", raceId: "draconians", orderedBy: "col-1", orderedByName: "Warchief", now: Date.now() });
    expect(r.ok).toBe(false);
  });
  test("scout rejected on alliance factory", () => {
    const a = mockAlliance() as unknown as import("./shipyard").ShipyardAlliance;
    a.members = [{ colonyId: "col-1" }];
    const r = orderAllianceShip(a, { shipClass: "scout", raceId: "draconians", orderedBy: "col-1", orderedByName: "Warchief", now: Date.now() });
    expect(r.ok).toBe(false);
  });
});

describe("contributeAllianceShip", () => {
  test("second member joins crew and speeds build", () => {
    const now = Date.now();
    const a = mockAlliance() as unknown as import("./shipyard").ShipyardAlliance;
    a.members = [{ colonyId: "col-1" }, { colonyId: "col-2" }];
    const o = orderAllianceShip(a, { shipClass: "frigate", raceId: "draconians", orderedBy: "col-1", orderedByName: "Warchief", now });
    const before = o.build!.doneAt;
    const r = contributeAllianceShip(a, o.build!.id, "col-2", now);
    expect(r.ok).toBe(true);
    expect(o.build!.contributors).toEqual(["col-1", "col-2"]);
    expect(o.build!.doneAt <= before).toBe(true);
  });
  test("duplicate contribute rejected", () => {
    const now = Date.now();
    const a = mockAlliance() as unknown as import("./shipyard").ShipyardAlliance;
    a.members = [{ colonyId: "col-1" }];
    const o = orderAllianceShip(a, { shipClass: "frigate", raceId: "draconians", orderedBy: "col-1", orderedByName: "Warchief", now });
    expect(contributeAllianceShip(a, o.build!.id, "col-1", now).ok).toBe(false);
  });
  test("unknown build rejected", () => {
    const a = mockAlliance() as unknown as import("./shipyard").ShipyardAlliance;
    a.members = [{ colonyId: "col-1" }];
    expect(contributeAllianceShip(a, "nope", "col-1", Date.now()).ok).toBe(false);
  });
});

describe("ensurePersonalShipyard", () => {
  test("backfills missing record", () => {
    const wm: { shipyard?: import("./shipyard").PersonalShipyard } = {};
    const psy = ensurePersonalShipyard(wm);
    expect(psy.queue).toEqual([]);
    expect(wm.shipyard).toBe(psy);
  });
});

describe("shipArtUrl", () => {
  test("draconians get v3 art paths", async () => {
    const { shipArtUrl } = await import("./worldmap");
    expect(shipArtUrl("draconians", "frigate")).toBe("/art/ships/frigate-v3.webp");
    expect(shipArtUrl("draconians", "scout")).toBe("/art/ships/scout-v3.webp");
  });
  test("races with art sets get paths; others get null", async () => {
    const { shipArtUrl } = await import("./worldmap");
    expect(shipArtUrl("annunaki", "scout")).toBe("/art/ships/annunaki-scout.webp");
    expect(shipArtUrl("ashtar", "vanguard")).toBe("/art/ships/ashtar-vanguard.webp");
    expect(shipArtUrl("watchers", "frigate")).toBeNull();
  });
});

describe("donateToShipyard", () => {
  test("adds to stockpile", async () => {
    const { donateToShipyard, ensureShipyard, ensureStockpile } = await import("./shipyard");
    const a = { members: [{ colonyId: "c1" }], shipyard: undefined } as unknown as import("./shipyard").ShipyardAlliance;
    const r = donateToShipyard(a, { supplies: 1000, alloys: 50, raceMats: 25 });
    expect(r.ok).toBe(true);
    const sp = ensureStockpile(ensureShipyard(a));
    expect(sp.supplies).toBe(1000);
    expect(sp.alloys).toBe(50);
    expect(sp.raceMats).toBe(25);
  });
  test("rejects negative", async () => {
    const { donateToShipyard } = await import("./shipyard");
    const a = { members: [] } as unknown as import("./shipyard").ShipyardAlliance;
    const r = donateToShipyard(a, { supplies: -1, alloys: 0, raceMats: 0 });
    expect(r.ok).toBe(false);
  });
  test("rejects empty donation", async () => {
    const { donateToShipyard } = await import("./shipyard");
    const a = { members: [] } as unknown as import("./shipyard").ShipyardAlliance;
    const r = donateToShipyard(a, { supplies: 0, alloys: 0, raceMats: 0 });
    expect(r.ok).toBe(false);
  });
});

describe("applyTithe", () => {
  test("zero rate keeps everything", async () => {
    const { applyTithe } = await import("./shipyard");
    const { tithed, kept } = applyTithe(0, { supplies: 1000, alloys: 100, raceMats: 50 });
    expect(tithed.supplies).toBe(0);
    expect(kept.supplies).toBe(1000);
  });
  test("10% tithe splits correctly", async () => {
    const { applyTithe } = await import("./shipyard");
    const { tithed, kept } = applyTithe(10, { supplies: 1000, alloys: 100, raceMats: 50 });
    expect(tithed.supplies).toBe(100);
    expect(kept.supplies).toBe(900);
    expect(tithed.alloys).toBe(10);
    expect(kept.alloys).toBe(90);
  });
  test("clamps over 100", async () => {
    const { applyTithe } = await import("./shipyard");
    const { tithed } = applyTithe(150, { supplies: 1000, alloys: 0, raceMats: 0 });
    expect(tithed.supplies).toBe(1000);
  });
});
