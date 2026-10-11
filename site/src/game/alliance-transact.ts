// ALLIANCE-TRANSACT — the cross-account seam (server-only).
//
// One account's server fns can only see their own save; alliances span
// accounts. This module is the bridge:
//
//   • findColonyAccountId(colonyId) — which account holds a colony.
//   • transactColony(colonyId, fn) — run fn against a colony's GameState with
//     per-account serialization, exactly one load and (via the outbox) a
//     bounded number of saves.
//   • applyAllianceFx(saves) — drain queued AllianceFx and apply
//     each to its target colony's save (idempotent appliers).
//
// REQUEST SCOPE (the A↔B fix). A request holds its account lock while it
// drains fx, and chained fx can target an account the SAME request already
// holds (A→B→A: a casualty bill applied on B queues a mirror-shrink back to
// A). Re-acquiring that lock would sit on it until the 8s timeout. Instead
// the request carries a scope — the accounts it holds plus their in-memory
// saves — and transactColony serves scope-held colonies straight from memory
// (the outermost frame owns persistence). Foreign accounts still go through
// lock → load → mutate → save. Two genuinely concurrent requests on one
// account still degrade to AccountBusyError → requeue, never a deadlock.
//
// OUTBOX. A frame persists its saves BEFORE draining (the queued fx become
// durable), drains, then persists again to clear delivered fx. A crash
// between the saves replays from the outbox — every applier is idempotent,
// so at-least-once delivery is exactly-once in effect. (The store swallows
// save errors internally, so this guards the crash window, not a dead disk.)

import { AsyncLocalStorage } from "node:async_hooks";
import {
  loadAccountSaves,
  saveAccountSaves,
  loadAllSaves,
  type AccountSaves,
} from "./store";
import type { GameState } from "./types";
import { advance } from "./engine";
import {
  allianceOf,
  applyBillForeignCasualties,
  applyCreateGuestMirror,
  applyHelpFx,
  applyRecordService,
  applyReleaseTroopLock,
  applyRemoveGuestMirror,
  applyShrinkGuestMirror,
  applySyncAlliance,
  drainAllianceFx,
  fxDone,
  leaveAllianceLocal,
  markFxDone,
  queueAllianceFx,
  removeAllianceMirror,
  type AllianceFx,
} from "./war/alliances";
import {
  addRemotePledge,
  applyDeliverRallyLoot,
  applyReleaseRallyPledge,
  applySyncRally,
  applyUnlockRallyHeroes,
  departRalliesFor,
  rallyAudience,
  rallyOf,
  removeRemotePledge,
} from "./war/rallies";
import {
  applyArenaAcceptFx,
  applyArenaCancelFx,
  applyArenaChallengeFx,
  applyArenaDeclineFx,
  applyArenaResult,
} from "./war/arena";

/** Storage backend — the real store by default, injectable for tests. */
export interface ColonyStore {
  loadAccountSaves(accountId: string): Promise<AccountSaves | null>;
  saveAccountSaves(accountId: string, saves: AccountSaves): Promise<boolean | void>;
  loadAllSaves(): Promise<Array<{ accountId: string; saves: AccountSaves }>>;
}

const defaultStore: ColonyStore = { loadAccountSaves, saveAccountSaves, loadAllSaves };

// ---------------------------------------------------------------------------
// Request scope — accounts this async context already holds, with saves
// ---------------------------------------------------------------------------

interface TxScope {
  held: Set<string>;
  saves: Map<string, AccountSaves>;
}

const txScope = new AsyncLocalStorage<TxScope>();

/**
 * Run fn with an account's in-memory saves registered on the request scope.
 * Nested transactColony calls for colonies in registered saves operate on
 * them directly — no lock re-entry, no reload, no save (the outermost frame
 * persists). This is what lets A→B→A fx chains deliver inside one request
 * instead of timing out on the outer lock.
 */
export function runWithAccountSaves<T>(
  accountId: string,
  saves: AccountSaves,
  fn: () => Promise<T>,
): Promise<T> {
  const parent = txScope.getStore();
  const scope: TxScope = {
    held: new Set(parent?.held ?? []).add(accountId),
    saves: new Map(parent?.saves ?? []).set(accountId, saves),
  };
  return txScope.run(scope, fn);
}

