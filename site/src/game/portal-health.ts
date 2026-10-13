// portal-health.ts — THE PORTAL MONITOR (owner architecture, Oct 13 2026).
//
// The landing/solar-system page is a standalone PORTAL + STATUS page: it
// belongs to no single server. It pings every known server's /api/health
// about every 10 seconds and renders REAL status per planet — up/down,
// player count, reverb, war state, accepting/not-accepting.
//
// This module is the pure core of that monitor: the health payload shape,
// a defensive parser, the per-server freshness reducer (fresh / stale /
// down), and the derivation of the system-wide war state the StarMap viz
// consumes. No fetch, no timers, no React — the component owns the clock
// and the wire; everything here is testable in isolation.
//
// HONESTY RULES (owner): a failed ping marks the planet DOWN; last-known
// values may still be shown but always flagged stale (dimmed) — never
// presented as fresh. War fires paint ONLY from fresh, live payloads.

import type { KnownServer } from "./servers";

/** War summary as carried by ONE world's /api/health: this world is under
 *  attack (or has raids inbound) when non-null. Attackers are world ids
 *  (KnownServer ids) — the same ids the portal renders as planets. */
export interface HealthWar {
  attackers: string[];
  /** Unresolved incoming raids right now (in transit or landed/fighting). */
  raids: number;
  /** Earliest future touchdown among them, ms epoch (absent if all landed). */
  nextLandingAt?: number;
}

/** The /api/health payload (public status data — CORS-open by design). */
export interface ServerHealthPayload {
  status: "up" | "down";
  worldId?: string;
  worldName?: string;
  raceLock?: string;
  playerCount?: number;
  reverb?: number;
  accepting?: boolean;
  war?: HealthWar | null;
  serverBuild?: string;
  timestamp?: string;
}

function asFiniteNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function parseWar(v: unknown): HealthWar | null | undefined {
  if (v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) return undefined;
  const w = v as Record<string, unknown>;
  const attackersRaw = Array.isArray(w.attackers) ? w.attackers : [];
  const attackers = attackersRaw.filter((a): a is string => typeof a === "string" && a.length > 0);
  const raids = asFiniteNumber(w.raids);
  if (raids === undefined) return undefined;
  const nextLandingAt = asFiniteNumber(w.nextLandingAt);
  return {
    attackers: [...new Set(attackers)],
    raids,
    ...(nextLandingAt !== undefined ? { nextLandingAt } : {}),
  };
}

/** Defensively parse an /api/health body. Returns null when the body is
 *  not a health payload at all (HTML error page, garbage, wrong shape) —
 *  the caller treats that as a failed ping. Older deployments (no
 *  accepting/war fields) parse fine: absent fields stay undefined. */
export function parseHealthPayload(json: unknown): ServerHealthPayload | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const d = json as Record<string, unknown>;
  if (d.status !== "up" && d.status !== "down") return null;
  const war = parseWar(d.war);
  return {
    status: d.status,
    worldId: asString(d.worldId),
    worldName: asString(d.worldName),
    raceLock: asString(d.raceLock),
    playerCount: asFiniteNumber(d.playerCount),
    reverb: asFiniteNumber(d.reverb),
    accepting: typeof d.accepting === "boolean" ? d.accepting : undefined,
    war: d.war === undefined ? undefined : war,
    serverBuild: asString(d.serverBuild),
    timestamp: asString(d.timestamp),
  };
}

/* ------------------------------------------------------------------ */
/* Per-server freshness reducer                                         */
/* ------------------------------------------------------------------ */

export type PortalPhase = "checking" | "up" | "down";

export interface PortalServerState {
  phase: PortalPhase;
  /** The last payload that reported UP — the only values ever shown.
   *  While down they render dimmed (stale), never as fresh data. */
  lastUp: ServerHealthPayload | null;
  /** ms epoch of the last UP response (null = never answered up). */
  lastOkAt: number | null;
  /** ms epoch of the last completed ping, up or down. */
  lastPollAt: number | null;
  consecutiveFailures: number;
  /** True when displayed data is not fresh: either the planet is down
   *  with last-known values, or the last success aged past STALE_AFTER_MS
   *  without a newer one (e.g. the tab was hidden and polls paused). */
  stale: boolean;
}

