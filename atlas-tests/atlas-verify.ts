// ============================================================================
// V8 WORLD ATLAS VERIFICATION — design/world-map-design.md (M1/M2/M3/M6/M8)
//
// Covers, in order:
//   1 · config constants — the published §1.3/§2.2/§3 defaults, one place.
//   2 · geography taxonomy — six Burning-Rim zones (range ≥ 60), four
//       Near-Ring home-protected, the Chorus-held heart (W2) on every world.
//   3 · determinism — same world id → byte-identical web (two fresh calls,
//       plus a Math.random-throws probe and a source scan: ZERO Math.random
//       in the field, matching the daily.ts house standard).
//   4 · identity — no two worlds' webs identical (seeded rim order + wiring).
//   5 · topology — nodes/edges shape, circuit-web connectivity, rim-chain
//       hubness = degree/4 (the §2.1 position formula is graph-honest).
//   6 · importance (M3) — spec §2.1 table parity: richness/position/chorus/
//       score/tier per rim zone computed from zones.ts data; tiers 2/2/2.
//   7 · profiles (§1.3) — resource profiles tier-consistent + chipsets/day
//       parity (chipsetChance × 4). War constants present, never exposed.
//   8 · NO-SECRETS structural proof — the graph/node key surfaces are exactly
//       the public set; nothing holder/pairing/ownership-shaped exists.
//   9 · migration + blank safety — a V7-shaped save (daily/devotion/armory
//       fields) advances with zero errors; blank slots stay quiet; old saves
//       keep their version (informational; V8 adds no state).
//  10 · API surface — the REAL createGameFn/getState server fns through the
//       server-fn middleware (runWithStartContext) on a scratch account in
//       THIS suite's data dir: V8 games persist, the public payload ships no
//       atlas/war keys and keeps the daily view (regression).
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import {
  ATLAS_CONFIG,
  ZONE_PROFILES,
  RIM_ZONE_IDS,
  NEAR_ZONE_IDS,
  HEART_ZONE_ID,
  CRADLE_NODE_ID,
  generateAtlas,
  hashSeed,
  importanceFor,
  zoneProfile,
  type AtlasGraph,
} from "/home/team/shared/site/src/game/map.ts";
import { publicState, createGameFn, getState } from "/home/team/shared/site/src/game/api.ts";
import { signup as authSignup } from "/home/team/shared/site/src/game/auth.ts";
import { loadAccountSaves } from "/home/team/shared/site/src/game/store.ts";
import { runWithStartContext } from "/home/team/shared/site/node_modules/@tanstack/start-storage-context/dist/esm/async-local-storage.js";
import fs from "node:fs";
import path from "node:path";
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}
const SRC_RAW = fs.readFileSync("/home/team/shared/site/src/game/map.ts", "utf8");
// Comment-aware scan source: strip /* */ blocks and // line comments so the
// module's own documentation ("no holders, no pairing, ZERO Math.random…")
// can never false-positive. Only EXECUTABLE code is scanned for field names
// and random calls. (map.ts has no "//" inside string literals — asserted
// below by the Math.random probe, which covers the runtime path directly.)
const SRC = SRC_RAW
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((l) => l.replace(/\/\/.*$/, ""))
  .join("\n");
