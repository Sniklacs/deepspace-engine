// AVATAR — the player's own face (owner 2026-10-14).
//
// Hans: "we were going to have avatars being able to be uploaded in the
// settings area with the player's shit." The war band already had a face
// (presets + an upload, alliance-gated, living in war/alliances.ts); what was
// missing is the PERSONAL face — set in Settings, owned by the player's own
// save, shown wherever the game shows the player's identity (ribbon tile,
// Cradle sheet, and — mirrored — the war band record and chat bylines).
//
// This module is the pure core, shared by the client and the server fn:
//   · validateAvatarDataUrl — the safety gate for an upload (below).
//   · resolvePlayerAvatar — choice + stored upload → what to render, with
//     the race-emblem default when nothing was ever chosen.
//
// PERSISTENCE (the mechanism the codebase already had): the image itself is a
// downscaled data URL on the player's own GameState (`avatarUpload`, ≤256px,
// written by the client-side square downscale); the CHOICE rides beside it
// (`avatarChoice`). Both live in the account save, so the face survives
// reinstalls like the rest of the player record. The alliance member record
// carries only the reference and is mirrored by setMyAvatarFn when the
// player is in a war band.
import { avatarGlyph } from "./war/alliances";
import { AVATAR_PRESETS } from "./war/alliances";
import type { PlayerAvatarChoice } from "./types";

/** Data-URL ceiling — the same cap the server validators enforce. */
export const AVATAR_DATA_URL_MAX_CHARS = 400_000;
/** Decoded-image ceiling. A 256×256 JPEG lands ~15–45 KB; this is headroom,
 *  not a target. */
export const AVATAR_MAX_BYTES = 300_000;
/** Either-side pixel ceiling. The client downscale produces 256; the cap
 *  bounds what a direct API caller can park on a save. */
export const AVATAR_MAX_DIMENSION = 1024;

export type AvatarMime = "image/png" | "image/jpeg" | "image/webp";

export type AvatarValidation =
  | { ok: true; mime: AvatarMime; bytes: number; width: number; height: number }
  | { ok: false; error: string };

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[at + i] ?? 0);
  return s;
}
const u16be = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u32be = (b: Uint8Array, at: number) =>
  ((b[at] ?? 0) * 0x1000000 + ((b[at + 1] ?? 0) << 16) + ((b[at + 2] ?? 0) << 8) + (b[at + 3] ?? 0)) >>> 0;
const u16le = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);

/** Dimensions from a PNG byte stream (signature + IHDR), or null. */
export function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 33) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) return null;
  if (ascii(b, 12, 4) !== "IHDR") return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Dimensions from a JPEG byte stream (walk the markers to a SOF), or null. */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] ?? 0;
    // Standalone markers carry no length segment.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = u16be(b, i + 5);
      const width = u16be(b, i + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}

/** Dimensions from a WebP byte stream (VP8 / VP8L / VP8X), or null. */
export function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const fourcc = ascii(b, 12, 4);
  if (fourcc === "VP8 ") {
    // Lossy: 3-byte frame tag, 3-byte start code, then 14-bit LE dimensions.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    const width = u16le(b, 26) & 0x3fff;
    const height = u16le(b, 28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (fourcc === "VP8L") {
    // Lossless: 0x2f signature, then width-1 and height-1 packed 14-bit LE.
    if (b[20] !== 0x2f) return null;
    const v = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
    return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 };
  }
  if (fourcc === "VP8X") {
    // Extended: canvas width-1 / height-1 as 24-bit LE at bytes 24 / 27.
    const width = (b[24] ?? 0) | ((b[25] ?? 0) << 8) | ((b[26] ?? 0) << 16);
    const height = (b[27] ?? 0) | ((b[28] ?? 0) << 8) | ((b[29] ?? 0) << 16);
    return { width: width + 1, height: height + 1 };
  }
  return null;
}

export function imageSize(mime: AvatarMime, b: Uint8Array): { width: number; height: number } | null {
  return mime === "image/png" ? pngSize(b) : mime === "image/jpeg" ? jpegSize(b) : webpSize(b);
}

const DATA_URL_RE = /^data:(image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * THE UPLOAD GATE. An avatar upload is accepted only if it is a data URL of
 * a real raster image (PNG / JPEG / WebP) whose header parses, whose decoded
 * size and dimensions sit under the caps, and whose base64 is strict.
 * SVG is refused by the whitelist — an SVG can carry script; an executable
 * or polyglot that fails its own image header is refused too. This runs on
 * the server for every write; the client checks the same gate before upload.
 */
export function validateAvatarDataUrl(dataUrl: unknown): AvatarValidation {
  if (typeof dataUrl !== "string" || dataUrl.length === 0) {
    return { ok: false, error: "Not an image." };
  }
  if (dataUrl.length > AVATAR_DATA_URL_MAX_CHARS) {
    return { ok: false, error: "That image is too large." };
  }
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return { ok: false, error: "Not an image." };
  const mime = m[1] as AvatarMime;
  const b64 = m[2] ?? "";
  if (b64.length % 4 !== 0) return { ok: false, error: "Not an image." };
  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return { ok: false, error: "Not an image." };
  }
  if (bytes.length > AVATAR_MAX_BYTES) {
    return { ok: false, error: "That image is too large." };
  }
  const size = imageSize(mime, bytes);
  if (!size) return { ok: false, error: "That image didn't read as a picture." };
  if (size.width > AVATAR_MAX_DIMENSION || size.height > AVATAR_MAX_DIMENSION) {
    return { ok: false, error: "That image is too large." };
  }
  return { ok: true, mime, bytes: bytes.length, width: size.width, height: size.height };
}

/** What the player's own surfaces should render (pure). */
export type ResolvedPlayerAvatar =
  | { kind: "upload"; dataUrl: string }
  | { kind: "preset"; key: string; glyph: string }
  | { kind: "default" };

/**
 * Resolve the player's face from their own save: an upload choice renders
 * the stored photo (falling back if the photo is somehow absent), a preset
 * choice renders its sigil (an unknown key falls back), and no choice at
 * all renders the race-emblem default.
 *
 * `memberChoice` is the player's war band record avatar, consulted ONLY
 * when no personal choice exists: players who set their face through the
 * old alliance-only profile keep that face on the personal surfaces until
 * they pick one in Settings (Settings then writes the personal choice and
 * mirrors it back, so the two never disagree again).
 */
export function resolvePlayerAvatar(input: {
  choice?: PlayerAvatarChoice | null;
  upload?: string | null;
  memberChoice?: PlayerAvatarChoice | null;
}): ResolvedPlayerAvatar {
  const choice = input.choice ?? input.memberChoice ?? null;
  if (choice?.kind === "upload") {
    if (typeof input.upload === "string" && input.upload.startsWith("data:image/")) {
      return { kind: "upload", dataUrl: input.upload };
    }
    return { kind: "default" };
  }
  if (choice?.kind === "preset") {
    if (AVATAR_PRESETS.some((p) => p.key === choice.key)) {
      return { kind: "preset", key: choice.key, glyph: avatarGlyph(choice.key) };
    }
    return { kind: "default" };
  }
  return { kind: "default" };
}
