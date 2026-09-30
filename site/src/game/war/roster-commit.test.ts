// Tests for roster commit (war/roster-commit.ts) — binding real mustered
// troops to battle entities. Run: bun test src/game/war/roster-commit.test.ts
import { describe, expect, test } from "bun:test";
import {
  commitRosterWeight,
  resolveRosterCasualties,
  rosterForCommit,
  stampRosterCommit,
} from "./roster-commit";
import { createBattle } from "./battle-engine";
import {
  addCohort,
  availableWeight,
  emptyTroopHome,
  rosterCount,
} from "./troops";
import type { Battle, CommittedForce } from "./war-types";
import type { GameState } from "../types";

function fakeState(): GameState {
  return {
    troops: { home: emptyTroopHome(0), bands: [], history: [] },
    forwardBases: {},
    battles: [],
    seasonId: "s1",
  } as unknown as GameState;
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

function liveBattle(defenderTroops = 300): Battle {
  return createBattle(
    {
      zoneId: "test-zone",
      zoneName: "Test Zone",
      attacker: force("attacker", 600),
      defender: force("defender", defenderTroops),
    },
    1_000_000,
  );
}

describe("commitRosterWeight", () => {
  test("locks min(wanted, available) out of the home roster", () => {
    const st = fakeState();
    addCohort(st.troops!.home.roster, "bulwark", 120, 0);
    const committed = commitRosterWeight(st, { kind: "home" }, 300);
    expect(committed).toBe(120); // only 120 mustered — never ghost numbers
    expect(st.troops!.home.roster.committedWeight).toBe(120);
    expect(availableWeight(st.troops!.home.roster)).toBe(0);
    expect(rosterCount(st.troops!.home.roster)).toBe(120); // commit locks, doesn't remove
  });

  test("returns 0 when the roster doesn't exist (safe degrade)", () => {
    const st = {} as unknown as GameState;
    expect(commitRosterWeight(st, { kind: "home" }, 300)).toBe(0);
    expect(rosterForCommit(st, { kind: "home" })).toBeNull();
  });

  test("commits from a forward base's own garrison", () => {
    const st = fakeState();
    const home = emptyTroopHome(0);
    addCohort(home.roster, "reaver", 80, 0);
    st.forwardBases!["ashtar-prime"] = {
      id: "fb-0",
      serverId: "ashtar-prime",
      label: "Beachhead",
      home,
      supplies: 0,
      wallHp: 1200,
      maxWallHp: 1200,
      plantedAt: 0,
    };
    const committed = commitRosterWeight(st, { kind: "base", serverId: "ashtar-prime" }, 200);
    expect(committed).toBe(80);
    expect(home.roster.committedWeight).toBe(80);
    // the colony garrison is untouched
    expect(st.troops!.home.roster.committedWeight).toBe(0);
  });
});

describe("stampRosterCommit", () => {
  test("stamps server-only metadata the client never sees", () => {
    const b = liveBattle();
    stampRosterCommit(b, "defender", { home: { kind: "home" }, weight: 120 });
    expect(b.internal.rosterCommits!.defender!.weight).toBe(120);
    expect(b.internal.rosterCommits!.attacker).toBeUndefined();
    expect(b.internal.rosterResolved).toBeUndefined();
  });
});

describe("resolveRosterCasualties", () => {
  function resolvedBattle(st: GameState): Battle {
    addCohort(st.troops!.home.roster, "bulwark", 200, 0);
    addCohort(st.troops!.home.roster, "reaver", 100, 1);
    const committed = commitRosterWeight(st, { kind: "home" }, 300);
    const b = liveBattle(300);
    stampRosterCommit(b, "defender", { home: { kind: "home" }, weight: committed });
    b.status = "resolved";
    st.battles!.push(b);
    return b;
  }

  test("applies the stamped casualty fraction to real cohorts, newest-first", () => {
    const st = fakeState();
    const b = resolvedBattle(st);
    const fraction = b.casualties.defender / 300;
    expect(fraction).toBeGreaterThan(0);
    const before = rosterCount(st.troops!.home.roster);
    const applied = resolveRosterCasualties(st);
    expect(applied).toBe(1);
    const after = rosterCount(st.troops!.home.roster);
    // 300 weight committed; fraction of it dies. Reavers (newest) die first.
    const dead = before - after;
    expect(dead).toBe(Math.round(300 * fraction));
    expect(st.troops!.home.roster.committedWeight).toBe(0); // commitment clears
  });

  test("is idempotent — the second pass never double-kills", () => {
    const st = fakeState();
    const b = resolvedBattle(st);
    expect(resolveRosterCasualties(st)).toBe(1);
    const afterFirst = rosterCount(st.troops!.home.roster);
    expect(resolveRosterCasualties(st)).toBe(0);
    expect(rosterCount(st.troops!.home.roster)).toBe(afterFirst);
    expect(b.internal.rosterResolved).toBe(true);
  });

  test("writes the losses to the memorial feed", () => {
    const st = fakeState();
    const b = resolvedBattle(st);
    resolveRosterCasualties(st);
    expect(st.troops!.history.length).toBe(1);
    const rec = st.troops!.history[0];
    expect(rec.battleId).toBe(b.id);
    expect(rec.site).toBe("Test Zone");
    expect(rec.season).toBe("s1");
    const total = rec.lossesByType.bulwark + rec.lossesByType.reaver;
    const expected = Math.round(300 * (b.casualties.defender / 300));
    expect(total).toBe(expected);
    // newest-first: reavers (mustered later) bled before bulwarks
    expect(rec.lossesByType.reaver).toBe(Math.min(100, expected));
    expect(rec.lossesByType.bulwark).toBe(expected - Math.min(100, expected));
  });

  test("skips active battles", () => {
    const st = fakeState();
    addCohort(st.troops!.home.roster, "bulwark", 200, 0);
    const committed = commitRosterWeight(st, { kind: "home" }, 300);
    const b = liveBattle(300);
    stampRosterCommit(b, "defender", { home: { kind: "home" }, weight: committed });
    st.battles!.push(b); // still active
    expect(resolveRosterCasualties(st)).toBe(0);
    expect(rosterCount(st.troops!.home.roster)).toBe(200);
  });

  test("a razed beachhead mid-battle degrades gracefully (nothing to bill)", () => {
    const st = fakeState();
    const b = liveBattle(300);
    // stamped against a base that no longer exists
    stampRosterCommit(b, "attacker", {
      home: { kind: "base", serverId: "gone-server" },
      weight: 50,
    });
    b.status = "resolved";
    st.battles!.push(b);
    expect(resolveRosterCasualties(st)).toBe(1); // stamped, not double-applied
    expect(b.internal.rosterResolved).toBe(true);
  });

  test("battles without stamps are untouched (the Chorus stays ghost numbers)", () => {
    const st = fakeState();
    addCohort(st.troops!.home.roster, "bulwark", 200, 0);
    const b = liveBattle(300);
    b.status = "resolved";
    st.battles!.push(b);
    expect(resolveRosterCasualties(st)).toBe(0);
    expect(rosterCount(st.troops!.home.roster)).toBe(200);
    expect(st.troops!.history.length).toBe(0);
  });
});
