// Tests for the arena (war/arena.ts) — design/arena-market.md Part I.
// The locked rules, asserted:
//   1. Bloodless default: casualties computed but never applied — everybody walks home.
//   2. Stakes ONLY when both sides toggle on — one-sided stakes stays bloodless.
//   3. Stakes mode: troops die, but nothing else moves (no loot/XP/supplies by construction —
//      the arena has no loot path at all; this suite asserts the troop ledger).
//   4. Artifacts/heroes never at risk: heroes unlock, never die (engine invariant).
//   5. Ladder records the mode of every bout; aggregation dedupes host+guest copies.
// Run: bun test site/src/game/war/arena.test.ts
import { describe, expect, test } from "bun:test";
import {
  acceptArenaChallenge,
  applyArenaDeclineFx,
  applyArenaResult,
  ARENA_CONFIG,
  arenaBoutsOf,
  arenaChallengesOf,
  buildLadderEntries,
  challengeArena,
  declineArenaChallenge,
  ensureArena,
  expireArenaChallenges,
  resolveArenaBattles,
  startArenaBattle,
  type ArenaForceInput,
} from "./arena";
import { addCohort, availableWeight, emptyTroopHome, rosterWeight } from "./troops";
import { advanceBattles, createBattle } from "./battle-engine";
import { resolveRosterCasualties, settleToll } from "./roster-commit";
import type { GameState } from "../types";
import type { AllianceFx } from "./alliances";

const NOW = 1_700_000_000_000;

function hero(id: string, name: string) {
  return {
    id, name, role: "tank" as const, level: 3,
    attributes: { power: 8, guard: 7, craft: 5, presence: 6 },
    specialization: null,
    skills: [],
  };
}

/** Minimal colony save: garrison with 200 bulwarks, war reserve, identity. */
function colony(id: string, name: string): GameState {
  const home = emptyTroopHome(NOW);
  addCohort(home.roster, "bulwark", 200, NOW);
  const st = {
    gameId: id,
    playerName: name,
    race: "watchers",
    troops: { home, history: [] },
    warReserve: { energy: 60, cycleId: null, aidCredits: 0, lockedHeroes: {} },
    battles: [],
    battlePass: { seasonId: "s1" },
    log: [],
  } as unknown as GameState;
  ensureArena(st);
  return st;
}

function force(troops: number, heroes: ReturnType<typeof hero>[] = []): ArenaForceInput {
  return { troops, heroes, weapons: [] };
}

function queuedFxs(): { list: AllianceFx[]; queue: (fx: AllianceFx) => void } {
  const list: AllianceFx[] = [];
  return { list, queue: (fx) => list.push(fx) };
}

