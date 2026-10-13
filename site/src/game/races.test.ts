// Tests for game/races.ts — the uniform race stat rows (owner 2026-10-13:
// the real stats belong on the race descriptions because "that's how they
// choose"). raceStatRows must return ALL SEVEN rows for EVERY race, in the
// same order and format, with every value derived from the race's live
// engine mods — never invented, never silently dropped at baseline.
//
// Run: bun test src/game/races.test.ts

import { describe, expect, test } from "bun:test";
import { RACES, getRace, raceStatRows } from "./races";

const EXPECTED_KEYS = [
  "studySpeed",
  "emberLoot",
  "chipsetChance",
  "explorationCost",
  "corruptionGain",
  "chorusGain",
  "baseSupplies",
];

describe("raceStatRows — uniform across all races", () => {
  test("every race returns exactly the seven rows, in the same order", () => {
    for (const race of RACES) {
      const rows = raceStatRows(race);
      expect(rows).toHaveLength(7);
      expect(rows.map((r) => r.key)).toEqual(EXPECTED_KEYS);
    }
  });

  test("values are recomputed from the race's own mods — no drift, no invention", () => {
    for (const race of RACES) {
      const m = race.mods;
      const byKey = Object.fromEntries(raceStatRows(race).map((r) => [r.key, r.value]));
      expect(byKey.studySpeed).toBe(`×${(1 / m.studySpeed).toFixed(2)}`);
      expect(byKey.corruptionGain).toBe(`×${m.corruptionResist.toFixed(2)}`);
      expect(byKey.chorusGain).toBe(`×${m.chorusResist.toFixed(2)}`);
      const pct = (v: number) => {
        const p = Math.round((v - 1) * 100);
        return p === 0 ? "0%" : `${p > 0 ? "+" : "−"}${Math.abs(p)}%`;
      };
      expect(byKey.emberLoot).toBe(pct(m.emberGain));
      expect(byKey.chipsetChance).toBe(pct(m.chipsetChance));
      expect(byKey.baseSupplies).toBe(pct(m.yieldSupply));
    }
  });

  test("baseline mods still render a row — neutral, not dropped", () => {
    const draconians = raceStatRows(getRace("draconians"));
    const study = draconians.find((r) => r.key === "studySpeed")!;
    expect(study.value).toBe("×1.00"); // studySpeed 1.0
    expect(study.good).toBeNull();
    const grays = raceStatRows(getRace("grays"));
    const ember = grays.find((r) => r.key === "emberLoot")!;
    expect(ember.value).toBe("0%"); // emberGain 1.0
    expect(ember.good).toBeNull();
  });

  test("direction of good/bad matches the engine's use of each mod", () => {
    const byKey = (id: Parameters<typeof getRace>[0]) =>
      Object.fromEntries(raceStatRows(getRace(id)).map((r) => [r.key, r]));

    // studySpeed multiplies research DURATION: Watchers 0.5 = fastest.
    expect(byKey("watchers").studySpeed.value).toBe("×2.00");
    expect(byKey("watchers").studySpeed.good).toBe(true);
    expect(byKey("nephilim").studySpeed.good).toBe(false); // 1.9 = slowest

    // corruptionResist/chorusResist multiply gain TAKEN: lower is safer.
    expect(byKey("ashtar").corruptionGain.value).toBe("×0.35");
    expect(byKey("ashtar").corruptionGain.good).toBe(true);
    expect(byKey("ashtar").chorusGain.value).toBe("×0.50");
    expect(byKey("watchers").corruptionGain.good).toBe(false); // 2.0 = double taint

    // suppliesEfficiency multiplies exploration COST: 0.7 = 30% cheaper = good.
    expect(byKey("draconians").explorationCost.value).toBe("−30%");
    expect(byKey("draconians").explorationCost.good).toBe(true);
    expect(byKey("nephilim").explorationCost.good).toBe(false); // 1.3 = pricier

    // yieldSupply: Anunnaki 1.5 = +50% base supplies.
    expect(byKey("anunnaki").baseSupplies.value).toBe("+50%");
    expect(byKey("anunnaki").baseSupplies.good).toBe(true);
  });
});
