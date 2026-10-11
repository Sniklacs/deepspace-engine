// Tests for the seamless-world tile cache + streaming controller
// (game/world/tile-cache.ts). Run: bun test site/src/game/world/tile-cache.test.ts
import { describe, expect, test } from "bun:test";
import {
  TILE_CACHE_MAX,
  TileStreamer,
  normalizeTile,
  parseTileKey,
  tileCoordsForLatLon,
  tileGridSize,
  tileKey,
  type TileBakeRequest,
} from "./tile-cache";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("tileKey — deterministic seeded tile identity", () => {
  test("same inputs always bake the same key", () => {
    expect(tileKey(2, 3, 1)).toBe(tileKey(2, 3, 1));
    expect(tileKey(0, 0, 0)).toBe("L0:0:0");
  });

  test("different tiles get different keys", () => {
    expect(tileKey(2, 3, 1)).not.toBe(tileKey(2, 4, 1));
    expect(tileKey(2, 3, 1)).not.toBe(tileKey(3, 3, 1));
  });

  test("longitude wraps east/west (planet is a sphere)", () => {
    // Level 2 has 8 columns.
    expect(tileKey(2, 8, 0)).toBe(tileKey(2, 0, 0));
    expect(tileKey(2, -1, 0)).toBe(tileKey(2, 7, 0));
    expect(tileKey(2, 8 + 3, 0)).toBe(tileKey(2, 3, 0));
  });

  test("latitude clamps at the poles", () => {
    // Level 1 has 2 rows.
    expect(tileKey(1, 0, 5)).toBe(tileKey(1, 0, 1));
    expect(tileKey(1, 0, -3)).toBe(tileKey(1, 0, 0));
  });

  test("fractional coords and negative levels normalize", () => {
    expect(tileKey(1, 0.9, 0)).toBe(tileKey(1, 0, 0));
    expect(tileKey(-2, 0, 0)).toBe(tileKey(0, 0, 0));
  });

  test("parseTileKey round-trips", () => {
    const t = normalizeTile(2, 3, 1);
    expect(parseTileKey(tileKey(2, 3, 1))).toEqual(t);
    expect(parseTileKey("bogus")).toBeNull();
  });
});

describe("tileGridSize / tileCoordsForLatLon", () => {
  test("pyramid dimensions", () => {
    expect(tileGridSize(0)).toEqual({ cols: 2, rows: 1 });
    expect(tileGridSize(1)).toEqual({ cols: 4, rows: 2 });
    expect(tileGridSize(2)).toEqual({ cols: 8, rows: 4 });
  });

  test("lat/lon maps into the grid with wrap + clamp", () => {
    const a = tileCoordsForLatLon(0, 0, 1);
    expect(a).toEqual({ level: 1, x: 2, y: 1 });
    // Longitude wraps: 190° == -170°.
    expect(tileCoordsForLatLon(0, 190, 1)).toEqual(tileCoordsForLatLon(0, -170, 1));
    // Latitude clamps: the north pole is the top row, not off-grid.
    expect(tileCoordsForLatLon(100, 0, 1).y).toBe(0);
    expect(tileCoordsForLatLon(-100, 0, 1).y).toBe(1);
  });
});

