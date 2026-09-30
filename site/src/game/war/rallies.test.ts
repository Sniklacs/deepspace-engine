// Tests for rallies (site/src/game/war/rallies.ts) — the coordinated fist:
// create, pledge (lock on pledge), plan, launch into a real battle, resolve
// with contribution-locked loot and per-colony losses. No double-locks.
// Run: bun test src/game/war/rallies.test.ts
import { describe, expect, test } from "bun:test";
import {
  advanceRallies,
  cancelRally,
  createRally,
  ensureRallies,
  launchRally,
  pledgeToRally,
  rallyForce,
  rallyOf,
  setRallyPlan,
  splitRallyLoot,
  unpledgeFromRally,
} from "./rallies";
import { createAlliance, allianceOf } from "./alliances";
import { addCohort, availableWeight, emptyTroopHome } from "./troops";
import { attachBattlePlan, createBattle } from "./battle-engine";
import type { Battle, CommittedForce, ManeuverEntryState, RosterCommitSegment } from "./war-types";

/** Unwrap an AllianceResult-or-die: tests fail loudly instead of narrowing
 *  through `false | T` unions. */
function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.value;
}
import type { BattlePlan } from "./maneuvers";
import type { GameState } from "../types";

const NOW = 1_800_000_000_000;

function fakeState(supplies = 5000): GameState {
  return {
    gameId: "col-a",
    resources: { supplies },
    troops: { home: emptyTroopHome(0), bands: [], history: [] },
    battles: [],
    seasonId: "s1",
  } as unknown as GameState;
}

/** Alliance with two members (col-a leader, col-b member), troops mustered. */
function withRallySetup() {
  const st = fakeState();
  createAlliance(st, { id: "col-a", name: "Alpha" }, 3, { name: "War Band" }, NOW);
  const aid = allianceOf(st, "col-a")!.id;
  // col-b joins
  (st.alliances![aid].members as unknown[]).push({
    colonyId: "col-b", colonyName: "Beta", role: "member", joinedAt: NOW,
  });
  addCohort(st.troops!.home.roster, "bulwark", 600, NOW);
  return { st, aid };
}

function legalPlan(): BattlePlan {
  return {
    id: "plan-1",
    maneuvers: [
      { id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: 100 } },
      { id: "m-flank", vector: "FLANK_LEFT", enterAtMin: 10, composition: { reaver: 60 } },
    ],
  };
}

function illegalPlan(): BattlePlan {
  return {
    id: "plan-bad",
    maneuvers: [
      { id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: 50 } },
      { id: "m-main-2", vector: "MAIN", enterAtMin: 0, composition: { bulwark: 50 } },
    ],
  };
}

function oversizedPlan(): BattlePlan {
  return {
    id: "plan-big",
    maneuvers: [
      { id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: 700 } },
    ],
  };
}

describe("ensureRallies", () => {
  test("initializes an empty rally board", () => {
    const st = {} as GameState;
    ensureRallies(st);
    expect(st.rallies).toEqual({});
  });
});

describe("createRally", () => {
  test("leader/officer can call; launch window 5 min – 72 h", () => {
    const { st, aid } = withRallySetup();
    const r = createRally(
      st, { id: "col-a", name: "Alpha" }, aid,
      { name: "Hit the hive", target: { kind: "chorus-site", label: "Hive 7", zoneId: "z1" }, launchAt: NOW + 3_600_000 },
      NOW,
    );
    expect(r.ok).toBe(true);
    // too soon / too far
    expect(createRally(st, { id: "col-a", name: "Alpha" }, aid,
      { name: "X", target: { kind: "chorus-site", label: "H", zoneId: "z" }, launchAt: NOW + 60_000 }, NOW).ok).toBe(false);
    expect(createRally(st, { id: "col-a", name: "Alpha" }, aid,
      { name: "X", target: { kind: "chorus-site", label: "H", zoneId: "z" }, launchAt: NOW + 80 * 3_600_000 }, NOW).ok).toBe(false);
  });

  test("a plain member cannot call a rally", () => {
    const { st, aid } = withRallySetup();
    const r = createRally(
      st, { id: "col-b", name: "Beta" }, aid,
      { name: "Mutiny", target: { kind: "chorus-site", label: "H", zoneId: "z" }, launchAt: NOW + 3_600_000 },
      NOW,
    );
    expect(r.ok).toBe(false);
  });
});

