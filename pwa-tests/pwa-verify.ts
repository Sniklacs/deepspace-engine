// pwa-verify — THE INSTALLABILITY GATE (app-shell slice 1).
//
// Run: cd /home/team/shared/pwa-tests && env -u DATABASE_URL bun run pwa-verify.ts
//
// WHY. The app shell shipped with nothing watching it. `serve.ts` had already
// grown one bug that nothing caught — Bun attached a `content-disposition:
// filename="…"` to the manifest, i.e. a download hint on the one file that
// decides how the app installs — and the install affordance's "an installed app
// shows NOTHING" branch had never been executed. Both are gated here.
//
// Everything reads the SERVED tree (/home/team/shared/site) because that is what
// the suites, the browser pass and the dev server all read, and it is the tree
// that actually gets built. `serve.ts` exports `stampBuildToken` / `cacheHeaders`
// / `appFetch` behind an `import.meta.main` guard precisely so this suite can gate
// the headers and the token substitution WITHOUT binding port 3000.
//
// The service worker is not string-matched: its source is LOADED and RUN against a
// stub `self`/`caches`/`fetch`, and the assertions are made on what it actually
// did to a request — so "no non-GET request is ever cached" is a fact about
// behaviour, not a phrase found in a comment.
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SITE = "/home/team/shared/site";
const read = (p: string) => readFileSync(`${SITE}/${p}`, "utf8");
const readBin = (p: string) => readFileSync(`${SITE}/${p}`);
const ORIGIN = "http://127.0.0.1:3000";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const section = (t: string) => console.log(`\n— ${t} —`);

