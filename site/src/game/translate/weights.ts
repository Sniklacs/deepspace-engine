// weights.ts — THE LOADER: fetch the translator's weights, byte by byte, into the
// model cache, and be honest about every step of it.
//
// This is the module the owner's rule lives in: "build the Persian translator into
// where they have to download it — I don't want players getting disgruntled
// because they can't translate." So there is no prompt and no opt-in: the download
// starts on its own, with visible progress, and the player is told in their own
// language what is happening (the copy is in the five catalogue files; the UI is
// `components/shell/TranslatorNote.tsx`).
//
// WHY IT IS NOT IN `pwa/storage.ts` OR `engine-seam.ts`: both are gated to be
// fetch-free — storage PREDICTS, it does not download (`pwa-tests` forbids
// `fetch(` there), and the engine seam does no network call of its own
// (`i18n-verify` forbids `fetch(`/`XMLHttpRequest`/`https://` there, comments
// included). This module owns the network, and nothing else does.
//
// FOUR PROPERTIES THE OWNER ASKED FOR, AND HOW EACH IS ACTUALLY MET:
//
//   1. INCREMENTAL. The file is downloaded in CHUNKS, each chunk cached under its
//      own key inside the `dse-model-v1` bucket. That bucket is on the service
//      worker's keep-list, so a publish does not evict it, and a completed
//      download is recognised from a receipt and makes ZERO requests — an app
//      update never re-downloads hundreds of megabytes.
//   2. RESUMABLE. A dropped connection keeps the chunks that already landed. The
//      next attempt fetches only the missing ones, by byte range, and says so
//      (`resumed: true`). If the server ignores `Range`, the loader still works —
//      it says `ranged: false` and restarts the file in one pass, because that is
//      what the server actually gives us.
//   3. PROGRESS THAT IS REAL BYTES. Progress is counted from bytes read off the
//      wire and bytes durably stored, never estimated from a timer. A partially
//      downloaded model is never mistaken for a ready one: "ready" requires every
//      chunk present at its exact expected length AND the whole-file hash checked.
//   4. VERIFIABLE. `sha256.ts` hashes the assembled chunks as a stream, so
//      checking 603 MB never means holding 603 MB. A mismatch fails the download
//      and drops the bytes rather than caching something that cannot be trusted.
//
// NOTHING HERE TALKS TO THE UI. It is an observable state machine; the components
// subscribe to it. And nothing here imports React, the API or the store.

import { MODEL_CACHE } from "../pwa/storage";
import {
  MODEL,
  chunkCacheKey,
  chunkRange,
  modelChunkCount,
  modelUrl,
  receiptCacheKey,
  type ModelProfile,
} from "./model-manifest";
import { Sha256, sha256Hex } from "./sha256";

/** The subset of Cache Storage this module uses (so a harness can supply its own). */
export interface WeightCache {
  put(request: string, response: Response): Promise<void>;
  match(request: string): Promise<Response | undefined>;
  delete(request: string): Promise<boolean>;
  keys?(): Promise<Request[]>;
}
export interface WeightCacheStorage {
  open(name: string): Promise<WeightCache>;
}
export type WeightsFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface WeightsEnvironment {
  cacheStorage: WeightCacheStorage | null;
  fetchImpl: WeightsFetch | null;
}

export type WeightsPhase =
  | "unknown" // nothing has been looked at yet
  | "unsupported" // this browser has no Cache Storage (or we are on the server)
  | "absent" // looked, and there is nothing stored
  | "partial" // some chunks stored, the file is incomplete
  | "downloading"
  | "verifying"
  | "ready"
  | "failed";

export interface WeightsReceipt {
  modelId: string;
  bytes: number;
  sha256: string;
  chunkBytes: number;
  chunks: number;
  ranged: boolean;
  completedAt: string;
}

export interface WeightsState {
  phase: WeightsPhase;
  modelId: string;
  label: string;
  totalBytes: number;
  /** bytes durably in Cache Storage right now */
  cachedBytes: number;
  /** bytes read off the wire in the current attempt */
  receivedBytes: number;
  /** 0–100, from cached + received — never a timer */
  percent: number;
  chunksTotal: number;
  chunksStored: number;
  /** this attempt started from a partial cache and fetched only what was missing */
  resumed: boolean;
  /** did the server honour byte ranges? null = not asked yet */
  ranged: boolean | null;
  /** "ok" = matches the pinned hash · "unpinned" = not pinned yet, hash reported */
  verified: "pending" | "ok" | "unpinned" | "mismatch";
  /** the hash measured over the stored bytes (null until a pass completes) */
  measuredSha: string | null;
  /** the honest failure line, never a stack trace */
  error: string | null;
}