describe("pledgeToRally", () => {
  test("pledge locks troops out of the garrison immediately", () => {
    const { st, aid } = withRallySetup();
    const rc = createRally(st, { id: "col-a", name: "Alpha" }, aid,
      { name: "Rally", target: { kind: "chorus-site", label: "H", zoneId: "z" }, launchAt: NOW + 3_600_000 }, NOW);
    const rid = (rc.ok && rc.value.id) as string;
    expect(pledgeToRally(st, rid, { id: "col-a", name: "Alpha" }, 300, [], NOW).ok).toBe(true);
    expect(availableWeight(st.troops!.home.roster)).toBe(300);
    expect(st.troops!.home.roster.committedWeight).toBe(300);
    expect(rallyForce(rallyOf(st, rid)!).troops).toBe(300);
  });

  test("over-pledge is refused outright — no ghost numbers, no silent cap", () => {
    const { st, aid } = withRallySetup();
    const rc = createRally(st, { id: "col-a", name: "Alpha" }, aid,
      { name: "Rally", target: { kind: "chorus-site", label: "H", zoneId: "z" }, launchAt: NOW + 3_600_000 }, NOW);
    const rid = (rc.ok && rc.value.id) as string;
    const r = pledgeToRally(st, rid, { id: "col-a", name: "Alpha" }, 9000, [], NOW);
    expect(r.ok).toBe(false);
    expect(availableWeight(st.troops!.home.roster)).toBe(600); // untouched
  });

  test("unpledge returns the troops; revise via unpledge then re-pledge", () => {
    const { st, aid } = withRallySetup();
    const rc = createRally(st, { id: "col-a", name: "Alpha" }, aid,
      { name: "Rally", target: { kind: "chorus-site", label: "H", zoneId: "z" }, launchAt: NOW + 3_600_000 }, NOW);
    const rid = (rc.ok && rc.value.id) as string;
    pledgeToRally(st, rid, { id: "col-a", name: "Alpha" }, 300, [], NOW);
    expect(unpledgeFromRally(st, rid, "col-a").ok).toBe(true);
    expect(availableWeight(st.troops!.home.roster)).toBe(600);
    // double-pledge without unpledging is refused — revise explicitly
    pledgeToRally(st, rid, { id: "col-a", name: "Alpha" }, 100, [], NOW);
    expect(pledgeToRally(st, rid, { id: "col-a", name: "Alpha" }, 200, [], NOW).ok).toBe(false);
    expect(unpledgeFromRally(st, rid, "col-a").ok).toBe(true);
    pledgeToRally(st, rid, { id: "col-a", name: "Alpha" }, 200, [], NOW);
    expect(rallyForce(rallyOf(st, rid)!).troops).toBe(200);
    expect(st.troops!.home.roster.committedWeight).toBe(200);
  });

  test("cancel releases every pledge", () => {
    const { st, aid } = withRallySetup();
    const rc = createRally(st, { id: "col-a", name: "Alpha" }, aid,
      { name: "Rally", target: { kind: "chorus-site", label: "H", zoneId: "z" }, launchAt: NOW + 3_600_000 }, NOW);
    const rid = (rc.ok && rc.value.id) as string;
    pledgeToRally(st, rid, { id: "col-a", name: "Alpha" }, 300, [], NOW);
    expect(cancelRally(st, rid, "col-a").ok).toBe(true);
    expect(availableWeight(st.troops!.home.roster)).toBe(600);
    expect(rallyOf(st, rid)!.state).toBe("cancelled");
  });
});

describe("setRallyPlan", () => {
  test("caller sets the plan; illegal plans rejected before launch", () => {
    const { st, aid } = withRallySetup();
    const rc = createRally(st, { id: "col-a", name: "Alpha" }, aid,
      { name: "Rally", target: { kind: "chorus-site", label: "H", zoneId: "z" }, launchAt: NOW + 3_600_000 }, NOW);
    const rid = (rc.ok && rc.value.id) as string;
    expect(setRallyPlan(st, rid, "col-a", legalPlan()).ok).toBe(true);
    // no MAIN → illegal
    const bad: BattlePlan = {
      id: "bad", maneuvers: [{ id: "x", vector: "FLANK_LEFT", enterAtMin: 5, composition: { reaver: 10 } }],
    };
    expect(setRallyPlan(st, rid, "col-a", bad).ok).toBe(false);
    // a plain member (not caller, not officer) can't set it
    expect(setRallyPlan(st, rid, "col-b", legalPlan()).ok).toBe(false);
  });
});

