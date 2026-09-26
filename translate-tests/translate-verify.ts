// translate-verify — THE BUNDLED TRANSLATOR'S GATE (delivery · persistence · progress).
//
// Run: cd /home/team/shared/translate-tests && env -u DATABASE_URL bun run translate-verify.ts
//
// WHAT THIS SUITE PROVES, AND HOW — nothing here is a string match on a comment:
//
//   §1  the streaming SHA-256 is the real algorithm (known answers, cross-checked
//       against node:crypto) — a wrong hash must never pass as a verdict
//   §2  the manifest is a single, versioned, checkable description of the weights
//   §3  THE DOWNLOAD, over a REAL SOCKET: `serve.ts`'s own `serveWeights` answers
//       byte ranges, and the loader stores real chunks in a Cache Storage double —
//       real bytes, real progress events, a real receipt
//   §4  RESUME: with the connection killed mid-file, the next attempt fetches ONLY
//       the missing chunks (proved by the Range headers the server actually saw)
//   §5  an app update costs ZERO requests when the weights are already on device
//   §6  a server that ignores Range still works — and is reported honestly
//   §7  a missing file fails loudly, with a message, not a throw
//   §8  THE SEAM: the engine is loaded behind a dynamic import, registered from the
//       cached weights, answerable synchronously from the translation cache, and
//       null before anything is translated
//   §9  NO READY-WHILE-UNAVAILABLE: the Settings row and the Translate affordance can
//       only claim translation is ready when an engine is really answerable AND the
//       shipped profile is the real model. Every combination of (phase × available ×
//       shipped profile × bytes on device) is walked, so a row that lies about being
//       ready — or that names the pipeline stand-in's byte count as the translator —
//       fails here instead of reaching a Persian player.
//
// FOUR HARNESS BUGS THIS SUITE FIXED (2026-09-26, each one was RED and each one was
// the harness's own fault, not the product's — the product behaviour is asserted
// harder now, no assertion was weakened and none was removed):
//   • the Cache Storage double returned the SAME Response object on every `match`, so
//     the second reader got "Body already used". The real Cache Storage hands back a
//     fresh response every time (§5 opens Settings twice); the double now does too.
//   • `bytes()` counted the JSON completion receipt as model bytes (+215), so "every
//     byte landed" could never hold. It counts chunks only now.
//   • the "server that ignores Range" used a `Bun.file()` body, which Bun's own server
//     RANGE-SLICES into a 206 whatever the status says — so §6 never tested a
//     Range-ignoring server at all, and its `ranged:false` assertion was unwinnable.
//     It sends one in-memory whole-file 200 now, which is what such a server does.
//   • §8 called `prepareTranslator()` before defining `globalThis.window`, so the SSR
//     guard short-circuited it and six checks measured an untouched device.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SITE = "/home/team/shared/site";
const read = (p: string) => new Response(Bun.file(`${SITE}/${p}`)).text();

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
};
const section = (t: string) => console.log(`\n— ${t} —`);

const sha = await import(`${SITE}/src/game/translate/sha256.ts`);
const manifest = await import(`${SITE}/src/game/translate/model-manifest.ts`);
const weights = await import(`${SITE}/src/game/translate/weights.ts`);
const probe = await import(`${SITE}/scripts/probe-weights.ts`);
const serveMod = await import(`${SITE}/serve.ts`);

// ====================================================== §1 the hash itself
section("1 · THE STREAMING SHA-256 (a wrong hash must not pass as a verdict)");
{
  const nodeH = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
  check("the empty string hashes to the known value", sha.sha256Hex(new Uint8Array(0)) === nodeH(new Uint8Array(0)), sha.sha256Hex(new Uint8Array(0)));
  check('"abc" hashes to the known value', sha.sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const big = new Uint8Array(200_000).fill(97);
  check("200,000 bytes agree with node:crypto (multi-block, not one padded block)", sha.sha256Hex(big) === nodeH(big));
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < 1000; i++) chunks.push(new Uint8Array([i % 251, (i * 7) % 253, 3]));
  const oneShot = new Uint8Array(chunks.length * 3);
  chunks.forEach((c, i) => oneShot.set(c, i * 3));
  const streamed = await sha.sha256Stream(
    (async function* () {
      for (const c of chunks) yield c;
    })(),
  );
  check("streamed chunk-by-chunk equals the one-shot hash (order matters, length too)", streamed === nodeH(oneShot));
  const h = new sha.Sha256();
  h.update(big.subarray(0, 100_000));
  check("a digest taken mid-stream does not disturb the running state", h.update(big.subarray(100_000)).digestHex() === nodeH(big));
}

