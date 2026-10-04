// raids.test.ts — Cross-server raiding party tests (v1: loot-only).
import { describe, expect, test } from "bun:test";
import {
  LANDED_FIRE_SUPPORT_FACTOR,
  ORBITAL_FIRE_SUPPORT_FACTOR,
  RAID_MAX_MEMBERS,
  SHIP_FIREPOWER,
  SHIP_HULL,
  SHIP_LOOT_CAP,
  capLootToCargo,
  commitRaidTroops,
  createRaidParty,
  emptyRaidState,
  joinRaidParty,
  raidJumpCharge,
  raidLaunchBlocker,
  raidLootCapacity,
  raidLootTotal,
  raidTroopCapacity,
  raidTroopCount,
  resolveRaidBattle,
  setRaidTarget,
  EMPTY_RAID_LOOT,
  type RaidParty,
} from "./raids";
import type { TroopType } from "./war/troops";

const WEIGHTS: Record<TroopType, number> = {
  bulwark: 1, reaver: 1, longeye: 1, thunder: 3, warden: 2,
};

function partyWithShips(): RaidParty {
  const r = createRaidParty("col-1", "Hans", 1);
  r.shipIds = ["ship-a", "ship-b"];
  r.shipClasses = ["frigate", "fatcat"];
  return r;
}

describe("createRaidParty", () => {
  test("leader is member #1, status preparing", () => {
    const r = createRaidParty("col-1", "Hans", 7);
    expect(r.id).toBe("raid-7");
    expect(r.status).toBe("preparing");
    expect(r.memberIds).toEqual(["col-1"]);
    expect(r.memberNames).toEqual(["Hans"]);
    expect(raidTroopCount(r)).toBe(0);
  });
});

describe("joinRaidParty", () => {
  test("adds members up to the cap", () => {
    const r = createRaidParty("col-1", "Hans", 1);
    for (let i = 2; i <= RAID_MAX_MEMBERS; i++) {
      const res = joinRaidParty(r, `col-${i}`, `P${i}`);
      expect(res.ok).toBe(true);
    }
    expect(r.memberIds).toHaveLength(RAID_MAX_MEMBERS);
    // 6th is refused
    const res = joinRaidParty(r, "col-99", "Late");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cap at 5/);
  });

  test("duplicate join refused", () => {
    const r = createRaidParty("col-1", "Hans", 1);
    expect(joinRaidParty(r, "col-1", "Hans").ok).toBe(false);
  });

  test("no joining after launch", () => {
    const r = partyWithShips();
    r.status = "in_transit";
    expect(joinRaidParty(r, "col-2", "P2").ok).toBe(false);
  });
});

describe("commitRaidTroops", () => {
  test("commits within ship capacity", () => {
    const r = partyWithShips(); // frigate 800 + fatcat 500 = 1300
    expect(raidTroopCapacity(r)).toBe(1300);
    expect(commitRaidTroops(r, "col-1", "reaver", 1000).ok).toBe(true);
    expect(raidTroopCount(r)).toBe(1000);
  });

  test("refused past ship capacity", () => {
    const r = partyWithShips();
    const res = commitRaidTroops(r, "col-1", "reaver", 2000);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/only carries 1300/);
    expect(raidTroopCount(r)).toBe(0);
  });

  test("non-member refused", () => {
    const r = partyWithShips();
    expect(commitRaidTroops(r, "col-9", "reaver", 10).ok).toBe(false);
  });

  test("zero/negative refused", () => {
    const r = partyWithShips();
    expect(commitRaidTroops(r, "col-1", "reaver", 0).ok).toBe(false);
  });
});

describe("setRaidTarget + raidLaunchBlocker", () => {
  test("blocker walks the checklist", () => {
    const r = createRaidParty("col-1", "Hans", 1);
    expect(raidLaunchBlocker(r)).toMatch(/target colony/);
    setRaidTarget(r, "draconians-world", "col-x", "Ashkar");
    expect(raidLaunchBlocker(r)).toMatch(/jump ship/);
    r.shipIds = ["s1"]; r.shipClasses = ["scout"];
    expect(raidLaunchBlocker(r)).toMatch(/Load troops/);
    commitRaidTroops(r, "col-1", "reaver", 50);
    expect(raidLaunchBlocker(r)).toBeNull();
  });
});

describe("raidJumpCharge", () => {
  test("per-ship fuel + supplies", () => {
    const r = partyWithShips(); // 2 ships
    const c = raidJumpCharge(r);
    expect(c.fuel).toBe(20);
    expect(c.supplies).toBe(400);
  });
});

describe("raidLootCapacity", () => {
  test("fatcat is the loot truck", () => {
    expect(SHIP_LOOT_CAP.fatcat).toBeGreaterThan(SHIP_LOOT_CAP.bulwark);
    const r = partyWithShips(); // frigate 5000 + fatcat 25000
    expect(raidLootCapacity(r)).toBe(30_000);
  });
});