describe("launchRally", () => {
  function launched() {
    const { st, aid } = withRallySetup();
    const rc = createRally(st, { id: "col-a", name: "Alpha" }, aid,
      { name: "Rally", target: { kind: "chorus-site", label: "Hive 7", zoneId: "z1" }, launchAt: NOW + 3_600_000 }, NOW);
    const rid = (rc.ok && rc.value.id) as string;
    pledgeToRally(st, rid, { id: "col-a", name: "Alpha" }, 400, [], NOW);
    pledgeToRally(st, rid, { id: "col-b", name: "Beta" }, 200, [], NOW);
    setRallyPlan(st, rid, "col-a", legalPlan());
    const battle = must(launchRally(st, rid, "col-a", NOW));
    return { st, rid, battle };
  }

  test("launch opens a real battle: the plan partitions the pledged pool", () => {
    const { st, rid, battle } = launched();
    expect(st.battles!.some((b: Battle) => b.id === battle.id)).toBe(true);
    // plan weight rides the entries (bulwark 100×1 + reaver 60×1); 600 pledged
    const planWeight = battle.internal.planState!.entries.reduce(
      (s: number, e: ManeuverEntryState) => s + (e.weight ?? 0), 0);
    expect(planWeight).toBe(160);
    expect(battle.attacker.troops).toBe(600 - planWeight);
    expect(battle.internal.planState!.entries).toHaveLength(2);
    expect(battle.internal.planState!.entries.every((e: ManeuverEntryState) => !e.entered)).toBe(true);
    expect(battle.internal.planState!.entries.find((e: ManeuverEntryState) => e.vector === "MAIN")!.weight).toBe(100);
    const r = rallyOf(st, rid)!;
    expect(r.state).toBe("launched");
    expect(r.battleId).toBe(battle.id);
  });

  test("one rally segment per pledger — casualty attribution, no maneuver segments", () => {
    const { battle } = launched();
    const segs = battle.internal.rosterCommits!.attacker!;
    const rallySegs = segs.filter((s: RosterCommitSegment) => s.kind === "rally");
    expect(rallySegs).toHaveLength(2);
    expect(rallySegs.reduce((s: number, x: RosterCommitSegment) => s + x.weight, 0)).toBe(600);
    expect(segs.some((s: RosterCommitSegment) => s.kind === "maneuver")).toBe(false);
  });

  test("precommitted attach is the same seam: same validation, zero commits", () => {
    const { st } = withRallySetup();
    const attacker: CommittedForce = {
      side: "attacker",
      colonyId: "rally:x",
      colonyName: "War Band — X",
      heroSquad: [],
      weapons: [],
      troops: 600,
      fobStage: 0,
    };
    const defender: CommittedForce = {
      side: "defender",
      colonyId: "chorus-site",
      colonyName: "Chorus",
      heroSquad: [],
      weapons: [],
      troops: 480,
      fobStage: 0,
    };
    const b = createBattle({ zoneId: "z", zoneName: "Z", attacker: { ...attacker }, defender: { ...defender } }, NOW);
    // illegal plan → same rejection the normal path gives
    const bad = attachBattlePlan(st, b, "attacker", illegalPlan(), { kind: "home" }, NOW, undefined, {
      precommitted: true, pledgedWeight: 600,
    });
    expect(bad.ok).toBe(false);
    expect(b.internal.planState).toBeUndefined();
    // legal plan → partitions the field, commits nothing, stamps no maneuver segments
    const lockedBefore = st.troops!.home.roster.committedWeight;
    const res = attachBattlePlan(st, b, "attacker", legalPlan(), { kind: "home" }, NOW, undefined, {
      precommitted: true, pledgedWeight: 600,
    });
    expect(res.ok).toBe(true);
    expect(b.attacker.troops).toBe(600 - 160);
    expect(b.internal.planState!.entries).toHaveLength(2);
    expect(st.troops!.home.roster.committedWeight).toBe(lockedBefore);
    expect((b.internal.rosterCommits?.attacker ?? []).some((s: RosterCommitSegment) => s.kind === "maneuver")).toBe(false);
    // oversized plan → rejected, never launched broken
    const b2 = createBattle({ zoneId: "z", zoneName: "Z", attacker: { ...attacker }, defender: { ...defender } }, NOW);
    const big = attachBattlePlan(st, b2, "attacker", oversizedPlan(), { kind: "home" }, NOW, undefined, {
      precommitted: true, pledgedWeight: 600,
    });
    expect(big.ok).toBe(false);
  });

  test("pledges commit exactly once — launch never double-locks", () => {
    const { st } = launched();
    expect(st.troops!.home.roster.committedWeight).toBe(600);
  });

  test("launch with an oversized plan is rejected, not launched broken", () => {
    const { st, aid } = withRallySetup();
    const rc = createRally(st, { id: "col-a", name: "Alpha" }, aid,
      { name: "Rally", target: { kind: "chorus-site", label: "H", zoneId: "z" }, launchAt: NOW + 3_600_000 }, NOW);
    const rid = (rc.ok && rc.value.id) as string;
    pledgeToRally(st, rid, { id: "col-a", name: "Alpha" }, 100, [], NOW);
    const huge: BattlePlan = {
      id: "huge",
      maneuvers: [{ id: "m", vector: "MAIN", enterAtMin: 0, composition: { bulwark: 500 } }],
    };
    setRallyPlan(st, rid, "col-a", huge);
    expect(launchRally(st, rid, "col-a", NOW).ok).toBe(false);
    expect(rallyOf(st, rid)!.state).toBe("open");
  });

  test("the timer auto-launches the rally when its moment comes", () => {
    const { st, aid } = withRallySetup();
    const rc = createRally(st, { id: "col-a", name: "Alpha" }, aid,
      { name: "Rally", target: { kind: "chorus-site", label: "H", zoneId: "z" }, launchAt: NOW + 1_000_000 }, NOW);
    const rid = (rc.ok && rc.value.id) as string;
    pledgeToRally(st, rid, { id: "col-a", name: "Alpha" }, 300, [], NOW);
    advanceRallies(st, NOW + 1_100_000);
    expect(rallyOf(st, rid)!.state).toBe("launched");
  });
});

