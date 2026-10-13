// hero-earn.test.ts — the hero EARN engine: deed ledger, deed evaluation,
// hero XP wiring, the leader battle-XP ladder, and the Oracle vouch.
//
// The pins that matter: the ladder's ORDER (arena < chorus < PvP) and its
// underdog/favorite shape (Hans, locked 2026-10-06); grade scaling at the
// doctrine ratios; every grant idempotent (a re-run tick pays nothing
// twice); deeds latch once and single-hero pools grant on completion
// while multi-hero pools wait for the colony's claim; the vouch reads
// earned favor and nothing else.
import { describe, expect, test } from "bun:test";
import {
  battleEarnFacts,
  claimHeroFromDeed,
  claimHeroVouch,
  commandingLeader,
  deedClaimed,
  deedCompleted,
  earnedHero,
  ensureHeroEarn,
  evaluateHeroDeeds,
  heroVouchStatus,
  leaderBattleXp,
  leaderXpSourceLabel,
  noteWarEvent,
  processHeroEarn,
  underdogMult,
  warWeekKey,
  LEADER_BATTLE_XP,
} from "./hero-earn";
import { DEED_BY_ID, HERO_BY_ID } from "./heroes-data";
import { HERO_XP_SOURCES, newHeroUnit } from "./hero-xp";
import { buildHeroRoster } from "./heroes-hall";
import { FAVOR_THRESHOLDS } from "./daily";
import { ensureOracles, oracleForRace } from "./oracles";
import type { GameState, Leader } from "./types";
import type { Battle, BattleHeroSnapshot, CommittedForce } from "./war/war-types";

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0); // Mon Oct 12 2026

function leader(id: string, xp: number, status: Leader["status"] = "active"): Leader {
  return {
    id,
    name: id,
    specialty: "tactician",
    attributes: { research: 1, economy: 1, combat: 5, engineering: 1 },
    joinedAt: NOW,
    assignment: null,
    history: [],
    status,
    breakthroughs: 0,
    codicesEarned: 0,
    xp,
    unspentPoints: 0,
    xpPointsGranted: 0,
    specialization: null,
    day: "",
    dayXp: 0,
  };
}

function mockState(over: Partial<GameState> = {}): GameState {
  return {
    gameId: "game-1",
    race: "watchers",
    playerName: "Test Colony",
    leaders: [leader("leader-1", 0)],
    log: [],
    battles: [],
    revelationCounters: { codicesEarnedByDeeds: 0 },
    ...over,
  } as unknown as GameState;
}

function snap(id: string, level: number): BattleHeroSnapshot {
  return {
    id,
    name: id,
    role: "tank",
    level,
    attributes: { power: 1, guard: 1, craft: 1, presence: 1 },
    specialization: null,
    skills: [],
  };
}

function force(side: "attacker" | "defender", colonyId: string, over: Partial<CommittedForce> = {}): CommittedForce {
  return { side, colonyId, colonyName: colonyId, heroSquad: [], weapons: [], troops: 10, fobStage: 0, ...over };
}

/** A resolved Chorus raid: my colony attacks a grade-3 site (fobStage 2) and wins. */
function chorusBattle(over: Partial<Battle> = {}): Battle {
  return {
    id: "battle-1",
    zoneId: "zone-1",
    zoneName: "Zone",
    attacker: force("attacker", "game-1"),
    defender: force("defender", "chorus-site-zone-1", { fobStage: 2 }),
    forcePower: { attacker: 100, defender: 100 },
    durationMs: 60_000,
    startedAt: NOW - 60_000,
    status: "resolved",
    result: { outcome: "attacker_victory", endedAt: NOW },
    casualties: { attacker: 0, defender: 0 },
    windows: [],
    decisions: [],
    aidCalls: [],
    bloodless: true,
    internal: { committedAt: NOW - 60_000 },
    ...over,
  };
}

