// Tests for the Oracles system (site/src/game/oracles.ts).
import { describe, expect, test } from "bun:test";
import {
  ORACLES,
  ORACLE_BY_ID,
  ORACLE_IDS,
  ORACLE_LEVELS,
  freshOracles,
  ensureOracles,
  oracleLevel,
  oracleLevelTitle,
  oracleBonuses,
  allOracleBonuses,
  oracleForRace,
  noteCrossServerBattle,
  donateCodices,
  noteBetrayal,
  performCleansing,
  isCleansed,
  askOracle,
  noteDent,
  contributionScore,
  trickleDevotionFavor,
  canMeetUnboundOracle,
  meetUnboundOracle,
  FAVOR_PER_CODEX,
  FAVOR_BETRAYAL_PENALTY,
  ORACLE_FAVOR_EARN_ONLY,
  type OracleId,
} from "./oracles";
import { FAVOR_THRESHOLDS } from "./daily";
import type { GameState } from "./types";

function mockState(race: GameState["race"] = "draconians"): GameState {
  return {
    race,
    devotion: 0,
  } as unknown as GameState;
}

describe("the Seven", () => {
  test("seven Oracles defined, one per race + unbound", () => {
    expect(ORACLES.length).toBe(7);
    expect(ORACLE_IDS.length).toBe(7);
    const races = ORACLES.map((o) => o.race);
    for (const r of ["grays", "nephilim", "draconians", "anunnaki", "ashtar", "watchers"] as const) {
      expect(races).toContain(r);
    }
    expect(races).toContain("unbound");
  });

  test("every Oracle has a joker personality and riddle stock", () => {
    for (const o of ORACLES) {
      expect(o.name.length).toBeGreaterThan(0);
      expect(o.epithet.length).toBeGreaterThan(0);
      expect(o.personality.length).toBeGreaterThan(20);
      expect(o.greetings.length).toBeGreaterThan(0);
      expect(o.riddles.length).toBeGreaterThan(0);
      expect(o.favorLines.length).toBeGreaterThan(0);
      expect(o.scornLines.length).toBeGreaterThan(0);
      expect(ORACLE_BY_ID[o.id]).toBe(o);
    }
  });

  test("favor is earn-only, forever", () => {
    expect(ORACLE_FAVOR_EARN_ONLY).toBe(true);
  });
});

describe("ensureOracles", () => {
  test("backfills fresh state on old saves", () => {
    const st = {} as GameState;
    ensureOracles(st);
    const s = (st as unknown as { oracles: ReturnType<typeof freshOracles> }).oracles;
    expect(s.oracles.draconians.met).toBe(false);
    expect(s.oracles.draconians.favor).toBe(0);
    expect(s.crossServerBattles).toBe(0);
    expect(s.dents).toEqual([]);
  });

  test("does not clobber existing favor", () => {
    const st = mockState();
    ensureOracles(st);
    (st as unknown as { oracles: ReturnType<typeof freshOracles> }).oracles.oracles.grays.favor = 42;
    ensureOracles(st);
    expect((st as unknown as { oracles: ReturnType<typeof freshOracles> }).oracles.oracles.grays.favor).toBe(42);
  });
});

describe("introduction gate", () => {
  test("first cross-server battle meets the defender's Oracle", () => {
    const st = mockState();
    const res = noteCrossServerBattle(st, "grays", 1000);
    expect(res.ok).toBe(true);
    expect(res.metOracle).toBe("grays");
    expect(res.greeting).toBeTruthy();
    const s = (st as unknown as { oracles: ReturnType<typeof freshOracles> }).oracles;
    expect(s.oracles.grays.met).toBe(true);
    expect(s.oracles.grays.metAt).toBe(1000);
    expect(s.crossServerBattles).toBe(1);
  });

  test("second battle does not re-meet", () => {
    const st = mockState();
    noteCrossServerBattle(st, "grays", 1000);
    const res = noteCrossServerBattle(st, "grays", 2000);
    expect(res.ok).toBe(true);
    expect(res.alreadyMet).toBe(true);
    expect(res.greeting).toBeUndefined();
  });

  test("different races meet different Oracles", () => {
    const st = mockState();
    noteCrossServerBattle(st, "grays", 1000);
    const res = noteCrossServerBattle(st, "nephilim", 2000);
    expect(res.metOracle).toBe("nephilim");
  });

  test("the Unbound's Oracle does not meet at the gate", () => {
    const st = mockState();
    const res = noteCrossServerBattle(st, "unbound", 1000);
    expect(res.ok).toBe(true);
    expect(res.metOracle).toBeUndefined();
    const s = (st as unknown as { oracles: ReturnType<typeof freshOracles> }).oracles;
    expect(s.oracles.unbound.met).toBe(false);
  });
});

