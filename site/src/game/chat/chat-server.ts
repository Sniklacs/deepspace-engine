// chat-server.ts — THE RULES OF CHAT, in one place, with no React and no HTTP.
//
// This module is the server half of slice A1 (chat-mail-spec §1 · D7–D13). It owns
// exactly five things and nothing else:
//
//   1 · VALIDATION   — a message is trimmed, must be non-empty, and is capped at
//                      CHAT_MAX_MESSAGE characters (D12).
//   2 · THE GUARDS   — one message per 2 s per account, and no more than 30 in any
//                      rolling minute (D12, the feedback channel's precedent).
//   3 · THE LANGUAGE STAMP (D9) — the author's language is resolved ON THE SERVER,
//                      from the shipped registry, and stored on the row. A client
//                      cannot stamp a language the game does not ship, and nothing
//                      downstream ever re-derives it from a later claim.
//   4 · RETENTION    — the last CHAT_RETENTION messages of a channel; older lines
//                      are evicted oldest-first (D7).
//   5 · IDENTITY     — COLLECTIONS ARE RESOLVED BY EXACT COLONY NAME, case-folded,
//                      and nothing else (D10). No prefix search, no directory walk,
//                      no "did you mean".
//
// WHY IT IS SEPARATE FROM api.ts: api.ts wires zod validators to these functions.
// Keeping the rules here means the headless harness exercises the REAL rules — the
// same function the handler calls — instead of a re-implementation that agrees with
// itself. `chat-tests/chat-verify.ts` calls these directly against the filesystem
// store, which is the backend the battery runs on.

import { accountForToken } from "../auth";
import type { AccountSaves } from "../store";
import {
  appendChatMessage,
  countChatMessagesSince,
  evictChatMessages,
  lastChatMessageAt,
  loadAccountSaves,
  loadAllSaves,
  loadChatMessages,
  loadChatReads,
  loadChatThreadsFor,
  loadMailFor,
  loadMyRoomMemberships,
} from "../store";
import { isShippedLang, SOURCE_LANG } from "../i18n/languages";
import {
  CHAT_MAX_MESSAGE,
  CHAT_MAX_PER_MINUTE,
  CHAT_MIN_GAP_MS,
  CHAT_RETENTION,
  unreadBySurface,
  WORLD_CHANNEL,
  type ChatMessage,
  type ChatSurface,
} from "./chat-types";

// ── ids ─────────────────────────────────────────────────────────────────────
/** A message id. Same shape as the feedback channel's, so one dialect of id exists. */
export function chatId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── 1 · validation (D12) ────────────────────────────────────────────────────
export type BodyRefusal = "empty" | "tooLong";

/** Trim, reject empty, cap at CHAT_MAX_MESSAGE. Returns the body that would be stored. */
export function validateBody(raw: unknown): { ok: true; body: string } | { ok: false; code: BodyRefusal } {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) return { ok: false, code: "empty" };
  // Counted in code points, not UTF-16 units: a Persian or Russian message is
  // measured by the characters the player sees, so a 500-character letter is
  // never refused for being 500 "characters" plus surrogates.
  if ([...body].length > CHAT_MAX_MESSAGE) return { ok: false, code: "tooLong" };
  return { ok: true, body };
}

// ── 2 · the rate guards (D12) ───────────────────────────────────────────────
export type RateRefusal = "tooFast" | "tooMany";

/**
 * Both guards, against the real table. `lastAt` is the account's most recent
 * message and `inWindow` how many it sent in the last minute; both come from the
 * store so the rule cannot be satisfied by a client-side counter.
 */
export function rateRefusal(now: number, lastAt: number | null, inWindow: number): RateRefusal | null {
  if (lastAt !== null && now - lastAt < CHAT_MIN_GAP_MS) return "tooFast";
  if (inWindow >= CHAT_MAX_PER_MINUTE) return "tooMany";
  return null;
}

