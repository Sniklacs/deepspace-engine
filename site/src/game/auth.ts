// Server-only account handling for the MVP.
//
// Lightweight and honest: passwords are hashed with Node's scrypt + a per-account
// random salt (never stored in plaintext), and a login issues a random 256-bit
// session token persisted next to the data so it survives server restarts. No
// auth framework. A token identifies the account; every game API call carries it.
// All exported functions are async — persistence goes through store.ts, which
// may be Postgres (serverless) or the filesystem fallback (dev sandbox).
import crypto from "node:crypto";
import {
  loadAccounts,
  saveAccounts,
  loadSessions,
  saveSessions,
} from "./store";

const KEYLEN = 64;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // tokens valid ~90 days

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, KEYLEN).toString("hex");
}

function randomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function normalizeUsername(name: string): string {
  return name.trim().toLowerCase();
}

// Resolve a session token to an account id, or null if the token is unknown/expired.
export async function accountForToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const sessions = await loadSessions();
  const rec = sessions[token];
  if (!rec) return null;
  if (rec.createdAt && Date.now() - rec.createdAt > SESSION_TTL_MS) {
    delete sessions[token];
    await saveSessions(sessions);
    return null;
  }
  return rec.accountId;
}

export type AuthResult = { ok: boolean; error?: string; token?: string; accountId?: string };

export async function signup(username: string, password: string): Promise<AuthResult> {
  const uname = normalizeUsername(username);
  if (uname.length < 2) return { ok: false, error: "Name must be at least 2 characters." };
  if (uname.length > 32) return { ok: false, error: "Name must be 32 characters or fewer." };
  if (password.length < 4) return { ok: false, error: "Password must be at least 4 characters." };
  const accounts = await loadAccounts();
  if (accounts[uname]) return { ok: false, error: "That name is already taken. Try logging in instead." };
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  accounts[uname] = { passwordHash, salt, createdAt: Date.now() };
  await saveAccounts(accounts);
  const token = await createSession(uname);
  return { ok: true, token, accountId: uname };
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const uname = normalizeUsername(username);
  const accounts = await loadAccounts();
  const rec = accounts[uname];
  if (!rec) return { ok: false, error: "No colony with that name. Sign up first." };
  const attempt = Buffer.from(hashPassword(password, rec.salt), "hex");
  const stored = Buffer.from(rec.passwordHash, "hex");
  if (attempt.length !== stored.length || !crypto.timingSafeEqual(attempt, stored)) {
    return { ok: false, error: "Incorrect password." };
  }
  const token = await createSession(uname);
  return { ok: true, token, accountId: uname };
}

export async function logout(token: string): Promise<void> {
  const sessions = await loadSessions();
  if (sessions[token]) {
    delete sessions[token];
    await saveSessions(sessions);
  }
}

// Server-side password verification against the stored scrypt hash. Used by
// trashAccountFn to require re-entry of the real password before destroying
// the account. Constant-time like login.
export async function verifyPassword(username: string, password: string): Promise<boolean> {
  const uname = normalizeUsername(username);
  const accounts = await loadAccounts();
  const rec = accounts[uname];
  if (!rec) return false;
  try {
    const attempt = Buffer.from(hashPassword(password, rec.salt), "hex");
    const stored = Buffer.from(rec.passwordHash, "hex");
    return attempt.length === stored.length && crypto.timingSafeEqual(attempt, stored);
  } catch {
    return false;
  }
}

// Revoke every session belonging to an account (used when the account is trashed).
export async function revokeAllSessions(accountId: string): Promise<void> {
  const sessions = await loadSessions();
  let changed = false;
  for (const [k, v] of Object.entries(sessions)) {
    if (v.accountId === accountId) {
      delete sessions[k];
      changed = true;
    }
  }
  if (changed) await saveSessions(sessions);
}

async function createSession(accountId: string): Promise<string> {
  const token = randomToken();
  const sessions = await loadSessions();
  sessions[token] = { accountId, createdAt: Date.now() };
  // Prune long-expired tokens to keep the file small.
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [k, v] of Object.entries(sessions)) {
    if (v.createdAt && v.createdAt < cutoff) delete sessions[k];
  }
  await saveSessions(sessions);
  return token;
}