/** Scope-held saves containing colonyId, if this request holds them. */
function scopeSavesFor(colonyId: string): { accountId: string; saves: AccountSaves } | null {
  const scope = txScope.getStore();
  if (!scope) return null;
  for (const [accountId, saves] of scope.saves) {
    if (gameStateFor(saves, colonyId)) return { accountId, saves };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-account locks
// ---------------------------------------------------------------------------

const locks = new Map<string, Promise<void>>();
export const ACCOUNT_LOCK_TIMEOUT_MS = 8000;

export class AccountBusyError extends Error {
  constructor(public accountId: string) {
    super(`account-busy:${accountId}`);
    this.name = "AccountBusyError";
  }
}

export class ColonyNotFoundError extends Error {
  constructor(public colonyId: string) {
    super(`colony-not-found:${colonyId}`);
    this.name = "ColonyNotFoundError";
  }
}

/** Serialize async work per account. Never deadlocks: the wait times out. */
export async function withAccountLock<T>(
  accountId: string,
  fn: () => Promise<T>,
  timeoutMs = ACCOUNT_LOCK_TIMEOUT_MS,
): Promise<T> {
  let release!: () => void;
  const willLock = new Promise<void>((res) => {
    release = res;
  });
  const prev = locks.get(accountId) ?? Promise.resolve();
  locks.set(accountId, prev.then(() => willLock));
  try {
    await Promise.race([
      prev,
      new Promise<never>((_, rej) => setTimeout(() => rej(new AccountBusyError(accountId)), timeoutMs)),
    ]);
  } catch (e) {
    release(); // repair the chain — we never held the lock
    throw e;
  }
  try {
    return await fn();
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Colony → account resolution
// ---------------------------------------------------------------------------

/**
 * The GameState for a colony id inside an account's saves. Matches the map
 * key first, then every game's authoritative state.gameId — legacy rows wrap
 * a bare GameState as key "0" while the state keeps its real gameId, and the
 * two can disagree in general.
 */
export function gameStateFor(saves: AccountSaves, colonyId: string): GameState | undefined {
  const direct = saves.games[colonyId];
  if (direct) return direct;
  for (const g of Object.values(saves.games)) {
    if (g && (g as GameState).gameId === colonyId) return g as GameState;
  }
  return undefined;
}

/** Positive-hit cache: colonies never change accounts, so hits are stable.
 *  Misses are never cached (a colony created after a miss must be found);
 *  a stale hit is evicted when the colony turns out to be gone. */
const colonyAccountCache = new Map<string, string>();

export function clearColonyAccountCache(): void {
  colonyAccountCache.clear();
}

export function evictColonyAccount(colonyId: string): void {
  colonyAccountCache.delete(colonyId);
}

/** Which account holds a colony? Scans every game in every account's saves —
 *  not just activeGameId — matching the map key or state.gameId. */
export async function findColonyAccountId(
  colonyId: string,
  store: ColonyStore = defaultStore,
): Promise<string | null> {
  const hit = colonyAccountCache.get(colonyId);
  if (hit) return hit;
  const all = await store.loadAllSaves();
  for (const { accountId, saves } of all) {
    if (gameStateFor(saves, colonyId)) {
      colonyAccountCache.set(colonyId, accountId);
      return accountId;
    }
  }
  return null;
}

/** Public alliance listing for discovery (no members, no applications —
 *  just enough to find a banner worth applying to). */
export interface AllianceDirectoryEntry {
  id: string;
  name: string;
  banner: string;
  motto: string;
  memberCount: number;
  founderId: string;
  homeServerId: string;
  foundedAt: number;
  joinPolicy?: "open" | "apply";
}

/** Scan every account's saves for alliance records. Read-only, no locks —
 *  discovery is eventually consistent by design. */
export async function scanAllianceDirectory(
  store: ColonyStore = defaultStore,
): Promise<AllianceDirectoryEntry[]> {
  const out = new Map<string, AllianceDirectoryEntry>();
  const all = await store.loadAllSaves();
  for (const { saves } of all) {
    const alliances = (saves.games ? Object.values(saves.games) : []).flatMap((g) => {
      const rec = (g as unknown as { alliances?: Record<string, unknown> }).alliances;
      return rec ? Object.values(rec) : [];
    });
    for (const a of alliances) {
      const r = a as unknown as {
        id: string; name: string; banner: string; motto: string;
        members: unknown[]; founderId: string; homeServerId: string; foundedAt: number;
        joinPolicy?: "open" | "apply";
      };
      if (!r || typeof r.id !== "string" || out.has(r.id)) continue;
      out.set(r.id, {
        id: r.id,
        name: String(r.name ?? "Unnamed"),
        banner: String(r.banner ?? "⚔️"),
        motto: String(r.motto ?? ""),
        memberCount: Array.isArray(r.members) ? r.members.length : 0,
        founderId: String(r.founderId ?? ""),
        homeServerId: String(r.homeServerId ?? "home"),
        foundedAt: typeof r.foundedAt === "number" ? r.foundedAt : 0,
        joinPolicy: r.joinPolicy === "open" ? "open" : "apply",
      });
    }
  }
  return [...out.values()].sort((x, y) => y.memberCount - x.memberCount || x.name.localeCompare(y.name));
}

// ---------------------------------------------------------------------------
// transactColony
// ---------------------------------------------------------------------------

export interface TxCtx {
  accountId: string;
  colonyId: string;
  now: number;
}

export interface TransactOpts {
  /** Explicit in-memory saves (tests, direct flows): colonies living in
   *  them are mutated in place — no load/save, the caller owns persistence. */
  local?: { accountId: string; saves: AccountSaves };
  /** Fx-drain nesting depth (cycle backstop — the scope already terminates
   *  A↔B chains by serving held accounts from memory). */
  depth?: number;
  store?: ColonyStore;
  /** Override the account-lock timeout (tests use a short one to exercise
   *  the transient-requeue path without waiting out the 8s default). */
  lockTimeoutMs?: number;
}

const MAX_FX_DEPTH = 4;

/**
 * Run `fn` against a colony's GameState, serialized per account.
 *
 * Resolution order: explicit `local` saves → this request's scope (accounts
 * whose lock we already hold — served from memory, no save) → foreign
 * account (lock → load → mutate → outbox commit → save).
 *
 * Throws ColonyNotFoundError when the colony doesn't exist, AccountBusyError
 * on lock timeout.
 */
export async function transactColony<T>(
  colonyId: string,
  fn: (st: GameState, ctx: TxCtx) => T | Promise<T>,
  opts: TransactOpts = {},
): Promise<T> {
  const store = opts.store ?? defaultStore;
  const now = Date.now();

  if (opts.local) {
    const st = gameStateFor(opts.local.saves, colonyId);
    if (st) {
      advance(st, now);
      return await fn(st, { accountId: opts.local.accountId, colonyId, now });
    }
  }

  const scoped = scopeSavesFor(colonyId);
  if (scoped) {
    const st = gameStateFor(scoped.saves, colonyId)!;
    advance(st, now);
    // No nested drain here: the caller's drain pass picks up anything fn
    // queues, and the outermost frame owns the save.
    return await fn(st, { accountId: scoped.accountId, colonyId, now });
  }

  const accountId = await findColonyAccountId(colonyId, store);
  if (!accountId) throw new ColonyNotFoundError(colonyId);
  try {
    return await withAccountLock(
      accountId,
      async () => {
        const saves = await store.loadAccountSaves(accountId);
        const st = saves ? gameStateFor(saves, colonyId) : undefined;
        if (!saves || !st) throw new ColonyNotFoundError(colonyId);
        return await runWithAccountSaves(accountId, saves, async () => {
          advance(st, now);
          const value = await fn(st, { accountId, colonyId, now });
          await commitOutbox(saves, accountId, opts);
          return value;
        });
      },
      opts.lockTimeoutMs ?? ACCOUNT_LOCK_TIMEOUT_MS,
    );
  } catch (e) {
    if (e instanceof ColonyNotFoundError) evictColonyAccount(colonyId);
    throw e;
  }
}

/**
 * Persist-then-drain for one account's saves: (1) the mutation plus queued
 * fx become durable BEFORE any foreign delivery, (2) deliver, (3) persist
 * the cleared outbox when anything moved. A crash between (1) and (3)
 * replays from the outbox — safe, because every applier is idempotent.
 */
export async function commitOutbox(
  saves: AccountSaves,
  accountId: string,
  opts: { depth?: number; store?: ColonyStore; lockTimeoutMs?: number } = {},
): Promise<{ applied: number; requeued: number; dropped: number }> {
  const store = opts.store ?? defaultStore;
  const depth = opts.depth ?? 0;
  const idle = { applied: 0, requeued: 0, dropped: 0 };
  await store.saveAccountSaves(accountId, saves);
  if (depth >= MAX_FX_DEPTH) return idle;
  const stats = await applyAllianceFx(saves, { depth: depth + 1, store });
  if (stats.applied > 0 || stats.requeued > 0 || stats.dropped > 0) {
    await store.saveAccountSaves(accountId, saves);
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Fx draining
// ---------------------------------------------------------------------------

export interface DrainOpts {
  depth?: number;
  store?: ColonyStore;
  /** Re-queue fx that failed transiently (default true). */
  requeueOnTransient?: boolean;
  /** Override the account-lock timeout (tests). */
  lockTimeoutMs?: number;
}

function isTransient(e: unknown): boolean {
  // The store swallows its own I/O errors internally (never throws), so the
  // only transient signal that can surface here is a contended lock.
  return e instanceof AccountBusyError;
}

/** Stable identity for an fx — explicit keys win; keyless kinds fall back to
 *  their natural idempotency anchor (the appliers dedupe on the same). */
function fxIdentity(fx: AllianceFx): string {
  switch (fx.kind) {
    case "apply-help-tick":
      return `help:${fx.tick.id}`;
    case "create-guest-mirror":
      return `mirror:${fx.mirror.id}`;
    case "remove-guest-mirror":
    case "release-troop-lock":
    case "shrink-guest-mirror":
    case "record-service":
    case "sync-alliance":
    case "depart-alliance":
    case "sync-rally":
    case "mirror-rally-pledge":
    case "mirror-rally-unpledge":
    case "release-rally-pledge":
    case "deliver-rally-loot":
    case "unlock-rally-heroes":
      return fx.key;
    case "bill-foreign-casualties":
      return fx.key ?? `casualty:${fx.battleId}:${fx.segmentId}`;
    case "arena-challenge":
    case "arena-accept":
    case "arena-decline":
    case "arena-cancel":
    case "arena-result":
      return fx.key;
    case "raid-alarm":
      return fx.key;
  }
}

function logLine(saves: AccountSaves, msg: string): void {
  const g = saves.activeGameId ? saves.games[saves.activeGameId] : undefined;
  const st = g ?? Object.values(saves.games)[0];
  if (!st || !Array.isArray((st as unknown as { log?: unknown }).log)) return;
  const l = (st as unknown as { log: string[] }).log;
  l.unshift(msg);
  (st as unknown as { log: string[] }).log = l.slice(0, 60);
}

/** Apply one fx to its target colony. Pure routing — the appliers live in
 *  war/alliances.ts and are idempotent. */
export function applyOneFx(target: GameState, fx: AllianceFx, now: number): void {
  switch (fx.kind) {
    case "apply-help-tick":
      applyHelpFx(target, fx.tick, now);
      break;
    case "create-guest-mirror":
      applyCreateGuestMirror(target, fx.mirror);
      break;
    case "remove-guest-mirror":
      applyRemoveGuestMirror(target, fx.mirrorId, fx.key);
      break;
    case "release-troop-lock":
      applyReleaseTroopLock(target, fx);
      break;
    case "bill-foreign-casualties":
      applyBillForeignCasualties(target, fx, now);
      break;
    case "shrink-guest-mirror":
      applyShrinkGuestMirror(target, fx.mirrorId, fx.weight, fx.key);
      break;
    case "record-service":
      applyRecordService(target, fx, now);
      break;
    case "sync-alliance":
      applySyncAlliance(target, fx.alliance);
      break;
    case "depart-alliance":
      applyDepartAlliance(target, fx.allianceId, fx.colonyId, fx.key);
      break;
    case "sync-rally":
      applySyncRally(target, fx.rally);
      break;
    case "mirror-rally-pledge": {
      const r = rallyOf(target, fx.rallyId);
      const res = r
        ? addRemotePledge(target, fx.rallyId, fx.pledge, rallyAudience(target, r))
        : { ok: false as const, error: "That rally doesn't exist." };
      if (!res.ok) {
        // Canonical record rejected it — unwind the pledger's lock so their
        // troops don't sit committed to a rally that never recorded them.
        queueAllianceFx(target, {
          kind: "release-rally-pledge",
          colonyId: fx.pledge.colonyId,
          rallyId: fx.rallyId,
          pledgeId: fx.pledge.id,
          troops: fx.pledge.troops,
          heroIds: fx.pledge.heroes.map((h) => h.id),
          key: `release-pledge:${fx.rallyId}:${fx.pledge.id}`,
        });
      }
      break;
    }
    case "mirror-rally-unpledge": {
      const r = rallyOf(target, fx.rallyId);
      if (r) removeRemotePledge(target, fx.rallyId, fx.pledgerId, fx.pledgeId, rallyAudience(target, r));
      break;
    }
    case "release-rally-pledge":
      applyReleaseRallyPledge(target, fx.rallyId, fx.pledgeId, fx.troops, fx.heroIds, fx.key);
      break;
    case "deliver-rally-loot":
      applyDeliverRallyLoot(target, fx.rallyId, fx.supplies, fx.key);
      break;
    case "unlock-rally-heroes":
      applyUnlockRallyHeroes(target, fx.rallyId, fx.heroIds, fx.key);
      break;
    case "arena-challenge":
      applyArenaChallengeFx(target, fx.challenge);
      break;
    case "arena-accept":
      applyArenaAcceptFx(target, fx.challengeId, fx.guestForce, fx.guestStakes, fx.key, now);
      break;
    case "arena-decline":
      applyArenaDeclineFx(target, fx.challengeId, now);
      break;
    case "arena-cancel":
      applyArenaCancelFx(target, fx.challengeId, now);
      break;
    case "arena-result":
      applyArenaResult(target, fx.bout, fx.heroIds, fx.challengeId, fx.key, now);
      break;
    case "raid-alarm":
      // Satellite klaxon fan-out (owner 2026-10-03). Idempotent: never
      // overwrite a live alarm, never resurrect a cleared one.
      if (!target.raidAlarm) {
        target.raidAlarm = JSON.parse(JSON.stringify(fx.alarm));
      }
      break;
  }
}

/** Target-side applier: depart-alliance. Runs on the departing colony's
 *  account — releases their rally pledges (local locks + canonical unpledge
 *  fx), cancels rallies they called, recalls their reinforcements, and drops
 *  their local alliance/rally mirrors. Idempotent on the fx key. */
export function applyDepartAlliance(
  target: GameState,
  allianceId: string,
  colonyId: string,
  key: string,
): void {
  if (fxDone(target, key)) return;
  markFxDone(target, key);
  const a = allianceOf(target, colonyId);
  const members = a && a.id === allianceId ? a.members.map((m) => m.colonyId) : [];
  departRalliesFor(target, colonyId, allianceId, members);
  leaveAllianceLocal(target, colonyId);
  removeAllianceMirror(target, allianceId);
}

/**
 * Drain every queued AllianceFx across all of an account's games and apply
 * each to its target colony via transactColony (scope-held targets resolve
 * in-memory; foreign targets go through the seam). Failed-transient fx are
 * re-queued onto their origin game and parked for the rest of this call —
 * they stay in the outbox for a later request, never silently dropped.
 * Dead-target fx are dropped with a log line.
 */
export async function applyAllianceFx(
  saves: AccountSaves,
  opts: DrainOpts = {},
): Promise<{ applied: number; requeued: number; dropped: number }> {
  const store = opts.store ?? defaultStore;
  const depth = opts.depth ?? 0;
  const requeueOnTransient = opts.requeueOnTransient ?? true;
  const now = Date.now();
  let applied = 0;
  let requeued = 0;
  let dropped = 0;
  // Fx that failed transiently in this drain: don't hot-retry them in later
  // passes — a later request picks them up once the target account frees.
  const parked = new Set<string>();

  // Bounded multi-pass: appliers can queue chained fx onto these same saves
  // (e.g. a casualty bill queues a mirror-shrink back to the host). Passes
  // keep delivering until the outbox is quiet.
  for (let pass = 0; pass < 3; pass++) {
    let any = false;
    for (const gameId of Object.keys(saves.games)) {
      const origin = saves.games[gameId];
      const drained = drainAllianceFx(origin);
      if (!Array.isArray(origin.allianceFx)) origin.allianceFx = [];
      const fxs: AllianceFx[] = [];
      for (const fx of drained) {
        // Parked fx were already re-queued by an earlier pass of THIS drain:
        // put them straight back. Filtering them out after the drain would
        // silently delete them.
        if (parked.has(fxIdentity(fx))) origin.allianceFx.push(fx);
        else fxs.push(fx);
      }
      if (fxs.length > 0) any = true;
      for (const fx of fxs) {
        try {
          await transactColony(
            fx.colonyId,
            (target) => {
              applyOneFx(target, fx, now);
            },
            { depth, store, lockTimeoutMs: opts.lockTimeoutMs },
          );
          applied += 1;
        } catch (e) {
          if (e instanceof ColonyNotFoundError) {
            dropped += 1;
            logLine(
              saves,
              `An alliance effect fizzled — the target colony is gone (${fx.kind}).`,
            );
          } else if (isTransient(e) && requeueOnTransient) {
            // Back onto its origin game — a later request retries it.
            origin.allianceFx.push(fx);
            parked.add(fxIdentity(fx));
            requeued += 1;
          } else {
            dropped += 1;
            logLine(
              saves,
              `An alliance effect failed (${fx.kind}): ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }
    }
    if (!any) break;
  }
  return { applied, requeued, dropped };
}