/** Poll cadence: ~10s (owner). A success older than this with no newer
 *  one is stale — 2.5 missed rounds. */
export const PORTAL_POLL_MS = 10_000;
export const PORTAL_STALE_AFTER_MS = 25_000;

export function initialPortalState(server: KnownServer): PortalServerState {
  // "Coming soon" worlds have no deployment to ping — they are simply
  // dark until they exist. (The canvas dims them by registry status too.)
  if (server.status === "soon" || !server.url) {
    return { phase: "down", lastUp: null, lastOkAt: null, lastPollAt: null, consecutiveFailures: 0, stale: false };
  }
  return { phase: "checking", lastUp: null, lastOkAt: null, lastPollAt: null, consecutiveFailures: 0, stale: false };
}

export function initialPortalStates(servers: KnownServer[]): Record<string, PortalServerState> {
  const out: Record<string, PortalServerState> = {};
  for (const s of servers) out[s.id] = initialPortalState(s);
  return out;
}

/** A ping completed and the world reported UP. (Prior state is unused
 *  on purpose: a success resets freshness wholesale.) */
export function portalPollUp(_state: PortalServerState, payload: ServerHealthPayload, now: number): PortalServerState {
  return {
    phase: "up",
    lastUp: payload,
    lastOkAt: now,
    lastPollAt: now,
    consecutiveFailures: 0,
    stale: false,
  };
}

/** A ping failed (network, timeout, unparseable body) OR the world
 *  answered DOWN (503 / status:"down"). Either way the planet is DOWN;
 *  last-known UP values survive, flagged stale — never fake-fresh. */
export function portalPollDown(state: PortalServerState, now: number): PortalServerState {
  return {
    phase: "down",
    lastUp: state.lastUp,
    lastOkAt: state.lastOkAt,
    lastPollAt: now,
    consecutiveFailures: state.consecutiveFailures + 1,
    stale: state.lastUp !== null,
  };
}

/** Time sweep: an UP planet whose last success aged out (polls paused
 *  while the tab slept) goes stale — values dim until the next success. */
export function portalTick(state: PortalServerState, now: number): PortalServerState {
  if (state.phase === "up" && !state.stale && state.lastOkAt !== null && now - state.lastOkAt > PORTAL_STALE_AFTER_MS) {
    return { ...state, stale: true };
  }
  return state;
}

/** Delay before the next poll round: the 10s cadence with ±1.5s jitter
 *  so a thousand portals don't thunder in lockstep. `rand` is injected
 *  for tests. */
export function nextPortalPollDelay(rand: () => number = Math.random): number {
  return PORTAL_POLL_MS + Math.round((rand() * 2 - 1) * 1500);
}

/* ------------------------------------------------------------------ */
/* System war state — the shape the StarMap war viz consumes            */
/* ------------------------------------------------------------------ */

export interface PlanetWar {
  planetId: string; // KnownServer id under attack
  attackers: string[]; // KnownServer ids raining fire on it
  reverbDrop?: number; // how much reverb has fallen since the attack began
}

export interface SystemWarState {
  active: boolean;
  wars: PlanetWar[];
}

/** Aggregate every server's fresh health payload into the system war
 *  picture. Only FRESH up data counts: a world we cannot reach has an
 *  unknown war state — painting its last-known fires as live would be
 *  fake data. Returns null when no world reports war (ALL QUIET). */
export function warStateFromPortal(
  states: Record<string, PortalServerState>,
  servers: KnownServer[],
): SystemWarState | null {
  const wars: PlanetWar[] = [];
  for (const server of servers) {
    const st = states[server.id];
    if (!st || st.phase !== "up" || st.stale || !st.lastUp) continue;
    const war = st.lastUp.war;
    if (!war || war.raids <= 0) continue;
    wars.push({ planetId: server.id, attackers: war.attackers });
  }
  if (wars.length === 0) return null;
  return { active: true, wars };
}
