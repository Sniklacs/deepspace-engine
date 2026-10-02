// Tests for alliances (site/src/game/war/alliances.ts) — the war band:
// create/join/leave/kick/roles, help ticks, standing reinforcements.
// Run: bun test src/game/war/alliances.test.ts
import { describe, expect, test } from "bun:test";
import {
  acceptMembership,
  allianceOf,
  applyCreateGuestMirror,
  applyReleaseTroopLock,
  applyRemoveGuestMirror,
  applyToAlliance,
  applyHelpTick,
  autoRecallReinforcements,
  createAlliance,
  demoteMember,
  disbandAlliance,
  dismissReinforcement,
  drainAllianceFx,
  ensureAlliances,
  giveHelp,
  guestsAt,
  helpTickMinutes,
  inviteToAlliance,
  kickMember,
  leaveAlliance,
  promoteMember,
  recallReinforcement,
  reinforcementsFrom,
  reinforcementUpkeepPerHour,
  sendReinforcement,
  shrinkGuestMirrors,
  transferLeadership,
  type AllianceFx,
} from "./alliances";
import { addCohort, advanceTroopHome, availableWeight, bandWeight, emptyTroopHome, rosterWeight } from "./troops";
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

/** Mini seam: drain one save's fx queue and apply each effect to the other
 *  save with the real appliers (idempotent — safe to call repeatedly). */
function deliverFx(from: GameState, to: GameState): AllianceFx[] {
  const fxs = drainAllianceFx(from);
  for (const fx of fxs) {
    switch (fx.kind) {
      case "create-guest-mirror": applyCreateGuestMirror(to, fx.mirror); break;
      case "remove-guest-mirror": applyRemoveGuestMirror(to, fx.mirrorId, fx.key); break;
      case "release-troop-lock": applyReleaseTroopLock(to, fx); break;
      default: break; // help ticks / casualty bills have their own suites
    }
  }
  return fxs;
}

/** Two allied saves: Alpha (sender) and Beta (host), same alliance record.
 *  Mirrors how each account's own membership writes maintain the roster. */