// =====================================================================  §1 icons
section("1 · THE ICONS — the real pixels, against what the manifest declares");
/** PNG's own IHDR: width/height are big-endian u32 at byte 16/20. Takes a path RELATIVE to SITE. */
function pngSize(rel: string): { w: number; h: number } | null {
  const b = readBin(rel);
  const isPng = b.length > 24 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!isPng || b.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const ICONS: Record<string, [number, number]> = {
  "/icons/icon-192.png": [192, 192],
  "/icons/icon-512.png": [512, 512],
  "/icons/icon-maskable-512.png": [512, 512],
  "/icons/apple-touch-icon-180.png": [180, 180],
};
for (const [p, [w, h]] of Object.entries(ICONS)) {
  const size = pngSize(`public${p}`);
  check(`${p} is a PNG whose real IHDR is ${String(w)}x${String(h)}`,
    size?.w === w && size?.h === h, size ? `got ${String(size.w)}x${String(size.h)}` : "not a PNG / no IHDR");
}
// The designer replaces this art at the same paths — so the declared size is what
// the manifest promises an installer, and it has to match the file on disk.
const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
  icons: { src: string; sizes: string; purpose?: string; type: string }[];
  display: string; start_url: string; scope: string; name: string; short_name: string;
};
for (const icon of manifest.icons) {
  const real = pngSize(`public${icon.src}`);
  check(`manifest declares ${icon.src} as ${icon.sizes}, and that is the real pixel size`,
    real !== null && `${String(real.w)}x${String(real.h)}` === icon.sizes,
    real ? `real ${String(real.w)}x${String(real.h)}` : "file missing");
  check(`${icon.src} is declared type image/png`, icon.type === "image/png", icon.type);
}
check("a maskable 512 icon is declared (Android's adaptive-icon requirement)",
  manifest.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"));
check("an install needs 192 AND 512 'any' icons", ["192x192", "512x512"].every(
  (s) => manifest.icons.some((i) => i.sizes === s && i.purpose === "any")));
check("the manifest asks for a standalone launch", manifest.display === "standalone", manifest.display);

// ============================================== §2 every declared path is real
section("2 · EVERY PATH THE SHELL PROMISES EXISTS IN THE BUILD (dist/client)");
const CLIENT = `${SITE}/dist/client`;
check("a client build exists", existsSync(CLIENT));
for (const p of ["/manifest.webmanifest", "/sw.js", ...Object.keys(ICONS)]) {
  check(`${p} is in dist/client`, existsSync(`${CLIENT}${p}`));
}
check("the served manifest and the source manifest are byte-identical",
  read("public/manifest.webmanifest").length > 0 &&
  readBin("dist/client/manifest.webmanifest").equals(readBin("public/manifest.webmanifest")));
// The build's own copy of the worker still carries the token — that is the
// contract: the SERVER substitutes it (gated in §4), the file ships with it.
check("the shipped sw.js carries the @@BUILD@@ token for the server to stamp",
  read("dist/client/sw.js").includes("@@BUILD@@"));

// ==================================================== §3 the service worker
section("3 · THE SERVICE WORKER, RUN — what it caches and what it refuses");
const swSrc = read("dist/client/sw.js");

/**
 * RUN the worker — never read it. A stub `self`/`caches`/`fetch` is installed and
 * the source is executed in it, so every assertion below is a fact about what the
 * worker DID to a request rather than a phrase found in a file.
 *
 * §4 reuses this to run the STAMPED worker — the bytes a browser actually
 * receives. That matters because the cache names are COMPUTED at runtime from a
 * single `BUILD` constant (`dse-shell-${BUILD}`), so the string `dse-shell-<id>`
 * never appears in any source file: `serve.ts` substitutes the token into the
 * constant and the worker builds the names from it. A string match on the stamped
 * source therefore proves nothing either way; only running it does.
 */
type Handler = (e: any) => void;
function runWorker(src: string) {
  const listeners: Record<string, Handler[]> = {};
  const cachesStore = new Map<string, Map<string, any>>();
  const keyOf = (r: any): string => {
    try {
      const raw = typeof r === "string" ? (r.startsWith("/") ? ORIGIN + r : r) : String(r.url);
      const u = new URL(raw);
      return u.pathname + u.search;
    } catch { return String(r); }
  };
  const cacheOf = (n: string) => {
    if (!cachesStore.has(n)) cachesStore.set(n, new Map());
    return cachesStore.get(n)!;
  };
  let fetchCalls: string[] = [];
  const mkRes = (body: string, opts: { status?: number; type?: string } = {}) => {
    const res = new Response(body, { status: opts.status ?? 200 });
    if (opts.type) Object.defineProperty(res, "type", { value: opts.type });
    return res;
  };
  const stubSelf = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, fn: Handler) => { (listeners[t] ||= []).push(fn); },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const stubCaches = {
    open: async (n: string) => ({
      put: async (req: any, res: any) => { cacheOf(n).set(keyOf(req), res); },
      match: async (req: any) => cacheOf(n).get(keyOf(req)),
    }),
    keys: async () => [...cachesStore.keys()],
    delete: async (n: string) => cachesStore.delete(n),
  };
  const stubFetch = async (req: any) => {
    fetchCalls.push(typeof req === "string" ? req : String(req.url));
    return mkRes("ok", { type: "basic" });
  };
  new Function("self", "caches", "fetch", src)(stubSelf, stubCaches, stubFetch);

  /** Fire a lifecycle event and wait for everything it handed to `waitUntil`. */
  const lifecycle = async (type: "install" | "activate") => {
    const waiting: Promise<unknown>[] = [];
    listeners[type]![0]!({ waitUntil: (p: Promise<unknown>) => waiting.push(p) });
    await Promise.all(waiting);
  };
  /** Fire a request and report whether the worker answered it at all. */
  const fire = async (method: string, path: string, mode = "no-cors"): Promise<{ responded: boolean; body?: string }> => {
    const request = new Request(`${ORIGIN}${path}`, { method, mode: mode as RequestMode });
    let answered: Promise<Response> | null = null;
    listeners.fetch![0]!({ request, respondWith: (p: Promise<Response>) => { answered = p; } });
    if (!answered) return { responded: false };
    const res = await (answered as Promise<Response>);
    return { responded: true, body: await res.text() };
  };
  /** Every cache the worker has created by now, in creation order. */
  const cacheNames = () => [...cachesStore.keys()];
  return {
    listeners, cachesStore, keyOf, cacheOf, mkRes, lifecycle, fire, cacheNames,
    get fetchCalls() { return fetchCalls; },
    resetFetchCalls: () => { fetchCalls = []; },
  };
}

