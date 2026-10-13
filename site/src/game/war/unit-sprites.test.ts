// unit-sprites.test.ts — per-race directional sprite math (owner
// 2026-10-12): bucket boundaries, flip signs in the map and POV frames,
// hysteresis, and the fallback chain order. Pure — if these break, units
// moonwalk or show their backs to the player.
import { describe, expect, test } from "bun:test";
import {
  BACK_MIN_RAD,
  facingFor,
  FRONT_MAX_RAD,
  HYSTERESIS_RAD,
  nextFacing,
  normalizeAngle,
  raceSpriteKey,
  relativeAngle,
  resolveSprite,
  sharedSpriteKey,
  sharedSpritePath,
  spritePath,
  type Facing,
} from "./unit-sprites";

const DEG = Math.PI / 180;
// Map frame: viewer south of the field looking north; screen-right = east.
const MAP_VIEWER = Math.PI / 2;
const MAP_RIGHT = 0;

describe("paths + keys", () => {
  test("race art path follows {race}/{kind}-{dir}.webp", () => {
    expect(spritePath("draconians", "bulwark", "side")).toBe("/art/battle/units/draconians/bulwark-side.webp");
    expect(spritePath("watchers", "longeye", "front")).toBe("/art/battle/units/watchers/longeye-front.webp");
    expect(spritePath("unbound", "turret", "back")).toBe("/art/battle/units/unbound/turret-back.webp");
  });
  test("shared path is the flat pre-race file", () => {
    expect(sharedSpritePath("reaver")).toBe("/art/battle/units/reaver.webp");
  });
  test("store keys are distinct per race/kind/dir", () => {
    expect(raceSpriteKey("grays", "warden", "back")).toBe("grays|warden|back");
    expect(sharedSpriteKey("warden")).toBe("shared|warden");
  });
});

describe("angle helpers", () => {
  test("normalizeAngle wraps to (−π, π]", () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 9);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(normalizeAngle(-1.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 9);
  });
  test("relativeAngle is heading minus viewer, wrapped", () => {
    expect(relativeAngle(Math.PI / 2, Math.PI / 2)).toBeCloseTo(0, 9);
    expect(relativeAngle(-Math.PI / 2, Math.PI / 2)).toBeCloseTo(Math.PI, 9); // −π wraps to +π
    expect(relativeAngle(Math.PI, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 9);
  });
});

describe("facing buckets — boundaries", () => {
  // Viewer due east of the unit (viewerAngle 0): rel == heading.
  const bucket = (headingDeg: number) => facingFor(headingDeg * DEG, 0, 0);
  test("facing the viewer → front, including the exact 60° edge", () => {
    expect(bucket(0).dir).toBe("front");
    expect(bucket(45).dir).toBe("front");
    expect(bucket(60).dir).toBe("front");
    expect(bucket(-60).dir).toBe("front");
    expect(bucket(60).absRel).toBeCloseTo(FRONT_MAX_RAD, 9);
  });
  test("just past 60° → side, up to just under 120°", () => {
    expect(bucket(61).dir).toBe("side");
    expect(bucket(90).dir).toBe("side");
    expect(bucket(-90).dir).toBe("side");
    expect(bucket(119).dir).toBe("side");
  });
  test("120° and beyond → back, including dead-away", () => {
    expect(bucket(120).dir).toBe("back");
    expect(bucket(-120).dir).toBe("back");
    expect(bucket(180).dir).toBe("back");
    expect(bucket(120).absRel).toBeCloseTo(BACK_MIN_RAD, 9);
  });
  test("front and back never flip", () => {
    expect(bucket(0).flip).toBe(false);
    expect(bucket(180).flip).toBe(false);
  });
});

describe("flip signs — top-down map (viewer south, screen-right east)", () => {
  const map = (heading: number) => facingFor(heading, MAP_VIEWER, MAP_RIGHT);
  test("east-marching unit: side profile, unflipped (art faces right)", () => {
    const f = map(0);
    expect(f.dir).toBe("side");
    expect(f.flip).toBe(false);
  });
  test("west-marching unit: side profile, flipped to face left", () => {
    const f = map(Math.PI);
    expect(f.dir).toBe("side");
    expect(f.flip).toBe(true);
  });
  test("north-marching attacker (away from the south viewer) shows its back", () => {
    expect(map(-Math.PI / 2).dir).toBe("back");
  });
  test("south-marching defender (toward the viewer) shows its front", () => {
    expect(map(Math.PI / 2).dir).toBe("front");
  });
});

describe("flip signs — POV command camera", () => {
  // Camera heading h: forward (sin h, −cos h), right (cos h, sin h) — so
  // screenRightAngle = h in world atan2 terms (pov-projection.ts).
  test("camera south looking north (h=0): a west-marching unit moves screen-left → flipped profile", () => {
    // Camera is south of the unit → direction unit→camera is south (+π/2).
    const f = facingFor(Math.PI, Math.PI / 2, 0);
    expect(f.dir).toBe("side");
    expect(f.flip).toBe(true);
  });
  test("camera south looking north (h=0): an east-marching unit moves screen-right → unflipped", () => {
    const f = facingFor(0, Math.PI / 2, 0);
    expect(f.dir).toBe("side");
    expect(f.flip).toBe(false);
  });
  test("camera west looking east (h=π/2): a north-marching unit moves screen-left → flipped", () => {
    // Camera west of the unit → unit→camera points west (π).
    const f = facingFor(-Math.PI / 2, Math.PI, Math.PI / 2);
    expect(f.dir).toBe("side");
    expect(f.flip).toBe(true);
  });
  test("camera west looking east (h=π/2): a south-marching unit moves screen-right → unflipped", () => {
    const f = facingFor(Math.PI / 2, Math.PI, Math.PI / 2);
    expect(f.dir).toBe("side");
    expect(f.flip).toBe(false);
  });
  test("unit marching straight at the camera shows its front; straight away, its back", () => {
    // Camera south (viewer π/2): unit marching south comes at us.
    expect(facingFor(Math.PI / 2, Math.PI / 2, 0).dir).toBe("front");
    expect(facingFor(-Math.PI / 2, Math.PI / 2, 0).dir).toBe("back");
  });
});