// ── 3 · the language stamp (D9) ─────────────────────────────────────────────
/**
 * What the row stores. A shipped code is kept as-is ("pt-BR" stays "pt-BR"); an
 * unknown or absent claim becomes the source language rather than an invented one,
 * so `lang` is ALWAYS something the catalogs and the bidi rules know.
 */
export function stampLang(claim: unknown): string {
  return typeof claim === "string" && isShippedLang(claim) ? claim : SOURCE_LANG;
}

// ── 5 · identity: exact colony name, nothing else (D10) ─────────────────────
/** The colony name an account is playing right now (its active game), or null. */
export function colonyNameIn(saves: AccountSaves | null): string | null {
  if (!saves) return null;
  const active = saves.activeGameId ? saves.games[saves.activeGameId] : undefined;
  const name = active?.playerName?.trim();
  if (name) return name;
  // No active slot: the most recently founded colony that has a race still names
  // the account. A colony with no race has no name yet and is skipped.
  const founded = Object.values(saves.games)
    .filter((g) => !!g.race && !!g.playerName?.trim())
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return founded[0]?.playerName?.trim() ?? null;
}

/** The account's own display name, resolved server-side at send time. */
export async function colonyNameFor(accountId: string): Promise<string | null> {
  return colonyNameIn(await loadAccountSaves(accountId));
}

const NAME_MAX = 32; // the signup name limit (auth.ts) — a longer name cannot exist

/**
 * Resolve a colony by name. EXACT MATCH, case-folded ("ashfall" finds "Ashfall"),
 * nothing else: no substring, no prefix, no browsing. The name is length-capped at
 * the signup limit before any comparison, so a paste bomb costs no rows.
 * Returns null when nothing — or more than nothing ambiguous — can be named.
 */
export function resolveColony(
  name: unknown,
  colonies: readonly { accountId: string; colonyName: string }[]
): { accountId: string; colonyName: string } | null {
  if (typeof name !== "string") return null;
  const want = name.trim().toLowerCase();
  if (!want || want.length > NAME_MAX) return null;
  const hits = colonies.filter((c) => c.colonyName.trim().toLowerCase() === want);
  // Two colonies may share a display name (only ACCOUNT names are unique), so an
  // ambiguous name resolves to nothing rather than to a guess about a stranger.
  return hits.length === 1 ? hits[0] : null;
}

/** Every named colony on this world — the input `resolveColony` is written against. */
export async function namedColonies(): Promise<Array<{ accountId: string; colonyName: string }>> {
  const all = await loadAllSaves();
  const out: Array<{ accountId: string; colonyName: string }> = [];
  for (const { accountId, saves } of all) {
    const name = colonyNameIn(saves);
    if (name) out.push({ accountId, colonyName: name });
  }
  return out;
}

/** Resolve a name against the world, on the server. The A1 door onto D10. */
export async function resolveColonyName(name: unknown): Promise<{ accountId: string; colonyName: string } | null> {
  return resolveColony(name, await namedColonies());
}

// ── the result shapes the API hands back ────────────────────────────────────
export interface ChatResult {
  ok: boolean;
  signedOut?: boolean;
  /** plain English, for logs and the operator — the UI renders `errorKey` */
  error?: string;
  /** a catalogue key the client renders in the player's own language */
  errorKey?: string;
  messages?: ChatMessage[];
  unread?: Record<ChatSurface, number>;
  /** server time at the moment of the answer */
  stamp?: number;
}

export interface ChatSendResult extends ChatResult {
  message?: ChatMessage;
  /** how many older rows the retention rule removed to make room (0 = nothing went) */
  evicted?: number;
}

// ── reading a channel ───────────────────────────────────────────────────────
/**
 * The world feed: the newest CHAT_RETENTION lines, oldest first. Signed-in only —
 * the sheet only exists inside the shell, so an anonymous caller asking for the
 * world's conversation is refused rather than served.
 */