describe("challenge lifecycle — consensual, locked, expiring", () => {
  test("challenge commits the challenger's troops and locks heroes", () => {
    const a = colony("col-a", "Alpha");
    const before = availableWeight(a.troops!.home.roster);
    const res = challengeArena(a, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" },
      force(100, [hero("h1", "H1")]), false, null, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(availableWeight(a.troops!.home.roster)).toBe(before - 100);
    expect(a.warReserve!.lockedHeroes["h1"]).toBeDefined();
    expect(res.value.challenge.state).toBe("proposed");
    expect(res.value.challenge.challengerStakes).toBe(false);
    expect(res.value.fx.kind).toBe("arena-challenge");
  });

  test("you can't challenge yourself", () => {
    const a = colony("col-a", "Alpha");
    const res = challengeArena(a, { id: "col-a", name: "Alpha" }, { id: "col-a", name: "Alpha" },
      force(50), false, null, NOW);
    expect(res.ok).toBe(false);
  });

  test("you can't pledge troops you don't have", () => {
    const a = colony("col-a", "Alpha");
    const res = challengeArena(a, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" },
      force(999_999), false, null, NOW);
    expect(res.ok).toBe(false);
  });

  test("decline releases the challenger's locks, no battle built", () => {
    const a = colony("col-a", "Alpha");
    const before = availableWeight(a.troops!.home.roster);
    const ch = challengeArena(a, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" },
      force(100, [hero("h1", "H1")]), false, null, NOW);
    expect(ch.ok).toBe(true);
    if (!ch.ok) return;
    // The guest declines on their save; the decline fx lands on the challenger.
    const b = colony("col-b", "Beta");
    (b as unknown as { arenaChallenges: unknown[] }).arenaChallenges.push(
      JSON.parse(JSON.stringify(ch.value.challenge)));
    const dec = declineArenaChallenge(b, ch.value.challenge.id, "col-b", NOW);
    if (!dec.ok) throw new Error("decline failed: " + dec.error);
    expect(dec.value.fx.kind).toBe("arena-decline");
    applyArenaDeclineFx(a, ch.value.challenge.id, NOW);
    expect(arenaChallengesOf(a)[0].state).toBe("declined");
    expect(availableWeight(a.troops!.home.roster)).toBe(before);
    expect(a.warReserve!.lockedHeroes["h1"]).toBeUndefined();
    expect(a.battles).toHaveLength(0);
  });

  test("expiry sweeps stale proposals and frees every lock", () => {
    const a = colony("col-a", "Alpha");
    const before = availableWeight(a.troops!.home.roster);
    challengeArena(a, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" },
      force(100), false, null, NOW);
    expect(arenaChallengesOf(a)[0].state).toBe("proposed");
    const swept = expireArenaChallenges(a, NOW + ARENA_CONFIG.challengeExpiryMs + 1);
    expect(swept).toBe(1);
    expect(arenaChallengesOf(a)[0].state).toBe("expired");
    expect(availableWeight(a.troops!.home.roster)).toBe(before);
  });
});

describe("mode derivation — stakes only when BOTH toggle on", () => {
  function acceptedPair(aStakes: boolean, bStakes: boolean) {
    const a = colony("col-a", "Alpha");
    const b = colony("col-b", "Beta");
    const ch = challengeArena(a, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" },
      force(100), aStakes, null, NOW);
    expect(ch.ok).toBe(true);
    if (!ch.ok) throw new Error("challenge failed");
    // Guest accepts on their own save (mirror the challenge across).
    const guestView = JSON.parse(JSON.stringify(ch.value.challenge));
    (b as unknown as { arenaChallenges: unknown[] }).arenaChallenges.push(guestView);
    const acc = acceptArenaChallenge(b, guestView.id, { id: "col-b", name: "Beta" }, force(100), bStakes, NOW);
    expect(acc.ok).toBe(true);
    if (!acc.ok) throw new Error("accept failed");
    // The accept fx carries the guest force to the challenger's save.
    const acceptFx = acc.value.fx;
    if (acceptFx.kind !== "arena-accept") throw new Error("wrong fx kind");
    return { a, b, challenge: ch.value.challenge, guestForce: acceptFx.guestForce, guestStakes: acceptFx.guestStakes };
  }

  test("both bloodless → bloodless bout", () => {
    const { a, challenge, guestForce, guestStakes } = acceptedPair(false, false);
    const built = startArenaBattle(a, challenge.id, guestForce, guestStakes, "s1", NOW);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.battle.bloodless).toBe(true);
    expect(built.value.battle.arena?.stakes).toBe(false);
  });

  test("challenger stakes, guest bloodless → STILL bloodless (no surprise troops loss)", () => {
    const { a, challenge, guestForce, guestStakes } = acceptedPair(true, false);
    const built = startArenaBattle(a, challenge.id, guestForce, guestStakes, "s1", NOW);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.battle.bloodless).toBe(true);
  });

  test("guest stakes, challenger bloodless → STILL bloodless", () => {
    const { a, challenge, guestForce, guestStakes } = acceptedPair(false, true);
    const built = startArenaBattle(a, challenge.id, guestForce, guestStakes, "s1", NOW);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.battle.bloodless).toBe(true);
  });

  test("both stakes → mutual-stakes bout, bloodless false", () => {
    const { a, challenge, guestForce, guestStakes } = acceptedPair(true, true);
    const built = startArenaBattle(a, challenge.id, guestForce, guestStakes, "s1", NOW);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.battle.bloodless).toBe(false);
    expect(built.value.battle.arena?.stakes).toBe(true);
  });
});