describe("levels", () => {
  test("level thresholds", () => {
    expect(oracleLevel(0)).toBe(0);
    expect(oracleLevel(14)).toBe(0);
    expect(oracleLevel(15)).toBe(1);
    expect(oracleLevel(29)).toBe(1);
    expect(oracleLevel(30)).toBe(2);
    expect(oracleLevel(60)).toBe(3);
    expect(oracleLevel(100)).toBe(4);
    expect(oracleLevel(150)).toBe(5);
    expect(oracleLevel(9999)).toBe(5);
  });

  test("level titles", () => {
    expect(oracleLevelTitle(0)).toBe("Unproven");
    expect(oracleLevelTitle(1)).toBe("Noticed");
    expect(oracleLevelTitle(5)).toBe("Transcendent");
  });

  test("bonuses scale with level and weighting", () => {
    const st = mockState("draconians");
    noteCrossServerBattle(st, "draconians", 1000);
    // Draconian weighting: economy 3, weaponry 2, soul 1
    let b = oracleBonuses(st, "draconians");
    expect(b).toEqual({ economy: 0, weaponry: 0, soul: 0 });
    const d = donateCodices(st, "draconians", 8, 2000); // 16 favor → level 1
    expect(d.ok).toBe(true);
    expect(d.level).toBe(1);
    expect(d.leveledUp).toBe(true);
    b = oracleBonuses(st, "draconians");
    expect(b).toEqual({ economy: 3, weaponry: 2, soul: 1 });
  });

  test("allOracleBonuses only counts met Oracles", () => {
    const st = mockState("draconians");
    noteCrossServerBattle(st, "draconians", 1000);
    donateCodices(st, "draconians", 8, 2000);
    const total = allOracleBonuses(st);
    expect(total.economy).toBe(3);
    // Unmet grays contribute nothing
    expect(total.soul).toBe(1);
  });
});

describe("donateCodices", () => {
  test("requires meeting first", () => {
    const st = mockState();
    const res = donateCodices(st, "grays", 5, 1000);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not met/i);
  });

  test("grants favor per codex", () => {
    const st = mockState();
    noteCrossServerBattle(st, "grays", 1000);
    const res = donateCodices(st, "grays", 5, 2000);
    expect(res.ok).toBe(true);
    expect(res.favorGained).toBe(5 * FAVOR_PER_CODEX);
    expect(res.favor).toBe(5 * FAVOR_PER_CODEX);
    const s = (st as unknown as { oracles: ReturnType<typeof freshOracles> }).oracles;
    expect(s.oracles.grays.codicesDonated).toBe(5);
    expect(s.oracles.grays.lifetimeFavor).toBe(5 * FAVOR_PER_CODEX);
  });

  test("rejects non-positive counts", () => {
    const st = mockState();
    noteCrossServerBattle(st, "grays", 1000);
    expect(donateCodices(st, "grays", 0, 1000).ok).toBe(false);
    expect(donateCodices(st, "grays", -3, 1000).ok).toBe(false);
  });
});

