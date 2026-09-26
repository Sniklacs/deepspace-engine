// model-manifest.ts — THE ONE PLACE THE WEIGHTS ARE DESCRIBED.
//
// The bundled translator is the owner's rule (2026-09-26): it ships WITH the app
// for every player, nothing cloud-based, no opt-in, no per-language pack to get
// wrong. The model is `m2m100_418M` (MIT), one model for all five languages.
// This module is the single source of truth for where those weights come from,
// how big they are, and what they must hash to.
//
// THREE THINGS THIS FILE DECIDES, AND WHY EACH ONE MATTERS:
//
//   1. THE ROUTE. Weights are served from `/models/<file>` by `serve.ts`, out of
//      `site/models/` — NOT from `site/public/`. Anything in `public/` is copied
//      into `dist/client` and enters the build id (`serve.ts` fingerprints the
//      name + size of every file in that directory), so a model there would make
//      every deploy a full re-download and would stage a 600 MB blob into git.
//      A weights file is an asset the player fetches once, not a build input.
//
//   2. THE SIZE AND THE HASH. `bytes` is what the server must send, exactly;
//      `sha256` is what the assembled file must hash to. Both are checked while
//      downloading — a truncated or reordered transfer fails loudly instead of
//      being cached and loaded as a corrupt model.
//
//   3. THE IDENTITY — and therefore the incrementality. `id` and `file` carry the
//      model AND its quantisation version. The cache entry is keyed by the URL,
//      which is derived from `file`, and the cache bucket (`dse-model-v1`,
//      `src/game/pwa/storage.ts`) is on the service worker's keep-list, so a
//      publish does NOT evict it and a player who already has the weights makes
//      ZERO requests on the next update. Publishing a *new* model is the only
//      thing that costs a download, and that is deliberate: a new file name.
//
// FLIPPING THE REAL WEIGHTS ON: see `ACTIVE_MODEL_ID` below. `sha256: null` means
// "not pinned yet" — the download still verifies structure and reports the hash it
// measured, but it cannot call the bytes trusted. Paste the measured hash in and
// verification becomes real. `translate-tests` fails if a profile claims 603 MB
// while its file name/route cannot carry it.

export interface ModelProfile {
  /** versioned identity — bump it whenever the bytes change */
  id: string;
  /** the served file name under `MODEL_ROUTE_PREFIX` */
  file: string;
  /** the exact byte length the server must send */
  bytes: number;
  /** the sha256 of the whole file, or null when not pinned yet (reported, not trusted) */
  sha256: string | null;
  /** how much is fetched per request — also the size of one cached chunk */
  chunkBytes: number;
  /** what it is, for the diagnostics line */
  label: string;
}

/** The route `serve.ts` owns. Never under `/assets/`, never in `dist/client`. */
export const MODEL_ROUTE_PREFIX = "/models";

export const MODEL_PROFILES = {
  /** The stand-in that proves the pipeline. Real bytes, real hash, real chunks. */
  probe: {
    id: "dse-pipeline-probe-v1",
    file: "pipeline-probe-v1.bin",
    bytes: 20_000_000,
    sha256: "7410f29873126825fe1fe263f2bd3f9d0eb14265623827b9ab411d47eedf4a9f",
    chunkBytes: 4_000_000,
    label: "pipeline probe (deterministic stand-in at the weights' real slot)",
  },
  /** The owner-approved model: m2m100_418M, MIT, one model for all five languages. */
  m2m100: {
    id: "m2m100-418m-v1",
    file: "m2m100_418m-v1.onnx",
    bytes: 603_000_000,
    // NOT PINNED: pin the served file's sha256 (64 hex chars) before the real
    // model ships — until then a transfer is length-checked and reported, not
    // trusted. `bun run scripts/verify-weights.ts` prints the measured hash.
    sha256: null,
    chunkBytes: 8_000_000,
    label: "m2m100_418M (MIT) — the bundled on-device translator",
  },
} satisfies Record<string, ModelProfile>;

export type ModelProfileId = keyof typeof MODEL_PROFILES;

/**
 * THE ONE LINE A DEPLOY FLIPS.
 *
 * Today: `probe` — the pipeline ships complete and provable against a small real
 * file, because the 603 MB weights cannot be hosted from the build box.
 * To go live: put the real file in `site/models/`, pin its `sha256` above, and
 * change this to `"m2m100"`. Nothing else in the codebase changes.
 */
export const ACTIVE_MODEL_ID: ModelProfileId = "probe";

export const MODEL: ModelProfile = MODEL_PROFILES[ACTIVE_MODEL_ID];

/** True when the shipped profile is the real model rather than the stand-in. */
export function shipsRealWeights(id: ModelProfileId = ACTIVE_MODEL_ID): boolean {
  return id === "m2m100";
}
export const SHIPS_REAL_WEIGHTS: boolean = shipsRealWeights();

/** The URL the weights are fetched from, and the key they are cached under. */
export function modelUrl(profile: ModelProfile = MODEL): string {
  return `${MODEL_ROUTE_PREFIX}/${profile.file}`;
}

/** How many chunks the download is split into (the last one may be short). */
export function modelChunkCount(profile: ModelProfile = MODEL): number {
  return Math.ceil(profile.bytes / profile.chunkBytes);
}

/** Byte range of one chunk, half-open: `[start, end)`. */
export function chunkRange(index: number, profile: ModelProfile = MODEL): { start: number; end: number } {
  const start = index * profile.chunkBytes;
  const end = Math.min(start + profile.chunkBytes, profile.bytes);
  return { start, end };
}

/** The cache key one chunk is stored under (a query, not a fragment — fragments are dropped). */
export function chunkCacheKey(index: number, profile: ModelProfile = MODEL): string {
  return `${modelUrl(profile)}?chunk=${String(index)}`;
}

/** The cache key the completion receipt is stored under. */
export function receiptCacheKey(profile: ModelProfile = MODEL): string {
  return `${modelUrl(profile)}?receipt=1`;
}