describe("hysteresis — nextFacing", () => {
  const cand = (headingRad: number) => facingFor(headingRad, 0, 0); // viewer east: rel == heading
  const front: Facing = { dir: "front", flip: false, absRel: 0.2 };
  const sideR: Facing = { dir: "side", flip: false, absRel: Math.PI / 2 };
  const back: Facing = { dir: "back", flip: false, absRel: Math.PI };

  test("the margin constant is the pinned 0.12 rad", () => {
    expect(HYSTERESIS_RAD).toBeCloseTo(0.12, 9);
  });
  test("front holds inside the margin past 60°", () => {
    expect(nextFacing(front, cand(FRONT_MAX_RAD + 0.05)).dir).toBe("front");
  });
  test("front yields to side beyond the margin", () => {
    expect(nextFacing(front, cand(FRONT_MAX_RAD + 0.2)).dir).toBe("side");
  });
  test("side holds inside the margin inside 60°, keeping its flip", () => {
    const sideFlipped: Facing = { dir: "side", flip: true, absRel: Math.PI / 2 };
    const held = nextFacing(sideFlipped, cand(FRONT_MAX_RAD - 0.05));
    expect(held.dir).toBe("side");
    expect(held.flip).toBe(true);
  });
  test("side yields to front beyond the margin", () => {
    expect(nextFacing(sideR, cand(FRONT_MAX_RAD - 0.2)).dir).toBe("front");
  });
  test("side holds inside the margin past 120°; yields beyond", () => {
    expect(nextFacing(sideR, cand(BACK_MIN_RAD + 0.05)).dir).toBe("side");
    expect(nextFacing(sideR, cand(BACK_MIN_RAD + 0.2)).dir).toBe("back");
  });
  test("back holds inside the margin inside 120°; yields beyond", () => {
    expect(nextFacing(back, cand(BACK_MIN_RAD - 0.05)).dir).toBe("back");
    expect(nextFacing(back, cand(BACK_MIN_RAD - 0.2)).dir).toBe("side");
  });
  test("a front↔back jump must clear the FAR boundary by the margin", () => {
    expect(nextFacing(front, cand(BACK_MIN_RAD + 0.05)).dir).toBe("front");
    expect(nextFacing(front, cand(BACK_MIN_RAD + 0.2)).dir).toBe("back");
    expect(nextFacing(back, cand(FRONT_MAX_RAD - 0.05)).dir).toBe("back");
    expect(nextFacing(back, cand(FRONT_MAX_RAD - 0.2)).dir).toBe("front");
  });
  test("same bucket passes through and flip follows the side sign", () => {
    const east = facingFor(0, MAP_VIEWER, MAP_RIGHT); // side, flip false
    const west = facingFor(Math.PI, MAP_VIEWER, MAP_RIGHT); // side, flip true
    expect(nextFacing(east, west).flip).toBe(true);
    expect(nextFacing(west, east).flip).toBe(false);
  });
});

describe("fallback chain — resolveSprite", () => {
  const all = new Set([
    raceSpriteKey("grays", "bulwark", "front"),
    raceSpriteKey("grays", "bulwark", "back"),
    raceSpriteKey("grays", "bulwark", "side"),
    sharedSpriteKey("bulwark"),
  ]);
  test("race + wanted dir wins when present", () => {
    const r = resolveSprite(all, "grays", "bulwark", "side");
    expect(r).toEqual({ key: "grays|bulwark|side", raceArt: true, dir: "side" });
  });
  test("missing race dir falls to race front (still race art)", () => {
    const avail = new Set([raceSpriteKey("grays", "bulwark", "front"), sharedSpriteKey("bulwark")]);
    const r = resolveSprite(avail, "grays", "bulwark", "back");
    expect(r).toEqual({ key: "grays|bulwark|front", raceArt: true, dir: "front" });
  });
  test("no race art at all falls to the shared front", () => {
    const avail = new Set([sharedSpriteKey("bulwark")]);
    const r = resolveSprite(avail, "grays", "bulwark", "side");
    expect(r).toEqual({ key: "shared|bulwark", raceArt: false, dir: "front" });
  });
  test("null race skips straight to shared", () => {
    const r = resolveSprite(all, null, "bulwark", "side");
    expect(r).toEqual({ key: "shared|bulwark", raceArt: false, dir: "front" });
  });
  test("wanted dir = front with no race front still reaches shared", () => {
    const avail = new Set([raceSpriteKey("grays", "bulwark", "side"), sharedSpriteKey("bulwark")]);
    const r = resolveSprite(avail, "grays", "bulwark", "front");
    expect(r?.raceArt).toBe(false);
    expect(r?.key).toBe("shared|bulwark");
  });
  test("nothing available → null (the caller draws the glyph)", () => {
    expect(resolveSprite(new Set<string>(), "grays", "bulwark", "front")).toBeNull();
    expect(resolveSprite(new Set<string>(), null, "bulwark", "front")).toBeNull();
  });
  test("predicate form resolves identically", () => {
    const pred = (k: string) => all.has(k);
    expect(resolveSprite(pred, "grays", "bulwark", "back")?.key).toBe("grays|bulwark|back");
    expect(resolveSprite(pred, "nephilim", "bulwark", "back")?.key).toBe("shared|bulwark");
  });
});