const W = runWorker(swSrc);
const { listeners, cachesStore, cacheOf, mkRes, fire } = W;
check("the worker registers install, activate and fetch listeners",
  ["install", "activate", "fetch"].every((t) => (listeners[t]?.length ?? 0) === 1),
  Object.keys(listeners).join(","));

// --- install: precache exactly the shell, with `reload` so nothing stale is kept
const SHELL_FILES = ((): string[] => {
  const raw = /const SHELL_FILES = \[([\s\S]*?)\];/.exec(swSrc)?.[1] ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean)
    .map((s) => (s === "SHELL_DOCUMENT" ? "/" : (JSON.parse(s) as string)));
})();
check("SHELL_FILES precaches the document, the manifest and all four icons",
  SHELL_FILES.length === 6 && SHELL_FILES.includes("/") &&
  SHELL_FILES.includes("/manifest.webmanifest") && Object.keys(ICONS).every((p) => SHELL_FILES.includes(p)),
  SHELL_FILES.join(" "));
W.resetFetchCalls();
await W.lifecycle("install");
const shellCacheName = W.cacheNames().find((n) => n.startsWith("dse-shell-")) ?? "";
check("install creates a shell cache named after the build (dse-shell-<build>)",
  /^dse-shell-\S+$/.test(shellCacheName), shellCacheName);
check("every precached shell file actually landed in that cache",
  SHELL_FILES.every((f) => cacheOf(shellCacheName).has(f)),
  [...cacheOf(shellCacheName).keys()].join(" "));
check("the precache fetches with cache:'reload' (never a stale browser copy)",
  W.fetchCalls.length === SHELL_FILES.length, W.fetchCalls.join(" "));

// --- the fetch policy, exercised request by request
section("3a · NOTHING THAT IS NOT A PLAIN GET IS EVER TOUCHED OR CACHED");
for (const [m, p] of [["POST", "/"], ["POST", "/assets/index-abc.js"], ["PUT", "/manifest.webmanifest"], ["DELETE", "/icons/icon-192.png"]] as [string, string][]) {
  const r = await fire(m, p);
  check(`${m} ${p} is left to the network`, r.responded === false);
}
check("no non-GET request reached the cache (the caches hold only the shell precache)",
  [...cachesStore.keys()].filter((n) => n.startsWith("dse-assets-")).length === 0);
section("3b · THE GAME'S OWN DATA IS NEVER INTERCEPTED");
for (const p of ["/_serverFn/abc123", "/api/state", "/__manifest", "/?_serverFnId=abc123"]) {
  const r = await fire("GET", p);
  check(`GET ${p} goes straight to the network`, r.responded === false);
}
section("3c · THE SHELL, OFFLINE");
{
  const r = await fire("GET", "/manifest.webmanifest");
  check("the manifest is answered from the precached shell", r.responded && r.body === "ok", r.body ?? "not answered");
  const nav = await fire("GET", "/", "navigate");
  check("a navigation is network-first with the shell as the offline fallback", nav.responded === true);
  const asset = await fire("GET", "/assets/index-abc.js");
  check("a fingerprinted asset is served cache-first", asset.responded === true);
  const assetsCache = [...cachesStore.keys()].find((n) => n.startsWith("dse-assets-")) ?? "";
  check("that asset was then stored in the assets cache (it cannot be stale: Vite fingerprints it)",
    assetsCache !== "" && cacheOf(assetsCache).has("/assets/index-abc.js"));
}
section("3d · A NEW BUILD CLEARS THE OLD SHELL");
{
  const stale = "dse-shell-oldbuild0000";
  cacheOf(stale).set("/", mkRes("stale"));
  await W.lifecycle("activate");
  check("activate deletes every cache that is not of this build", !cachesStore.has(stale));
  check("activate keeps this build's own caches (nothing to re-precache on a reload)",
    SHELL_FILES.every(() => cachesStore.has(shellCacheName)));
}