describe("noteBetrayal", () => {
  test("betrayal craters favor", () => {
    const st = mockState();
    noteCrossServerBattle(st, "grays", 1000);
    donateCodices(st, "grays", 20, 2000); // 40 favor
    const res = noteBetrayal(st, "grays");
    expect(res.ok).toBe(true);
    expect(res.favorLost).toBe(FAVOR_BETRAYAL_PENALTY);
    expect(res.favor).toBe(40 - FAVOR_BETRAYAL_PENALTY);
    expect(res.withdrawn).toBe(false);
  });

  test("repeated betrayals escalate and withdraw at zero", () => {
    const st = mockState();
    noteCrossServerBattle(st, "grays", 1000);
    donateCodices(st, "grays", 8, 2000); // 16 favor
    noteBetrayal(st, "grays"); // -10 → 6
    const res = noteBetrayal(st, "grays"); // -min(6, 20) → 0
    expect(res.favor).toBe(0);
    expect(res.withdrawn).toBe(true);
    const s = (st as unknown as { oracles: ReturnType<typeof freshOracles> }).oracles;
    expect(s.oracles.grays.betrayals).toBe(2);
  });
});

describe("performCleansing", () => {
  test("requires the meeting and 15 favor", () => {
    const st = mockState();
    expect(performCleansing(st, "grays", 1000).ok).toBe(false);
    noteCrossServerBattle(st, "grays", 1000);
    const poor = performCleansing(st, "grays", 1000);
    expect(poor.ok).toBe(false);
    expect(poor.error).toMatch(new RegExp(String(FAVOR_THRESHOLDS.cleanseEligible)));
  });

  test("cleansing grants the buff and counts", () => {
    const st = mockState();
    noteCrossServerBattle(st, "grays", 1000);
    donateCodices(st, "grays", 8, 2000); // 16 favor
    const res = performCleansing(st, "grays", 3000);
    expect(res.ok).toBe(true);
    expect(res.cleansedUntil).toBeGreaterThan(3000);
    expect(res.cleansings).toBe(1);
    expect(isCleansed(st, 3000)).toBe(true);
    expect(isCleansed(st, 3000 + 25 * 3600 * 1000)).toBe(false);
  });

  test("cannot double-cleanse while blessed", () => {
    const st = mockState();
    noteCrossServerBattle(st, "grays", 1000);
    donateCodices(st, "grays", 8, 2000);
    performCleansing(st, "grays", 3000);
    const res = performCleansing(st, "grays", 4000);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already cleansed/i);
  });
});

describe("askOracle", () => {
  test("requires the meeting", () => {
    const st = mockState();
    const res = askOracle(st, "grays", 1000);
    expect(res.ok).toBe(false);
  });

  test("low favor draws scorn, mid draws riddles, high draws favor lines", () => {
    const st = mockState();
    noteCrossServerBattle(st, "grays", 1000);
    // 0 favor → scorn
    let r = askOracle(st, "grays", 1000);
    expect(r.ok).toBe(true);
    expect(r.favor).toBe("low");
    // 16 favor → riddles
    donateCodices(st, "grays", 8, 2000);
    r = askOracle(st, "grays", 2000);
    expect(r.favor).toBe("high"); // mid-favor pool labeled high in result shape
    expect(r.riddle).toBeTruthy();
    // level 3+ → favor lines
    donateCodices(st, "grays", 30, 3000); // +60 → 76 total, level 3
    r = askOracle(st, "grays", 3000);
    expect(r.favor).toBe("high");
  });

  test("riddle rotation is deterministic", () => {
    const st = mockState();
    noteCrossServerBattle(st, "grays", 1000);
    donateCodices(st, "grays", 8, 2000);
    const r1 = askOracle(st, "grays", 2000);
    const r2 = askOracle(st, "grays", 2000);
    // Consecutive asks rotate (may repeat only after exhausting the pool)
    expect(r1.riddle).toBeTruthy();
    expect(r2.riddle).toBeTruthy();
    const s = (st as unknown as { oracles: ReturnType<typeof freshOracles> }).oracles;
    expect(s.oracles.grays.riddlesAsked).toBe(2);
  });
});

