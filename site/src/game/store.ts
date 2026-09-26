// Server-only persistence layer.
//
// Two backends behind ONE async interface (every exported function returns a
// Promise; arguments and return shapes are unchanged from the v1 sync API):
//
//   • Neon Postgres (@neondatabase/serverless) — used when
//     process.env.DATABASE_URL is set (the serverless/live runtime). The
//     serverless filesystem is EPHEMERAL and is wiped on every deploy, so a
//     deploy must never be the thing that stores a colony. Tables are
//     auto-created on first connection and reused across warm starts.
//
//   • Local filesystem (data/accounts.json, data/sessions.json,
//     data/saves/<id>.json, data/feedback.json) — the dev-sandbox / headless
//     battery fallback, used when DATABASE_URL is absent. Unchanged behavior.
//
// ── Postgres schema (CREATE TABLE IF NOT EXISTS on first use) ──────────────
//   accounts(account_id      TEXT PRIMARY KEY,
//            password_hash   TEXT NOT NULL,
//            salt            TEXT NOT NULL,
//            created_at      BIGINT NOT NULL,      -- epoch ms (int8 → Number on read)
//            notice_dismissed BOOLEAN)             -- one row per account record
//   saves(account_id TEXT PRIMARY KEY, data JSONB NOT NULL)
//     one row per account; `data` holds the ENTIRE v2 AccountSaves wrapper
//     {version:2, activeGameId, games:{...}} so the legacy-migration path in
//     loadAccountSaves is byte-identical on both backends (a bare GameState
//     blob is wrapped as the single game "0" and written back).
//   sessions(token TEXT PRIMARY KEY, account_id TEXT NOT NULL,
//            created_at BIGINT NOT NULL)           -- one row per session token
//   feedback(id INTEGER PRIMARY KEY CHECK (id = 1), data JSONB NOT NULL)
//     a single row holding the whole FeedbackFile {version:1, submissions:[...]}
//     — mirrors the one-file shape of data/feedback.json.
//
// EVERY SQL statement is parameterized ($1, $2, …); user data is NEVER
// interpolated into a query string. Table/column names are module constants
// only. There is intentionally NO data migration from files → DB: the live
// environment has no durable data to migrate, and the dev sandbox stays on
// the filesystem path.
//
// Multi-account invariants (both backends): every account has its OWN save row
// / file; a token resolves to an account and every read or write targets that
// account, so one account can never touch another's.
import path from "node:path";
import fs from "node:fs";
import { Pool } from "@neondatabase/serverless";
import type { GameState, FeedbackRecord } from "./types";
import type {
  ChatMessage,
  ChatRead,
  ChatRoom,
  ChatThread,
  MailLetter,
  RoomMember,
} from "./chat/chat-types";
import { CHAT_RETENTION } from "./chat/chat-types";

// ── backend selection ───────────────────────────────────────────────────────
const USE_DB = !!process.env.DATABASE_URL;

const DATA_DIR = path.join(process.cwd(), "data");
const SAVES_DIR = path.join(DATA_DIR, "saves");
const ACCOUNTS_PATH = path.join(DATA_DIR, "accounts.json");
const SESSIONS_PATH = path.join(DATA_DIR, "sessions.json");
const FEEDBACK_PATH = path.join(DATA_DIR, "feedback.json");
// Chat + mail, slice A1: ONE file on the fallback backend holding all six tables
// (the same one-file shape as feedback.json), and six real tables on Postgres.
const CHAT_PATH = path.join(DATA_DIR, "chat.json");

// Lazy singleton pool — created on first DB use, reused across serverless warm
// starts (never .end()'d per request; that would kill pooled connections).
let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  return pool;
}

