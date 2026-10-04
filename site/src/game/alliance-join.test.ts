import { describe, expect, test } from "bun:test";
import { createAlliance, applyToAlliance, allianceOf, setJoinPolicy } from "./war/alliances";
import type { GameState } from "./types";

/**
 * ALLIANCE JOIN REGRESSION (owner 2026-10-04 bug report):
 * A fresh account with NO alliance (seed omits the alliances field; Cradle
 * shows "No alliance yet") clicked Join on an open-policy war band and got
 * "One flag at a time — leave your current alliance first."
 *
 * Root cause: allianceApplyFn runs the tx on the FOUNDER's save
 * (canonicalAllianceTx), and applyToAlliance checked allianceOf() against
 * the founder's canonical roster — which still listed the applicant from a
 * previous seed. The check must run against the APPLICANT's own state.
 * Fix: (1) api.ts checks the applicant's state before the canonical tx;
 * (2) applyToAlliance is idempotent when the roster already lists them
 * (stale entry after a reseed) — no block, no duplicate member.
 */
const NOW = 1_800_000_000_000;

function fakeState(gameId: string): GameState {
  return {
    gameId,
    seasonId: "s1",
    resources: { supplies: 100000 },
    leaders: [],
    techsResearched: [],
    lastTick: 0,
    log: [],
  } as unknown as GameState;
}

/** Founder creates an open-policy alliance; returns its id. */
function foundOpenAlliance(founder: GameState): string {
  const created = createAlliance(founder, { id: "col-founder", name: "Founder" }, 3, { name: "Ashen Vanguard" }, NOW);
  if (!created.ok) throw new Error("setup: createAlliance failed");
  const aid = created.value.id;
  const pol = setJoinPolicy(founder, aid, "col-founder", "open");
  if (!pol.ok) throw new Error("setup: setJoinPolicy failed");
  return aid;
}

describe("alliance join (2026-10-04 stale-roster bug)", () => {
  test("fresh applicant with no alliance passes the applicant-state check", () => {
    const applicant = fakeState("col-new");
    // Applicant's own state: no alliance anywhere.
    expect(allianceOf(applicant, "col-new")).toBeNull();
  });

  test("stale roster entry does not block join and adds no duplicate", () => {
    const founder = fakeState("col-founder");
    const aid = foundOpenAlliance(founder);
    // Simulate the stale canonical roster: the applicant is listed from a
    // previous seed, but their own save has no alliance.
    const a = (founder as any).alliances[aid];
    a.members.push({ colonyId: "col-new", colonyName: "Newbie", role: "member", joinedAt: NOW - 1000 });
    const before = a.members.length;

    // This is what runs inside the canonical tx on the founder's save.
    const res = applyToAlliance(founder, aid, { id: "col-new", name: "Newbie" }, NOW);
    expect(res.ok).toBe(true);
    expect(a.members.length).toBe(before); // no duplicate push
    expect(a.members.filter((m: any) => m.colonyId === "col-new").length).toBe(1);
  });

  test("genuine double-membership in the canonical store is still blocked", () => {
    const founder = fakeState("col-founder");
    const aid = foundOpenAlliance(founder);
    // A second alliance in the same canonical store genuinely lists col-new.
    (founder as any).alliances["all-second"] = {
      id: "all-second",
      name: "Second Band",
      members: [{ colonyId: "col-new", colonyName: "Newbie", role: "member", joinedAt: NOW - 1000 }],
      applications: [],
      activity: [],
      version: 1,
    };
    // Applying to the first alliance while canonically in another → blocked.
    const res = applyToAlliance(founder, aid, { id: "col-new", name: "Newbie" }, NOW);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/One flag at a time/);
  });

  test("clean open-policy join adds the member once", () => {
    const founder = fakeState("col-founder");
    const aid = foundOpenAlliance(founder);
    const before = (founder as any).alliances[aid].members.length;
    const res = applyToAlliance(founder, aid, { id: "col-new", name: "Newbie" }, NOW);
    expect(res.ok).toBe(true);
    expect((founder as any).alliances[aid].members.length).toBe(before + 1);
  });
});