describe("capLootToCargo", () => {
  test("scales proportionally when over capacity", () => {
    const loot = { ...EMPTY_RAID_LOOT, supplies: 20_000, embers: 10_000 };
    const capped = capLootToCargo(loot, 15_000);
    expect(raidLootTotal(capped) <= 15_000).toBe(true);
    // 2:1 ratio preserved
    expect(capped.supplies).toBe(capped.embers * 2);
  });

  test("untouched when it fits", () => {
    const loot = { ...EMPTY_RAID_LOOT, supplies: 100 };
    expect(capLootToCargo(loot, 10_000)).toEqual(loot);
  });
});

describe("resolveRaidBattle", () => {
  const defenderLoot = { ...EMPTY_RAID_LOOT, supplies: 10_000, embers: 2_000, fuel: 500 };

  test("decisive win (ratio >= 2): light losses, 80% loot", () => {
    const res = resolveRaidBattle({
      attacker: { reaver: 4000 }, // 4000 power
      weights: WEIGHTS,
      defenderTroops: 1000,
      defenderLoot,
      cargoCapacity: 1_000_000,
    });
    expect(res.won).toBe(true);
    expect(res.attackerLosses.reaver).toBe(400); // 10%
    expect(res.lootTaken.supplies).toBe(8000);
    expect(res.defenderLosses).toBeGreaterThan(0);
  });

  test("win (ratio >= 1): 25% losses, 50% loot", () => {
    const res = resolveRaidBattle({
      attacker: { reaver: 1500 },
      weights: WEIGHTS,
      defenderTroops: 1000,
      defenderLoot,
      cargoCapacity: 1_000_000,
    });
    expect(res.won).toBe(true);
    expect(res.attackerLosses.reaver).toBe(375);
    expect(res.lootTaken.supplies).toBe(5000);
  });

  test("pyrrhic (ratio >= 0.5): 60% losses, 20% loot", () => {
    const res = resolveRaidBattle({
      attacker: { reaver: 600 },
      weights: WEIGHTS,
      defenderTroops: 1000,
      defenderLoot,
      cargoCapacity: 1_000_000,
    });
    expect(res.won).toBe(true);
    expect(res.attackerLosses.reaver).toBe(360);
    expect(res.lootTaken.supplies).toBe(2000);
  });

  test("loss (ratio < 0.5): 90% losses, no loot", () => {
    const res = resolveRaidBattle({
      attacker: { reaver: 400 },
      weights: WEIGHTS,
      defenderTroops: 1000,
      defenderLoot,
      cargoCapacity: 1_000_000,
    });
    expect(res.won).toBe(false);
    expect(res.attackerLosses.reaver).toBe(360);
    expect(raidLootTotal(res.lootTaken)).toBe(0);
  });

  test("loot is cargo-capped", () => {
    const res = resolveRaidBattle({
      attacker: { reaver: 4000 },
      weights: WEIGHTS,
      defenderTroops: 1000,
      defenderLoot, // 80% = 10k units
      cargoCapacity: 1000,
    });
    expect(raidLootTotal(res.lootTaken) <= 1000).toBe(true);
  });

  test("defender losses never exceed their force", () => {
    const res = resolveRaidBattle({
      attacker: { thunder: 10_000 }, // 30k power
      weights: WEIGHTS,
      defenderTroops: 100,
      defenderLoot,
      cargoCapacity: 1_000_000,
    });
    expect(res.defenderLosses <= 100).toBe(true);
  });

  test("deterministic: same input, same output", () => {
    const input = {
      attacker: { reaver: 1500, warden: 200 },
      weights: WEIGHTS,
      defenderTroops: 1000,
      defenderLoot,
      cargoCapacity: 50_000,
    };
    expect(resolveRaidBattle(input)).toEqual(resolveRaidBattle(input));
  });

  test("supply weight matters: thunder hits harder than reaver", () => {
    const base = { weights: WEIGHTS, defenderTroops: 1000, defenderLoot, cargoCapacity: 1_000_000 };
    const light = resolveRaidBattle({ ...base, attacker: { reaver: 400 } });
    const heavy = resolveRaidBattle({ ...base, attacker: { thunder: 900 } });
    expect(light.won).toBe(false); // 400 power vs 1000
    expect(heavy.won).toBe(true); // 2700 power vs 1000
  });
});