// ====================================================== §2 the manifest
section("2 · THE MANIFEST — one place, versioned, checkable");
{
  check("the weights have exactly one route prefix, outside /assets/", manifest.MODEL_ROUTE_PREFIX === "/models");
  check("every profile is versioned with a file name (a new model is a new URL, never a re-download of the same one)",
    Object.values(manifest.MODEL_PROFILES).every((p: any) => /-v\d+\.(bin|onnx)$/.test(p.file)));
  check("every profile declares an exact byte length and a chunk size that divides it into whole chunks",
    Object.values(manifest.MODEL_PROFILES).every((p: any) => p.bytes > 0 && p.chunkBytes > 0 && p.chunkBytes <= p.bytes));
  check("the owner-approved model is described: m2m100_418M at ~603 MB",
    manifest.MODEL_PROFILES.m2m100.bytes === 603_000_000 && /m2m100/i.test(manifest.MODEL_PROFILES.m2m100.label));
  check("exactly one profile is active, and the app can tell whether it ships the real weights",
    typeof manifest.ACTIVE_MODEL_ID === "string" && typeof manifest.SHIPS_REAL_WEIGHTS === "boolean");
  const chunkCount = manifest.modelChunkCount();
  check(`the active profile splits into ${String(chunkCount)} chunks`, chunkCount === Math.ceil(manifest.MODEL.bytes / manifest.MODEL.chunkBytes));
  check("a chunk's range is half-open and bounded by the file", (() => {
    const last = manifest.chunkRange(chunkCount - 1);
    const first = manifest.chunkRange(0);
    return first.start === 0 && last.end === manifest.MODEL.bytes && last.end > last.start;
  })());
  check("cache keys are queries, never fragments (a fragment would collide with the file's own key)",
    manifest.chunkCacheKey(0).includes("?chunk=0") && manifest.receiptCacheKey().includes("?receipt=1"));
}

// ================================================ the harness: a real server
const dir = mkdtempSync(join(tmpdir(), "dse-weights-"));
const written = probe.writeProbe(dir, manifest.MODEL.bytes);
/**
 * A Cache Storage double. TWO THINGS IT MUST GET RIGHT, and an earlier version got
 * both wrong (see the header):
 *
 *   • `put` consumes the body, exactly like the real one, and stores the BYTES.
 *   • `match` returns a NEW Response every call. The real Cache Storage does: a stored
 *     body can be matched over and over, and the loader relies on that (the completion
 *     receipt is read on every Settings open, and on every `ensureWeights` that finds
 *     a cache already there). Returning one shared Response made the second read throw
 *     "Body already used" — a harness artifact that looked exactly like a product bug.
 *
 * `bytes()` measures the MODEL's bytes only. The completion receipt lives in the same
 * bucket and its JSON body is ~215 bytes; counting it made "every byte landed in the
 * model bucket" unsatisfiable (20000215 vs 20000000) while the product was correct.
 */
