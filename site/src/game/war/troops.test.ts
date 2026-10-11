// Tests for the muster system (war/troops.ts) — design/muster-troops.md.
// Run: bun test site/src/game/war/troops.test.ts
import { describe, expect, test } from "bun:test";
import {
  TROOP_TYPES,
  TROOPS_CONFIG,
  addCohort,
  advanceTroopHome,
  applyCasualties,
  availableWeight,
  bandCount,
  bandWeight,
  commitWeight,
  emptyRoster,
  emptyTroopHome,
  enqueueMuster,
  hireBand,
  hireCost,
  homeGarrisonCap,
  isTroopType,
  mixWeight,
  musterCost,
  musterDurationMs,
  recordCasualties,
  recordDeaths,
  releaseWeight,
  removeTroopsNewestFirst,
  resolveBattleCasualties,
  rosterByType,
  rosterCount,
  rosterWeight,
  supplyWeight,
  takeWeightAsTroops,
  type CasualtyRecord,
  type TroopHome,
} from "./troops";

const HOUR = 3600_000;

function stockedHome(now: number, supplies = 10_000): { home: TroopHome; stock: { supplies: number } } {
  return { home: emptyTroopHome(now), stock: { supplies } };
}

describe("supply weight — the single source of truth", () => {
  test("thunder counts double, everything else single", () => {
    expect(supplyWeight("thunder")).toBe(2);
    for (const t of TROOP_TYPES) if (t !== "thunder") expect(supplyWeight(t)).toBe(1);
  });
  test("v1: weight is the ONLY type stat lever — types carry no power numbers; power lives on TIERS (owner 2026-10-05)", () => {
    const keys = Object.keys(TROOPS_CONFIG);
    expect(keys.some((k) => /damage|attack/i.test(k))).toBe(false);
    // Tier power is the sanctioned exception: tiers are the power progression.
    expect(TROOPS_CONFIG.tierPowerMult).toEqual({ 1: 1, 2: 1.5, 3: 2.2, 4: 3.2 });
  });
  test("isTroopType guards unknown types", () => {
    expect(isTroopType("bulwark")).toBe(true);
    expect(isTroopType("space-marine")).toBe(false);
  });
});

describe("muster queue — linear, validated, never helped", () => {
  test("cost is 4 supplies × weight × count", () => {
    expect(musterCost("bulwark", 10)).toBe(40);
    expect(musterCost("thunder", 10)).toBe(80); // weight 2
  });
  test("time is linear: 30s per troop, no batch discount", () => {
    expect(musterDurationMs(1)).toBe(30_000);
    expect(musterDurationMs(100)).toBe(100 * 30_000);
  });
  test("enqueue validates: positive count, one queue per type, garrison cap", () => {
    const r = emptyRoster();
    const now = Date.now();
    expect(enqueueMuster(r, [], "bulwark", 0, now, 0, 200).ok).toBe(false);
    const first = enqueueMuster(r, [], "bulwark", 10, now, 0, 200);
    expect(first.ok).toBe(true);
    expect(first.order!.completesAt - first.order!.startedAt).toBe(10 * 30_000);
    // second queue of the same type is rejected
    const dup = enqueueMuster(r, [first.order!], "bulwark", 5, now, 1, 200);
    expect(dup.ok).toBe(false);
    // over cap is rejected
    const over = enqueueMuster(r, [], "reaver", 201, now, 1, 200);
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/cap/);
  });
  test("completed orders become cohorts on advance", () => {
    const now = Date.now();
    const { home, stock } = stockedHome(now);
    const q = enqueueMuster(home.roster, home.musterQueue, "reaver", 5, now, home.seq++, 2000);
    expect(q.ok).toBe(true);
    home.musterQueue.push(q.order!);
    home.roster = home.roster; // (cohorts land via advance)
    advanceTroopHome(home, now + 5 * 30_000 + 1000, stock, { sourceColony: "c1", serverId: "s1" });
    expect(rosterCount(home.roster)).toBe(5);
    expect(rosterByType(home.roster).reaver).toBe(5);
    expect(home.musterQueue.length).toBe(0);
  });
});

