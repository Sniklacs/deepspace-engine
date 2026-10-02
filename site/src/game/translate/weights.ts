// weights.ts — THE LOADER: fetch the translator's pack, file by file, into the
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
//   1. INCREMENTAL. Every pack file is downloaded in CHUNKS, each chunk cached
//      under its own key inside the `dse-model-v1` bucket. That bucket is on the
//      service worker's keep-list, so a publish does not evict it, and a completed
//      download is recognised from a receipt and makes ZERO requests — an app
//      update never re-downloads ~600 MB.
//   2. RESUMABLE. A dropped connection keeps the chunks that already landed. The
//      next attempt fetches only the missing ones, by byte range, and says so
//      (`resumed: true`). If the server ignores `Range`, the loader still works —
//      it says `ranged: false` and restarts the file in one pass, because that is
//      what the server actually gives us.
//   3. PROGRESS THAT IS REAL BYTES. Progress is counted from bytes read off the
//      wire and bytes durably stored, never estimated from a timer. A partially
//      downloaded pack is never mistaken for a ready one: "ready" requires every
//      file present at its exact length with its sha256 verified.
//   4. VERIFIABLE. `sha256.ts` hashes each assembled file as a stream of its
//      chunks, so checking a 344 MB file never means holding two copies. A hash
//      mismatch fails the download and drops the bytes rather than caching
//      something that cannot be trusted.
//
// ASSEMBLY. Transformers.js reads each model file WHOLE through the cache hook
// the engine installs (`env.customCache`), so once a file's chunks are all on
// disk and hash-verified, the loader assembles it into one cache entry under the
// file's own URL and deletes the chunk keys. Steady-state storage is the pack
// itself (~611 MB), not the pack twice.
//
// NOTHING HERE TALKS TO THE UI. It is an observable state machine; the components
// subscribe to it. And nothing here imports React, the API or the store.