function initialState(profile: ModelProfile = MODEL): WeightsState {
  return {
    phase: "unknown",
    modelId: profile.id,
    label: profile.label,
    totalBytes: profile.bytes,
    cachedBytes: 0,
    receivedBytes: 0,
    percent: 0,
    chunksTotal: modelChunkCount(profile),
    chunksStored: 0,
    resumed: false,
    ranged: null,
    verified: "pending",
    measuredSha: null,
    error: null,
  };
}

let state: WeightsState = initialState();
const listeners = new Set<(s: WeightsState) => void>();

function emit(patch: Partial<WeightsState>): WeightsState {
  const next = { ...state, ...patch };
  if (patch.percent === undefined) {
    // Never a timer: the default is what is on disk plus what arrived, capped.
    const done = next.cachedBytes + next.receivedBytes;
    next.percent = next.totalBytes > 0 ? Math.min(100, Math.round((done / next.totalBytes) * 100)) : 0;
  }
  state = next;
  for (const fn of listeners) {
    try {
      fn(next);
    } catch {
      /* a subscriber that throws must not stop the download */
    }
  }
  return next;
}

export function weightsState(): WeightsState {
  return state;
}

export function subscribeWeights(fn: (s: WeightsState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The environment this runs in: real globals by default, injected by a harness. */
let injected: WeightsEnvironment | null = null;

export function weightsEnvironment(): WeightsEnvironment {
  if (injected) return injected;
  const cacheStorage =
    typeof caches !== "undefined" && typeof caches.open === "function"
      ? (caches as unknown as WeightCacheStorage)
      : null;
  const fetchImpl = typeof fetch === "function" ? (fetch.bind(globalThis) as WeightsFetch) : null;
  return { cacheStorage, fetchImpl };
}

/**
 * Test/embedding seam: run the loader against another Cache Storage or fetch.
 * `null` restores the real globals. Nothing in the app calls this.
 */
export function setWeightsEnvironment(env: WeightsEnvironment | null): void {
  injected = env;
  state = initialState();
}

/** Read a stored chunk's own byte count from the header we wrote with it. */
async function storedChunkBytes(cache: WeightCache, key: string): Promise<number> {
  const hit = await cache.match(key);
  if (!hit) return -1;
  const declared = Number(hit.headers.get("x-dse-chunk-bytes") ?? "");
  if (Number.isFinite(declared) && declared > 0) return declared;
  try {
    return (await hit.arrayBuffer()).byteLength;
  } catch {
    return -1;
  }
}

async function readReceipt(cache: WeightCache, profile: ModelProfile): Promise<WeightsReceipt | null> {
  try {
    const hit = await cache.match(receiptCacheKey(profile));
    if (!hit) return null;
    const parsed: unknown = JSON.parse(await hit.text());
    if (typeof parsed !== "object" || parsed === null) return null;
    const r = parsed as Partial<WeightsReceipt>;
    if (typeof r.modelId !== "string" || typeof r.bytes !== "number" || typeof r.sha256 !== "string") return null;
    return {
      modelId: r.modelId,
      bytes: r.bytes,
      sha256: r.sha256,
      chunkBytes: typeof r.chunkBytes === "number" ? r.chunkBytes : profile.chunkBytes,
      chunks: typeof r.chunks === "number" ? r.chunks : modelChunkCount(profile),
      ranged: r.ranged === true,
      completedAt: typeof r.completedAt === "string" ? r.completedAt : "",
    };
  } catch {
    return null;
  }
}

async function writeReceipt(cache: WeightCache, receipt: WeightsReceipt, profile: ModelProfile): Promise<void> {
  const body = JSON.stringify(receipt);
  await cache.put(
    receiptCacheKey(profile),
    new Response(body, {
      status: 200,
      headers: { "content-type": "application/json", "x-dse-receipt": "1", "content-length": String(body.length) },
    }),
  );
}

/** Which chunks are on disk, at the length they must be. Cheap: headers, not bodies. */
async function inventory(
  cache: WeightCache,
  profile: ModelProfile,
): Promise<{ stored: boolean[]; bytes: number }> {
  const total = modelChunkCount(profile);
  const stored: boolean[] = [];
  let bytes = 0;
  for (let i = 0; i < total; i++) {
    const range = chunkRange(i, profile);
    const expected = range.end - range.start;
    const key = chunkCacheKey(i, profile);
    const have = await storedChunkBytes(cache, key);
    if (have === expected) {
      stored.push(true);
      bytes += have;
    } else {
      stored.push(false);
      if (have > 0) await cache.delete(key); // the wrong length is not a partial chunk, it is a bad one
    }
  }
  return { stored, bytes };
}

/** Stream a response body into Cache Storage, counting the bytes as they arrive. */
async function storeChunkFromBody(
  cache: WeightCache,
  key: string,
  response: Response,
  expected: number,
  onBytes: (n: number) => void,
): Promise<number> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffered = new Uint8Array(await response.arrayBuffer());
    const slice = buffered.subarray(0, expected);
    onBytes(slice.byteLength);
    await cache.put(key, chunkResponse(slice));
    return slice.byteLength;
  }
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      const keep = value.subarray(0, Math.max(0, expected - total));
      parts.push(keep.slice());
      total += keep.byteLength;
      onBytes(keep.byteLength);
      if (total >= expected) break;
    }
  }
  if (total !== expected) {
    throw new Error(`short read: ${String(total)} of ${String(expected)} bytes`);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  await cache.put(key, chunkResponse(joined));
  return total;
}