describe("roster — cohorts, commitment, casualties", () => {
  test("weight sums supply weights; commitment ledgers separately", () => {
    const r = emptyRoster();
    const now = Date.now();
    addCohort(r, "bulwark", 10, now);
    addCohort(r, "thunder", 5, now);
    expect(rosterCount(r)).toBe(15);
    expect(rosterWeight(r)).toBe(10 * 1 + 5 * 2);
    expect(availableWeight(r)).toBe(20);
    expect(commitWeight(r, 25)).toBe(false); // can't fabricate troops
    expect(commitWeight(r, 12)).toBe(true);
    expect(availableWeight(r)).toBe(8);
    releaseWeight(r, 12);
    expect(availableWeight(r)).toBe(20);
  });
  test("applyCasualties is pure math: fraction of headcount, newest-first", () => {
    const r = emptyRoster();
    const now = Date.now();
    addCohort(r, "bulwark", 100, now); // old
    addCohort(r, "bulwark", 100, now + 1000); // new
    const { lossesByType } = applyCasualties(r, 0.5);
    expect(lossesByType.bulwark).toBe(100);
    expect(rosterCount(r)).toBe(100);
    // the survivors are the OLD cohort (newest died first)
    expect(r.cohorts.length).toBe(1);
    expect(r.cohorts[0].musteredAt).toBe(now);
  });
  test("resolveBattleCasualties kills committed weight, clears the ledger", () => {
    const r = emptyRoster();
    const now = Date.now();
    addCohort(r, "bulwark", 100, now); // weight 100
    expect(commitWeight(r, 100)).toBe(true);
    const losses = resolveBattleCasualties(r, 100, 0.5);
    expect(losses.bulwark).toBe(50);
    expect(rosterCount(r)).toBe(50);
    expect(r.committedWeight).toBe(0);
    expect(availableWeight(r)).toBe(50);
  });
  test("removeTroopsNewestFirst with type filter", () => {
    const r = emptyRoster();
    const now = Date.now();
    addCohort(r, "bulwark", 10, now);
    addCohort(r, "reaver", 10, now);
    const lost = removeTroopsNewestFirst(r, 5, "reaver");
    expect(lost.reaver).toBe(5);
    expect(lost.bulwark).toBe(0);
    expect(rosterByType(r).bulwark).toBe(10);
  });
});