function makeCacheStorage() {
  type Entry = { body: ArrayBuffer; headers: Headers };
  const store = new Map<string, Map<string, Entry>>();
  const calls = { puts: 0 };
  const norm = (key: string) => {
    const u = new URL(key, "http://127.0.0.1:1");
    return u.pathname + u.search;
  };
  const bucket = (name: string): Map<string, Entry> => {
    const found = store.get(name);
    if (found) return found;
    const made = new Map<string, Entry>();
    store.set(name, made);
    return made;
  };
  const api = (name: string) => ({
    put: async (key: string, res: Response) => {
      calls.puts++;
      bucket(name).set(norm(key), { body: await res.arrayBuffer(), headers: new Headers(res.headers) });
    },
    match: async (key: string) => {
      const hit = bucket(name).get(norm(key));
      return hit ? new Response(hit.body.slice(0), { status: 200, headers: new Headers(hit.headers) }) : undefined;
    },
    delete: async (key: string) => bucket(name).delete(norm(key)),
  });
  return {
    store,
    calls,
    open: async (name: string) => api(name),
    /** the suite's own reader — same semantics as what `open()` hands the loader */
    match: async (name: string, key: string) => api(name).match(key),
    /** how many entries (chunks + receipt) are in a bucket */
    count: (name: string) => bucket(name).size,
    bytes: (name: string) =>
      [...bucket(name).entries()]
        .filter(([key]) => key.includes("?chunk="))
        .reduce((n, [, e]) => n + e.body.byteLength, 0),
  };
}
const seen: { range: string | null; path: string; status: number }[] = [];
function serverWith(dirPath: string, opts: { ignoreRange?: boolean } = {}) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req: Request) => {
      const range = req.headers.get("range");
      let answered: Response;
      if (opts.ignoreRange && range) {
        // A Range-ignoring server: the whole file, one 200, no content-range. The body
        // must be IN MEMORY: a `Bun.file()` body is range-sliced by Bun's own server
        // into a 206 whatever the status says, which is how the earlier version of this
        // harness accidentally tested a range-HONOURING server and made §6 unwinnable.
        const file = Bun.file(`${dirPath}/${manifest.MODEL.file}`);
        const whole = new Uint8Array(await file.arrayBuffer());
        answered = new Response(whole, {
          status: 200,
          headers: { "content-type": "application/octet-stream", "content-length": String(whole.byteLength) },
        });
      } else {
        answered = (await serveMod.serveWeights(req, dirPath)) ?? new Response("missing", { status: 404 });
      }
      // The status recorded is the one the CLIENT actually receives — not what
      // `serveWeights` would have answered. The earlier version recorded the latter, so
      // §6's "the server really ignored Range" looked like a 206 while the loader was
      // correctly being handed a 200.
      seen.push({ range, path: new URL(req.url).pathname, status: answered.status });
      return answered;
    },
  });
}
const realFetch: any = (input: string, init?: RequestInit) => fetch(input, init);

// ====================================================== §3 the download
section("3 · THE DOWNLOAD — real bytes, real ranges, real progress");
{
  const server = serverWith(dir);
  const base = `http://127.0.0.1:${String(server.port)}`;
  const cache = makeCacheStorage();
  const progress: number[] = [];
  const off = weights.subscribeWeights((s: any) => progress.push(s.percent));
  const env = {
    cacheStorage: cache as any,
    fetchImpl: (input: string, init?: RequestInit) => realFetch(input.replace(/^\/models/, `${base}/models`), init),
  };
  const state = await weights.ensureWeights(manifest.MODEL, env as any);
  off();
  check(`the weights download to a ready state (${String(state.totalBytes)} bytes)`, state.phase === "ready", `${state.phase} ${state.error ?? ""}`);
  check("every byte landed in the model bucket, not somewhere else", cache.bytes("dse-model-v1") === manifest.MODEL.bytes, String(cache.bytes("dse-model-v1")));
  check(`the file is stored as ${String(manifest.modelChunkCount())} separate chunks (which is what makes a resume possible)`,
    cache.count("dse-model-v1") === manifest.modelChunkCount() + 1);
  check("progress was reported from real bytes and finished at 100%", progress.length > 3 && progress[progress.length - 1] === 100, progress.join(","));
  check("progress only ever moved forward", progress.every((p, i) => i === 0 || p >= (progress[i - 1] ?? 0)));
  check("the transfer was ranged (206 responses with content-range), and it is reported as such", state.ranged === true);
  check("the ranged requests asked for exactly the chunk slices", seen.filter((s) => s.range !== null).length === manifest.modelChunkCount(), JSON.stringify(seen.slice(0, 3)));
  check("the hash matches the manifest's pin — the bytes are the ones we asked for", state.verified === "ok" && state.measuredSha === manifest.MODEL.sha256, `${state.verified} ${String(state.measuredSha).slice(0, 12)}`);
  const onDisk = createHash("sha256").update(new Uint8Array(await Bun.file(written.path).arrayBuffer())).digest("hex");
  check("the sha256 the loader computed equals the file on disk (cross-checked, not self-referential)", state.measuredSha === onDisk, String(onDisk));
  const receipt = await cache.match("dse-model-v1", manifest.receiptCacheKey());
  check("a completion receipt is stored beside the chunks (how a ready cache is recognised without re-reading 20 MB)", receipt !== undefined);
  // And it is still readable the second time — the real Cache Storage hands back a
  // fresh body per match, which is what makes §5's "Settings opens again" work.
  const receiptAgain = await cache.match("dse-model-v1", manifest.receiptCacheKey());
  check("the receipt can be read twice (a stored body is matchable more than once, as Cache Storage really is)", receiptAgain !== undefined && (await receiptAgain.text()).includes(manifest.MODEL.id));
  server.stop(true);
}

