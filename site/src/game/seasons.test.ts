// Tests for the seasons system (game/seasons.ts) — design/seasons.md.
// The locked rules, asserted:
//   1. Season clock: pure time math — phases derive deterministically.
//   2. Rollover wipes the board (troops, bases, stockpiles) and preserves
//      the soul (artifacts, titles, seasonsFought, memorials).
//   3. Rollover is idempotent — running twice for the same season is a no-op.
//   4. Artifacts: vaulted (safe, unusable) vs carried (usable, lootable);
//      provenance appends on every move.
//   5. Storm: standings locked, multipliers active. Intermission: sandbox.
// Run: bun test site/src/game/seasons.test.ts
import { describe, expect, test } from "bun:test";
import {
  awardTitle,
  carryArtifact,
  checkSeasonRollover,
  currentSeason,
  earnArtifact,
  emptySoul,
  ensureSoul,
  intermissionSandboxGrant,
  isIntermission,
  isStormActive,
  rolloverSeason,
  SEASON_1_START_MS,
  SEASON_ACTIVE_MS,
  SEASON_CYCLE_MS,
  SEASON_INTERMISSION_MS,
  seasonPhaseAt,
  seasonTimeRemaining,
  standingsLocked,
  stormMultipliers,
  vaultArtifact,
  type SeasonPhase,
} from "./seasons";

const WEEK = 7 * 24 * 60 * 60 * 1000;

function atWeek(w: number): number {
  return SEASON_1_START_MS + w * WEEK;
}

function fakeState(): any {
  return {
    gameId: "test-colony",
    playerName: "TestPlayer",
    seasonId: "season-1",
    resources: {
      supplies: 99999,
      embers: 500,
      chipsets: 100,
      alloys: 50,
      plasma: 10,
      warplate: 5,
      hazmat: 3,
      shots: 2,
      medkit: 1,
      mechkit: 1,
      armorkit: 1,
      skmech: 0,
      gas: 100,
      battery: 50,
      mats: { grays: 10, draconians: 20 },
    },
    troops: {
      home: { roster: { bulwark: [{ count: 100 }] } },
      bands: [{ id: "b1" }],
    },
    forwardBases: { fb1: {}, fb2: {} },
    memorials: [{ id: "m1" }],
    arena: { ladder: [{ name: "x" }] },
    devotion: 1234,
  };
}

