import { describe, expect, test } from "bun:test";
import {
  bakeTerrainRegion,
  bakeWorldTexture,
  elevationAt,
  elevationDetailAt,
  greatCircleDeg,
  terrainRGB,
  worldCorruptionAt,
  WORLD_TERRAIN_SEED,
} from "./terrain-field";

const HEART = { lat: 10, lon: 20 };

describe("elevationAt — one continuous world", () => {
  test("deterministic per (lat, lon)", () => {
    expect(elevationAt(12.3, -45.6)).toBe(elevationAt(12.3, -45.6));
    expect(elevationAt(-70, 170)).toBe(elevationAt(-70, 170));
  });

  test("stays in 0..1 across a sweep", () => {
    for (let lat = -85; lat <= 85; lat += 7) {
      for (let lon = -180; lon <= 180; lon += 9) {
        const e = elevationAt(lat, lon);
        expect(e >= 0 && e <= 1).toBe(true);
      }
    }
  });

  test("seamless around the antimeridian", () => {
    for (let lat = -80; lat <= 80; lat += 10) {
      expect(Math.abs(elevationAt(lat, -180) - elevationAt(lat, 180))).toBeLessThan(1e-9);
      // 0.2° apart across the seam: continuous, not identical — real terrain.
      expect(Math.abs(elevationAt(lat, -179.9) - elevationAt(lat, 179.9))).toBeLessThan(0.4);
    }
  });

  test("varies — not a flat world", () => {
    const vals = new Set<number>();
    for (let i = 0; i < 200; i++) {
      vals.add(Math.round(elevationAt(i * 1.7 - 85, i * 3.3 - 180) * 20));
    }
    expect(vals.size).toBeGreaterThan(10);
  });

  test("seed is a fixed constant", () => {
    expect(WORLD_TERRAIN_SEED).toBe(20261011);
  });
});

describe("elevationDetailAt — fine grain for deep layers", () => {
  test("bounded, zero-mean-ish, deterministic, seamless", () => {
    let sum = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const lat = (i * 7.3) % 170 - 85;
      const lon = (i * 13.7) % 360 - 180;
      const d = elevationDetailAt(lat, lon);
      expect(d >= -0.16 && d <= 0.16).toBe(true);
      sum += d;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.03);
    expect(elevationDetailAt(20, 30)).toBe(elevationDetailAt(20, 30));
    for (let lat = -80; lat <= 80; lat += 20) {
      expect(Math.abs(elevationDetailAt(lat, -180) - elevationDetailAt(lat, 180))).toBeLessThan(1e-9);
    }
  });

  test("actually varies at the degree scale", () => {
    const vals = new Set<number>();
    for (let i = 0; i < 100; i++) {
      vals.add(Math.round(elevationDetailAt(10 + i * 0.2, -40 + i * 0.13) * 1000));
    }
    expect(vals.size).toBeGreaterThan(20);
  });
});

describe("worldCorruptionAt — the blight around the Chorus heart", () => {
  test("1 at the heart, ~0 in the deep outskirts", () => {
    expect(worldCorruptionAt(HEART.lat, HEART.lon, HEART)).toBeGreaterThan(0.95);
    expect(worldCorruptionAt(-HEART.lat, HEART.lon + 180, HEART)).toBeLessThan(0.05);
  });

  test("deterministic", () => {
    expect(worldCorruptionAt(30, -60, HEART)).toBe(worldCorruptionAt(30, -60, HEART));
  });

  test("great-circle distance sanity", () => {
    expect(greatCircleDeg(0, 0, 0, 0)).toBe(0);
    expect(greatCircleDeg(0, 0, 0, 90)).toBeCloseTo(90, 5);
    expect(greatCircleDeg(0, 0, 0, 180)).toBeCloseTo(180, 5);
  });
});

describe("terrainRGB — no blue anywhere", () => {
  test("never emits blue-dominant pixels across the full sweep", () => {
    for (let e = 0; e <= 1; e += 0.05) {
      for (let c = 0; c <= 1; c += 0.05) {
        for (let d = 0; d <= 1; d += 0.2) {
          const [r, g, b] = terrainRGB(e, c, d);
          for (const v of [r, g, b]) {
            expect(v >= 0 && v <= 255).toBe(true);
          }
          // Blue may never dominate: this is land, not water.
          expect(b > r && b > g).toBe(false);
        }
      }
    }
  });

  test("healthy lowlands read green, deep blight reads burnt", () => {
    const [r1, g1] = terrainRGB(0.2, 0, 0.5);
    expect(g1).toBeGreaterThan(r1);
    const [r2, g2, b2] = terrainRGB(0.5, 1, 0.5);
    expect(r2).toBeGreaterThan(g2);
    expect(b2).toBeLessThan(60);
  });
});

describe("bakeTerrainRegion — each zoom level renders its own layer", () => {
  test("returns the requested size, fully opaque, no blue", () => {
    const img = bakeTerrainRegion(64, 64, 10, 20, 4, HEART);
    expect(img.width).toBe(64);
    expect(img.height).toBe(64);
    const px = img.data;
    for (let o = 0; o < px.length; o += 4) {
      expect(px[o + 3]).toBe(255);
      const r = px[o], g = px[o + 1], b = px[o + 2];
      expect(b > r && b > g).toBe(false);
    }
  });

  test("higher density resolves the same field — denser sample, same world", () => {
    // Same center/ppd ratio: the coarse layer's center pixel and the fine
    // layer's center pixel read the same underlying field.
    const coarse = bakeTerrainRegion(32, 32, 10, 20, 2, HEART);
    const fine = bakeTerrainRegion(64, 64, 10, 20, 4, HEART);
    const cc = 16 * 32 * 4;
    const fc = 32 * 64 * 4;
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(coarse.data[cc + k] - fine.data[fc + k])).toBeLessThan(48);
    }
  });
});

describe("bakeWorldTexture — one equirectangular land map", () => {
  test("bakes at the requested size with no blue", () => {
    const img = bakeWorldTexture(72, 36, HEART);
    expect(img.width).toBe(72);
    expect(img.height).toBe(36);
    const px = img.data;
    let blueCount = 0;
    for (let o = 0; o < px.length; o += 4) {
      if (px[o + 2] > px[o] && px[o + 2] > px[o + 1]) blueCount++;
    }
    expect(blueCount).toBe(0);
  });
});