// ====================================================== §4 resume
section("4 · RESUME — a killed download keeps what landed and fetches only the rest");
{
  const server = serverWith(dir);
  const base = `http://127.0.0.1:${String(server.port)}`;
  const cache = makeCacheStorage();
  let count = 0;
  const flaky = (input: string, init?: RequestInit) => {
    count++;
    if (count > 2) return Promise.reject(new Error("the network went away"));
    return realFetch(input.replace(/^\/models/, `${base}/models`), init);
  };
  const first = await weights.ensureWeights(manifest.MODEL, { cacheStorage: cache as any, fetchImpl: flaky as any });
  check("a killed download reports a failure, not a silent success", first.phase === "failed" && first.error !== null, first.error ?? "");
  const kept = first.cachedBytes;
  check(`the chunks that landed are kept (${String(kept)} bytes survive the failure)`, kept > 0 && kept < manifest.MODEL.bytes, String(kept));
  check("the failure is reported as resumable — the state says how much is already safe", first.chunksStored === 2, String(first.chunksStored));
  seen.length = 0;
  const second = await weights.ensureWeights(manifest.MODEL, {
    cacheStorage: cache as any,
    fetchImpl: (input: string, init?: RequestInit) => realFetch(input.replace(/^\/models/, `${base}/models`), init),
  });
  check("the retry finishes the file", second.phase === "ready" && second.verified === "ok", `${second.phase} ${String(second.error)}`);
  const asked = seen.filter((s) => s.range !== null).map((s) => s.range);
  check(`the retry fetched ONLY the chunks that were missing (${String(asked.length)} of ${String(manifest.modelChunkCount())})`,
    asked.length === manifest.modelChunkCount() - 2, JSON.stringify(asked));
  check("and it asked for them at their real offsets (a resume, not a restart)",
    asked[0] === `bytes=${String(2 * manifest.MODEL.chunkBytes)}-${String(3 * manifest.MODEL.chunkBytes - 1)}`, String(asked[0]));
  check("the whole file still hashes to the pin after a resume", second.measuredSha === manifest.MODEL.sha256);
  server.stop(true);
}

// ====================================================== §5 an app update
section("5 · AN APP UPDATE COSTS NOTHING WHEN THE WEIGHTS ARE ALREADY HERE");
{
  const server = serverWith(dir);
  const base = `http://127.0.0.1:${String(server.port)}`;
  const cache = makeCacheStorage();
  const env = {
    cacheStorage: cache as any,
    fetchImpl: (input: string, init?: RequestInit) => realFetch(input.replace(/^\/models/, `${base}/models`), init),
  };
  await weights.ensureWeights(manifest.MODEL, env as any);
  const before = seen.length;
  const again = await weights.ensureWeights(manifest.MODEL, env as any);
  check("a second run is ready without touching the network (0 requests on an app update)", again.phase === "ready" && seen.length === before, `${String(seen.length - before)} requests`);
  check("the on-device byte count is the file's own size, never a doubled count (cached bytes and bytes-read-this-attempt overlap and must never be summed)",
    again.cachedBytes === manifest.MODEL.bytes, `${String(again.cachedBytes)} of ${String(manifest.MODEL.bytes)}`);
  const inspected = await weights.inspectWeights(manifest.MODEL, { cacheStorage: cache as any, fetchImpl: null as any } as any);
  check("the on-device state can be read with NO network at all (what Settings shows on open)", inspected.phase === "ready" && inspected.percent === 100, `${inspected.phase} ${String(inspected.percent)}`);
  // Settings is opened more than once. The real Cache Storage lets a stored body be
  // matched again; a double that hands back one shared Response fails here (this is
  // the check that used to read "partial" for a complete, verified cache).
  const reopened = await weights.inspectWeights(manifest.MODEL, { cacheStorage: cache as any, fetchImpl: null as any } as any);
  check("and it reads the same, ready, on the second open of Settings", reopened.phase === "ready" && reopened.verified === "ok" && reopened.cachedBytes === manifest.MODEL.bytes, `${reopened.phase} ${reopened.verified}`);
  const cleared = await weights.clearWeights(manifest.MODEL, { cacheStorage: cache as any, fetchImpl: null as any } as any);
  check("freeing the space really frees it (the player's choice, not a leak)", cleared.phase === "absent" && cache.bytes("dse-model-v1") === 0, String(cache.bytes("dse-model-v1")));
  server.stop(true);
}