describe("hunger — one system: grace, then desertion, then mercenaries", () => {
  test("fed garrison: upkeep deducts, no hunger", () => {
    const now = Date.now();
    const { home, stock } = stockedHome(now, 10_000);
    addCohort(home.roster, "bulwark", 100, now);
    const before = stock.supplies;
    advanceTroopHome(home, now + HOUR, stock, { sourceColony: "c1", serverId: "s1" });
    // 100 troops × 0.1/hr = 10 supplies for the hour
    expect(stock.supplies).toBeCloseTo(before - 10, 6);
    expect(home.hungerSince).toBeNull();
    expect(rosterCount(home.roster)).toBe(100);
  });
  test("24h grace: no desertion while foraging", () => {
    const now = Date.now();
    const { home, stock } = stockedHome(now, 0);
    addCohort(home.roster, "bulwark", 100, now);
    const tick = advanceTroopHome(home, now + 23 * HOUR, stock, { sourceColony: "c1", serverId: "s1" });
    expect(tick.bands.length).toBe(0);
    expect(rosterCount(home.roster)).toBe(100);
    expect(home.hungerSince).not.toBeNull();
  });
  test("after grace: 5%/hr desertion, newest-first, deserters become a band", () => {
    const now = Date.now();
    const { home, stock } = stockedHome(now, 0);
    addCohort(home.roster, "bulwark", 60, now); // old
    addCohort(home.roster, "reaver", 40, now + 1000); // new
    // 24h grace + 20 starving hours → 1-(0.95)^20 ≈ 64% of 100 ≈ 64 desert
    const tick = advanceTroopHome(home, now + 44 * HOUR, stock, { sourceColony: "c1", serverId: "s1" });
    expect(tick.bands.length).toBe(1);
    const band = tick.bands[0];
    expect(band.sourceColony).toBe("c1");
    // composition mirrors the deserters; newest (reavers) went first
    const reaversLost = band.cohorts.find((c) => c.type === "reaver")?.count ?? 0;
    expect(reaversLost).toBe(40);
    expect(bandCount(band)).toBeGreaterThan(40);
    expect(rosterCount(home.roster)).toBe(100 - bandCount(band));
    expect(tick.log.some((l) => /Starvation/.test(l))).toBe(true);
  });
  test("desertion does not compound across ticks", () => {
    const now = Date.now();
    const { home, stock } = stockedHome(now, 0);
    addCohort(home.roster, "bulwark", 1000, now);
    const opts = { sourceColony: "c1", serverId: "s1" };
    advanceTroopHome(home, now + 25 * HOUR, stock, opts); // 1 starving hour
    const afterFirst = rosterCount(home.roster);
    const expectFirst = 1000 - Math.floor(1000 * (1 - Math.pow(0.95, 1)));
    expect(afterFirst).toBe(expectFirst);
    advanceTroopHome(home, now + 26 * HOUR, stock, opts); // one more starving hour
    const afterSecond = rosterCount(home.roster);
    // second tick deserts ~5% of the SURVIVORS, not 5% of the original again
    const expectSecond = afterFirst - Math.floor(afterFirst * (1 - Math.pow(0.95, 1)));
    expect(afterSecond).toBe(expectSecond);
  });
  test("feeding ends hunger", () => {
    const now = Date.now();
    const { home, stock } = stockedHome(now, 0);
    addCohort(home.roster, "bulwark", 10, now);
    advanceTroopHome(home, now + HOUR, stock, { sourceColony: "c1", serverId: "s1" });
    expect(home.hungerSince).not.toBeNull();
    stock.supplies = 500;
    const tick = advanceTroopHome(home, now + 2 * HOUR, stock, { sourceColony: "c1", serverId: "s1" });
    expect(home.hungerSince).toBeNull();
    expect(tick.log.some((l) => /fed again/.test(l))).toBe(true);
  });
});

describe("mercenaries — the deserters' market", () => {
  function hiredBand(now: number) {
    return {
      id: "band-0",
      serverId: "s1",
      sourceColony: "neglectful-neighbor",
      cohorts: [
        { type: "bulwark" as const, count: 20, veterans: 0 },
        { type: "thunder" as const, count: 5, veterans: 0 },
      ],
      createdAt: now,
    };
  }
  test("hire cost = muster-cost equivalent (time is the discount)", () => {
    const band = hiredBand(Date.now());
    // (20×1 + 5×2) weight × 4 supplies
    expect(bandWeight(band)).toBe(30);
    expect(hireCost(band)).toBe(120);
  });
  test("hiring adds cohorts; the band is spent (double-hire is a no-op)", () => {
    const now = Date.now();
    const { home } = stockedHome(now);
    const band = hiredBand(now);
    const res = hireBand(home, band, 2000, now);
    expect(res.ok).toBe(true);
    expect(rosterByType(home.roster).bulwark).toBe(20);
    expect(rosterByType(home.roster).thunder).toBe(5);
    expect(bandCount(band)).toBe(0);
    const again = hireBand(home, band, 2000, now);
    expect(again.ok).toBe(false);
    expect(rosterCount(home.roster)).toBe(25);
  });
  test("garrison cap is the stomach — over-cap hire refused", () => {
    const now = Date.now();
    const { home } = stockedHome(now);
    addCohort(home.roster, "bulwark", 1990, now);
    const res = hireBand(home, hiredBand(now), 2000, now);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cap/);
  });
});

