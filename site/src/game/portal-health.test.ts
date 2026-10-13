// portal-health.test.ts — the portal monitor's pure core (Oct 13 2026).
//
// Pins the owner rules: ~10s polling contract lives in the component;
// here we pin parsing honesty, the fresh/stale/down reducer transitions,
// and the rule that war fires paint ONLY from fresh live payloads.
import { describe, expect, test } from "bun:test";
import {
  initialPortalState,
  initialPortalStates,
  nextPortalPollDelay,
  parseHealthPayload,
  portalPollDown,
  portalPollUp,
  portalTick,
  warStateFromPortal,
  PORTAL_POLL_MS,
  PORTAL_STALE_AFTER_MS,
  type ServerHealthPayload,
} from "./portal-health";
import { KNOWN_SERVERS, type KnownServer } from "./servers";

const DRAC: KnownServer = KNOWN_SERVERS.find((s) => s.id === "draconians-world")!;
const WATCH: KnownServer = KNOWN_SERVERS.find((s) => s.id === "watchers-beta")!;
const SOON: KnownServer = KNOWN_SERVERS.find((s) => s.status === "soon")!;

const T0 = 1_700_000_000_000;

function upPayload(extra: Partial<ServerHealthPayload> = {}): ServerHealthPayload {
  return {
    status: "up",
    worldId: "draconians-world",
    playerCount: 14,
    reverb: 12000,
    accepting: true,
    war: null,
    ...extra,
  };
}

describe("parseHealthPayload", () => {
  test("parses a full current payload including accepting + war", () => {
    const p = parseHealthPayload({
      status: "up",
      worldId: "draconians-world",
      worldName: "The Ashen Wastes",
      raceLock: "draconians",
      playerCount: 14,
      reverb: 12000,
      accepting: true,
      war: { attackers: ["watchers-beta"], raids: 2, nextLandingAt: 123 },
      serverBuild: "abc123",
      timestamp: "2026-10-13T00:00:00.000Z",
    });
    expect(p).not.toBeNull();
    expect(p!.status).toBe("up");
    expect(p!.playerCount).toBe(14);
    expect(p!.accepting).toBe(true);
    expect(p!.war).toEqual({ attackers: ["watchers-beta"], raids: 2, nextLandingAt: 123 });
  });

  test("parses a legacy payload (production: no accepting/war fields)", () => {
    const p = parseHealthPayload({ status: "up", worldId: "watchers-beta", playerCount: 3, reverb: 0 });
    expect(p).not.toBeNull();
    expect(p!.accepting).toBeUndefined();
    expect(p!.war).toBeUndefined();
  });

  test("parses an explicit down payload (503 body)", () => {
    const p = parseHealthPayload({ status: "down", reason: "database", worldId: "draconians-world" });
    expect(p!.status).toBe("down");
  });

  test("rejects garbage: HTML pages, arrays, wrong status, non-objects", () => {
    expect(parseHealthPayload("<!DOCTYPE html><html>Page not found</html>")).toBeNull();
    expect(parseHealthPayload(null)).toBeNull();
    expect(parseHealthPayload([1, 2])).toBeNull();
    expect(parseHealthPayload({ status: "sideways" })).toBeNull();
    expect(parseHealthPayload({ playerCount: 5 })).toBeNull();
  });

  test("drops mistyped fields instead of trusting them", () => {
    const p = parseHealthPayload({
      status: "up",
      playerCount: "fourteen",
      reverb: Number.NaN,
      accepting: "yes",
      war: { attackers: ["watchers-beta", 42, ""], raids: "two" },
    });
    expect(p!.playerCount).toBeUndefined();
    expect(p!.reverb).toBeUndefined();
    expect(p!.accepting).toBeUndefined();
    // war with a non-numeric raids count is not a war summary at all
    expect(p!.war).toBeUndefined();
  });

  test("dedupes attackers and keeps a clean war object", () => {
    const p = parseHealthPayload({
      status: "up",
      war: { attackers: ["watchers-beta", "watchers-beta", "grays-world"], raids: 3 },
    });
    expect(p!.war).toEqual({ attackers: ["watchers-beta", "grays-world"], raids: 3 });
  });

  test("war: null stays null (quiet world), absent war stays undefined", () => {
    expect(parseHealthPayload({ status: "up", war: null })!.war).toBeNull();
    expect(parseHealthPayload({ status: "up" })!.war).toBeUndefined();
  });
});

