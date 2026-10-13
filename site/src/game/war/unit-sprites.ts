// unit-sprites.ts — per-race, directional battle unit sprites (owner
// 2026-10-12). Pure math + path/resolution logic; the renderer
// (BattleScene) owns the actual Image objects and canvas.
//
// ART CONVENTION (what the art pipeline generates):
//   /art/battle/units/{raceId}/{kind}-{dir}.webp   dir ∈ front|back|side
//   512×512 RGBA (longeye 768×256). SIDE art faces RIGHT (east)
//   canonically — a unit moving toward screen-left gets the same art
//   mirrored at draw time (see `flip` below).
// The older shared skins live flat: /art/battle/units/{kind}.webp —
// one 3/4 "front" view per kind. They are the fallback, never directional.
//
// ANGLES: everything here is a WORLD-frame atan2(dy, dx) angle — x east,
// y SOUTH (the engine's frame). A heading of −π/2 is north (the attacker
// advances −y); +π/2 is south. `viewerAngle` is the direction FROM the
// unit TOWARD the viewer/camera, in the same frame. `screenRightAngle`
// is the world direction that appears as screen-right for that viewer,
// also in the same frame:
//   - top-down map: the viewer sits south of the field looking north →
//     viewerAngle = +π/2, screenRightAngle = 0 (east).
//   - POV command camera (pov-projection): right = (cos h, sin h), so
//     screenRightAngle = the camera heading h itself.
//
// FACING BUCKETS, by rel = heading − viewerAngle (normalized):
//   |rel| ≤ 60°  → "front" (the unit faces the viewer)
//   |rel| ≥ 120° → "back"  (the unit faces away)
//   else         → "side"  (profile; flip when it moves screen-left)

export type SpriteDir = "front" | "back" | "side";

/** Bucket boundaries (radians of |rel|). */
export const FRONT_MAX_RAD = Math.PI / 3; // 60°
export const BACK_MIN_RAD = (2 * Math.PI) / 3; // 120°
/** Hysteresis: a bucket switch needs |rel| this far PAST the boundary. */
export const HYSTERESIS_RAD = 0.12;

/** Which way a unit reads on screen for one viewer, this frame. */
export interface Facing {
  dir: SpriteDir;
  /** Mirror the sprite horizontally — only ever true for "side". */
  flip: boolean;
  /** |rel| the bucket was computed from (hysteresis input). */
  absRel: number;
}

/** Normalize an angle to (−π, π]. */
export function normalizeAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r <= -Math.PI) r += Math.PI * 2;
  else if (r > Math.PI) r -= Math.PI * 2;
  return r;
}

/** Signed angle from the viewer direction to the heading, (−π, π]. */
export function relativeAngle(headingAngle: number, viewerAngle: number): number {
  return normalizeAngle(headingAngle - viewerAngle);
}

/**
 * The side-profile mirror decision: SIDE art faces screen-right
 * canonically, so flip exactly when the heading's component along the
 * viewer's screen-right axis is negative (the unit moves screen-left).
 */
export function sideFlipFor(headingAngle: number, screenRightAngle: number): boolean {
  return Math.cos(headingAngle - screenRightAngle) < 0;
}

/** Facing bucket + flip for a heading as seen by one viewer. */
export function facingFor(headingAngle: number, viewerAngle: number, screenRightAngle: number): Facing {
  const absRel = Math.abs(relativeAngle(headingAngle, viewerAngle));
  const dir: SpriteDir = absRel <= FRONT_MAX_RAD ? "front" : absRel >= BACK_MIN_RAD ? "back" : "side";
  return { dir, flip: dir === "side" ? sideFlipFor(headingAngle, screenRightAngle) : false, absRel };
}

/**
 * Hysteresis over facingFor: adopt the candidate bucket only when its
 * |rel| sits at least `margin` radians past the boundary between the
 * current bucket and the candidate (a front↔back jump must clear the FAR
 * boundary). Inside the margin the current bucket holds — and a held
 * "side" keeps its established flip, so profiles never flicker at the
 * boundary. Same-bucket candidates pass through (flip follows the side
 * sign every frame while in "side").
 */
export function nextFacing(current: Facing, candidate: Facing, margin: number = HYSTERESIS_RAD): Facing {
  const a = candidate.absRel;
  if (candidate.dir === current.dir) {
    return { dir: current.dir, flip: current.dir === "side" ? candidate.flip : false, absRel: a };
  }
  let past: number;
  if (current.dir === "front") {
    past = a - (candidate.dir === "back" ? BACK_MIN_RAD : FRONT_MAX_RAD);
  } else if (current.dir === "back") {
    past = (candidate.dir === "front" ? FRONT_MAX_RAD : BACK_MIN_RAD) - a;
  } else {
    past = candidate.dir === "front" ? FRONT_MAX_RAD - a : a - BACK_MIN_RAD;
  }
  if (past >= margin) {
    return { dir: candidate.dir, flip: candidate.dir === "side" ? candidate.flip : false, absRel: a };
  }
  return { dir: current.dir, flip: current.dir === "side" ? current.flip : false, absRel: a };
}

// ---------------------------------------------------------------------------
// Paths + store keys
// ---------------------------------------------------------------------------

const ART_ROOT = "/art/battle/units";

/** Per-race directional art: /art/battle/units/{race}/{kind}-{dir}.webp */
export function spritePath(race: string, kind: string, dir: SpriteDir): string {
  return `${ART_ROOT}/${race}/${kind}-${dir}.webp`;
}

/** The pre-race shared skin: /art/battle/units/{kind}.webp (front only). */
export function sharedSpritePath(kind: string): string {
  return `${ART_ROOT}/${kind}.webp`;
}

/** Store key for a per-race directional sprite. */
export function raceSpriteKey(race: string, kind: string, dir: SpriteDir): string {
  return `${race}|${kind}|${dir}`;
}

/** Store key for the shared fallback sprite. */
export function sharedSpriteKey(kind: string): string {
  return `shared|${kind}`;
}

// ---------------------------------------------------------------------------
// Fallback chain
// ---------------------------------------------------------------------------

export interface ResolvedSprite {
  /** Key into the renderer's sprite store. */
  key: string;
  /** True when the resolved art is the per-race directional set. */
  raceArt: boolean;
  /** The direction the RESOLVED art actually shows (shared = "front"). */
  dir: SpriteDir;
}

export type SpriteAvailability = ReadonlySet<string> | ((key: string) => boolean);

/**
 * The fallback chain, first hit wins:
 *   race + wanted dir → race + front → shared (front only) → null (glyph).
 * `available` is the set/predicate of store keys whose art has actually
 * loaded — a race dir that 404s or is still in flight simply isn't in
 * the set, so the chain settles on the best art that exists right now.
 */
export function resolveSprite(
  available: SpriteAvailability,
  race: string | null,
  kind: string,
  dir: SpriteDir,
): ResolvedSprite | null {
  const has = typeof available === "function" ? available : (k: string) => available.has(k);
  if (race) {
    const wanted = raceSpriteKey(race, kind, dir);
    if (has(wanted)) return { key: wanted, raceArt: true, dir };
    if (dir !== "front") {
      const front = raceSpriteKey(race, kind, "front");
      if (has(front)) return { key: front, raceArt: true, dir: "front" };
    }
  }
  const shared = sharedSpriteKey(kind);
  if (has(shared)) return { key: shared, raceArt: false, dir: "front" };
  return null;
}