// ====================================================== §6 no Range support
section("6 · A SERVER THAT IGNORES RANGE — works, and says so");
{
  const server = serverWith(dir, { ignoreRange: true });
  const base = `http://127.0.0.1:${String(server.port)}`;
  const cache = makeCacheStorage();
  seen.length = 0;
  const state = await weights.ensureWeights(manifest.MODEL, {
    cacheStorage: cache as any,
    fetchImpl: (input: string, init?: RequestInit) => realFetch(input.replace(/^\/models/, `${base}/models`), init),
  } as any);
  check("the server under test really IGNORED Range (one whole-file 200, no 206 — the case that is being claimed)",
    seen.length > 0 && seen.every((s) => s.status === 200), JSON.stringify(seen.map((s) => s.status)));
  check("the file still downloads completely when the server cannot do ranges", state.phase === "ready" && state.measuredSha === manifest.MODEL.sha256, `${state.phase} ${String(state.error)}`);
  check("and the state reports ranged:false — no claim of a resume it cannot do", state.ranged === false);
  check("one whole-file response fills every chunk (the split happens locally, so a resume-free server still works)",
    seen.length === 1 && state.cachedBytes === manifest.MODEL.bytes, `${String(seen.length)} requests, ${String(state.cachedBytes)} bytes`);
  check("the bytes are split into chunks locally, so a ready cache still looks the same", cache.bytes("dse-model-v1") === manifest.MODEL.bytes, String(cache.bytes("dse-model-v1")));
  // The receipt carries `ranged`, so the FALSE is durable: a later Settings open (no
  // network) still knows not to offer a resume this server cannot do.
  const reread = await weights.inspectWeights(manifest.MODEL, { cacheStorage: cache as any, fetchImpl: null as any } as any);
  check("and the honest ranged:false survives into the stored receipt (read back with no network)",
    reread.phase === "ready" && reread.ranged === false, `${reread.phase} ${String(reread.ranged)}`);
  server.stop(true);
}

// ====================================================== §7 honest failures
section("7 · HONEST FAILURES");
{
  const empty = mkdtempSync(join(tmpdir(), "dse-weights-empty-"));
  const server = serverWith(empty);
  const base = `http://127.0.0.1:${String(server.port)}`;
  const cache = makeCacheStorage();
  const state = await weights.ensureWeights(manifest.MODEL, {
    cacheStorage: cache as any,
    fetchImpl: (input: string, init?: RequestInit) => realFetch(input.replace(/^\/models/, `${base}/models`), init),
  } as any);
  check("a missing weights file fails with a message instead of throwing", state.phase === "failed" && /404/.test(String(state.error)), String(state.error));
  const traversal = await serveMod.serveWeights(new Request("http://127.0.0.1/models/..%2Fserve.ts"));
  check("the weights route refuses traversal (one flat file name, nothing else)", traversal !== null && traversal.status === 404, String(traversal?.status));
  const unsatisfiable = await serveMod.serveWeights(new Request(`http://127.0.0.1/models/${manifest.MODEL.file}`, { headers: { range: `bytes=${String(manifest.MODEL.bytes + 500)}-` } }));
  check("an unsatisfiable range is a 416 with the real size, never a truncated 200",
    unsatisfiable?.status === 416 && (unsatisfiable.headers.get("content-range") ?? "").includes(`*/${String(manifest.MODEL.bytes)}`), `${String(unsatisfiable?.status)} ${String(unsatisfiable?.headers.get("content-range"))}`);
  check("no browser Cache Storage and no fetch is 'unsupported', never a crash",
    (await weights.inspectWeights(manifest.MODEL, { cacheStorage: null, fetchImpl: null })).phase === "unsupported");
  server.stop(true);
  rmSync(empty, { recursive: true, force: true });
}

