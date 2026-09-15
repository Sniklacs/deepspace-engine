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
import { RACES } from "./races";
import { ZONES } from "./zones";
import * as engine from "./engine";
import { worldRaceError } from "./world-config";
import {
  MONETIZATION_CONFIG,
  walletView,
  purchaseWithVotives,
  applyExternalPurchase,
  createPaymentProvider,
} from "./monetization";
import { dailyPublicView } from "./daily";
import {
  appendReportOnce,
  battleEndAt,
  battlePublicView,
  issueDecision,
  logBattleResolved,
  respondToAid,
} from "./war/battle-engine";
import type { BattleHeroSnapshot } from "./war/war-types";
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
    `${domains} deployed AI · ${st.completedExpeditions} expedition${st.completedExpeditions === 1 ? "" : "s"} · ` +
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
  const { revelationCounters: _rc, revelationChoice: _rch, revelationFirstOpenAt: _rfo, revelationCorruptionGainMult: _rcm, revelationDrainPerMin: _rdp, revelationChorusMult: _rm, revelationsResolved: _rr, acknowledgedOnce: _ao, currency: _cur, entitlements: _ent, battlePass: _bp, daily: _daily, warReserve: _wr, ...rest } = st;
  void _rc; void _rch; void _rfo; void _rcm; void _rdp; void _rm; void _rr; void _ao; void _cur; void _ent; void _bp; void _daily; void _wr;
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
    // B12/B11 reserve view: the observable numbers (troops + energy + the
    // co-op recognition ledger). `lockedHeroes` (commitment bookkeeping) stays
    // server-side — the battle decisions render the visible side of it.
    warReserve: {
      troops: Math.max(0, Math.trunc(st.warReserve?.troops) || 0),
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
    .map((e, i) => ({ rank: i + 1, colonyName: e.colonyName, race: e.race, score: e.score }));
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
async function saveActiveState(accountId: string, updated: GameState): Promise<void> {
  const saves = await loadAccountSaves(accountId);
  if (!saves || !updated.gameId) return;
  saves.games[updated.gameId] = updated;
  await saveAccountSaves(accountId, saves);
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
  return { ok: true, username: accountId, state: active ? publicState(active) : undefined, games: allSummaries(saves), activeGameId: saves.activeGameId, showFirstRunNotice };
});

// Create a new colony/game, set it active, and return its state.
const createGameFn = createServerFn({ method: "POST" }).validator(
  z.object({
    token: z.string(),
    name: z.string().max(40).default("Unnamed Colony"),
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

  if (Object.keys(saves.games).length >= MAX_GAMES) {
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
  if (res.ok && res.state) await saveActiveState(accountId, res.state);
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
  if (res.ok && res.state) await saveActiveState(accountId, res.state);
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
  if (res.ok && res.state) await saveActiveState(accountId, res.state);
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

const purifyFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), spend: z.number().int().min(1) })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.discipline(st, data.spend, Date.now());
  if (res.ok && res.state) await saveActiveState(accountId, res.state);
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
).handler(async ({ data }): Promise<GameResult & { granted?: { scrip: number; devotion: number; bonus: boolean } }> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.claimDaily(st, Date.now());
  if (res.ok && res.state) await saveActiveState(accountId, res.state);
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined, granted: res.granted };
});

// Workshop: craft gear — everyday (Tier 0), fuel/logistics (Tier 1), radiation
// gear + forged alloy (Tier 2).
const craftFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), kind: z.enum(["medkit", "mechkit", "armorkit", "skmech", "gas", "battery", "hazmat", "shots", "alloy"]) })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.craftItem(st, data.kind, Date.now());
  if (res.ok && res.state) await saveActiveState(accountId, res.state);
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

// V6 Armory: build/upgrade a weapon family at the Cradle (earn-only — the
// engine deducts supplies/embers/fuel/plasma and opens a real-time build).
const weaponBuildFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), familyId: z.string() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Start a colony first." };
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = engine.startWeaponBuild(st, data.familyId, Date.now());
  if (res.ok && res.state) await saveActiveState(accountId, res.state);
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
  if (res.ok && res.state) await saveActiveState(accountId, res.state);
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
  if (res.ok && res.state) await saveActiveState(accountId, res.state);
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
  if (res.ok && res.state) await saveActiveState(accountId, res.state);
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
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
  if (res.ok && res.state) await saveActiveState(accountId, res.state);
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
  if (res.ok && res.state) await saveActiveState(accountId, res.state);
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
});

