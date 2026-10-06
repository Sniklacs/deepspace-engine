// Server functions: the "game server" API. These run server-side inside the
// TanStack Start server, persist to disk via store.ts, and are called from the
// browser client. Together they form the persistent game backend.
//
// Multi-account: every call carries a session token; the handler resolves it to
// an account and reads/writes ONLY that account's save file. A missing/invalid
// token returns { signedOut: true } and touches nothing.
//
// Multi-game: each account holds up to MAX_GAMES colonies (one race + one colony
// per game) in a single versioned save file. One is the "active" game shown in
// the client; getState / the action endpoints operate on that active game, and
// the Games modal creates / switches / resets / deletes games.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AccountSaves } from "./store";
import type {
  DomainId,
  FeedbackCategory,
  FeedbackRecord,
  FeedbackSeverity,
  GameState,
  RaceId,
} from "./types";
import type { ForgeItem } from "./forge";
import { RACES } from "./races";
import { ZONES } from "./zones";
import * as engine from "./engine";
import { worldRaceError, WORLD_CONFIG } from "./world-config";
import { snapshotHero } from "./prologue/act1-battle";
import {
  MONETIZATION_CONFIG,
  walletView,
  purchaseWithVotives,
  createPaymentProvider,
} from "./monetization";
import { isSellable, xsollaCatalogRow, xsollaReturnUrlFor } from "./payments/xsolla-catalog";
import { dailyPublicView } from "./daily";
import { timeTokensPublicView } from "./time-tokens";
import {
  appendReportOnce,
  attachBattlePlan,
  battleEndAt,
  battlePublicView,
  issueDecision,
  logBattleResolved,
  respondToAid,
  screenVector,
} from "./war/battle-engine";
import {
  commitRosterWeight,
  rosterForCommit,
  settleToll,
  sideHomeFor,
  stampRosterSegment,
} from "./war/roster-commit";
import { availableWeight, releaseWeight } from "./war/troops";
import { validateHiveMove, applyHiveMove } from "./hive-relocation";
import type { BattlePlan } from "./war/maneuvers";
import type { PlannedManeuver } from "./war/maneuvers";
import {
  acceptArenaChallenge,
  arenaBoutsOf,
  arenaSeason,
  buildLadderEntries,
  cancelArenaChallenge,
  challengeArena,
  declineArenaChallenge,
  ensureArena,
  type ArenaBout,
  type ArenaForceInput,
} from "./war/arena";
import {
  acceptMembership,
  allianceById,
  allianceOf,
  applyToAlliance,
  createAlliance,
  declineMembership,
  demoteMember,
  disbandAlliance,
  giveHelp,
  inviteToAlliance,
  kickMember,
  leaveAllianceLocal,
  promoteMember,
  queueAllianceFx,
  removeAllianceMemberRecord,
  removeAllianceMirror,
  setTitheRate,
  transferLeadership,
  unlockRallyHeroes,
} from "./war/alliances";
import {
  contributeAllianceShip,
  donateToShipyard,
  ensurePersonalShipyard,
  orderAllianceShip,
  payShipCost,
  shipCostBlocker,
  shipNeedsAlliance,
} from "./shipyard";
import {
  addRemotePledge,
  cancelRally,
  createRally,
  departRalliesFor,
  launchRally,
  lockPledgeLocal,
  rallyAudience,
  rallyOf,
  removeRemotePledge,
  setRallyPlan,
  unpledgeLocal,
} from "./war/rallies";
import {
  dismissReinforcement,
  recallReinforcement,
  sendReinforcement,
} from "./war/alliances";
import { ACT1_CONFIG, openAct1Front } from "./prologue/act1-battle";
import { prologueState } from "./prologue/prologue-engine";
// Chat + mail, slice A1: the server functions live in their own module (the same
// zod-validated shape as the feedback channel's), so the chat surface cannot grow
// inside this file, and `chat-tests` can reach the rules without a 1000-line import.
import { worldFeedFn, sendWorldFn, chatSyncFn } from "./chat/chat-api";
import type { Battle, BattleHeroSnapshot, BattleSide, ManeuverVector } from "./war/war-types";
import {
  enqueueMuster,
  hireBand,
  hireCost,
  homeGarrisonCap,
  isTroopTier,
  isTroopType,
  musterCost,
  tierUnlocked,
} from "./war/troops";
import {
  hireBandAtBase,
  musterAtBase,
  plantForwardBase,
} from "./war/forward-bases";
import {
  loadAccountSaves,
  saveAccountSaves,
  loadAllSaves,
  removeAccountSave,
  deleteAccountRecord,
  emptySaves,
  MAX_GAMES,
  loadAccounts,
  saveAccounts,
  loadFeedback,
  saveFeedback,
  deleteChatByAccount,
} from "./store";
import {
  accountForToken,
  normalizeUsername,
  signup as authSignup,
  login as authLogin,
  logout as authLogout,
  verifyPassword as authVerifyPassword,
  revokeAllSessions,
} from "./auth";
import {
  AccountBusyError,
  ColonyNotFoundError,
  commitOutbox,
  runWithAccountSaves,
  scanAllianceDirectory,
  transactColony,
  withAccountLock,
} from "./alliance-transact";
import type { AllianceDirectoryEntry } from "./alliance-transact";
import { sendMail } from "./mailbox";

/** Lightweight summary of a game — never full state. */
export interface GameSummary {
  gameId: string;
  name: string;
  race: RaceId | null;
  createdAt: number;
  summary: string;
  activeContent: boolean; // has in-flight expeditions/studies → extra reset guard
}

export interface GameResult {
  ok: boolean;
  signedOut?: boolean;
  error?: string;
  /**
   * Catalogue key for `error` when the refusal has player-facing wording — the
   * client renders it in the player's own language (`t(errorKey)`), and falls
   * back to the plain `error` text when there is none. Set by the engine.
   */
  errorKey?: string;
  state?: GameState;
  games?: GameSummary[];
  activeGameId?: string | null;
}

function summaryOf(st: GameState): GameSummary | null {
  if (!st.race || !st.gameId) return null;
  const domains = Object.values(st.deployedDomains).reduce((a, b) => a + b, 0);
  const activeContent =
    st.expeditions.some((e) => e.status === "out") ||
    st.studies.some((s) => s.status === "studying");
  const summary =
    `${domains} deployed AI · ${st.completedExpeditions} exploration${st.completedExpeditions === 1 ? "" : "s"} · ` +
    `${Math.floor(st.resources.embers)} embers · ${Math.floor(st.resources.supplies)} supplies`;
  return { gameId: st.gameId, name: st.playerName, race: st.race, createdAt: st.createdAt, summary, activeContent };
}

function allSummaries(saves: AccountSaves): GameSummary[] {
  const out: GameSummary[] = [];
  for (const id in saves.games) {
    const sum = summaryOf(saves.games[id]);
    if (sum) out.push(sum);
  }
  return out;
}

// Silence discipline (hidden revelation track): the client NEVER receives raw
// counters. `revelations` ships ONLY as the visible set (resolved + currently
// available — i.e. exactly the glyphs the Lab may render); everything else
// (counters, hunt flag internals, choice-pending internals, reward fields,
// the first-open timestamp, the §8 acknowledgedOnce flag) stays server-side.
// Monetization discipline (V5): the client renders BALANCES and OWNED ITEMS
// (non-secret) but never the ledger entries or the internal idempotency set —
// the server owns the truth (§1.4). Exported so the verification harness can
// assert on a REAL getState payload shape (identical function the handlers use).
export function publicState(st: GameState): GameState {
  // V11 prologue spine: the player's OWN story (stage, sealed height records,
  // squad, final stand, History Book + ash echoes) ships whole — nothing here
  // is server-secret, so the block rides `rest` into the payload untouched.
  const { revelationCounters: _rc, revelationChoice: _rch, revelationFirstOpenAt: _rfo, revelationCorruptionGainMult: _rcm, revelationDrainPerMin: _rdp, revelationChorusMult: _rm, revelationsResolved: _rr, acknowledgedOnce: _ao, currency: _cur, entitlements: _ent, battlePass: _bp, daily: _daily, warReserve: _wr, timeTokenLedger: _ttl, allianceFx: _afx, allianceFxDone: _afxd, ...rest } = st;
  void _rc; void _rch; void _rfo; void _rcm; void _rdp; void _rm; void _rr; void _ao; void _cur; void _ent; void _bp; void _daily; void _wr; void _ttl; void _afx; void _afxd;
  const vis = new Set(engine.visibleRevelations(st));
  const w = walletView(st);
  return {
    ...(rest as GameState),
    revelations: (st.revelations ?? []).filter((id) => vis.has(id)),
    revelationsResolved: (st.revelationsResolved ?? []).filter((id) => vis.has(id)),
    revelationAnswered: st.revelationChoice === "sealed" || st.revelationChoice === "open",
    revelationHunts: false,
    // The public wallet view omits the internal ledger/idempotency fields by
    // design (§1.4: client renders balances; server owns the truth).
    currency: w.currency as unknown as GameState["currency"],
    entitlements: w.entitlements as unknown as GameState["entitlements"],
    battlePass: w.battlePass as unknown as GameState["battlePass"],
    // V7 daily view (TD5): the client sees the day's list + check-off truth +
    // bonus flag only. `events` (raw dedupe), `rolledAt`, `lastStreakDay` and
    // the TD3 `banked` map stay server-side; favor internals/Oracle thresholds
    // never exist on this surface at all. Devotion total + streak ride along
    // in `rest` (PUBLIC per TD5).
    daily: dailyPublicView(st.daily),
    // TIME TOKENS (owner direction 2026-09-27): the player's own HOLDINGS ship
    // (like a balance — they are the player's possessions and the Cradle Ledger
    // renders them), mapped to the two earned sizes at a non-negative integer.
    // The LEDGER does not: it is the server's append-only idempotency record
    // (which request ids have been spent), exactly as `currency.ledger` is
    // stripped above. Nothing here is purchasable and no price exists anywhere.
    timeTokens: timeTokensPublicView(st.timeTokens),
    // V9 battle engine: every battle ships through the public-view mapper, so
    // server-only internals (war-types internal block; future reinforcement
    // queues etc.) never reach the client. The report LEDGER is public by
    // design (§15.6 — composition/duration/casualties are the History Book's
    // observable source material; the client renders its own battles).
    battles: (Array.isArray(st.battles) ? st.battles : []).map(battlePublicView),
    // V11 prologue spine: the player's own story ledger — ships whole
    // (stage/leaders/heroes/squad/finalStand/historyBook/echoes). No field is
    // server-secret; defensive copy so callers can't mutate server state.
    prologue: st.prologue ? JSON.parse(JSON.stringify(st.prologue)) : st.prologue,
    // B12/B11 reserve view: the observable numbers (energy + the co-op
    // recognition ledger). Troop affordability is NEVER a reserve field —
    // the client reads the real muster roster (state.troops) via
    // availableWeight. `lockedHeroes` (commitment bookkeeping) stays
    // server-side — the battle decisions render the visible side of it.
    warReserve: {
      energy: Math.max(0, Math.trunc(st.warReserve?.energy) || 0),
      cycleId: st.warReserve?.cycleId ?? null,
      aidCredits: Math.max(0, Math.trunc(st.warReserve?.aidCredits) || 0),
      lockedHeroes: {},
    } as GameState["warReserve"],
  };
}

// ------- Contribution leaderboard (recognition goes public) -------
// The world leaderboard: every colony's contribution score + rank (precursor to
// the Server Contribution Award / Emissary leadership seats). The score is
// PUBLIC BY DESIGN (a recognition metric) — but it is computed server-side from
// the SAME engine.contributionScore() formula and ships NO stripped fields:
// acknowledgedOnce and every revelation counter are never read or referenced by
// this surface (see contributionPublicView below — the only public shape).

/** One leaderboard row — rank, colony identity, and the score. Nothing else. */
export interface ContributionRow {
  rank: number;
  colonyName: string;
  race: RaceId | null;
  score: number;
  /** Cradle level = the five deployed-domain levels summed (public colony state). */
  cradleLevel: number;
  /** The score's four components — how the dent was made. */
  expeditions: number;
  deeds: number;
  codices: number;
  techs: number;
  /** Colony founding timestamp (already used as the ranking tiebreak). */
  foundedAt: number;
}
/** The calling colony's standing + the world's top-N. */
export interface ContributionView {
  me: { rank: number; colonyName: string; score: number; total: number } | null;
  leaders: ContributionRow[];
  total: number;
}
export const CONTRIBUTION_LEADERBOARD_TOP_N = 10;

/**
 * Pure builder for the public contribution payload — the SINGLE function the
 * handler uses, exported so the verification harness can assert the exact shape
 * the client receives (identical function getContributionFn runs). Reads NOTHING
 * but public colony fields; by construction the payload can never contain
 * acknowledgedOnce, revelation counters, or any other stripped field.
 */
