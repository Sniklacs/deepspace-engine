// Formation share codes — player-to-player doctrine sharing (owner 2026-10-11).
//
// A share code is a self-contained base64url payload: the formation's name,
// play, loads, and slot layout. Copy-paste safe by construction — only
// [A-Za-z0-9-_], no fragile characters, no whitespace. Another player pastes
// it into their war room's Import box and it lands as a new (unlocked)
// formation. Replays don't travel with shares — they're device-local.

import type { SavedFormation } from "./playbook";

const SHARE_VERSION = 1;

interface SharePayload {
  v: number;
  name: string;
  playId: string;
  loads: SavedFormation["loads"];
  slotMeta?: SavedFormation["slotMeta"];
}

function toBase64Url(json: string): string {
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(code: string): string {
  let b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return decodeURIComponent(escape(atob(b64)));
}

/** Encode a formation as a copy-paste-safe share code (pure). */
export function encodeFormationShare(f: Pick<SavedFormation, "name" | "playId" | "loads" | "slotMeta">): string {
  const payload: SharePayload = {
    v: SHARE_VERSION,
    name: f.name,
    playId: f.playId,
    loads: f.loads,
    slotMeta: f.slotMeta,
  };
  return `DOCTRINE-${toBase64Url(JSON.stringify(payload))}`;
}

/**
 * Accept a bare code or a URL/text containing one — survives copy-paste
 * with surrounding prose (pure).
 */
export function extractShareCode(input: string): string | null {
  const m = input.match(/DOCTRINE-([A-Za-z0-9\-_]+)/);
  return m ? `DOCTRINE-${m[1]}` : null;
}

/** Decode a share code into an importable formation draft (pure). Null = invalid. */
export function decodeFormationShare(
  input: string,
): { name: string; playId: string; loads: SavedFormation["loads"]; slotMeta?: SavedFormation["slotMeta"] } | null {
  const code = extractShareCode(input?.trim() ?? "");
  if (!code) return null;
  try {
    const payload = JSON.parse(fromBase64Url(code.slice("DOCTRINE-".length))) as SharePayload;
    if (!payload || payload.v !== SHARE_VERSION) return null;
    if (typeof payload.name !== "string" || payload.name.length === 0 || payload.name.length > 40) return null;
    if (typeof payload.playId !== "string" || payload.playId.length === 0 || payload.playId.length > 64) return null;
    if (!payload.loads || typeof payload.loads !== "object") return null;
    return {
      name: payload.name,
      playId: payload.playId,
      loads: payload.loads,
      slotMeta: payload.slotMeta,
    };
  } catch {
    return null;
  }
}
