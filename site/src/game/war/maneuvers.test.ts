// Tests for the maneuver attach/launch seam (war/battle-engine.ts attachBattlePlan)
// and the real-roster decision paths (no ghost numbers anywhere).
// Run: bun test src/game/war/maneuvers.test.ts
import { describe, expect, test } from "bun:test";
import {
  advanceManeuverEntries,
  attachBattlePlan,
  battlePublicView,
  createBattle,
  issueDecision,
  screenVector,
} from "./battle-engine";
import { maneuverWeight, planComposition, planWeight, surpriseMult, type BattlePlan } from "./maneuvers";
import {
  commitRosterWeight,
  resolveRosterCasualties,
  rosterForCommit,
  segmentsFor,
  settleToll,
  stampRosterSegment,
} from "./roster-commit";
import { addCohort, availableWeight, emptyTroopHome } from "./troops";
import type { Battle, BattleReserves, CommittedForce } from "./war-types";
import type { GameState } from "../types";

function fakeState(): GameState {
  const st = {
    troops: { home: emptyTroopHome(0), bands: [], history: [] },
    forwardBases: {},
    battles: [],
    seasonId: "s1",
  } as unknown as GameState;
  const r = rosterForCommit(st, { kind: "home" })!;
  addCohort(r, "bulwark", 300, 0);
  addCohort(r, "reaver", 200, 0);
  addCohort(r, "warden", 100, 0);
  addCohort(r, "longeye", 80, 0);
  addCohort(r, "thunder", 60, 0);
  return st;
}

function force(side: "attacker" | "defender", troops: number): CommittedForce {
  return {
    side,
    colonyId: `${side}-colony`,
    colonyName: `${side} colony`,
    heroSquad: [],
    weapons: [],
    troops,
    fobStage: 0,
  };
}

function liveBattle(now = 1_000_000): Battle {
  return createBattle(
    { zoneId: "test-zone", zoneName: "Test Zone", attacker: force("attacker", 600), defender: force("defender", 300) },
    now,
  );
}

/** The engine's real-roster view: what the side can actually still send. */
function reservesFor(st: GameState): BattleReserves {
  const r = rosterForCommit(st, { kind: "home" })!;
  return { reserveHeroIds: [], reserveTroops: availableWeight(r), energy: 100 };
}

function legalPlan(): BattlePlan {
  // NOTE: the test battle runs ~25 min, so timed entries must land inside it.
  return {
    id: "plan-1",
    maneuvers: [
      { id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: 100 } },
      { id: "m-flank", vector: "FLANK_LEFT", enterAtMin: 10, composition: { reaver: 60 } },
    ],
  };
}

