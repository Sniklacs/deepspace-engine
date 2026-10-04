// TROOPS TAB tests — the Barracks page (owner 2026-10-04: one module, one page).
import { describe, expect, test } from "bun:test";
import {
  TROOP_TYPES,
  TROOP_JOBS,
  musterCost,
  musterDurationMs,
  supplyWeight,
  homeGarrisonCap,
  label,
  type TroopType,
} from "./war/troops";
import { mustersRunning } from "./nav-badges";
import { NAV_IDS } from "./nav-slots";

describe("barracks page data", () => {
  test("every troop type has a battlefield job description", () => {
    for (const t of TROOP_TYPES) {
      expect(TROOP_JOBS[t].length).toBeGreaterThan(10);
    }
  });

  test("thunder counts double (supply weight 2)", () => {
    expect(supplyWeight("thunder")).toBe(2);
    for (const t of TROOP_TYPES.filter((x) => x !== "thunder")) {
      expect(supplyWeight(t)).toBe(1);
    }
  });

  test("muster cost scales with weight and count", () => {
    // 4 supplies per weight; thunder weighs 2
    expect(musterCost("bulwark", 10)).toBe(40);
    expect(musterCost("thunder", 10)).toBe(80);
    expect(musterCost("reaver", 1)).toBe(4);
  });

  test("muster time is linear: 30s per troop", () => {
    expect(musterDurationMs(1)).toBe(30_000);
    expect(musterDurationMs(10)).toBe(300_000);
  });

  test("garrison cap grows with cradle tier", () => {
    const caps = [1, 2, 3, 4, 5].map(homeGarrisonCap);
    expect(caps).toEqual([200, 650, 1100, 1550, 2000]);
  });

  test("nav has the troops slot", () => {
    expect((NAV_IDS as readonly string[]).includes("troops")).toBe(true);
  });

  test("labels are capitalized type names", () => {
    const labels: Record<TroopType, string> = {
      bulwark: "Bulwark",
      reaver: "Reaver",
      longeye: "Longeye",
      thunder: "Thunder",
      warden: "Warden",
    };
    for (const t of TROOP_TYPES) expect(label(t)).toBe(labels[t]);
  });
});

describe("mustersRunning badge", () => {
  test("counts active muster queues", () => {
    const base: any = { troops: { home: { musterQueue: [] } } };
    expect(mustersRunning(base)).toBe(0);
    base.troops.home.musterQueue = [
      { id: "m-1", type: "bulwark", count: 50, startedAt: 0, completesAt: 1 },
      { id: "m-2", type: "reaver", count: 50, startedAt: 0, completesAt: 1 },
    ];
    expect(mustersRunning(base)).toBe(2);
  });

  test("no troops state = zero", () => {
    expect(mustersRunning({} as any)).toBe(0);
  });
});
