// GLOBE COORDINATES (owner 2026-10-16) — an X/Y grid on the world globe so
// a place can be NAMED in numbers: "rally at X 214 · Y 63." X runs around
// the world (longitude), Y runs pole to pole (latitude). Every globe
// object already carries lat/lon (globe-layers.ts) — this module is the
// ONE mapping between that position data and the coordinate pair, defined
// once so the sheets, the index search and the chat chips can never
// disagree about what a coordinate means.
//
//   X = round(lon + 180) wrapped into 0..359   (0 = the antimeridian)
//   Y = round(90 − lat) clamped to 0..180      (0 = north pole, 180 = south)
//
// The display format is canonical — "X 214 · Y 63" — and the chat parser
// recognizes exactly the tagged forms of it, so what a sheet shows is
// what a player can paste into chat and have it linkify. Bare number
// pairs ("100, 45") are accepted ONLY by the index search box, where
// typing them is deliberate; chat stays strict so ordinary numbers in
// conversation never turn into links.

export interface GlobeCoords {
  /** 0..359 — around the world. */
  x: number;
  /** 0..180 — pole to pole. */
  y: number;
}

export const COORD_X_MAX = 359;
export const COORD_Y_MAX = 180;

function wrapX(x: number): number {
  return ((Math.round(x) % 360) + 360) % 360;
}

function clampY(y: number): number {
  return Math.max(0, Math.min(COORD_Y_MAX, Math.round(y)));
}

/** lat/lon (the globe's native position data) → the coordinate pair. */
export function coordsOf(lat: number, lon: number): GlobeCoords {
  return { x: wrapX(lon + 180), y: clampY(90 - lat) };
}

/** The coordinate pair → lat/lon (the inverse the camera flies to). */
export function latLonOfCoords(c: GlobeCoords): { lat: number; lon: number } {
  return { lat: 90 - clampY(c.y), lon: wrapX(c.x) - 180 };
}

/** True when a pair sits inside the game's coordinate ranges. */
export function coordsInRange(x: number, y: number): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.round(x) === x &&
    Math.round(y) === y &&
    x >= 0 &&
    x <= COORD_X_MAX &&
    y >= 0 &&
    y <= COORD_Y_MAX
  );
}

/** The canonical display string — sheets, index rows and chat all show
 *  exactly this, so a player can read a sheet and type what they see. */
export function formatCoords(lat: number, lon: number): string {
  const c = coordsOf(lat, lon);
  return `X ${c.x} · Y ${c.y}`;
}

/** Format a coordinate pair directly. */
export function formatCoordPair(c: GlobeCoords): string {
  return `X ${c.x} · Y ${c.y}`;
}

// The tagged form: an X tag, a number, a separator, a Y tag, a number.
// Separators between the halves: middle dot, comma, semicolon, slash or
// plain whitespace. The tags are mandatory — that is what keeps ordinary
// chat numbers ("I have 100, 45 left") from linkifying.
const TAGGED_COORD_RE =
  /\bX\s*[:#]?\s*(\d{1,3})\s*(?:[·,;/]|\s)\s*Y\s*[:#]?\s*(\d{1,3})\b/gi;

// The bare pair, for the index search box ONLY (deliberate input):
// "214, 63" / "214 63" / "214,63".
const BARE_PAIR_RE = /^\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*$/;

/**
 * Parse coordinate text typed on purpose (the index search accepts both
 * the tagged form and a bare pair). Returns null for anything that is
 * not a valid in-range pair.
 */
export function parseCoordsInput(text: string): GlobeCoords | null {
  const tagged = parseTaggedCoords(text);
  if (tagged.length > 0) return tagged[0].coords;
  const m = BARE_PAIR_RE.exec(text);
  if (m) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (coordsInRange(x, y)) return { x, y };
  }
  return null;
}

export interface CoordMatch {
  /** The exact substring that matched, as written by the author. */
  raw: string;
  /** Index of the match's first character in the source text. */
  start: number;
  /** Index one past the match's last character. */
  end: number;
  coords: GlobeCoords;
}

/**
 * Find every game-coordinate reference in a chat message. STRICT: the
 * X/Y tags are required and both numbers must be inside the game's
 * ranges, so counts, prices and timers in ordinary chat never match.
 */
export function parseTaggedCoords(text: string): CoordMatch[] {
  const out: CoordMatch[] = [];
  TAGGED_COORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAGGED_COORD_RE.exec(text)) !== null) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (!coordsInRange(x, y)) continue;
    out.push({ raw: m[0], start: m.index, end: m.index + m[0].length, coords: { x, y } });
  }
  return out;
}

/** Split a message body into plain-text and coordinate segments, in
 *  order — the chat row renders coordinate segments as fly-to chips. */
export function splitCoordSegments(
  text: string,
): Array<{ text: string; coords: GlobeCoords | null }> {
  const matches = parseTaggedCoords(text);
  if (matches.length === 0) return [{ text, coords: null }];
  const out: Array<{ text: string; coords: GlobeCoords | null }> = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) out.push({ text: text.slice(cursor, m.start), coords: null });
    out.push({ text: m.raw, coords: m.coords });
    cursor = m.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), coords: null });
  return out;
}