export function contributionPublicView(own: GameState | null, all: GameState[]): ContributionView {
  // Own colony must always be representable, even if it wasn't in `all`.
  const states = all.slice();
  if (own && own.race && own.gameId && !states.some((s) => s.gameId === own.gameId)) {
    states.push(own);
  }
  const entries = engine.contributionRanking(states);
  const leaders = entries
    .slice(0, CONTRIBUTION_LEADERBOARD_TOP_N)
    .map((e, i) => ({
      rank: i + 1,
      colonyName: e.colonyName,
      race: e.race,
      score: e.score,
      cradleLevel: e.cradleLevel,
      expeditions: e.expeditions,
      deeds: e.deeds,
      codices: e.codices,
      techs: e.techs,
      foundedAt: e.createdAt,
    }));
  const me =
    own && own.race && own.gameId
      ? (() => {
          const idx = entries.findIndex((e) => e.gameId === own.gameId);
          if (idx < 0) return null;
          const e = entries[idx];
          return { rank: idx + 1, colonyName: e.colonyName, score: e.score, total: entries.length };
        })()
      : null;
  return { me, leaders, total: entries.length };
}

/** Every colony on this world, each scored at `now` (advance on a throwaway
 *  clone — nothing is persisted, so the leaderboard read is offline-safe and
 *  side-effect free; stuck colonies are skipped, never fatal). */
async function worldColoniesAt(now: number): Promise<GameState[]> {
  const out: GameState[] = [];
  for (const { saves } of await loadAllSaves()) {
    for (const gid in saves.games) {
      const g = saves.games[gid];
      if (!g || typeof g !== "object" || !g.race || !g.gameId) continue; // blank reset slots aren't colonies
      try {
        const clone = JSON.parse(JSON.stringify(g)) as GameState;
        out.push(engine.advance(clone, now));
      } catch (e) {
        console.error("Failed to score colony for leaderboard:", gid, e);
      }
    }
  }
  return out;
}

// Own score + rank + the world's top-10 contribution leaderboard.
const getContributionFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string().optional() })
).handler(async ({ data }): Promise<{ ok: boolean; signedOut?: boolean; error?: string } & Partial<ContributionView>> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const now = Date.now();
  const colonies = await worldColoniesAt(now);
  let own: GameState | null = null;
  const saves = await loadAccountSaves(accountId);
  if (saves && saves.activeGameId && saves.games[saves.activeGameId]) {
    const g = saves.games[saves.activeGameId];
    if (g && g.race && g.gameId) {
      try {
        own = engine.advance(JSON.parse(JSON.stringify(g)) as GameState, now);
      } catch (e) {
        console.error("Failed to score own colony for leaderboard:", e);
        own = g; // fall back to the raw state — score() only reads monotonic fields
      }
    }
  }
  return { ok: true, ...contributionPublicView(own, colonies) };
});

// The account's currently-active game, advanced to "now" (offline progress).
async function loadActiveState(accountId: string): Promise<GameState | null> {
  const saves = await loadAccountSaves(accountId);
  if (!saves) return null;
  if (!saves.activeGameId || !saves.games[saves.activeGameId]) return null;
  return engine.advance(saves.games[saves.activeGameId], Date.now());
}

// Write a mutated active game back into the account's multi-game save file.
// Returns true if the save persisted, false if it failed (caller must surface
// the failure — a silent drop is the "badge appears then vanishes" bug).
async function saveActiveState(accountId: string, updated: GameState): Promise<boolean> {
  const saves = await loadAccountSaves(accountId);
  if (!saves || !updated.gameId) {
    console.error(`saveActiveState: cannot save — ${!saves ? "no saves found" : "missing gameId"} for account ${accountId}`);
    return false;
  }
  saves.games[updated.gameId] = updated;
  return await saveAccountSaves(accountId, saves);
}

// Cross-server: deliver pending raid battle results to defender servers.
// Called after engine.advance() resolves battles. Each raid with
// resultPendingDelivery gets POSTed to the defender's /api/raid-result,
// then the flag is cleared and the state re-saved.
async function flushRaidResultDeliveries(
  accountId: string,
  state: import("./types").GameState,
): Promise<void> {
  const wm = state.worldMap;
  if (!wm?.raids) return;
  const pending = wm.raids.filter((r: any) => r.resultPendingDelivery && r.targetServerId);
  if (pending.length === 0) return;
  const { deliverRaidResult } = await import("./raid-delivery");
  const { WORLD_CONFIG } = await import("./world-config");
  let dirty = false;
  for (const raid of pending as any[]) {
    const attackerLosses = raid.attackerLosses
      ? Object.values(raid.attackerLosses as Record<string, number>).reduce((a: number, b: number) => a + (b ?? 0), 0)
      : 0;
    await deliverRaidResult(raid.targetServerId, {
      raidId: raid.id,
      attackerWorldId: WORLD_CONFIG.worldId,
      attackerNames: [...(raid.memberNames ?? [])],
      targetColonyId: raid.targetColonyId,
      won: raid.won ?? false,
      attackerLosses,
      defenderLosses: raid.defenderLosses ?? 0,
      lootTaken: raid.lootTaken ?? {},
      resolvedAt: Date.now(),
    }).catch((e) => console.warn("[flushRaid] result delivery failed:", e?.message || e));
    raid.resultPendingDelivery = false;
    dirty = true;
  }
  if (dirty) {
    const saved = await saveActiveState(accountId, state);
    if (!saved) console.error("[flushRaid] Failed to persist raid result delivery state");
  }
}

// Get state for the signed-in account: the ACTIVE game's state (advanced), or,
// when there is no active game, the games list. Callers use games to render the
// colony picker / Games modal.
const getState = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string().optional() })
).handler(async ({ data }): Promise<GameResult & { username?: string; showFirstRunNotice?: boolean }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = await loadAccountSaves(accountId);
  // First-Run nudge: owed until the player dismisses it (persisted per account).
  const accounts = await loadAccounts();
  const showFirstRunNotice = !(accounts[accountId]?.noticeDismissed === true);
  if (!saves) return { ok: true, username: accountId, games: [], activeGameId: null, showFirstRunNotice };
  const active = saves.activeGameId && saves.games[saves.activeGameId]
    ? engine.advance(saves.games[saves.activeGameId], Date.now())
    : null;
  // Cross-server: deliver any raid battle results that resolved during advance.
  // flushRaidResultDeliveries saves the state if it delivered anything.
  if (active) {
    await flushRaidResultDeliveries(accountId, active).catch((e) =>
      console.warn("[getState] raid delivery flush failed:", e?.message || e),
    );
  }
  return { ok: true, username: accountId, state: active ? publicState(active) : undefined, games: allSummaries(saves), activeGameId: saves.activeGameId, showFirstRunNotice };
});

// Create a new colony/game, set it active, and return its state.
const createGameFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    name: z.string().trim().min(1, "A Cradle needs a name before it can be founded.").max(40),
    race: z.string(),
  })
).handler(async ({ data }): Promise<GameResult & { username?: string }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const id = data.race as RaceId;
  if (!RACES.some((r) => r.id === id)) return { ok: false, error: "Unknown race." };
  // THE world's race lock — authoritative, server-side, read from the world
  // config. Rejects before ANY save write, so a client that (incorrectly)
  // offers another race simply gets a user-readable refusal. Existing colonies
  // of other races are beta artifacts and are deliberately left playable — the
  // lock governs NEW colony creation only.
  const worldErr = worldRaceError(id);
  if (worldErr) return { ok: false, error: worldErr };
  const saves = (await loadAccountSaves(accountId)) ?? emptySaves();

  // If the account holds a PENDING colony slot (a Reset wiped it back to the
  // race-selection screen, race is null), re-init THAT same slot with the new
  // race + name rather than consuming a fresh MAX_GAMES slot.
  const pending = saves.activeGameId && saves.games[saves.activeGameId] && !saves.games[saves.activeGameId].race
    ? saves.games[saves.activeGameId]
    : Object.values(saves.games).find((g) => !g.race) || null;
  if (pending) {
    const now = Date.now();
    const fresh = engine.newGame(data.name, id, now);
    fresh.gameId = pending.gameId;
    saves.games[pending.gameId!] = fresh;
    saves.activeGameId = pending.gameId!;
    await saveAccountSaves(accountId, saves);
    return { ok: true, state: publicState(fresh), activeGameId: pending.gameId, username: accountId };
  }

  // The Fall's slot is the story's own seat, not a colony — it never consumes
  // one of the account's colony slots.
  const colonySlots = Object.keys(saves.games).filter((id) => id !== ACT1_CONFIG.gameId).length;
  if (colonySlots >= MAX_GAMES) {
    return { ok: false, error: `Each account can hold up to ${MAX_GAMES} colonies. Delete one to found another.` };
  }
  const now = Date.now();
  const gameId = "g" + now.toString(36) + Math.random().toString(36).slice(2, 6);
  const st = engine.newGame(data.name, id, now);
  st.gameId = gameId;
  saves.games[gameId] = st;
  saves.activeGameId = gameId;
  await saveAccountSaves(accountId, saves);
  return { ok: true, state: publicState(st), activeGameId: gameId, username: accountId };
});

// List game summaries only (never full state).
const listGamesFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<{ ok: boolean; signedOut?: boolean; games?: GameSummary[]; activeGameId?: string | null }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true };
  const saves = await loadAccountSaves(accountId);
  if (!saves) return { ok: true, games: [], activeGameId: null };
  const now = Date.now();
  for (const id in saves.games) saves.games[id] = engine.advance(saves.games[id], now);
  return { ok: true, games: allSummaries(saves), activeGameId: saves.activeGameId };
});

// Set which game is active and return that game's (advanced) state.
const switchGameFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), gameId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = await loadAccountSaves(accountId);
  if (!saves || !saves.games[data.gameId]) return { ok: false, error: "Colony not found." };
  saves.activeGameId = data.gameId;
  await saveAccountSaves(accountId, saves);
  const st = engine.advance(saves.games[data.gameId], Date.now());
  return { ok: true, state: publicState(st), activeGameId: data.gameId };
});

// Wipe a game's progress and return the player ALL THE WAY back to race
// selection, so they pick a NEW race AND name for that game slot (owner change —
// not the old "same race + name fresh colony"). The slot is blanked (race null)
// and kept active; createGameFn re-inits it with the new choice.
const resetGameFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), gameId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = await loadAccountSaves(accountId);
  if (!saves || !saves.games[data.gameId]) return { ok: false, error: "Colony not found." };
  const blank = engine.blankColony(Date.now());
  blank.gameId = data.gameId;
  saves.games[data.gameId] = blank;
  saves.activeGameId = data.gameId;
  await saveAccountSaves(accountId, saves);
  return { ok: true, state: publicState(blank), activeGameId: data.gameId };
});

// Delete a game. Cannot delete the last game (that requires trashing the
// whole account). If the deleted game was active, the newest remaining one
// becomes active.
const deleteGameFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), gameId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = await loadAccountSaves(accountId);
  if (!saves || !saves.games[data.gameId]) return { ok: false, error: "Colony not found." };
  const remaining = Object.keys(saves.games).filter((id) => id !== data.gameId);
  if (remaining.length === 0) {
    return { ok: false, error: "This is your only colony. Delete the entire account (Account section) instead." };
  }
  delete saves.games[data.gameId];
  if (saves.activeGameId === data.gameId) {
    let next: string | null = null;
    let maxCreated = -1;
    for (const id of remaining) {
      const t = saves.games[id].createdAt || 0;
      if (t > maxCreated) { maxCreated = t; next = id; }
    }
    saves.activeGameId = next;
  }
  await saveAccountSaves(accountId, saves);
  const active = saves.activeGameId ? engine.advance(saves.games[saves.activeGameId], Date.now()) : null;
  return { ok: true, state: active ? publicState(active) : undefined, activeGameId: saves.activeGameId };
});

// Permanently delete EVERYTHING: all saves + the account record + all sessions.
// Requires the username to match the token's account AND the password to match
// the stored hash (server-verified). Response always signs the client out.
const trashAccountFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), username: z.string(), password: z.string() })
).handler(async ({ data }): Promise<{ ok: boolean; signedOut?: boolean; error?: string }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  if (normalizeUsername(data.username) !== accountId) {
    return { ok: false, error: "That username does not match this account." };
  }
  if (!(await authVerifyPassword(accountId, data.password))) {
    return { ok: false, error: "Incorrect password. Nothing was deleted." };
  }
  await removeAccountSave(accountId);
  await deleteAccountRecord(accountId);
  // D13: the account's chat and mail go with it — messages HARD-DELETED and its
  // threads CLOSED, so the other participant keeps the thread and their own lines.
  // Nothing of the deleted colony's voice survives anywhere on the world.
  await deleteChatByAccount(accountId);
  await revokeAllSessions(accountId);
  return { ok: true, signedOut: true };
});

const launchFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), zoneId: z.string(), scientists: z.number().int().min(1).max(99) })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  if (!ZONES.some((z) => z.id === data.zoneId)) return { ok: false, error: "Unknown destination.", state: publicState(st) };
  const res = engine.launchExpedition(st, data.zoneId, data.scientists, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// Tactical battle rounds (owner 2026-10-03): the player issues orders for one
// round of the live tactical battle. The defender is driven by the AI.
const tacticalRoundFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    raidId: z.string(),
    orders: z.record(z.string(), z.object({
      order: z.string(),
      target: z.string().optional(),
      count: z.number().optional(),
      orbitalStrike: z.string().optional(),
    })),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.tacticalRaidRound(st, data.raidId, data.orders, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// Quick-resolve a tactical battle (owner 2026-10-03): auto-play the remaining
// rounds. For commanders who can't stay for the whole fight.
const quickResolveTacticalFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    raidId: z.string(),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.quickResolveTacticalRaid(st, data.raidId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// SUB COLONY MUSTER (owner 2026-10-03): build troops at an active sub colony —
// troops only, owner's research level, 2x build speed.
const musterSubColonyTroopsFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), key: z.string(), type: z.string(), count: z.number().int().positive().max(2000) })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.musterSubColonyTroops(st, data.key, data.type, data.count, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const studyFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), kind: z.enum(["ember", "chipset"]) })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.beginStudy(st, data.kind, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const deployFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), domain: z.enum(["weaponry", "agriculture", "economy", "industry", "logistics"]) })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.deployProgram(st, data.domain as DomainId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, errorKey: res.errorKey, state: res.state ? publicState(res.state) : undefined };
});

const purifyFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), spend: z.number().int().min(1) })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.discipline(st, data.spend, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// V7 Daily Devotion: the ONE claim button (TD3 — rewards bank forever,
// idempotent through the currency ledger's event ids). The engine grants
// Scrip (the FIRST LIVE SCRIP FAUCET — earned-only, never Votives) + Devotion
// for every completed-but-unclaimed item (today's and banked days'), plus the
// +80/+3 list-completion bonus. loadActiveState advances first, so the day's
// rolled list is current when claim resolves.
const claimDailyRewardFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<GameResult & { granted?: { scrip: number; devotion: number; bonus: boolean; supplies: number; timeTokens: Record<string, number> } }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.claimDaily(st, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined, granted: res.granted };
});

// TIME TOKENS — the EARNED path's spend door (owner direction 2026-09-27).
// Earned only: a token comes from the daily Devotion (claimDailyRewardFn) and
// from nowhere else — there is no purchase path, no price, no product, and
// `storefrontEnabled` stays false. `requestId` is the caller's own idempotency
// key: a retried POST returns `idempotent: true` and takes nothing more off the
// timer. A refusal carries `errorKey`, rendered in the player's own language.
// (The timers this may touch: an armory build, Lab research, a domain deploy.
// An EXPLORATION RUN is refused by name — the ladder's timers are its price.)
const applyTimeTokenFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    sizeId: z.enum(["1m", "5m"]),
    requestId: z.string(),
    kind: z.enum(["armory_build", "research", "domain_deploy", "expedition"]),
    id: z.string().optional(),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.applyTimeToken(st, data.sizeId, data.requestId, { kind: data.kind, id: data.id }, Date.now());
  if (res.ok && !res.idempotent) {
    const saved = await saveActiveState(accountId, st);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return {
    ok: res.ok,
    error: res.error,
    errorKey: res.errorKey,
    state: publicState(st),
  };
});

// Workshop: craft gear — everyday (Tier 0), fuel/logistics (Tier 1), radiation
// gear + forged alloy (Tier 2). `count` is the BULK door (owner 2026-09-30: the
// workshop's one-at-a-time dialog was redundant and annoying): the handler
// loops `craftItemBatch` so one tap forges up to `count`, stopping at the first
// failure (supplies run dry, alloy recipe incomplete) and reporting how many
// actually landed.
const craftFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), kind: z.enum(["medkit", "mechkit", "armorkit", "skmech", "gas", "battery", "hazmat", "shots", "alloy"]), count: z.number().int().min(1).max(99).optional().default(1) })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.craftItemBatch(st, data.kind, data.count ?? 1, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// V6 Armory: build/upgrade a weapon family at the Cradle — EARN-ONLY, and that
// claim OUTLIVED the owner's sell-side ruling of 2026-09-27: the engine deducts
// supplies/embers/fuel/plasma and opens a real-time build, and no purchase path
// grants war hardware. What the store sells now is TIME and nothing else
// (`TIME_TOKEN_PACKS`, monetization.ts) — and the storefront is still switched off,
// which is why every handler below is gated on `storefrontEnabled`.
const weaponBuildFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), familyId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.startWeaponBuild(st, data.familyId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});
// V6 Lab: condense 25 embers → 1 plasma (research-gated, deterministic, earn-only).
const refinePlasmaFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.refinePlasma(st, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});
// THE FORGE (owner 2026-09-26) — the roll is made and COMMITTED here, on the
// server, in the same operation that consumes the ingredients, and the resulting
// state is persisted before the response leaves. The request carries a recipe id
// and a request id and NOTHING else: no stats, no grade, no seed, no power — so
// the client cannot pick its own outcome, and `requestId` makes a retried
// double-submit a replay of the first result instead of a second roll.
const forgeRollFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), recipeId: z.string(), requestId: z.string() })
).handler(async ({ data }): Promise<GameResult & { item?: ForgeItem; replay?: boolean }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.forgeRoll(st, data.recipeId, data.requestId, accountId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return {
    ok: res.ok,
    error: res.error,
    replay: res.replay,
    item: res.item ? JSON.parse(JSON.stringify(res.item)) : undefined,
    state: res.state ? publicState(res.state) : undefined,
  };
});
// THE FORGE's junk valve: melt a piece back into a fraction of its ingredients.
const forgeMeltFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), itemId: z.string() })
).handler(async ({ data }): Promise<GameResult & { refund?: { warplate: number; supplies: number } }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.meltForgeItem(st, data.itemId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, refund: res.refund, state: res.state ? publicState(res.state) : undefined };
});
// LOADOUT — dress a hero/leader: equip a forged piece into a slot (swap is
// atomic; the displaced piece returns to the racks), or take one off.
// Server-authoritative: the UI never invents equipped state.
const loadoutBearerSchema = z.object({ kind: z.enum(["hero", "leader"]), id: z.string() });
const equipForgeItemFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), itemId: z.string(), bearer: loadoutBearerSchema, slot: z.enum(["weapon", "armor", "module1", "module2", "relic"]) })
).handler(async ({ data }): Promise<GameResult & { swappedId?: string }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.equipForgeItem(st, data.itemId, data.bearer, data.slot, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, swappedId: res.swappedId, state: res.state ? publicState(res.state) : undefined };
});
const unequipForgeItemFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), itemId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.unequipForgeItem(st, data.itemId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});
// Research tree: appoint a Leader to research a tech (costs Codices + time).
const beginResearchFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), techId: z.string(), leaderId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.beginResearch(st, data.techId, data.leaderId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// The hidden glimpse decision (rv3 payoff): one choice per game — "seal the
// Record in bone" vs "leave it open". The client offers this exactly once,
// when the resolved rv3 sits unanswered (see play.tsx).
const chooseRevelationFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), choice: z.enum(["sealed", "open"]) })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.chooseRevelation(st, data.choice, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// Scout probes: build (supplies), launch at a server, collect the report.
const buildProbeFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.buildScoutProbe(st, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const launchProbeFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), serverId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.launchScoutProbe(st, data.serverId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const collectProbeFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), probeId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.collectScoutProbe(st, data.probeId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// Sub colonies: claim a husk (planet-locked, 24h setup).
const claimHuskFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), key: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.claimHusk(st, data.key, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// Sub colonies: ship a 1,000-supply upkeep shipment (owner 2026-10-03).
const shipSubColonySuppliesFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), key: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.shipSubColonySupplies(st, data.key, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// SHIP FACTORY (owner 2026-10-03): Hans's shipyard with donations + tithe.
// Warships are ordered on the alliance factory. Scouts are solo-built.
// Donations (manual) + tithe (auto % of raid/glean loot) fund the stockpile.
const SHIP_CLASS_VALUES = ["scout", "frigate", "bulwark", "vanguard", "fatcat", "herald"] as const;

const orderShipFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), allianceId: z.string(), shipClass: z.enum(SHIP_CLASS_VALUES) })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) => {
    const blocker = shipCostBlocker(st, data.shipClass);
    if (blocker) {
      const label = blocker.kind === "supplies" ? "supplies" : blocker.kind === "alloys" ? "alloys" : "race material";
      return { ok: false, error: `Need ${blocker.need.toLocaleString()} ${label} — you have ${blocker.have.toLocaleString()}.` };
    }
    // Solo scout: personal shipyard, no alliance needed.
    if (!shipNeedsAlliance(data.shipClass)) {
      const wm = st.worldMap ?? (st.worldMap = {} as unknown as typeof st.worldMap);
      const psy = ensurePersonalShipyard(wm as unknown as { shipyard?: import("./shipyard").PersonalShipyard });
      payShipCost(st, data.shipClass);
      const { createShipBuild, recalcBuildDoneAt } = await import("./shipyard");
      const build = createShipBuild(data.shipClass, (st.race ?? "draconians") as import("./types").RaceId, ctx.colonyId, ctx.colonyName, 0, 1, ctx.now);
      recalcBuildDoneAt(build, 1, ctx.now);
      psy.queue.push(build);
      return { ok: true, value: build.id };
    }
    // Warship: alliance factory.
    const a = allianceOf(st, ctx.colonyId);
    if (!a || a.id !== data.allianceId) {
      return { ok: false, error: "Join a war band first — warships are built at the alliance factory." };
    }
    payShipCost(st, data.shipClass);
    const r = orderAllianceShip(a as unknown as import("./shipyard").ShipyardAlliance, {
      shipClass: data.shipClass,
      raceId: (st.race ?? "draconians") as import("./types").RaceId,
      orderedBy: ctx.colonyId,
      orderedByName: ctx.colonyName,
      now: ctx.now,
    });
    if (!r.ok) return { ok: false, error: r.error ?? "Couldn't order that ship." };
    const { touchAlliance, syncAllianceTo } = await import("./war/alliances");
    touchAlliance(a);
    syncAllianceTo(st, a);
    return { ok: true, value: r.build?.id };
  }),
);

const contributeShipFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), allianceId: z.string(), buildId: z.string() })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) => {
    const a = allianceOf(st, ctx.colonyId);
    if (!a || a.id !== data.allianceId) {
      return { ok: false, error: "Join a war band first — warships are built at the alliance factory." };
    }
    const r = contributeAllianceShip(a as unknown as import("./shipyard").ShipyardAlliance, data.buildId, ctx.colonyId, ctx.now);
    if (!r.ok) return { ok: false, error: r.error ?? "Couldn't join that crew." };
    const { touchAlliance, syncAllianceTo } = await import("./war/alliances");
    touchAlliance(a);
    syncAllianceTo(st, a);
    return { ok: true, value: "crewed" };
  }),
);

const donateShipyardFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), allianceId: z.string(), supplies: z.number().min(0), alloys: z.number().min(0), raceMats: z.number().min(0) })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) => {
    const a = allianceOf(st, ctx.colonyId);
    if (!a || a.id !== data.allianceId) {
      return { ok: false, error: "Join a war band first to donate to its shipyard." };
    }
    const haveSupplies = st.resources.supplies ?? 0;
    const haveAlloys = (st.resources as unknown as { alloys?: number }).alloys ?? 0;
    const race = st.race ?? "draconians";
    const haveMats = (st.resources.mats?.[race] ?? 0);
    if (data.supplies > haveSupplies) return { ok: false, error: `You only have ${haveSupplies.toLocaleString()} supplies.` };
    if (data.alloys > haveAlloys) return { ok: false, error: `You only have ${haveAlloys.toLocaleString()} alloys.` };
    if (data.raceMats > haveMats) return { ok: false, error: `You only have ${haveMats.toLocaleString()} race materials.` };
    // Deduct from player.
    st.resources.supplies = haveSupplies - data.supplies;
    (st.resources as unknown as { alloys?: number }).alloys = haveAlloys - data.alloys;
    if (st.resources.mats) st.resources.mats[race] = haveMats - data.raceMats;
    // Add to shipyard stockpile.
    const r = donateToShipyard(a as unknown as import("./shipyard").ShipyardAlliance, {
      supplies: data.supplies,
      alloys: data.alloys,
      raceMats: data.raceMats,
    });
    if (!r.ok) return { ok: false, error: r.error ?? "Donation failed." };
    const { touchAlliance, syncAllianceTo, logAllianceActivity } = await import("./war/alliances");
    const parts: string[] = [];
    if (data.supplies > 0) parts.push(`${data.supplies.toLocaleString()} supplies`);
    if (data.alloys > 0) parts.push(`${data.alloys.toLocaleString()} alloys`);
    if (data.raceMats > 0) parts.push(`${data.raceMats.toLocaleString()} race materials`);
    logAllianceActivity(a, "donated", `🎁 ${ctx.colonyName} donated ${parts.join(" + ") || "supplies"} to the ship factory.`, {
      byColonyId: ctx.colonyId,
      byColonyName: ctx.colonyName,
      at: ctx.now,
    });
    touchAlliance(a);
    syncAllianceTo(st, a);
    return { ok: true, value: "donated" };
  }),
);

const setTitheFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), allianceId: z.string(), rate: z.number().min(0).max(100) })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) => {
    const r = setTitheRate(st, data.allianceId, ctx.colonyId, data.rate);
    if (!r.ok) return { ok: false, error: r.error ?? "Couldn't set the tithe." };
    return { ok: true, value: `${Math.round(data.rate)}%` };
  }),
);