describe("portal freshness reducer", () => {
  test("live servers start checking; soon servers start dark (nothing to ping)", () => {
    expect(initialPortalState(DRAC).phase).toBe("checking");
    const soon = initialPortalState(SOON);
    expect(soon.phase).toBe("down");
    expect(soon.lastUp).toBeNull();
    expect(soon.stale).toBe(false);
  });

  test("checking → up on first success, fresh values recorded", () => {
    const s = portalPollUp(initialPortalState(DRAC), upPayload(), T0);
    expect(s.phase).toBe("up");
    expect(s.stale).toBe(false);
    expect(s.lastOkAt).toBe(T0);
    expect(s.lastUp!.playerCount).toBe(14);
    expect(s.consecutiveFailures).toBe(0);
  });

  test("up → down on failure: last-known values survive, flagged stale", () => {
    const up = portalPollUp(initialPortalState(DRAC), upPayload(), T0);
    const down = portalPollDown(up, T0 + PORTAL_POLL_MS);
    expect(down.phase).toBe("down");
    expect(down.stale).toBe(true); // values shown dimmed, never fake-fresh
    expect(down.lastUp!.playerCount).toBe(14);
    expect(down.lastOkAt).toBe(T0); // freshness clock does NOT move
    expect(down.consecutiveFailures).toBe(1);
  });

  test("down with no history: no values, not stale, failures accumulate", () => {
    let s = initialPortalState(DRAC);
    s = portalPollDown(s, T0);
    s = portalPollDown(s, T0 + PORTAL_POLL_MS);
    expect(s.phase).toBe("down");
    expect(s.lastUp).toBeNull();
    expect(s.stale).toBe(false);
    expect(s.consecutiveFailures).toBe(2);
  });

  test("down → up recovers clean: fresh values replace last-known", () => {
    let s = portalPollUp(initialPortalState(DRAC), upPayload(), T0);
    s = portalPollDown(s, T0 + PORTAL_POLL_MS);
    s = portalPollUp(s, upPayload({ playerCount: 20 }), T0 + 2 * PORTAL_POLL_MS);
    expect(s.phase).toBe("up");
    expect(s.stale).toBe(false);
    expect(s.lastUp!.playerCount).toBe(20);
    expect(s.consecutiveFailures).toBe(0);
  });

  test("tick: an aged success goes stale without changing phase", () => {
    const up = portalPollUp(initialPortalState(DRAC), upPayload(), T0);
    expect(portalTick(up, T0 + PORTAL_STALE_AFTER_MS - 1)).toBe(up); // still fresh
    const stale = portalTick(up, T0 + PORTAL_STALE_AFTER_MS + 1);
    expect(stale.phase).toBe("up");
    expect(stale.stale).toBe(true);
    // ticking a down/checking state is a no-op (same reference)
    const down = portalPollDown(up, T0 + PORTAL_POLL_MS);
    expect(portalTick(down, T0 + 10 * PORTAL_STALE_AFTER_MS)).toBe(down);
  });

  test("poll delay: 10s cadence ± 1.5s jitter", () => {
    expect(nextPortalPollDelay(() => 0.5)).toBe(PORTAL_POLL_MS);
    expect(nextPortalPollDelay(() => 0)).toBe(PORTAL_POLL_MS - 1500);
    expect(nextPortalPollDelay(() => 1)).toBe(PORTAL_POLL_MS + 1500);
  });
});

describe("warStateFromPortal", () => {
  function statesWith(drac: ReturnType<typeof portalPollUp>, watch?: ReturnType<typeof portalPollUp>) {
    const states = initialPortalStates(KNOWN_SERVERS);
    states[DRAC.id] = drac;
    if (watch) states[WATCH.id] = watch;
    return states;
  }

  test("quiet everywhere → null (ALL QUIET)", () => {
    const states = statesWith(portalPollUp(initialPortalState(DRAC), upPayload(), T0));
    expect(warStateFromPortal(states, KNOWN_SERVERS)).toBeNull();
  });

  test("fresh war payload → active war with planet + attackers", () => {
    const drac = portalPollUp(
      initialPortalState(DRAC),
      upPayload({ war: { attackers: ["watchers-beta"], raids: 2 } }),
      T0,
    );
    const w = warStateFromPortal(statesWith(drac), KNOWN_SERVERS);
    expect(w).toEqual({ active: true, wars: [{ planetId: "draconians-world", attackers: ["watchers-beta"] }] });
  });

  test("war on a DOWN world is NOT painted (unknown ≠ live)", () => {
    let drac = portalPollUp(
      initialPortalState(DRAC),
      upPayload({ war: { attackers: ["watchers-beta"], raids: 1 } }),
      T0,
    );
    drac = portalPollDown(drac, T0 + PORTAL_POLL_MS);
    expect(warStateFromPortal(statesWith(drac), KNOWN_SERVERS)).toBeNull();
  });

  test("war on a STALE world is NOT painted either", () => {
    let drac = portalPollUp(
      initialPortalState(DRAC),
      upPayload({ war: { attackers: ["watchers-beta"], raids: 1 } }),
      T0,
    );
    drac = portalTick(drac, T0 + PORTAL_STALE_AFTER_MS + 1);
    expect(drac.stale).toBe(true);
    expect(warStateFromPortal(statesWith(drac), KNOWN_SERVERS)).toBeNull();
  });

  test("multiple worlds at war aggregate; raids: 0 is quiet", () => {
    const drac = portalPollUp(initialPortalState(DRAC), upPayload({ war: { attackers: ["watchers-beta"], raids: 1 } }), T0);
    const watch = portalPollUp(initialPortalState(WATCH), upPayload({ war: { attackers: [], raids: 0 } }), T0);
    const w = warStateFromPortal(statesWith(drac, watch), KNOWN_SERVERS);
    expect(w!.wars).toHaveLength(1);
    expect(w!.wars[0].planetId).toBe("draconians-world");
  });
});