const modelCacheKey = "/models/weights-v1.bin?chunk=0";
// ============================= §3e the translator's weights survive a publish
// THE most important property of this slice (owner, 2026-09-26): a player
// downloads the app once; every change we fold in is an update. "activate" in
// the worker deletes every cache that is not on KEEP, and a new deploy ALWAYS
// activates — so with the translator's 603 MB bucket off that list, every
// publish evicts the weights and every player re-downloads them. Proved here by
// running the worker source against a stub caches, not by matching a comment.
section("3e · THE TRANSLATOR'S WEIGHTS SURVIVE A PUBLISH (the owner's incremental rule)");
{
  const storageMod = await import(`${SITE}/src/game/pwa/storage.ts`);
  const swSrc = read("public/sw.js");
  check("the worker's keep-list names the storage module's own model bucket (the two cannot drift apart)",
    swSrc.includes(`const MODEL_CACHE = "${storageMod.MODEL_CACHE}";`) &&
      /const KEEP = \[SHELL_CACHE, ASSET_CACHE, MODEL_CACHE\]/.test(swSrc));
  check("activate still sweeps exactly what is NOT on that list",
    /names\.filter\(\(n\) => !KEEP\.includes\(n\)\)/.test(swSrc));
  const serveMod = await import(`${SITE}/serve.ts`);
  const A: any = runWorker(serveMod.stampBuildToken(swSrc, "aaaaaaaaaaaaaaaa"));
  check("the harness exposes the store the worker acts on (the survival proof needs the same store)",
    typeof A.cachesStore?.set === "function");
  const store = (A.cachesStore ?? new Map()) as Map<string, Map<string, unknown>>;
  store.set(storageMod.MODEL_CACHE, new Map([[modelCacheKey, mkRes("real bytes")]]));
  store.set("dse-shell-ancient", new Map([["/", mkRes("stale")]]));
  await A.lifecycle("activate");
  check("a publish does NOT evict the model cache — the 603 MB weights stay on the device",
    store.has(storageMod.MODEL_CACHE) && (store.get(storageMod.MODEL_CACHE)?.size ?? 0) === 1);
  check("while the previous build's SHELL cache is still swept away, as it must be",
    !store.has("dse-shell-ancient"));
  const w = await A.fire("GET", "/models/weights-v1.bin");
  check("the worker does not intercept the weights route (the loader owns that cache: a 206 cannot be cache.put)",
    w.responded === false);
}
// ================================================== §4 serve.ts, the seam
section("4 · THE BUILD ID AND THE HEADERS (serve.ts, no port bound)");
const serve = await import(`${SITE}/serve.ts`);
const BUILD = String(serve.BUILD);
check("the build id is content-derived and 16 hex chars", /^[0-9a-f]{16}$/.test(BUILD), BUILD);
// The token must live in the worker's CODE — a token that survived only in the
// prose would leave the shipped worker un-stamped and the app unable to update.
// There is exactly ONE, and both cache names are computed from it; the earlier
// version of this check claimed "twice" and counted the token in the header
// comment, so it was green for the wrong reason.
const swCode = swSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
check("the @@BUILD@@ token appears exactly once in the shipped worker's code (both cache names derive from it)",
  swCode.split("@@BUILD@@").length - 1 === 1, String(swCode.split("@@BUILD@@").length - 1));
const stamped = String(serve.stampBuildToken(swSrc));
check("stampBuildToken replaces EVERY @@BUILD@@ and leaves none behind",
  !stamped.includes("@@BUILD@@"));

