// Tests for the day/night solar math (game/solar.ts).
// Run: bun test site/src/game/solar.test.ts
import { describe, expect, test } from "bun:test";
import {
  anchoredSubsolarPoint,
  dayOfYearUTC,
  nightFactor,
  normalizeLon180,
  solarDeclinationDeg,
  subsolarLongitudeDeg,
  subsolarPoint,
  sunViewVector,
} from "./solar";

describe("dayOfYearUTC", () => {
  test("Jan 1 is day 1, Dec 31 2026 is day 365 (not a leap year)", () => {
    expect(dayOfYearUTC(new Date(Date.UTC(2026, 0, 1)))).toBe(1);
    expect(dayOfYearUTC(new Date(Date.UTC(2026, 11, 31)))).toBe(365);
  });
});

describe("normalizeLon180", () => {
  test("wraps into (−180, 180]", () => {
    expect(normalizeLon180(190)).toBeCloseTo(-170, 9);
    expect(normalizeLon180(-190)).toBeCloseTo(170, 9);
    expect(normalizeLon180(180)).toBeCloseTo(180, 9);
    expect(normalizeLon180(0)).toBe(0);
  });
});

describe("solarDeclinationDeg — the documented approximation", () => {
  test("March equinox ≈ 0°", () => {
    // 2026-03-20 12:00 UTC. doy=79 → −23.44·cos(2π·89/365) ≈ −0.9°.
    const d = solarDeclinationDeg(new Date(Date.UTC(2026, 2, 20, 12)));
    expect(Math.abs(d)).toBeLessThan(1.5);
  });
  test("June solstice ≈ +23.44°", () => {
    const d = solarDeclinationDeg(new Date(Date.UTC(2026, 5, 21, 12)));
    expect(Math.abs(d - 23.44)).toBeLessThan(1);
  });
  test("December solstice ≈ −23.44°", () => {
    const d = solarDeclinationDeg(new Date(Date.UTC(2026, 11, 21, 12)));
    expect(Math.abs(d + 23.44)).toBeLessThan(1);
  });
  test("deterministic — same instant, same answer", () => {
    const a = new Date(Date.UTC(2026, 8, 15, 3, 22, 11));
    expect(solarDeclinationDeg(a)).toBe(solarDeclinationDeg(new Date(a.getTime())));
  });
});

describe("subsolarLongitudeDeg — OUR documented convention", () => {
  test("12:00 UTC → 0° (prime-meridian convention)", () => {
    expect(subsolarLongitudeDeg(new Date(Date.UTC(2026, 2, 20, 12)))).toBeCloseTo(0, 9);
  });
  test("00:00 UTC → ±180° (antimeridian)", () => {
    expect(Math.abs(subsolarLongitudeDeg(new Date(Date.UTC(2026, 2, 20, 0))))).toBeCloseTo(180, 9);
  });
  test("06:00 UTC → 90°", () => {
    expect(subsolarLongitudeDeg(new Date(Date.UTC(2026, 2, 20, 6)))).toBeCloseTo(90, 9);
  });
});

describe("subsolarPoint", () => {
  test("March equinox ~noon UTC → lat ≈ 0°, lon ≈ 0° (our convention)", () => {
    const p = subsolarPoint(new Date(Date.UTC(2026, 2, 20, 12)));
    expect(Math.abs(p.lat)).toBeLessThan(1.5);
    expect(Math.abs(p.lon)).toBeLessThan(2);
  });
});

describe("anchoredSubsolarPoint — player-anchored phase", () => {
  // The Date(y,m,d,h,…) constructor reads in the RUNNER's local TZ and
  // getHours() reads the same local clock back — deterministic on any box.
  test("device-local midnight → colony at the antimeridian (dark)", () => {
    const p = anchoredSubsolarPoint(37, new Date(2026, 5, 21, 0, 0, 0));
    expect(Math.abs(p.lon - normalizeLon180(37 + 180))).toBeLessThan(0.01);
  });
  test("device-local noon → subsolar point over the colony (light)", () => {
    const p = anchoredSubsolarPoint(37, new Date(2026, 5, 21, 12, 0, 0));
    expect(Math.abs(p.lon - 37)).toBeLessThan(0.01);
  });
  test("device-local 06:00 → subsolar 90° east of the colony", () => {
    const p = anchoredSubsolarPoint(-120, new Date(2026, 5, 21, 6, 0, 0));
    expect(Math.abs(p.lon - normalizeLon180(-120 + 90))).toBeLessThan(0.01);
  });
  test("latitude stays the real solar declination (June → ≈ +23.44°)", () => {
    const p = anchoredSubsolarPoint(0, new Date(2026, 5, 21, 12, 0, 0));
    expect(Math.abs(p.lat - 23.44)).toBeLessThan(1);
  });
  test("deterministic", () => {
    const d = new Date(2026, 9, 4, 22, 41, 0);
    const a = anchoredSubsolarPoint(12.5, d);
    const b = anchoredSubsolarPoint(12.5, new Date(d.getTime()));
    expect(a).toEqual(b);
  });
});

describe("nightFactor", () => {
  test("0 at the subsolar point, 1 at the antimeridian", () => {
    expect(nightFactor(0, 0, 1, 0, 0, 1)).toBe(0); // facing the sun
    expect(nightFactor(0, 0, 1, 0, 0, -1)).toBe(1); // sun behind
  });
  test("≈0.5 on the terminator, smooth band around it", () => {
    const on = nightFactor(1, 0, 0, 0, 0, 1);
    expect(on).toBeGreaterThan(0.4);
    expect(on).toBeLessThan(0.6);
    const daySide = nightFactor(0.3, 0, 0.95, 0, 0, 1);
    const nightSide = nightFactor(0.3, 0, -0.95, 0, 0, 1);
    expect(daySide).toBeLessThan(on);
    expect(nightSide).toBeGreaterThan(on);
  });
  test("clamps at the extremes", () => {
    expect(nightFactor(0, 0, 1, 0, 0.5, 0.866)).toBe(0);
    expect(nightFactor(0, 0, 1, 0, 0.5, -0.866)).toBe(1);
  });
});

describe("sunViewVector", () => {
  test("subsolar point at (0°, 0°), no spin/tilt → sun dead ahead (+z)", () => {
    const s = sunViewVector(0, 0, 0, 0);
    expect(s.x).toBeCloseTo(0, 9);
    expect(s.y).toBeCloseTo(0, 9);
    expect(s.z).toBeCloseTo(1, 9);
  });
  test("agrees with projectGlobe's rotation math (spin −90° puts lon 0 at +x… spot-check unit length)", () => {
    const s = sunViewVector(23.44, -45, 120, -20);
    const len = Math.hypot(s.x, s.y, s.z);
    expect(len).toBeCloseTo(1, 9);
  });
});