describe("resolveRally", () => {
  test("victory: loot splits strictly by contribution; losses recorded per colony", () => {
    const st = fakeState();
    createAlliance(st, { id: "col-a", name: "Alpha" }, 3, { name: "War Band" }, NOW);
    const aid = allianceOf(st, "col-a")!.id;
    (st.alliances![aid].members as unknown[]).push({
      colonyId: "col-b", colonyName: "Beta", role: "member", joinedAt: NOW,
    });
    addCohort(st.troops!.home.roster, "bulwark", 600, NOW);
    const rc = createRally(st, { id: "col-a", name: "Alpha" }, aid,
      { name: "Rally", target: { kind: "chorus-site", label: "H", zoneId: "z" }, launchAt: NOW + 3_600_000 }, NOW);
    const rid = (rc.ok && rc.value.id) as string;
    pledgeToRally(st, rid, { id: "col-a", name: "Alpha" }, 400, [], NOW);
    pledgeToRally(st, rid, { id: "col-b", name: "Beta" }, 200, [], NOW);
    const battle = must(launchRally(st, rid, "col-a", NOW));
    // The fight happens, the attacker wins with 10% casualties.
    battle.casualties.attacker = Math.round(battle.attacker.troops * 0.10);
    battle.attacker.troops = 600; // all entries marched in by the end
    battle.status = "resolved";
    battle.result = { outcome: "attacker_victory", endedAt: NOW + 600_000 };
    st.battles!.push(battle);

    advanceRallies(st, NOW + 700_000);
    const r = rallyOf(st, rid)!;
    expect(r.state).toBe("resolved");
    expect(r.outcome!.victory).toBe(true);
    // loot: 600 pledged × 0.5 = 300 supplies, split 400/200 → 2:1, no caller's cut
    expect(r.outcome!.lootSupplies).toBe(300);
    expect(r.outcome!.shares["col-a"]).toBe(200);
    expect(r.outcome!.shares["col-b"]).toBe(100);
    // losses: 10% of each pledger's weight
    expect(r.outcome!.losses["col-a"]).toBe(40);
    expect(r.outcome!.losses["col-b"]).toBe(20);
    // the local colony's share lands in its own stockpile (gameId col-a):
    // 5000 − 500 (founding) + 200 (loot share) = 4700
    expect(st.resources.supplies).toBe(4700);
  });

  test("splitRallyLoot is strictly proportional — favor is impossible", () => {
    const r = {
      pledges: [
        { colonyId: "a", troops: 1 },
        { colonyId: "b", troops: 999 },
      ],
    } as unknown as Parameters<typeof splitRallyLoot>[0];
    const shares = splitRallyLoot(r, 1000);
    expect(shares["a"] + shares["b"] <= 1000).toBe(true);
    expect(shares["b"] > shares["a"] * 500).toBe(true);
  });
});