describe("memorial feed — casualty records for the plaques", () => {
  test("records append; deaths sum across types", () => {
    const feed: CasualtyRecord[] = [];
    recordCasualties(feed, {
      battleId: "b1",
      site: "Ashen Field",
      season: "S7",
      factions: ["Draconians", "Grays"],
      lossesByType: { bulwark: 600, reaver: 300, longeye: 100, thunder: 50, warden: 20 },
      fallenHeroes: ["Vex Mara"],
      at: 123,
    });
    expect(feed.length).toBe(1);
    expect(feed[0].at).toBe(123);
    expect(recordDeaths(feed[0])).toBe(1070); // ≥ plaque threshold
  });
});

describe("garrison caps", () => {
  test("T1 200 → T5 2000, clamped", () => {
    expect(homeGarrisonCap(1)).toBe(200);
    expect(homeGarrisonCap(5)).toBe(2000);
    expect(homeGarrisonCap(0)).toBe(200);
    expect(homeGarrisonCap(99)).toBe(2000);
  });
  test("forward cap is fixed and small", () => {
    expect(TROOPS_CONFIG.forwardGarrisonCap).toBe(500);
  });
});

describe("mixWeight — supply-weight of a per-type breakdown", () => {
  test("thunder counts double, everything else single", () => {
    expect(mixWeight({ bulwark: 2, reaver: 0, longeye: 0, thunder: 0, warden: 0 })).toBe(2);
    expect(mixWeight({ bulwark: 0, reaver: 0, longeye: 0, thunder: 3, warden: 0 })).toBe(6);
    expect(mixWeight({ bulwark: 1, reaver: 1, longeye: 1, thunder: 1, warden: 1 })).toBe(6);
  });
});

describe("takeWeightAsTroops — troops are indivisible", () => {
  const zero = { bulwark: 0, reaver: 0, longeye: 0, thunder: 0, warden: 0 };
  test("exact whole-troop take", () => {
    const { taken, weight } = takeWeightAsTroops({ ...zero, bulwark: 3 }, 2);
    expect(taken.bulwark).toBe(2);
    expect(weight).toBe(2);
  });
  test("never takes more than available", () => {
    const { taken, weight } = takeWeightAsTroops({ ...zero, bulwark: 1 }, 99);
    expect(taken.bulwark).toBe(1);
    expect(weight).toBe(1);
  });
  test("a fractional thunder request takes the whole thunder — never half, never nothing", () => {
    // The old scaleTypes path floored this to an empty take: 1 weight left
    // the mirror while zero troops deserted (an empty mercenary band and
    // weight that vanished between the mirror and the band).
    const { taken, weight } = takeWeightAsTroops({ ...zero, thunder: 1 }, 1);
    expect(taken.thunder).toBe(1);
    expect(weight).toBe(2);
  });
  test("empty source or zero request takes nothing", () => {
    expect(takeWeightAsTroops(zero, 5).weight).toBe(0);
    expect(takeWeightAsTroops({ ...zero, bulwark: 5 }, 0).weight).toBe(0);
  });
});

describe("guest upkeep — thunder eats double", () => {
  const NOW = 1_800_000_000_000;
  const zero = { bulwark: 0, reaver: 0, longeye: 0, thunder: 0, warden: 0 };
  function guestUpkeepFor(guests: { id: string; weight: number; troopsByType: Record<string, number> }[]): number {
    const { home, stock } = stockedHome(NOW - HOUR, 10_000);
    const before = stock.supplies;
    advanceTroopHome(home, NOW, stock, { sourceColony: "Host", serverId: "0", guests: guests as never });
    return before - stock.supplies;
  }
  test("one thunder (weight 2) costs the same as two bulwarks", () => {
    const thunderCost = guestUpkeepFor([{ id: "g1", weight: 2, troopsByType: { ...zero, thunder: 1 } }]);
    const twoBulwarkCost = guestUpkeepFor([{ id: "g1", weight: 2, troopsByType: { ...zero, bulwark: 2 } }]);
    const oneBulwarkCost = guestUpkeepFor([{ id: "g1", weight: 1, troopsByType: { ...zero, bulwark: 1 } }]);
    expect(thunderCost).toBeCloseTo(0.2, 10); // 2 weight × 0.1 supplies/weight/hour × 1h
    expect(twoBulwarkCost).toBeCloseTo(0.2, 10);
    expect(oneBulwarkCost).toBeCloseTo(0.1, 10);
  });
});