describe("leader battle-XP ladder math", () => {
  test("the ordering is the doctrine: arena practice < chorus G3 < PvP (even levels, wins)", () => {
    const even = { myLevel: 3, foeLevel: 3, won: true } as const;
    expect(leaderBattleXp({ kind: "arena-practice", ...even })).toBe(3);
    expect(leaderBattleXp({ kind: "arena-stakes", ...even })).toBe(5);
    expect(leaderBattleXp({ kind: "chorus-raid", grade: 3, ...even })).toBe(10);
    expect(leaderBattleXp({ kind: "pvp", ...even })).toBe(15);
  });

  test("chorus grades scale at the doctrine ratios 0.6 / 0.8 / 1.0 / 1.25 / 1.5", () => {
    const even = { kind: "chorus-raid", myLevel: 2, foeLevel: 2, won: true } as const;
    expect(leaderBattleXp({ ...even, grade: 1 })).toBe(6);
    expect(leaderBattleXp({ ...even, grade: 2 })).toBe(8);
    expect(leaderBattleXp({ ...even, grade: 3 })).toBe(10);
    expect(leaderBattleXp({ ...even, grade: 4 })).toBe(13); // 12.5 rounds to 13
    expect(leaderBattleXp({ ...even, grade: 5 })).toBe(15);
    // Grade never leaks into the other kinds.
    expect(leaderBattleXp({ kind: "pvp", grade: 5, myLevel: 2, foeLevel: 2, won: true })).toBe(15);
  });

  test("underdog scaling: +25% per level down, capped at ×2.5, and losses still learn", () => {
    expect(underdogMult(1, 1)).toBe(1);
    expect(underdogMult(1, 3)).toBe(1.5);
    expect(underdogMult(1, 5)).toBe(2);
    expect(underdogMult(1, 10)).toBe(LEADER_BATTLE_XP.underdogCap);
    // An underdog PvP WIN pays double…
    expect(leaderBattleXp({ kind: "pvp", myLevel: 1, foeLevel: 5, won: true })).toBe(30);
    // …and an underdog PvP LOSS pays as much as an even-level win (15 × 2 × 0.5).
    expect(leaderBattleXp({ kind: "pvp", myLevel: 1, foeLevel: 5, won: false })).toBe(15);
  });

  test("favorite dampening: −15% per level up, floored at ×0.4", () => {
    expect(underdogMult(3, 1)).toBeCloseTo(0.7);
    expect(underdogMult(9, 1)).toBe(LEADER_BATTLE_XP.favoriteFloor);
    // The favorite's PvP win over a much weaker leader pays comparatively little.
    expect(leaderBattleXp({ kind: "pvp", myLevel: 5, foeLevel: 1, won: true })).toBe(6);
    // An even loss pays the participation share.
    expect(leaderBattleXp({ kind: "pvp", myLevel: 4, foeLevel: 4, won: false })).toBe(8); // 7.5 → 8
  });
});

