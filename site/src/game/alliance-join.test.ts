import { describe, expect, test } from "bun:test";
import { createAlliance, applyToAlliance, allianceOf, setJoinPolicy } from "./war/alliances";
import type { GameState } from "./types";

/**
 * ALLIANCE JOIN REGRESSION (owner 2026-10-04 bug report):
 * A fresh account with NO alliance (seed omits the alliances field; Cradle
 * shows "No alliance yet") clicked Join on an open-policy war band and got
 * "One flag at a time — leave your current alliance first."
 *
 * ROOT CAUSE (2026-10-04, verified from the deployed bundle): the deployed
 * server function was STALE — `.vercel/output/functions/render.func/index.mjs`
 * (timestamp 06:45:40) predated the 7280f0b fix (07:04:44). The deploy had run
 * `vite build` (client only), which never rebuilds render.func; that only
 * happens in build-vercel.sh step 3. So live ran the OLD allianceApplyFn,
 * which judged "one flag at a time" against the founder's canonical roster —
 * which still listed the applicant from a previous seed — while the client
 * bundle carried the new code. The code fix in 7280f0b was CORRECT; the
 * process (deploy without rebuilding the server bundle) was the bug.
 * Process guard: /api/health now reports `serverBuild`, stamped by
 * build-vercel.sh, so a stale server bundle is caught in seconds
 * (see game/server-build.test.ts).
 *
 * These tests pin the fixed code path: (1) the applicant-state check runs
 * against the APPLICANT's own save before the canonical tx; (2)
 * applyToAlliance is idempotent when the roster already lists them (stale
 * entry after a reseed) — no block, no duplicate member; (3) the exact live
 * seed shape (founder save with members 1–5, fresh applicant with no
 * alliances field) joins cleanly; (4) genuine double-membership is still
 * blocked.
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

  test("exact live seed shape: founder save (members 1–5) + fresh applicant (no alliances field) joins cleanly", () => {
    // Mirrors vercel-entry.ts runSeedWarlord6 exactly: the founder's save
    // carries the raw seeded alliance (members = testwarlord1..5, open
    // policy); the applicant's save has NO alliances field at all.
    const testPlayers = ["testwarlord1", "testwarlord2", "testwarlord3", "testwarlord4", "testwarlord5"];
    const founder = {
      gameId: "testwarlord1",
      alliances: {
        "ashen-vanguard": {
          id: "ashen-vanguard",
          name: "Ashen Vanguard",
          members: testPlayers.map((p, i) => ({
            colonyId: p,
            colonyName: "TestWarlord" + (i + 1),
            role: i === 0 ? "leader" : "member",
            joinedAt: NOW - 60 * 86400000,
          })),
          applications: [],
          invites: [],
          foundedAt: NOW - 60 * 86400000,
          founderId: "testwarlord1",
          homeServerId: "draconians-world",
          version: 1,
          joinPolicy: "open",
        },
      },
    } as unknown as GameState;
    const applicant = { gameId: "testwarlord6" } as unknown as GameState;

    // What allianceApplyFn checks BEFORE the canonical tx: the applicant's
    // own state has no alliance.
    expect(allianceOf(applicant, "testwarlord6")).toBeNull();
    // What runs inside the canonical tx on the founder's save.
    const res = applyToAlliance(founder, "ashen-vanguard", { id: "testwarlord6", name: "TestWarlord6" }, NOW);
    expect(res.ok).toBe(true);
    const members = (founder as any).alliances["ashen-vanguard"].members;
    expect(members.filter((m: any) => m.colonyId === "testwarlord6").length).toBe(1);
  });

  test("double-apply is idempotent: second apply returns ok, no duplicate (fails pre-7280f0b)", () => {
    // Before the fix, the second apply hit "One flag at a time — leave your
    // current alliance first." (the canonical roster now lists them from
    // the first apply). Idempotency makes retries/double-taps safe.
    const founder = fakeState("col-founder");
    const aid = foundOpenAlliance(founder);
    const first = applyToAlliance(founder, aid, { id: "col-new", name: "Newbie" }, NOW);
    expect(first.ok).toBe(true);
    const before = (founder as any).alliances[aid].members.length;
    const second = applyToAlliance(founder, aid, { id: "col-new", name: "Newbie" }, NOW);
    expect(second.ok).toBe(true);
    expect((founder as any).alliances[aid].members.length).toBe(before);
  });
});