// The cache names are COMPUTED at runtime from that constant (`dse-shell-${BUILD}`),
// so the literal `dse-shell-<build>` appears in no file on disk. The only honest way
// to prove the stamped worker caches under this build's names is to RUN it — which is
// what this suite does with the worker everywhere else.
const STAMPED = runWorker(stamped);
await STAMPED.lifecycle("install");
await STAMPED.fire("GET", "/assets/index-abc.js"); // the assets cache is created lazily
check("the stamped worker caches under THIS build's names — dse-shell-<build> and dse-assets-<build>",
  STAMPED.cacheNames().includes(`dse-shell-${BUILD}`) && STAMPED.cacheNames().includes(`dse-assets-${BUILD}`),
  STAMPED.cacheNames().join(" "));
{
  const OTHER = "0000000000000000";
  const other = runWorker(String(serve.stampBuildToken(swSrc, OTHER)));
  await other.lifecycle("install");
  await other.fire("GET", "/assets/index-abc.js");
  const otherNames = other.cacheNames();
  check("a different build id makes the worker cache under entirely different names (this is what makes an app update reach a player)",
    otherNames.includes(`dse-shell-${OTHER}`) && otherNames.includes(`dse-assets-${OTHER}`) &&
    otherNames.every((n) => !STAMPED.cacheNames().includes(n)),
    otherNames.join(" "));
}
const swHeaders = serve.cacheHeaders("/sw.js") as Record<string, string>;
check("sw.js is never cached (a stale worker is a stuck app)",
  /no-cache/.test(swHeaders["cache-control"] ?? "") && /no-store/.test(swHeaders["cache-control"] ?? ""), swHeaders["cache-control"]);
check("sw.js is served as javascript with the build id on the response",
  /javascript/.test(swHeaders["content-type"] ?? "") && swHeaders["x-deepspace-build"] === BUILD);
const mfHeaders = serve.cacheHeaders("/manifest.webmanifest") as Record<string, string>;
check("the manifest is application/manifest+json", /^application\/manifest\+json/.test(mfHeaders["content-type"] ?? ""), mfHeaders["content-type"]);
check("the manifest is revalidated, never frozen", /no-cache/.test(mfHeaders["cache-control"] ?? ""));
check("no download hint is attached to the manifest (the content-disposition bug)",
  !Object.keys(mfHeaders).some((h) => h.toLowerCase() === "content-disposition"));
check("fingerprinted assets are immutable for a year", /immutable/.test((serve.cacheHeaders("/assets/index-abc.js") as Record<string, string>)["cache-control"] ?? ""));
check("icons are NOT immutable — the designer replaces the art at the same paths",
  !/immutable/.test((serve.cacheHeaders("/icons/icon-192.png") as Record<string, string>)["cache-control"] ?? "") &&
  /max-age=86400/.test((serve.cacheHeaders("/icons/icon-192.png") as Record<string, string>)["cache-control"] ?? ""));

section("4a · WHAT THE SERVER ACTUALLY SENDS");
{
  const swRes = await serve.appFetch(new Request(`${ORIGIN}/sw.js`));
  const body = await swRes.text();
  check("GET /sw.js is 200", swRes.status === 200, String(swRes.status));
  check("the served worker has NO leftover token", !body.includes("@@BUILD@@"));
  check("the served worker carries this build id", body.includes(BUILD));
  check("the served worker is not cacheable", /no-store/.test(swRes.headers.get("cache-control") ?? ""));
  const mfRes = await serve.appFetch(new Request(`${ORIGIN}/manifest.webmanifest`));
  check("GET /manifest.webmanifest is 200 with the right media type",
    mfRes.status === 200 && /^application\/manifest\+json/.test(mfRes.headers.get("content-type") ?? ""),
    `${String(mfRes.status)} ${String(mfRes.headers.get("content-type"))}`);
  check("AND no content-disposition download hint (the bug must not come back)",
    mfRes.headers.get("content-disposition") === null, String(mfRes.headers.get("content-disposition")));
  const json = JSON.parse(await mfRes.text()) as { icons: unknown[]; display: string };
  check("the served manifest still parses as JSON with its icons and display mode",
    Array.isArray(json.icons) && json.display === "standalone");
  const iconRes = await serve.appFetch(new Request(`${ORIGIN}/icons/icon-192.png`));
  check("an icon is served as a real PNG", iconRes.status === 200 && iconRes.headers.get("content-type") === "image/png",
    `${String(iconRes.status)} ${String(iconRes.headers.get("content-type"))}`);
  const docRes = await serve.appFetch(new Request(`${ORIGIN}/`));
  const doc = await docRes.text();
  check("the landing document is server-rendered and links the manifest",
    docRes.status === 200 && /rel="?manifest"?/.test(doc), String(docRes.status));
  check("the document points the install affordance at the shell's stylesheet hooks (it renders)",
    doc.includes("Deepspace"));
}