describe("ship combat stats (owner 2026-10-03)", () => {
  const defenderLoot = { ...EMPTY_RAID_LOOT, supplies: 10_000, embers: 2_000, fuel: 500 };
  const base = {
    attacker: { reaver: 1000 }, // 1000 power
    weights: WEIGHTS,
    defenderTroops: 1000,
    defenderLoot,
    cargoCapacity: 1_000_000,
  };

  test("every ship class has firepower and hull", () => {
    for (const cls of ["scout", "frigate", "bulwark", "vanguard", "fatcat", "herald"] as const) {
      expect(SHIP_FIREPOWER[cls]).toBeGreaterThan(0);
      expect(SHIP_HULL[cls]).toBeGreaterThan(0);
    }
  });

  test("vanguard outguns scout; bulwark out-armors scout", () => {
    expect(SHIP_FIREPOWER.vanguard).toBeGreaterThan(SHIP_FIREPOWER.scout);
    expect(SHIP_HULL.bulwark).toBeGreaterThan(SHIP_HULL.scout);
  });

  test("holding orbit: fleet adds orbital fire support (half firepower)", () => {
    const noFleet = resolveRaidBattle({ ...base, shipClasses: [] });
    const withFleet = resolveRaidBattle({
      ...base,
      shipClasses: ["vanguard", "frigate"], // 140 + 80 = 220 fp → 110 orbital
      shipsHoldOrbit: true,
    });
    // Same tier (both win at ratio 1.0→1.11) but defender bleeds more with fleet.
    expect(withFleet.defenderLosses).toBeGreaterThan(noFleet.defenderLosses);
    // Exact: defender losses = floor(attackerPower * 0.4) capped.
    expect(withFleet.defenderLosses).toBe(Math.min(1000, Math.floor(1110 * 0.4)));
  });

  test("landed: fleet adds full firepower", () => {
    const orbit = resolveRaidBattle({
      ...base,
      shipClasses: ["vanguard"],
      shipsHoldOrbit: true,
    });
    const landed = resolveRaidBattle({
      ...base,
      shipClasses: ["vanguard"],
      shipsHoldOrbit: false,
    });
    expect(landed.defenderLosses).toBeGreaterThan(orbit.defenderLosses);
    expect(landed.defenderLosses).toBe(
      Math.min(1000, Math.floor((1000 + 140 * LANDED_FIRE_SUPPORT_FACTOR) * 0.4)),
    );
    expect(orbit.defenderLosses).toBe(
      Math.min(1000, Math.floor((1000 + 140 * ORBITAL_FIRE_SUPPORT_FACTOR) * 0.4)),
    );
  });

  test("landed fragile fleet pays more repairs than a tanky one", () => {
    const fragile = resolveRaidBattle({
      ...base,
      attacker: { reaver: 4000 }, // decisive win either way
      shipClasses: ["scout", "scout"], // hull 80 → 40/80 = 50% → capped 15%
      shipsHoldOrbit: false,
    });
    const tanky = resolveRaidBattle({
      ...base,
      attacker: { reaver: 4000 },
      shipClasses: ["bulwark", "bulwark"], // hull 800 → 40/800 = 5%
      shipsHoldOrbit: false,
    });
    // Both win decisively (80% loot share) but fragile pays 15% repairs, tanky 5%.
    expect(fragile.lootTaken.supplies).toBe(Math.floor(10_000 * 0.8 * 0.85));
    expect(tanky.lootTaken.supplies).toBe(Math.floor(10_000 * 0.8 * 0.95));
  });

  test("no ships: orbit and land behave identically (no phantom bonus)", () => {
    const orbit = resolveRaidBattle({ ...base, shipsHoldOrbit: true });
    const landed = resolveRaidBattle({ ...base, shipsHoldOrbit: false });
    expect(landed).toEqual(orbit);
  });

  test("deterministic with ships", () => {
    const input = { ...base, shipClasses: ["vanguard", "bulwark"] as const, shipsHoldOrbit: false as const };
    expect(resolveRaidBattle({ ...input, shipClasses: [...input.shipClasses] })).toEqual(
      resolveRaidBattle({ ...input, shipClasses: [...input.shipClasses] }),
    );
  });
});

describe("emptyRaidState", () => {
  test("starts empty", () => {
    const s = emptyRaidState();
    expect(s.raids).toEqual([]);
    expect(s.warnings).toEqual([]);
    expect(s.incomingRaids).toEqual([]);
  });
});

describe("cross-server raid protocol (owner 2026-10-03)", () => {
  test("createRaidParty generates an invite code", async () => {
    const { makeInviteCode } = await import("./raids");
    const r = createRaidParty("col-1", "Hans", 1);
    expect(typeof r.inviteCode).toBe("string");
    expect(r.inviteCode.length).toBe(6);
    // Codes are unique-ish.
    const r2 = createRaidParty("col-2", "Bob", 2);
    expect(r2.inviteCode).not.toBe(r.inviteCode);
    const code = makeInviteCode();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
  });

  test("joinRaidParty rejects late joiners and duplicates", () => {
    const r = createRaidParty("col-1", "Hans", 1);
    expect(joinRaidParty(r, "col-1", "Hans").ok).toBe(false); // already in
    expect(joinRaidParty(r, "col-2", "Bob").ok).toBe(true);
    expect(r.memberIds.includes("col-2")).toBe(true);
    r.status = "in_transit";
    expect(joinRaidParty(r, "col-3", "Eve").ok).toBe(false); // launched
  });

  test("joinRaidParty enforces the 5-member cap", () => {
    const r = createRaidParty("col-1", "Hans", 1);
    for (let i = 2; i <= RAID_MAX_MEMBERS; i++) {
      expect(joinRaidParty(r, `col-${i}`, `P${i}`).ok).toBe(true);
    }
    expect(r.memberIds.length).toBe(RAID_MAX_MEMBERS);
    const res = joinRaidParty(r, "col-99", "Zed");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cap at 5/);
  });
});
