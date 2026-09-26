// chat-types.ts — the shapes chat and mail are made of, and the ONE rule about
// which surface is allowed to carry an unread count (chat-mail-spec §1 · D11).
//
// Deliberately tiny and import-free, exactly like `game/i18n/types.ts`: this file
// is read by the browser (the store, the sheet) AND by the server (store.ts's
// tables, api.ts's handlers), so it may not reach for either world's runtime. Row
// shapes live here so the fs fallback and the Postgres tables cannot drift apart.
//
// WHAT IS NOT IN HERE, ON PURPOSE (D4): no presence field, no `typingAt`, no
// `lastSeen`, no `deliveredAt`, no read receipt. There is no such thing in this
// model. A message has an author, a body, the language it was written in, and the
// moment it landed — that is the whole record.

/** The five player-facing surfaces, in the order the tabs render them (D2). */
export type ChatSurface = "world" | "covenant" | "rooms" | "personal" | "mail";

/** Every surface, in tab order — the ONE list the tablist and the tests share. */
export const CHAT_SURFACES: readonly ChatSurface[] = ["world", "covenant", "rooms", "personal", "mail"];

/**
 * The four CHANNEL kinds a message can belong to. A `ChatMessage.channel` is the
 * flattened string key below; the kind is what the visibility rules are written
 * against (`surfaceForChannel`).
 */
export type ChatChannelKind = "world" | "covenant" | "room" | "personal";

/** The one world channel. Every colony on the world reads and writes it. */
export const WORLD_CHANNEL = "world";
/** The Covenant channel. No Covenant entity exists yet — the tab is honestly locked. */
export const COVENANT_CHANNEL = "covenant";

/** `room:<roomId>` — a joined room's channel. */
export function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}
/** `personal:<threadId>` — one private thread's channel. */
export function personalChannel(threadId: string): string {
  return `personal:${threadId}`;
}
/** Which kind a flattened channel key belongs to (unknown keys read as a room). */
export function channelKind(channel: string): ChatChannelKind {
  if (channel === WORLD_CHANNEL) return "world";
  if (channel === COVENANT_CHANNEL) return "covenant";
  if (channel.startsWith("personal:")) return "personal";
  return "room";
}
/** The surface a channel belongs to (a room channel is the Rooms surface, etc.). */
export function surfaceForChannel(channel: string): ChatSurface {
  switch (channelKind(channel)) {
    case "world":
      return "world";
    case "covenant":
      return "covenant";
    case "personal":
      return "personal";
    default:
      return "rooms";
  }
}

// ── the numbers (§1 · D12/D7) — shared by the server rules and the composer ───
/** Longest message body a player may send. The composer's maxLength is this. */
export const CHAT_MAX_MESSAGE = 500;
/** Longest letter subject. */
export const CHAT_MAX_SUBJECT = 80;
/** Retention: the last 200 messages per channel; older lines are evicted (D7). */
export const CHAT_RETENTION = 200;
/** One message every 2 seconds per account. */
export const CHAT_MIN_GAP_MS = 2_000;
/** …and no more than 30 in any rolling minute (the feedback channel's precedent). */
export const CHAT_MAX_PER_MINUTE = 30;

/** One message. `lang` is stamped SERVER-SIDE and never trusted from a later claim (D9). */
export interface ChatMessage {
  id: string;
  /** the flattened channel key: `world` · `covenant` · `room:<id>` · `personal:<id>` */
  channel: string;
  /** the authoring account id */
  accountId: string;
  /** the authoring colony's display name, as it stood when the line was written */
  colonyName: string;
  /** BCP-47-ish shipped language code of the AUTHOR at send time (D9) */
  lang: string;
  body: string;
  createdAt: number;
}

/** A private thread. It stays open until either side closes it (D13). */
export interface ChatThread {
  id: string;
  /** the two participants, in creation order */
  a: string;
  b: string;
  createdAt: number;
  /** non-null once one side closed the thread; a closed thread is not written to */
  closedAt: number | null;
}