// ============================================================================
// TROOP TIERS T1–T4 (owner 2026-10-05): the power progression.
// ============================================================================
import {
  TROOP_TIERS,
  backfillTiers,
  isTroopTier,
  rosterByTier,
  rosterPower,
  tierPowerMult,
  tierUnlocked,
  type TroopTier,
} from "./troops";

describe("troop tiers — gating", () => {
  test("T1 always open; T2+ need the muster chain in order", () => {
    expect(tierUnlocked([], 1)).toBe(true);
    expect(tierUnlocked([], 2)).toBe(false);
    expect(tierUnlocked(["muster_1"], 2)).toBe(true);
    expect(tierUnlocked(["muster_1"], 3)).toBe(false);
    expect(tierUnlocked(["muster_1", "muster_2"], 3)).toBe(true);
    expect(tierUnlocked(["muster_1", "muster_2", "muster_3"], 4)).toBe(true);
    // Skipping the chain doesn't unlock: muster_3 alone opens nothing.
    expect(tierUnlocked(["muster_3"], 4)).toBe(false);
  });
  test("isTroopTier rejects garbage", () => {
    for (const n of TROOP_TIERS) expect(isTroopTier(n)).toBe(true);
    expect(isTroopTier(0)).toBe(false);
    expect(isTroopTier(5)).toBe(false);
    expect(isTroopTier(undefined)).toBe(false);
  });
  test("enqueueMuster refuses locked tiers and bad tier values", () => {
    const now = Date.now();
    const home = emptyTroopHome(now);
    const locked = enqueueMuster(home.roster, home.musterQueue, "reaver", 10, now, 1, 5000, 3, []);
    expect(locked.ok).toBe(false);
    const open = enqueueMuster(home.roster, home.musterQueue, "reaver", 10, now, 1, 5000, 3, ["muster_1", "muster_2"]);
    expect(open.ok).toBe(true);
    expect(open.order!.tier).toBe(3);
    const bad = enqueueMuster(home.roster, home.musterQueue, "reaver", 10, now, 2, 5000, 9 as TroopTier, []);
    expect(bad.ok).toBe(false);
  });
  test("tiered muster defaults to T1 (old callers unaffected)", () => {
    const now = Date.now();
    const home = emptyTroopHome(now);
    const enq = enqueueMuster(home.roster, home.musterQueue, "bulwark", 5, now, 1, 5000);
    expect(enq.ok).toBe(true);
    expect(enq.order!.tier).toBe(1);
  });
});

describe("troop tiers — cost and time scaling", () => {
  test("supply cost scales ×1 / ×1.8 / ×3 / ×5 per tier", () => {
    const base = musterCost("bulwark", 100, 1);
    expect(musterCost("bulwark", 100, 2)).toBe(Math.ceil(base * 1.8));
    expect(musterCost("bulwark", 100, 3)).toBe(Math.ceil(base * 3));
    expect(musterCost("bulwark", 100, 4)).toBe(Math.ceil(base * 5));
  });
  test("muster time scales ×1 / ×1.5 / ×2.2 / ×3 per tier", () => {
    const t1 = musterDurationMs(100, 1);
    expect(musterDurationMs(100, 2) / t1).toBeCloseTo(1.5, 2);
    expect(musterDurationMs(100, 3) / t1).toBeCloseTo(2.2, 2);
    expect(musterDurationMs(100, 4) / t1).toBeCloseTo(3, 2);
    expect(t1).toBeGreaterThan(0);
  });
});

