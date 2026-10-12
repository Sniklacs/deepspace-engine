// camera-flights.test.ts — pure kernel tests for the cinematic flight system.
// Run: bun test site/src/game/world/camera-flights.test.ts
import { describe, expect, test as it } from "bun:test";
import {
  easeCubicInOut,
  flightDurationS,
  guardScale,
  shortestDegDelta,
  startFlight,
  stepFlight,
} from "./camera-flights";

describe("shortestDegDelta", () => {
  it("takes the short way around the 0/360 seam", () => {
    expect(shortestDegDelta(350, 10)).toBeCloseTo(20);
    expect(shortestDegDelta(10, 350)).toBeCloseTo(-20);
    expect(shortestDegDelta(0, 180)).toBeCloseTo(180);
  });
});

describe("easeCubicInOut", () => {
  it("starts at 0, ends at 1, midpoint at 0.5", () => {
    expect(easeCubicInOut(0)).toBe(0);
    expect(easeCubicInOut(1)).toBe(1);
    expect(easeCubicInOut(0.5)).toBeCloseTo(0.5);
  });
  it("is slower than linear at the start", () => {
    expect(easeCubicInOut(0.2)).toBeLessThan(0.2);
  });
});

describe("flightDurationS", () => {
  it("short hops are quick, long dives take longer", () => {
    const short = flightDurationS(
      { spin: 0, tilt: 0, scale: 1 },
      { spin: 10, tilt: 0, scale: 1.2 },
    );
    const long = flightDurationS(
      { spin: 0, tilt: 0, scale: 0.3 },
      { spin: 170, tilt: 40, scale: 14 },
    );
    expect(short).toBeLessThan(long);
    expect(short).toBeGreaterThan(0.9);
    expect(long).toBeLessThan(4.5);
  });
});

describe("startFlight + stepFlight", () => {
  it("interpolates spin via the shortest path and zoom in octave space", () => {
    const flight = startFlight(
      { spin: 350, tilt: 0, scale: 1 },
      { spin: 10, tilt: 20, scale: 4 },
      { durationS: 2, easing: (t) => t },
    );
    expect(flight.spinDelta).toBeCloseTo(20);
    const half = stepFlight(flight, 1);
    expect(half.done).toBe(false);
    expect(half.pose.spin).toBeCloseTo(360); // 350 + 20 * 0.5
    expect(half.pose.tilt).toBeCloseTo(10);
    expect(half.pose.scale).toBeCloseTo(2); // octave midpoint of 1→4
    const end = stepFlight({ ...flight, elapsedS: 1 }, 1.5);
    expect(end.done).toBe(true);
    expect(end.pose.scale).toBeCloseTo(4);
  });
});

describe("guardScale", () => {
  it("clamps to the zoom continuum", () => {
    expect(guardScale(1000)).toBe(24);
    expect(guardScale(-5)).toBeGreaterThan(0);
    expect(guardScale(NaN)).toBe(1);
  });
});
