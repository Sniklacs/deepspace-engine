// chat-store.ts — THE CLIENT'S CHAT STATE, and the ONE poll that feeds it.
//
// WHY A MODULE-LEVEL STORE AND NOT CONTEXT: the dock bar and the sheet are two
// different subtrees (one fixed above the nav, one inside a modal), and both must
// see the same open surface, the same feed and the same counts. A plain
// subscribe/getSnapshot pair with `useSyncExternalStore` gives both that, survives
// a re-render, and needs no provider in AppShell.
//
// THE POLLING RULE (chat-mail-spec §1 · D8) is the important part of this file:
//
//   • ONE call, `chatSyncFn`, on a ~5 s beat.
//   • It runs ONLY when the bar is on screen OR the sheet is open — a player
//     reading the Circuit does not pay for a chat poll — AND only while the
//     document is visible (`visibilitychange` pauses it; a backgrounded phone
//     stops talking to the server entirely).
//   • It NEVER rides the existing 4 s state poll. That poll is the game's clock;
//     chat is a different cadence, a different cost and a different failure mode.
//
// NOTHING HERE TOUCHES `dse.device.v1`. Chat's UI state (the open surface, the
// last surface opened) is chat state and lives here, in memory, for this session —
// the device record is gated by `i18n-verify` §7 and holds language and text size,
// not conversation state.
//
// HONEST LIMITS, stated here rather than discovered later:
//   • The unread counts are real (the server computes them from the tables), but
//     in A1 only the World surface is live — and World is never counted. So the
//     dock's chip reads 0 until A2 wires Personal, Rooms and Mail. The plumbing is
//     not stubbed; there is simply nothing counted to show yet.
//   • Translations are cached in memory by the translator itself: a reload loses
//     them. That is honest and accepted (chat-mail-spec §3.4) — nothing here
//     promises otherwise.

import { chatSyncFn, sendWorldFn } from "./chat-api";
import {
  CHAT_SURFACES,
  unreadChip,
  type ChatMessage,
  type ChatSurface,
} from "./chat-types";

export interface ChatState {
  /** the sheet is open */
  open: boolean;
  /** the surface the sheet is showing */
  surface: ChatSurface;
  /** the surface the bar names when nothing is unread */
  lastSurface: ChatSurface;
  /** the world feed, oldest first */
  messages: ChatMessage[];
  /** what is unread per surface (World and Covenant are structurally 0) */
  unread: Record<ChatSurface, number>;
  /** loading | ready | error — `error` never clears `messages` (stale-while-error) */
  phase: "idle" | "loading" | "ready" | "error";
  /** the catalogue key for the current failure, when there is one */
  errorKey: string | null;
  signedOut: boolean;
  sending: boolean;
  /** the signed-in account id — my own lines read "You" and sit at the logical end */
  me: string | null;
}

const ZERO_UNREAD = (): Record<ChatSurface, number> =>
  Object.fromEntries(CHAT_SURFACES.map((s) => [s, 0])) as Record<ChatSurface, number>;

function initialState(): ChatState {
  return {
    open: false,
    surface: "world",
    lastSurface: "world",
    messages: [],
    unread: ZERO_UNREAD(),
    phase: "idle",
    errorKey: null,
    signedOut: false,
    sending: false,
    me: null,
  };
}

/** The poll's beat. Slow enough to be cheap, fast enough to feel alive. */
export const CHAT_POLL_MS = 5_000;

let state: ChatState = initialState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* a subscriber that throws must not stop the others */
    }
  }
}

function set(patch: Partial<ChatState>): void {
  state = { ...state, ...patch };
  emit();
}