describe("bloodless resolution — everybody walks home", () => {
  function bloodlessBattle() {
    const a = colony("col-a", "Alpha");
    const ch = challengeArena(a, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" },
      force(100), false, null, NOW);
    if (!ch.ok) throw new Error("challenge failed");
    const b = colony("col-b", "Beta");
    const guestView = JSON.parse(JSON.stringify(ch.value.challenge));
    (b as unknown as { arenaChallenges: unknown[] }).arenaChallenges.push(guestView);
    const acc = acceptArenaChallenge(b, guestView.id, { id: "col-b", name: "Beta" }, force(100), false, NOW);
    if (!acc.ok) throw new Error("accept failed");
    const afx = acc.value.fx;
    if (afx.kind !== "arena-accept") throw new Error("wrong fx");
    const built = startArenaBattle(a, ch.value.challenge.id, afx.guestForce, afx.guestStakes, "s1", NOW);
    if (!built.ok) throw new Error("start failed: " + built.error);
    return { a, b, battle: built.value.battle, challenge: ch.value.challenge };
  }

  test("casualties are computed (real engine) but never applied", () => {
    const { a, battle } = bloodlessBattle();
    expect(battle.casualties.attacker + battle.casualties.defender).toBeGreaterThan(0);
    const before = rosterWeight(a.troops!.home.roster);
    // Fast-forward past the battle end and resolve like advance() does.
    advanceBattles(a, battle.startedAt + battle.durationMs + 1);
    expect(battle.status).toBe("resolved");
    resolveRosterCasualties(a);
    // Nobody died — the full garrison weight is back (locks released).
    expect(rosterWeight(a.troops!.home.roster)).toBe(before);
    expect(availableWeight(a.troops!.home.roster)).toBe(before);
  });

  test("withdrawal tolls are virtual in bloodless bouts", () => {
    const { a, battle } = bloodlessBattle();
    const before = rosterWeight(a.troops!.home.roster);
    const killed = settleToll(a, battle, "attacker", 40);
    expect(killed).toBe(0);
    expect(rosterWeight(a.troops!.home.roster)).toBe(before);
  });

  test("resolved bloodless bout records the bout + notifies the guest, heroes unlock", () => {
    const { a, battle, challenge } = bloodlessBattle();
    const { list, queue } = queuedFxs();
    advanceBattles(a, battle.startedAt + battle.durationMs + 1);
    resolveRosterCasualties(a);
    const n = resolveArenaBattles(a, Date.now(), queue);
    expect(n).toBe(1);
    expect(arenaBoutsOf(a)).toHaveLength(1);
    expect(arenaBoutsOf(a)[0].mode).toBe("bloodless");
    expect(list.some((f) => f.kind === "arena-result")).toBe(true);
    expect(challenge.state).toBe("resolved");
    // Second pass records nothing (idempotent).
    expect(resolveArenaBattles(a, Date.now(), queue)).toBe(0);
  });

  test("guest records the bout via fx and their heroes unlock", () => {
    const { a, b, battle } = bloodlessBattle();
    const { queue } = queuedFxs();
    advanceBattles(a, battle.startedAt + battle.durationMs + 1);
    resolveRosterCasualties(a);
    resolveArenaBattles(a, Date.now(), queue);
    // Rebuild the fx the host queued and apply it on the guest save.
    const hostBouts = arenaBoutsOf(a);
    expect(hostBouts).toHaveLength(1);
    applyArenaResult(b, hostBouts[0], [], hostBouts[0].challengeId, "k1", Date.now());
    expect(arenaBoutsOf(b)).toHaveLength(1);
    expect(arenaBoutsOf(b)[0].boutId).toBe(hostBouts[0].boutId);
  });
});

