// muster-tiers.test.ts — engine-level tests for real troop tiers T1–T4
// (owner 2026-10-05): the Muster research line, its sequential gating, and
// the tier backfill on ensureTroops.
import { describe, expect, test } from "bun:test";
import {
  advance,
  beginResearch,
  ensureTroops,
  musterTechAvailable,
  newGame,
} from "./engine";
import { addCohort, emptyTroopHome } from "./war/troops";
import { MUSTER_TIER_TREE } from "./research";
import type { GameState } from "./types";

function makeState(now: number): GameState {
  const st = newGame("TestCommander", "draconians", now);
  advance(st, now); // ensureTroops + world map
  st.codices = 100;
  return st;
}

function freeLeaderId(st: GameState): string {
  const l = st.leaders.find((x) => x.status === "active" && !x.assignment);
  if (!l) throw new Error("no free leader");
  return l.id;
}

describe("muster tier research — the tree", () => {
  test("MUSTER_TIER_TREE has three sequential nodes unlocking T2/T3/T4", () => {
    expect(MUSTER_TIER_TREE.map((n) => n.id)).toEqual(["muster_1", "muster_2", "muster_3"]);
    expect(MUSTER_TIER_TREE.map((n) => n.unlocksTier)).toEqual([2, 3, 4]);
    for (const n of MUSTER_TIER_TREE) {
      expect(n.codicesCost).toBeGreaterThan(0);
      expect(n.durationMs).toBeGreaterThan(0);
    }
  });
  test("availability is strictly sequential", () => {
    const now = Date.now();
    const st = makeState(now);
    expect(musterTechAvailable(st, "muster_1")).toBe(true);
    expect(musterTechAvailable(st, "muster_2")).toBe(false);
    expect(musterTechAvailable(st, "muster_3")).toBe(false);
    st.techsResearched.push("muster_1");
    expect(musterTechAvailable(st, "muster_2")).toBe(true);
    expect(musterTechAvailable(st, "muster_3")).toBe(false);
    st.techsResearched.push("muster_2");
    expect(musterTechAvailable(st, "muster_3")).toBe(true);
    st.techsResearched.push("muster_3");
    expect(musterTechAvailable(st, "muster_3")).toBe(false); // done = not available
  });
});

describe("muster tier research — begin and resolve through beginResearch", () => {
  test("beginResearch dispatches muster_1: costs codices, appoints the leader", () => {
    const now = Date.now();
    const st = makeState(now);
    const leaderId = freeLeaderId(st);
    const before = st.codices;
    const res = beginResearch(st, "muster_1", leaderId, now);
    expect(res.ok).toBe(true);
    expect(st.codices).toBe(before - 8);
    expect(st.researchJobs.some((j) => j.techId === "muster_1" && j.status === "researching")).toBe(true);
    expect(st.leaders.find((l) => l.id === leaderId)!.assignment).toBe("muster_1");
  });
  test("beginResearch refuses muster_2 before muster_1 is done", () => {
    const now = Date.now();
    const st = makeState(now);
    const res = beginResearch(st, "muster_2", freeLeaderId(st), now);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/first/i);
  });
  test("research completes and unlocks T2 mustering", () => {
    const now = Date.now();
    const st = makeState(now);
    const leaderId = freeLeaderId(st);
    const res = beginResearch(st, "muster_1", leaderId, now);
    expect(res.ok).toBe(true);
    const job = st.researchJobs.find((j) => j.techId === "muster_1")!;
    advance(st, job.startedAt + job.durationMs + 1000);
    expect(st.techsResearched.includes("muster_1")).toBe(true);
    expect(musterTechAvailable(st, "muster_2")).toBe(true);
    expect(st.leaders.find((l) => l.id === leaderId)!.assignment).toBe(null);
  });
});

describe("muster tier research — ensureTroops migration", () => {
  test("tierless cohorts and muster orders backfill to T1 on ensure", () => {
    const now = Date.now();
    const st = makeState(now);
    const home = st.troops!.home;
    addCohort(home.roster, "bulwark", 100, now);
    const legacy = home.roster.cohorts[0] as unknown as { tier?: number };
    delete legacy.tier;
    home.musterQueue.push({
      id: "m-legacy", type: "reaver", count: 10, startedAt: now, completesAt: now + 1000,
    } as never);
    ensureTroops(st, now);
    expect((home.roster.cohorts[0] as { tier: number }).tier).toBe(1);
    expect((home.musterQueue[0] as { tier: number }).tier).toBe(1);
  });
  test("existing tiered cohorts keep their tier through ensure", () => {
    const now = Date.now();
    const st = makeState(now);
    const home = st.troops!.home;
    addCohort(home.roster, "thunder", 25, now, 0, 4);
    ensureTroops(st, now);
    expect(home.roster.cohorts[0].tier).toBe(4);
  });
});

describe("muster tier research — emptyTroopHome is tier-clean", () => {
  test("fresh homes carry empty rosters with no legacy shape", () => {
    const home = emptyTroopHome(Date.now());
    expect(home.roster.cohorts).toEqual([]);
    expect(home.musterQueue).toEqual([]);
  });
});