// Alliance: join policy (owner 2026-10-04) — open (free join) vs apply
// (officers review). Officer+.
const setJoinPolicyFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), allianceId: z.string(), policy: z.enum(["open", "apply"]) })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) => {
    const { setJoinPolicy } = await import("./war/alliances");
    const r = setJoinPolicy(st, data.allianceId, ctx.colonyId, data.policy);
    if (!r.ok) return { ok: false, error: r.error ?? "Couldn't set the join policy." };
    return { ok: true, value: data.policy };
  }),
);

// Mailbox: mark one message read (owner 2026-10-03).
const markMailReadFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), mailId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.markMailRead(st, data.mailId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// Mailbox: mark all messages read (owner 2026-10-03).
const markAllMailReadFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.markAllMailRead(st, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// Mailbox: delete a message (owner 2026-10-03).
const deleteMailFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), mailId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.deleteMailMsg(st, data.mailId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// Raids: form a party, target a colony, assign ships, load troops, launch.
const createRaidFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.createRaid(st, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const setRaidTargetFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), raidId: z.string(), key: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.setRaidTarget(st, data.raidId, data.key, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// Clear a preparing raid's target (owner 2026-10-04: a set target must be
// clearable/changeable — nothing dead-ends).
const clearRaidTargetFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), raidId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.clearRaidTarget(st, data.raidId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const assignRaidShipsFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), raidId: z.string(), shipIds: z.array(z.string()) })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.assignRaidShips(st, data.raidId, data.shipIds, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const loadRaidTroopsFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), raidId: z.string(), type: z.string(), count: z.number() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.loadRaidTroops(st, data.raidId, data.type as import("./war/troops").TroopType, data.count, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const loadRaidSuppliesFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), raidId: z.string(), amount: z.number() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.loadRaidSupplies(st, data.raidId, data.amount, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const launchRaidFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), raidId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.launchRaid(st, data.raidId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
    // Cross-server: warn the defender's server (owner 2026-10-03).
    // The raid record has the target; deliver async (don't block the launch).
    const wm = res.state.worldMap;
    const raid = wm?.raids.find((r: any) => r.id === data.raidId);
    if (raid && raid.targetServerId && raid.targetColonyId) {
      const { deliverRaidWarning } = await import("./raid-delivery");
      const { WORLD_CONFIG } = await import("./world-config");
      const { raidTroopCount } = await import("./raids");
      deliverRaidWarning(raid.targetServerId, {
        raidId: raid.id,
        attackerWorldId: WORLD_CONFIG.worldId,
        attackerWorldName: WORLD_CONFIG.worldName,
        attackerNames: [...raid.memberNames],
        targetColonyId: raid.targetColonyId,
        targetOwnerName: raid.targetOwnerName,
        shipCount: raid.shipIds.length,
        shipClasses: [...raid.shipClasses],
        troopCount: raidTroopCount(raid),
        landsAt: raid.landsAt ?? Date.now(),
        launchedAt: raid.departedAt ?? Date.now(),
      }).catch((e) => console.warn("[launchRaid] warning delivery failed:", e?.message || e));
    }
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// Tactical deployment (owner 2026-10-03): player assigns troops to entry
// vectors after touchdown. The battle resolves on the next tick.
const deployRaidFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    raidId: z.string(),
    deployment: z.record(z.string(), z.record(z.string(), z.number())),
    shipsHoldOrbit: z.boolean(),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.deployRaid(st, data.raidId, data.deployment, data.shipsHoldOrbit, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// FORMATIONS — raid loadouts, exploration loadouts, response teams
// (owner 2026-10-04). A formation is a pre-built battle group ready to roll.
const createFormationFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    name: z.string(),
    type: z.enum(["raid", "exploration", "response"]),
    heroId: z.string(),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.createFormation(st, data.name, data.type, data.heroId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const assignFormationShipFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), formationId: z.string(), shipId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.assignFormationShip(st, data.formationId, data.shipId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const removeFormationShipFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), formationId: z.string(), shipId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.removeFormationShip(st, data.formationId, data.shipId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const loadFormationTroopsFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), formationId: z.string(), shipId: z.string(), type: z.string(), count: z.number() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.loadFormationTroops(st, data.formationId, data.shipId, data.type as import("./war/troops").TroopType, data.count, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const unloadFormationTroopsFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), formationId: z.string(), shipId: z.string(), type: z.string(), count: z.number() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.unloadFormationTroops(st, data.formationId, data.shipId, data.type as import("./war/troops").TroopType, data.count, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const stageFormationSuppliesFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), formationId: z.string(), amount: z.number() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.stageFormationSupplies(st, data.formationId, data.amount, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const unstageFormationSuppliesFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), formationId: z.string(), amount: z.number() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.unstageFormationSupplies(st, data.formationId, data.amount, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const deleteFormationFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), formationId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.deleteFormation(st, data.formationId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const deployFormationFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), formationId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.deployFormationAsRaid(st, data.formationId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});
const hireDesertersFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    raidId: z.string(),
    bandId: z.string(),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.hireRaidDeserters(st, data.raidId, data.bandId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const dismissDesertersFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    raidId: z.string(),
    bandId: z.string(),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.dismissRaidDeserters(st, data.raidId, data.bandId, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// Raid party joining via invite code (multiplayer, owner 2026-10-03).
// Alliance members on the SAME world join the leader's party.
const joinRaidFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), inviteCode: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.joinRaidByCode(st, data.inviteCode, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// Satellite klaxon (owner 2026-10-03): acknowledge + clear the live raid alarm.
// The alarm persists until the player acknowledges it — this is the dismiss.
const acknowledgeRaidAlarmFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  st.raidAlarm = null;
  const saved = await saveActiveState(accountId, st);
  if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  return { ok: true, state: publicState(st) };
});

// Leader progression: spend one earned attribute point (XP level-up) into one
// attribute of one Leader. Purely earned — never purchasable.
const allocateLeaderPointFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), leaderId: z.string(), attr: z.enum(["research", "economy", "combat", "engineering"]) })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.allocateLeaderPoint(st, data.leaderId, data.attr, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// Leader progression: the ONE-TIME Level-3 specialization choice (Scholar /
// Marshal / Quartermaster), mutually exclusive and permanent for that Leader.
const chooseSpecializationFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), leaderId: z.string(), path: z.enum(["scholar", "marshal", "quartermaster"]) })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.chooseSpecialization(st, data.leaderId, data.path, Date.now());
  if (res.ok && res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// ------- account endpoints -------

const signupFn = createServerFn({ method: "POST" }).validator(
  z.object({ username: z.string(), password: z.string() })
).handler(async ({ data }) => authSignup(data.username, data.password));

const loginFn = createServerFn({ method: "POST" }).validator(
  z.object({ username: z.string(), password: z.string() })
).handler(async ({ data }) => authLogin(data.username, data.password));

const logoutFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<{ ok: boolean }> => {
  await authLogout(data.token);
  return { ok: true };
});

// Resolve a token to confirm a persisted session (used on page load).
const meFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<{ ok: boolean; signedOut?: boolean; accountId?: string }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true };
  return { ok: true, accountId };
});
// ------- beta feedback channel (First Run) -------
const CATEGORIES = ["bug", "flow_issue", "feature_suggestion"] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const MAX_FEEDBACK_PER_ACCOUNT = 50;
const FEEDBACK_MIN_GAP_MS = 30_000;
export interface FeedbackResult {
  ok: boolean;
  signedOut?: boolean;
  error?: string;
  record?: FeedbackRecord;
  records?: FeedbackRecord[];
}
function feedbackId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
const submitFeedbackFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    category: z.enum(CATEGORIES),
    title: z.string(),
    description: z.string(),
    playerName: z.string().optional(),
    severity: z.enum(SEVERITIES).optional(),
  })
).handler(async ({ data }): Promise<FeedbackResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const category: FeedbackCategory = data.category;
  const title = data.title.trim();
  const description = data.description.trim();
  const playerName = data.playerName?.trim() || undefined;
  if (!title) return { ok: false, error: "A title is required." };
  if (title.length > 80) return { ok: false, error: "Title must be 80 characters or fewer." };
  if (description.length < 10) return { ok: false, error: "Description must be at least 10 characters." };
  if (description.length > 2000) return { ok: false, error: "Description must be 2000 characters or fewer." };
  if (category === "bug" && !data.severity) return { ok: false, error: "Pick a severity for the bug." };
  if (playerName && playerName.length > 64) return { ok: false, error: "Player name must be 64 characters or fewer." };
  const file = await loadFeedback();
  const now = Date.now();
  const mine = file.submissions.filter((s) => s.accountId === accountId);
  if (mine.length >= MAX_FEEDBACK_PER_ACCOUNT) {
    return { ok: false, error: "You've reached the 50-submission limit. Thank you for the beta effort!" };
  }
  const last = mine.sort((a, b) => b.createdAt - a.createdAt)[0];
  if (last && now - last.createdAt < FEEDBACK_MIN_GAP_MS) {
    return { ok: false, error: "Please wait 30 seconds between submissions." };
  }
  const record: FeedbackRecord = {
    id: feedbackId(),
    accountId,
    createdAt: now,
    category,
    title,
    description,
    playerName,
    severity: category === "bug" && data.severity ? (data.severity as FeedbackSeverity) : undefined,
    status: "new",
  };
  file.submissions.push(record);
  await saveFeedback(file);
  return { ok: true, record };
});
const listMyFeedbackFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<FeedbackResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const file = await loadFeedback();
  const records = file.submissions
    .filter((s) => s.accountId === accountId)
    .sort((a, b) => b.createdAt - a.createdAt);
  return { ok: true, records };
});
const dismissNoticeFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<{ ok: boolean; signedOut?: boolean }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true };
  const accounts = await loadAccounts();
  if (accounts[accountId]) {
    accounts[accountId].noticeDismissed = true;
    await saveAccounts(accounts);
  }
  return { ok: true };
});

// ------- THE FALL · Act I — taking the field (opening-prologue-spec §3) -------
// The entry into the height. Act I lives in its OWN colony slot (a fixed id),
// so the player's real colonies are never touched: entering is "take the
// field", leaving is a plain switch back, and the slot the height lives in is
// the same slot the Wake (Act III) will hand back as a single Cradle.
//
// The seed + the first front are built by the pure prologue modules
// (prologueEngine.prologueState + act1-battle.seedAct1Battle) and stored
// through the ordinary save path, so the state — including the LIVE battle and
// its clock — survives a reload exactly like every other colony. Nothing here
// touches the decision engine, and nothing here is for sale.
/** Take the field: seed-or-resume Act I's slot, open the front, make it active.
 *  Idempotent — a player already standing at the height is simply resumed
 *  (never re-seeded, never a second front). */
const enterActOneFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = (await loadAccountSaves(accountId)) ?? emptySaves();
  const now = Date.now();
  const slot = saves.games[ACT1_CONFIG.gameId] ?? null;
  const { state } = openAct1Front(slot, now, (at) => prologueState(at, ACT1_CONFIG.race));
  const st = engine.advance(state, now);
  saves.games[ACT1_CONFIG.gameId] = st;
  saves.activeGameId = ACT1_CONFIG.gameId;
  await saveAccountSaves(accountId, saves);
  return { ok: true, state: publicState(st), activeGameId: ACT1_CONFIG.gameId };
});
/** Leave the height: hand the account back to a colony of its own. A player
 *  with no other colony (their first ever session) simply stays where they are
 *  — there is no state this button can strand them in. */
const leaveActOneFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = await loadAccountSaves(accountId);
  if (!saves || !saves.games[ACT1_CONFIG.gameId]) return { ok: false, error: "You are not standing at the height." };
  const now = Date.now();
  const homes = Object.values(saves.games)
    .filter((g) => g.gameId && g.gameId !== ACT1_CONFIG.gameId && !!g.race)
    .sort((a, z) => (z.createdAt ?? 0) - (a.createdAt ?? 0));
  const homeId = homes[0]?.gameId;
  if (!homeId) {
    const st = engine.advance(saves.games[ACT1_CONFIG.gameId], now);
    saves.games[ACT1_CONFIG.gameId] = st;
    saves.activeGameId = ACT1_CONFIG.gameId;
    await saveAccountSaves(accountId, saves);
    return { ok: true, state: publicState(st), activeGameId: ACT1_CONFIG.gameId };
  }
  saves.activeGameId = homeId;
  await saveAccountSaves(accountId, saves);
  const st = engine.advance(saves.games[homeId], now);
  saves.games[homeId] = st;
  return { ok: true, state: publicState(st), activeGameId: homeId };
});
// ------- battle decision windows (B12) & aid calls (B11) -------
// Server functions for mid-battle orders. Every order is VALIDATED by the
// pure engine (window open, one per window per side, reserve affordability),
// the real costs the engine stamps are DEDUCTED from the colony's war reserve
// (troops + energy; heroes become locked commitments), and a retreat finalizes
// the battle ledger exactly once. Nothing here is purchasable — the reserve
// grows only from play, and the engine never reads a wallet. The prologue
// drives its scripted tutorial through the same pure functions directly.

