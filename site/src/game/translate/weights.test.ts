// weights.test.ts — the pack downloader's contracts, against a fake device.
//
// The fake pack is tiny (KBs, not the real ~640 MB) but the machinery is the
// real one: chunked ranged download, resume, per-file sha256 verification,
// assembly into whole-file cache entries, receipts, and the honest state
// machine the Settings row renders.

import { describe, expect, test, beforeEach } from "bun:test";
import {
  PACK_CHUNK_BYTES,
  packChunkCacheKey,
  packFileUrl,
  type ModelPack,
  type PackFile,
} from "./model-manifest";
import { Sha256 } from "./sha256";
import {
  clearWeights,
  ensureWeights,
  inspectWeights,
  setWeightsEnvironment,
  weightsState,
  type WeightCache,
  type WeightsEnvironment,
  type WeightsFetch,
} from "./weights";

function sha(data: Uint8Array): string {
  const h = new Sha256();
  h.update(data);
  return h.digestHex();
}

function bytes(len: number, seed: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (seed + i * 31) % 251;
  return out;
}

/** Two fake files: one single-chunk, one multi-chunk (tests the tiling). */
function fakePack(): { pack: ModelPack; data: Map<string, Uint8Array> } {
  const a = bytes(3000, 7);
  const b = bytes(PACK_CHUNK_BYTES + 1234, 99);
  const files: PackFile[] = [
    { path: "tiny.json", bytes: a.byteLength, sha256: sha(a) },
    { path: "onnx/big_quantized.onnx", bytes: b.byteLength, sha256: sha(b) },
  ];
  const data = new Map<string, Uint8Array>([
    ["tiny.json", a],
    ["onnx/big_quantized.onnx", b],
  ]);
  return {
    pack: { id: "test-pack-v1", label: "test pack", files },
    data,
  };
}

interface Stored {
  body: Uint8Array;
  headers: Headers;
}

function fakeCache(): WeightCache & { store: Map<string, Stored>; puts: number } {
  const store = new Map<string, Stored>();
  const cache: WeightCache & { store: Map<string, Stored>; puts: number } = {
    store,
    puts: 0,
    async put(request: string, response: Response) {
      cache.puts++;
      cache.store.set(request, {
        body: new Uint8Array(await response.arrayBuffer()),
        headers: response.headers,
      });
    },
    async match(request: string) {
      const hit = store.get(request);
      if (!hit) return undefined;
      return new Response(hit.body.slice().buffer as ArrayBuffer, { headers: hit.headers });
    },
    async delete(request: string) {
      return store.delete(request);
    },
  };
  return cache;
}