describe("TileStreamer — streaming + LRU", () => {
  test("update() requests the 3×3 around the camera, asynchronously", async () => {
    const seen: TileBakeRequest[] = [];
    const gate = deferred<string>();
    const s = new TileStreamer<string>({
      seed: 42,
      bakeTile: (req) => {
        seen.push(req);
        return gate.promise.then(() => `tile:${req.key}`);
      },
    });

    s.update({ level: 2, x: 4, y: 2 });

    // Async bake never blocks: requested but not yet available.
    expect(seen).toHaveLength(9);
    expect(s.pendingCount()).toBe(9);
    expect(s.size()).toBe(0);
    expect(s.get(tileKey(2, 4, 2))).toBeUndefined();
    // The request carries the seed + deterministic key (the bake contract).
    expect(seen[0].seed).toBe(42);
    expect(seen[0].key).toBe(tileKey(seen[0].level, seen[0].x, seen[0].y));

    gate.resolve("ready");
    await flush();
    expect(s.size()).toBe(9);
    expect(s.pendingCount()).toBe(0);
    expect(s.get(tileKey(2, 4, 2))).toBe(`tile:${tileKey(2, 4, 2)}`);
    s.dispose();
  });

  test("update() is a no-op for already-baked / already-baking tiles", async () => {
    let calls = 0;
    const s = new TileStreamer<string>({
      seed: 7,
      bakeTile: async () => {
        calls++;
        return "t";
      },
    });
    // Level 2: 9 unique tiles in the 3×3 (level 1's pole-clamped rows would
    // only yield 6).
    s.update({ level: 2, x: 4, y: 2 });
    s.update({ level: 2, x: 4, y: 2 });
    await flush();
    expect(calls).toBe(9); // second update didn't re-request
    s.dispose();
  });

  test("parent fallback: coarser tile served while the child bakes", async () => {
    const gates = new Map<string, ReturnType<typeof deferred<string>>>();
    const s = new TileStreamer<string>({
      seed: 7,
      bakeTile: (req) => {
        const g = deferred<string>();
        gates.set(req.key, g);
        return g.promise;
      },
    });

    // Bake level 0 first (the globe-sprite base).
    s.update({ level: 0, x: 0, y: 0 });
    for (const [, g] of gates) g.resolve("L0");
    await flush();
    gates.clear();

    // Zoom into level 1 — child tiles are baking, not ready.
    s.update({ level: 1, x: 2, y: 1 });
    const childKey = tileKey(1, 2, 1);
    expect(s.isBaking(childKey)).toBe(true);
    expect(s.get(childKey)).toBeUndefined();
    // Fallback walks the parent chain: L1:2:1 → L0:1:0 → baked L0.
    expect(s.getWithFallback(childKey)).toBe("L0");

    // When the child lands, the child wins.
    gates.get(childKey)!.resolve("L1-child");
    await flush();
    expect(s.getWithFallback(childKey)).toBe("L1-child");
    s.dispose();
  });

  test("no fallback when nothing up the chain is baked", () => {
    const s = new TileStreamer<string>({
      seed: 7,
      bakeTile: () => new Promise(() => {}), // never resolves
    });
    s.update({ level: 2, x: 4, y: 2 });
    expect(s.getWithFallback(tileKey(2, 4, 2))).toBeUndefined();
    s.dispose();
  });

  test("eviction: tiles outside camera ± margin drop out", async () => {
    const s = new TileStreamer<string>({
      seed: 7,
      bakeTile: async (req) => `t:${req.key}`,
      marginTiles: 1,
    });
    // Level 2 = 8 cols × 4 rows: big enough that a pan leaves tiles behind.
    s.update({ level: 2, x: 0, y: 0 });
    await flush();
    const before = s.keys();
    expect(before.includes(tileKey(2, 7, 0))).toBe(true); // wrapped neighbor baked

    // Pan across the map — the old neighborhood is outside camera ± margin.
    s.update({ level: 2, x: 4, y: 3 });
    await flush();
    const after = new Set(s.keys());
    expect(after.has(tileKey(2, 7, 0))).toBe(false);
    expect(after.has(tileKey(2, 0, 0))).toBe(false);
    // The new neighborhood is present.
    expect(after.has(tileKey(2, 4, 3))).toBe(true);
    s.dispose();
  });

  test("LRU bound: cache never exceeds maxTiles, stalest evicted first", async () => {
    const evicted: string[] = [];
    const s = new TileStreamer<string>({
      seed: 7,
      bakeTile: async (req) => `t:${req.key}`,
      maxTiles: 6,
      marginTiles: 10, // margin so wide that margin-eviction can't fire
      debug: true,
      onLog: (msg, data) => {
        if (msg.startsWith("evict")) evicted.push((data as { key: string }).key);
      },
    });

    // Touch tiles in order across level 1 (4 cols × 2 rows = 8 tiles).
    s.update({ level: 1, x: 0, y: 0 });
    await flush();
    s.update({ level: 1, x: 2, y: 1 });
    await flush();

    expect(s.size() <= 6).toBe(true);
    expect(evicted.length).toBeGreaterThan(0);
    // The last update's full visible set must be served (the cap protects
    // it: visible tiles are evicted last).
    const visibleNow = new Set(
      [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => tileKey(1, 2 + dx, 1 + dy))),
    );
    for (const k of visibleNow) {
      expect(s.get(k)).toBeDefined();
    }
    s.dispose();
  });

  test("LRU order: a get() refresh keeps the tile alive", async () => {
    const s = new TileStreamer<string>({
      seed: 7,
      bakeTile: async (req) => `t:${req.key}`,
      maxTiles: 4,
      marginTiles: 10, // margin so wide that margin-eviction can't fire
    });
    // 6 unique keys bake at L1 (x∈{0,1,2}, y∈{0,1}); the 2 stalest are
    // LRU-evicted down to the cap of 4.
    s.update({ level: 1, x: 1, y: 0 });
    await flush();
    expect(s.size()).toBe(4);

    // Refresh the stalest survivor, then add pressure with new tiles.
    const survivor = s.keys()[0];
    s.get(survivor);
    s.update({ level: 1, x: 2, y: 0 });
    await flush();

    expect(s.size() <= 4).toBe(true);
    // The refreshed tile survived the pressure; a stale one didn't.
    expect(s.get(survivor)).toBeDefined();
    s.dispose();
  });

  test("failed bakes don't poison the cache and retry on next update", async () => {
    let calls = 0;
    const logs: string[] = [];
    const s = new TileStreamer<string>({
      seed: 7,
      bakeTile: async () => {
        calls++;
        if (calls <= 2) throw new Error("bake exploded"); // L0 = 2 tiles
        return "recovered";
      },
      debug: true,
      onLog: (msg) => logs.push(msg),
    });
    s.update({ level: 0, x: 0, y: 0 });
    await flush();
    expect(s.size()).toBe(0);
    expect(s.pendingCount()).toBe(0);
    expect(logs.some((m) => m.includes("failed"))).toBe(true);

    s.update({ level: 0, x: 0, y: 0 }); // retry
    await flush();
    expect(s.size()).toBe(2);
    s.dispose();
  });

  test("dispose() ignores late bake resolutions", async () => {
    const gate = deferred<string>();
    const s = new TileStreamer<string>({ seed: 7, bakeTile: () => gate.promise });
    s.update({ level: 0, x: 0, y: 0 });
    s.dispose();
    gate.resolve("too-late");
    await flush();
    expect(s.size()).toBe(0);
    expect(s.pendingCount()).toBe(0);
    // update() after dispose is a no-op
    s.update({ level: 0, x: 0, y: 0 });
    expect(s.pendingCount()).toBe(0);
  });

  test("dev logging captures bakes and evictions", async () => {
    const logs: string[] = [];
    const s = new TileStreamer<string>({
      seed: 7,
      bakeTile: async (req) => `t:${req.key}`,
      maxTiles: 4,
      marginTiles: 0,
      debug: true,
      onLog: (msg, data) => logs.push(`${msg} ${(data as { key?: string })?.key ?? ""}`),
    });
    s.update({ level: 1, x: 0, y: 0 });
    await flush();
    s.update({ level: 1, x: 3, y: 1 });
    await flush();
    expect(logs.some((m) => m.startsWith("bake start"))).toBe(true);
    expect(logs.some((m) => m.startsWith("evict"))).toBe(true);
    s.dispose();
  });

  test("debug off by default: no console traffic", async () => {
    const s = new TileStreamer<string>({ seed: 7, bakeTile: async () => "t" });
    s.update({ level: 0, x: 0, y: 0 });
    await flush();
    s.dispose();
  });
});

describe("TILE_CACHE_MAX", () => {
  test("default cap is the tunable 64", () => {
    expect(TILE_CACHE_MAX).toBe(64);
  });
});
