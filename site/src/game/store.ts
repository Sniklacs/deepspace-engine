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

// ── backend selection ───────────────────────────────────────────────────────
const USE_DB = !!process.env.DATABASE_URL;

const DATA_DIR = path.join(process.cwd(), "data");
const SAVES_DIR = path.join(DATA_DIR, "saves");
const ACCOUNTS_PATH = path.join(DATA_DIR, "accounts.json");
const SESSIONS_PATH = path.join(DATA_DIR, "sessions.json");
const FEEDBACK_PATH = path.join(DATA_DIR, "feedback.json");

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