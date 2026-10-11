// tile-cache.ts — LRU TILE CACHE + STREAMING CONTROLLER (seamless-world
// Phase 2, slice 4 — spec §7, world-map side).
//
// The planet surface scrolls near-endlessly: region tiles bake on demand
// per lat/lon cell, the camera's 3×3 neighborhood streams in async off the
// render loop, and everything outside camera ± margin drops out of memory.
// The globe's baked terrain sprite stays the ultimate fallback — there is
// ALWAYS something drawn (never a loading screen, never a black frame).
//
// This module is pure infra + DOM-free bookkeeping, in the same spirit as
// buildElevationGrid/shadeTerrainGrid (game/globe-layers.ts): deterministic
// seeded tile identity (same inputs bake the same tile, every time), and
// the actual tile ART is not implemented here — the caller injects a
// `bakeTile` callback that returns a promise of whatever tile payload the
// renderer needs (e.g. an OffscreenCanvas/ImageBitmap sprite). The streamer
// never bakes synchronously in the hot path; it only orchestrates requests.
//
// Longitude wraps east/west (the planet is a sphere); latitude clamps at
// the poles (existing TILT_MAX precedent). Sim/presentation separation:
// this file touches no engine math and no battle constants.

/** Default memory bound: max baked tiles held in the cache. Tunable. */
export const TILE_CACHE_MAX = 64;

/** Default eviction margin: tiles outside camera ± margin are dropped. Tunable. */
export const TILE_STREAM_MARGIN = 1;

/** Number of tiles on the visible streaming ring around the camera. */
export const TILE_STREAM_RADIUS = 1; // 3×3

/** Canonical, normalized tile coordinates. */
export interface TileCoord {
  /** Pyramid level. 0 = whole-planet base (the globe's baked sprite). */
  level: number;
  /** Column, wrapped east/west. */
  x: number;
  /** Row, clamped at the poles. */
  y: number;
}

/**
 * Tile grid dimensions at a pyramid level. Level L has 2^(L+1) columns
 * (longitude wraps) × 2^L rows (latitude clamps). Level 0 = 2×1: the two
 * hemispheric cells under the globe's whole-planet baked sprite.
 */
export function tileGridSize(level: number): { cols: number; rows: number } {
  const l = Math.max(0, Math.floor(level));
  return { cols: 2 * Math.pow(2, l), rows: Math.pow(2, l) };
}

/**
 * Normalize (level, x, y) to canonical tile coordinates: level floored at
 * 0, x wrapped east/west, y clamped at the poles. Fractional coords are
 * floored (camera positions land between tiles).
 */
export function normalizeTile(level: number, x: number, y: number): TileCoord {
  const l = Math.max(0, Math.floor(Number.isFinite(level) ? level : 0));
  const { cols, rows } = tileGridSize(l);
  const cx = Math.floor(Number.isFinite(x) ? x : 0);
  const cy = Math.floor(Number.isFinite(y) ? y : 0);
  // Wrap longitude (positive modulo — the planet is a sphere).
  const wx = ((cx % cols) + cols) % cols;
  // Clamp latitude (the poles are walls, not doors).
  const wy = Math.min(rows - 1, Math.max(0, cy));
  return { level: l, x: wx, y: wy };
}

/**
 * Deterministic seeded tile identity. Same (level, x, y) → same key, every
 * time, every session — the bake-the-same-tile-twice contract. Normalizes
 * first, so wrapped/clamped coords share one identity.
 */
export function tileKey(level: number, x: number, y: number): string {
  const t = normalizeTile(level, x, y);
  return `L${t.level}:${t.x}:${t.y}`;
}

