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
  appendChatRoom,
  appendChatThread,
  appendMailLetter,
  appendRoomMember,
  closeChatThread,
  countChatMessagesSince,
  evictChatMessages,
  lastChatMessageAt,
  loadAccountSaves,
  loadAllSaves,
  loadChatMessages,
  loadChatReads,
  loadChatRooms,
  loadChatThreadsFor,
  loadMailFor,
  loadMyRoomMemberships,
  markMailLetterRead,
  removeRoomMember,
  saveChatRead,
} from "../store";
import { isShippedLang, SOURCE_LANG } from "../i18n/languages";
import {
  channelKind,
  CHAT_MAX_MESSAGE,
  CHAT_MAX_PER_MINUTE,
  CHAT_MAX_SUBJECT,
  CHAT_MIN_GAP_MS,
  CHAT_RETENTION,
  covenantChannel,
  personalChannel,
  roomChannel,
  unreadBySurface,
  WORLD_CHANNEL,
  type ChatCovenant,
  type ChatMessage,
  type ChatRoomView,
  type ChatSurface,
  type ChatThreadView,
  type MailLetter,
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
  /**
   * The signed-in account id, as the SERVER resolved it. The client cannot derive
   * it (the session token is not an account id), and it needs it for one honest
   * question only: is this line mine? A client that guessed would either label
   * another colony's words "You" or push my own line to the wrong side of the
   * thread. Never contains anything the account itself could not already read.
   */
  me?: string;
  /** server time at the moment of the answer */
  stamp?: number;
  /** the player's Covenant (slice A2), when the answer carries it */
  covenant?: ChatCovenant | null;
}

/** The lists answer (slice A2): everything the Rooms/Personal/Mail tabs render. */
export interface ChatListsResult extends ChatResult {
  threads?: ChatThreadView[];
  rooms?: ChatRoomView[];
  letters?: MailLetter[];
}

/** The open-thread answer: which channel the composer should now write to. */
export interface ChatOpenThreadResult extends ChatResult {
  threadId?: string;
  channel?: string;
  otherName?: string;
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
  return { ok: true, messages, me: accountId, stamp: Date.now() };
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
  const covenant = await covenantFor(accountId);
  return { ok: true, messages: world, unread, me: accountId, stamp: Date.now(), covenant };
}

// ── the mark that clears a count ────────────────────────────────────────────
/** The moment a channel was read up to (0 when never). Used by the UI's markRead. */
export function readAtFor(reads: readonly { channel: string; lastReadAt: number }[], channel: string): number {
  return reads.find((r) => r.channel === channel)?.lastReadAt ?? 0;
}

// ══ SLICE A2 — every other surface, live ════════════════════════════════════
//
// The same rule chain as the world, widened honestly: a channel is visible
// ONLY to the accounts its kind admits (covenant = band members, room =
// joined members, personal = the two participants), and every read and write
// passes `canSeeChannel` before it touches a row. A channel a player cannot
// see answers exactly like one that does not exist.

const SIGNED_OUT: ChatResult = { ok: false, signedOut: true, error: "Not signed in.", errorKey: "chat.loggedOut" };

/**
 * The player's Covenant: their alliance (the war band), resolved from their
 * own saves. Membership is by colonyId === the game's id — the same identity
 * the alliance roster itself uses. The active game wins; any game is proof.
 */
export async function covenantFor(accountId: string): Promise<ChatCovenant | null> {
  const saves = await loadAccountSaves(accountId);
  if (!saves) return null;
  const ids = Object.keys(saves.games);
  const ordered =
    saves.activeGameId && saves.games[saves.activeGameId]
      ? [saves.activeGameId, ...ids.filter((g) => g !== saves.activeGameId)]
      : ids;
  for (const gid of ordered) {
    const game = saves.games[gid];
    const colonyId = game.gameId ?? gid;
    for (const alliance of Object.values(game.alliances ?? {})) {
      if (alliance.members.some((m) => m.colonyId === colonyId)) {
        return { allianceId: alliance.id, name: alliance.name, channel: covenantChannel(alliance.id) };
      }
    }
  }
  return null;
}