// ================================================= §5 the standalone branch
section("5 · AN INSTALLED APP RENDERS NOTHING (the branch a player would notice)");
// TWO files, and the checks below need the right one:
//   • `game/pwa/install.ts` — the DECISION (imported and exercised as functions).
//   • `components/shell/InstallAffordance.tsx` — the SURFACE: the early return, the
//     diagnostics hook on <html>, the per-device dismissal. The source checks in
//     this block read the COMPONENT; they used to read the decision module, where
//     none of those three patterns exist, so all three failed on a component that
//     behaves correctly in a browser.
const affordanceSrc = read("src/components/shell/InstallAffordance.tsx");
const install = await import(`${SITE}/src/game/pwa/install.ts`);
const realWindow = (globalThis as any).window;
const realNavigator = (globalThis as any).navigator;
const withDisplayModes = (matches: Record<string, boolean>, iosStandalone = false) => {
  (globalThis as any).navigator = { standalone: iosStandalone, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" };
  (globalThis as any).window = {
    matchMedia: (q: string) => ({ matches: matches[q] === true, addEventListener() {}, removeEventListener() {} }),
    navigator: (globalThis as any).navigator,
  };
};
try {
  withDisplayModes({ "(display-mode: standalone)": true });
  check("isRunningStandalone() reads the real signal it keys off — matchMedia('(display-mode: standalone)')",
    install.isRunningStandalone() === true);
  withDisplayModes({ "(display-mode: fullscreen)": true });
  check("a fullscreen launch also counts as installed", install.isRunningStandalone() === true);
  withDisplayModes({ "(display-mode: minimal-ui)": true });
  check("a minimal-ui launch also counts as installed", install.isRunningStandalone() === true);
  withDisplayModes({}, true);
  check("iOS's own navigator.standalone flag counts as installed (display-mode is not honoured there)",
    install.isRunningStandalone() === true);
  withDisplayModes({});
  check("a plain browser tab is NOT installed", install.isRunningStandalone() === false);
} finally {
  (globalThis as any).window = realWindow;
  (globalThis as any).navigator = realNavigator;
}
check("an installed app beats a live install offer — `standalone` wins over `prompt`",
  install.installPath({ standalone: true, hasPrompt: true, userAgent: "Mozilla/5.0 (Linux; Android 14)" }) === "standalone");
check("and an installed app shows the affordance NOWHERE", install.showsInstall("standalone") === false);
check("no install path at all shows nothing either", install.showsInstall("unavailable") === false);
check("the two states that DO show something are prompt and ios",
  install.showsInstall("prompt") === true && install.showsInstall("ios") === true);
check("iOS is detected by platform, not by 'Safari' (every iOS browser installs the same way)",
  install.isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)") === true &&
  install.isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Mobile/15E148") === true &&
  install.isIos("Mozilla/5.0 (Linux; Android 14)") === false);
check("the server render (no user agent) falls through to 'unavailable', never to a button",
  install.installPath({ standalone: false, hasPrompt: false, userAgent: "" }) === "unavailable");
{
  // The component must bow out BEFORE it builds any surface — a `showsInstall`
  // check that ran after the JSX would still render a card.
  const guardAt = affordanceSrc.indexOf("if (!showsInstall(path)) return null;");
  const firstJsx = affordanceSrc.indexOf("const action = (");
  const firstRender = affordanceSrc.indexOf("<section");
  check("InstallAffordance returns null on !showsInstall BEFORE any JSX is built",
    guardAt > 0 && firstJsx > guardAt && firstRender > guardAt,
    `guard@${String(guardAt)} jsx@${String(firstJsx)}`);
  check("it writes data-install-path on <html> so 'it hid itself, and why' is measurable",
    affordanceSrc.includes("document.documentElement.dataset.installPath = path"));
  // Both mount sites, named: the card on the landing page (dismissible per device)
  // and the row in Settings, which stays after a dismissal so the door never closes.
  const landingSrc = read("src/routes/index.tsx");
  const settingsSrc = read("src/components/shell/SettingsSheet.tsx");
  check("the landing card can be dismissed per device, and the row in Settings still offers the door",
    install.INSTALL_DISMISS_KEY === "dse.install.v1" &&
    affordanceSrc.includes('variant === "card" && dismissed') &&
    landingSrc.includes('<InstallAffordance variant="card" />') &&
    settingsSrc.includes('<InstallAffordance variant="row" />'));
}
section("5a · THE DEVICE STORAGE SEAM THE TRANSLATOR LANDS IN (nothing downloaded here)");
const storage = await import(`${SITE}/src/game/pwa/storage.ts`);
const storageSrc = read("src/game/pwa/storage.ts");
check("a model gets its own versioned cache bucket, separate from the shell's",
  typeof storage.MODEL_CACHE === "string" && /^dse-model-v\d+$/.test(storage.MODEL_CACHE), storage.MODEL_CACHE);
