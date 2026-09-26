// THE ACCOUNT REFERENCE — how a Stripe Payment Link carries "who paid".
//
// WHY THIS EXISTS AT ALL (and why it is not just the raw account id).
//
// Stripe Payment Links take a `client_reference_id` query parameter and echo it
// back on the Checkout Session, which is the only channel from "this link was
// opened" to "this account paid". The value travels inside a URL, so Stripe
// constrains it, and our account ids are *usernames* (auth.ts
// normalizeUsername(): trimmed, lowercased, up to 32 characters, and — this is
// the real hazard — allowed to be ANY characters the player typed, including
// spaces and non-ASCII. This team's beta testers are Persian speakers; a
// username of "بابک" is a legal account id today).
//
// So the reference is a canonical, URL-safe encoding of the account id, not the
// id itself: prefix + base64url(utf8(normalized id)). The webhook decodes it and
// the decoded value is checked against the real account store before anything is
// granted — a reference that decodes to a non-existent account grants nothing.
//
// A RAW, SAFE-SHAPED id is still accepted (the `dse1_` prefix is simply absent):
// that keeps a hand-written link usable for a smoke test with a simple username.
//
// This module is PURE (no node imports, no crypto): it is bundleable by the
// client, which needs the ENCODE half to build the checkout URL.

/** Marks an encoded reference (bumping the scheme means bumping this token). */
export const ACCOUNT_REF_PREFIX = "dse1_";

/** A raw account id we accept without the prefix. Mirrors what auth.ts allows
 *  in practice for a link smoke test: lowercase, digits, dot/dash/underscore. */
const RAW_ID_SHAPE = /^[a-z0-9._-]{2,32}$/;

/** The one place account ids are normalized (same rule as auth.ts). */
export function normalizeAccountId(accountId: string): string {
  return accountId.trim().toLowerCase();
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** account id → the `client_reference_id` we append to a Payment Link URL. */
export function encodeAccountRef(accountId: string): string {
  const id = normalizeAccountId(accountId);
  return ACCOUNT_REF_PREFIX + toBase64Url(new TextEncoder().encode(id));
}

/** `client_reference_id` → the account id it names, or null if it names nobody.
 *  Null means REFUSED: a blank, malformed or control-character reference is not
 *  a guessable account. Whether the account exists is a store question, asked by
 *  the caller. */
export function decodeAccountRef(ref: string | null | undefined): string | null {
  if (typeof ref !== "string") return null;
  const raw = ref.trim();
  if (!raw) return null;
  if (!raw.startsWith(ACCOUNT_REF_PREFIX)) {
    // Unprefixed: only a plainly safe id, and only if it is already normalized
    // (an uppercase or padded value is not something this game ever writes).
    return RAW_ID_SHAPE.test(raw) && normalizeAccountId(raw) === raw ? raw : null;
  }
  const bytes = fromBase64Url(raw.slice(ACCOUNT_REF_PREFIX.length));
  if (!bytes || bytes.length === 0 || bytes.length > 128) return null;
  let id: string;
  try {
    id = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (id.length < 2 || id.length > 32) return null;
  if (normalizeAccountId(id) !== id) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(id)) return null;
  return id;
}