/** Build the engine-facing reserve view for the caller's colony: heroes not
 *  locked in another commitment + its unspent reserve troops/energy. The
 *  roster deep-check (hero actually earned, energy stamps per hero) is the war
 *  layer's job in Phase 1 — today the structural unlocks + commitments stand. */
function battleReservesFor(st: GameState, proposed: string[]): BattleReservesLike {
  const locked = new Set(Object.keys(st.warReserve?.lockedHeroes ?? {}));
  const committed = new Set<string>();
  for (const b of st.battles ?? []) {
    for (const h of b.attacker?.heroSquad ?? []) if (h.id) committed.add(h.id);
    for (const h of b.defender?.heroSquad ?? []) if (h.id) committed.add(h.id);
    for (const c of b.aidCalls ?? []) for (const h of c.heroes ?? []) if (h.id) committed.add(h.id);
  }
  const reserveHeroIds = proposed.filter((id) => !locked.has(id) && !committed.has(id) && id.length > 0);
  return {
    reserveHeroIds,
    reserveTroops: Math.max(0, Math.trunc(st.warReserve?.troops) || 0),
    energy: Math.max(0, Math.trunc(st.warReserve?.energy) || 0),
  };
}
type BattleReservesLike = { reserveHeroIds: string[]; reserveTroops: number; energy: number };

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
  const reserves = battleReservesFor(st, heroes.map((h) => h.id));
  const res = issueDecision(battle, data.side, data.windowId, data.action, Date.now(), reserves, {
    heroes,
    troops: data.troops ?? 0,
  });
  if (!res.ok) return { ok: false, error: res.error };
  // ---- the real cost: deduct exactly what the engine stamped ----
  const r = st.warReserve;
  const e = res.decision.effects;
  if (e.kind === "reinforce") {
    r.energy = Math.max(0, r.energy - e.energySpent);
    r.troops = Math.max(0, r.troops - e.troopsAdded);
    for (const h of heroes) r.lockedHeroes[h.id] = { battleId: battle.id, until: battleEndAt(battle) };
  } else if (e.kind === "callAid") {
    r.energy = Math.max(0, r.energy - e.energySpent);
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
  const reserves = battleReservesFor(st, heroes.map((h) => h.id));
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
  }
  await saveAccountSaves(accountId, saves);
  return { ok: true, state: publicState(engine.advance(saves.games[saves.activeGameId], Date.now())), activeGameId: saves.activeGameId };
});

// ------- monetization seams (survey-only; NO storefront ships now) -------
// The catalog/ledger/entitlement layer is fully implemented (§7 of the spec);
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
  if (res.state) await saveActiveState(accountId, res.state);
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

/** THE payment-provider seam (spec §7.3/§7.4): a webhook payload is handed to
 *  the provider for verification; ONLY a verified purchase is applied. The
 *  handler knows nothing about the provider — swap createPaymentProvider()
 *  (one factory in monetization.ts) when real payments are wired. Idempotent
 *  by purchaseId. Store gated until the owner flips the switch. */
const confirmExternalPurchaseFn = createServerFn({ method: "POST" }).validator(
  z.object({ token: z.string(), payload: z.unknown() })
).handler(async ({ data }): Promise<GameResult> => {
  const accountId = await accountForToken(data.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in." };
  if (!MONETIZATION_CONFIG.storefrontEnabled) {
    return { ok: false, error: "Purchases are disabled during beta (§8.6)." };
  }
  const verified = await createPaymentProvider().verifyWebhook(data.payload);
  if (!verified.ok || !verified.purchase) {
    return { ok: false, error: verified.error ?? "Unverified purchase." };
  }
  const st = await loadActiveState(accountId);
  if (!st) return { ok: false, signedOut: true, error: "Start a colony first." };
  const res = applyExternalPurchase(st, verified.purchase, Date.now());
  if (res.state) await saveActiveState(accountId, res.state);
  return { ok: res.ok, error: res.error, state: res.state ? publicState(res.state) : undefined };
});

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
  beginResearchFn,
  chooseRevelationFn,
  allocateLeaderPointFn,
  chooseSpecializationFn,
  signupFn,
  loginFn,
  logoutFn,
  meFn,
  getWalletFn,
  getContributionFn,
  claimDailyRewardFn,
  purchaseWithVotivesFn,
  confirmExternalPurchaseFn,
  submitFeedbackFn,
  listMyFeedbackFn,
  dismissNoticeFn,
  battleIssueFn,
  battleRespondFn,
};