check("the model slot is a named cache key", storage.modelCacheSlot().cacheName === storage.MODEL_CACHE);
check("storage PREDICTS, it does not download — no fetch, no model request in the module",
  !/\bfetch\s*\(/.test(storageSrc.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
check("with no navigator (the server render) it reports unsupported instead of throwing",
  (await storage.storageReport()).supported === false);
check("a size a player can read, in the same decimal units as the browser's own storage screen",
  storage.formatBytes(640 * 1000 * 1000) === "640 MB" && storage.formatBytes(603_000_000) === "603 MB" &&
  storage.formatBytes(null) === "—");
check("asking to be kept is per device, and the answer is the browser's real one",
  storage.PERSIST_ASKED_KEY === "dse.storage.v1" && storage.persistAlreadyAsked() === false);
const registerSrc = read("src/game/pwa/register.ts");
check("the worker is registered from the ROOT scope, so every route is inside its reach",
  registerSrc.includes('register(SW_PATH, { scope: "/" })') && registerSrc.includes('SW_PATH = "/sw.js"'));
check("registration is production-only (a dev worker would sit between a teammate and their edits)",
  registerSrc.includes("import.meta.env.PROD"));
check("a failed registration never breaks the game", /catch \{/.test(registerSrc));

// ================================================ §6 the 8 new strings, 5 langs
section("6 · THE NEW STRINGS EXIST IN ALL FIVE CATALOGUES");
const NEW_KEYS = ["device.title", "install.title", "install.body", "install.cta", "install.ios", "install.dismiss", "storage.title", "storage.line"] as const;
const LANGS = ["en", "es", "pt-BR", "ru", "fa"];
for (const lang of LANGS) {
  const mod = await import(`${SITE}/src/game/i18n/langs/${lang}.ts`);
  const cat = (mod.default ?? {}) as Record<string, string>;
  const missing = NEW_KEYS.filter((k) => typeof cat[k] !== "string" || cat[k].trim() === "");
  check(`${lang}: all 8 install.*/storage.*/device.* keys are translated`, missing.length === 0, missing.join(","));
  if (lang !== "en") {
    check(`${lang}: install.*/storage.*/device.* are not left in English (machine pass landed)`,
      cat["install.cta"] !== "Install" && cat["device.title"] !== "On this device");
  }
}
{
  const en = (await import(`${SITE}/src/game/i18n/langs/en.ts`)).default as Record<string, string>;
  const fa = (await import(`${SITE}/src/game/i18n/langs/fa.ts`)).default as Record<string, string>;
  const placeholders = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(",");
  check("storage.line keeps {used} and {quota} in en and fa alike",
    placeholders(en["storage.line"]!) === "{quota},{used}" && placeholders(fa["storage.line"]!) === "{quota},{used}",
    `${placeholders(en["storage.line"]!)} | ${placeholders(fa["storage.line"]!)}`);
  check("the install copy promises an app, not a limitation (no pay/limitation language)",
    !/\b(pro|premium|limited|upgrade)\b/i.test([en["install.body"], en["install.title"], en["install.cta"]].join(" ")));
}

// ============================================================== the tally
console.log(`\n${pass}/${pass + fail} checks passed${fail ? ` — ${String(fail)} FAILED` : ""}`);
console.log(`sha256(sw.js source) = ${createHash("sha256").update(swSrc).digest("hex").slice(0, 16)}`);
process.exit(fail === 0 ? 0 : 1);