describe("season clock", () => {
  test("season 1 starts at SEASON_1_START_MS in landing phase", () => {
    const s = currentSeason(SEASON_1_START_MS + 1000);
    expect(s.number).toBe(1);
    expect(s.id).toBe("season-1");
    expect(s.phase).toBe("landing");
    expect(s.name).toBe("Season 1: The Ashen Tide");
  });

  test("phases derive correctly across the 13-week cycle", () => {
    const cases: [number, SeasonPhase][] = [
      [0.5, "landing"],
      [2, "expansion"],
      [5, "expansion"],
      [6, "war"],
      [9, "war"],
      [10, "storm"],
      [11.5, "storm"],
      [12, "intermission"],
      [12.9, "intermission"],
    ];
    for (const [w, phase] of cases) {
      expect(seasonPhaseAt(atWeek(w))).toBe(phase);
    }
  });

  test("season 2 begins after the 13-week cycle", () => {
    const s = currentSeason(atWeek(13) + 1000);
    expect(s.number).toBe(2);
    expect(s.id).toBe("season-2");
    expect(s.phase).toBe("landing");
    expect(s.name).toBe("Season 2: The Hollow Star");
  });

  test("season names cycle through the pool", () => {
    const s11 = currentSeason(SEASON_1_START_MS + 10 * SEASON_CYCLE_MS + 1000);
    expect(s11.number).toBe(11);
    expect(s11.name).toBe("Season 11: The Ashen Tide"); // wraps
  });

  test("storm and intermission checks", () => {
    expect(isStormActive(atWeek(11))).toBe(true);
    expect(isStormActive(atWeek(5))).toBe(false);
    expect(isIntermission(atWeek(12.5))).toBe(true);
    expect(isIntermission(atWeek(11))).toBe(false);
  });

  test("standings lock at storm start through intermission", () => {
    expect(standingsLocked(atWeek(9))).toBe(false);
    expect(standingsLocked(atWeek(10))).toBe(true);
    expect(standingsLocked(atWeek(12.5))).toBe(true);
    expect(standingsLocked(atWeek(13.5))).toBe(false); // season 2 landing
  });

  test("storm multipliers only during storm", () => {
    const calm = stormMultipliers(atWeek(5));
    expect(calm.chorusActivity).toBe(1);
    const storm = stormMultipliers(atWeek(11));
    expect(storm.chorusActivity).toBe(1.5);
    expect(storm.raidRewards).toBe(1.25);
    expect(storm.artifactDropOdds).toBe(1.5);
  });

  test("seasonTimeRemaining reports phase end", () => {
    const { season, msRemaining, phaseEndsAt } = seasonTimeRemaining(atWeek(1));
    expect(season.phase).toBe("landing");
    expect(phaseEndsAt).toBe(SEASON_1_START_MS + 2 * WEEK);
    expect(msRemaining).toBe(WEEK);
  });

  test("active season is 12 weeks, cycle is 13", () => {
    expect(SEASON_ACTIVE_MS).toBe(12 * WEEK);
    expect(SEASON_CYCLE_MS).toBe(SEASON_ACTIVE_MS + SEASON_INTERMISSION_MS);
  });
});

describe("soul", () => {
  test("ensureSoul backfills a complete soul", () => {
    const s: any = {};
    ensureSoul(s);
    expect(s.soul).toEqual(emptySoul());
  });

  test("ensureSoul repairs partial souls", () => {
    const s: any = { soul: { titles: ["x"] } };
    ensureSoul(s);
    expect(s.soul.oracleFavor).toEqual({});
    expect(s.soul.artifacts).toEqual([]);
    expect(s.soul.titles).toEqual(["x"]);
    expect(s.soul.seasonsFought).toBe(0);
  });

  test("awardTitle is idempotent", () => {
    const s: any = {};
    expect(awardTitle(s, "Champion")).toBe(true);
    expect(awardTitle(s, "Champion")).toBe(false);
    expect(s.soul.titles).toEqual(["Champion"]);
  });
});

describe("artifacts", () => {
  test("earnArtifact starts vaulted with provenance", () => {
    const s: any = { gameId: "g1", playerName: "P" };
    const art = earnArtifact(s, { id: "a1", name: "Blade" }, atWeek(1));
    expect(art.state).toBe("vaulted");
    expect(art.provenance).toHaveLength(1);
    expect(art.provenance[0].event).toBe("earned");
    expect(art.provenance[0].season).toBe("season-1");
  });

  test("carry then vault round-trips with provenance", () => {
    const s: any = { gameId: "g1", playerName: "P" };
    earnArtifact(s, { id: "a1", name: "Blade" }, atWeek(1));
    expect(carryArtifact(s, "a1", atWeek(2)).ok).toBe(true);
    expect(s.soul.artifacts[0].state).toBe("carried");
    expect(vaultArtifact(s, "a1", atWeek(3)).ok).toBe(true);
    expect(s.soul.artifacts[0].state).toBe("vaulted");
    expect(s.soul.artifacts[0].provenance.map((p: any) => p.event)).toEqual([
      "earned",
      "carried",
      "vaulted",
    ]);
  });

  test("vault/carry reject unknown artifacts and no-op states", () => {
    const s: any = {};
    expect(vaultArtifact(s, "nope").ok).toBe(false);
    earnArtifact(s, { id: "a1", name: "Blade" });
    expect(vaultArtifact(s, "a1").ok).toBe(false); // already vaulted
    expect(carryArtifact(s, "a1").ok).toBe(true);
    expect(carryArtifact(s, "a1").ok).toBe(false); // already carried
  });
});