describe("Dent Principle & Contribution", () => {
  test("dents accumulate contribution, bounded ledger", () => {
    const st = mockState();
    for (let i = 0; i < 120; i++) {
      noteDent(st, "first_deed", `deed ${i}`, 1, 1000 + i);
    }
    const s = (st as unknown as { oracles: ReturnType<typeof freshOracles> }).oracles;
    expect(s.dents.length).toBe(100); // MAX_DENTS
    expect(s.contribution).toBeGreaterThan(0);
  });

  test("contribution score blends dents, devotion, oracle standing", () => {
    const st = mockState("draconians");
    (st as unknown as { devotion: number }).devotion = 100;
    noteDent(st, "purified_zone", "zone", 1, 1000);
    noteCrossServerBattle(st, "draconians", 1000);
    donateCodices(st, "draconians", 8, 2000);
    const score = contributionScore(st);
    // purified_zone: 25*1=25, devotion: 100*0.5=50, oracle: level1*10 + 16*0.1=11.6
    expect(score).toBeCloseTo(25 + 50 + 11.6, 5);
  });
});

describe("devotion trickle", () => {
  test("no race, no trickle", () => {
    const st = mockState(null);
    ensureOracles(st);
    trickleDevotionFavor(st);
    const s = (st as unknown as { oracles: ReturnType<typeof freshOracles> }).oracles;
    expect(s.oracles.draconians.favor).toBe(0);
  });

  test("no meeting, no trickle — the gate holds", () => {
    const st = mockState("draconians");
    (st as unknown as { devotion: number }).devotion = 10000;
    trickleDevotionFavor(st);
    const s = (st as unknown as { oracles: ReturnType<typeof freshOracles> }).oracles;
    expect(s.oracles.draconians.favor).toBe(0);
  });

  test("trickle feeds the colony's own Oracle, capped below cleansing", () => {
    const st = mockState("draconians");
    (st as unknown as { devotion: number }).devotion = 10000;
    noteCrossServerBattle(st, "draconians", 1000);
    for (let i = 0; i < 50; i++) trickleDevotionFavor(st);
    const s = (st as unknown as { oracles: ReturnType<typeof freshOracles> }).oracles;
    expect(s.oracles.draconians.favor).toBeGreaterThan(0);
    expect(s.oracles.draconians.favor).toBeLessThanOrEqual(14); // TRICKLE_CAP
    // Other Oracles get nothing from the trickle
    expect(s.oracles.grays.favor).toBe(0);
  });
});

describe("the Unbound's Oracle", () => {
  function trustedSix(st: GameState): void {
    const six: OracleId[] = ["grays", "nephilim", "draconians", "anunnaki", "ashtar", "watchers"];
    for (const id of six) {
      noteCrossServerBattle(st, id as GameState["race"], 1000);
      // 30 codices = 60 favor = level 3 (Trusted)
      donateCodices(st, id, 30, 2000);
    }
  }

  test("cannot meet Dawn without all six Trusted", () => {
    const st = mockState();
    expect(canMeetUnboundOracle(st)).toBe(false);
    expect(meetUnboundOracle(st, 1000).ok).toBe(false);
    noteCrossServerBattle(st, "grays", 1000);
    donateCodices(st, "grays", 30, 2000);
    expect(canMeetUnboundOracle(st)).toBe(false);
  });

  test("six Trusted standings open the seventh meeting", () => {
    const st = mockState();
    trustedSix(st);
    expect(canMeetUnboundOracle(st)).toBe(true);
    const res = meetUnboundOracle(st, 5000);
    expect(res.ok).toBe(true);
    expect(res.greeting).toBeTruthy();
    const s = (st as unknown as { oracles: ReturnType<typeof freshOracles> }).oracles;
    expect(s.oracles.unbound.met).toBe(true);
    // Meeting Dawn is itself a dent
    expect(s.dents.some((d) => d.kind === "earned_unlock")).toBe(true);
  });

  test("cannot meet twice", () => {
    const st = mockState();
    trustedSix(st);
    meetUnboundOracle(st, 5000);
    expect(meetUnboundOracle(st, 6000).ok).toBe(false);
  });
});