/** A room in the directory. Joining is what makes its channel visible. */
export interface ChatRoom {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
}

/** Membership. Only a member sees a room's channel. */
export interface RoomMember {
  roomId: string;
  accountId: string;
  joinedAt: number;
}

/** One player's read mark for one channel — the ONLY source of an unread count. */
export interface ChatRead {
  accountId: string;
  channel: string;
  lastReadAt: number;
}

/** A letter: server-stored, player-to-player, and it survives being offline (D14). */
export interface MailLetter {
  id: string;
  fromAccount: string;
  fromName: string;
  toAccount: string;
  subject: string;
  body: string;
  lang: string;
  createdAt: number;
  readAt: number | null;
}

/**
 * UNREAD SEMANTICS (D11). Only Personal, Mail and joined Rooms carry a count.
 * World and Covenant NEVER do — they are open floors, and a number on them would
 * be a notification the player never asked for. `nav-badges.ts` is untouched: its
 * contract stays "an action is available here", never a count of what was said.
 */
export const COUNTED_SURFACES: readonly ChatSurface[] = ["personal", "rooms", "mail"];

/** May this surface ever show an unread count? (World and Covenant: no.) */
export function surfaceCountsUnread(surface: ChatSurface): boolean {
  return COUNTED_SURFACES.includes(surface);
}

/** Everything the unread rule needs. No server, no clock — the caller supplies the lists. */
export interface UnreadInput {
  /** messages addressed to me (my threads + my rooms) */
  messages: readonly ChatMessage[];
  /** letters addressed to me */
  letters: readonly MailLetter[];
  /** MY read marks */
  reads: readonly ChatRead[];
  /** the thread ids I take part in */
  threadIds: readonly string[];
  /** the room ids I have joined */
  roomIds: readonly string[];
  /** my account id — my own lines are never unread */
  me: string;
}

function readMark(reads: readonly ChatRead[], channel: string): number {
  return reads.find((r) => r.channel === channel)?.lastReadAt ?? 0;
}

/**
 * The count per surface. Always a full record — a surface with nothing unread is
 * a real 0, so the dock never has to distinguish "no data" from "nothing new".
 */
export function unreadBySurface(input: UnreadInput): Record<ChatSurface, number> {
  const out: Record<ChatSurface, number> = { world: 0, covenant: 0, rooms: 0, personal: 0, mail: 0 };
  const myThreads = new Set(input.threadIds.map(personalChannel));
  const myRooms = new Set(input.roomIds.map(roomChannel));
  for (const m of input.messages) {
    // World and Covenant are structurally excluded, not merely left at zero:
    // a future caller cannot make them count by passing the wrong list.
    const surface = surfaceForChannel(m.channel);
    if (!surfaceCountsUnread(surface)) continue;
    if (m.accountId === input.me) continue;
    if (surface === "personal" && !myThreads.has(m.channel)) continue;
    if (surface === "rooms" && !myRooms.has(m.channel)) continue;
    if (m.createdAt > readMark(input.reads, m.channel)) out[surface]++;
  }
  out.mail = input.letters.filter((l) => l.toAccount === input.me && l.readAt === null).length;
  return out;
}

/**
 * The dock's priority order for the ONE chip it shows: the count of the highest
 * surface in this list. World and Covenant cannot appear (D11/§3.1).
 */
export const UNREAD_PRIORITY: readonly ChatSurface[] = ["personal", "mail", "rooms"];

/** The chip's number: the first non-zero surface in priority order, else 0. */
export function unreadChip(counts: Record<ChatSurface, number>): { surface: ChatSurface | null; n: number } {
  for (const s of UNREAD_PRIORITY) {
    if (counts[s] > 0) return { surface: s, n: counts[s] };
  }
  return { surface: null, n: 0 };
}
