// Mailbox — the in-game inbox (owner 2026-10-03).
//
// Hans: "everybody when they log into the game they should be checking their
// mailbox for alerts for announcements for updates on what's happened ... this
// should include everything in the alliance has happened."
//
// Plus: "whatever we update should be updated in the mailbox so [players are]
// getting a notification and know what's new."
//
// A persistent per-save inbox. Game events (sub colony upkeep, alliance
// activity, patch notes) generate messages automatically. Players see an
// unread badge in the header and read them in the mailbox view.
import type { GameState } from "./types";
import type { Tab } from "./nav-slots";

/** Where a mail message came from. */
export type MailCategory =
  | "alert" // something needs your attention (upkeep due, attack warning)
  | "announcement" // server/world announcements
  | "alliance" // war-band activity: joins, leaves, help, rallies
  | "update" // patch notes — what shipped
  | "supply" // sub colony supply upkeep
  | "battle"; // battle reports

/** Who sent it. */
export type MailFrom = "system" | "alliance" | "player";

export interface MailMessage {
  /** Unique id (msg-<epoch>-<rand>). */
  id: string;
  from: MailFrom;
  /** Display name of the sender ("The Unbound", alliance name, player name). */
  fromName: string;
  subject: string;
  body: string;
  category: MailCategory;
  /** Epoch ms when sent. */
  sentAt: number;
  read: boolean;
  /** Deep-link shortcut (owner 2026-10-04): a "Go to" button on the message
   *  that jumps straight to the page the mail is about. Absent on old
   *  messages — no button renders. */
  goTo?: MailGoTo;
}

/** Where a mail's "Go to" button takes you. */
export interface MailGoTo {
  /** The nav tab to open. */
  tab: Tab;
  /** Button label, e.g. "Open war band". */
  label: string;
}

/** Cap: keep the inbox bounded so ancient saves don't bloat. */
export const MAILBOX_CAP = 100;

function newId(now: number): string {
  return `msg-${now.toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

/** Lazily ensure the mailbox array exists (migration-safe for old saves). */
export function ensureMailbox(state: GameState): MailMessage[] {
  if (!state.mailbox) state.mailbox = [];
  return state.mailbox;
}

/** Append a message. Newest first. Caps at MAILBOX_CAP. */
export function sendMail(
  state: GameState,
  msg: {
    from?: MailFrom;
    fromName?: string;
    subject: string;
    body: string;
    category: MailCategory;
    sentAt?: number;
    /** Deep-link shortcut rendered as a "Go to" button (owner 2026-10-04). */
    goTo?: MailGoTo;
  },
): MailMessage {
  const box = ensureMailbox(state);
  const now = msg.sentAt ?? Date.now();
  const m: MailMessage = {
    id: newId(now),
    from: msg.from ?? "system",
    fromName: msg.fromName ?? "The Unbound",
    subject: msg.subject,
    body: msg.body,
    category: msg.category,
    sentAt: now,
    read: false,
    ...(msg.goTo ? { goTo: { tab: msg.goTo.tab, label: msg.goTo.label } } : {}),
  };
  box.unshift(m);
  if (box.length > MAILBOX_CAP) box.length = MAILBOX_CAP;
  return m;
}

/** Broadcast a game-update / patch-notes message. Called when we ship features. */
export function sendGameUpdate(
  state: GameState,
  subject: string,
  body: string,
  sentAt?: number,
): MailMessage {
  return sendMail(state, {
    from: "system",
    fromName: "The Unbound",
    subject,
    body,
    category: "update",
    sentAt,
  });
}

/** Mark one message read. Returns true if found. */
export function markRead(state: GameState, id: string): boolean {
  const box = ensureMailbox(state);
  const m = box.find((x) => x.id === id);
  if (!m) return false;
  m.read = true;
  return true;
}

/** Mark everything read. */
export function markAllRead(state: GameState): void {
  for (const m of ensureMailbox(state)) m.read = true;
}

/** Number of unread messages. */
export function unreadCount(state: GameState): number {
  return ensureMailbox(state).filter((m) => !m.read).length;
}

/** Delete a message (player cleanup). Returns true if removed. */
export function deleteMail(state: GameState, id: string): boolean {
  const box = ensureMailbox(state);
  const i = box.findIndex((x) => x.id === id);
  if (i < 0) return false;
  box.splice(i, 1);
  return true;
}
