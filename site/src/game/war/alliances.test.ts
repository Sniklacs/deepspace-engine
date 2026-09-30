// Tests for alliances (site/src/game/war/alliances.ts) — the war band:
// create/join/leave/kick/roles, help ticks, standing reinforcements.
// Run: bun test src/game/war/alliances.test.ts
import { describe, expect, test } from "bun:test";
import {
  acceptMembership,
  allianceOf,
  applyToAlliance,
  applyHelpTick,
  autoRecallReinforcements,
  createAlliance,
  demoteMember,
  disbandAlliance,
  dismissReinforcement,
  ensureAlliances,
  giveHelp,
  helpTickMinutes,
  inviteToAlliance,
  kickMember,
  leaveAlliance,
  promoteMember,
  recallReinforcement,
  reinforcementsAt,
  reinforcementUpkeepPerHour,
  sendReinforcement,
  transferLeadership,
} from "./alliances";
import { addCohort, availableWeight, emptyTroopHome } from "./troops";
import type { GameState } from "../types";

const NOW = 1_800_000_000_000;

function fakeState(supplies = 1000): GameState {
  return {
    resources: { supplies },
    troops: { home: emptyTroopHome(0), bands: [], history: [] },
    battles: [],
    seasonId: "s1",
  } as unknown as GameState;
}

/** Founder + one member, standard setup. Returns { st, allianceId }. */
function withAlliance(tier = 3) {
  const st = fakeState();
  const r = createAlliance(st, { id: "col-a", name: "Alpha" }, tier, { name: "War Band" }, NOW);
  expect(r.ok).toBe(true);
  const aid = allianceOf(st, "col-a")!.id;
  return { st, aid };
}

describe("ensureAlliances", () => {
  test("initializes migration-safe empty stores", () => {
    const st = {} as GameState;
    ensureAlliances(st);
    expect(st.alliances).toEqual({});
    expect(st.reinforcements).toEqual([]);
    expect(st.helpLedger).toEqual([]);
  });
});

describe("createAlliance", () => {
  test("founder becomes leader, pays 500 supplies", () => {
    const st = fakeState(1000);
    const r = createAlliance(st, { id: "col-a", name: "Alpha" }, 2, { name: "War Band" }, NOW);
    expect(r.ok).toBe(true);
    expect(st.resources.supplies).toBe(500);
    const a = allianceOf(st, "col-a")!;
    expect(a.members[0].role).toBe("leader");
    expect(a.name).toBe("War Band");
  });

  test("requires Cradle tier 2+", () => {
    const st = fakeState(10000);
    const r = createAlliance(st, { id: "col-a", name: "Alpha" }, 1, { name: "Nope" }, NOW);
    expect(r.ok).toBe(false);
  });

  test("requires 500 supplies", () => {
    const st = fakeState(100);
    const r = createAlliance(st, { id: "col-a", name: "Alpha" }, 3, { name: "Nope" }, NOW);
    expect(r.ok).toBe(false);
    expect(st.resources.supplies).toBe(100); // untouched on refusal
  });

  test("one alliance per colony", () => {
    const { st } = withAlliance();
    const r = createAlliance(st, { id: "col-a", name: "Alpha" }, 3, { name: "Second" }, NOW);
    expect(r.ok).toBe(false);
  });
});

describe("join flows", () => {
  test("apply → leader accepts → member", () => {
    const { st, aid } = withAlliance();
    expect(applyToAlliance(st, aid, { id: "col-b", name: "Beta" }, NOW).ok).toBe(true);
    expect(acceptMembership(st, aid, "col-a", "col-b", NOW).ok).toBe(true);
    expect(allianceOf(st, "col-b")!.id).toBe(aid);
  });

  test("invite → invitee accepts", () => {
    const { st, aid } = withAlliance();
    expect(inviteToAlliance(st, aid, "col-a", { id: "col-c", name: "Gamma" }, NOW).ok).toBe(true);
    expect(acceptMembership(st, aid, "col-c", "col-c", NOW).ok).toBe(true);
    expect(allianceOf(st, "col-c")!.id).toBe(aid);
  });

  test("a non-member cannot accept someone else's application", () => {
    const { st, aid } = withAlliance();
    applyToAlliance(st, aid, { id: "col-b", name: "Beta" }, NOW);
    const r = acceptMembership(st, aid, "col-b", "col-b", NOW);
    expect(r.ok).toBe(false);
  });

  test("member cap is 50", () => {
    const { st, aid } = withAlliance();
    const a = allianceOf(st, "col-a")!;
    for (let i = 0; i < 49; i++) {
      a.members.push({ colonyId: `x-${i}`, colonyName: `X${i}`, role: "member", joinedAt: NOW });
    }
    const r = applyToAlliance(st, aid, { id: "col-z", name: "Zed" }, NOW);
    expect(r.ok).toBe(false);
  });
});