describe("battle earn facts", () => {
  test("a chorus raid win reads as march + breach + capture, grade from the FOB stage", () => {
    const st = mockState();
    const facts = battleEarnFacts(st, chorusBattle());
    expect(facts).not.toBeNull();
    expect(facts!.kind).toBe("chorus-raid");
    expect(facts!.grade).toBe(3); // fobStage 2 → grade 3
    expect(facts!.won).toBe(true);
    expect(facts!.isMarch).toBe(true);
    expect(facts!.isBreach).toBe(true);
    expect(facts!.isCapture).toBe(true);
    expect(facts!.isComeback).toBe(false);
    expect(leaderXpSourceLabel(facts!).includes("G3")).toBe(true);
  });

  test("comeback: winning while >25% outpowered; a narrow gap is not a comeback", () => {
    const st = mockState();
    const outgunned = battleEarnFacts(st, chorusBattle({ forcePower: { attacker: 100, defender: 200 } }));
    expect(outgunned!.isComeback).toBe(true);
    const narrow = battleEarnFacts(st, chorusBattle({ forcePower: { attacker: 100, defender: 130 } }));
    expect(narrow!.isComeback).toBe(false);
  });

  test("arena bouts: practice is bloodless XP-floor, stakes a step up, duels are PvP", () => {
    const st = mockState();
    const practice = battleEarnFacts(st, chorusBattle({ arena: { challengeId: "c1", season: "s", stakes: false } }));
    expect(practice!.kind).toBe("arena-practice");
    expect(practice!.isMarch).toBe(false);
    const stakes = battleEarnFacts(st, chorusBattle({ arena: { challengeId: "c1", season: "s", stakes: true } }));
    expect(stakes!.kind).toBe("arena-stakes");
    const duel = battleEarnFacts(
      st,
      chorusBattle({ zoneId: "duel-circle", arena: { challengeId: "c1", season: "s", stakes: false } }),
    );
    expect(duel!.kind).toBe("pvp");
  });

  test("a defensive stand is no march; a foreign battle is not ours", () => {
    const st = mockState();
    const defense = battleEarnFacts(
      st,
      chorusBattle({
        attacker: force("attacker", "enemy-9"),
        defender: force("defender", "game-1"),
        result: { outcome: "defender_victory", endedAt: NOW },
      }),
    );
    expect(defense!.mySide).toBe("defender");
    expect(defense!.won).toBe(true);
    expect(defense!.isMarch).toBe(false);
    expect(defense!.isCapture).toBe(false);
    const foreign = battleEarnFacts(
      st,
      chorusBattle({ attacker: force("attacker", "a"), defender: force("defender", "b") }),
    );
    expect(foreign).toBeNull();
  });

  test("foe leader level: best enemy hero; chorus cells stay neutral (grade prices the raid)", () => {
    const st = mockState({ leaders: [leader("leader-1", 200)] }); // L2
    const pvp = battleEarnFacts(
      st,
      chorusBattle({
        defender: force("defender", "enemy-9", { heroSquad: [snap("foe-a", 3), snap("foe-b", 6)] }),
      }),
    );
    expect(pvp!.kind).toBe("pvp");
    expect(pvp!.myLeaderLevel).toBe(2);
    expect(pvp!.foeLeaderLevel).toBe(6);
    const raid = battleEarnFacts(
      st,
      chorusBattle({ defender: force("defender", "chorus-site-zone-1", { fobStage: 4, heroSquad: [snap("chorus-cell", 1)] }) }),
    );
    expect(raid!.foeLeaderLevel).toBe(raid!.myLeaderLevel);
    expect(raid!.grade).toBe(5);
  });
});