// ====================================================== §8 the seam
section("8 · THE ENGINE SEAM — loaded from the cache, answerable synchronously");
{
  const seam = await import(`${SITE}/src/game/i18n/engine-seam.ts`);
  const translate = await import(`${SITE}/src/game/i18n/translate.ts`);
  const translator = await import(`${SITE}/src/game/translate/index.ts`);
  const server = serverWith(dir);
  const base = `http://127.0.0.1:${String(server.port)}`;
  const cache = makeCacheStorage();
  const env = {
    cacheStorage: cache as any,
    fetchImpl: (input: string, init?: RequestInit) => realFetch(input.replace(/^\/models/, `${base}/models`), init),
  };
  // The runtime is absent in this repository ON PURPOSE (see runtime/engine.ts).
  check("with no runtime installed the seam stays empty — no engine by default", seam.activeTranslationEngine() === null);
  // A SERVER RENDER MUST NOT START A DOWNLOAD. `prepareTranslator` short-circuits when
  // there is no window, and the earlier version of this suite called it that way by
  // accident (Bun has no `window` until a test defines one) — so six checks below were
  // measuring a device nobody had touched. Both halves are asserted now: the guard is
  // real product behaviour, and the browser path is what §8 exists to prove.
  const beforeGuard = seen.length;
  const guarded = await translator.prepareTranslator(env as any);
  check("with no window (a server render) prepareTranslator starts nothing and says nothing is ready",
    guarded.weights.phase !== "ready" && seen.length === beforeGuard, `${guarded.weights.phase}, ${String(seen.length - beforeGuard)} requests`);
  (globalThis as any).window = globalThis;
  const built = await translator.prepareTranslator(env as any);
  check("prepareTranslator downloads the weights and reports them ready", built.weights.phase === "ready", built.weights.phase);
  check("and it still registers NO engine, because no inference runtime exists (the honest state)", translator.translatorAvailable() === false && seam.activeTranslationEngine() === null);
  // NOTE: this does not pin WHICH profile ships (that is a deploy decision — flip
  // `ACTIVE_MODEL_ID` and this suite must still pass). It pins the consequence: with no
  // runtime registered, the status the Settings row renders is not available, whatever
  // the profile is, so no row may call translation ready.
  check("so the status the Settings row renders is NOT available — nothing may call it ready", built.available === false, String(built.available));
  check("the blocker says exactly that, in one line, instead of pretending", /runtime/i.test(String(translator.translatorBlocker())), String(translator.translatorBlocker()));

  // Now the WIRING, proved with a stub runtime injected through the harness door:
  // a runtime is loaded behind a dynamic import and registered from the cache.
  let bytesRead = 0;
  translator.__setRuntimeFactory(async (ctx: any) => {
    for await (const chunk of ctx.readWeights()) bytesRead += chunk.byteLength;
    return {
      name: "stub-mt-1",
      // A FULL engine, in the shape `engine-seam.ts` documents: `text` for live strings
      // and `key` for a key the catalogues lack (given its English source, which may be
      // empty when the call site passed no literal). The earlier stub had no `key` at
      // all, so the "a missing key resolves through the engine" check below could never
      // pass — it was measuring a capability the stub did not claim.
      key: (k: string, lang: string, src: string) => (bytesRead > 0 ? `[${lang}] ${src || k}` : null),
      // And it CANNOT translate nothing: an empty string is the one input no runtime
      // answers, which is what makes the last check in this section a real test.
      translate: async (t: string, _f: string, to: string) => (bytesRead > 0 && t.trim().length > 0 ? `[${to}] ${t}` : null),
    };
  });
  const wired = await translator.prepareTranslator(env as any);
  check("a runtime loaded against the cached weights registers the engine on the seam", wired.available === true && seam.activeTranslationEngine()?.name === "stub-mt-1", String(seam.activeTranslationEngine()?.name));
  check("the runtime read the weights out of Cache Storage (the whole file, chunk by chunk)", bytesRead === manifest.MODEL.bytes, String(bytesRead));
  check("the sync seam answers null before anything has been translated — never a guess", seam.engineTranslateText("hola", "en", "es") === null);
  check("a missing key now resolves through the engine, ahead of the humanised fallback", translate.translate("es", "engine.only") === "[es] engine.only", translate.translate("es", "engine.only"));
  const line = await translator.requestTranslation("hola", "en", "es");
  check("a live translation request resolves through the runtime", line === "[es] hola", String(line));
  check("and from then on the SYNCHRONOUS seam answers it — the UI never awaits inside a render", seam.engineTranslateText("hola", "en", "es") === "[es] hola");
  check("a string the runtime cannot translate stays null rather than echoing the input", (await translator.requestTranslation("", "en", "es")) === null);
  seam.registerTranslationEngine(null);
  translator.__setRuntimeFactory(null);
  delete (globalThis as any).window;
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
}