describe("roles", () => {
  test("promote/demote officer, leader only, 5-officer cap", () => {
    const { st, aid } = withAlliance();
    applyToAlliance(st, aid, { id: "col-b", name: "Beta" }, NOW);
    acceptMembership(st, aid, "col-a", "col-b", NOW);
    // a plain member can't promote
    expect(promoteMember(st, aid, "col-b", "col-b").ok).toBe(false);
    expect(promoteMember(st, aid, "col-a", "col-b").ok).toBe(true);
    expect(allianceOf(st, "col-b")!.members.find((m) => m.colonyId === "col-b")!.role).toBe("officer");
    expect(demoteMember(st, aid, "col-a", "col-b").ok).toBe(true);
    // officer cap
    const a = allianceOf(st, "col-a")!;
    for (let i = 0; i < 5; i++) {
      a.members.push({ colonyId: `o-${i}`, colonyName: `O${i}`, role: "officer", joinedAt: NOW });
    }
    applyToAlliance(st, aid, { id: "col-d", name: "Delta" }, NOW);
    acceptMembership(st, aid, "col-a", "col-d", NOW);
    expect(promoteMember(st, aid, "col-a", "col-d").ok).toBe(false);
  });

  test("transfer leadership: old leader becomes officer", () => {
    const { st, aid } = withAlliance();
    applyToAlliance(st, aid, { id: "col-b", name: "Beta" }, NOW);
    acceptMembership(st, aid, "col-a", "col-b", NOW);
    expect(transferLeadership(st, aid, "col-a", "col-b").ok).toBe(true);
    const a = allianceOf(st, "col-a")!;
    expect(a.members.find((m) => m.colonyId === "col-b")!.role).toBe("leader");
    expect(a.members.find((m) => m.colonyId === "col-a")!.role).toBe("officer");
  });

  test("kick: leader can, officer can kick members only", () => {
    const { st, aid } = withAlliance();
    for (const [id, nm] of [["col-b", "Beta"], ["col-c", "Gamma"]] as const) {
      applyToAlliance(st, aid, { id, name: nm }, NOW);
      acceptMembership(st, aid, "col-a", id, NOW);
    }
    promoteMember(st, aid, "col-a", "col-b");
    // officer kicks a member
    expect(kickMember(st, aid, "col-b", "col-c", NOW).ok).toBe(true);
    expect(allianceOf(st, "col-c")).toBeNull();
    // officer can't kick the leader
    expect(kickMember(st, aid, "col-b", "col-a", NOW).ok).toBe(false);
  });

  test("disband: leader only", () => {
    const { st, aid } = withAlliance();
    applyToAlliance(st, aid, { id: "col-b", name: "Beta" }, NOW);
    acceptMembership(st, aid, "col-a", "col-b", NOW);
    expect(disbandAlliance(st, aid, "col-b").ok).toBe(false);
    expect(disbandAlliance(st, aid, "col-a").ok).toBe(true);
    expect(allianceOf(st, "col-a")).toBeNull();
    expect(allianceOf(st, "col-b")).toBeNull();
  });

  test("leave: leadership passes to oldest officer, last member dissolves", () => {
    const { st, aid } = withAlliance();
    applyToAlliance(st, aid, { id: "col-b", name: "Beta" }, NOW);
    acceptMembership(st, aid, "col-a", "col-b", NOW);
    promoteMember(st, aid, "col-a", "col-b");
    expect(leaveAlliance(st, "col-a", NOW).ok).toBe(true);
    const a = allianceOf(st, "col-b")!;
    expect(a.members.find((m) => m.colonyId === "col-b")!.role).toBe("leader");
    expect(leaveAlliance(st, "col-b", NOW).ok).toBe(true);
    expect(allianceOf(st, "col-b")).toBeNull();
  });
});

describe("help ticks", () => {
  test("tick size scales with helper's Cradle tier", () => {
    expect(helpTickMinutes(1)).toBe(5);
    expect(helpTickMinutes(3)).toBe(25);
    expect(helpTickMinutes(5)).toBe(60);
    expect(helpTickMinutes(9)).toBe(60); // clamps at 5
  });

  test("5 per day, resets on a new day, alliance-only, not self", () => {
    const { st, aid } = withAlliance();
    applyToAlliance(st, aid, { id: "col-b", name: "Beta" }, NOW);
    acceptMembership(st, aid, "col-a", "col-b", NOW);
    const helper = { id: "col-a", name: "Alpha", tier: 3 };
    for (let i = 0; i < 5; i++) {
      const r = giveHelp(st, helper, { id: "col-b", name: "Beta" }, NOW + i);
      expect(r.ok).toBe(true);
      expect(r.ok && r.value.minutes).toBe(25);
    }
    expect(giveHelp(st, helper, { id: "col-b", name: "Beta" }, NOW + 9).ok).toBe(false);
    // self-help refused
    expect(giveHelp(st, helper, { id: "col-a", name: "Alpha" }, NOW).ok).toBe(false);
    // next day: fresh budget
    const tomorrow = NOW + 86_400_000;
    expect(giveHelp(st, helper, { id: "col-b", name: "Beta" }, tomorrow).ok).toBe(true);
  });

  test("help shaves research and build timers, never troops", () => {
    const st = fakeState();
    (st as unknown as { researchJobs: unknown[] }).researchJobs = [
      { id: "rj1", techId: "t1", leaderId: "l1", startedAt: NOW, durationMs: 3_600_000, status: "researching" },
    ];
    (st as unknown as { programDeploy: unknown }).programDeploy = {
      domain: "cradle", startedAt: NOW, durationMs: 3_600_000,
    };
    addCohort(st.troops!.home.roster, "bulwark", 100, NOW);
    const before = availableWeight(st.troops!.home.roster);
    const r = applyHelpTick(st, 25);
    expect(r.ok).toBe(true);
    expect(r.ok && r.shavedMs).toBe(3_000_000); // both timers shaved
    expect(availableWeight(st.troops!.home.roster)).toBe(before); // troops untouched
  });

  test("help with nothing underway is refused", () => {
    const st = fakeState();
    expect(applyHelpTick(st, 25).ok).toBe(false);
  });
});

