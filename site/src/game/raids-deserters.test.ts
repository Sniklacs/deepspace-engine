// raids-deserters.test.ts — Deserter encounter/hiring tests (owner 2026-10-03).
import { describe, expect, test } from "bun:test";
import {
  DESERTER_BAND_MAX,
  DESERTER_BAND_MIN,
  DESERTER_ENCOUNTER_CHANCE,
  DESERTER_PRICE_PER_HEAD_MAX,
  DESERTER_PRICE_PER_HEAD_MIN,
  createRaidParty,
  deserterBandCount,
  dismissRaidDeserters,
  hireRaidDeserters,
  raidTroopCount,
  rollDeserterEncounter,
  type RaidDeserterBand,
  type RaidParty,
} from "./raids";
import type { TroopType } from "./war/troops";

function deployingRaid(supplies = 10_000): RaidParty {
  const r = createRaidParty("col-1", "Hans", 1);
  r.status = "deploying";
  r.supplies = supplies;
  r.landsAt = 1234567890;
  r.troops = { "col-1": { bulwark: 100 } };
  return r;
}

function bandWith(troops: Partial<Record<TroopType, number>>, price = 1000): RaidDeserterBand {
  return { id: "deserter-raid-1", troops, price, resolved: false };
}

describe("rollDeserterEncounter", () => {
  test("is deterministic — same raid id gives same result", () => {
    const a = deployingRaid();
    const b = deployingRaid();
    const ra = rollDeserterEncounter(a);
    const rb = rollDeserterEncounter(b);
    expect(JSON.stringify(ra)).toBe(JSON.stringify(rb));
  });

  test("band (when it appears) is within the tuned ranges", () => {
    // Sweep many raid ids to find encounters and validate the ranges.
    let found = 0;
    for (let i = 0; i < 200; i++) {
      const r = createRaidParty("col-1", "Hans", i);
      r.landsAt = 999000 + i;
      const band = rollDeserterEncounter(r);
      if (!band) continue;
      found++;
      const n = deserterBandCount(band);
      expect(n).toBeGreaterThanOrEqual(DESERTER_BAND_MIN);
      expect(n).toBeLessThanOrEqual(DESERTER_BAND_MAX);
      const perHead = band.price / n;
      expect(perHead).toBeGreaterThanOrEqual(DESERTER_PRICE_PER_HEAD_MIN);
      expect(perHead).toBeLessThanOrEqual(DESERTER_PRICE_PER_HEAD_MAX);
      // Composition is a mix of real troop types.
      const types = Object.keys(band.troops);
      expect(types.length).toBeGreaterThanOrEqual(2);
      for (const t of types) {
        expect(["bulwark", "reaver", "longeye", "thunder", "warden"]).toContain(t);
      }
    }
    // ~35% chance over 200 rolls — allow a wide band so the test isn't flaky.
    expect(found).toBeGreaterThan(20);
    expect(found).toBeLessThan(120);
  });

  test("encounter chance constant is 35%", () => {
    expect(DESERTER_ENCOUNTER_CHANCE).toBe(0.35);
  });
});

describe("hireRaidDeserters", () => {
  test("hire deducts supplies and adds troops to the raid", () => {
    const r = deployingRaid(10_000);
    r.deserters = bandWith({ reaver: 120, longeye: 80 }, 3_000);
    const before = raidTroopCount(r);
    const res = hireRaidDeserters(r, "deserter-raid-1");
    expect(res.ok).toBe(true);
    expect(r.supplies).toBe(7_000);
    expect(raidTroopCount(r)).toBe(before + 200);
    expect(r.troops["deserters"]).toEqual({ reaver: 120, longeye: 80 });
    expect(r.deserters!.resolved).toBe(true);
    expect(r.deserters!.hired).toBe(true);
  });

  test("hire fails without enough supplies — names the shortfall", () => {
    const r = deployingRaid(500);
    r.deserters = bandWith({ reaver: 100 }, 800);
    const res = hireRaidDeserters(r, "deserter-raid-1");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("800");
    expect(res.error).toContain("500");
    // Nothing moved.
    expect(r.supplies).toBe(500);
    expect(r.deserters!.resolved).toBe(false);
    expect(r.troops["deserters"]).toBeUndefined();
  });

  test("double-hire is refused", () => {
    const r = deployingRaid(10_000);
    r.deserters = bandWith({ reaver: 100 }, 1_000);
    expect(hireRaidDeserters(r, "deserter-raid-1").ok).toBe(true);
    const res = hireRaidDeserters(r, "deserter-raid-1");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("already made up their minds");
    // Supplies only deducted once.
    expect(r.supplies).toBe(9_000);
  });

  test("wrong band id is refused", () => {
    const r = deployingRaid(10_000);
    r.deserters = bandWith({ reaver: 100 }, 1_000);
    const res = hireRaidDeserters(r, "deserter-raid-999");
    expect(res.ok).toBe(false);
    expect(r.supplies).toBe(10_000);
  });

  test("no band waiting is refused", () => {
    const r = deployingRaid(10_000);
    const res = hireRaidDeserters(r, "deserter-raid-1");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("No deserter band");
  });

  test("wrong raid status is refused", () => {
    const r = deployingRaid(10_000);
    r.status = "preparing";
    r.deserters = bandWith({ reaver: 100 }, 1_000);
    const res = hireRaidDeserters(r, "deserter-raid-1");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("deploying");
  });
});

describe("dismissRaidDeserters", () => {
  test("dismiss resolves the band without moving supplies or troops", () => {
    const r = deployingRaid(10_000);
    r.deserters = bandWith({ reaver: 100 }, 1_000);
    const before = raidTroopCount(r);
    const res = dismissRaidDeserters(r, "deserter-raid-1");
    expect(res.ok).toBe(true);
    expect(r.supplies).toBe(10_000);
    expect(raidTroopCount(r)).toBe(before);
    expect(r.deserters!.resolved).toBe(true);
    expect(r.deserters!.hired).toBe(false);
  });

  test("can't hire after dismissing", () => {
    const r = deployingRaid(10_000);
    r.deserters = bandWith({ reaver: 100 }, 1_000);
    expect(dismissRaidDeserters(r, "deserter-raid-1").ok).toBe(true);
    const res = hireRaidDeserters(r, "deserter-raid-1");
    expect(res.ok).toBe(false);
  });

  test("double-dismiss is refused", () => {
    const r = deployingRaid(10_000);
    r.deserters = bandWith({ reaver: 100 }, 1_000);
    expect(dismissRaidDeserters(r, "deserter-raid-1").ok).toBe(true);
    expect(dismissRaidDeserters(r, "deserter-raid-1").ok).toBe(false);
  });
});