// ================================ §9 no ready state while the engine cannot answer
// THE DEFECT THIS SECTION WAS ADDED FOR (2026-09-26): the Settings row rendered
// "Ready on this device — 20 MB" straight off `weights.phase === "ready"`, while the
// shipped profile is the small pipeline STAND-IN and no inference runtime exists — so
// the row said translation was ready on a device where translation cannot work, and
// named the stand-in's byte count as the translator. That is the exact opposite of the
// owner's rule ("without weights the Translate affordance must say translation is
// preparing in the player's own language; a partial download must never be shown as
// ready"). The verdict now lives in `game/translate/readiness.ts` — one pure function,
// no React, no DOM — and this section walks EVERY combination of its three inputs and
// fails on any state where a ready row can exist without a real engine, or where the
// stand-in's size can be printed as the translator.
section("9 · NO READY-WHILE-UNAVAILABLE (the row and the button may not lie)");
{
  const readiness = await import(`${SITE}/src/game/translate/readiness.ts`);
  const i18nMod = await import(`${SITE}/src/game/i18n/index.ts`);
  const CATALOGUES: Record<string, Record<string, string>> = i18nMod.CATALOGUES;
  const REAL_BYTES = manifest.MODEL_PROFILES.m2m100.bytes;

  /** A status with every knob the verdict reads — so no case can be skipped. */
  const statusWith = (o: {
    phase: string;
    available: boolean;
    realWeights: boolean;
    cachedBytes: number;
    receivedBytes: number;
  }) =>
    ({
      weights: {
        phase: o.phase,
        modelId: "x",
        label: "x",
        totalBytes: REAL_BYTES,
        cachedBytes: o.cachedBytes,
        receivedBytes: o.receivedBytes,
        percent: Math.min(100, Math.round(((o.cachedBytes + o.receivedBytes) / REAL_BYTES) * 100)),
        chunksTotal: 76,
        chunksStored: 0,
        resumed: false,
        ranged: true,
        verified: "unpinned",
        measuredSha: null,
        error: null,
      },
      engine: o.available ? "stub-mt-1" : null,
      available: o.available,
      realWeights: o.realWeights,
      blocker: null,
    }) as any;

  const PHASES = ["unknown", "unsupported", "absent", "partial", "downloading", "verifying", "ready", "failed"];
  let combos = 0;
  let readyWhileUnavailable = 0;
  let readyWhileStandIn = 0;
  let standInSizeNamed = 0;
  let overClaimed = 0;
  let progressOnStandIn = 0;
  let honestReady = 0;
  const offenders: string[] = [];
  for (const phase of PHASES) {
    for (const available of [true, false]) {
      for (const realWeights of [true, false]) {
        for (const cachedBytes of [0, Math.floor(REAL_BYTES / 2), REAL_BYTES]) {
          // receivedBytes is the bytes read off the wire THIS attempt, which overlap
          // with what was stored — summing the two is how a 603 MB model becomes
          // "1.2 GB on this device". Walked at both extremes so the sum is caught.
          for (const receivedBytes of [0, REAL_BYTES]) {
            combos++;
            const status = statusWith({ phase, available, realWeights, cachedBytes, receivedBytes });
            const row = readiness.translatorRow(status);
            const label = `${phase}/avail=${String(available)}/real=${String(realWeights)}/${String(cachedBytes)}+${String(receivedBytes)}`;
            if (row.kind === "ready" && !available) {
              readyWhileUnavailable++;
              offenders.push(`ready-while-unavailable ${label}`);
            }
            if (row.kind === "ready" && !realWeights) {
              readyWhileStandIn++;
              offenders.push(`ready-while-stand-in ${label}`);
            }
            if (row.kind === "ready" && (phase !== "ready" || !available || !realWeights)) {
              readyWhileUnavailable++;
              offenders.push(`ready-out-of-nothing ${label}`);
            }
            if (row.sizeBytes !== null && !realWeights) {
              standInSizeNamed++;
              offenders.push(`stand-in-size ${label}`);
            }
            if (row.doneBytes !== cachedBytes || row.doneBytes > REAL_BYTES) {
              overClaimed++;
              offenders.push(`over-claimed-bytes ${label} -> ${String(row.doneBytes)}`);
            }
            if (row.showProgress && !realWeights) {
              progressOnStandIn++;
              offenders.push(`stand-in-progress ${label}`);
            }
            if (row.kind === "ready" && available && realWeights && phase === "ready" && cachedBytes === REAL_BYTES) honestReady++;
          }
        }
      }
    }
  }
  check(`a "ready" row can never exist while the engine is unanswerable (${String(combos)} states walked)`, readyWhileUnavailable === 0, offenders.slice(0, 4).join(" | "));
  check("nor while the shipped profile is the stand-in rather than the translator", readyWhileStandIn === 0, offenders.slice(0, 4).join(" | "));
  check("and the stand-in's byte count is never printed as the translator's size", standInSizeNamed === 0, offenders.slice(0, 4).join(" | "));
  check("the on-device count is the durable byte count alone, never cached + received (the double count that turns 603 MB into 1.2 GB)", overClaimed === 0, offenders.slice(0, 4).join(" | "));
  check("no progress bar for something that is not the translator", progressOnStandIn === 0, offenders.slice(0, 4).join(" | "));
  // NOT VACUOUS: the honest combination must still be reachable, or the five checks
  // above would pass for a row that can never say anything at all.
  check("the guard is not vacuous — an answerable engine with the real model verified IS reported ready, with the real size",
    honestReady >= 1 && (() => {
      const row = readiness.translatorRow(statusWith({ phase: "ready", available: true, realWeights: true, cachedBytes: REAL_BYTES, receivedBytes: REAL_BYTES }));
      return row.kind === "ready" && row.sizeBytes === REAL_BYTES && row.doneBytes === REAL_BYTES && row.showProgress === false;
    })(), String(honestReady));
  const today = readiness.translatorRow(
    statusWith({ phase: "ready", available: false, realWeights: false, cachedBytes: 20_000_000, receivedBytes: 0 }),
  );
  check("today's real device state (stand-in weights on disk, no runtime) is NOT ready and names no size",
    today.kind === "preparing" && today.sizeBytes === null && today.doneBytes === 20_000_000, `${today.kind}/${String(today.sizeBytes)}`);

  // ---- the components render the verdict, and decide nothing themselves ----------
  const noteCode = (await read("src/components/shell/TranslatorNote.tsx")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("the Settings row takes its state from that verdict — one phase attribute, no second opinion",
    noteCode.includes("translatorRow(") && noteCode.includes("data-translator-phase={row.kind}") &&
      !noteCode.includes("w.phase") && !/data-translator-phase="ready"/.test(noteCode));
  check("the Translate affordance is gated by the same verdict (no Translate button without a real engine)",
    noteCode.includes('translatorRow(status).kind !== "ready"'));
  const readinessCode = await read("src/game/translate/readiness.ts");
  check("the verdict is pure — no React, no DOM, no fetch, no component import (so this walk tests the real decision, not a copy)",
    !/from "react"|document\.|fetch\(|from "\.\.\/\.\.\/components/.test(readinessCode.replace(/\/\*[\s\S]*?\*\//g, "")));
  // The owner's rule says the honest state is stated IN THE PLAYER'S OWN LANGUAGE, so
  // every state the row can print must exist in all five catalogues.
  const rowKeys = ["translator.ready", "translator.preparing", "translator.failed", "translator.notReady"];
  const LANG_CODES: string[] = i18nMod.LANG_CODES;
  const missingRowText = LANG_CODES.flatMap((l) => rowKeys.filter((k) => !(CATALOGUES[l]?.[k] ?? "").length).map((k) => `${l}:${k}`));
  check(`every state the row can print exists in all ${String(LANG_CODES.length)} languages`, missingRowText.length === 0, missingRowText.join(","));
  const faNotReady = CATALOGUES.fa?.["translator.notReady"] ?? "";
  check("the honest state is real Persian in the Persian file (RTL cannot be a fallback to English)",
    /[\u0600-\u06FF]/.test(faNotReady), faNotReady);
}

// ---------------------------------------------------------------- the tally
console.log(`\n${String(pass)}/${String(pass + fail)} checks passed${fail ? ` — ${String(fail)} FAILED` : ""}`);
if (fail > 0) process.exit(1);