export function subscribeChat(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The live snapshot. Stable between changes (useSyncExternalStore requires it). */
export function chatSnapshot(): ChatState {
  return state;
}

/** What the server render sees: nothing is open, nothing is loaded, nobody is me. */
const SERVER_STATE: ChatState = initialState();
export function chatServerSnapshot(): ChatState {
  return SERVER_STATE;
}

/** The dock's chip, derived — never stored twice. */
export function chatChip(): { surface: ChatSurface | null; n: number } {
  return unreadChip(state.unread);
}

// ── identity + the poll's gate ──────────────────────────────────────────────
let token: string | null = null;
let dockVisible = false;
let docVisible = true;
let timer: ReturnType<typeof setInterval> | null = null;

/** Is the poll allowed to run at all right now? */
export function pollAllowed(): boolean {
  return !!token && (dockVisible || state.open) && docVisible;
}

function stopTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function syncTimer(): void {
  if (pollAllowed()) {
    if (timer === null) {
      timer = setInterval(() => {
        void refreshChat();
      }, CHAT_POLL_MS);
    }
  } else {
    stopTimer();
  }
}

/**
 * Point the store at the signed-in account. Called by the shell when the session
 * resolves. A null token stops everything and empties the feed, so a signed-out
 * device keeps no conversation on screen.
 *
 * `me` is only a PLACEHOLDER for who I am: the account id the server compares is
 * not knowable on the client, so every sync answers with it (`ChatResult.me`) and
 * that answer wins. Until the first sync lands there is nothing on screen to
 * judge, so the placeholder can never mislabel a line.
 */
export function configureChat(nextToken: string | null, me: string | null): void {
  // Same account: nothing to re-point, but the poll's gates may have changed while
  // a screen was away (the dock unmounts on the Circuit page).
  if (nextToken === token) {
    syncTimer();
    return;
  }
  token = nextToken;
  if (!nextToken) {
    stopTimer();
    state = initialState();
    emit();
    return;
  }
  set({ me });
  syncTimer();
}

/** The dock tells the store whether the bar is on screen (the poll's first gate). */
export function setDockVisible(visible: boolean): void {
  dockVisible = visible;
  syncTimer();
}

/** `visibilitychange` — a backgrounded app stops polling (the poll's second gate). */
export function setDocumentVisible(visible: boolean): void {
  docVisible = visible;
  syncTimer();
  if (visible && pollAllowed()) void refreshChat();
}

let listening = false;
/** Register the page-visibility listener once, on the client only. */
export function watchChatVisibility(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  setDocumentVisible(document.visibilityState !== "hidden");
  document.addEventListener("visibilitychange", () => {
    setDocumentVisible(document.visibilityState !== "hidden");
  });
}

// ── the sheet ───────────────────────────────────────────────────────────────
/** Open the sheet on a surface (default: the last one the player used). */
export function openChat(surface?: ChatSurface): void {
  watchChatVisibility();
  set({ open: true, ...(surface ? { surface, lastSurface: surface } : {}) });
  syncTimer();
  void refreshChat();
}

export function closeChat(): void {
  set({ open: false });
  syncTimer();
}

/** Switch tabs. The bar follows the player's last choice when nothing is unread. */
export function setChatSurface(surface: ChatSurface): void {
  set({ surface, lastSurface: surface });
}

// ── the poll ────────────────────────────────────────────────────────────────
/**
 * One sync. A failure KEEPS the last-known messages on screen (stale-while-error):
 * clearing the list because the network blinked would destroy the only copy of the
 * conversation the player can see.
 */
export async function refreshChat(): Promise<void> {
  if (!token) return;
  if (state.phase === "idle") set({ phase: "loading" });
  try {
    const res = await chatSyncFn({ data: { token } });
    if (res.signedOut) {
      stopTimer();
      set({ signedOut: true, phase: "error", errorKey: "chat.loggedOut" });
      return;
    }
    if (!res.ok) {
      set({ phase: "error", errorKey: "chat.loadFailed" });
      return;
    }
    set({
      messages: res.messages ?? state.messages,
      unread: res.unread ?? state.unread,
      // The server's answer is the authority on who I am (see configureChat).
      me: res.me ?? state.me,
      phase: "ready",
      errorKey: null,
      signedOut: false,
    });
  } catch {
    set({ phase: "error", errorKey: "chat.loadFailed" });
  }
}

// ── sending ─────────────────────────────────────────────────────────────────
export interface SendOutcome {
  ok: boolean;
  /** a catalogue key the composer renders in the player's own language */
  errorKey?: string;
}

/**
 * Post one line to the world. On success the returned row is appended locally (the
 * server's copy is the truth, and it carries the server's `lang` stamp), on failure
 * the caller keeps the typed text — the player's words are never thrown away.
 */
export async function sendChatMessage(body: string, lang: string): Promise<SendOutcome> {
  if (!token) return { ok: false, errorKey: "chat.loggedOut" };
  set({ sending: true });
  try {
    const res = await sendWorldFn({ data: { token, body, lang } });
    if (res.signedOut) {
      set({ sending: false, signedOut: true });
      return { ok: false, errorKey: "chat.loggedOut" };
    }
    if (!res.ok || !res.message) {
      set({ sending: false });
      return { ok: false, errorKey: res.errorKey ?? "chat.sendFailed" };
    }
    set({ messages: [...state.messages, res.message], sending: false });
    return { ok: true };
  } catch {
    set({ sending: false });
    return { ok: false, errorKey: "chat.sendFailed" };
  }
}