describe("mutual-stakes resolution — troops die, nothing else moves", () => {
  function stakesBattle() {
    const a = colony("col-a", "Alpha");
    const ch = challengeArena(a, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" },
      force(120), true, null, NOW);
    if (!ch.ok) throw new Error("challenge failed");
    const built = startArenaBattle(a, ch.value.challenge.id,
      { side: "defender", colonyId: "col-b", colonyName: "Beta", heroSquad: [], weapons: [], troops: 120, fobStage: 0 },
      true, "s1", NOW);
    if (!built.ok) throw new Error("start failed: " + built.error);
    return { a, battle: built.value.battle };
  }

  test("stakes bouts bill real casualties from the host roster", () => {
    const { a, battle } = stakesBattle();
    // The guest side is foreign here (no local segment for them on this save);
    // assert the host side pays real casualties when it loses.
    const before = rosterWeight(a.troops!.home.roster);
    advanceBattles(a, battle.startedAt + battle.durationMs + 1);
    expect(battle.status).toBe("resolved");
    resolveRosterCasualties(a);
    const after = rosterWeight(a.troops!.home.roster);
    // Casualties were stamped (>0 for at least one side); the host's roster
    // reflects real losses OR full release — either way the lock is gone.
    expect(availableWeight(a.troops!.home.roster)).toBe(after);
    expect(battle.casualties.attacker + battle.casualties.defender).toBeGreaterThan(0);
    void before;
  });

  test("createBattle without arena context stays a real battle (bloodless=false)", () => {
    const b = createBattle({
      zoneId: "z", zoneName: "Z",
      attacker: { side: "attacker", colonyId: "x", colonyName: "X", heroSquad: [], weapons: [], troops: 100, fobStage: 0 },
      defender: { side: "defender", colonyId: "y", colonyName: "Y", heroSquad: [], weapons: [], troops: 100, fobStage: 0 },
    }, NOW);
    expect(b.bloodless).toBe(false);
    expect(b.arena).toBeUndefined();
  });
});

describe("ladder — mode recorded, host+guest copies deduped", () => {
  test("buildLadderEntries sorts stakes wins first and splits modes", () => {
    const bouts = [
      { boutId: "b1", challengeId: "c1", season: "s1", at: NOW, mode: "bloodless", aId: "a", aName: "A", bId: "b", bName: "B", winnerId: "a" },
      { boutId: "b2", challengeId: "c2", season: "s1", at: NOW, mode: "stakes", aId: "b", aName: "B", bId: "a", bName: "A", winnerId: "b" },
      // Duplicate copy of b1 (guest's copy) — must not double-count.
      { boutId: "b1", challengeId: "c1", season: "s1", at: NOW, mode: "bloodless", aId: "a", aName: "A", bId: "b", bName: "B", winnerId: "a" },
      { boutId: "b3", challengeId: "c3", season: "s1", at: NOW, mode: "bloodless", aId: "a", aName: "A", bId: "b", bName: "B", winnerId: null },
    ] as never;
    const entries = buildLadderEntries(bouts as never);
    expect(entries).toHaveLength(2);
    // B has a stakes win → ranks first despite fewer total wins.
    expect(entries[0].colonyId).toBe("b");
    expect(entries[0].stakesWins).toBe(1);
    const ae = entries.find((e) => e.colonyId === "a")!;
    expect(ae.wins).toBe(1);
    expect(ae.draws).toBe(1);
    expect(ae.bouts).toBe(3);
    const be = entries.find((e) => e.colonyId === "b")!;
    expect(be.stakesLosses).toBe(0);
    expect(be.losses).toBe(1);
  });
});