describe("rollover", () => {
  test("wipes the board, preserves the soul", () => {
    const s = fakeState();
    earnArtifact(s, { id: "a1", name: "Blade" }, atWeek(1));
    carryArtifact(s, "a1", atWeek(1)); // carried stays carried — risk is the cap
    awardTitle(s, "Champion of X, Season 1");
    s.soul.oracleFavor = { draconians: 3 };

    const res = rolloverSeason(s, "season-2", atWeek(13) + 1000);
    expect(res).not.toBeNull();
    expect(res!.fromSeasonId).toBe("season-1");
    expect(res!.toSeasonId).toBe("season-2");

    // WIPED
    expect(res!.wiped.troops).toBe(true);
    expect(s.troops.home.roster).toBeDefined(); // structure kept, emptied
    expect(s.troops.bands).toEqual([]);
    expect(res!.wiped.forwardBases).toBe(2);
    expect(s.forwardBases).toEqual({});
    expect(res!.wiped.stockpiles).toBe(true);
    expect(s.resources.supplies).toBe(10000);
    expect(s.resources.embers).toBe(0);
    expect(s.resources.mats.draconians).toBe(0);
    expect(res!.wiped.arenaLadder).toBe(true);
    expect(s.arena.ladder).toEqual([]);
    expect(s.arena.ladderHistory).toHaveLength(1);

    // PRESERVED
    expect(res!.preserved.artifacts).toBe(1);
    expect(s.soul.artifacts[0].state).toBe("carried"); // risk is the cap
    expect(s.soul.artifacts[0].provenance.length).toBeGreaterThan(0);
    expect(s.soul.titles).toEqual(["Champion of X, Season 1"]);
    expect(s.soul.seasonsFought).toBe(1);
    expect(s.soul.oracleFavor).toEqual({ draconians: 3 });
    expect(s.memorials).toHaveLength(1); // never wiped
    expect(s.devotion).toBe(1234); // monotonic favor soil untouched
    expect(s.seasonId).toBe("season-2"); // sky re-rolls against this
  });

  test("rollover is idempotent", () => {
    const s = fakeState();
    const first = rolloverSeason(s, "season-2", atWeek(13) + 1000);
    expect(first).not.toBeNull();
    expect(s.soul.seasonsFought).toBe(1);
    const second = rolloverSeason(s, "season-2", atWeek(13) + 2000);
    expect(second).toBeNull();
    expect(s.soul.seasonsFought).toBe(1); // not double-counted
  });

  test("checkSeasonRollover adopts legacy season ids without wiping", () => {
    const s = fakeState();
    s.seasonId = "s0_the_shattering"; // monetization battle-pass id
    s.resources.supplies = 42424;
    const res = checkSeasonRollover(s, atWeek(5));
    expect(res).toBeNull();
    expect(s.seasonId).toBe("season-1"); // adopted
    expect(s.resources.supplies).toBe(42424); // not wiped
  });

  test("checkSeasonRollover fires on real season advance", () => {
    const s = fakeState(); // seasonId "season-1"
    const res = checkSeasonRollover(s, atWeek(13) + 1000);
    expect(res).not.toBeNull();
    expect(res!.toSeasonId).toBe("season-2");
    expect(s.seasonId).toBe("season-2");
  });

  test("checkSeasonRollover no-ops mid-season", () => {
    const s = fakeState();
    expect(checkSeasonRollover(s, atWeek(5))).toBeNull();
  });
});

describe("intermission sandbox", () => {
  test("sandbox grant is marked ephemeral", () => {
    const g = intermissionSandboxGrant();
    expect(g.sandbox).toBe(true);
    expect(g.troops).toBeGreaterThan(0);
    expect(g.supplies).toBeGreaterThan(0);
  });
});
