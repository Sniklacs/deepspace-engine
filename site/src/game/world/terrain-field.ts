// ---------------------------------------------------------------------------
// terrain-field.ts — ONE continuous world, no ocean, no stacked cutouts.
//
// Hans (Oct 11 2026): "take all the water away... I want one land map, not
// piles of maps laid over each other... it's got to be layered — another
// layer that you can actually zoom in on, layer after layer, rendering
// every time we come in."
//
// So: the world is a single continuous seeded elevation field. Every zoom
// level bakes its OWN layer fresh from the field at its own resolution
// (never one stretched JPEG), and there is no blue anywhere — the whole
// planet is land, from plush green outskirts to the burnt wasteland around
// the central Chorus.
//
// Pure + seeded: elevationAt / worldCorruptionAt are deterministic per
// (lat, lon). Same world every visit, every device.
// ---------------------------------------------------------------------------

/** World seed — change this and the planet is reborn. */
export const WORLD_TERRAIN_SEED = 20261011;

// ---- deterministic integer hash + value noise (no Math.random) --------------

function hash2i(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 974711) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, seed: number, xPeriod: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  // Wrap the lattice in x so longitude −180° meets +180° seamlessly.
  const w = (n: number) => ((n % xPeriod) + xPeriod) % xPeriod;
  const a = hash2i(w(ix), iy, seed);
  const b = hash2i(w(ix + 1), iy, seed);
  const c = hash2i(w(ix), iy + 1, seed);
  const d = hash2i(w(ix + 1), iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal Brownian motion, 0..1. Higher octaves double frequency AND the
 *  wrap period, so every octave stays seamless around the world. */
function fbm(x: number, y: number, seed: number, octaves: number, basePeriod: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x * freq, y * freq, seed + o * 131, basePeriod * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---- the elevation field ----------------------------------------------------

/**
 * Continuous world elevation, 0..1. ALL LAND — there is no sea level.
 * Continents from low-frequency fBm, mountain ridges from ridged noise,
 * fine detail from higher octaves. Deterministic per (lat, lon).
 */
export function elevationAt(lat: number, lon: number): number {
  // x in world-cycles so the field wraps seamlessly at ±180°. Every term's
  // x-span is an exact multiple of its wrap period (integer cycle counts) —
  // a fractional offset would tear the seam.
  const x = ((lon + 180) / 360) * 6; // 6 continental cycles around the equator
  const y = (lat + 90) / 180 * 3;
  const continent = fbm(x, y, WORLD_TERRAIN_SEED, 4, 6);
  const detail = fbm(x * 3, y * 3, WORLD_TERRAIN_SEED + 911, 3, 18);
  // Ridged noise → mountain chains.
  const r = 1 - Math.abs(2 * fbm(x * 2, y * 2, WORLD_TERRAIN_SEED + 417, 4, 12) - 1);
  const ridge = r * r;
  let e = continent * 0.58 + detail * 0.22 + ridge * 0.2;
  // Gentle polar lift so the far north/south read as high country.
  const polar = Math.min(1, Math.max(0, (Math.abs(lat) - 62) / 28));
  e = e * (1 - polar * 0.25) + polar * 0.25 + polar * 0.35 * detail;
  return Math.min(1, Math.max(0, e));
}

// ---- fine detail (deep-zoom layers only) ------------------------------------
// The base field carries continents and medium relief. Deep tiles need
// genuine fine grain — features at the 0.2–1° scale that the coarse layers
// can't show. Sampled ONLY by L1+ tile bakes (never the globe texture or
// L0): the L0→L1 handoff then reads as the ground SHARPENING, which is the
// whole point of the layered map. Zero-mean, bounded, seamless.
/** Fine relief detail, ~±0.09. Deterministic per (lat, lon). */
export function elevationDetailAt(lat: number, lon: number): number {
  // 1150 cycles around the world ≈ 0.3°/cycle; two octaves to 0.16°/cycle.
  // Integer cycle counts → the antimeridian stays seamless.
  const x = ((lon + 180) / 360) * 1150;
  const y = ((lat + 90) / 180) * 575;
  const d = fbm(x, y, WORLD_TERRAIN_SEED + 2024, 2, 1150);
  return (d - 0.5) * 0.3;
}

// ---- the corruption field ---------------------------------------------------

/** Great-circle distance in degrees. Pure. */
export function greatCircleDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  let dLon = Math.abs(lon2 - lon1) % 360;
  if (dLon > 180) dLon = 360 - dLon;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(((dLon * Math.PI) / 180) / 2) *
      Math.sin(((dLon * Math.PI) / 180) / 2);
  return (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 180) / Math.PI;
}

/**
 * Chorus corruption at a world point: 1 at the heart → 0 in the deep
 * outskirts. Radial with ragged, noise-perturbed band edges — the blight
 * creeps along the terrain, not in perfect circles. Deterministic.
 *
 * Five bands (the doctrine): 0 plush green → 1 cracked burnt wasteland.
 */
export function worldCorruptionAt(
  lat: number,
  lon: number,
  heart: { lat: number; lon: number },
): number {
  const dist = greatCircleDeg(lat, lon, heart.lat, heart.lon);
  // Ragged edge: perturbation grows with distance — the heart is pure burnt,
  // the frontier wobbles.
  const wobble =
    (fbm(((lon + 180) / 360) * 8, ((lat + 90) / 180) * 4, WORLD_TERRAIN_SEED + 555, 3, 8) - 0.5) *
    2 *
    Math.min(1, dist / 40) *
    14;
  const d = Math.max(0, dist + wobble);
  // 1 at the heart, fading to 0 ~95° out.
  const c = 1 - Math.min(1, d / 95);
  return c * c * (3 - 2 * c); // smoothstep
}

// ---- color: no blue anywhere ------------------------------------------------

type RGB = [number, number, number];

function lerp3(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function ramp(stops: Array<[number, RGB]>, t: number): RGB {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      return lerp3(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return stops[stops.length - 1][1];
}

// Healthy land: plush green lowlands → dry grass → rock → snow peaks.
const HEALTHY_STOPS: Array<[number, RGB]> = [
  [0.0, [46, 122, 74]], // plush valley green
  [0.25, [74, 148, 88]], // lowland green
  [0.45, [122, 150, 92]], // dry grass
  [0.62, [150, 128, 96]], // highland tan
  [0.78, [118, 104, 96]], // rock
  [0.9, [196, 192, 188]], // pale rock
  [1.0, [242, 238, 232]], // snow peaks — warm white, never blue
];

// Corrupted land: scorched umber → cracked ash → ember-veined black.
const BLIGHT_STOPS: Array<[number, RGB]> = [
  [0.0, [96, 74, 52]], // scorched earth
  [0.3, [74, 56, 44]], // burnt umber
  [0.55, [58, 50, 48]], // ash grey-brown
  [0.8, [38, 34, 36]], // cracked black
  [1.0, [26, 22, 24]], // dead heart
];

/**
 * Terrain color for (elevation, corruption). Corruption re-hues the land
 * toward the wasteland ramp and kills the green; high elevations go pale
 * rock / snow when healthy, ash when blighted. Ember veins crackle through
 * the deep blight. Never blue.
 */
export function terrainRGB(elev: number, corr: number, detail: number): RGB {
  const healthy = ramp(HEALTHY_STOPS, elev);
  const blight = ramp(BLIGHT_STOPS, Math.min(1, elev * 0.7 + corr * 0.3));
  const c = lerp3(healthy, blight, Math.min(1, Math.max(0, corr)));
  // Ember veins: thin bright cracks deep in the blight.
  if (corr > 0.55 && detail > 0.86) {
    const k = Math.min(1, (detail - 0.86) / 0.14) * Math.min(1, (corr - 0.55) / 0.45);
    return [c[0] + (232 - c[0]) * k * 0.8, c[1] + (112 - c[1]) * k * 0.8, c[2] + (40 - c[2]) * k * 0.8];
  }
  return c;
}

/** A baked terrain layer — plain pixels, no DOM needed (tests run in bun). */
export interface BakedLayer {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

// ---- per-pixel region bake: each zoom level renders its OWN layer -----------

/**
 * Bake a terrain layer: samples the ONE field at this layer's own pixel
 * density, hillshades it, colors it. Every LOD level calls this at its own
 * resolution — sampling the same field denser is what keeps the ground
 * resolving as you descend instead of pixelating one stretched image. The
 * morph crossfade never pops because globe and tiles read the same field.
 *
 * (qLat, qLon) = tile center; ppd = bake px per degree. The pixel→geo
 * mapping mirrors the draw path exactly:
 *   lon(i) = qLon + (i − w/2) / (cos(qLat) · ppd)
 *   lat(j) = qLat − (j − h/2) / ppd
 */
export function bakeTerrainRegion(
  w: number,
  h: number,
  qLat: number,
  qLon: number,
  ppd: number,
  heart: { lat: number; lon: number },
  fineDetail = false,
): BakedLayer {
  const baker = createRegionBaker(w, h, qLat, qLon, ppd, heart, fineDetail);
  baker.step(Number.POSITIVE_INFINITY);
  return baker.result();
}

// ---- incremental region bake: the same bake, spread across frames ---------
//
// A full L1 bake is ~1s of field math. Run in one synchronous chunk (the old
// setTimeout path) it eats ~60 frames whole — on a phone mid-dive that IS
// the chop Hans felt (Oct 12 2026). The baker below runs the IDENTICAL two
// passes row-by-row under a wall-clock budget, so a caller can feed it a few
// ms per frame and the bake lands over ~a second of smooth frames instead
// of one frozen second. Output is pixel-identical to bakeTerrainRegion.

interface RegionBakeState {
  w: number;
  h: number;
  qLat: number;
  qLon: number;
  ppd: number;
  heart: { lat: number; lon: number };
  fineDetail: boolean;
  data: Uint8ClampedArray<ArrayBuffer>;
  elev: Float32Array;
  cosLat: number;
  /** 1 = elevation pass, 2 = hillshade + color pass. */
  pass: 1 | 2;
  /** Next row to bake within the current pass. */
  row: number;
  done: boolean;
}

function makeRegionBakeState(
  w: number,
  h: number,
  qLat: number,
  qLon: number,
  ppd: number,
  heart: { lat: number; lon: number },
  fineDetail: boolean,
): RegionBakeState {
  return {
    w, h, qLat, qLon, ppd, heart, fineDetail,
    data: new Uint8ClampedArray(new ArrayBuffer(w * h * 4)),
    elev: new Float32Array(w * h),
    cosLat: Math.max(0.2, Math.cos((qLat * Math.PI) / 180)),
    pass: 1,
    row: 0,
    done: false,
  };
}

/** Bake ONE row of the current pass; advance the state. */
function bakeRegionRow(s: RegionBakeState): void {
  const { w, h, qLat, qLon, ppd, heart, fineDetail, elev, cosLat } = s;
  const j = s.row;
  const lat = qLat - (j - h / 2) / ppd;
  if (s.pass === 1) {
    // Pass 1 — the field, sampled at this layer's own density. Deep layers
    // add the fine-grain relief their pixels can actually show.
    for (let i = 0; i < w; i++) {
      const lon = qLon + (i - w / 2) / (cosLat * ppd);
      const e = elevationAt(lat, lon);
      elev[j * w + i] = fineDetail
        ? Math.min(1, Math.max(0, e + elevationDetailAt(lat, lon)))
        : e;
    }
  } else {
    // Pass 2 — hillshade + color.
    const px = s.data;
    for (let i = 0; i < w; i++) {
      const lon = qLon + (i - w / 2) / (cosLat * ppd);
      const e = elev[j * w + i];
      const ex = elev[j * w + Math.min(w - 1, i + 1)] - elev[j * w + Math.max(0, i - 1)];
      const ey = elev[Math.min(h - 1, j + 1) * w + i] - elev[Math.max(0, j - 1) * w + i];
      // Hillshade, light from the NW. Gradient is per-pixel, so relief
      // sharpens naturally as the layer's own density rises.
      const shade = Math.max(0, Math.min(1, 0.5 - (ex - ey) * 2.4));
      const corr = worldCorruptionAt(lat, lon, heart);
      const detail = hash2i(i >> 1, j >> 1, WORLD_TERRAIN_SEED + 777);
      const [rr, gg, bb] = terrainRGB(e, corr, detail);
      const li = 0.55 + shade * 0.75;
      const o = (j * w + i) * 4;
      px[o] = Math.min(255, rr * li);
      px[o + 1] = Math.min(255, gg * li);
      px[o + 2] = Math.min(255, bb * li);
      px[o + 3] = 255;
    }
  }
  s.row += 1;
  if (s.row >= h) {
    if (s.pass === 1) {
      s.pass = 2;
      s.row = 0;
    } else {
      s.done = true;
    }
  }
}

export interface RegionBaker {
  readonly width: number;
  readonly height: number;
  /** True once both passes are complete. */
  readonly done: boolean;
  /** 0..1 across both passes (pass 1 = first half, pass 2 = second). */
  readonly progress: number;
  /**
   * Bake until roughly `budgetMs` of wall time is spent, then yield.
   * Always bakes at least one row, so even a 0 budget makes progress.
   * Returns `done`. Pass Infinity to run to completion synchronously.
   */
  step(budgetMs: number, now?: () => number): boolean;
  /** The finished layer. Throws if called before `done`. */
  result(): BakedLayer;
}

const defaultBakeNow = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

/** Create an incremental baker for one region tile. No pixels are baked
 *  until `step` is called — creating one is just two buffer allocations. */
export function createRegionBaker(
  w: number,
  h: number,
  qLat: number,
  qLon: number,
  ppd: number,
  heart: { lat: number; lon: number },
  fineDetail = false,
): RegionBaker {
  const s = makeRegionBakeState(w, h, qLat, qLon, ppd, heart, fineDetail);
  return {
    width: w,
    height: h,
    get done() {
      return s.done;
    },
    get progress() {
      const rowsDone = (s.pass - 1) * s.h + s.row;
      return s.h > 0 ? rowsDone / (2 * s.h) : 1;
    },
    step(budgetMs: number, now: () => number = defaultBakeNow): boolean {
      if (s.done) return true;
      const start = now();
      // At least one row per call — a starved budget must never livelock.
      bakeRegionRow(s);
      while (!s.done && now() - start < budgetMs) bakeRegionRow(s);
      return s.done;
    },
    result(): BakedLayer {
      if (!s.done) throw new Error("region baker: result() before done");
      return { width: s.w, height: s.h, data: s.data };
    },
  };
}

/**
 * The whole-world texture for the globe: one equirectangular land map
 * (2048×1024 default), baked once. The globe draws patches of this — one
 * map, not piles of cutouts.
 */
export function bakeWorldTexture(
  w: number,
  h: number,
  heart: { lat: number; lon: number },
): BakedLayer {
  // Equirectangular: lon −180..180 across w, lat 90..−90 down h.
  const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  const px = data;
  const elev = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const lat = 90 - (j / (h - 1)) * 180;
    for (let i = 0; i < w; i++) {
      const lon = -180 + (i / (w - 1)) * 360;
      elev[j * w + i] = elevationAt(lat, lon);
    }
  }
  for (let j = 0; j < h; j++) {
    const lat = 90 - (j / (h - 1)) * 180;
    for (let i = 0; i < w; i++) {
      const lon = -180 + (i / (w - 1)) * 360;
      const e = elev[j * w + i];
      const ex = elev[j * w + Math.min(w - 1, i + 1)] - elev[j * w + Math.max(0, i - 1)];
      const ey = elev[Math.min(h - 1, j + 1) * w + i] - elev[Math.max(0, j - 1) * w + i];
      const shade = Math.max(0, Math.min(1, 0.5 - (ex - ey) * 1.6));
      const corr = worldCorruptionAt(lat, lon, heart);
      const [rr, gg, bb] = terrainRGB(e, corr, hash2i(i >> 2, j >> 2, WORLD_TERRAIN_SEED + 31));
      const li = 0.6 + shade * 0.7;
      const o = (j * w + i) * 4;
      px[o] = Math.min(255, rr * li);
      px[o + 1] = Math.min(255, gg * li);
      px[o + 2] = Math.min(255, bb * li);
      px[o + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}