/** May this account see (and therefore write to) this channel at all? */
export async function canSeeChannel(accountId: string, channel: string): Promise<boolean> {
  const kind = channelKind(channel);
  if (kind === "world") return true;
  if (kind === "covenant") {
    const cov = await covenantFor(accountId);
    return !!cov && cov.channel === channel;
  }
  if (kind === "personal") {
    const threadId = channel.slice(personalChannel("").length);
    const threads = await loadChatThreadsFor(accountId);
    return threads.some((t) => t.id === threadId);
  }
  const roomId = channel.slice(roomChannel("").length);
  const memberships = await loadMyRoomMemberships(accountId);
  return memberships.some((m) => m.roomId === roomId);
}

/** One non-world channel's feed, visibility-checked. */
export async function channelFeed(input: { token: string; channel: string }): Promise<ChatResult> {
  const accountId = await accountForToken(input.token);
  if (!accountId) return SIGNED_OUT;
  if (!(await canSeeChannel(accountId, input.channel))) {
    return { ok: false, error: "Channel not available.", errorKey: "chat.loadFailed" };
  }
  const messages = await loadChatMessages(input.channel, CHAT_RETENTION);
  return { ok: true, messages, me: accountId, stamp: Date.now() };
}

/**
 * Post one line to any visible channel. The world's rule chain, unchanged —
 * body, guards, name, stamp, append, retention — plus the two channel rules:
 * an unseen channel refuses like a missing one, and a CLOSED personal thread
 * is not written to (D13).
 */
export async function sendChannelMessage(input: {
  token: string;
  channel: string;
  body: unknown;
  lang?: unknown;
}): Promise<ChatSendResult> {
  const accountId = await accountForToken(input.token);
  if (!accountId) return SIGNED_OUT;

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

  if (!(await canSeeChannel(accountId, input.channel))) {
    return { ok: false, error: "Channel not available.", errorKey: "chat.sendFailed" };
  }
  if (channelKind(input.channel) === "personal") {
    const threadId = input.channel.slice(personalChannel("").length);
    const threads = await loadChatThreadsFor(accountId);
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) return { ok: false, error: "Channel not available.", errorKey: "chat.sendFailed" };
    if (thread.closedAt !== null) {
      return { ok: false, error: "This conversation is closed.", errorKey: "chat.threadClosed" };
    }
  }

  const message: ChatMessage = {
    id: chatId("m"),
    channel: input.channel,
    accountId,
    colonyName: (await colonyNameFor(accountId)) ?? accountId,
    lang: stampLang(input.lang),
    body: valid.body,
    createdAt: now,
  };
  await appendChatMessage(message);
  const evicted = await evictChatMessages(input.channel, CHAT_RETENTION);
  return { ok: true, message, evicted, stamp: now };
}

/** Mark a visible channel read up to now — the only way a count clears (D11). */
export async function markChannelRead(input: { token: string; channel: string }): Promise<ChatResult> {
  const accountId = await accountForToken(input.token);
  if (!accountId) return SIGNED_OUT;
  if (channelKind(input.channel) === "world") return { ok: true, me: accountId, stamp: Date.now() };
  if (!(await canSeeChannel(accountId, input.channel))) {
    return { ok: false, error: "Channel not available.", errorKey: "chat.loadFailed" };
  }
  await saveChatRead(accountId, input.channel, Date.now());
  return { ok: true, me: accountId, stamp: Date.now() };
}

/** Unread lines in one channel for one account, from the real read mark. */
async function channelUnread(accountId: string, channel: string, reads: { channel: string; lastReadAt: number }[]): Promise<number> {
  const since = readAtFor(reads, channel);
  const messages = await loadChatMessages(channel, CHAT_RETENTION);
  return messages.filter((m) => m.accountId !== accountId && m.createdAt > since).length;
}