function twoAlliedSaves() {
  const sender = fakeState();
  const host = fakeState(1000);
  const r = createAlliance(sender, { id: "col-a", name: "Alpha" }, 3, { name: "War Band" }, NOW);
  expect(r.ok).toBe(true);
  const alliance = r.ok && r.value;
  const aid = (alliance as { id: string }).id;
  const beta = { colonyId: "col-b", colonyName: "Beta", role: "member" as const, joinedAt: NOW };
  sender.alliances![aid].members.push(beta);
  host.alliances = { [aid]: JSON.parse(JSON.stringify(sender.alliances![aid])) };
  return { sender, host, aid };
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

  test("member cap is 100", () => {
    const { st, aid } = withAlliance();
    const a = allianceOf(st, "col-a")!;
    for (let i = 0; i < 99; i++) {
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
  test("send locks real troops; the host gets a mirror; recall returns them", () => {
    const { sender, host } = twoAlliedSaves();
    addCohort(sender.troops!.home.roster, "bulwark", 200, NOW);
    const r = sendReinforcement(sender, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" }, 150, [], NOW);
    expect(r.ok).toBe(true);
    expect(availableWeight(sender.troops!.home.roster)).toBe(50);
    // The sender's save holds the authoritative record; the host learns via
    // the seam.
    const rf = r.ok && r.value;
    expect(rf && reinforcementsFrom(sender, "col-a")).toHaveLength(1);
    expect(guestsAt(host)).toHaveLength(0);
    deliverFx(sender, host);
    expect(guestsAt(host)).toHaveLength(1);
    expect(guestsAt(host)[0].fromColonyId).toBe("col-a");
    expect(guestsAt(host)[0].weight).toBe(150);
    // Recall by sender: the lock releases locally, the mirror goes via fx.
    expect(recallReinforcement(sender, "col-a", (rf as { id: string }).id).ok).toBe(true);
    expect(availableWeight(sender.troops!.home.roster)).toBe(200);
    expect(guestsAt(host)).toHaveLength(1); // not yet delivered
    deliverFx(sender, host);
    expect(guestsAt(host)).toHaveLength(0);
  });

  test("host dismisses a mirror; the sender's lock releases through the seam", () => {
    const { sender, host } = twoAlliedSaves();
    addCohort(sender.troops!.home.roster, "bulwark", 200, NOW);
    const r = sendReinforcement(sender, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" }, 100, [], NOW);
    expect(r.ok).toBe(true);
    deliverFx(sender, host);
    const mirrorId = guestsAt(host)[0].id;
    expect(dismissReinforcement(host, mirrorId).ok).toBe(true);
    expect(guestsAt(host)).toHaveLength(0);
    // The sender still holds the lock until the fx lands.
    expect(availableWeight(sender.troops!.home.roster)).toBe(100);
    deliverFx(host, sender);
    expect(availableWeight(sender.troops!.home.roster)).toBe(200);
    expect(sender.reinforcements!.find((x) => x.id === mirrorId)!.state).toBe("dismissed");
    // Idempotent: re-delivery changes nothing.
    const before = availableWeight(sender.troops!.home.roster);
    applyReleaseTroopLock(sender, { reinforcementId: mirrorId, weight: 100, key: `unmirror:${mirrorId}:dismissed`, mark: "dismissed" });
    expect(availableWeight(sender.troops!.home.roster)).toBe(before);
  });

  test("stationed guests stay locked until recalled; host pays upkeep", () => {
    const { sender } = twoAlliedSaves();
    addCohort(sender.troops!.home.roster, "bulwark", 200, NOW);
    const r = sendReinforcement(sender, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" }, 100, [], NOW);
    const rf = (r.ok && r.value) as { id: string; troops: number };
    // the lock holds while stationed — the sender can't spend those bodies twice
    expect(availableWeight(sender.troops!.home.roster)).toBe(100);
    expect(reinforcementUpkeepPerHour(rf as unknown as Parameters<typeof reinforcementUpkeepPerHour>[0])).toBe(10);
    // cross-account casualty routing (guests dying in the host's battles) rides
    // the server seam — locally the lock simply holds until recall/dismiss.
    expect(recallReinforcement(sender, "col-a", rf.id).ok).toBe(true);
    expect(availableWeight(sender.troops!.home.roster)).toBe(200);
  });

  test("leaving auto-recalls your reinforcements and queues mirror cleanup", () => {
    const { sender, host } = twoAlliedSaves();
    addCohort(sender.troops!.home.roster, "bulwark", 200, NOW);
    const r = sendReinforcement(sender, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" }, 100, [], NOW);
    expect(r.ok).toBe(true);
    deliverFx(sender, host);
    expect(guestsAt(host)).toHaveLength(1);
    leaveAlliance(sender, "col-a", NOW);
    // the record stays as history, but the bodies are home and the lock is gone
    expect(sender.reinforcements!.find((x) => x.fromColonyId === "col-a")!.state).toBe("recalled");
    expect(availableWeight(sender.troops!.home.roster)).toBe(200);
    expect(autoRecallReinforcements(sender, "col-b")).toBe(0);
    // the host's mirror is cleaned through the seam
    deliverFx(sender, host);
    expect(guestsAt(host)).toHaveLength(0);
  });

  test("cross-alliance reinforcement refused", () => {
    const { st } = withAlliance();
    const r = sendReinforcement(st, { id: "col-a", name: "Alpha" }, { id: "col-x", name: "Stranger" }, 10, [], NOW);
    expect(r.ok).toBe(false);
  });
});

describe("guest upkeep & desertion", () => {
  const HOUR = 3600_000;
  const ZERO_MIX = { bulwark: 0, reaver: 0, longeye: 0, thunder: 0, warden: 0 };

  /** Drive one starvation tick on the host exactly the way engine.advance does:
   *  24h grace + 14h starving on an empty stockpile. */
  function starveHost(host: ReturnType<typeof fakeState>) {
    const home = host.troops!.home;
    home.lastUpkeepAt = NOW - 38 * HOUR;
    host.resources.supplies = 0;
    const deserted: { id: string; weight: number }[] = [];
    const tick = advanceTroopHome(home, NOW, host.resources, {
      sourceColony: "Beta",
      serverId: "0",
      guests: guestsAt(host).map((m) => ({ id: m.id, weight: m.weight, troopsByType: m.troopsByType })),
      onGuestDesertion: (d) => {
        shrinkGuestMirrors(host, d);
        for (const x of d) deserted.push(x);
      },
    });
    return { tick, deserted };
  }

  test("guests desert before host troops, oldest mirror first", () => {
    const { host } = twoAlliedSaves();
    addCohort(host.troops!.home.roster, "bulwark", 100, NOW - 1000);
    applyCreateGuestMirror(host, {
      id: "m-old", fromColonyId: "col-a", fromColonyName: "Alpha", weight: 10,
      troopsByType: { ...ZERO_MIX, bulwark: 10 }, heroes: [], sentAt: NOW - 2000,
    });
    applyCreateGuestMirror(host, {
      id: "m-new", fromColonyId: "col-c", fromColonyName: "Gamma", weight: 10,
      troopsByType: { ...ZERO_MIX, bulwark: 10 }, heroes: [], sentAt: NOW - 1000,
    });
    // 120 weight × (1 − 0.95^14) ≈ 61 deserters: both guests fully (10+10),
    // then 41 from the host's own garrison.
    const { tick, deserted } = starveHost(host);
    expect(deserted.map((d) => d.id)).toEqual(["m-old", "m-new"]);
    expect(deserted.map((d) => d.weight)).toEqual([10, 10]);
    expect(guestsAt(host)).toHaveLength(0);
    expect(rosterWeight(host.troops!.home.roster)).toBe(59);
    // Two guest bands + one host band, none empty.
    expect(tick.bands).toHaveLength(3);
    for (const b of tick.bands) expect(bandWeight(b)).toBeGreaterThan(0);
  });

  test("a fractional thunder desertion takes the whole thunder — the band is never empty", () => {
    const { host } = twoAlliedSaves();
    applyCreateGuestMirror(host, {
      id: "m-th", fromColonyId: "col-a", fromColonyName: "Alpha", weight: 2,
      troopsByType: { ...ZERO_MIX, thunder: 1 }, heroes: [], sentAt: NOW,
    });
    // 2 weight × (1 − 0.95^14) ≈ 1 deserter: the lone thunder walks whole.
    const { tick } = starveHost(host);
    expect(guestsAt(host)).toHaveLength(0);
    expect(tick.bands).toHaveLength(1);
    expect(bandWeight(tick.bands[0])).toBe(2);
  });

  test("sending troops rounds the lock up to whole troops (one thunder = two weight)", () => {
    const { sender, host } = twoAlliedSaves();
    addCohort(sender.troops!.home.roster, "thunder", 1, NOW);
    const r = sendReinforcement(sender, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" }, 1, [], NOW);
    expect(r.ok).toBe(true);
    const rf = r.ok && r.value;
    // Asked for 1 weight; a whole thunder marched, so the lock covers 2.
    expect(rf && rf.troops).toBe(2);
    expect(availableWeight(sender.troops!.home.roster)).toBe(0);
    deliverFx(sender, host);
    expect(guestsAt(host)[0].weight).toBe(2);
    expect(guestsAt(host)[0].troopsByType.thunder).toBe(1);
  });

  test("desertion releases the sender's lock by actual troop weight", () => {
    const { sender, host } = twoAlliedSaves();
    addCohort(sender.troops!.home.roster, "thunder", 1, NOW);
    const r = sendReinforcement(sender, { id: "col-a", name: "Alpha" }, { id: "col-b", name: "Beta" }, 1, [], NOW);
    expect(r.ok).toBe(true);
    deliverFx(sender, host);
    // The host starves the guest completely: the whole thunder walks.
    const m = guestsAt(host)[0];
    const out = shrinkGuestMirrors(host, [{ id: m.id, weight: 2, troopsByType: { ...ZERO_MIX, thunder: 1 } }]);
    expect(out[0].desertedWeight).toBe(2);
    expect(out[0].gone).toBe(true);
    // The release fx frees the full 2-weight lock on the sender and marks
    // the reinforcement deserted.
    applyReleaseTroopLock(sender, {
      reinforcementId: m.id,
      weight: out[0].desertedWeight,
      key: `unmirror:${m.id}:deserted`,
      mark: "deserted",
    });
    expect(availableWeight(sender.troops!.home.roster)).toBe(2);
    expect(sender.reinforcements!.find((x) => x.id === m.id)!.state).toBe("deserted");
  });
});