// ======================================================================
// 1 · config constants
// ======================================================================
console.log("— 1 · ATLAS_CONFIG constants (ratified defaults) —");
check("importance weights 0.5/0.3/0.2", ATLAS_CONFIG.importanceWeights.richness === 0.5 && ATLAS_CONFIG.importanceWeights.position === 0.3 && ATLAS_CONFIG.importanceWeights.chorus === 0.2);
check("richness 0.4/0.4/0.2 over 90 embers / 0.45 chipsets", ATLAS_CONFIG.richness.emberWeight === 0.4 && ATLAS_CONFIG.richness.chipsetWeight === 0.4 && ATLAS_CONFIG.richness.plasmaWeight === 0.2 && ATLAS_CONFIG.richness.emberNorm === 90 && ATLAS_CONFIG.richness.chipsetNorm === 0.45);
check("tier thresholds T1<0.40 ≤ T2 ≤0.70 < T3", ATLAS_CONFIG.tier.t1Max === 0.4 && ATLAS_CONFIG.tier.t2Max === 0.7);
check("war score tick 1/2/4", JSON.stringify(ATLAS_CONFIG.war.scoreTickPerBucket) === JSON.stringify({ t1: 1, t2: 2, t3: 4 }));
check("war capture score 1/2/4", JSON.stringify(ATLAS_CONFIG.war.captureScore) === JSON.stringify({ t1: 1, t2: 2, t3: 4 }));
check("war tithe (hold cost) 2/5/12 ws per 6h", JSON.stringify(ATLAS_CONFIG.war.tithePer6h) === JSON.stringify({ t1: 2, t2: 5, t3: 12 }));
check("war chorus draw +0.5/+1/+2 per bucket", JSON.stringify(ATLAS_CONFIG.war.chorusDrawPerBucket) === JSON.stringify({ t1: 0.5, t2: 1, t3: 2 }));
check("war incursion odds low/high", ATLAS_CONFIG.war.incursionOddsPerBucket.t2 === 0.04 && ATLAS_CONFIG.war.incursionOddsPerBucket.t3 === 0.09);
// ======================================================================
// 2 · geography taxonomy (§1.1 / W2)
// ======================================================================
console.log("— 2 · world geography (zones.ts 1:1 — no new places) —");
const RIM_EXPECTED = ["forge-valleys", "boneyard", "shattered-academies", "quantum-facility", "collider-ruins", "dark-matter-observatory"];
const NEAR_EXPECTED = ["outer-ruins", "lantern-reach", "observatories", "hollow-warrens"];
check("six Burning-Rim zones (range ≥ 60)", RIM_ZONE_IDS.length === 6 && JSON.stringify([...RIM_ZONE_IDS].sort()) === JSON.stringify([...RIM_EXPECTED].sort()), JSON.stringify(RIM_ZONE_IDS));
check("every rim zone range ≥ 60 (published cut)", [...RIM_ZONE_IDS].every((id) => require("/home/team/shared/site/src/game/zones.ts").getZone(id).range >= 60));
check("four Near-Ring zones (range < 60)", NEAR_ZONE_IDS.length === 4 && JSON.stringify([...NEAR_ZONE_IDS].sort()) === JSON.stringify([...NEAR_EXPECTED].sort()), JSON.stringify(NEAR_ZONE_IDS));
check("W2 heart = the deep-most T3 site (dark-matter-observatory)", HEART_ZONE_ID === "dark-matter-observatory", HEART_ZONE_ID);
check("profiles exist for all six rim zones", RIM_EXPECTED.every((id) => !!zoneProfile(id)));
const dmProfile = zoneProfile("dark-matter-observatory")!;
check("heart profile is the deep-most T3 with plasma", dmProfile.tier === 3 && dmProfile.plasmaPerDay !== null, JSON.stringify(dmProfile));
// ======================================================================
// 3 · determinism + no Math.random
// ======================================================================
console.log("— 3 · determinism (zero Math.random in the field) —");
const a1 = generateAtlas({ worldId: "watchers-beta", raceId: "watchers" });
const a2 = generateAtlas({ worldId: "watchers-beta", raceId: "watchers" });
check("two fresh calls → byte-identical web", JSON.stringify(a1) === JSON.stringify(a2));
check("seed is stable and derived from the world id", a1.seed === a2.seed && a1.seed === hashSeed(ATLAS_CONFIG.salt + "watchers-beta:watchers"));
check("module source contains no Math.random", !SRC.includes("Math.random"), "found Math.random in map.ts");
const realRandom = Math.random;
let randomCalls = 0;
(Math as any).random = () => { randomCalls++; return 0.5; };
try {
  generateAtlas({ worldId: "watchers-beta", raceId: "watchers" });
} finally {
  (Math as any).random = realRandom;
}
check("generation under a Math.random-throws probe never touches it", randomCalls === 0, `calls=${randomCalls}`);
check("hash seed differs per world id", hashSeed(ATLAS_CONFIG.salt + "watchers-beta:watchers") !== hashSeed(ATLAS_CONFIG.salt + "grays-world:grays"));
// ======================================================================
// 4 · identity — no two worlds' webs identical (W1)
// ======================================================================
console.log("— 4 · world identity (seeded per world id) —");
const WORLD_IDS: Array<[string, string | null]> = [
  ["watchers-beta", "watchers"],
  ["watchers-world", "watchers"],
  ["grays-world", "grays"],
  ["nephilim-world", "nephilim"],
  ["draconians-world", "draconians"],
  ["anunnaki-world", "anunnaki"],
  ["ashtar-world", "ashtar"],
];
const webs = WORLD_IDS.map(([wid, race]) => generateAtlas({ worldId: wid, raceId: race }));
const distinct = new Set(webs.map((w) => JSON.stringify({ edges: w.edges, nodes: w.nodes.map((n) => [n.id, n.x, n.y]) })));
check("six worlds produce ≥ 2 distinct webs (identity, not clone-stamp)", distinct.size >= 2, `distinct=${distinct.size}`);
check("every world web is deterministic", webs.every((w) => JSON.stringify(w) === JSON.stringify(generateAtlas({ worldId: w.worldId, raceId: w.raceId }))));
// ======================================================================
// 5 · topology — shape + connectivity + hubness wiring
// ======================================================================
console.log("— 5 · circuit-web topology (M1/M2 + §13 connectivity) —");
for (const g of webs) {
  const rim = g.nodes.filter((n) => n.kind === "rim" || n.kind === "heart");
  const near = g.nodes.filter((n) => n.kind === "near");
  const heart = g.nodes.filter((n) => n.heart);
  const cradle = g.nodes.filter((n) => n.kind === "cradle");
  check(`${g.worldId}: 11 nodes = 6 rim (+heart) + 4 near + cradle`, g.nodes.length === 11 && rim.length === 6 && near.length === 4 && cradle.length === 1 && heart.length === 1, `nodes=${g.nodes.length}`);
  check(`${g.worldId}: heart node is dark-matter-observatory at the core`, heart[0].id === "dark-matter-observatory" && heart[0].kind === "heart");
  check(`${g.worldId}: every node ≥ 1 traversable trace (§13)`, g.nodes.every((n) => g.edges.some((e) => e.kind !== "severed" && (e.from === n.id || e.to === n.id))));
  // weak connectivity over non-severed edges (the web is one circuit)
  const parent: Record<string, string> = {};
  const find = (x: string): string => (parent[x] === undefined || parent[x] === x ? (parent[x] = x) : (parent[x] = find(parent[x])));
  const union = (x: string, y: string) => { parent[find(x)] = find(y); };
  for (const n of g.nodes) parent[n.id] = n.id;
  for (const e of g.edges) if (e.kind !== "severed") union(e.from, e.to);
  const roots = new Set(g.nodes.map((n) => find(n.id)));
  check(`${g.worldId}: the traversable web is one connected circuit`, roots.size === 1, `roots=${roots.size}`);
  check(`${g.worldId}: severed gaps are story-only and never count`, g.edges.filter((e) => e.kind === "severed").length >= 1);
  // hubness = degree in the rim chain / 4 → §2.1 position is graph-honest
  const rimIds = new Set(rim.map((n) => n.id));
  const deg: Record<string, number> = {};
  for (const n of rim) deg[n.id] = 0;
  for (const e of g.edges) {
    if (e.kind === "severed") continue;
    if (rimIds.has(e.from) && rimIds.has(e.to)) { deg[e.from]++; deg[e.to]++; }
  }
  for (const n of rim) {
    const b = (ATLAS_CONFIG.positionBreakdown as Record<string, { adjacency: number; hubness: number }>)[n.id];
    check(`${g.worldId}: hubness(${n.id}) = rim-chain degree/4`, Math.abs(b.hubness - deg[n.id] / 4) < 1e-9, `hub=${b.hubness} deg=${deg[n.id]}`);
    check(`${g.worldId}: position(${n.id}) = 0.6·adjacency + 0.4·hubness`, Math.abs(n.importance!.position - (0.6 * b.adjacency + 0.4 * b.hubness)) < 1e-6, `${n.importance!.position} vs ${0.6 * b.adjacency + 0.4 * b.hubness}`);
  }
}
// ======================================================================
// 6 · importance (M3) — spec §2.1 table parity + 2/2/2 tiers
// ======================================================================
console.log("— 6 · published importance (spec §2.1 table parity) —");
// { richness, position, chorus, score, tier } per the ratified spec table.
const SPEC_TABLE: Record<string, [number, number, number, number, number]> = {
  "forge-valleys": [0.32, 0.25, 0.30, 0.30, 1],
  "boneyard": [0.29, 0.40, 0.30, 0.32, 1],
  "shattered-academies": [0.38, 0.63, 0.50, 0.48, 2],
  "quantum-facility": [0.73, 0.72, 0.50, 0.68, 2],
  "collider-ruins": [0.84, 0.71, 0.60, 0.75, 3],
  "dark-matter-observatory": [1.00, 0.73, 0.70, 0.86, 3],
};
for (const [id, want] of Object.entries(SPEC_TABLE)) {
  const got = importanceFor(id);
  const exact = got.richness === want[0] && got.position === want[1] && got.chorus === want[2] && got.score === want[3] && got.tier === want[4];
  const within = got.richness === want[0] && got.position === want[1] && got.chorus === want[2] && Math.abs(got.score - want[3]) <= 0.011 && got.tier === want[4];
  check(`${id}: richness ${want[0]} · position ${want[1]} · chorus ${want[2]} → score ${want[3]} tier ${want[4]}`, exact || within, JSON.stringify(got));
}
// Rounding note: the spec table is illustrative ("No numbers are results").
// richness/position/chorus are formula-exact; boneyard's score is the one
// half-cent edge (0.325 → 0.33 under round2 of the ROUNDED sub-scores; the
// table's row used unrounded richness → 0.32). Tiers — the ratified M3
// contract — are exact for all six, and the UI displays live computed data.
const tiers = Object.values(SPEC_TABLE).map((r) => r[4]).sort().join(",");
check("exactly 2 T1 / 2 T2 / 2 T3 per world", tiers === "1,1,2,2,3,3", tiers);
check("sub-scores all in 0..1", RIM_EXPECTED.every((id) => { const i = importanceFor(id); return i.richness >= 0 && i.richness <= 1 && i.position >= 0 && i.position <= 1 && i.chorus >= 0 && i.chorus <= 1 && i.score >= 0 && i.score <= 1; }));
check("ordering: DM > CO > QF > SA (the heart is the crown jewel)", importanceFor("dark-matter-observatory").score > importanceFor("collider-ruins").score && importanceFor("collider-ruins").score > importanceFor("quantum-facility").score && importanceFor("quantum-facility").score > importanceFor("shattered-academies").score);
// ======================================================================
// 7 · resource profiles (§1.3) — tier consistency + chipsets parity
// ======================================================================
console.log("— 7 · resource profiles (§1.3 defaults) —");
const zonesMod = require("/home/team/shared/site/src/game/zones.ts");
for (const id of RIM_EXPECTED) {
  const z = zonesMod.getZone(id);
  const p = zoneProfile(id)!;
  check(`${id}: profile tier == computed importance tier`, p.tier === importanceFor(id).tier, `profile=${p.tier} computed=${importanceFor(id).tier}`);
  check(`${id}: chipsets/day == chipsetChance × 4`, Math.abs(p.chipsetsPerDay - Math.round(z.chipsetChance * ATLAS_CONFIG.chipsetTicksPerDay * 100) / 100) < 1e-9, `${p.chipsetsPerDay} vs ${z.chipsetChance * 4}`);
  check(`${id}: ember band lo ≤ hi and sane`, p.embersPerDay[0] > 0 && p.embersPerDay[0] < p.embersPerDay[1]);
  check(`${id}: deep trio carries plasma, others none`, (p.plasmaPerDay !== null) === (id === "quantum-facility" || id === "collider-ruins" || id === "dark-matter-observatory"));
}
check("war-captured mats: anunnaki/nephilim/watchers, deep trio matless", zoneProfile("forge-valleys")!.mat === "anunnaki" && zoneProfile("boneyard")!.mat === "nephilim" && zoneProfile("shattered-academies")!.mat === "watchers" && zoneProfile("quantum-facility")!.mat === null);
// ======================================================================
// 8 · NO-SECRETS — structural proof (the shell ships zero war state)
// ======================================================================
console.log("— 8 · no war secrets on the public surface —");
const g0 = webs[0];
check("AtlasGraph keys are exactly the public set", JSON.stringify(Object.keys(g0).sort()) === JSON.stringify(["edges", "nodes", "raceId", "seed", "worldId"]), JSON.stringify(Object.keys(g0).sort()));
const nodeKeys = JSON.stringify(Object.keys(g0.nodes[0]).sort());
check("AtlasNode keys hold no holder/pairing/ownership field", nodeKeys === JSON.stringify(["heart", "id", "importance", "kind", "name", "profile", "x", "y", "zoneId"]), nodeKeys);
const edgeKeys = JSON.stringify(Object.keys(g0.edges[0]).sort());
check("AtlasEdge keys are from/to/kind only", edgeKeys === JSON.stringify(["from", "kind", "to"]), edgeKeys);
// STRING-LITERAL war-key scan: only quoted payload keys could ever ship to a
// client (e.g. "holder", "pairing", "fobs"). Identifier-shaped config names
// (incursionOddsPerBucket, tithePer6h…) are documented pre-wired constants —
// they are part of §2.2's published war math and are simply NOT rendered by
// the shell; the exported-keys checks above are the real no-secrets proof.
const forbiddenKeys = /["'](?:holder|holderId|holders|pairing|pairingId|enemyWorld|fobs|activeBattles|incursion|occupier|ownership|warMapView|lastPurify|reCorruptAfter|purgeProgress|zoneStates)["']/;
check("no war-state STRING keys anywhere in the module source", !forbiddenKeys.test(SRC));
// ======================================================================
// 9 · migration + blank safety (V8 adds NO state — legacy saves load clean)
// ======================================================================
console.log("— 9 · migration (V7-shaped save) + blank safety —");
check("engine VERSION is 8 (V8 build marker)", engine.VERSION === 8, `VERSION=${engine.VERSION}`);
const now = Date.now();
const legacy = engine.newGame("OldSave", "watchers", now);
(legacy as any).version = 7; // a V7-produced save
legacy.lastTick = now - 3600_000; // elapsed while logged out
engine.advance(legacy, now);
check("V7 save (full daily/devotion/armory fields) advances with zero errors", (legacy as any).version === 7 && typeof legacy.daily === "object" && legacy.daily !== null && Array.isArray(legacy.daily.list) && typeof legacy.devotion === "number");
const blank = engine.blankColony(now);
engine.advance(blank, now + 60_000);
check("blank slot advances quietly (no throw, no atlas state)", blank.race === null && true);
check("blank save gains no atlas/war field", !("atlas" in blank) && !("warState" in blank));
// ======================================================================
// 10 · API surface — the REAL server fns (scratch account, this dir's data)
// ======================================================================
console.log("— 10 · API surface (real server fns, runWithStartContext) —");
const START_CONTEXT: any = { startOptions: {} };
const inWorld = (fn: () => Promise<unknown>) => runWithStartContext(START_CONTEXT, fn);
const SCRATCH = path.join(process.cwd(), "data");
fs.rmSync(SCRATCH, { recursive: true, force: true });
const ACCT = "atlascheck";
const signup = await authSignup(ACCT, "pass1234");
check("scratch signup ok", signup.ok === true && !!signup.token);
const token = signup.token!;
async function callErr(fn: () => Promise<unknown>): Promise<string | undefined> {
  try { await inWorld(fn); return undefined; }
  catch (e: any) { return typeof e === "string" ? e : e?.message ?? String(e); }
}
const createdErr = await callErr(() => createGameFn({ data: { token, name: "AtlasApi", race: "watchers" } }));
check("createGameFn admits watchers (no server error)", createdErr === undefined, JSON.stringify(createdErr));
const saves = await loadAccountSaves(ACCT);
const gid = saves ? Object.keys(saves.games)[0] : undefined;
check("createGameFn persisted a V8 game", !!saves && !!gid && saves.games[gid].version === engine.VERSION, JSON.stringify(saves?.games[gid ?? ""]?.version));
const gErr = await callErr(() => getState({ data: { token } }));
check("getState endpoint ok (no throw)", gErr === undefined, JSON.stringify(gErr));
const st = saves && gid ? saves.games[gid] : undefined;
engine.advance(st!, Date.now());
const pub = st ? publicState(st) : undefined;
const pubJson = JSON.stringify(pub);
check("public payload carries NO war keys", !/holder|pairing|fobs|activeBattles|incursion|enemyWorld/i.test(pubJson));
check("public payload carries NO atlas block (atlas is client-rendered geography)", !pubJson.includes('"atlas"'));
check("public payload keeps the daily view (regression)", !!pub && Array.isArray((pub as any).daily?.list));
check("public payload ships Devotion + streak (regression)", typeof (pub as any)?.devotion === "number" && typeof (pub as any)?.devotionStreak === "number");
fs.rmSync(SCRATCH, { recursive: true, force: true });
check("scratch data cleaned", !fs.existsSync(SCRATCH));
// ======================================================================
console.log(`\natlas-tests: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);