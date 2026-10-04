// Tests for the alliance reverb feed (site/src/game/war/alliances.ts) —
// the activity log behind the dedicated Alliance page's Reverb section
// (owner 2026-10-04). Run: bun test src/game/war/alliances-activity.test.ts
import { describe, expect, test } from "bun:test";
import {
  acceptMembership,
  allianceActivity,
  allianceOf,
  ALLIANCE_ACTIVITY_CAP,
  applyToAlliance,
  createAlliance,
  demoteMember,
  inviteToAlliance,
  kickMember,
  leaveAlliance,
  promoteMember,
  setJoinPolicy,
  setTitheRate,
  transferLeadership,
  type Alliance,
} from "./alliances";
import type { GameState } from "../types";

const NOW = 1_800_000_000_000;

function fakeState(): GameState {
  return { resources: { supplies: 5000 }, seasonId: "s1" } as unknown as GameState;
}

function withAlliance(): { st: GameState; aid: string; a: Alliance } {
  const st = fakeState();
  const r = createAlliance(st, { id: "col-a", name: "Alpha" }, 3, { name: "War Band" }, NOW);
  expect(r.ok).toBe(true);
  const a = allianceOf(st, "col-a")!;
  return { st, aid: a.id, a };
}

function joinAs(st: GameState, aid: string, id: string, name: string) {
  const r = applyToAlliance(st, aid, { id, name }, NOW);
  expect(r.ok).toBe(true);
  const acc = acceptMembership(st, aid, "col-a", id, NOW);
  expect(acc.ok).toBe(true);
}

describe("alliance activity (reverb feed)", () => {
  test("founding writes a 'founded' entry", () => {
    const { a } = withAlliance();
    const entries = allianceActivity(a);
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe("founded");
    expect(entries[0].text).toContain("War Band");
  });

  test("join policy + tithe changes log, newest first", () => {
    const { st, aid, a } = withAlliance();
    expect(setJoinPolicy(st, aid, "col-a", "open").ok).toBe(true);
    expect(setTitheRate(st, aid, "col-a", 10).ok).toBe(true);
    const entries = allianceActivity(a);
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain("policy");
    expect(kinds).toContain("tithe");
    expect(entries[0].kind).toBe("tithe"); // newest first
    expect(entries[0].text).toContain("10%");
    expect(entries[1].text).toContain("open");
  });

  test("open-policy free join logs 'joined'", () => {
    const { st, aid, a } = withAlliance();
    setJoinPolicy(st, aid, "col-a", "open");
    const r = applyToAlliance(st, aid, { id: "col-b", name: "Beta" }, NOW);
    expect(r.ok).toBe(true);
    expect(allianceActivity(a)[0].kind).toBe("joined");
    expect(allianceActivity(a)[0].byColonyName).toBe("Beta");
  });

  test("invite → accept logs 'invited' + 'joined'", () => {
    const { st, aid, a } = withAlliance();
    expect(inviteToAlliance(st, aid, "col-a", { id: "col-b", name: "Beta" }, NOW).ok).toBe(true);
    const acc = acceptMembership(st, aid, "col-b", "col-b", NOW); // invited colony accepts its own invite
    expect(acc.ok).toBe(true);
    const kinds = allianceActivity(a).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["invited", "joined"]));
    expect(allianceActivity(a)[0].kind).toBe("joined"); // newest first
  });

  test("leave logs 'left' with the departing member's name", () => {
    const { st, aid, a } = withAlliance();
    joinAs(st, aid, "col-b", "Beta");
    expect(leaveAlliance(st, "col-b", NOW).ok).toBe(true);
    expect(allianceActivity(a)[0].kind).toBe("left");
    expect(allianceActivity(a)[0].text).toContain("Beta");
  });

  test("kick logs 'kicked'", () => {
    const { st, aid, a } = withAlliance();
    joinAs(st, aid, "col-c", "Gamma");
    expect(kickMember(st, aid, "col-a", "col-c", NOW).ok).toBe(true);
    expect(allianceActivity(a)[0].kind).toBe("kicked");
    expect(allianceActivity(a)[0].text).toContain("Gamma");
  });

  test("promote/demote/transfer-leadership log", () => {
    const { st, aid, a } = withAlliance();
    joinAs(st, aid, "col-b", "Beta");
    expect(promoteMember(st, aid, "col-a", "col-b").ok).toBe(true);
    expect(demoteMember(st, aid, "col-a", "col-b").ok).toBe(true);
    expect(transferLeadership(st, aid, "col-a", "col-b").ok).toBe(true);
    const kinds = allianceActivity(a).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["promoted", "demoted", "leadership"]));
  });

  test("feed is capped at 200 entries", () => {
    const { st, aid, a } = withAlliance();
    for (let i = 0; i < ALLIANCE_ACTIVITY_CAP + 50; i++) {
      setTitheRate(st, aid, "col-a", i % 100);
    }
    const entries = allianceActivity(a);
    expect(entries.length).toBe(ALLIANCE_ACTIVITY_CAP);
  });

  test("backfill: alliances created before the feed get an empty array", () => {
    const { a } = withAlliance();
    delete (a as { activity?: unknown }).activity;
    // Accessing activity must not throw and must backfill
    expect(allianceActivity(a)).toEqual([]);
    expect(Array.isArray(a.activity)).toBe(true);
  });
});