/** Everything the Rooms, Personal and Mail tabs render, in one answer. */
export async function chatLists(input: { token: string }): Promise<ChatListsResult> {
  const accountId = await accountForToken(input.token);
  if (!accountId) return SIGNED_OUT;
  const [threads, rooms, allMembers, myMemberships, reads, letters, covenant] = await Promise.all([
    loadChatThreadsFor(accountId),
    loadChatRooms(),
    loadMyRoomMemberships(null),
    loadMyRoomMemberships(accountId),
    loadChatReads(accountId),
    loadMailFor(accountId),
    covenantFor(accountId),
  ]);
  const joined = new Set(myMemberships.map((m) => m.roomId));
  const threadViews: ChatThreadView[] = await Promise.all(
    threads.map(async (thread) => {
      const otherAccount = thread.a === accountId ? thread.b : thread.a;
      const channel = personalChannel(thread.id);
      const messages = await loadChatMessages(channel, CHAT_RETENTION);
      const last = messages[messages.length - 1];
      const since = readAtFor(reads, channel);
      return {
        thread,
        otherAccount,
        otherName: (await colonyNameFor(otherAccount)) ?? otherAccount,
        lastBody: last?.body ?? null,
        lastAt: last?.createdAt ?? null,
        unread: messages.filter((m) => m.accountId !== accountId && m.createdAt > since).length,
      };
    })
  );
  // Newest conversation first; a thread nobody has written in sits by its birth.
  threadViews.sort((x, y) => (y.lastAt ?? y.thread.createdAt) - (x.lastAt ?? x.thread.createdAt));
  const roomViews: ChatRoomView[] = await Promise.all(
    rooms.map(async (room) => ({
      room,
      joined: joined.has(room.id),
      memberCount: allMembers.filter((m) => m.roomId === room.id).length,
      unread: joined.has(room.id) ? await channelUnread(accountId, roomChannel(room.id), reads) : 0,
    }))
  );
  return { ok: true, threads: threadViews, rooms: roomViews, letters, covenant, me: accountId, stamp: Date.now() };
}

/**
 * Open (or resume) a personal thread with a colony, by EXACT name (D10). A
 * closed thread is never resurrected — a fresh one is born, and the closed
 * one stays in the list as read-only history (D13).
 */
export async function openThread(input: { token: string; colonyName: unknown }): Promise<ChatOpenThreadResult> {
  const accountId = await accountForToken(input.token);
  if (!accountId) return SIGNED_OUT;
  const hit = await resolveColonyName(input.colonyName);
  if (!hit) return { ok: false, error: "No colony by that name.", errorKey: "chat.noSuchColony" };
  if (hit.accountId === accountId) {
    return { ok: false, error: "That is your own colony.", errorKey: "chat.selfThread" };
  }
  const mine = await loadChatThreadsFor(accountId);
  const existing = mine.find(
    (t) => t.closedAt === null && ((t.a === accountId && t.b === hit.accountId) || (t.b === accountId && t.a === hit.accountId))
  );
  if (existing) {
    return { ok: true, threadId: existing.id, channel: personalChannel(existing.id), otherName: hit.colonyName, me: accountId };
  }
  const thread = { id: chatId("t"), a: accountId, b: hit.accountId, createdAt: Date.now(), closedAt: null };
  await appendChatThread(thread);
  return { ok: true, threadId: thread.id, channel: personalChannel(thread.id), otherName: hit.colonyName, me: accountId };
}

/** Close a thread I take part in. Either side may close; the lines stay (D13). */
export async function closeThread(input: { token: string; threadId: string }): Promise<ChatResult> {
  const accountId = await accountForToken(input.token);
  if (!accountId) return SIGNED_OUT;
  const mine = await loadChatThreadsFor(accountId);
  const thread = mine.find((t) => t.id === input.threadId);
  if (!thread) return { ok: false, error: "No such conversation.", errorKey: "chat.loadFailed" };
  if (thread.closedAt === null) await closeChatThread(thread.id, Date.now());
  return { ok: true, me: accountId, stamp: Date.now() };
}

