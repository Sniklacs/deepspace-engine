// COORDINATES — the globe's X/Y system (owner 2026-10-16).
//
// One mapping, defined once in globe-coords.ts: X from longitude
// (0..359, west edge → east), Y from latitude (0 at the north pole,
// 180 at the south). What the sheets display is exactly what chat
// linkifies: these tests pin the round-trip (position → pair → text →
// pair → position), the search-box parser (tagged AND bare pairs), and
// the chat parser's strictness — tagged pairs only, in range only, so
// ordinary numbers in conversation never become fly-to chips.
// Run: bun test site/src/game/globe-coords.test.ts
import { describe, expect, test } from "bun:test";
import {
  coordsOf,
  formatCoordPair,
  formatCoords,
  latLonOfCoords,
  parseCoordsInput,
  parseTaggedCoords,
  splitCoordSegments,
  type GlobeCoords,
} from "./globe-coords";

describe("globe coordinates — the mapping", () => {
  test("anchors: equator/prime meridian, poles, and the wrap", () => {
    expect(coordsOf(0, 0)).toEqual({ x: 180, y: 90 });
    expect(coordsOf(90, 0)).toEqual({ x: 180, y: 0 });
    expect(coordsOf(-90, 0)).toEqual({ x: 180, y: 180 });
    expect(coordsOf(0, -180)).toEqual({ x: 0, y: 90 });
    expect(coordsOf(0, 179.6).x).toBe(0); // wraps past the east edge
    expect(coordsOf(27, -147)).toEqual({ x: 33, y: 63 });
    expect(coordsOf(-33.86, 151.2)).toEqual({ x: 331, y: 124 });
  });

  test("round-trip: position → pair → position lands in the same cell", () => {
    for (let lat = -88; lat <= 88; lat += 7.3) {
      for (let lon = -179; lon <= 179; lon += 11.7) {
        const c = coordsOf(lat, lon);
        const back = latLonOfCoords(c);
        expect(coordsOf(back.lat, back.lon)).toEqual(c);
      }
    }
  });

  test("the display format is canonical — and it is what chat recognizes", () => {
    expect(formatCoords(27, -147)).toBe("X 33 · Y 63");
    expect(formatCoordPair({ x: 33, y: 63 })).toBe("X 33 · Y 63");
    for (const [lat, lon] of [[0, 0], [45.2, -122.7], [-12.9, 77.3], [80, 179]] as const) {
      const text = formatCoords(lat, lon);
      const hits = parseTaggedCoords(text);
      expect(hits).toHaveLength(1);
      expect(hits[0]!.coords).toEqual(coordsOf(lat, lon));
    }
  });
});

describe("globe coordinates — the search-box parser", () => {
  test("accepts the tagged format and bare pairs", () => {
    expect(parseCoordsInput("X 214 · Y 63")).toEqual({ x: 214, y: 63 });
    expect(parseCoordsInput("x 214 y 63")).toEqual({ x: 214, y: 63 });
    expect(parseCoordsInput("214, 63")).toEqual({ x: 214, y: 63 });
    expect(parseCoordsInput("214 63")).toEqual({ x: 214, y: 63 });
    expect(parseCoordsInput("  214,63  ")).toEqual({ x: 214, y: 63 });
    expect(parseCoordsInput("0 0")).toEqual({ x: 0, y: 0 });
    expect(parseCoordsInput("359 180")).toEqual({ x: 359, y: 180 });
  });

  test("rejects prose, lone numbers, and out-of-range pairs", () => {
    expect(parseCoordsInput("Hollow Warrens")).toBeNull();
    expect(parseCoordsInput("214")).toBeNull();
    expect(parseCoordsInput("")).toBeNull();
    expect(parseCoordsInput("360 10")).toBeNull();
    expect(parseCoordsInput("10 181")).toBeNull();
    expect(parseCoordsInput("-5 10")).toBeNull();
    expect(parseCoordsInput("12.5 40")).toBeNull();
    expect(parseCoordsInput("meet at 214, 63 please")).toBeNull(); // prose around a pair is a search, not a flight
  });
});

describe("globe coordinates — the chat parser (strict)", () => {
  test("a tagged pair in a sentence becomes one chip; text reassembles exactly", () => {
    const msg = "rally at X 214 · Y 63 at dawn";
    const segs = splitCoordSegments(msg);
    expect(segs.map((s) => s.text).join("")).toBe(msg);
    const chips = segs.filter((s) => s.coords);
    expect(chips).toHaveLength(1);
    expect(chips[0]!.coords).toEqual({ x: 214, y: 63 });
    // the chip's target is the cell the pair names
    expect(latLonOfCoords(chips[0]!.coords as GlobeCoords)).toEqual({ lat: 27, lon: 34 });
  });

  test("two pairs in one message both linkify", () => {
    const segs = splitCoordSegments("from X 10 · Y 20 to X 30 · Y 40");
    expect(segs.filter((s) => s.coords).map((s) => s.coords)).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
  });

  test("ordinary numbers NEVER linkify — bare pairs included", () => {
    const plain = [
      "I have 5 apples and 12 oranges",
      "meet at 214, 63", // no X/Y tags — chat stays chat
      "level 12, wave 40 incoming",
      "it costs 6000 supplies",
      "gg wp 100",
    ];
    for (const msg of plain) {
      const segs = splitCoordSegments(msg);
      expect(segs).toHaveLength(1);
      expect(!segs[0]!.coords).toBe(true);
      expect(segs[0]!.text).toBe(msg);
    }
  });

  test("out-of-range tagged pairs stay plain text", () => {
    for (const msg of ["X 360 · Y 10", "X 12 · Y 181", "X 999 · Y 999"]) {
      const segs = splitCoordSegments(msg);
      expect(segs.every((s) => !s.coords)).toBe(true);
      expect(segs.map((s) => s.text).join("")).toBe(msg);
    }
  });

  test("boundaries linkify; case and spacing are forgiving", () => {
    expect(splitCoordSegments("X 0 · Y 0").some((s) => s.coords?.x === 0)).toBe(true);
    expect(splitCoordSegments("x 359 · y 180").some((s) => s.coords?.y === 180)).toBe(true);
    expect(splitCoordSegments("X214·Y63").some((s) => s.coords?.x === 214)).toBe(true);
  });
});