describe("processHeroEarn — the tick", () => {
  test("a chorus win folds counters, stamps the battle, and intents the leader grant", () => {
    const st = mockState();
    st.battles = [chorusBattle()];
    const s1 = processHeroEarn(st, NOW, { contributionScore: 0 });
    expect(s1.battlesProcessed).toBe(1);
    expect(st.heroDeedProgress!.marches).toBe(1);
    expect(st.heroDeedProgress!.captures).toBe(1);
    expect(st.heroDeedProgress!.breach).toBe(true);
    expect(st.heroDeedProgress!.cleanMarch).toBe(true);
    expect(st.heroDeedProgress!.warWeeks).toHaveLength(1);
    expect(s1.leaderGrants).toEqual([
      { leaderId: "leader-1", amount: 10, source: "led a Chorus raid (G3)", kind: "chorus-raid", battleId: "battle-1" },
    ]);
    // Idempotent: a second tick over the same record pays and counts nothing.
    const s2 = processHeroEarn(st, NOW, { contributionScore: 0 });
    expect(s2.battlesProcessed).toBe(0);
    expect(s2.leaderGrants).toHaveLength(0);
    expect(st.heroDeedProgress!.marches).toBe(1);
  });

  test("first battle completes breach + capture + clean-march deeds; single-hero pools grant", () => {
    const st = mockState();
    st.battles = [chorusBattle()];
    const s = processHeroEarn(st, NOW, { contributionScore: 0 });
    expect(s.deedsCompleted.includes("hero_first_breach")).toBe(true);
    expect(s.deedsCompleted.includes("hero_capture_1")).toBe(true);
    expect(s.deedsCompleted.includes("hero_clean_march")).toBe(true);
    // azazel-3 (breach pool of one) and semira-revealer (clean-march pool of
    // one) join the roster, stamped with the deed that earned them.
    const az = earnedHero(st, "azazel-3");
    expect(az).not.toBeNull();
    expect(az!.earnedBy).toBe("hero_first_breach");
    expect(earnedHero(st, "semira-revealer")!.earnedBy).toBe("hero_clean_march");
    // hero_capture_1's pool is empty — a milestone, no grant.
    expect(deedCompleted(st, "hero_capture_1")).toBe(true);
    expect(deedClaimed(st, "hero_capture_1")).toBe(false);
    // The Hall join renders the granted heroes as earned.
    const roster = buildHeroRoster(st.earnedHeroes!);
    expect(roster.find((e) => e.def.id === "azazel-3")!.earned).toBe(true);
    expect(roster.find((e) => e.def.id === "vesper-syllabus")!.earned).toBe(false);
    // Ledger shape: completions carry heroId null; grants name the hero.
    const completion = st.heroDeeds!.find((r) => r.deedId === "hero_first_breach" && !r.grant);
    expect(completion!.heroId).toBeNull();
    expect(completion!.evidence).toBe("battle-1");
    const grant = st.heroDeeds!.find((r) => r.deedId === "hero_first_breach" && r.grant);
    expect(grant!.heroId).toBe("azazel-3");
  });

  test("participating heroes earn the published battle XP (win + capture), capped colony-wide", () => {
    const st = mockState();
    ensureHeroEarn(st);
    const az = newHeroUnit(HERO_BY_ID["azazel-3"]!, "hero_first_breach", NOW);
    st.earnedHeroes = [az];
    st.battles = [
      chorusBattle({ attacker: force("attacker", "game-1", { heroSquad: [snap("azazel-3", 1)] }) }),
    ];
    processHeroEarn(st, NOW, { contributionScore: 0 });
    // marchWin + capture, then the three deeds this battle completes pay
    // their witnesses heroDeedOrFirst each — the colony's 40/day hero cap
    // throttles the total to exactly 40.
    expect(az.xp).toBe(HERO_XP_SOURCES.marchWin + HERO_XP_SOURCES.capture + 15);
    expect(az.xp <= 40).toBe(true);
    expect(az.dayXp).toBe(az.xp);
  });

  test("a loss pays heroes the participation source and the leader the loss share", () => {
    const st = mockState();
    ensureHeroEarn(st);
    const keeper = newHeroUnit(HERO_BY_ID["keeper-mend"]!, "hero_haul_10", NOW);
    st.earnedHeroes = [keeper];
    st.battles = [
      chorusBattle({
        result: { outcome: "defender_victory", endedAt: NOW },
        attacker: force("attacker", "game-1", { heroSquad: [snap("keeper-mend", 1)] }),
      }),
    ];
    const s = processHeroEarn(st, NOW, { contributionScore: 0 });
    expect(keeper.xp).toBe(HERO_XP_SOURCES.marchLoss);
    expect(s.leaderGrants[0]!.amount).toBe(5); // G3 base 10 × 0.5 loss share
    expect(st.heroDeedProgress!.captures).toBe(0);
    expect(st.heroDeedProgress!.marches).toBe(1); // a lost march still marched
  });

  test("the grant goes to the senior ACTIVE leader (the Arena's convention)", () => {
    const st = mockState({
      leaders: [leader("junior", 0), leader("senior", 2500), leader("wounded-vet", 5000, "wounded")],
    });
    expect(commandingLeader(st)!.id).toBe("senior");
    st.battles = [chorusBattle()];
    const s = processHeroEarn(st, NOW, { contributionScore: 0 });
    expect(s.leaderGrants[0]!.leaderId).toBe("senior");
  });
});

