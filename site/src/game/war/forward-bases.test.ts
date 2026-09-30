// Tests for forward bases (war/forward-bases.ts) — design/forward-base.md.
// Run: bun test site/src/game/war/forward-bases.test.ts
import { describe, expect, test } from "bun:test";
import {
  FORWARD_BASE_CONFIG,
  abandonAllForwardBases,
  advanceForwardBase,
  depositBands,
  depositRaidLoot,
  emptyServerBandPool,
  findBand,
  hireBandAtBase,
  jumpChargeSupplies,
  musterAtBase,
  plantForwardBase,
  poolCount,
  removeBand,
  siegeForwardBase,
  strikeForceWeight,
  type ForwardBase,
  type PlantRequest,
} from "./forward-bases";
import { TROOPS_CONFIG, addCohort, bandCount, rosterCount } from "./troops";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

function plantReq(over: Partial<PlantRequest> = {}): PlantRequest {
  return {
    serverId: "ashtar-prime",
    homeServerId: "draconis",
    label: "Test Beachhead",
    forceWeight: 100,
    lastJumpAt: null,
    existingServers: [],
    now: 1_000_000,
    seq: 7,
    ...over,
  };
}

function planted(over: Partial<PlantRequest> = {}): ForwardBase {
  const res = plantForwardBase(plantReq(over));
  if (!res.ok || !res.base) throw new Error(`plant failed: ${res.error}`);
  return res.base;
}

describe("planting — the jump", () => {
  test("plants a base with empty stockpile and full walls", () => {
    const res = plantForwardBase(plantReq());
    expect(res.ok).toBe(true);
    expect(res.base!.serverId).toBe("ashtar-prime");
    expect(res.base!.id).toBe("fb-7");
    expect(res.base!.supplies).toBe(0); // starts empty — lives off raiding
    expect(res.base!.wallHp).toBe(FORWARD_BASE_CONFIG.wallHp);
    expect(res.base!.home.roster.cohorts).toEqual([]);
    expect(res.chargeSupplies).toBe(
      FORWARD_BASE_CONFIG.kitSupplies + jumpChargeSupplies(100),
    );
  });

  test("refuses a second base on the same foreign server", () => {
    const res = plantForwardBase(plantReq({ existingServers: ["ashtar-prime"] }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/one per server/i);
  });

  test("refuses jumping to the home server", () => {
    const res = plantForwardBase(plantReq({ serverId: "draconis" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/home server/i);
  });

  test("enforces the 24h jump cooldown", () => {
    const now = 10 * DAY;
    const tooSoon = plantForwardBase(plantReq({ now, lastJumpAt: now - HOUR }));
    expect(tooSoon.ok).toBe(false);
    expect(tooSoon.error).toMatch(/recharging/i);
    const ready = plantForwardBase(plantReq({ now, lastJumpAt: now - DAY }));
    expect(ready.ok).toBe(true);
  });

  test("jump charge scales with force weight", () => {
    expect(jumpChargeSupplies(500)).toBeGreaterThan(jumpChargeSupplies(10));
    expect(jumpChargeSupplies(0)).toBe(FORWARD_BASE_CONFIG.jumpChargeBase);
  });
});

describe("muster at the beachhead", () => {
  test("musters from the raided stockpile, not home", () => {
    const b = planted();
    depositRaidLoot(b, 1000);
    const r = musterAtBase(b, "reaver", 10, b.plantedAt);
    expect(r.ok).toBe(true);
    // 10 reavers × 4 supplies = 40 charged to the RAIDED stockpile
    expect(b.supplies).toBe(960);
    // queue completes through the shared advance
    const tick = advanceForwardBase(b, b.plantedAt + 10 * 60_000 + 1, {
      sourceColony: "Test",
    });
    expect(tick.log.join(" ")).toMatch(/mustered/);
    expect(rosterCount(b.home.roster)).toBe(10);
  });

  test("refuses muster when the raided stockpile is short — no home convoys", () => {
    const b = planted(); // supplies = 0
    const r = musterAtBase(b, "bulwark", 5, b.plantedAt);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/raid/i);
  });

  test("enforces the 500-troop garrison cap", () => {
    const b = planted();
    depositRaidLoot(b, 1_000_000);
    addCohort(b.home.roster, "bulwark", 490, b.plantedAt);
    const r = musterAtBase(b, "bulwark", 20, b.plantedAt);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/500/);
    expect(FORWARD_BASE_CONFIG.garrisonCap).toBe(TROOPS_CONFIG.forwardGarrisonCap);
  });

  test("rejects unknown troop types", () => {
    const b = planted();
    expect(musterAtBase(b, "dragon", 5, b.plantedAt).ok).toBe(false);
  });
});

describe("hunger — the shared system, foreign soil", () => {
  test("a starving beachhead deserts into the FOREIGN server pool", () => {
    const b = planted();
    const pool = emptyServerBandPool();
    addCohort(b.home.roster, "reaver", 200, b.plantedAt);
    // Plenty of raid loot, then it runs dry: 200 troops eat 20/hr → burn it.
    depositRaidLoot(b, 30);
    let now = b.plantedAt;
    // 30 supplies last 1.5h; grace is 24h; then desertion at 5%/hr.
    now += 3 * DAY;
    const tick = advanceForwardBase(b, now, { sourceColony: "Test" });
    depositBands(pool, tick.bands);
    expect(tick.bands.length).toBeGreaterThan(0);
    const band = tick.bands[0];
    expect(band.serverId).toBe("ashtar-prime"); // foreign wilds, not home
    expect(poolCount(pool, "ashtar-prime")).toBe(bandCount(band));
    expect(poolCount(pool, "draconis")).toBe(0); // nothing leaks home
    expect(rosterCount(b.home.roster)).toBeLessThan(200);
  });

  test("hunger uses the SAME math as home — no fork", () => {
    const b = planted();
    addCohort(b.home.roster, "bulwark", 100, b.plantedAt);
    // Starve long past grace: desertion must follow the 5%/hr curve.
    const now = b.plantedAt + 2 * DAY; // 24h grace + 24h starving
    advanceForwardBase(b, now, { sourceColony: "Test" });
    const remaining = rosterCount(b.home.roster);
    // 100 × (1 − 0.05)^24 ≈ 29
    expect(remaining).toBeGreaterThan(15);
    expect(remaining).toBeLessThan(45);
  });
});

describe("hiring on foreign soil", () => {
  test("hires a deserter band from the server pool into the beachhead", () => {
    const b = planted();
    const pool = emptyServerBandPool();
    // Seed a band in the wild on this server (someone else's neglect).
    const donor = planted(plantReq({ serverId: "ashtar-prime", seq: 8 }));
    addCohort(donor.home.roster, "longeye", 60, donor.plantedAt);
    const tick = advanceForwardBase(donor, donor.plantedAt + 3 * DAY, {
      sourceColony: "Neglectful",
    });
    depositBands(pool, tick.bands);
    expect(tick.bands.length).toBeGreaterThan(0);
    const bandId = tick.bands[0].id;

    depositRaidLoot(b, 10_000);
    const before = rosterCount(b.home.roster);
    const res = hireBandAtBase(b, pool, bandId, Date.now());
    expect(res.ok).toBe(true);
    expect(res.cost).toBeGreaterThan(0);
    expect(rosterCount(b.home.roster)).toBeGreaterThan(before);
    expect(findBand(pool, "ashtar-prime", bandId)).toBeUndefined(); // consumed
  });

  test("cannot hire a band from another server", () => {
    const b = planted(); // ashtar-prime
    const pool = emptyServerBandPool();
    depositBands(pool, [
      {
        id: "band-1",
        serverId: "watcher-realm",
        sourceColony: "Far",
        cohorts: [{ type: "reaver", count: 10, veterans: 0 }],
        createdAt: 0,
      },
    ]);
    depositRaidLoot(b, 10_000);
    const res = hireBandAtBase(b, pool, "band-1", Date.now());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/gone/i);
  });

  test("the 500 cap applies to hired sellswords too", () => {
    const b = planted();
    const pool = emptyServerBandPool();
    addCohort(b.home.roster, "bulwark", 495, b.plantedAt);
    depositBands(pool, [
      {
        id: "band-2",
        serverId: "ashtar-prime",
        sourceColony: "Far",
        cohorts: [{ type: "reaver", count: 50, veterans: 0 }],
        createdAt: 0,
      },
    ]);
    depositRaidLoot(b, 10_000);
    const res = hireBandAtBase(b, pool, "band-2", Date.now());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cap/i);
  });
});