/** Shared validator shape for a committed hero snapshot (B4 value-copy). */
const battleHeroSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  level: z.number(),
  attributes: z.record(z.string(), z.number()),
  specialization: z.string().nullable(),
  skills: z.array(z.object({
    id: z.string(),
    name: z.string(),
    strength: z.number().optional(),
    guardPenalty: z.number().optional(),
    damageReduction: z.number().optional(),
    scoring: z.number().optional(),
  })),
  // LOADOUT: accepted but never trusted — the server re-resolves equipped
  // from its own loadout state at pledge/commit time (resolveHeroEquipment).
  equipped: z.object({
    weapon: z.object({ itemId: z.string(), name: z.string(), grade: z.string() }).optional(),
    armor: z.object({ itemId: z.string(), name: z.string(), grade: z.string() }).optional(),
    attrs: z.object({ power: z.number(), guard: z.number() }),
  }).optional(),
});

/** Build the engine-facing reserve view for the caller's colony: heroes not
 *  locked in another commitment + its unspent reserve energy. Troop
 *  affordability is the REAL available garrison weight of the home backing
 *  `side` (muster roster, minus commitments) — never the old ghost ledger. */
function battleReservesFor(st: GameState, proposed: string[], battle: Battle, side: BattleSide): BattleReservesLike {
  const locked = new Set(Object.keys(st.warReserve?.lockedHeroes ?? {}));
  const committed = new Set<string>();
  for (const b of st.battles ?? []) {
    for (const h of b.attacker?.heroSquad ?? []) if (h.id) committed.add(h.id);
    for (const h of b.defender?.heroSquad ?? []) if (h.id) committed.add(h.id);
    for (const c of b.aidCalls ?? []) for (const h of c.heroes ?? []) if (h.id) committed.add(h.id);
  }
  const reserveHeroIds = proposed.filter((id) => !locked.has(id) && !committed.has(id) && id.length > 0);
  const home = sideHomeFor(battle, side);
  const roster = home ? rosterForCommit(st, home) : null;
  const reserveTroops = roster ? availableWeight(roster) : 0;
  return {
    reserveHeroIds,
    reserveTroops,
    energy: Math.max(0, Math.trunc(st.warReserve?.energy) || 0),
  };
}
type BattleReservesLike = { reserveHeroIds: string[]; reserveTroops: number; energy: number };

/** Which side of a battle belongs to a colony (single-player: the caller's
 *  own colony id). Aid bodies march from the RESPONDER's home even when they
 *  fight on the caller's side — this is how the API bills the right roster. */
function playerSideOf(battle: Battle, colonyId: string | undefined): BattleSide | null {
  if (!colonyId) return null;
  if (battle.attacker?.colonyId === colonyId) return "attacker";
  if (battle.defender?.colonyId === colonyId) return "defender";
  return null;
}

/** Issue a mid-battle order: reinforce / hold / withdrawal / retreat / callAid. */
const battleIssueFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    battleId: z.string(),
    side: z.enum(["attacker", "defender"]),
    windowId: z.string(),
    action: z.enum(["reinforce", "hold", "withdrawal", "retreat", "callAid"]),
    heroes: z.array(battleHeroSchema).optional(),
    troops: z.number().nonnegative().optional(),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = await loadAccountSaves(accountId);
  if (!saves || !saves.activeGameId || !saves.games[saves.activeGameId]) {
    return { ok: false, error: "Start a colony first." };
  }
  const st = engine.advance(saves.games[saves.activeGameId], Date.now());
  const battle = st.battles?.find((b) => b.id === data.battleId);
  if (!battle || battle.status !== "active") return { ok: false, error: "That battle isn't running." };
  const heroes = (data.heroes ?? []) as unknown as BattleHeroSnapshot[];
  for (const h of heroes) {
    const eq = engine.resolveHeroEquipment(st, { kind: "hero", id: h.id });
    if (eq) h.equipped = eq; else delete h.equipped;
  }
  const reserves = battleReservesFor(st, heroes.map((h) => h.id), battle, data.side);
  const res = issueDecision(battle, data.side, data.windowId, data.action, Date.now(), reserves, {
    heroes,
    troops: data.troops ?? 0,
  });
  if (!res.ok) return { ok: false, error: res.error };
  // ---- the real cost: deduct exactly what the engine stamped ----
  // Energy is the only warReserve debit now — troops come from the real
  // muster roster (commitRosterWeight), never the ghost ledger. Duplicate
  // submissions pay nothing twice: no energy, no heroes, no bodies.
  const r = st.warReserve;
  const e = res.decision.effects;
  const dup = res.duplicate === true;
  // ARENA (arena-market.md §1): the arena costs nothing but (mutually-agreed)
  // troops — no energy, no supplies, ever. The toll IS virtual here too.
  const arenaBout = !!battle.arena;
  if (!dup && e.kind === "reinforce") {
    if (!arenaBout) r.energy = Math.max(0, r.energy - e.energySpent);
    for (const h of heroes) r.lockedHeroes[h.id] = { battleId: battle.id, until: battleEndAt(battle) };
    const home = sideHomeFor(battle, data.side);
    const committed = home ? commitRosterWeight(st, home, e.troopsAdded) : 0;
    if (home && committed > 0) {
      stampRosterSegment(battle, data.side, {
        id: res.decision.id, kind: "reinforcement", home,
        weight: committed, tollsPaid: 0, decisionId: res.decision.id,
        committedAt: Date.now(),
      });
    }
  } else if (!dup && e.kind === "withdrawal") {
    // The rearguard toll dies NOW, in the real roster — not at battle end.
    // (Withdrawal itself costs no energy — the toll IS the price.)
    settleToll(st, battle, data.side, e.rearguardCasualties);
  } else if (!dup && e.kind === "callAid") {
    if (!arenaBout) r.energy = Math.max(0, r.energy - e.energySpent);
  }
  if (res.decision.action === "retreat") {
    appendReportOnce(st, battle);
    logBattleResolved(st, battle);
  }
  await saveAccountSaves(accountId, saves);
  return { ok: true, state: publicState(engine.advance(saves.games[saves.activeGameId], Date.now())), activeGameId: saves.activeGameId };
});

/** A teammate answers an aid call (B11): heroes lock in, power lands at the
 *  call's arrivalAt. The responder's march energy + heroes are real costs. */
const battleRespondFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    battleId: z.string(),
    aidCallId: z.string(),
    colonyId: z.string(),
    colonyName: z.string(),
    heroes: z.array(battleHeroSchema),
    weapons: z.array(z.object({ family: z.string(), tier: z.number(), count: z.number() })).optional(),
    troops: z.number().nonnegative().optional(),
    fobStage: z.number().min(0).max(4).optional(),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = await loadAccountSaves(accountId);
  if (!saves || !saves.activeGameId || !saves.games[saves.activeGameId]) {
    return { ok: false, error: "Start a colony first." };
  }
  const st = engine.advance(saves.games[saves.activeGameId], Date.now());
  const battle = st.battles?.find((b) => b.id === data.battleId);
  if (!battle || battle.status !== "active") return { ok: false, error: "That battle isn't running." };
  const heroes = data.heroes as unknown as BattleHeroSnapshot[];
  for (const h of heroes) {
    const eq = engine.resolveHeroEquipment(st, { kind: "hero", id: h.id });
    if (eq) h.equipped = eq; else delete h.equipped;
  }
  // Affordability is the RESPONDER's home: their bodies march even when they
  // fight on the caller's side. The aid call itself is found here (not after)
  // so the engine and the API bill the same roster.
  const call = battle.aidCalls?.find((c) => c.id === data.aidCallId);
  const responderSide = playerSideOf(battle, data.colonyId) ?? call?.callerSide ?? "defender";
  const reserves = battleReservesFor(st, heroes.map((h) => h.id), battle, responderSide);
  const res = respondToAid(battle, data.aidCallId, {
    colonyId: data.colonyId,
    colonyName: data.colonyName,
    heroes,
    weapons: (data.weapons ?? []) as never,
    troops: data.troops ?? 0,
    fobStage: (data.fobStage ?? 0) as never,
  }, Date.now(), reserves);
  if (!res.ok) return { ok: false, error: res.error };
  const r = st.warReserve;
  const e = res.decision.effects;
  if (e.kind === "respondAid") {
    r.energy = Math.max(0, r.energy - e.energySpent);
    for (const h of heroes) r.lockedHeroes[h.id] = { battleId: battle.id, until: battleEndAt(battle) };
    // recognition ledger: the co-op assist accrues to the colony that answered
    r.aidCredits = (r.aidCredits ?? 0) + heroes.length;
    // Aid bodies are real: committed from the responder's home roster, stamped
    // on the caller's side with the responder's colonyId (allied ownership —
    // the API never mutates another account's roster).
    const marchHome = sideHomeFor(battle, responderSide);
    const committed = marchHome && e.troopsAdded > 0 ? commitRosterWeight(st, marchHome, e.troopsAdded) : 0;
    if (marchHome && committed > 0 && call) {
      stampRosterSegment(battle, call.callerSide, {
        id: res.decision.id, kind: "aid", home: marchHome,
        weight: committed, tollsPaid: 0, decisionId: res.decision.id,
        colonyId: data.colonyId, committedAt: Date.now(),
      });
    }
  }
  await saveAccountSaves(accountId, saves);
  return { ok: true, state: publicState(engine.advance(saves.games[saves.activeGameId], Date.now())), activeGameId: saves.activeGameId };
});

/** Post pickets against a hidden entry vector (maneuvers): halves the flank /
 *  rear surprise bonus when that vector enters. Energy is the only cost. */
const battleScreenFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string().optional(),
    battleId: z.string(),
    side: z.enum(["attacker", "defender"]),
    vector: z.enum(["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"]),
  })
).handler(async ({ data }): Promise<GameResult> => {
  // `data.token` infers as `string | undefined` through the validator types on
  // this route (a TanStack inference quirk — zod still requires it at
  // runtime), so narrow before entering the serialized mutation path.
  const token = data.token;
  if (!token) return { ok: false, signedOut: true, error: "Not signed in." };
  // Serialized like every other mutation: screens spend war energy, and two
  // concurrent posts must not double-spend it.
  return withColony(token, (st, ctx) => {
    const battle = st.battles?.find((b) => b.id === data.battleId);
    if (!battle || battle.status !== "active") return { ok: false, error: "That battle isn't running." };
    const reserves = battleReservesFor(st, [], battle, data.side);
    const res = screenVector(battle, data.side, data.vector as ManeuverVector, ctx.now, reserves);
    if (!res.ok) return { ok: false, error: res.error };
    if (!res.duplicate) {
      st.warReserve.energy = Math.max(0, st.warReserve.energy - res.energySpent);
    }
    return { ok: true as const, value: res.duplicate ? "already" : "posted" };
  });
});

/** Attach a rally battle plan to a live battle (maneuvers). Validated
 *  server-side — illegal plans are rejected before anything is pledged — and
 *  pledged all-or-nothing out of the side's real roster. The plan's vectors
 *  and timing stay hidden; only the pledged composition goes public. */
const battlePlanFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string().optional(),
    battleId: z.string(),
    side: z.enum(["attacker", "defender"]),
    plan: z.object({
      id: z.string(),
      maneuvers: z.array(z.object({
        id: z.string(),
        vector: z.enum(["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"]),
        enterAtMin: z.number().nonnegative(),
        composition: z.record(z.string(), z.number()),
      })).min(1).max(4),
    }),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = await loadAccountSaves(accountId);
  if (!saves || !saves.activeGameId || !saves.games[saves.activeGameId]) {
    return { ok: false, error: "Start a colony first." };
  }
  const st = engine.advance(saves.games[saves.activeGameId], Date.now());
  const battle = st.battles?.find((b) => b.id === data.battleId);
  if (!battle || battle.status !== "active") return { ok: false, error: "That battle isn't running." };
  // The pledge comes from the side's stamped home; a side with no home yet
  // pledges from the caller's own garrison — but never onto a side the
  // caller doesn't own (no pledging the enemy's war).
  const playerSide = playerSideOf(battle, saves.activeGameId);
  const home = sideHomeFor(battle, data.side) ?? (data.side === playerSide ? { kind: "home" } as const : null);
  if (!home) return { ok: false, error: "No troop home backs that side." };
  const reserves = battleReservesFor(st, [], battle, data.side);
  const res = attachBattlePlan(st, battle, data.side, data.plan as BattlePlan, home, Date.now(), reserves);
  if (!res.ok) return { ok: false, error: res.error };
  await saveAccountSaves(accountId, saves);
  return { ok: true, state: publicState(engine.advance(saves.games[saves.activeGameId], Date.now())), activeGameId: saves.activeGameId };
});

// ------- ARENA (arena-market.md Part I §§1–3; §4 duels are v2) -------
const arenaForceSchema = z.object({
  troops: z.number().int().min(0).max(100000),
  heroes: z.array(battleHeroSchema).max(5),
  weapons: z.array(z.object({
    family: z.enum(["frontline", "assault", "precision", "siege", "engine"]),
    tier: z.number().int().min(1).max(4),
    count: z.number().int().min(1).max(1000),
  })).max(20).optional(),
});