const ROOM_NAME_MAX = 40;

/** Create a room and stand inside it — the creator is its first member. */
export async function createRoom(input: { token: string; name: unknown }): Promise<ChatResult & { roomId?: string; channel?: string }> {
  const accountId = await accountForToken(input.token);
  if (!accountId) return SIGNED_OUT;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || [...name].length > ROOM_NAME_MAX) {
    return { ok: false, error: "A room needs a name.", errorKey: "chat.roomName" };
  }
  const room = { id: chatId("r"), name, createdBy: accountId, createdAt: Date.now() };
  await appendChatRoom(room);
  await appendRoomMember({ roomId: room.id, accountId, joinedAt: room.createdAt });
  return { ok: true, roomId: room.id, channel: roomChannel(room.id), me: accountId, stamp: room.createdAt };
}

/** Join a room in the directory. Joining is what makes its channel visible. */
export async function joinRoom(input: { token: string; roomId: string }): Promise<ChatResult> {
  const accountId = await accountForToken(input.token);
  if (!accountId) return SIGNED_OUT;
  const rooms = await loadChatRooms();
  if (!rooms.some((r) => r.id === input.roomId)) {
    return { ok: false, error: "No such room.", errorKey: "chat.noSuchRoom" };
  }
  await appendRoomMember({ roomId: input.roomId, accountId, joinedAt: Date.now() });
  return { ok: true, me: accountId, stamp: Date.now() };
}

/** Leave a room. Its channel closes to me; its history stays for its members. */
export async function leaveRoom(input: { token: string; roomId: string }): Promise<ChatResult> {
  const accountId = await accountForToken(input.token);
  if (!accountId) return SIGNED_OUT;
  await removeRoomMember(input.roomId, accountId);
  return { ok: true, me: accountId, stamp: Date.now() };
}

/** Send a letter to a colony by EXACT name (D10/D14). It waits for them, offline or not. */
export async function sendLetter(input: {
  token: string;
  colonyName: unknown;
  subject: unknown;
  body: unknown;
  lang?: unknown;
}): Promise<ChatResult> {
  const accountId = await accountForToken(input.token);
  if (!accountId) return SIGNED_OUT;
  const hit = await resolveColonyName(input.colonyName);
  if (!hit) return { ok: false, error: "No colony by that name.", errorKey: "chat.noSuchColony" };
  if (hit.accountId === accountId) {
    return { ok: false, error: "That is your own colony.", errorKey: "chat.selfThread" };
  }
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  if (!subject || [...subject].length > CHAT_MAX_SUBJECT) {
    return { ok: false, error: "A letter needs a subject.", errorKey: "chat.letterSubject" };
  }
  const valid = validateBody(input.body);
  if (!valid.ok) {
    return valid.code === "tooLong"
      ? { ok: false, error: "Letter is too long.", errorKey: "chat.tooLong" }
      : { ok: false, error: "A letter cannot be empty.", errorKey: "chat.sendFailed" };
  }
  await appendMailLetter({
    id: chatId("L"),
    fromAccount: accountId,
    fromName: (await colonyNameFor(accountId)) ?? accountId,
    toAccount: hit.accountId,
    subject,
    body: valid.body,
    lang: stampLang(input.lang),
    createdAt: Date.now(),
    readAt: null,
  });
  return { ok: true, me: accountId, stamp: Date.now() };
}

/** Mark one of MY received letters read. A letter that is not mine does not move. */
export async function markLetterRead(input: { token: string; letterId: string }): Promise<ChatResult> {
  const accountId = await accountForToken(input.token);
  if (!accountId) return SIGNED_OUT;
  const letters = await loadMailFor(accountId);
  if (!letters.some((l) => l.id === input.letterId)) {
    return { ok: false, error: "No such letter.", errorKey: "chat.loadFailed" };
  }
  await markMailLetterRead(input.letterId, Date.now());
  return { ok: true, me: accountId, stamp: Date.now() };
}