// Auto-create the schema once per process; reset on failure so the next call
// retries instead of caching a broken promise.
let tablesReady: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      await db().query(`CREATE TABLE IF NOT EXISTS accounts (
        account_id TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        notice_dismissed BOOLEAN
      )`);
      await db().query(`CREATE TABLE IF NOT EXISTS saves (
        account_id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      )`);
      await db().query(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )`);
      await db().query(`CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data JSONB NOT NULL
      )`);
      // ── chat + mail, slice A1 (chat-mail-spec §1 · D7) ────────────────────
      // SIX tables, one per row shape — never one JSONB blob, so retention,
      // deletion and the per-account guards are real SQL, not read-modify-write
      // of a single document. The fallback backend mirrors the same six sets in
      // `data/chat.json` so the headless battery (no DATABASE_URL) exercises the
      // identical rules.
      await db().query(`CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        account_id TEXT NOT NULL,
        colony_name TEXT NOT NULL,
        lang TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )`);
      await db().query(`CREATE TABLE IF NOT EXISTS chat_threads (
        id TEXT PRIMARY KEY,
        a TEXT NOT NULL,
        b TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        closed_at BIGINT
      )`);
      await db().query(`CREATE TABLE IF NOT EXISTS chat_rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )`);
      await db().query(`CREATE TABLE IF NOT EXISTS chat_room_members (
        room_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        joined_at BIGINT NOT NULL,
        PRIMARY KEY (room_id, account_id)
      )`);
      await db().query(`CREATE TABLE IF NOT EXISTS chat_reads (
        account_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        last_read_at BIGINT NOT NULL,
        PRIMARY KEY (account_id, channel)
      )`);
      await db().query(`CREATE TABLE IF NOT EXISTS mail_letters (
        id TEXT PRIMARY KEY,
        from_account TEXT NOT NULL,
        from_name TEXT NOT NULL,
        to_account TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        lang TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        read_at BIGINT
      )`);
    })().catch((e) => {
      tablesReady = null; // allow a retry on the next call
      throw e;
    });
  }
  return tablesReady;
}

// ── filesystem helpers (fallback backend) ───────────────────────────────────
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
// data/saves/<accountId>.json (or the saves row's `data` column) holds ALL of
// the account's games in one object:
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

/**
 * Shared legacy migration (both backends): a bare GameState (no `games` key)
 * → wrap as the single game "0". Returns null for unusable (non-object)
 * payloads so both backends treat corrupt rows/files the same way.
 */
function migrateLegacy(raw: unknown): AccountSaves | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!("games" in (raw as object))) {
    const legacy = raw as GameState;
    if (!legacy.gameId) legacy.gameId = "0";
    const migrated: AccountSaves = { version: 2, activeGameId: "0", games: { "0": legacy } };
    return migrated;
  }
  return raw as AccountSaves;
}

export async function loadAccountSaves(accountId: string): Promise<AccountSaves | null> {
  if (USE_DB) {
    try {
      await ensureTables();
      const res = await db().query("SELECT data FROM saves WHERE account_id = $1", [accountId]);
      if (!res.rows.length) return null;
      const row = res.rows[0].data as unknown;
      const saves = migrateLegacy(row);
      if (saves === null) return null;
      // Migrated a legacy row in memory → persist the wrapper (same as fs path).
      if (!("games" in (row as object))) await saveAccountSaves(accountId, saves);
      return saves;
    } catch (e) {
      console.error("Failed to load account saves (db):", e);
      return null;
    }
  }
  const p = savePathFor(accountId);
  try {
    ensureDir(SAVES_DIR);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
    const saves = migrateLegacy(raw);
    if (saves === null) return null;
    // Migration: bare GameState → wrap as the single game "0" (written back).
    if (!("games" in (raw as object))) await saveAccountSaves(accountId, saves);
    return saves;
  } catch (e) {
    console.error("Failed to load account saves:", e);
    return null;
  }
}

export async function saveAccountSaves(accountId: string, saves: AccountSaves): Promise<void> {
  if (USE_DB) {
    try {
      await ensureTables();
      await db().query(
        "INSERT INTO saves (account_id, data) VALUES ($1, $2) ON CONFLICT (account_id) DO UPDATE SET data = EXCLUDED.data",
        [accountId, saves as unknown as object]
      );
    } catch (e) {
      console.error("Failed to save account saves (db):", e);
    }
    return;
  }
  try {
    ensureDir(SAVES_DIR);
    fs.writeFileSync(savePathFor(accountId), JSON.stringify(saves, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save account saves:", e);
  }
}

/**
 * Every account save on this server (the world). Read-only enumeration used by
 * the contribution leaderboard to score ALL colonies on the world. Legacy
 * rows/files may be migrated back on load (the same path any read takes);
 * unreadable/missing rows are skipped, never fatal.
 */
export async function loadAllSaves(): Promise<Array<{ accountId: string; saves: AccountSaves }>> {
  const out: Array<{ accountId: string; saves: AccountSaves }> = [];
  if (USE_DB) {
    try {
      await ensureTables();
      const res = await db().query("SELECT account_id, data FROM saves");
      for (const row of res.rows) {
        const saves = migrateLegacy(row.data as unknown);
        if (saves === null) continue;
        out.push({ accountId: row.account_id as string, saves });
      }
    } catch (e) {
      console.error("Failed to list saves (db):", e);
    }
    return out;
  }
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
    const saves = await loadAccountSaves(accountId);
    if (saves) out.push({ accountId, saves });
  }
  return out;
}

export async function removeAccountSave(accountId: string): Promise<void> {
  if (USE_DB) {
    try {
      await ensureTables();
      await db().query("DELETE FROM saves WHERE account_id = $1", [accountId]);
    } catch (e) {
      console.error("Failed to remove account save (db):", e);
    }
    return;
  }
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

export async function loadAccounts(): Promise<AccountMap> {
  if (USE_DB) {
    const map: AccountMap = {};
    try {
      await ensureTables();
      const res = await db().query(
        "SELECT account_id, password_hash, salt, created_at, notice_dismissed FROM accounts"
      );
      for (const row of res.rows) {
        map[row.account_id as string] = {
          passwordHash: row.password_hash as string,
          salt: row.salt as string,
          // BIGINT arrives as a string from node-postgres; ms timestamps fit
          // safely in a JS number (well under 2^53).
          createdAt: Number(row.created_at),
          ...(row.notice_dismissed == null
            ? {}
            : { noticeDismissed: Boolean(row.notice_dismissed) }),
        };
      }
    } catch (e) {
      console.error("Failed to load accounts (db):", e);
    }
    return map;
  }
  return readJson<AccountMap>(ACCOUNTS_PATH, {});
}

export async function saveAccounts(a: AccountMap): Promise<void> {
  if (USE_DB) {
    try {
      await ensureTables();
      // Full replace inside one transaction — mirrors the fs semantics of
      // writing the whole file (the map IS the table).
      const client = await db().connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM accounts");
        for (const [accountId, rec] of Object.entries(a)) {
          await client.query(
            "INSERT INTO accounts (account_id, password_hash, salt, created_at, notice_dismissed) VALUES ($1, $2, $3, $4, $5)",
            [accountId, rec.passwordHash, rec.salt, rec.createdAt, rec.noticeDismissed ?? null]
          );
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      console.error("Failed to save accounts (db):", e);
    }
    return;
  }
  writeJson(ACCOUNTS_PATH, a);
}

export async function deleteAccountRecord(accountId: string): Promise<void> {
  if (USE_DB) {
    try {
      await ensureTables();
      await db().query("DELETE FROM accounts WHERE account_id = $1", [accountId]);
    } catch (e) {
      console.error("Failed to delete account record (db):", e);
    }
    return;
  }
  const accounts = await loadAccounts();
  if (accounts[accountId]) {
    delete accounts[accountId];
    await saveAccounts(accounts);
  }
}

// ------- sessions -------

export interface SessionRecord {
  accountId: string;
  createdAt: number;
}
export type SessionMap = Record<string, SessionRecord>;

export async function loadSessions(): Promise<SessionMap> {
  if (USE_DB) {
    const map: SessionMap = {};
    try {
      await ensureTables();
      const res = await db().query("SELECT token, account_id, created_at FROM sessions");
      for (const row of res.rows) {
        map[row.token as string] = { accountId: row.account_id as string, createdAt: Number(row.created_at) };
      }
    } catch (e) {
      console.error("Failed to load sessions (db):", e);
    }
    return map;
  }
  return readJson<SessionMap>(SESSIONS_PATH, {});
}

export async function saveSessions(s: SessionMap): Promise<void> {
  if (USE_DB) {
    try {
      await ensureTables();
      const client = await db().connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM sessions");
        for (const [token, rec] of Object.entries(s)) {
          await client.query(
            "INSERT INTO sessions (token, account_id, created_at) VALUES ($1, $2, $3)",
            [token, rec.accountId, rec.createdAt]
          );
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      console.error("Failed to save sessions (db):", e);
    }
    return;
  }
  writeJson(SESSIONS_PATH, s);
}

// ------- beta feedback channel (First Run) -------
// data/feedback.json (or the single feedback row, id = 1) holds every player's
// beta submissions in ONE file so the team can read the whole list directly. A
// player only ever receives their own records back through the API
// (listMyFeedbackFn filters by accountId).
export interface FeedbackFile {
  version: 1;
  submissions: FeedbackRecord[];
}
const FEEDBACK_VERSION = 1 as const;
export async function loadFeedback(): Promise<FeedbackFile> {
  if (USE_DB) {
    try {
      await ensureTables();
      const res = await db().query("SELECT data FROM feedback WHERE id = 1");
      if (!res.rows.length) return { version: FEEDBACK_VERSION, submissions: [] };
      const f = res.rows[0].data as Partial<FeedbackFile> | null;
      const submissions = Array.isArray(f?.submissions) ? f.submissions : [];
      return { version: FEEDBACK_VERSION, submissions };
    } catch (e) {
      console.error("Failed to load feedback (db):", e);
      return { version: FEEDBACK_VERSION, submissions: [] };
    }
  }
  const f = readJson<Partial<FeedbackFile>>(FEEDBACK_PATH, { version: FEEDBACK_VERSION, submissions: [] });
  const submissions = Array.isArray(f?.submissions) ? f.submissions : [];
  return { version: FEEDBACK_VERSION, submissions };
}
export async function saveFeedback(file: FeedbackFile): Promise<void> {
  if (USE_DB) {
    try {
      await ensureTables();
      await db().query(
        "INSERT INTO feedback (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data",
        [file as unknown as object]
      );
    } catch (e) {
      console.error("Failed to save feedback (db):", e);
    }
    return;
  }
  writeJson(FEEDBACK_PATH, file);
}
// ------- chat + mail (chat-mail-spec §1 · D7) -------
//
// Six tables, TWO backends, ONE set of rules. Every function below is the single
// place its operation is implemented, so the fs fallback and Postgres cannot
// drift: the same retention, the same eviction, the same hard delete.
//
//   Postgres  — chat_messages · chat_threads · chat_rooms · chat_room_members ·
//               chat_reads · mail_letters (created in ensureTables above).
//   fallback  — data/chat.json, the same six arrays inside one versioned file
//               (mirrors feedback.json). The headless battery runs with no
//               DATABASE_URL, so a Postgres-only table would be untestable.
//
// Rows carry NO presence, NO last-seen and NO receipt: the record is the message
// (D4). `mail_letters.read_at` is the player's OWN read mark on their own letter,
// which is not a receipt back to the sender — the sender can never see it.

/** The fallback backend's whole store: the six tables as arrays, one versioned file. */
export interface ChatFile {
  version: 1;
  messages: ChatMessage[];
  threads: ChatThread[];
  rooms: ChatRoom[];
  members: RoomMember[];
  reads: ChatRead[];
  letters: MailLetter[];
}
const CHAT_VERSION = 1 as const;

function emptyChat(): ChatFile {
  return { version: CHAT_VERSION, messages: [], threads: [], rooms: [], members: [], reads: [], letters: [] };
}

function readChatFile(): ChatFile {
  const raw = readJson<Partial<ChatFile>>(CHAT_PATH, emptyChat());
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    version: CHAT_VERSION,
    messages: arr<ChatMessage>(raw.messages),
    threads: arr<ChatThread>(raw.threads),
    rooms: arr<ChatRoom>(raw.rooms),
    members: arr<RoomMember>(raw.members),
    reads: arr<ChatRead>(raw.reads),
    letters: arr<MailLetter>(raw.letters),
  };
}

function writeChatFile(f: ChatFile): void {
  writeJson(CHAT_PATH, f);
}

/** The whole store, read-only — the harness's window into the fallback tables. */
export async function loadChatFile(): Promise<ChatFile> {
  if (USE_DB) {
    return {
      version: CHAT_VERSION,
      messages: await loadChatMessages(undefined, 100_000),
      threads: await loadChatThreadsFor(null),
      rooms: await loadChatRooms(),
      members: await loadMyRoomMemberships(null),
      reads: await loadChatReads(null),
      letters: await loadMailFor(null),
    };
  }
  return readChatFile();
}

// ---- chat_messages --------------------------------------------------------

/** Newest messages of a channel, OLDEST FIRST (the render order). `channel` null = all. */
export async function loadChatMessages(channel?: string, limit = CHAT_RETENTION): Promise<ChatMessage[]> {
  if (USE_DB) {
    try {
      await ensureTables();
      const res = channel
        ? await db().query(
            "SELECT id, channel, account_id, colony_name, lang, body, created_at FROM chat_messages WHERE channel = $1 ORDER BY created_at DESC, id DESC LIMIT $2",
            [channel, limit]
          )
        : await db().query(
            "SELECT id, channel, account_id, colony_name, lang, body, created_at FROM chat_messages ORDER BY created_at DESC, id DESC LIMIT $1",
            [limit]
          );
      const rows = res.rows.map((r) => ({
        id: r.id as string,
        channel: r.channel as string,
        accountId: r.account_id as string,
        colonyName: r.colony_name as string,
        lang: r.lang as string,
        body: r.body as string,
        createdAt: Number(r.created_at),
      }));
      return rows.reverse();
    } catch (e) {
      console.error("Failed to load chat messages (db):", e);
      return [];
    }
  }
  const all = readChatFile().messages
    .filter((m) => (channel === undefined ? true : m.channel === channel))
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return all.slice(Math.max(0, all.length - limit));
}

export async function appendChatMessage(m: ChatMessage): Promise<void> {
  if (USE_DB) {
    try {
      await ensureTables();
      await db().query(
        "INSERT INTO chat_messages (id, channel, account_id, colony_name, lang, body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING",
        [m.id, m.channel, m.accountId, m.colonyName, m.lang, m.body, m.createdAt]
      );
    } catch (e) {
      console.error("Failed to append chat message (db):", e);
    }
    return;
  }
  const f = readChatFile();
  if (!f.messages.some((x) => x.id === m.id)) f.messages.push(m);
  writeChatFile(f);
}

/**
 * RETENTION (D7): keep the newest `keep` messages of a channel, delete the rest —
 * oldest first. Returns how many rows went, so the caller can log it honestly
 * instead of claiming an eviction that did not happen.
 */
export async function evictChatMessages(channel: string, keep = CHAT_RETENTION): Promise<number> {
  if (USE_DB) {
    try {
      await ensureTables();
      const res = await db().query(
        `DELETE FROM chat_messages WHERE channel = $1 AND id NOT IN (
           SELECT id FROM chat_messages WHERE channel = $1 ORDER BY created_at DESC, id DESC LIMIT $2
         )`,
        [channel, keep]
      );
      return res.rowCount ?? 0;
    } catch (e) {
      console.error("Failed to evict chat messages (db):", e);
      return 0;
    }
  }
  const f = readChatFile();
  const mine = f.messages
    .filter((m) => m.channel === channel)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  if (mine.length <= keep) return 0;
  const doomed = new Set(mine.slice(0, mine.length - keep).map((m) => m.id));
  f.messages = f.messages.filter((m) => !doomed.has(m.id));
  writeChatFile(f);
  return doomed.size;
}

/** How many messages this account sent at or after `since` — the per-minute guard. */
export async function countChatMessagesSince(accountId: string, since: number): Promise<number> {
  if (USE_DB) {
    try {
      await ensureTables();
      const res = await db().query(
        "SELECT COUNT(*)::int AS n FROM chat_messages WHERE account_id = $1 AND created_at >= $2",
        [accountId, since]
      );
      return Number(res.rows[0]?.n ?? 0);
    } catch (e) {
      console.error("Failed to count chat messages (db):", e);
      return 0;
    }
  }
  return readChatFile().messages.filter((m) => m.accountId === accountId && m.createdAt >= since).length;
}

/** The account's most recent message time, or null — the 2-second guard. */
export async function lastChatMessageAt(accountId: string): Promise<number | null> {
  if (USE_DB) {
    try {
      await ensureTables();
      const res = await db().query(
        "SELECT MAX(created_at) AS t FROM chat_messages WHERE account_id = $1",
        [accountId]
      );
      const t = res.rows[0]?.t;
      return t == null ? null : Number(t);
    } catch (e) {
      console.error("Failed to read last chat message (db):", e);
      return null;
    }
  }
  const mine = readChatFile().messages.filter((m) => m.accountId === accountId);
  if (!mine.length) return null;
  return Math.max(...mine.map((m) => m.createdAt));
}

/**
 * D13 — ACCOUNT DELETION. The account's messages are HARD-DELETED (not blanked:
 * a tombstone with the body still inside would not be a deletion), and every
 * thread it is part of is CLOSED so the other participant keeps their own lines
 * and the thread itself. Nothing else in the store is touched here — the account
 * row and the saves are the caller's business.
 */
export async function deleteChatByAccount(accountId: string): Promise<{ messages: number; threadsClosed: number }> {
  if (USE_DB) {
    try {
      await ensureTables();
      const del = await db().query("DELETE FROM chat_messages WHERE account_id = $1", [accountId]);
      const closed = await db().query(
        "UPDATE chat_threads SET closed_at = $2 WHERE closed_at IS NULL AND (a = $1 OR b = $1)",
        [accountId, Date.now()]
      );
      await db().query("DELETE FROM chat_room_members WHERE account_id = $1", [accountId]);
      await db().query("DELETE FROM chat_reads WHERE account_id = $1", [accountId]);
      await db().query("DELETE FROM mail_letters WHERE to_account = $1 OR from_account = $1", [accountId]);
      return { messages: del.rowCount ?? 0, threadsClosed: closed.rowCount ?? 0 };
    } catch (e) {
      console.error("Failed to delete chat for account (db):", e);
      return { messages: 0, threadsClosed: 0 };
    }
  }
  const f = readChatFile();
  const before = f.messages.length;
  f.messages = f.messages.filter((m) => m.accountId !== accountId);
  let threadsClosed = 0;
  const now = Date.now();
  for (const th of f.threads) {
    if (th.closedAt === null && (th.a === accountId || th.b === accountId)) {
      th.closedAt = now;
      threadsClosed++;
    }
  }
  f.members = f.members.filter((m) => m.accountId !== accountId);
  f.reads = f.reads.filter((r) => r.accountId !== accountId);
  f.letters = f.letters.filter((l) => l.toAccount !== accountId && l.fromAccount !== accountId);
  writeChatFile(f);
  return { messages: before - f.messages.length, threadsClosed };
}

// ---- chat_threads --------------------------------------------------------

/** Threads an account takes part in. `accountId` null = every thread (the harness). */
export async function loadChatThreadsFor(accountId: string | null): Promise<ChatThread[]> {
  if (USE_DB) {
    try {
      await ensureTables();
      const res = accountId
        ? await db().query("SELECT id, a, b, created_at, closed_at FROM chat_threads WHERE a = $1 OR b = $1 ORDER BY created_at ASC", [accountId])
        : await db().query("SELECT id, a, b, created_at, closed_at FROM chat_threads ORDER BY created_at ASC");
      return res.rows.map((r) => ({
        id: r.id as string,
        a: r.a as string,
        b: r.b as string,
        createdAt: Number(r.created_at),
        closedAt: r.closed_at == null ? null : Number(r.closed_at),
      }));
    } catch (e) {
      console.error("Failed to load chat threads (db):", e);
      return [];
    }
  }
  const all = readChatFile().threads.sort((x, y) => x.createdAt - y.createdAt);
  return accountId ? all.filter((t) => t.a === accountId || t.b === accountId) : all;
}

export async function appendChatThread(t: ChatThread): Promise<void> {
  if (USE_DB) {
    try {
      await ensureTables();
      await db().query(
        "INSERT INTO chat_threads (id, a, b, created_at, closed_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
        [t.id, t.a, t.b, t.createdAt, t.closedAt]
      );
    } catch (e) {
      console.error("Failed to append chat thread (db):", e);
    }
    return;
  }
  const f = readChatFile();
  if (!f.threads.some((x) => x.id === t.id)) f.threads.push(t);
  writeChatFile(f);
}

// ---- chat_rooms + chat_room_members --------------------------------------

export async function loadChatRooms(): Promise<ChatRoom[]> {
  if (USE_DB) {
    try {
      await ensureTables();
      const res = await db().query("SELECT id, name, created_by, created_at FROM chat_rooms ORDER BY created_at ASC");
      return res.rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        createdBy: r.created_by as string,
        createdAt: Number(r.created_at),
      }));
    } catch (e) {
      console.error("Failed to load chat rooms (db):", e);
      return [];
    }
  }
  return readChatFile().rooms.sort((x, y) => x.createdAt - y.createdAt);
}

/** Memberships. `accountId` null = every membership (the harness). */
export async function loadMyRoomMemberships(accountId: string | null): Promise<RoomMember[]> {
  if (USE_DB) {
    try {
      await ensureTables();
      const res = accountId
        ? await db().query("SELECT room_id, account_id, joined_at FROM chat_room_members WHERE account_id = $1", [accountId])
        : await db().query("SELECT room_id, account_id, joined_at FROM chat_room_members");
      return res.rows.map((r) => ({
        roomId: r.room_id as string,
        accountId: r.account_id as string,
        joinedAt: Number(r.joined_at),
      }));
    } catch (e) {
      console.error("Failed to load room memberships (db):", e);
      return [];
    }
  }
  const all = readChatFile().members;
  return accountId ? all.filter((m) => m.accountId === accountId) : all;
}

// ---- chat_reads ----------------------------------------------------------

/** An account's read marks. `accountId` null = every mark (the harness). */
export async function loadChatReads(accountId: string | null): Promise<ChatRead[]> {
  if (USE_DB) {
    try {
      await ensureTables();
      const res = accountId
        ? await db().query("SELECT account_id, channel, last_read_at FROM chat_reads WHERE account_id = $1", [accountId])
        : await db().query("SELECT account_id, channel, last_read_at FROM chat_reads");
      return res.rows.map((r) => ({
        accountId: r.account_id as string,
        channel: r.channel as string,
        lastReadAt: Number(r.last_read_at),
      }));
    } catch (e) {
      console.error("Failed to load chat reads (db):", e);
      return [];
    }
  }
  const all = readChatFile().reads;
  return accountId ? all.filter((r) => r.accountId === accountId) : all;
}

/** One read mark, upserted. Never moves backwards — a mark only ever advances. */
export async function saveChatRead(accountId: string, channel: string, lastReadAt: number): Promise<void> {
  if (USE_DB) {
    try {
      await ensureTables();
      await db().query(
        `INSERT INTO chat_reads (account_id, channel, last_read_at) VALUES ($1, $2, $3)
         ON CONFLICT (account_id, channel) DO UPDATE SET last_read_at = GREATEST(chat_reads.last_read_at, EXCLUDED.last_read_at)`,
        [accountId, channel, lastReadAt]
      );
    } catch (e) {
      console.error("Failed to save chat read (db):", e);
    }
    return;
  }
  const f = readChatFile();
  const existing = f.reads.find((r) => r.accountId === accountId && r.channel === channel);
  if (existing) existing.lastReadAt = Math.max(existing.lastReadAt, lastReadAt);
  else f.reads.push({ accountId, channel, lastReadAt });
  writeChatFile(f);
}

// ---- mail_letters --------------------------------------------------------

/** Letters. `accountId` null = every letter (the harness); otherwise RECEIVED only. */
export async function loadMailFor(accountId: string | null): Promise<MailLetter[]> {
  if (USE_DB) {
    try {
      await ensureTables();
      const res = accountId
        ? await db().query(
            "SELECT id, from_account, from_name, to_account, subject, body, lang, created_at, read_at FROM mail_letters WHERE to_account = $1 ORDER BY created_at ASC",
            [accountId]
          )
        : await db().query(
            "SELECT id, from_account, from_name, to_account, subject, body, lang, created_at, read_at FROM mail_letters ORDER BY created_at ASC"
          );
      return res.rows.map((r) => ({
        id: r.id as string,
        fromAccount: r.from_account as string,
        fromName: r.from_name as string,
        toAccount: r.to_account as string,
        subject: r.subject as string,
        body: r.body as string,
        lang: r.lang as string,
        createdAt: Number(r.created_at),
        readAt: r.read_at == null ? null : Number(r.read_at),
      }));
    } catch (e) {
      console.error("Failed to load mail (db):", e);
      return [];
    }
  }
  const all = readChatFile().letters.sort((x, y) => x.createdAt - y.createdAt);
  return accountId ? all.filter((l) => l.toAccount === accountId) : all;
}

export async function appendMailLetter(l: MailLetter): Promise<void> {
  if (USE_DB) {
    try {
      await ensureTables();
      await db().query(
        "INSERT INTO mail_letters (id, from_account, from_name, to_account, subject, body, lang, created_at, read_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING",
        [l.id, l.fromAccount, l.fromName, l.toAccount, l.subject, l.body, l.lang, l.createdAt, l.readAt]
      );
    } catch (e) {
      console.error("Failed to append mail (db):", e);
    }
    return;
  }
  const f = readChatFile();
  if (!f.letters.some((x) => x.id === l.id)) f.letters.push(l);
  writeChatFile(f);
}