const arenaPlanSchema = z.object({
  id: z.string().max(64),
  maneuvers: z.array(z.object({
    id: z.string().max(64),
    vector: z.enum(["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"]),
    enterAtMin: z.number().nonnegative().max(480),
    composition: z.record(z.string(), z.number()),
  })).min(1).max(4),
}).nullable().optional();

/** Server-AUTHORITATIVE hero snapshots: the client's hero list is names
 *  only — attributes/skills rebuild from the colony's own prologue records
 *  (a tampered client can't invent stats), then equipment resolves
 *  (proving ground: the loadout's artifacts ride the snapshot — zero risk,
 *  the arena never takes them). Unknown ids reject the call. */
function resolveArenaHeroes(
  st: GameState,
  heroes: z.infer<typeof battleHeroSchema>[],
): { ok: true; value: BattleHeroSnapshot[] } | { ok: false; error: string } {
  const roster = st.prologue?.heroes ?? [];
  const out: BattleHeroSnapshot[] = [];
  for (const h of heroes) {
    const rec = roster.find((r) => r.id === h.id);
    if (!rec) return { ok: false, error: "One of your heroes doesn't exist." };
    const snap = snapshotHero(rec);
    const eq = engine.resolveHeroEquipment(st, { kind: "hero", id: snap.id });
    if (eq) snap.equipped = eq;
    out.push(snap);
  }
  return { ok: true, value: out };
}

const arenaChallengeFn = createServerFn({ method: "POST" }).validator(
  z.object({
token: z.string(),
    challengedId: z.string().min(1).max(64),
    challengedName: z.string().min(1).max(60),
    force: arenaForceSchema,
    stakes: z.boolean(),
    plan: arenaPlanSchema,
  })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, (st, ctx) => {
    const rh = resolveArenaHeroes(st, data.force.heroes);
    if (!rh.ok) return rh;
    const heroes = rh.value;
    const res = challengeArena(
      st,
      { id: ctx.colonyId, name: ctx.colonyName },
      { id: data.challengedId, name: data.challengedName },
      { troops: data.force.troops, heroes, weapons: data.force.weapons ?? [] } as ArenaForceInput,
      data.stakes,
      (data.plan ?? null) as BattlePlan | null,
      ctx.now,
    );
    if (!res.ok) return res;
    queueAllianceFx(st, res.value.fx);
    return { ok: true as const, value: { challengeId: res.value.challenge.id } };
  }),
);

const arenaAcceptFn = createServerFn({ method: "POST" }).validator(
  z.object({
token: z.string(),
    challengeId: z.string().min(1).max(64),
    force: arenaForceSchema,
    stakes: z.boolean(),
  })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, (st, ctx) => {
    const rh = resolveArenaHeroes(st, data.force.heroes);
    if (!rh.ok) return rh;
    const heroes = rh.value;
    const res = acceptArenaChallenge(
      st,
      data.challengeId,
      { id: ctx.colonyId, name: ctx.colonyName },
      { troops: data.force.troops, heroes, weapons: data.force.weapons ?? [] } as ArenaForceInput,
      data.stakes,
      ctx.now,
    );
    if (!res.ok) return res;
    queueAllianceFx(st, res.value.fx);
    return { ok: true as const };
  }),
);

const arenaDeclineFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), challengeId: z.string().min(1).max(64) })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, (st, ctx) => {
    const res = declineArenaChallenge(st, data.challengeId, ctx.colonyId, ctx.now);
    if (!res.ok) return res;
    queueAllianceFx(st, res.value.fx);
    return { ok: true as const };
  }),
);

const arenaCancelFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), challengeId: z.string().min(1).max(64) })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, (st, ctx) => {
    const res = cancelArenaChallenge(st, data.challengeId, ctx.colonyId, ctx.now);
    if (!res.ok) return res;
    queueAllianceFx(st, res.value.fx);
    return { ok: true as const };
  }),
);

/** The public arena ladder: every colony's bouts aggregated server-side
 *  (boutId dedupe — host and guest each hold a copy). Seasonal titles are
 *  cosmetic. Reset wires into the future season-rollover job (the season
 *  key is stamped on every bout). */
const arenaLadderFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string().optional() })
).handler(async (): Promise<{ ok: boolean; entries?: ReturnType<typeof buildLadderEntries>; season?: string; serverName?: string; error?: string }> => {
  const bouts: ArenaBout[] = [];
  let season = "s1";
  for (const { saves } of await loadAllSaves()) {
    for (const gid in saves.games) {
      const g = saves.games[gid];
      if (!g || typeof g !== "object" || !g.race || !g.gameId) continue;
      try {
        ensureArena(g as GameState);
        const bs = arenaBoutsOf(g as GameState);
        for (const b of bs) {
          if (b && typeof b.boutId === "string") bouts.push(b);
        }
        const s = arenaSeason(g as GameState);
        if (s > season) season = s;
      } catch (e) {
        console.error("Failed to read arena bouts:", gid, e);
      }
    }
  }
  const entries = buildLadderEntries(bouts.filter((b) => b.season === season));
  return { ok: true, entries, season, serverName: WORLD_CONFIG.worldName };
});

/** Opponent directory: every colony on this world (id + name + race) so a
 *  challenger can pick a bout. Read-only, eventually consistent. */
const arenaDirectoryFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<GameResult & { colonies?: { id: string; name: string; race: string }[] }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const colonies: { id: string; name: string; race: string }[] = [];
  for (const { saves } of await loadAllSaves()) {
    for (const gid in saves.games) {
      const g = saves.games[gid] as GameState;
      if (!g || typeof g !== "object" || !g.race || !g.gameId) continue;
      colonies.push({ id: g.gameId, name: g.playerName || "An unnamed colony", race: String(g.race) });
    }
  }
  colonies.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, colonies };
});

// ------- monetization seams (survey-only; NO storefront ships now) -------// The catalog/ledger/entitlement layer is fully implemented (§7 of the spec);
// every purchase path is gated by MONETIZATION_CONFIG.storefrontEnabled (false
// through beta, §8.6) so the owner flipping one config value later turns the
// store on without touching these handlers.

/** Non-secret wallet view (balances + owned items + pass progress) — the
 *  storefront's data seam. Balances are also shipped inside publicState(); this
 *  endpoint exists so the future storefront can poll the wallet alone. */
const getWalletFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string().optional() })
).handler(async ({ data }): Promise<{ ok: boolean; signedOut?: boolean; wallet?: ReturnType<typeof walletView>; error?: string }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  return { ok: true, wallet: walletView(st) };
});

/** Spend ALREADY-OWNED Votives on a purchasable cosmetic (the in-game shop
 *  seam). Idempotent by the caller's eventId (a retried click cannot double-
 *  spend or double-grant). Store gated until the owner flips the switch. */
const purchaseWithVotivesFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), itemId: z.string(), eventId: z.string().min(4) })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  if (!MONETIZATION_CONFIG.storefrontEnabled) {
    return { ok: false, error: "The Cradle Market isn't open yet — purchases are disabled during beta (§8.6)." };
  }
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = purchaseWithVotives(st, data.itemId, data.eventId, Date.now());
  if (res.state) {
    const saved = await saveActiveState(accountId, res.state);
    if (!saved) return { ok: false, error: "Couldn't save your progress — please try again." };
  }
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

/** THE Xsolla checkout seam: mints a Pay Station token server-side for the
 *  SIGNED-IN account and returns the URL the client navigates to.
 *
 *  The token binds the account (its encoded ref — the value the webhook echoes
 *  back, which is what pins the credit to the right account) to one sellable
 *  SKU at the catalog price. Nothing is granted here: the entitlement lands
 *  only via the signature-verified Xsolla webhook. The API key never leaves
 *  the server — it is read from the environment at call time.
 *
 *  Env: XSOLLA_PROJECT_ID, XSOLLA_API_KEY, XSOLLA_SANDBOX ("true"/"1" for the
 *  sandbox Pay Station), XSOLLA_SITE_ORIGIN (optional canonical return host).
 *  Store gated until the owner flips the switch. */
const xsollaCheckoutFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), skuId: z.string(), origin: z.string().max(256).optional() })
).handler(async ({ data }): Promise<GameResult & { url?: string }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  if (!MONETIZATION_CONFIG.storefrontEnabled) {
    return { ok: false, error: "The Cradle Market isn't open yet — purchases are disabled during beta (§8.6)." };
  }
  if (!isSellable(data.skuId)) {
    return { ok: false, error: "That item isn't for sale." };
  }
  const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;
  const projectId = env.XSOLLA_PROJECT_ID?.trim();
  const apiKey = env.XSOLLA_API_KEY?.trim();
  if (!projectId || !apiKey) {
    return { ok: false, error: "Checkout isn't wired yet — the till is still being connected." };
  }
  const sandbox = env.XSOLLA_SANDBOX === "true" || env.XSOLLA_SANDBOX === "1";
  const row = xsollaCatalogRow(data.skuId)!;
  const provider = createPaymentProvider({
    projectId,
    apiKey,
    sandbox,
    returnUrlFor: (skuId) =>
      xsollaReturnUrlFor({
        skuId,
        origin: data.origin,
        sandbox,
        canonicalOrigin: env.XSOLLA_SITE_ORIGIN?.trim() || undefined,
      }),
  });
  const intent = await provider.createIntent({
    accountId,
    skuId: data.skuId,
    idempotencyKey: `checkout-${accountId}-${data.skuId}-${Date.now().toString(36)}`,
    amountCents: Math.round(row.amountUsd * 100),
    currency: "usd",
  });
  if (!intent.ok || !intent.url) {
    return { ok: false, error: intent.error ?? "Checkout failed." };
  }
  return { ok: true, url: intent.url };
});

/** THE MUSTER (design/muster-troops.md): enqueue a troop build at the Cradle
 *  barracks. Validated server action: type known, count positive, fits the
 *  garrison cap, cost deducted up front. Linear builds, one queue per type —
 *  and no alliance help, ever (the queue takes no external ticks). */
const musterTroopsFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    type: z.string(),
    count: z.number().int().positive().max(2000),
    tier: z.number().int().min(1).max(4).default(1),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = await loadAccountSaves(accountId);
  if (!saves || !saves.activeGameId || !saves.games[saves.activeGameId]) {
    return { ok: false, error: "Start a colony first." };
  }
  const st = engine.advance(saves.games[saves.activeGameId], Date.now());
  if (!st.race) return { ok: false, error: "Found your colony first." };
  engine.ensureTroops(st, Date.now());
  const t = st.troops!;
  if (!isTroopType(data.type)) return { ok: false, error: "Unknown troop type." };
  const tier = isTroopTier(data.tier) ? data.tier : 1;
  if (!tierUnlocked(st.techsResearched, tier)) {
    return { ok: false, error: `Tier ${tier} troops need muster research first — open the Lab.` };
  }
  const cap = homeGarrisonCap(engine.cradleTier(st));
  const enq = enqueueMuster(t.home.roster, t.home.musterQueue, data.type, data.count, Date.now(), t.home.seq, cap, tier, st.techsResearched);
  if (!enq.ok || !enq.order) return { ok: false, error: enq.error ?? "Muster refused." };
  const cost = musterCost(data.type, data.count, tier);
  if (st.resources.supplies < cost) {
    return { ok: false, error: `Need ${cost} supplies to muster ${data.count}.` };
  }
  st.resources.supplies -= cost;
  t.home.musterQueue.push(enq.order);
  t.home.seq++;
  await saveAccountSaves(accountId, saves);
  return { ok: true, state: publicState(engine.advance(saves.games[saves.activeGameId], Date.now())), activeGameId: saves.activeGameId };
});

/** Hire a mercenary band: the deserters' market (muster-troops.md §10). The
 *  ONLY buyable troops — first supplies on the table takes them. Garrison cap
 *  still applies: the cap is your stomach. */
const hireMercenariesFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    bandId: z.string(),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = await loadAccountSaves(accountId);
  if (!saves || !saves.activeGameId || !saves.games[saves.activeGameId]) {
    return { ok: false, error: "Start a colony first." };
  }
  const st = engine.advance(saves.games[saves.activeGameId], Date.now());
  if (!st.race) return { ok: false, error: "Found your colony first." };
  engine.ensureTroops(st, Date.now());
  const t = st.troops!;
  const band = t.bands.find((b) => b.id === data.bandId);
  if (!band) return { ok: false, error: "That band is gone — hired or scattered." };
  const cost = hireCost(band);
  if (st.resources.supplies < cost) {
    return { ok: false, error: `Need ${cost} supplies to hire them.` };
  }
  const cap = homeGarrisonCap(engine.cradleTier(st));
  const res = hireBand(t.home, band, cap, Date.now());
  if (!res.ok) return { ok: false, error: res.error ?? "Hire refused." };
  st.resources.supplies -= cost;
  // The band is spent (hireBand empties it) — drop it from the wild.
  t.bands = t.bands.filter((b) => b.id !== band.id);
  await saveAccountSaves(accountId, saves);
  return { ok: true, state: publicState(engine.advance(saves.games[saves.activeGameId], Date.now())), activeGameId: saves.activeGameId };
});

/** FORWARD BASES (design/forward-base.md §2–§3): plant a beachhead on a
 *  foreign server. Validated server action: never home, one base per foreign
 *  server, 24h jump cooldown, beachhead kit + jump charge deducted from HOME
 *  supplies up front. The stockpile starts at zero — it only grows by raiding. */
const plantForwardBaseFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    serverId: z.string().min(1).max(64),
    label: z.string().max(48).optional(),
    forceWeight: z.number().nonnegative().max(200000).default(0),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = await loadAccountSaves(accountId);
  if (!saves || !saves.activeGameId || !saves.games[saves.activeGameId]) {
    return { ok: false, error: "Start a colony first." };
  }
  const now = Date.now();
  const st = engine.advance(saves.games[saves.activeGameId], now);
  if (!st.race) return { ok: false, error: "Found your colony first." };
  engine.ensureForwardBases(st, now);
  const req = plantForwardBase({
    serverId: data.serverId,
    homeServerId: st.gameId ?? "home",
    label: data.label ?? "",
    forceWeight: data.forceWeight,
    lastJumpAt: st.lastJumpAt ?? null,
    existingServers: Object.keys(st.forwardBases!),
    now,
    seq: Object.keys(st.forwardBases!).length,
  });
  if (!req.ok || !req.base) return { ok: false, error: req.error ?? "Planting refused." };
  const charge = req.chargeSupplies ?? 0;
  if (st.resources.supplies < charge) {
    return { ok: false, error: `The jump needs ${charge} home supplies (beachhead kit + jump charge) — you hold ${Math.floor(st.resources.supplies)}.` };
  }
  // NOTE(forge): the kit's forged anchor component (war-plate-anchor) is
  // charged here once the forge exposes an inventory seam. Supplies-only
  // until then — plantForwardBase reports anchorCharged for the UI.
  st.resources.supplies -= charge;
  st.forwardBases![req.base.serverId] = req.base;
  st.lastJumpAt = now;
  await saveAccountSaves(accountId, saves);
  return { ok: true, state: publicState(engine.advance(saves.games[saves.activeGameId], Date.now())), activeGameId: saves.activeGameId };
});

/** HIVE RELOCATION (owner 2026-10-04, Globe Wave 2 WS-E): move the home
 *  colony to a player-picked point on the globe. Validated server action:
 *  7-day cooldown, blocked while under attack or with a raid party away,
 *  ≥4° from any other known colony, |lat| ≤ 78 (clamped). Cost: 500
 *  supplies flat (the hive kit) + a distance-scaled fuel jump charge —
 *  deducted from home stores up front. All rules live in
 *  game/hive-relocation.ts; this fn validates, applies, and persists. */
const relocateColonyFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string().min(1).max(512),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = await loadAccountSaves(accountId);
  if (!saves || !saves.activeGameId || !saves.games[saves.activeGameId]) {
    return { ok: false, error: "Start a colony first." };
  }
  const now = Date.now();
  const st = engine.advance(saves.games[saves.activeGameId], now);
  const v = validateHiveMove(st, { lat: data.lat, lon: data.lon }, now);
  if (!v.ok || !v.cost) return { ok: false, error: v.error ?? "Relocation refused." };
  applyHiveMove(st, v.cost, { lat: data.lat, lon: data.lon }, now);
  await saveAccountSaves(accountId, saves);
  return { ok: true, state: publicState(engine.advance(saves.games[saves.activeGameId], Date.now())), activeGameId: saves.activeGameId };
});

/** Muster troops AT a forward base (forward-base.md §4): the only production
 *  a beachhead has. Same linear queues, same costs — paid from the RAIDED
 *  stockpile. No home convoys, no alliance help, 500-cap. */
const musterForwardTroopsFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    serverId: z.string().min(1).max(64),
    type: z.string(),
    count: z.number().int().positive().max(500),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = await loadAccountSaves(accountId);
  if (!saves || !saves.activeGameId || !saves.games[saves.activeGameId]) {
    return { ok: false, error: "Start a colony first." };
  }
  const now = Date.now();
  const st = engine.advance(saves.games[saves.activeGameId], now);
  if (!st.race) return { ok: false, error: "Found your colony first." };
  engine.ensureForwardBases(st, now);
  const base = st.forwardBases![data.serverId];
  if (!base) return { ok: false, error: "No forward base on that server." };
  const res = musterAtBase(base, data.type, data.count, now);
  if (!res.ok) return { ok: false, error: res.error ?? "Muster refused." };
  await saveAccountSaves(accountId, saves);
  return { ok: true, state: publicState(engine.advance(saves.games[saves.activeGameId], Date.now())), activeGameId: saves.activeGameId };
});

/** Hire a deserter band on foreign soil (forward-base.md §5): the band must
 *  be in the SHARED pool for the base's server — starving a beachhead stocks
 *  your enemy's recruitment pool. Paid from raided supplies, 500-cap. */
const hireServerBandFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    serverId: z.string().min(1).max(64),
    bandId: z.string(),
  })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const saves = await loadAccountSaves(accountId);
  if (!saves || !saves.activeGameId || !saves.games[saves.activeGameId]) {
    return { ok: false, error: "Start a colony first." };
  }
  const now = Date.now();
  const st = engine.advance(saves.games[saves.activeGameId], now);
  if (!st.race) return { ok: false, error: "Found your colony first." };
  engine.ensureForwardBases(st, now);
  const base = st.forwardBases![data.serverId];
  if (!base) return { ok: false, error: "No forward base on that server." };
  const res = hireBandAtBase(base, st.serverBands!, data.bandId, now);
  if (!res.ok) return { ok: false, error: res.error ?? "Hire refused." };
  await saveAccountSaves(accountId, saves);
  return { ok: true, state: publicState(engine.advance(saves.games[saves.activeGameId], Date.now())), activeGameId: saves.activeGameId };
});

// ---------------------------------------------------------------------------
// ALLIANCES + RALLIES (design/alliances.md) — the war band's server surface.
// ---------------------------------------------------------------------------

/** Shared boilerplate: account → advanced colony → work → drain fx → persist.
 *  Serialized per account: no two requests interleave a load-modify-save. */
async function withColony(
  token: string,
  work: (
    st: GameState,
    ctx: { colonyId: string; colonyName: string; now: number },
  ) =>
    | { ok: true; value?: unknown }
    | { ok: false; error: string }
    | Promise<{ ok: true; value?: unknown } | { ok: false; error: string }>,
): Promise<GameResult> {
  const accountId = await accountForToken(token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  try {
    return await withAccountLock(accountId, async () => {
      const saves = await loadAccountSaves(accountId);
      // Hoist into a const: narrowing on `saves.activeGameId` doesn't cross
      // the request-scope closure below, so capture the proven value once.
      const activeGameId = saves?.activeGameId;
      if (!saves || !activeGameId || !saves.games[activeGameId]) {
        return { ok: false, error: "Start a colony first." };
      }
      // Register this account's saves on the request scope: cross-account
      // fx chains that come back here (A→B→A) resolve in-memory instead of
      // re-entering the lock we already hold.
      return await runWithAccountSaves(accountId, saves, async () => {
        const now = Date.now();
        const st = engine.advance(saves.games[activeGameId], now);
        if (!st.race) return { ok: false, error: "Found your colony first." };
        const res = await work(st, { colonyId: activeGameId, colonyName: st.playerName, now });
        if (!res.ok) return { ok: false, error: res.error };
        // Cross-account alliance effects queued by work (help ticks, guest
        // mirrors, casualty bills, lock releases) deliver through the outbox:
        // persist first, then deliver, then persist the cleared outbox.
        await commitOutbox(saves, accountId);
        return { ok: true, state: publicState(engine.advance(saves.games[activeGameId], Date.now())), activeGameId };
      });
    });
  } catch (e) {
    if (e instanceof AccountBusyError) {
      return { ok: false, error: "The colony ledger is busy — try again in a moment." };
    }
    throw e;
  }
}

/**
 * Run a mutation against an alliance's canonical record — the copy on the
 * founder's account. Reads the local mirror for the founder id; falls back
 * to the directory when the caller holds no mirror yet (applicants).
 * Foreign accounts go through the lock/load/save seam (their outbox drains
 * inside the transact); same-account targets resolve in-memory on the
 * request scope and drain with the outer outbox.
 */
async function canonicalAllianceTx<T>(
  st: GameState,
  allianceId: string,
  fn: (fst: GameState) => T | Promise<T>,
): Promise<T | { ok: false; error: string }> {
  const mirror = allianceById(st, allianceId);
  let founderId = mirror?.founderId ?? null;
  if (!founderId) {
    const entry = (await scanAllianceDirectory()).find((e) => e.id === allianceId);
    founderId = entry?.founderId ?? null;
  }
  if (!founderId) return { ok: false, error: "That alliance doesn't exist." };
  try {
    return await transactColony(founderId, fn);
  } catch (e) {
    if (e instanceof ColonyNotFoundError) return { ok: false, error: "That alliance doesn't exist." };
    throw e;
  }
}

/** Same idea for rallies: the canonical record lives on the caller's account. */
async function canonicalRallyTx<T>(
  st: GameState,
  rallyId: string,
  fn: (fst: GameState) => T | Promise<T>,
): Promise<T | { ok: false; error: string }> {
  const mirror = rallyOf(st, rallyId);
  if (!mirror) return { ok: false, error: "That rally doesn't exist." };
  try {
    return await transactColony(mirror.callerId, fn);
  } catch (e) {
    if (e instanceof ColonyNotFoundError) return { ok: false, error: "That rally doesn't exist." };
    throw e;
  }
}

const allianceCreateFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    name: z.string().min(3).max(40),
    banner: z.string().max(8).optional(),
    motto: z.string().max(120).optional(),
  })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, (st, ctx) =>
    createAlliance(
      st,
      { id: ctx.colonyId, name: ctx.colonyName },
      engine.cradleTier(st),
      { name: data.name, banner: data.banner, motto: data.motto },
      ctx.now,
    ),
  ),
);

const allianceApplyFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), allianceId: z.string() })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) => {
    // "One flag at a time" is judged against the APPLICANT's own state.
    // The canonical tx below runs on the founder's save, whose roster can
    // hold a stale membership (e.g. after the applicant's save was reseeded)
    // — that must not block a fresh join (2026-10-04).
    if (allianceOf(st, ctx.colonyId))
      return { ok: false as const, error: "One flag at a time — leave your current alliance first." };
    const result = await canonicalAllianceTx(st, data.allianceId, (fst) =>
      applyToAlliance(fst, data.allianceId, { id: ctx.colonyId, name: ctx.colonyName }, ctx.now),
    );
    // Open-policy join grants instant membership — send welcome mail to the joiner.
    // (For "apply" policy, this just creates an application; no mail yet.)
    if (result && typeof result === "object" && "ok" in result && result.ok) {
      const policy = allianceById(st, data.allianceId)?.joinPolicy ?? "apply";
      if (policy === "open") {
        try {
          const allianceName = allianceById(st, data.allianceId)?.name ?? "the war band";
          await transactColony(ctx.colonyId, (mst) => {
            sendMail(mst, {
              from: "alliance",
              fromName: allianceName,
              subject: `Welcome to ${allianceName}`,
              body: `You've joined the war band "${allianceName}". Watch your mailbox for rally calls, help requests, and war-band announcements. Fight well.`,
              category: "alliance",
              sentAt: ctx.now,
              goTo: { tab: "alliance", label: "Open war band" },
            });
            return { ok: true as const, value: undefined };
          });
        } catch {
          // Mail delivery failure shouldn't fail the join.
        }
      }
    }
    return result;
  }),
);

const allianceInviteFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    allianceId: z.string(),
    targetId: z.string(),
    targetName: z.string().min(1).max(60),
  })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) =>
    canonicalAllianceTx(st, data.allianceId, (fst) =>
      inviteToAlliance(fst, data.allianceId, ctx.colonyId, { id: data.targetId, name: data.targetName }, ctx.now),
    ),
  ),
);

const allianceAnswerFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    allianceId: z.string(),
    colonyId: z.string(),
    accept: z.boolean(),
  })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) => {
    const result = await canonicalAllianceTx(st, data.allianceId, (fst) =>
      data.accept
        ? acceptMembership(fst, data.allianceId, ctx.colonyId, data.colonyId, ctx.now)
        : declineMembership(fst, data.allianceId, ctx.colonyId, data.colonyId),
    );
    // Welcome mail goes to the NEW MEMBER's mailbox (not the founder's).
    // Done via a separate transaction on the member's colony.
    if (data.accept && result && typeof result === "object" && "ok" in result && result.ok) {
      try {
        const allianceName = allianceById(st, data.allianceId)?.name ?? "the war band";
        await transactColony(data.colonyId, (mst) => {
          sendMail(mst, {
            from: "alliance",
            fromName: allianceName,
            subject: `Welcome to ${allianceName}`,
            body: `You've joined the war band "${allianceName}". Watch your mailbox for rally calls, help requests, and war-band announcements. Fight well.`,
            category: "alliance",
            sentAt: ctx.now,
            goTo: { tab: "alliance", label: "Open war band" },
          });
          return { ok: true as const, value: undefined };
        });
      } catch {
        // Mail delivery failure shouldn't fail the membership acceptance.
      }
    }
    return result;
  }),
);

const allianceLeaveFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) => {
    const a = allianceOf(st, ctx.colonyId);
    if (!a) return { ok: false, error: "You're not in an alliance." };
    const allianceId = a.id;
    const founderId = a.founderId;
    const members = a.members.map((m) => m.colonyId);
    // 1. Our troops, our save: rally pledges return, own rallies cancel,
    //    reinforcements recall, mirrors drop.
    departRalliesFor(st, ctx.colonyId, allianceId, members);
    leaveAllianceLocal(st, ctx.colonyId);
    removeAllianceMirror(st, allianceId);
    // 2. The canonical member roll lives on the founder's account.
    try {
      const res = await transactColony(founderId, (fst) =>
        removeAllianceMemberRecord(fst, allianceId, ctx.colonyId, { why: "left", at: ctx.now }),
      );
      if (!res.ok) return res;
    } catch (e) {
      if (e instanceof ColonyNotFoundError) return { ok: false, error: "That alliance doesn't exist." };
      throw e;
    }
    return { ok: true, value: undefined };
  }),
);

const allianceKickFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), allianceId: z.string(), targetId: z.string() })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) =>
    canonicalAllianceTx(st, data.allianceId, (fst) =>
      kickMember(fst, data.allianceId, ctx.colonyId, data.targetId, ctx.now),
    ),
  ),
);

const alliancePromoteFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), allianceId: z.string(), targetId: z.string() })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) =>
    canonicalAllianceTx(st, data.allianceId, (fst) =>
      promoteMember(fst, data.allianceId, ctx.colonyId, data.targetId),
    ),
  ),
);

const allianceDemoteFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), allianceId: z.string(), targetId: z.string() })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) =>
    canonicalAllianceTx(st, data.allianceId, (fst) =>
      demoteMember(fst, data.allianceId, ctx.colonyId, data.targetId),
    ),
  ),
);

const allianceTransferFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), allianceId: z.string(), targetId: z.string() })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) =>
    canonicalAllianceTx(st, data.allianceId, (fst) =>
      transferLeadership(fst, data.allianceId, ctx.colonyId, data.targetId),
    ),
  ),
);

const allianceDisbandFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), allianceId: z.string() })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) => {
    const res = await canonicalAllianceTx(st, data.allianceId, (fst) =>
      disbandAlliance(fst, data.allianceId, ctx.colonyId),
    );
    // Our own mirrors drop too — the depart-alliance fx covers troops, but
    // the local alliance/rally mirrors are ours to forget.
    if (res.ok) {
      const a = allianceOf(st, ctx.colonyId);
      const members = a && a.id === data.allianceId ? a.members.map((m) => m.colonyId) : [];
      departRalliesFor(st, ctx.colonyId, data.allianceId, members);
      removeAllianceMirror(st, data.allianceId);
    }
    return res;
  }),
);

const rallyCreateFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    name: z.string().min(3).max(60),
    targetKind: z.enum(["chorus-site", "forward-base", "defense-point"]),
    targetLabel: z.string().min(1).max(80),
    zoneId: z.string().min(1).max(64),
    launchAt: z.number().int().positive(),
  })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, (st, ctx) => {
    const a = allianceOf(st, ctx.colonyId);
    if (!a) return { ok: false, error: "Join an alliance before calling rallies." };
    return createRally(
      st,
      { id: ctx.colonyId, name: ctx.colonyName },
      a.id,
      {
        name: data.name,
        target: { kind: data.targetKind, label: data.targetLabel, zoneId: data.zoneId },
        launchAt: data.launchAt,
      },
      ctx.now,
    );
  }),
);

const rallyPledgeFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    rallyId: z.string(),
    troops: z.number().int().min(0).max(100000),
    heroes: z.array(battleHeroSchema).optional(),
  })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) => {
    const r = rallyOf(st, data.rallyId);
    if (!r) return { ok: false, error: "That rally doesn't exist." };
    const heroes = (data.heroes ?? []) as unknown as BattleHeroSnapshot[];
    // LOADOUT, server-authoritative: re-resolve each pledged hero's worn gear
    // from OUR loadout state — the client's equipped block is never trusted.
    for (const h of heroes) {
      const eq = engine.resolveHeroEquipment(st, { kind: "hero", id: h.id });
      if (eq) h.equipped = eq; else delete h.equipped;
    }
    // Our troops, our save: lock them here.
    const locked = lockPledgeLocal(
      st, r,
      { id: ctx.colonyId, name: ctx.colonyName },
      data.troops, heroes, ctx.now,
    );
    if (!locked.ok) return locked;
    if (r.callerId === ctx.colonyId) {
      // We hold the canonical record — mirror it straight in.
      const a = allianceOf(st, ctx.colonyId);
      const rec = addRemotePledge(st, data.rallyId, locked.value, a ? rallyAudience(st, r) : []);
      if (!rec.ok) {
        // Unwind the local lock (same as the applier's unwind path).
        const roster = rosterForCommit(st, { kind: "home" });
        if (roster && locked.value.troops > 0) releaseWeight(roster, locked.value.troops);
        unlockRallyHeroes(st, data.rallyId, locked.value.heroes);
        return { ok: false, error: rec.error };
      }
    } else {
      // The caller's account holds the canonical record — the outbox carries
      // the locked pledge there; their sync fans it back to everyone.
      queueAllianceFx(st, {
        kind: "mirror-rally-pledge",
        colonyId: r.callerId,
        rallyId: r.id,
        pledge: locked.value,
        key: `pledge:${r.id}:${locked.value.id}`,
      });
    }
    return { ok: true, value: locked.value };
  }),
);

const rallyUnpledgeFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), rallyId: z.string() })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) => {
    const r = rallyOf(st, data.rallyId);
    if (!r) return { ok: false, error: "That rally doesn't exist." };
    // Our lock, our save: release it here.
    const local = unpledgeLocal(st, data.rallyId, ctx.colonyId);
    if (!local.ok) return local;
    if (r.callerId === ctx.colonyId) {
      const a = allianceOf(st, ctx.colonyId);
      return removeRemotePledge(st, data.rallyId, ctx.colonyId, local.value.id, a ? rallyAudience(st, r) : []);
    }
    // Tell the canonical record.
    queueAllianceFx(st, {
      kind: "mirror-rally-unpledge",
      colonyId: r.callerId,
      rallyId: r.id,
      pledgerId: ctx.colonyId,
      pledgeId: local.value.id,
      key: `unpledge:${r.id}:${local.value.id}`,
    });
    return { ok: true, value: undefined };
  }),
);

const rallyPlanSchema = z.object({
  id: z.string(),
  maneuvers: z.array(z.object({
    id: z.string(),
    vector: z.enum(["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"]),
    enterAtMin: z.number().min(0).max(480),
    composition: z.record(z.string(), z.number().int().min(0)).optional(),
  })).min(1).max(4),
});

const rallyPlanFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), rallyId: z.string(), plan: rallyPlanSchema })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) =>
    canonicalRallyTx(st, data.rallyId, (fst) =>
      setRallyPlan(fst, data.rallyId, ctx.colonyId, {
        id: data.plan.id,
        maneuvers: data.plan.maneuvers.map((m) => ({
          id: m.id,
          vector: m.vector,
          enterAtMin: m.enterAtMin,
          composition: (m.composition ?? {}) as PlannedManeuver["composition"],
        })),
      }),
    ),
  ),
);

const rallyLaunchFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), rallyId: z.string() })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) =>
    canonicalRallyTx(st, data.rallyId, (fst) => launchRally(fst, data.rallyId, ctx.colonyId, ctx.now)),
  ),
);

const rallyCancelFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), rallyId: z.string() })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, async (st, ctx) =>
    canonicalRallyTx(st, data.rallyId, (fst) => cancelRally(fst, data.rallyId, ctx.colonyId)),
  ),
);

/** Alliance directory: every war band flying a flag, so colonies can find
 *  one worth applying to. Public info only — no members, no applications. */
const allianceDirectoryFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string() })
).handler(async ({ data }): Promise<GameResult & { entries?: AllianceDirectoryEntry[] }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  const entries = await scanAllianceDirectory();
  return { ok: true, entries };
});

const helpTickFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    targetId: z.string(),
    targetName: z.string().min(1).max(60),
  })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, (st, ctx) => {
    const r = giveHelp(
      st,
      { id: ctx.colonyId, name: ctx.colonyName, tier: engine.cradleTier(st) },
      { id: data.targetId, name: data.targetName },
      ctx.now,
    );
    return r.ok ? { ok: true as const, value: r.value.minutes } : r;
  }),
);

const reinforceSendFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    toId: z.string(),
    toName: z.string().min(1).max(60),
    troops: z.number().int().min(0).max(100000),
    heroIds: z.array(z.string()).max(12).optional(),
    fobServerId: z.string().max(64).optional(),
  })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, (st, ctx) =>
    sendReinforcement(
      st,
      { id: ctx.colonyId, name: ctx.colonyName },
      { id: data.toId, name: data.toName, fobServerId: data.fobServerId },
      data.troops,
      data.heroIds ?? [],
      ctx.now,
    ),
  ),
);

const reinforceRecallFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), reinforcementId: z.string() })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, (st, ctx) => recallReinforcement(st, ctx.colonyId, data.reinforcementId)),
);

const reinforceDismissFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), reinforcementId: z.string() })
).handler(async ({ data }): Promise<GameResult> =>
  // Host-side: dismisses the guest mirror (the mirror shares the
  // reinforcement's id); the sender's lock releases through the seam.
  withColony(data.token, (st) => dismissReinforcement(st, data.reinforcementId)),
);

// Battle memorials: the victor carves one epitaph line (owner 2026-09-30).
// Locked forever once set — enforced in game/memorials.ts.
const setMemorialEpitaphFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), plaqueId: z.string(), epitaph: z.string().max(140) })
).handler(async ({ data }): Promise<GameResult> =>
  withColony(data.token, (st, ctx) =>
    engine.setMemorialEpitaph(st, data.plaqueId, data.epitaph, ctx.colonyName),
  ),
);

export {
  getState,
  createGameFn,
  listGamesFn,
  switchGameFn,
  resetGameFn,
  deleteGameFn,
  trashAccountFn,
  launchFn,
  studyFn,
  deployFn,
  purifyFn,
  craftFn,
  weaponBuildFn,
  refinePlasmaFn,
  forgeRollFn,
  forgeMeltFn,
  equipForgeItemFn,
  unequipForgeItemFn,
  beginResearchFn,
  chooseRevelationFn,
  buildProbeFn,
  launchProbeFn,
  collectProbeFn,
  claimHuskFn,
  shipSubColonySuppliesFn,
  musterSubColonyTroopsFn,
  orderShipFn,
  contributeShipFn,
  donateShipyardFn,
  setTitheFn,
  setJoinPolicyFn,
  markMailReadFn,
  markAllMailReadFn,
  deleteMailFn,
  createRaidFn,
  setRaidTargetFn,
  clearRaidTargetFn,
  assignRaidShipsFn,
  loadRaidTroopsFn,
  loadRaidSuppliesFn,
  launchRaidFn,
  deployRaidFn,
  tacticalRoundFn,
  quickResolveTacticalFn,
  createFormationFn,
  assignFormationShipFn,
  removeFormationShipFn,
  loadFormationTroopsFn,
  unloadFormationTroopsFn,
  stageFormationSuppliesFn,
  unstageFormationSuppliesFn,
  deleteFormationFn,
  deployFormationFn,
  joinRaidFn,
  hireDesertersFn,
  dismissDesertersFn,
  acknowledgeRaidAlarmFn,
  allocateLeaderPointFn,
  chooseSpecializationFn,
  signupFn,
  loginFn,
  logoutFn,
  meFn,
  getWalletFn,
  getContributionFn,
  claimDailyRewardFn,
  applyTimeTokenFn,
  purchaseWithVotivesFn,
  xsollaCheckoutFn,
  submitFeedbackFn,
  listMyFeedbackFn,
  dismissNoticeFn,
  battleIssueFn,
  battleRespondFn,
  battleScreenFn,
  battlePlanFn,
  arenaChallengeFn,
  arenaAcceptFn,
  arenaDeclineFn,
  arenaCancelFn,
  arenaLadderFn,
  arenaDirectoryFn,
  musterTroopsFn,
  hireMercenariesFn,
  plantForwardBaseFn,
  relocateColonyFn,
  musterForwardTroopsFn,
  hireServerBandFn,
  allianceCreateFn,
  allianceApplyFn,
  allianceInviteFn,
  allianceAnswerFn,
  allianceLeaveFn,
  allianceKickFn,
  alliancePromoteFn,
  allianceDemoteFn,
  allianceTransferFn,
  allianceDisbandFn,
  allianceDirectoryFn,
  rallyCreateFn,
  rallyPledgeFn,
  rallyUnpledgeFn,
  rallyPlanFn,
  rallyLaunchFn,
  rallyCancelFn,
  helpTickFn,
  reinforceSendFn,
  reinforceRecallFn,
  reinforceDismissFn,
  setMemorialEpitaphFn,
  enterActOneFn,
  leaveActOneFn,
  // ---- chat + mail (slice A1) — their own module, the same zod-validated shape
  worldFeedFn,
  sendWorldFn,
  chatSyncFn,
};