/** A fake R2: honours Range (206) or, when told not to, streams whole files (200). */
function fakeFetch(data: Map<string, Uint8Array>, ranged: boolean, log: string[]): WeightsFetch {
  return async (input: string, init?: RequestInit) => {
    log.push(input);
    const url = new URL(input);
    const path = url.pathname.replace(/^\//, "");
    const file = data.get(path);
    if (!file) return new Response("nope", { status: 404 });
    const range = init?.headers ? (init.headers as Record<string, string>)["Range"] : undefined;
    if (ranged && range) {
      const m = /bytes=(\d+)-(\d+)/.exec(range);
      if (!m) return new Response("bad range", { status: 416 });
      const start = Number(m[1]);
      const end = Math.min(Number(m[2]), file.byteLength - 1);
      const slice = file.slice(start, end + 1);
      return new Response(slice.slice().buffer as ArrayBuffer, {
        status: 206,
        headers: {
          "content-range": `bytes ${start}-${end}/${file.byteLength}`,
          "content-length": String(slice.byteLength),
        },
      });
    }
    return new Response(file.slice().buffer as ArrayBuffer, {
      status: 200,
      headers: { "content-length": String(file.byteLength) },
    });
  };
}

function envFor(
  cache: WeightCache,
  data: Map<string, Uint8Array>,
  log: string[],
  ranged = true,
): WeightsEnvironment {
  return {
    cacheStorage: { open: async () => cache },
    fetchImpl: fakeFetch(data, ranged, log),
  };
}

beforeEach(() => {
  setWeightsEnvironment({ cacheStorage: null, fetchImpl: null });
});

describe("ensureWeights", () => {
  test("downloads, verifies, assembles, and reports ready", async () => {
    const { pack, data } = fakePack();
    const cache = fakeCache();
    const log: string[] = [];
    const env = envFor(cache, data, log);

    const st = await ensureWeights(pack, env);
    expect(st.phase).toBe("ready");
    expect(st.verified).toBe("ok");
    expect(st.cachedBytes).toBe(st.totalBytes);
    expect(st.percent).toBe(100);
    expect(st.ranged).toBe(true);

    // Whole-file entries exist at the file URLs, at the exact byte lengths.
    for (const f of pack.files) {
      const hit = await cache.match(packFileUrl(f));
      expect(hit).toBeDefined();
      expect((await hit!.arrayBuffer()).byteLength).toBe(f.bytes);
    }
    // Chunk keys are cleaned up after assembly — steady state is the pack itself.
    for (const key of cache.store.keys()) {
      expect(key.includes("?chunk=")).toBe(false);
    }
  });

  test("a completed pack costs zero requests", async () => {
    const { pack, data } = fakePack();
    const cache = fakeCache();
    const log: string[] = [];
    const env = envFor(cache, data, log);
    await ensureWeights(pack, env);
    log.length = 0;
    const st = await ensureWeights(pack, env);
    expect(st.phase).toBe("ready");
    expect(log.length).toBe(0);
  });

  test("resumes a partial download, fetching only missing chunks", async () => {
    const { pack, data } = fakePack();
    const cache = fakeCache();
    const log: string[] = [];
    const env = envFor(cache, data, log);

    // Seed one chunk of the big file directly.
    const big = pack.files[1]!;
    const chunk0 = data.get(big.path)!.slice(0, PACK_CHUNK_BYTES);
    await cache.put(
      packChunkCacheKey(big, 0),
      new Response(chunk0.slice().buffer as ArrayBuffer, {
        headers: { "x-dse-chunk-bytes": String(chunk0.byteLength) },
      }),
    );
    log.length = 0;
    const st = await ensureWeights(pack, env);
    expect(st.phase).toBe("ready");
    expect(st.resumed).toBe(true);
    // The seeded chunk was not re-fetched: tiny.json (1 chunk) + big chunk 1.
    expect(log.length).toBe(2);
  });

  test("a hash mismatch fails loudly and drops the bad file", async () => {
    const { pack, data } = fakePack();
    const cache = fakeCache();
    const log: string[] = [];
    // Corrupt the second file on the wire.
    const evil = new Map(data);
    const bad = bytes(data.get("onnx/big_quantized.onnx")!.byteLength, 1);
    evil.set("onnx/big_quantized.onnx", bad);
    const env = envFor(cache, evil, log);

    const st = await ensureWeights(pack, env);
    expect(st.phase).toBe("failed");
    expect((st.error ?? "").includes("pinned hash")).toBe(true);
    // The bad file is not cached as whole; its chunks are dropped.
    expect(await cache.match(packFileUrl(pack.files[1]!))).toBeUndefined();
  });

  test("works when the server ignores Range (whole-file fallback)", async () => {
    const { pack, data } = fakePack();
    const cache = fakeCache();
    const log: string[] = [];
    const env = envFor(cache, data, log, false);

    const st = await ensureWeights(pack, env);
    expect(st.phase).toBe("ready");
    expect(st.verified).toBe("ok");
    expect(st.ranged).toBe(false);
  });

  test("a 404 fails with an honest error", async () => {
    const { pack } = fakePack();
    const cache = fakeCache();
    const log: string[] = [];
    const env = envFor(cache, new Map(), log);
    const st = await ensureWeights(pack, env);
    expect(st.phase).toBe("failed");
    expect((st.error ?? "").includes("404")).toBe(true);
  });
});

describe("inspectWeights", () => {
  test("absent on an empty cache, partial with chunks on disk", async () => {
    const { pack, data } = fakePack();
    const cache = fakeCache();
    const log: string[] = [];
    const env = envFor(cache, data, log);

    expect((await inspectWeights(pack, env)).phase).toBe("absent");

    const tiny = pack.files[0]!;
    await cache.put(
      packChunkCacheKey(tiny, 0),
      new Response(data.get(tiny.path)!.slice().buffer as ArrayBuffer, {
        headers: { "x-dse-chunk-bytes": String(tiny.bytes) },
      }),
    );
    const partial = await inspectWeights(pack, env);
    expect(partial.phase).toBe("partial");
    expect(partial.cachedBytes).toBe(tiny.bytes);
  });

  test("unsupported without Cache Storage", async () => {
    const { pack } = fakePack();
    const st = await inspectWeights(pack, { cacheStorage: null, fetchImpl: null });
    expect(st.phase).toBe("unsupported");
  });
});

describe("clearWeights", () => {
  test("forgets everything", async () => {
    const { pack, data } = fakePack();
    const cache = fakeCache();
    const log: string[] = [];
    const env = envFor(cache, data, log);
    await ensureWeights(pack, env);
    expect(cache.store.size).toBeGreaterThan(0);
    const st = await clearWeights(pack, env);
    expect(st.phase).toBe("absent");
    expect(cache.store.size).toBe(0);
    expect(weightsState().cachedBytes).toBe(0);
  });
});