describe("deed evaluation — thresholds and counters", () => {
  test("contribution deeds need the injected score; 49 waits, 50 latches", () => {
    const st = mockState();
    evaluateHeroDeeds(st, NOW, {});
    expect(deedCompleted(st, "hero_contribution_50")).toBe(false);
    evaluateHeroDeeds(st, NOW, { contributionScore: 49 });
    expect(deedCompleted(st, "hero_contribution_50")).toBe(false);
    const ev = evaluateHeroDeeds(st, NOW, { contributionScore: 50 });
    expect(ev.completed.includes("hero_contribution_50")).toBe(true);
    // Pool of two — no auto-grant; the colony names its champion.
    expect(ev.granted).toHaveLength(0);
    expect(earnedHero(st, "last-lecturer")).toBeNull();
  });

  test("codex deeds read the revelation counters (20 scholar / 40 legend)", () => {
    const st = mockState();
    (st.revelationCounters as { codicesEarnedByDeeds: number }).codicesEarnedByDeeds = 20;
    evaluateHeroDeeds(st, NOW, {});
    expect(deedCompleted(st, "hero_codex_scholar")).toBe(true);
    expect(deedCompleted(st, "hero_legend_codex")).toBe(false);
  });

  test("five marches complete the march deed; war weeks accumulate distinctly", () => {
    const st = mockState();
    for (let i = 1; i <= 5; i++) {
      const at = NOW + i * 7 * 86_400_000;
      st.battles = [chorusBattle({ id: `b-${i}`, result: { outcome: "attacker_victory", endedAt: at } })];
      processHeroEarn(st, at, { contributionScore: 0 });
    }
    expect(st.heroDeedProgress!.marches).toBe(5);
    expect(deedCompleted(st, "hero_march_5")).toBe(true);
    expect(st.heroDeedProgress!.warWeeks.length).toBe(5);
    expect(deedCompleted(st, "hero_weeks_4")).toBe(true);
    // brother-candle's pool is a single hero — granted by the weeks deed.
    expect(earnedHero(st, "brother-candle")!.earnedBy).toBe("hero_weeks_4");
  });

  test("noteWarEvent folds the not-yet-live streams idempotently", () => {
    const st = mockState();
    noteWarEvent(st, "evt-1", { hauls: 6 }, NOW);
    noteWarEvent(st, "evt-1", { hauls: 6 }, NOW); // re-delivery: no double count
    expect(st.heroDeedProgress!.hauls).toBe(6);
    const ev = noteWarEvent(st, "evt-2", { hauls: 4 }, NOW);
    expect(st.heroDeedProgress!.hauls).toBe(10);
    expect(ev.completed.includes("hero_haul_10")).toBe(true);
    expect(earnedHero(st, "keeper-mend")!.earnedBy).toBe("hero_haul_10");
  });
});

