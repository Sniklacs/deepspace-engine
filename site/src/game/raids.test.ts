// raids.test.ts — Cross-server raiding party tests (v1: loot-only).
import { describe, expect, test } from "bun:test";
import {
  RAID_MAX_MEMBERS,
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