import { MODEL_CACHE } from "../pwa/storage";
import {
  PACK_CHUNK_BYTES,
  TRANSLATE_PACK,
  packChunkCacheKey,
  packChunkRange,
  packFileChunkCount,
  packFileUrl,
  packReceiptCacheKey,
  packTotalBytes,
  type ModelPack,
  type PackFile,
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
  | "partial" // some chunks stored, the pack is incomplete
  | "downloading"
  | "verifying"
  | "ready"
  | "failed";

export interface PackFileReceipt {
  path: string;
  bytes: number;
  sha256: string;
}

export interface WeightsReceipt {
  packId: string;
  bytes: number;
  files: PackFileReceipt[];
  chunkBytes: number;
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
  /** "ok" = every file matched its pinned hash */
  verified: "pending" | "ok" | "unpinned" | "mismatch";
  /** the honest failure line, never a stack trace */
  error: string | null;
}

function initialState(pack: ModelPack = TRANSLATE_PACK): WeightsState {
  return {
    phase: "unknown",
    ...packMeta(pack),
    cachedBytes: 0,
    receivedBytes: 0,
    percent: 0,
    chunksStored: 0,
    resumed: false,
    ranged: null,
    verified: "pending",
    error: null,
  };
}

/** The state fields that identify the pack — re-emitted whenever we look at a (possibly different) pack. */
function packMeta(pack: ModelPack): { modelId: string; label: string; totalBytes: number; chunksTotal: number } {
  return {
    modelId: pack.id,
    label: pack.label,
    totalBytes: packTotalBytes(pack),
    chunksTotal: pack.files.reduce((n, f) => n + packFileChunkCount(f), 0),
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

/** Headers stamped on every assembled file, so a later look is cheap. */
const FILE_BYTES_HEADER = "x-dse-file-bytes";
const FILE_SHA_HEADER = "x-dse-file-sha256";

/** Is this file's assembled entry on disk, at exactly the length it must be? */
async function fileComplete(cache: WeightCache, file: PackFile): Promise<boolean> {
  const hit = await cache.match(packFileUrl(file));
  if (!hit) return false;
  const declared = Number(hit.headers.get(FILE_BYTES_HEADER) ?? hit.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > 0) return declared === file.bytes;
  try {
    return (await hit.arrayBuffer()).byteLength === file.bytes;
  } catch {
    return false;
  }
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

async function readReceipt(cache: WeightCache, pack: ModelPack): Promise<WeightsReceipt | null> {
  try {
    const hit = await cache.match(packReceiptCacheKey(pack));
    if (!hit) return null;
    const parsed: unknown = JSON.parse(await hit.text());
    if (typeof parsed !== "object" || parsed === null) return null;
    const r = parsed as Partial<WeightsReceipt>;
    if (r.packId !== pack.id || typeof r.bytes !== "number" || !Array.isArray(r.files)) return null;
    return {
      packId: r.packId,
      bytes: r.bytes,
      files: (r.files as PackFileReceipt[]).filter(
        (f) => typeof f?.path === "string" && typeof f?.bytes === "number" && typeof f?.sha256 === "string",
      ),
      chunkBytes: typeof r.chunkBytes === "number" ? r.chunkBytes : PACK_CHUNK_BYTES,
      ranged: r.ranged === true,
      completedAt: typeof r.completedAt === "string" ? r.completedAt : "",
    };
  } catch {
    return null;
  }
}

async function writeReceipt(cache: WeightCache, receipt: WeightsReceipt, pack: ModelPack): Promise<void> {
  const body = JSON.stringify(receipt);
  await cache.put(
    packReceiptCacheKey(pack),
    new Response(body, {
      status: 200,
      headers: { "content-type": "application/json", "content-length": String(body.length) },
    }),
  );
}

/**
 * Durable bytes per file: the whole file when it is complete, otherwise the
 * chunks that are on disk at the length they must be. Cheap: headers, not bodies.
 */
async function inventory(
  cache: WeightCache,
  pack: ModelPack,
): Promise<{ files: { file: PackFile; complete: boolean; stored: boolean[]; bytes: number }[]; bytes: number }> {
  const files: { file: PackFile; complete: boolean; stored: boolean[]; bytes: number }[] = [];
  let bytes = 0;
  for (const file of pack.files) {
    if (await fileComplete(cache, file)) {
      files.push({ file, complete: true, stored: [], bytes: file.bytes });
      bytes += file.bytes;
      continue;
    }
    const total = packFileChunkCount(file);
    const stored: boolean[] = [];
    let fileBytes = 0;
    for (let i = 0; i < total; i++) {
      const range = packChunkRange(file, i);
      const expected = range.end - range.start;
      const key = packChunkCacheKey(file, i);
      const have = await storedChunkBytes(cache, key);
      if (have === expected) {
        stored.push(true);
        fileBytes += have;
      } else {
        stored.push(false);
        if (have > 0) await cache.delete(key); // the wrong length is not a partial chunk, it is a bad one
      }
    }
    files.push({ file, complete: false, stored, bytes: fileBytes });
    bytes += fileBytes;
  }
  return { files, bytes };
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

/**
 * Assemble one file from its chunks: hash the chunks as a stream, compare with
 * the pinned sha256, and only then store the whole file under its own URL and
 * delete the chunk keys. A file that fails the hash is dropped, never cached.
 */
async function assembleFile(cache: WeightCache, file: PackFile, totalChunks: number): Promise<void> {
  const hash = new Sha256();
  const parts: Uint8Array[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const hit = await cache.match(packChunkCacheKey(file, i));
    if (!hit) throw new Error(`chunk ${String(i)} of ${file.path} missing at assembly`);
    const bytes = new Uint8Array(await hit.arrayBuffer());
    hash.update(bytes);
    parts.push(bytes);
  }
  const measured = hash.digestHex();
  if (measured !== file.sha256) {
    for (let i = 0; i < totalChunks; i++) await cache.delete(packChunkCacheKey(file, i));
    throw new Error(`the download of ${file.path} does not match its pinned hash (measured ${measured.slice(0, 12)}…)`);
  }
  await cache.put(
    packFileUrl(file),
    new Response(new Blob(parts as BlobPart[], { type: "application/octet-stream" }), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(file.bytes),
        [FILE_BYTES_HEADER]: String(file.bytes),
        [FILE_SHA_HEADER]: file.sha256,
      },
    }),
  );
  for (let i = 0; i < totalChunks; i++) await cache.delete(packChunkCacheKey(file, i));
}

/** Hash the assembled files IN ORDER — what a re-verify pass checks. */
export async function hashStoredWeights(cache: WeightCache, pack: ModelPack = TRANSLATE_PACK): Promise<string> {
  const hash = new Sha256();
  for (const file of pack.files) {
    const hit = await cache.match(packFileUrl(file));
    if (!hit) throw new Error(`file ${file.path} missing`);
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
export async function inspectWeights(pack: ModelPack = TRANSLATE_PACK, env?: WeightsEnvironment): Promise<WeightsState> {
  const environment = env ?? weightsEnvironment();
  if (!environment.cacheStorage) {
    return emit({ ...packMeta(pack), phase: "unsupported", error: null });
  }
  try {
    const cache = await environment.cacheStorage.open(MODEL_CACHE);
    const receipt = await readReceipt(cache, pack);
    if (receipt && receipt.bytes === packTotalBytes(pack)) {
      // The receipt names this pack: confirm every file is really on disk.
      let whole = true;
      for (const file of pack.files) {
        if (!(await fileComplete(cache, file))) {
          whole = false;
          break;
        }
      }
      if (whole) {
        return emit({
          ...packMeta(pack),
          phase: "ready",
          cachedBytes: packTotalBytes(pack),
          receivedBytes: 0,
          chunksStored: 0,
          ranged: receipt.ranged,
          verified: "ok",
          error: null,
        });
      }
      // The receipt lies about what is on disk — start over.
      await clearWeights(pack, environment);
    }
    const { files, bytes } = await inventory(cache, pack);
    return emit({
      ...packMeta(pack),
      phase: bytes > 0 ? "partial" : "absent",
      cachedBytes: bytes,
      receivedBytes: 0,
      chunksStored: files.reduce((n, f) => n + f.stored.filter(Boolean).length, 0),
      verified: "pending",
      error: null,
    });
  } catch (err) {
    return emit({ ...packMeta(pack), phase: "failed", error: describe(err) });
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
export function ensureWeights(pack: ModelPack = TRANSLATE_PACK, env?: WeightsEnvironment): Promise<WeightsState> {
  if (inflight) return inflight;
  inflight = run(pack, env ?? weightsEnvironment()).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function run(pack: ModelPack, environment: WeightsEnvironment): Promise<WeightsState> {
  if (!environment.cacheStorage || !environment.fetchImpl) {
    return emit({ ...packMeta(pack), phase: "unsupported", error: null });
  }
  const fetcher = environment.fetchImpl;
  const cache = await environment.cacheStorage.open(MODEL_CACHE);

  // 1 · already have it? Then this costs no network at all.
  const inspected = await inspectWeights(pack, environment);
  if (inspected.phase === "ready") return inspected;
  if (inspected.phase === "failed" && inspected.error !== null) return inspected;

  try {
    const inv = await inventory(cache, pack);
    let cachedBytes = inv.bytes;
    let storedCount = inv.files.reduce((n, f) => n + f.stored.filter(Boolean).length, 0);
    let received = 0;
    const runStartCached = inv.bytes;
    // Progress is measured from a fixed base (what was already on disk) plus the
    // bytes this attempt has read — so a resumed download starts where it left off
    // and a landing chunk can never be counted twice.
    const pct = (): number =>
      state.totalBytes > 0 ? Math.min(100, Math.round(((runStartCached + received) / state.totalBytes) * 100)) : 0;
    let sawRange = false;

    emit({
      ...packMeta(pack),
      phase: "downloading",
      cachedBytes,
      receivedBytes: 0,
      percent: pct(),
      chunksStored: storedCount,
      resumed: cachedBytes > 0,
      ranged: state.ranged,
      error: null,
    });

    for (const entry of inv.files) {
      if (entry.complete) continue;
      const file = entry.file;
      const totalChunks = packFileChunkCount(file);
      const missing = entry.stored.map((has, i) => (has ? -1 : i)).filter((i) => i >= 0);
      let wholeFileStreamed = false;

      for (let n = 0; n < missing.length; n++) {
        const index = missing[n] ?? 0;
        const range = packChunkRange(file, index);
        const expected = range.end - range.start;
        const key = packChunkCacheKey(file, index);
        const url = packFileUrl(file);
        const response = await fetcher(url, {
          headers: { Range: `bytes=${String(range.start)}-${String(range.end - 1)}` },
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`the pack route answered ${String(response.status)} for ${file.path}`);

        const partial = response.status === 206;
        if (partial) {
          const contentRange = response.headers.get("content-range") ?? "";
          const m = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/.exec(contentRange);
          if (!m || Number(m[1]) !== range.start) {
            throw new Error(`the server sent the wrong slice for ${file.path}: content-range "${contentRange}"`);
          }
          sawRange = true;
          await storeChunkFromBody(cache, key, response, expected, (n2) => {
            received += n2;
            emit({ phase: "downloading", receivedBytes: received, cachedBytes, percent: pct() });
          });
          cachedBytes += expected;
          storedCount++;
          entry.stored[index] = true;
        } else {
          // The server ignored Range and is sending the whole file. Split it here,
          // streaming, and fill in every chunk we are missing on the way past.
          wholeFileStreamed = true;
          sawRange = false;
          let absolute = 0;
          const reader = response.body?.getReader();
          if (!reader) throw new Error(`the pack route sent no body for ${file.path}`);
          let pending: Uint8Array[] = [];
          let pendingBytes = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || value.byteLength === 0) continue;
            received += value.byteLength;
            let cursor = 0;
            while (cursor < value.byteLength) {
              const absoluteIndex = Math.floor(absolute / PACK_CHUNK_BYTES);
              const chunkStart = absoluteIndex * PACK_CHUNK_BYTES;
              const chunkEnd = Math.min(chunkStart + PACK_CHUNK_BYTES, file.bytes);
              const take = Math.min(value.byteLength - cursor, chunkEnd - absolute);
              pending.push(value.subarray(cursor, cursor + take).slice());
              pendingBytes += take;
              cursor += take;
              absolute += take;
              if (absolute >= chunkEnd) {
                if (!entry.stored[absoluteIndex]) {
                  const joined = new Uint8Array(pendingBytes);
                  let offset = 0;
                  for (const part of pending) {
                    joined.set(part, offset);
                    offset += part.byteLength;
                  }
                  await cache.put(packChunkCacheKey(file, absoluteIndex), chunkResponse(joined));
                  cachedBytes += joined.byteLength;
                  storedCount++;
                  entry.stored[absoluteIndex] = true;
                }
                pending = [];
                pendingBytes = 0;
              }
            }
            emit({ phase: "downloading", receivedBytes: received, cachedBytes, percent: pct(), ranged: false });
            if (absolute >= file.bytes) break;
          }
          if (absolute < file.bytes) throw new Error(`short read of ${file.path}: ${String(absolute)} of ${String(file.bytes)} bytes`);
        }

        const have = await storedChunkBytes(cache, key);
        if (have !== expected) throw new Error(`chunk ${String(index)} of ${file.path} did not land (${String(have)} of ${String(expected)})`);
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

      // 2 · verify + assemble this file before moving on: a bad file never
      // poisons the cache, and its chunks are dropped so the retry is clean.
      emit({ phase: "verifying", receivedBytes: received, cachedBytes, percent: pct(), ranged: sawRange });
      await assembleFile(cache, file, totalChunks);
      const fresh = await inventory(cache, pack);
      cachedBytes = fresh.bytes;
      storedCount = fresh.files.reduce((n, f) => n + f.stored.filter(Boolean).length, 0);
      emit({ phase: "downloading", receivedBytes: received, cachedBytes, percent: pct(), chunksStored: storedCount });
    }

    const receipt: WeightsReceipt = {
      packId: pack.id,
      bytes: packTotalBytes(pack),
      files: pack.files.map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })),
      chunkBytes: PACK_CHUNK_BYTES,
      ranged: sawRange,
      completedAt: new Date().toISOString(),
    };
    await writeReceipt(cache, receipt, pack);
    return emit({
      ...packMeta(pack),
      phase: "ready",
      cachedBytes: packTotalBytes(pack),
      receivedBytes: received,
      chunksStored: 0,
      verified: "ok",
      ranged: sawRange,
      error: null,
    });
  } catch (err) {
    // The files that fully landed stay: the next attempt resumes from them.
    const { files, bytes } = await inventory(cache, pack).catch(() => ({
      files: [] as { file: PackFile; complete: boolean; stored: boolean[]; bytes: number }[],
      bytes: 0,
    }));
    return emit({
      ...packMeta(pack),
      phase: "failed",
      cachedBytes: bytes,
      chunksStored: files.reduce((n, f) => n + f.stored.filter(Boolean).length, 0),
      error: describe(err),
    });
  }
}

/** Forget the pack: every assembled file, every chunk, the receipt. */
export async function clearWeights(pack: ModelPack = TRANSLATE_PACK, env?: WeightsEnvironment): Promise<WeightsState> {
  const environment = env ?? weightsEnvironment();
  if (!environment.cacheStorage) return emit({ ...packMeta(pack), phase: "unsupported" });
  try {
    const cache = await environment.cacheStorage.open(MODEL_CACHE);
    for (const file of pack.files) {
      await cache.delete(packFileUrl(file));
      const total = packFileChunkCount(file);
      for (let i = 0; i < total; i++) await cache.delete(packChunkCacheKey(file, i));
    }
    await cache.delete(packReceiptCacheKey(pack));
    return emit({
      ...packMeta(pack),
      phase: "absent",
      cachedBytes: 0,
      receivedBytes: 0,
      chunksStored: 0,
      verified: "pending",
      error: null,
    });
  } catch (err) {
    return emit({ ...packMeta(pack), phase: "failed", error: describe(err) });
  }
}

/** A hash of the receipt alone — what a UI can show without reading 600 MB. */
export function receiptFingerprint(receipt: WeightsReceipt): string {
  return sha256Hex(`${receipt.packId}:${String(receipt.bytes)}`).slice(0, 12);
}