export async function worldFeed(input: { token: string }): Promise<ChatResult> {
  const accountId = await accountForToken(input.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in.", errorKey: "chat.loggedOut" };
  const messages = await loadChatMessages(WORLD_CHANNEL, CHAT_RETENTION);
  return { ok: true, messages, stamp: Date.now() };
}

// ── writing to the world ────────────────────────────────────────────────────
/**
 * Post one line to the world. The whole rule chain in order: token → body →
 * guards → name → stamp → append → retention. Every refusal carries a catalogue
 * key, so the player is told what happened in their own language.
 */
export async function sendWorldMessage(input: {
  token: string;
  body: unknown;
  lang?: unknown;
}): Promise<ChatSendResult> {
  const accountId = await accountForToken(input.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in.", errorKey: "chat.loggedOut" };

  const valid = validateBody(input.body);
  if (!valid.ok) {
    return valid.code === "tooLong"
      ? { ok: false, error: "Message is too long.", errorKey: "chat.tooLong" }
      : { ok: false, error: "A message cannot be empty.", errorKey: "chat.sendFailed" };
  }

  const now = Date.now();
  const refusal = rateRefusal(now, await lastChatMessageAt(accountId), await countChatMessagesSince(accountId, now - 60_000));
  if (refusal) {
    return { ok: false, error: refusal === "tooFast" ? "Too soon." : "Too many in a minute.", errorKey: "chat.tooFast" };
  }

  const message: ChatMessage = {
    id: chatId("m"),
    channel: WORLD_CHANNEL,
    accountId,
    colonyName: (await colonyNameFor(accountId)) ?? accountId,
    lang: stampLang(input.lang),
    body: valid.body,
    createdAt: now,
  };
  await appendChatMessage(message);
  const evicted = await evictChatMessages(WORLD_CHANNEL, CHAT_RETENTION);
  return { ok: true, message, evicted, stamp: now };
}

// ── the poll: what changed, and what is unread ──────────────────────────────
/**
 * One answer for the open sheet: the world feed plus the unread counts. The counts
 * come from the SAME `unreadBySurface` the client renders, computed over the real
 * tables — so World and Covenant are structurally zero (D11) rather than zero by
 * accident.
 */
export async function chatSync(input: { token: string }): Promise<ChatResult> {
  const accountId = await accountForToken(input.token);
  if (!accountId) return { ok: false, signedOut: true, error: "Not signed in.", errorKey: "chat.loggedOut" };
  const [world, threads, memberships, reads, letters] = await Promise.all([
    loadChatMessages(WORLD_CHANNEL, CHAT_RETENTION),
    loadChatThreadsFor(accountId),
    loadMyRoomMemberships(accountId),
    loadChatReads(accountId),
    loadMailFor(accountId),
  ]);
  // Only the channels this account can actually see are gathered — a room it never
  // joined contributes nothing, so its messages cannot leak into a count. One
  // bounded read per visible channel (no full-table scan, no cross-channel leak).
  const visibleChannels = [
    ...memberships.map((m) => `room:${m.roomId}`),
    ...threads.map((t) => `personal:${t.id}`),
  ];
  const gathered = await Promise.all(visibleChannels.map((c) => loadChatMessages(c, CHAT_RETENTION)));
  const visible = gathered.flat().filter((m) => m.accountId !== accountId);
  const unread = unreadBySurface({
    messages: visible,
    letters,
    reads,
    threadIds: threads.map((t) => t.id),
    roomIds: memberships.map((m) => m.roomId),
    me: accountId,
  });
  return { ok: true, messages: world, unread, stamp: Date.now() };
}

// ── the mark that clears a count ────────────────────────────────────────────
/** The moment a channel was read up to (0 when never). Used by the UI's markRead. */
export function readAtFor(reads: readonly { channel: string; lastReadAt: number }[], channel: string): number {
  return reads.find((r) => r.channel === channel)?.lastReadAt ?? 0;
}