describe("attachBattlePlan", () => {
  test("pledges every maneuver out of the real roster, hides the plan, publishes only composition", () => {
    const st = fakeState();
    const b = liveBattle();
    const before = reservesFor(st).reserveTroops;
    const plan = legalPlan();
    const need = planWeight(plan);

    const res = attachBattlePlan(st, b, "defender", plan, { kind: "home" }, b.startedAt, reservesFor(st));
    expect(res.ok).toBe(true);

    // Roster: the pledged weight left the garrison on pledge, not on launch.
    expect(reservesFor(st).reserveTroops).toBe(before - need);

    // Segments: one per maneuver, vector-stamped, weights exact.
    const segs = segmentsFor(b, "defender").filter((s) => s.kind === "maneuver");
    expect(segs).toHaveLength(2);
    expect(segs.map((s) => s.vector).sort()).toEqual(["FLANK_LEFT", "MAIN"]);
    expect(segs.reduce((s, x) => s + x.weight, 0)).toBe(need);

    // Hidden state: the plan lives in internal only.
    expect(b.internal.planState).toBeDefined();
    expect(b.internal.planState!.entries).toHaveLength(2);
    expect(b.internal.planState!.entries.every((e) => !e.entered)).toBe(true);

    // Public view: composition only — no vectors, no timing, no plan state.
    const pub = battlePublicView(b);
    expect((pub as unknown as { internal?: unknown }).internal).toBeUndefined();
    expect(pub.maneuverIntel).toBeDefined();
    expect(pub.maneuverIntel!.composition).toEqual(planComposition(plan));
    expect(pub.maneuverIntel!.unentered).toBe(2);
    expect(pub.maneuverIntel!.entered).toEqual([]);
    const intelJson = JSON.stringify(pub.maneuverIntel);
    expect(intelJson.includes("FLANK_LEFT")).toBe(false);
    expect(intelJson.includes("enterAtMin")).toBe(false);
  });

  test("rejects illegal plans before pledging a single troop", () => {
    const st = fakeState();
    const b = liveBattle();
    const before = reservesFor(st).reserveTroops;
    const bad: BattlePlan = {
      id: "plan-bad",
      maneuvers: [
        { id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: 50 } },
        // Thunder is too heavy to sweep — FLANK is illegal.
        { id: "m-flank", vector: "FLANK_RIGHT", enterAtMin: 20, composition: { thunder: 10 } },
      ],
    };
    const res = attachBattlePlan(st, b, "defender", bad, { kind: "home" }, b.startedAt, reservesFor(st));
    expect(res.ok).toBe(false);
    expect(reservesFor(st).reserveTroops).toBe(before); // garrison untouched
    expect(segmentsFor(b, "defender")).toHaveLength(0); // nothing stamped
    expect(b.internal.planState).toBeUndefined();
    expect(b.maneuverIntel).toBeUndefined();
  });

  test("rejects REAR without its Warden logistics tail", () => {
    const st = fakeState();
    const b = liveBattle();
    const bad: BattlePlan = {
      id: "plan-rear",
      maneuvers: [
        { id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: 50 } },
        { id: "m-rear", vector: "REAR", enterAtMin: 40, composition: { reaver: 60 } }, // no wardens
      ],
    };
    const res = attachBattlePlan(st, b, "defender", bad, { kind: "home" }, b.startedAt, reservesFor(st));
    expect(res.ok).toBe(false);
  });

  test("rejects plans the garrison cannot afford — nothing committed", () => {
    const st = fakeState();
    const b = liveBattle();
    const before = reservesFor(st).reserveTroops;
    const rich: BattlePlan = {
      id: "plan-rich",
      maneuvers: [{ id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: 100_000 } }],
    };
    const res = attachBattlePlan(st, b, "defender", rich, { kind: "home" }, b.startedAt, reservesFor(st));
    expect(res.ok).toBe(false);
    expect(reservesFor(st).reserveTroops).toBe(before);
    expect(segmentsFor(b, "defender")).toHaveLength(0);
  });

  test("one plan per battle", () => {
    const st = fakeState();
    const b = liveBattle();
    const r = reservesFor(st);
    expect(attachBattlePlan(st, b, "defender", legalPlan(), { kind: "home" }, b.startedAt, r).ok).toBe(true);
    const second = attachBattlePlan(st, b, "defender", legalPlan(), { kind: "home" }, b.startedAt, reservesFor(st));
    expect(second.ok).toBe(false);
  });
});

describe("maneuver entries, surprise, and response windows", () => {
  test("MAIN enters at T+0; the flank waits for its minute and fights surprised", () => {
    const st = fakeState();
    const b = liveBattle();
    const plan = legalPlan();
    const mainW = maneuverWeight(plan.maneuvers[0]);
    const flankW = maneuverWeight(plan.maneuvers[1]);
    const troopsBefore = b.attacker.troops;
    attachBattlePlan(st, b, "attacker", plan, { kind: "home" }, b.startedAt, reservesFor(st));

    advanceManeuverEntries(b, b.startedAt);
    expect(b.attacker.troops).toBe(troopsBefore + mainW); // MAIN marched in
    const ps = b.internal.planState!;
    expect(ps.entries.find((e) => e.vector === "MAIN")!.entered).toBe(true);
    expect(ps.entries.find((e) => e.vector === "FLANK_LEFT")!.entered).toBe(false);
    expect(b.maneuverIntel!.entered).toHaveLength(1);
    expect(b.maneuverIntel!.unentered).toBe(1);

    advanceManeuverEntries(b, b.startedAt + 10 * 60_000);
    const flank = ps.entries.find((e) => e.vector === "FLANK_LEFT")!;
    expect(flank.entered).toBe(true);
    expect(flank.surpriseUntil).toBe(b.startedAt + 10 * 60_000 + 5 * 60_000); // 5-min window
    expect(flank.screenedAtEntry).toBe(false);
    expect(b.attacker.troops).toBe(troopsBefore + mainW + flankW);
    // The defender gets a response window for the flank — MAIN needs none.
    const responses = b.windows.filter((w) => w.kind === "response" && w.side === "defender");
    expect(responses.length).toBeGreaterThan(0);
    expect(b.maneuverIntel!.entered.map((e) => e.vector).includes("FLANK_LEFT")).toBe(true);
  });

  test("a screened flank fights at half surprise (12.5%), unscreened at 25%", () => {
    expect(surpriseMult("FLANK_LEFT", false)).toBe(1.25);
    expect(surpriseMult("FLANK_LEFT", true)).toBe(1.125);
    expect(surpriseMult("MAIN", false)).toBe(1);

    const st = fakeState();
    const b = liveBattle();
    attachBattlePlan(st, b, "attacker", legalPlan(), { kind: "home" }, b.startedAt, reservesFor(st));
    const screen = screenVector(b, "defender", "FLANK_LEFT", b.startedAt + 1_000, reservesFor(st));
    expect(screen.ok).toBe(true);

    advanceManeuverEntries(b, b.startedAt + 10 * 60_000);
    const flank = b.internal.planState!.entries.find((e) => e.vector === "FLANK_LEFT")!;
    expect(flank.entered).toBe(true);
    expect(flank.screenedAtEntry).toBe(true);
  });

  test("screens are idempotent and the plan's owner cannot screen it", () => {
    const st = fakeState();
    const b = liveBattle();
    attachBattlePlan(st, b, "attacker", legalPlan(), { kind: "home" }, b.startedAt, reservesFor(st));
    const r = reservesFor(st);
    const first = screenVector(b, "defender", "REAR", b.startedAt, r);
    expect(first.ok).toBe(true);
    const second = screenVector(b, "defender", "REAR", b.startedAt + 5_000, r);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.duplicate).toBe(true);
    const own = screenVector(b, "attacker", "REAR", b.startedAt, r);
    expect(own.ok).toBe(false);
  });
});