describe("claims — the colony names the champion", () => {
  function marchedState(): GameState {
    const st = mockState();
    ensureHeroEarn(st);
    st.heroDeedProgress!.marches = 5;
    evaluateHeroDeeds(st, NOW, {});
    return st;
  }

  test("claim grants from the pool, stamps provenance, and latches", () => {
    const st = marchedState();
    expect(deedCompleted(st, "hero_march_5")).toBe(true);
    const res = claimHeroFromDeed(st, { deedId: "hero_march_5", heroId: "vesper-syllabus", requestId: "req-1", now: NOW });
    expect(res.ok).toBe(true);
    const unit = earnedHero(st, "vesper-syllabus");
    expect(unit!.earnedBy).toBe("hero_march_5");
    expect(deedClaimed(st, "hero_march_5")).toBe(true);
    // A retried claim (same request id) returns the original grant.
    const retry = claimHeroFromDeed(st, { deedId: "hero_march_5", heroId: "vesper-syllabus", requestId: "req-1", now: NOW });
    expect(retry.ok && retry.idempotent).toBe(true);
    expect(st.earnedHeroes!.filter((h) => h.id === "vesper-syllabus")).toHaveLength(1);
    // A fresh claim on a spent deed is refused.
    const second = claimHeroFromDeed(st, { deedId: "hero_march_5", heroId: "unwritten-answer", requestId: "req-2", now: NOW });
    expect(second.ok).toBe(false);
  });

  test("claims validate: incomplete deed, hero outside the pool, unknown deed", () => {
    const st = mockState();
    const early = claimHeroFromDeed(st, { deedId: "hero_march_5", heroId: "vesper-syllabus", requestId: "r", now: NOW });
    expect(early.ok).toBe(false);
    const st2 = marchedState();
    const wrongPool = claimHeroFromDeed(st2, { deedId: "hero_march_5", heroId: "keeper-mend", requestId: "r", now: NOW });
    expect(wrongPool.ok).toBe(false);
    const unknown = claimHeroFromDeed(st2, { deedId: "hero_nope", heroId: "x", requestId: "r", now: NOW });
    expect(unknown.ok).toBe(false);
  });
});

describe("oracle vouch — the alternate earn route", () => {
  function vouchedState(favor: number, met: boolean): GameState {
    const st = mockState();
    ensureOracles(st);
    const oracleId = oracleForRace("watchers");
    const oracles = (st as unknown as { oracles: { oracles: Record<string, unknown> } }).oracles;
    oracles.oracles[oracleId] = { ...(oracles.oracles[oracleId] as object), met, favor };
    return st;
  }

  test("met + favor at the published threshold vouches; the stamp names the Oracle", () => {
    const st = vouchedState(FAVOR_THRESHOLDS.vouchEligible, true);
    const def = HERO_BY_ID["azazel-3"]!;
    expect(heroVouchStatus(st, def).eligible).toBe(true);
    const res = claimHeroVouch(st, { heroId: "azazel-3", requestId: "v-1", now: NOW });
    expect(res.ok).toBe(true);
    const unit = earnedHero(st, "azazel-3");
    expect(unit!.earnedBy).toBe(`oracle_vouch:${oracleForRace("watchers")}`);
    expect(st.heroDeeds!.find((r) => r.grant && r.heroId === "azazel-3")!.deedId).toBe("oracle_vouch:watchers");
    // Retry is idempotent; a second hero needs its own claim.
    const retry = claimHeroVouch(st, { heroId: "azazel-3", requestId: "v-1", now: NOW });
    expect(retry.ok && retry.idempotent).toBe(true);
    expect(st.earnedHeroes).toHaveLength(1);
  });

  test("unmet Oracle or shallow favor refuses — favor is the only key", () => {
    const unmet = claimHeroVouch(vouchedState(99, false), { heroId: "azazel-3", requestId: "v", now: NOW });
    expect(unmet.ok).toBe(false);
    const shallow = claimHeroVouch(vouchedState(FAVOR_THRESHOLDS.vouchEligible - 1, true), {
      heroId: "azazel-3",
      requestId: "v",
      now: NOW,
    });
    expect(shallow.ok).toBe(false);
  });
});

describe("war week keys", () => {
  test("same ISO week shares a key; the next Monday differs", () => {
    expect(warWeekKey(Date.UTC(2026, 9, 12))).toBe(warWeekKey(Date.UTC(2026, 9, 18)));
    expect(warWeekKey(Date.UTC(2026, 9, 12))).not.toBe(warWeekKey(Date.UTC(2026, 9, 19)));
  });

  test("every catalog deed id the evaluator knows is real (no phantom deeds)", () => {
    for (const id of ["hero_first_breach", "hero_march_5", "hero_weeks_4", "hero_legend_codex"]) {
      expect(DEED_BY_ID[id]).toBeDefined();
    }
  });
});