/** Parse a tile key back into coordinates (inverse of tileKey). */
export function parseTileKey(key: string): TileCoord | null {
  const m = /^L(\d+):(\d+):(\d+)$/.exec(key);
  if (!m) return null;
  return normalizeTile(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * Convert a (lat, lon) position to tile coordinates at a level.
 * lat ∈ [-90, 90] clamps; lon wraps to [-180, 180).
 */
export function tileCoordsForLatLon(lat: number, lon: number, level: number): TileCoord {
  const { cols, rows } = tileGridSize(level);
  const clampedLat = Math.min(90, Math.max(-90, Number.isFinite(lat) ? lat : 0));
  const wrappedLon = ((((Number.isFinite(lon) ? lon : 0) + 180) % 360) + 360) % 360 - 180;
  const x = Math.floor(((wrappedLon + 180) / 360) * cols);
  const y = Math.floor(((90 - clampedLat) / 180) * rows);
  return normalizeTile(level, x, y);
}

/** The bake request handed to the caller's bakeTile callback. */
export interface TileBakeRequest {
  level: number;
  x: number;
  y: number;
  /** Deterministic identity — use as the cache/storage key. */
  key: string;
  /** World seed, so the caller's art bake is deterministic per tile. */
  seed: number;
}

/** Camera position in tile coordinates (fractional allowed; floored). */
export interface TileCamera {
  level: number;
  x: number;
  y: number;
}

export interface TileStreamerOptions<T> {
  /** World seed forwarded to every bake request. */
  seed: number;
  /**
   * Async tile baker, injected by the caller. Must return a promise and
   * must not do heavy synchronous work — the streamer calls it in the hot
   * path and awaits the promise off the render loop.
   */
  bakeTile: (req: TileBakeRequest) => Promise<T>;
  /** Max baked tiles held. Defaults to TILE_CACHE_MAX. */
  maxTiles?: number;
  /** Evict tiles outside camera ± margin. Defaults to TILE_STREAM_MARGIN. */
  marginTiles?: number;
  /** Dev logging (bakes/evictions). Off by default. */
  debug?: boolean;
  /** Log sink; defaults to console.debug when debug is on. */
  onLog?: (message: string, data?: unknown) => void;
}

/**
 * TileStreamer — the near-endless map's memory manager.
 *
 * - `update(camera)` computes the visible 3×3 tile set around the camera,
 *   kicks off async bakes for what's missing, and evicts everything outside
 *   camera ± margin (bounded LRU on top).
 * - `getWithFallback(key)` serves the coarsest baked ancestor while a child
 *   bakes — level 0's baked globe sprite is the ultimate fallback, so the
 *   renderer always has something to draw.
 * - update() never blocks: bakes are promise-based, never synchronous.
 */
export class TileStreamer<T> {
  private readonly seed: number;
  private readonly bakeTile: (req: TileBakeRequest) => Promise<T>;
  private readonly maxTiles: number;
  private readonly marginTiles: number;
  private readonly debug: boolean;
  private readonly onLog: (message: string, data?: unknown) => void;

  /** Baked tiles, insertion-ordered = LRU (front = stalest). */
  private readonly cache = new Map<string, T>();
  /** In-flight bakes. */
  private readonly pending = new Map<string, Promise<T>>();
  /** Bump on dispose() so late bake resolutions are ignored. */
  private generation = 0;
  private disposed = false;
  /** Visible set from the last update() — protects tiles from bound eviction. */
  private lastVisible = new Set<string>();

  constructor(opts: TileStreamerOptions<T>) {
    this.seed = opts.seed;
    this.bakeTile = opts.bakeTile;
    this.maxTiles = Math.max(1, Math.floor(opts.maxTiles ?? TILE_CACHE_MAX));
    this.marginTiles = Math.max(0, Math.floor(opts.marginTiles ?? TILE_STREAM_MARGIN));
    this.debug = opts.debug ?? false;
    this.onLog = opts.onLog ?? ((message, data) => console.debug(`[tile-cache] ${message}`, data ?? ""));
  }

  private log(message: string, data?: unknown): void {
    if (this.debug) this.onLog(message, data);
  }

  /**
   * Stream the 3×3 tile set around the camera. Requests async bakes for
   * missing tiles and evicts everything outside camera ± margin.
   * Returns immediately — bakes resolve via their promises.
   */
  update(camera: TileCamera): void {
    if (this.disposed) return;
    const c = normalizeTile(camera.level, camera.x, camera.y);

    // 1. Request the visible 3×3.
    const visible = new Set<string>();
    for (let dy = -TILE_STREAM_RADIUS; dy <= TILE_STREAM_RADIUS; dy++) {
      for (let dx = -TILE_STREAM_RADIUS; dx <= TILE_STREAM_RADIUS; dx++) {
        const key = tileKey(c.level, c.x + dx, c.y + dy);
        visible.add(key);
        this.ensureBaked(key);
      }
    }

    // 2. Evict everything outside camera ± margin (the margin covers the
    //    3×3, so this drops tiles the camera left behind). The ancestor
    //    chain of the visible set is retained even across levels — the
    //    coarser parent is the render fallback while a child bakes, so a
    //    zoom-in must not drop the very tiles it falls back to. (Ancestors
    //    are retained, not proactively baked: the keep contract is the 3×3;
    //    getWithFallback walks up to whatever is baked, L0 at the latest.)
    const m = TILE_STREAM_RADIUS + this.marginTiles;
    const keep = new Set<string>();
    for (let dy = -m; dy <= m; dy++) {
      for (let dx = -m; dx <= m; dx++) {
        keep.add(tileKey(c.level, c.x + dx, c.y + dy));
      }
    }
    for (const key of visible) {
      let ancestor: string | null = this.parentKey(key);
      while (ancestor) {
        keep.add(ancestor);
        ancestor = this.parentKey(ancestor);
      }
    }
    for (const key of [...this.cache.keys()]) {
      if (!keep.has(key)) {
        this.cache.delete(key);
        this.log("evict (outside margin)", { key });
      }
    }
    this.lastVisible = visible;

    // 3. Hard bound (see enforceBound).
    this.enforceBound(visible);
  }

  /** Exact tile, if baked. Refreshes its LRU position. */
  get(key: string): T | undefined {
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, hit);
    }
    return hit;
  }

  /**
   * Tile if baked; otherwise the coarsest baked ancestor (parent chain
   * walks up the pyramid). Level 0 is the globe's baked sprite — the
   * ultimate fallback. Returns undefined only when nothing up the chain is
   * baked yet.
   */
  getWithFallback(key: string): T | undefined {
    let cursor: string | null = key;
    while (cursor) {
      const hit = this.get(cursor);
      if (hit !== undefined) return hit;
      cursor = this.parentKey(cursor);
    }
    return undefined;
  }

  /** Parent tile key (one level coarser), or null at level 0. */
  parentKey(key: string): string | null {
    const t = parseTileKey(key);
    if (!t || t.level === 0) return null;
    const { rows } = tileGridSize(t.level - 1);
    const py = Math.min(rows - 1, Math.floor(t.y / 2));
    return tileKey(t.level - 1, Math.floor(t.x / 2), py);
  }

  /** All baked tile keys (LRU order: stalest first). */
  keys(): string[] {
    return [...this.cache.keys()];
  }

  /** Number of baked tiles held. */
  size(): number {
    return this.cache.size;
  }

  /** Number of in-flight bakes. */
  pendingCount(): number {
    return this.pending.size;
  }

  /** True while a bake for this key is in flight. */
  isBaking(key: string): boolean {
    return this.pending.has(key);
  }

  /** Stop accepting updates; late bake resolutions are ignored. */
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.pending.clear();
  }

  /**
   * Hard memory bound: evict LRU until size ≤ maxTiles. Tiles outside the
   * protected set go first; the stalest of the rest go last. The cap is the
   * memory contract; the margin is the preference.
   */
  private enforceBound(protectedKeys: Set<string>): void {
    for (const key of [...this.cache.keys()]) {
      if (this.cache.size <= this.maxTiles) break;
      if (!protectedKeys.has(key)) {
        this.cache.delete(key);
        this.log("evict (LRU, outside visible)", { key });
      }
    }
    for (const key of [...this.cache.keys()]) {
      if (this.cache.size <= this.maxTiles) break;
      this.cache.delete(key);
      this.log("evict (LRU)", { key });
    }
  }

  private ensureBaked(key: string): void {
    if (this.cache.has(key) || this.pending.has(key)) return;
    const t = parseTileKey(key);
    if (!t) return;
    const gen = this.generation;
    const req: TileBakeRequest = {
      level: t.level,
      x: t.x,
      y: t.y,
      key,
      seed: this.seed,
    };
    this.log("bake start", req);
    let promise: Promise<T>;
    try {
      // The callback returns a promise; we never bake synchronously.
      promise = this.bakeTile(req);
    } catch (err) {
      this.log("bake threw synchronously — treating as failure", { key, err });
      return;
    }
    this.pending.set(key, promise);
    promise.then(
      (tile) => {
        this.pending.delete(key);
        if (this.disposed || gen !== this.generation) return;
        this.cache.set(key, tile);
        // A late resolution can push the cache over the cap between
        // updates — enforce the bound here too (the just-baked tile is
        // most-recent, so plain LRU won't take it).
        this.enforceBound(this.lastVisible);
        this.log("bake ready", { key });
      },
      (err) => {
        this.pending.delete(key);
        if (this.disposed || gen !== this.generation) return;
        // Failed bakes don't poison the cache — the next update() retries.
        this.log("bake failed (will retry on next update)", { key, err });
      },
    );
  }
}