describe("real-roster decision paths (no ghost numbers)", () => {
  test("reinforcement validates against the real available weight", () => {
    const st = fakeState();
    const b = liveBattle();
    const r = reservesFor(st);
    const window = b.windows.find((w) => w.side === "defender");
    expect(window).toBeDefined();
    const now = window!.opensAt + 1_000; // inside an open window

    const tooMuch = issueDecision(b, "defender", window!.id, "reinforce", now, r, {
      heroes: [], troops: r.reserveTroops + 1_000,
    });
    expect(tooMuch.ok).toBe(false);

    const ok = issueDecision(b, "defender", window!.id, "reinforce", now, r, {
      heroes: [], troops: Math.min(50, r.reserveTroops),
    });
    expect(ok.ok).toBe(true);
  });

  test("withdrawal toll settles out of the roster immediately and is never double-billed", () => {
    const st = fakeState();
    const b = liveBattle();
    (st.battles as Battle[]).push(b);
    const r = rosterForCommit(st, { kind: "home" })!;
    const committed = commitRosterWeight(st, { kind: "home" }, 400);
    expect(committed).toBe(400);
    const before = r.cohorts.reduce((s, c) => s + c.count, 0);
    stampRosterSegment(b, "defender", {
      id: "seg-1", kind: "initial", home: { kind: "home" }, weight: committed, tollsPaid: 0, committedAt: b.startedAt,
    });

    const killed = settleToll(st, b, "defender", 120);
    expect(killed).toBeGreaterThan(0);
    const afterToll = r.cohorts.reduce((s, c) => s + c.count, 0);
    expect(before - afterToll).toBe(killed); // the rearguard died in the real roster
    expect(segmentsFor(b, "defender")[0].tollsPaid).toBe(killed);

    // Final resolve: stamp the toll as the side's casualties — the final bill
    // is the stamped remainder, so the toll is never paid twice.
    b.casualties.defender = killed;
    b.status = "resolved";
    const released = availableWeight(r);
    resolveRosterCasualties(st);
    expect(r.cohorts.reduce((s, c) => s + c.count, 0)).toBe(afterToll); // no new deaths
    expect(availableWeight(r)).toBeGreaterThan(released); // surviving locks released
  });

  test("zero-casualty resolve releases every lock back to the garrison", () => {
    const st = fakeState();
    const b = liveBattle();
    (st.battles as Battle[]).push(b);
    const r = rosterForCommit(st, { kind: "home" })!;
    const before = availableWeight(r);
    const committed = commitRosterWeight(st, { kind: "home" }, 400);
    stampRosterSegment(b, "defender", {
      id: "seg-1", kind: "initial", home: { kind: "home" }, weight: committed, tollsPaid: 0, committedAt: b.startedAt,
    });
    expect(availableWeight(r)).toBe(before - committed);

    b.casualties.defender = 0;
    b.status = "resolved";
    resolveRosterCasualties(st);
    expect(availableWeight(r)).toBe(before); // every survivor walks home
  });
});