describe("troop tiers — migration", () => {
  test("tierless cohorts and orders backfill to T1, idempotent", () => {
    const r = emptyRoster();
    const legacy = { id: "c1", type: "bulwark", count: 100, veterans: 0, musteredAt: 0 } as never;
    r.cohorts.push(legacy);
    backfillTiers(r);
    expect((legacy as { tier: number }).tier).toBe(1);
    backfillTiers(r); // idempotent
    expect((legacy as { tier: number }).tier).toBe(1);
    // Orders backfill too.
    const orders = [{ id: "m-1", type: "reaver", count: 10, startedAt: 0, completesAt: 1 } as never];
    backfillTiers(r, orders as never);
    expect((orders[0] as { tier: number }).tier).toBe(1);
  });
  test("addCohort defaults to T1; muster completion carries the order's tier", () => {
    const now = Date.now();
    const home = emptyTroopHome(now);
    addCohort(home.roster, "longeye", 50, now);
    expect(home.roster.cohorts[0].tier).toBe(1);
    const enq = enqueueMuster(home.roster, home.musterQueue, "reaver", 20, now, 1, 5000, 4, ["muster_1", "muster_2", "muster_3"]);
    expect(enq.ok).toBe(true);
    home.musterQueue.push(enq.order!);
    advanceTroopHome(home, enq.order!.completesAt, { supplies: 99_999 }, { sourceColony: "Home", serverId: "0", guests: [] });
    const reaver = home.roster.cohorts.find((c) => c.type === "reaver");
    expect(reaver?.tier).toBe(4);
  });
});

describe("troop tiers — power", () => {
  test("power curve mirrors the weapon tier curve: ×1 / ×1.5 / ×2.2 / ×3.2", () => {
    expect(tierPowerMult(1)).toBe(1);
    expect(tierPowerMult(2)).toBe(1.5);
    expect(tierPowerMult(3)).toBe(2.2);
    expect(tierPowerMult(4)).toBe(3.2);
    expect(tierPowerMult(9 as TroopTier)).toBe(1); // unknown reads as T1
  });
  test("rosterPower = Σ count × supplyWeight × tierPower", () => {
    const r = emptyRoster();
    addCohort(r, "bulwark", 100, 0, 0, 1);   // 100 × 1 × 1 = 100
    addCohort(r, "bulwark", 100, 0, 0, 4);   // 100 × 1 × 3.2 = 320
    addCohort(r, "thunder", 10, 0, 0, 2);    // 10 × 2 × 1.5 = 30
    expect(rosterPower(r)).toBeCloseTo(450, 6);
  });
  test("rosterByTier breaks counts down per tier", () => {
    const r = emptyRoster();
    addCohort(r, "reaver", 600, 0, 0, 1);
    addCohort(r, "reaver", 300, 0, 0, 2);
    addCohort(r, "reaver", 100, 0, 0, 3);
    const byTier = rosterByTier(r);
    expect(byTier.reaver).toEqual({ 1: 600, 2: 300, 3: 100, 4: 0 });
  });
});

// ============================================================================
// WEAPON IDENTITY (owner 2026-10-11): lasers vs lead at a glance.
// ============================================================================
import { weaponKindFor } from "./troops";

describe("weaponKindFor", () => {
  test("line infantry shoot kinetic", () => {
    expect(weaponKindFor("bulwark")).toBe("kinetic");
    expect(weaponKindFor("reaver")).toBe("kinetic");
    expect(weaponKindFor("longeye")).toBe("kinetic");
  });
  test("thunder lobs siege shells", () => {
    expect(weaponKindFor("thunder")).toBe("siege");
  });
  test("everything else is energy", () => {
    expect(weaponKindFor("warden")).toBe("energy");
    expect(weaponKindFor("turret")).toBe("energy");
    expect(weaponKindFor("dropship")).toBe("energy");
  });
});