describe("reinforcements", () => {
  test("send locks real troops; recall returns them; dismiss sends them home", () => {
    const { st, aid } = withAlliance();
    applyToAlliance(st, aid, { id: "col-b", name: "Beta" }, NOW);
    acceptMembership(st, aid, "col-a", "col-b", NOW);
    addCohort(st.troops!.home.roster, "bulwark", 200, NOW);
    const r = sendReinforcement(st, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" }, 150, [], NOW);
    expect(r.ok).toBe(true);
    expect(availableWeight(st.troops!.home.roster)).toBe(50);
    const rf = r.ok && r.value;
    expect(rf && reinforcementsAt(st, "col-b")).toHaveLength(1);
    // recall by sender
    expect(recallReinforcement(st, "col-a", (rf as { id: string }).id).ok).toBe(true);
    expect(availableWeight(st.troops!.home.roster)).toBe(200);
    expect(reinforcementsAt(st, "col-b")).toHaveLength(0);
  });

  test("host dismisses a reinforcement (marches home)", () => {
    const { st, aid } = withAlliance();
    applyToAlliance(st, aid, { id: "col-b", name: "Beta" }, NOW);
    acceptMembership(st, aid, "col-a", "col-b", NOW);
    addCohort(st.troops!.home.roster, "bulwark", 200, NOW);
    const r = sendReinforcement(st, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" }, 100, [], NOW);
    const rf = r.ok && r.value as { id: string };
    expect(dismissReinforcement(st, "col-b", (rf as { id: string }).id).ok).toBe(true);
    expect(availableWeight(st.troops!.home.roster)).toBe(200);
  });

  test("stationed guests stay locked until recalled; host pays upkeep", () => {
    const { st, aid } = withAlliance();
    applyToAlliance(st, aid, { id: "col-b", name: "Beta" }, NOW);
    acceptMembership(st, aid, "col-a", "col-b", NOW);
    addCohort(st.troops!.home.roster, "bulwark", 200, NOW);
    const r = sendReinforcement(st, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" }, 100, [], NOW);
    const rf = (r.ok && r.value) as { id: string; troops: number };
    // the lock holds while stationed — the sender can't spend those bodies twice
    expect(availableWeight(st.troops!.home.roster)).toBe(100);
    expect(reinforcementUpkeepPerHour(rf as unknown as Parameters<typeof reinforcementUpkeepPerHour>[0])).toBe(10);
    // cross-account casualty routing (guests dying in the host's battles) rides
    // the server seam — locally the lock simply holds until recall/dismiss.
    expect(recallReinforcement(st, "col-a", rf.id).ok).toBe(true);
    expect(availableWeight(st.troops!.home.roster)).toBe(200);
  });

  test("leaving auto-recalls your reinforcements", () => {
    const { st, aid } = withAlliance();
    applyToAlliance(st, aid, { id: "col-b", name: "Beta" }, NOW);
    acceptMembership(st, aid, "col-a", "col-b", NOW);
    addCohort(st.troops!.home.roster, "bulwark", 200, NOW);
    sendReinforcement(st, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" }, 100, [], NOW);
    leaveAlliance(st, "col-a", NOW);
    // the record stays as history, but the bodies are home and the lock is gone
    expect(st.reinforcements!.find((x) => x.fromColonyId === "col-a")!.state).toBe("recalled");
    expect(availableWeight(st.troops!.home.roster)).toBe(200);
    expect(autoRecallReinforcements(st, "col-b")).toBe(0);
  });

  test("cross-alliance reinforcement refused", () => {
    const { st } = withAlliance();
    const r = sendReinforcement(st, { id: "col-a", name: "Alpha" }, { id: "col-x", name: "Stranger" }, 10, [], NOW);
    expect(r.ok).toBe(false);
  });
});