function chunkResponse(bytes: Uint8Array): Response {
  return new Response(bytes.slice().buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "x-dse-chunk-bytes": String(bytes.byteLength),
    },
  });
}

/** Hash the stored chunks IN ORDER, one at a time — never the whole file at once. */
export async function hashStoredWeights(
  cache: WeightCache,
  profile: ModelProfile = MODEL,
): Promise<string> {
  const hash = new Sha256();
  const total = modelChunkCount(profile);
  for (let i = 0; i < total; i++) {
    const hit = await cache.match(chunkCacheKey(i, profile));
    if (!hit) throw new Error(`chunk ${String(i)} missing`);
    const reader = hit.body?.getReader();
    if (!reader) {
      hash.update(new Uint8Array(await hit.arrayBuffer()));
      continue;
    }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) hash.update(value);
    }
  }
  return hash.digestHex();
}

/** Look at the cache and report what is actually there. NO network. */
export async function inspectWeights(profile: ModelProfile = MODEL, env?: WeightsEnvironment): Promise<WeightsState> {
  const environment = env ?? weightsEnvironment();
  if (!environment.cacheStorage) {
    return emit({ phase: "unsupported", error: null });
  }
  try {
    const cache = await environment.cacheStorage.open(MODEL_CACHE);
    const receipt = await readReceipt(cache, profile);
    if (receipt && receipt.modelId === profile.id && receipt.bytes === profile.bytes) {
      const pinned = profile.sha256;
      if (pinned === null || pinned === receipt.sha256) {
        return emit({
          phase: "ready",
          cachedBytes: profile.bytes,
          receivedBytes: 0,
          chunksStored: modelChunkCount(profile),
          ranged: receipt.ranged,
          verified: pinned === null ? "unpinned" : "ok",
          measuredSha: receipt.sha256,
          error: null,
        });
      }
      // The cached bytes are not the bytes this build pins — start over.
      await clearWeights(profile, environment);
    }
    const { stored, bytes } = await inventory(cache, profile);
    return emit({
      phase: bytes > 0 ? "partial" : "absent",
      cachedBytes: bytes,
      receivedBytes: 0,
      chunksStored: stored.filter(Boolean).length,
      verified: "pending",
      measuredSha: null,
      error: null,
    });
  } catch (err) {
    return emit({ phase: "failed", error: describe(err) });
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

let inflight: Promise<WeightsState> | null = null;

/**
 * Download what is missing, resume what is not, verify what landed, and report
 * honestly. Idempotent while running; a completed, verified cache costs nothing.
 */
export function ensureWeights(profile: ModelProfile = MODEL, env?: WeightsEnvironment): Promise<WeightsState> {
  if (inflight) return inflight;
  inflight = run(profile, env ?? weightsEnvironment()).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run(profile: ModelProfile, environment: WeightsEnvironment): Promise<WeightsState> {
  if (!environment.cacheStorage || !environment.fetchImpl) {
    return emit({ phase: "unsupported", error: null });
  }
  const fetcher = environment.fetchImpl;
  const cache = await environment.cacheStorage.open(MODEL_CACHE);

  // 1 · already have it? Then this costs no network at all.
  const inspected = await inspectWeights(profile, environment);
  if (inspected.phase === "ready") return inspected;
  if (inspected.phase === "failed" && inspected.error !== null) return inspected;

  try {
    const { stored, bytes } = await inventory(cache, profile);
    let cachedBytes = bytes;
    let storedCount = stored.filter(Boolean).length;
    let received = 0;
    const runStartCached = bytes;
    // Progress is measured from a fixed base (what was already on disk) plus the
    // bytes this attempt has read — so a resumed download starts where it left off
    // and a landing chunk can never be counted twice.
    const pct = (): number =>
      state.totalBytes > 0 ? Math.min(100, Math.round(((runStartCached + received) / state.totalBytes) * 100)) : 0;
    const missing = stored.map((has, i) => (has ? -1 : i)).filter((i) => i >= 0);
    const rangedSoFar: boolean | null = state.ranged;

    emit({
      phase: "downloading",
      cachedBytes,
      receivedBytes: 0,
      percent: pct(),
      chunksStored: storedCount,
      resumed: cachedBytes > 0,
      ranged: rangedSoFar,
      error: null,
    });

    let sawRange = false;
    let wholeFileStreamed = false;

    for (let n = 0; n < missing.length; n++) {
      const index = missing[n] ?? 0;
      const range = chunkRange(index, profile);
      const expected = range.end - range.start;
      const key = chunkCacheKey(index, profile);
      const response = await fetcher(modelUrl(profile), {
        headers: { Range: `bytes=${String(range.start)}-${String(range.end - 1)}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`the weights route answered ${String(response.status)}`);

      const partial = response.status === 206;
      if (partial) {
        const contentRange = response.headers.get("content-range") ?? "";
        const m = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/.exec(contentRange);
        if (!m || Number(m[1]) !== range.start) {
          throw new Error(`the server sent the wrong slice: content-range "${contentRange}"`);
        }
        sawRange = true;
        await storeChunkFromBody(cache, key, response, expected, (n2) => {
          received += n2;
          emit({ phase: "downloading", receivedBytes: received, cachedBytes, percent: pct() });
        });
        cachedBytes += expected;
        storedCount++;
      } else {
        // The server ignored Range and is sending the whole file. Split it here,
        // streaming, and fill in every chunk we are missing on the way past.
        wholeFileStreamed = true;
        sawRange = false;
        let absolute = 0;
        const reader = response.body?.getReader();
        if (!reader) throw new Error("the weights route sent no body");
        let pending: Uint8Array[] = [];
        let pendingBytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;
          received += value.byteLength;
          let cursor = 0;
          while (cursor < value.byteLength) {
            const absoluteIndex = Math.floor(absolute / profile.chunkBytes);
            const chunkStart = absoluteIndex * profile.chunkBytes;
            const chunkEnd = Math.min(chunkStart + profile.chunkBytes, profile.bytes);
            const take = Math.min(value.byteLength - cursor, chunkEnd - absolute);
            pending.push(value.subarray(cursor, cursor + take).slice());
            pendingBytes += take;
            cursor += take;
            absolute += take;
            if (absolute >= chunkEnd) {
              // A chunk we already held is skipped: the whole-file hash below is
              // what decides whether the bytes on disk are the right ones.
              if (!stored[absoluteIndex]) {
                const joined = new Uint8Array(pendingBytes);
                let offset = 0;
                for (const part of pending) {
                  joined.set(part, offset);
                  offset += part.byteLength;
                }
                await cache.put(chunkCacheKey(absoluteIndex, profile), chunkResponse(joined));
                cachedBytes += joined.byteLength;
                storedCount++;
                stored[absoluteIndex] = true;
              }
              pending = [];
              pendingBytes = 0;
            }
          }
          emit({ phase: "downloading", receivedBytes: received, cachedBytes, percent: pct(), ranged: false });
          if (absolute >= profile.bytes) break;
        }
        if (absolute < profile.bytes) throw new Error(`short read: ${String(absolute)} of ${String(profile.bytes)} bytes`);
      }

      const have = await storedChunkBytes(cache, key);
      if (have !== expected) throw new Error(`chunk ${String(index)} did not land (${String(have)} of ${String(expected)})`);
      emit({
        phase: "downloading",
        receivedBytes: received,
        cachedBytes,
        percent: pct(),
        chunksStored: storedCount,
        ranged: sawRange,
      });
      if (wholeFileStreamed) break; // every chunk is on disk after one pass
    }

    // 2 · verify: the whole file's hash, streamed.
    emit({ phase: "verifying", receivedBytes: received, cachedBytes, percent: 100, ranged: sawRange });
    const measured = await hashStoredWeights(cache, profile);
    if (profile.sha256 !== null && measured !== profile.sha256) {
      await clearWeights(profile, environment);
      return emit({
        phase: "failed",
        cachedBytes: 0,
        chunksStored: 0,
        measuredSha: measured,
        verified: "mismatch",
        error: `the weights do not match the pinned hash (measured ${measured.slice(0, 12)}…)`,
      });
    }

    const receipt: WeightsReceipt = {
      modelId: profile.id,
      bytes: profile.bytes,
      sha256: measured,
      chunkBytes: profile.chunkBytes,
      chunks: modelChunkCount(profile),
      ranged: sawRange,
      completedAt: new Date().toISOString(),
    };
    await writeReceipt(cache, receipt, profile);
    return emit({
      phase: "ready",
      cachedBytes: profile.bytes,
      receivedBytes: received,
      chunksStored: modelChunkCount(profile),
      measuredSha: measured,
      verified: profile.sha256 === null ? "unpinned" : "ok",
      ranged: sawRange,
      error: null,
    });
  } catch (err) {
    // The chunks that landed stay: the next attempt resumes from them.
    const { stored, bytes } = await inventory(cache, profile).catch(() => ({
      stored: [] as boolean[],
      bytes: 0,
    }));
    return emit({
      phase: "failed",
      cachedBytes: bytes,
      chunksStored: stored.filter(Boolean).length,
      error: describe(err),
    });
  }
}

/** Forget the weights. The player asked for the space back, or the bytes are wrong. */
export async function clearWeights(profile: ModelProfile = MODEL, env?: WeightsEnvironment): Promise<WeightsState> {
  const environment = env ?? weightsEnvironment();
  if (!environment.cacheStorage) return emit({ phase: "unsupported" });
  try {
    const cache = await environment.cacheStorage.open(MODEL_CACHE);
    const total = modelChunkCount(profile);
    for (let i = 0; i < total; i++) await cache.delete(chunkCacheKey(i, profile));
    await cache.delete(receiptCacheKey(profile));
    return emit({
      phase: "absent",
      cachedBytes: 0,
      receivedBytes: 0,
      chunksStored: 0,
      measuredSha: null,
      verified: "pending",
      error: null,
    });
  } catch (err) {
    return emit({ phase: "failed", error: describe(err) });
  }
}

/** A hash of the receipt alone — what a UI can show without reading 600 MB. */
export function receiptFingerprint(receipt: WeightsReceipt): string {
  return sha256Hex(`${receipt.modelId}:${String(receipt.bytes)}:${receipt.sha256}`).slice(0, 12);
}

/**
 * The stored weights as a stream — what an inference runtime reads. Chunk by
 * chunk, in order, straight out of Cache Storage: a runtime never has to hold the
 * whole model as one buffer, and offline it reads exactly the same bytes.
 * Throws if the file is not complete, so a runtime can never load half a model.
 */
export async function* streamStoredWeights(
  profile: ModelProfile = MODEL,
  env?: WeightsEnvironment,
): AsyncGenerator<Uint8Array> {
  const environment = env ?? weightsEnvironment();
  if (!environment.cacheStorage) throw new Error("no cache storage on this device");
  const cache = await environment.cacheStorage.open(MODEL_CACHE);
  const total = modelChunkCount(profile);
  for (let i = 0; i < total; i++) {
    const hit = await cache.match(chunkCacheKey(i, profile));
    if (!hit) throw new Error(`the weights are incomplete (chunk ${String(i)} of ${String(total)} is missing)`);
    const reader = hit.body?.getReader();
    if (!reader) {
      yield new Uint8Array(await hit.arrayBuffer());
      continue;
    }
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) yield value;
    }
  }
}
