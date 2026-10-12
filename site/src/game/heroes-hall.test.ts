// heroes-hall.test.ts — the Heroes & Leaders page's display model.
// The Hall surfaces other systems' numbers; these tests pin the JOINS:
// every catalog deed appears on the tier ladder exactly once, every hero
// has at least one deed path plus its race's vouch, the level ladder is
// LEVEL_XP verbatim with the playbook fully distributed across it, and
// the XP source rows carry the published amounts — never invented ones.
import { describe, expect, test } from "bun:test";
import {
  buildHeroRoster,
  deedTierLadder,
  heroEarnPaths,
  heroSignatureTier,
  levelLadder,
  playsUnlockedBy,
  HERO_XP_SOURCE_ROWS,
  LEADER_XP_SOURCE_ROWS,
  DEED_TIER_ORDER,
} from "./heroes-hall";
import { DEED_CATALOG, DEED_BY_ID, HERO_DEFS } from "./heroes-data";
import { HERO_XP_SOURCES, newHeroUnit } from "./hero-xp";
import { LEVEL_XP, MAX_LEVEL, SPECIALIZATION_MILESTONE } from "./leader-xp";
import { PLAYBOOK } from "./war/playbook";

describe("deed tier ladder", () => {
  test("four tiers in order, every catalog deed placed exactly once", () => {
    const rows = deedTierLadder();
    expect(rows.map((r) => r.tier)).toEqual([...DEED_TIER_ORDER]);
    const placed = rows.flatMap((r) => r.deeds.map((d) => d.id));
    expect(placed.sort()).toEqual(DEED_CATALOG.map((d) => d.id).sort());
  });

  test("week windows follow the ratified deed windows (3 / 8 / 12 / none)", () => {
    const rows = deedTierLadder();
    expect(rows.find((r) => r.tier === "t1")?.weeks).toBe(3);
    expect(rows.find((r) => r.tier === "t2")?.weeks).toBe(8);
    expect(rows.find((r) => r.tier === "t3")?.weeks).toBe(12);
    expect(rows.find((r) => r.tier === "vouch")?.weeks).toBeNull();
  });

  test("every hero's signature tier matches its signature deed's tier", () => {
    for (const def of HERO_DEFS) {
      expect(heroSignatureTier(def)).toBe(DEED_BY_ID[def.signatureDeed]?.tier);
    }
    const rows = deedTierLadder();
    const filed = rows.flatMap((r) => r.heroIds);
    expect(filed.sort()).toEqual(HERO_DEFS.map((h) => h.id).sort());
  });
});

describe("hero earn paths", () => {
  test("signature deed first, alternates resolved, nothing dangling", () => {
    for (const def of HERO_DEFS) {
      const paths = heroEarnPaths(def);
      expect(paths.deeds.length >= 1).toBe(true);
      expect(paths.deeds[0]?.id).toBe(def.signatureDeed);
      for (const deed of paths.deeds) {
        expect(DEED_BY_ID[deed.id]).toBe(deed);
      }
    }
  });

  test("alternates join the path (Last Lecturer: contribution + marches)", () => {
    const def = HERO_DEFS.find((h) => h.id === "last-lecturer")!;
    const ids = heroEarnPaths(def).deeds.map((d) => d.id);
    expect(ids).toEqual(["hero_contribution_50", "hero_march_5"]);
  });

  test("every hero carries its race's Oracle vouch path", () => {
    for (const def of HERO_DEFS) {
      const paths = heroEarnPaths(def);
      expect(paths.vouchDeedId).toBe(`oracle_vouch:${def.race}`);
    }
    // The Wave-1 roster is Watchers, and the catalog publishes their vouch.
    const watcher = HERO_DEFS[0]!;
    expect(heroEarnPaths(watcher).vouchDeed?.tier).toBe("vouch");
  });
});

describe("hero roster join", () => {
  test("no earned units → the whole catalog stands locked", () => {
    const roster = buildHeroRoster([]);
    expect(roster).toHaveLength(HERO_DEFS.length);
    expect(roster.every((e) => !e.earned && e.unit === null)).toBe(true);
  });

  test("an earned unit lights exactly its own catalog entry", () => {
    const def = HERO_DEFS.find((h) => h.id === "azazel-3")!;
    const unit = newHeroUnit(def, def.signatureDeed, Date.UTC(2026, 9, 12));
    const roster = buildHeroRoster([unit]);
    const entry = roster.find((e) => e.def.id === "azazel-3")!;
    expect(entry.earned).toBe(true);
    expect(entry.unit).toBe(unit);
    expect(roster.filter((e) => e.earned)).toHaveLength(1);
  });

  test("an earned unit outside the catalog still gets a row", () => {
    const def = HERO_DEFS[0]!;
    const foreign = { ...newHeroUnit(def, def.signatureDeed, 0), id: "future-wave-hero", name: "Future Wave" };
    const roster = buildHeroRoster([foreign]);
    expect(roster).toHaveLength(HERO_DEFS.length + 1);
    expect(roster.find((e) => e.def.id === "future-wave-hero")?.earned).toBe(true);
  });
});

describe("level ladder", () => {
  test("L1…L10 with LEVEL_XP verbatim and rising thresholds", () => {
    const rows = levelLadder();
    expect(rows).toHaveLength(MAX_LEVEL);
    rows.forEach((row, i) => {
      expect(row.level).toBe(i + 1);
      expect(row.xpRequired).toBe(LEVEL_XP[i + 1]);
      if (i > 0) expect(row.xpRequired).toBeGreaterThan(rows[i - 1]!.xpRequired);
    });
  });

  test("the milestone row is exactly the specialization level", () => {
    const marked = levelLadder().filter((r) => r.isMilestone);
    expect(marked).toHaveLength(1);
    expect(marked[0]?.level).toBe(SPECIALIZATION_MILESTONE);
  });

  test("every published play first-unlocks on exactly one rung", () => {
    const rows = levelLadder();
    const distributed = rows.flatMap((r) => r.newPlays.map((p) => p.id));
    expect(distributed.sort()).toEqual(PLAYBOOK.map((p) => p.id).sort());
    expect(playsUnlockedBy(1) >= 1).toBe(true);
    expect(playsUnlockedBy(MAX_LEVEL)).toBe(PLAYBOOK.length);
    // Unlock counts never shrink as level rises.
    for (let lvl = 2; lvl <= MAX_LEVEL; lvl++) {
      expect(playsUnlockedBy(lvl) >= playsUnlockedBy(lvl - 1)).toBe(true);
    }
  });
});

describe("xp source tables", () => {
  test("hero rows carry HERO_XP_SOURCES verbatim", () => {
    expect(HERO_XP_SOURCE_ROWS).toHaveLength(Object.keys(HERO_XP_SOURCES).length);
    for (const row of HERO_XP_SOURCE_ROWS) {
      expect(row.xp).toBe(HERO_XP_SOURCES[row.id]);
      expect(row.xp).toBeGreaterThan(0);
    }
  });

  test("leader rows carry the engine's granted amounts", () => {
    // Mirrors engine.ts grant sites (researchXp / resolveExpedition).
    expect(Object.fromEntries(LEADER_XP_SOURCE_ROWS.map((r) => [r.id, r.xp]))).toEqual({
      research: 10,
      breakthrough: 25,
      wildcard: 12,
      deepRun: 8,
    });
  });
});