describe("destruction — lose the base, lose everything", () => {
  test("walls absorb damage until they fall", () => {
    const b = planted();
    const r1 = siegeForwardBase(b, 400, {
      season: "s1",
      attacker: "Defenders",
      defender: "Raiders",
    });
    expect(r1.razed).toBe(false);
    expect(r1.wallHp).toBe(FORWARD_BASE_CONFIG.wallHp - 400);
  });

  test("razing destroys everything and records the memorial", () => {
    const b = planted();
    depositRaidLoot(b, 5000);
    addCohort(b.home.roster, "thunder", 80, b.plantedAt);
    addCohort(b.home.roster, "warden", 40, b.plantedAt);
    const r = siegeForwardBase(b, 999_999, {
      season: "s3",
      attacker: "Home Guard",
      defender: "Beachhead Raiders",
      at: 12345,
    });
    expect(r.razed).toBe(true);
    expect(r.wallHp).toBe(0);
    expect(r.casualties).toBeDefined();
    expect(r.casualties!.battleId).toBe(`raze-${b.id}`);
    expect(r.casualties!.lossesByType.thunder).toBe(80);
    expect(r.casualties!.lossesByType.warden).toBe(40);
    expect(r.casualties!.factions).toEqual(["Home Guard", "Beachhead Raiders"]);
    expect(r.casualties!.season).toBe("s3");
  });
});

describe("season rollover — the recall", () => {
  test("abandonAllForwardBases wipes every beachhead", () => {
    const bases: Record<string, ForwardBase> = {
      "ashtar-prime": planted(),
      "watcher-realm": planted(plantReq({ serverId: "watcher-realm", seq: 9 })),
    };
    const removed = abandonAllForwardBases(bases);
    expect(removed).toHaveLength(2);
    expect(Object.keys(bases)).toHaveLength(0);
  });
});

describe("helpers", () => {
  test("strikeForceWeight counts thunder double", () => {
    expect(strikeForceWeight({ bulwark: 10, thunder: 10 })).toBe(10 + 20);
  });

  test("removeBand drops a spent band from the pool", () => {
    const pool = emptyServerBandPool();
    depositBands(pool, [
      {
        id: "band-9",
        serverId: "x",
        sourceColony: "Y",
        cohorts: [{ type: "reaver", count: 5, veterans: 0 }],
        createdAt: 0,
      },
    ]);
    removeBand(pool, "x", "band-9");
    expect(poolCount(pool, "x")).toBe(0);
  });
});
