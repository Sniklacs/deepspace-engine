// Server-only persistence layer.
//
// Multi-account persistence for the MVP:
//   data/accounts.json  — account records (salted scrypt password hashes).
//   data/sessions.json  — session tokens → accountId (so logins survive restarts).
//   data/saves/<id>.json — one save file per account.
//
// Every account has its OWN save; a token resolves to an account and every read
// or write targets that account's file, so one account can never touch another's.
import path from "node:path";
import fs from "node:fs";
import type { GameState, FeedbackRecord } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const SAVES_DIR = path.join(DATA_DIR, "saves");
const ACCOUNTS_PATH = path.join(DATA_DIR, "accounts.json");
const SESSIONS_PATH = path.join(DATA_DIR, "sessions.json");
const FEEDBACK_PATH = path.join(DATA_DIR, "feedback.json");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    ensureDir(path.dirname(file));
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (e) {
    console.error("Failed to read", file, e);
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  try {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to write", file, e);
  }
}

// Account ids are normalized usernames — already safe (letters/digits), but
// belt-and-braces sanitize so a path can never escape the saves dir.
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function savePathFor(accountId: string): string {
  return path.join(SAVES_DIR, sanitize(accountId) + ".json");
}

// ------- per-account game saves (multi-game, version 2) -------
//
// data/saves/<accountId>.json now holds ALL of the account's games in one file:
//   { version: 2, activeGameId: string|null, games: { [gameId]: GameState } }
// Each game is one race + one colony. Migration: a legacy file that is a bare
// GameState (no `.games` wrapper) is wrapped as the single game "0".

/** Maximum number of colonies (games) one account can hold. */
export const MAX_GAMES = 5;

export interface AccountSaves {
  version: 2;
  activeGameId: string | null;
  games: Record<string, GameState>;
}

export function emptySaves(): AccountSaves {
  return { version: 2, activeGameId: null, games: {} };
}

export function loadAccountSaves(accountId: string): AccountSaves | null {
  const p = savePathFor(accountId);
  try {
    ensureDir(SAVES_DIR);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
    // Migration: a bare GameState (no `games` key) → wrap as the single game "0".
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      !("games" in (raw as object))
    ) {
      const legacy = raw as GameState;
      if (!legacy.gameId) legacy.gameId = "0";
      const migrated: AccountSaves = { version: 2, activeGameId: "0", games: { "0": legacy } };
      saveAccountSaves(accountId, migrated);
      return migrated;
    }
    return raw as AccountSaves;
  } catch (e) {
    console.error("Failed to load account saves:", e);
    return null;
  }
}

export function saveAccountSaves(accountId: string, saves: AccountSaves) {
  try {
    ensureDir(SAVES_DIR);
    fs.writeFileSync(savePathFor(accountId), JSON.stringify(saves, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save account saves:", e);
  }
}

/**
 * Every account save file on this server (the world). Read-only enumeration
 * used by the contribution leaderboard to score ALL colonies on the world.
 * Legacy files may be migrated back to disk on load (the same path any read
 * takes); unreadable/missing files are skipped, never fatal.
 */
export function loadAllSaves(): Array<{ accountId: string; saves: AccountSaves }> {
  const out: Array<{ accountId: string; saves: AccountSaves }> = [];
  let files: string[] = [];
  try {
    ensureDir(SAVES_DIR);
    files = fs.existsSync(SAVES_DIR)
      ? fs.readdirSync(SAVES_DIR).filter((f) => f.endsWith(".json"))
      : [];
  } catch (e) {
    console.error("Failed to list saves:", e);
    return out;
  }
  for (const f of files) {
    const accountId = f.replace(/\.json$/, "");
    const saves = loadAccountSaves(accountId);
    if (saves) out.push({ accountId, saves });
  }
  return out;
}

export function removeAccountSave(accountId: string) {
  try {
    const p = savePathFor(accountId);
    if (fs.existsSync(p)) fs.rmSync(p);
  } catch (e) {
    console.error("Failed to remove account save:", e);
  }
}

// ------- accounts -------

export interface AccountRecord {
  passwordHash: string; // hex of scrypt(password, salt)
  salt: string; // hex
  createdAt: number;
  // First-Run feedback nudge: true once the player has dismissed it. Absent
  // (or false) means the nudge is still owed on their next successful login.
  noticeDismissed?: boolean;
}
export type AccountMap = Record<string, AccountRecord>;

export function loadAccounts(): AccountMap {
  return readJson<AccountMap>(ACCOUNTS_PATH, {});
}

export function saveAccounts(a: AccountMap) {
  writeJson(ACCOUNTS_PATH, a);
}

export function deleteAccountRecord(accountId: string) {
  const accounts = loadAccounts();
  if (accounts[accountId]) {
    delete accounts[accountId];
    saveAccounts(accounts);
  }
}

// ------- sessions -------

export interface SessionRecord {
  accountId: string;
  createdAt: number;
}
export type SessionMap = Record<string, SessionRecord>;

export function loadSessions(): SessionMap {
  return readJson<SessionMap>(SESSIONS_PATH, {});
}

export function saveSessions(s: SessionMap) {
  writeJson(SESSIONS_PATH, s);
}
// ------- beta feedback channel (First Run) -------
// data/feedback.json holds every player's beta submissions in ONE file so the
// team can read the whole list directly. A player only ever receives their own
// records back through the API (listMyFeedbackFn filters by accountId).
export interface FeedbackFile {
  version: 1;
  submissions: FeedbackRecord[];
}
const FEEDBACK_VERSION = 1 as const;
export function loadFeedback(): FeedbackFile {
  const f = readJson<Partial<FeedbackFile>>(FEEDBACK_PATH, { version: FEEDBACK_VERSION, submissions: [] });
  const submissions = Array.isArray(f?.submissions) ? f.submissions : [];
  return { version: FEEDBACK_VERSION, submissions };
}
export function saveFeedback(file: FeedbackFile) {
  writeJson(FEEDBACK_PATH, file);
}
