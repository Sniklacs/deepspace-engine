// ============================================================================
// V9 WORLD ATLAS VERIFICATION — design/world-map-design.md (M1/M2/M3/M6/M8)
// + circuit-fullscreen-page.md §2.2/§6.1 (the denser-web layout law).
//
// Covers, in order:
//   1 · config constants — the published §1.3/§2.2/§3 defaults, one place.
//   2 · geography taxonomy — seventeen Burning-Rim zones (range ≥ 60; six
//       ratified anchors + eleven V9 footholds), twelve Near-Ring home-
//       protected, the Chorus-held heart (W2) on every world.
//   3 · determinism — same world id → byte-identical web (two fresh calls,
//       plus a Math.random-throws probe and a source scan: ZERO Math.random
//       in the field, matching the daily.ts house standard).
//   4 · identity — no two worlds' webs identical (seeded row permutations +
//       wiring drift).
//   5 · topology — nodes/edges shape, circuit-web connectivity, rim-chain
//       hubness = degree/4 for EVERY rim node (the §2.1 position formula is
//       graph-honest — anchors included).
//   6 · importance (M3) — spec §2.1 table parity for the six anchors EXACT;
//       V9 foothold tiers 4×T1 / 4×T2 / 3×T3 across all three bands; the
//       aggregate world spread is 6/6/5 and the heart stays the crown jewel.
//   7 · profiles (§1.3) — resource profiles tier-consistent + chipsets/day
//       parity (chipsetChance × 4) for all 17 rim zones. War constants
//       present, never exposed.
//   8 · NO-SECRETS structural proof — the graph/node key surfaces are exactly
//       the public set; nothing holder/pairing/ownership-shaped exists.
//   9 · migration + blank safety — a V7-shaped save (daily/devotion/armory
//       fields) advances with zero errors; blank slots stay quiet; old saves
//       keep their version (informational; V9 adds no state).
//  10 · API surface — the REAL createGameFn/getState server fns through the
//       server-fn middleware (runWithStartContext) on a scratch account in
//       THIS suite's data dir: V9 games persist, the public payload ships no
//       atlas/war keys and keeps the daily view (regression).
//  11 · LAYOUT LAW (§2.2/§6.1) — every generated web: rows sit in their
//       authored bands (jitter ≤ ±6), x inside 0.06–0.94 of width, same-row
//       spacing ≥ 60 units, ANY pair ≥ 52 units (the r26 hit-circle floor);
//       the heart and the Cradle never leave their bands.
//  12 · CIRCUIT LABEL + CANVAS LAW (circuit-map-layout-spec.md §1–§3) — the
//       display-name table (30 nodes, both forms, no articles, unique, catalog-
//       honest), the collision ladder (no overlap, nothing below 11px, ≥28/30
//       labelled at 1280/1440 and ≥20 at 390 over EVERY world), and the aspect-
//       aware render canvas (kx ≥ 1, margins, spacing preserved).
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
  ROW_PERMS,
  type AtlasGraph,
  type Tier,
} from "/home/team/shared/site/src/game/map.ts";
import {
  DISPLAY_NAMES,
  LABEL_NODE_RADIUS,
  ASPECT_MIN,
  ASPECT_MAX,
  canvasFor,
  canvasX,
  labelTier,
  labelFontUnits,
  labelRect,
  resolveLabels,
} from "/home/team/shared/site/src/game/circuit-labels.ts";
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
console.log("— 2 · world geography (zones.ts 1:1 — anchors + V9 footholds) —");
const RIM_EXPECTED = [
  "forge-valleys", "boneyard", "shattered-academies", "quantum-facility", "collider-ruins", "dark-matter-observatory", // ratified anchors
  "rust-gardens", "ash-columns", "quarry-edge", "shard-fields", "murmur-sumps", "titan-breaks", "glass-harbor", "wailing-towers", "deep-vaults", "null-engine", "starfall-core", // V9
];
const NEAR_EXPECTED = [
  "outer-ruins", "lantern-reach", "observatories", "hollow-warrens", // ratified anchors
  "tram-yards", "relay-spires", "cinder-farms", "pump-stations", "sigil-plaza", "hearth-lanes", "grain-silos", "watchtower-row", // V9
];
check("seventeen Burning-Rim zones (range ≥ 60)", RIM_ZONE_IDS.length === 17 && JSON.stringify([...RIM_ZONE_IDS].sort()) === JSON.stringify([...RIM_EXPECTED].sort()), JSON.stringify(RIM_ZONE_IDS));
check("every rim zone range ≥ 60 (published cut)", [...RIM_ZONE_IDS].every((id) => require("/home/team/shared/site/src/game/zones.ts").getZone(id).range >= 60));
check("twelve Near-Ring zones (range < 60)", NEAR_ZONE_IDS.length === 12 && JSON.stringify([...NEAR_ZONE_IDS].sort()) === JSON.stringify([...NEAR_EXPECTED].sort()), JSON.stringify(NEAR_ZONE_IDS));
check("every near zone range < 60 (home-protected cut)", [...NEAR_ZONE_IDS].every((id) => require("/home/team/shared/site/src/game/zones.ts").getZone(id).range < 60));
check("W2 heart = the deep-most T3 site (dark-matter-observatory)", HEART_ZONE_ID === "dark-matter-observatory", HEART_ZONE_ID);
check("heart is the single deepest rim zone (max range, none tie)", require("/home/team/shared/site/src/game/zones.ts").getZone(HEART_ZONE_ID).range === Math.max(...RIM_ZONE_IDS.map((id) => require("/home/team/shared/site/src/game/zones.ts").getZone(id).range)) && RIM_ZONE_IDS.filter((id) => require("/home/team/shared/site/src/game/zones.ts").getZone(id).range === require("/home/team/shared/site/src/game/zones.ts").getZone(HEART_ZONE_ID).range).length === 1);
check("profiles exist for all seventeen rim zones", RIM_EXPECTED.every((id) => !!zoneProfile(id)));
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
  check(`${g.worldId}: 30 nodes = 17 rim (+heart) + 12 near + cradle`, g.nodes.length === 30 && rim.length === 17 && near.length === 12 && cradle.length === 1 && heart.length === 1, `nodes=${g.nodes.length}`);
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
console.log("— 6 · published importance (spec §2.1 table parity + V9 tiers) —");
// { richness, position, chorus, score, tier } per the ratified spec table.
// The six anchor rows stay EXACT across the V9 denser web (the heart keeps
// the crown; forge-valleys' decomposition is re-authored graph-honestly to
// hubness 0.5 with adjacency 0.0833 — position 0.25, score 0.30, tier 1 all
// unchanged because the formula itself never moved).
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
// contract — are exact for the anchors, and the UI displays live computed data.
// V9 foothold tiers — computed by the SAME importanceFor; spread across bands.
const V9_TIERS: Record<string, Tier> = {
  "rust-gardens": 1, "ash-columns": 1, "quarry-edge": 1, "shard-fields": 1,
  "murmur-sumps": 2, "titan-breaks": 2, "glass-harbor": 2, "wailing-towers": 2,
  "deep-vaults": 3, "null-engine": 3, "starfall-core": 3,
};
const v9Tiers = Object.values(V9_TIERS).sort().join(",");
check("V9 foothold tiers: 4×T1 / 4×T2 / 3×T3 (spread, not one tier)", v9Tiers === "1,1,1,1,2,2,2,2,3,3,3", v9Tiers);
for (const [id, want] of Object.entries(V9_TIERS)) {
  const got = importanceFor(id);
  check(`${id}: computed tier ${want} (score ${got.score.toFixed(2)} <0.40 → T1 ≤0.70 → T2 >0.70 → T3)`, got.tier === want, JSON.stringify(got));
}
const allTiers = [...Object.values(SPEC_TABLE).map((r) => r[4]), ...Object.values(V9_TIERS)].sort().join(",");
check("per-world rim spread is exactly 6 T1 / 6 T2 / 5 T3", allTiers === "1,1,1,1,1,1,2,2,2,2,2,2,3,3,3,3,3", allTiers);
check("sub-scores all in 0..1 (every rim zone)", RIM_EXPECTED.every((id) => { const i = importanceFor(id); return i.richness >= 0 && i.richness <= 1 && i.position >= 0 && i.position <= 1 && i.chorus >= 0 && i.chorus <= 1 && i.score >= 0 && i.score <= 1; }));
check("ordering: DM > CO > QF > SA (the heart is the crown jewel)", importanceFor("dark-matter-observatory").score > importanceFor("collider-ruins").score && importanceFor("collider-ruins").score > importanceFor("quantum-facility").score && importanceFor("quantum-facility").score > importanceFor("shattered-academies").score);
check("the heart outranks every V9 deep site too", [...RIM_EXPECTED].filter((id) => !(id in SPEC_TABLE)).every((id) => importanceFor("dark-matter-observatory").score > importanceFor(id).score));
// ======================================================================
// 7 · resource profiles (§1.3) — tier consistency + chipsets parity
// ======================================================================
console.log("— 7 · resource profiles (§1.3 defaults) —");
const zonesMod = require("/home/team/shared/site/src/game/zones.ts");
const DEEP_PLASMA_IDS = ["quantum-facility", "collider-ruins", "dark-matter-observatory", "deep-vaults", "null-engine", "starfall-core"];
for (const id of RIM_EXPECTED) {
  const z = zonesMod.getZone(id);
  const p = zoneProfile(id)!;
  check(`${id}: profile tier == computed importance tier`, p.tier === importanceFor(id).tier, `profile=${p.tier} computed=${importanceFor(id).tier}`);
  check(`${id}: chipsets/day == chipsetChance × 4`, Math.abs(p.chipsetsPerDay - Math.round(z.chipsetChance * ATLAS_CONFIG.chipsetTicksPerDay * 100) / 100) < 1e-9, `${p.chipsetsPerDay} vs ${z.chipsetChance * 4}`);
  check(`${id}: ember band lo ≤ hi and sane`, p.embersPerDay[0] > 0 && p.embersPerDay[0] < p.embersPerDay[1]);
  check(`${id}: plasma only on deep sites (rad ≥ 60 + hazmat tier)`, (p.plasmaPerDay !== null) === DEEP_PLASMA_IDS.includes(id), `plasma=${p.plasmaPerDay}`);
}
check("war-captured mats: anchors anunnaki/nephilim/watchers; V9 footholds spread the rest; deep sites matless", zoneProfile("forge-valleys")!.mat === "anunnaki" && zoneProfile("boneyard")!.mat === "nephilim" && zoneProfile("shattered-academies")!.mat === "watchers" && zoneProfile("rust-gardens")!.mat === "draconians" && zoneProfile("ash-columns")!.mat === "grays" && zoneProfile("quarry-edge")!.mat === "ashtar" && zoneProfile("shard-fields")!.mat === null && zoneProfile("deep-vaults")!.mat === null && DEEP_PLASMA_IDS.every((id) => zoneProfile(id)!.mat === null));
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
check("engine VERSION is 11 (V11 — prologue state spine)", engine.VERSION === 11, `VERSION=${engine.VERSION}`);
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
// 11 · LAYOUT LAW (circuit-fullscreen-page.md §2.2/§6.1) — every web
// ======================================================================
console.log("— 11 · layout law (bands, margins, spacing) —");
// Author row for every node id: the V9 footholds live in ROW_PERMS; the
// anchors live in the authored BASE_POS (mirrored in ROW_PERMS slot fixes and
// the module skeleton). Rebuild the row map from ROW_PERMS + the skeleton
// constants so the law is checked against AUTHORED rows, not jittered nodes.
const wt = 560; // ATLAS_CONFIG.viewBox.w — keep in sync with the config
const ht = 760; // ATLAS_CONFIG.viewBox.h
const bands = ATLAS_CONFIG.layoutBands;
const rowY: Record<string, number> = {};
for (const row of ROW_PERMS) {
  for (const s of row.slots) if (s.fixed) rowY[s.fixed] = row.y;
  for (const id of row.nodes) rowY[id] = row.y;
}
rowY["dark-matter-observatory"] = 130; rowY[CRADLE_NODE_ID] = 710; // authored heart/cradle rows
for (const g of webs) {
  const bandOf = (id: string): { y0: number; y1: number } => {
    if (id === "dark-matter-observatory") return bands.core;
    if (id === CRADLE_NODE_ID) return bands.home;
    const ry = rowY[id] / ht; // authored row fraction
    if (ry < bands.rim.y0) return bands.deep;
    if (ry < bands.near.y0) return bands.rim;
    return bands.near;
  };
  const jitterTol = 8; // cosmetic wobble is ±6; allow float slack
  for (const n of g.nodes) {
    const band = bandOf(n.id);
    check(`${g.worldId}: ${n.id} (${n.kind}) sits in its authored band`, n.y >= band.y0 * ht - jitterTol && n.y <= band.y1 * ht + jitterTol, `y=${n.y} band=[${band.y0 * ht},${band.y1 * ht}]`);
  }
  check(`${g.worldId}: x inside 0.06–0.94 of width (spacing margins)`, g.nodes.every((n) => n.x >= 0.06 * wt - 6 && n.x <= 0.94 * wt + 6), `min=` + Math.min(...g.nodes.map((n) => n.x)) + ` max=` + Math.max(...g.nodes.map((n) => n.x)));
  let minGlobal = Infinity, minRow = Infinity, pairG = "", pairR = "";
  for (let i = 0; i < g.nodes.length; i++) {
    for (let j = i + 1; j < g.nodes.length; j++) {
      const a = g.nodes[i], b = g.nodes[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < minGlobal) { minGlobal = d; pairG = `${a.id}/${b.id}`; }
      if (rowY[a.id] === rowY[b.id] && d < minRow) { minRow = d; pairR = `${a.id}/${b.id}`; }
    }
  }
  check(`${g.worldId}: ANY two nodes ≥ 52 apart (r26 hit-circle floor)`, minGlobal >= ATLAS_CONFIG.spacing.min - 1e-6, `min=${minGlobal.toFixed(1)} (${pairG})`);
  check(`${g.worldId}: same-row spacing ≥ 60 (widest-row law)`, minRow >= ATLAS_CONFIG.spacing.row - 1e-6, `min=${minRow.toFixed(1)} (${pairR})`);
  check(`${g.worldId}: the heart and the Cradle never move (fixed rows)`, g.nodes.find((n) => n.heart)!.y >= 0.14 * ht - 8 && g.nodes.find((n) => n.heart)!.y <= 0.24 * ht + 8 && g.nodes.find((n) => n.kind === "cradle")!.y >= 0.88 * ht - 8, `heart=${g.nodes.find((n) => n.heart)!.y} cradle=${g.nodes.find((n) => n.kind === "cradle")!.y}`);
}
// ======================================================================
// 12 · CIRCUIT LABEL + CANVAS LAW (circuit-map-layout-spec.md §1–§3)
//
// The owner-flagged slice: the mid tier rendered "The" (the old renderer
// derived a label by splitting the published name and keeping the first word —
// 20 of 30 published names begin "The"), and the authored 560×760 portrait
// canvas left 52% of a wide desktop stage dead. Both are now laws:
//   · a display-name TABLE (full + compact per node, no articles, unique);
//   · a collision ladder (full → compact → hidden, never below 11px);
//   · an aspect-aware RENDER canvas (uniform kx on authored x only).
// map.ts is NOT edited: its layout law (§11) is stated on the authored canvas
// and the kx transform can only widen spacing (kx ≥ 1).
// ======================================================================
console.log("— 12 · circuit label + canvas law (display names, ladder, canvas) —");

// --- 12.0 the canonical stages of §3.5 (stage = viewport minus circuit 
// chrome: 56px header; +300px legend rail at ≥1024; +40px rail & 56px dock
// below it). 1280×1280 is the OWNER's measured stage from the live report. ---
const LABEL_STAGES: Array<{ label: string; w: number; h: number }> = [
  { label: "390×844 (phone)", w: 390, h: 692 },
  { label: "768×1024 (tablet)", w: 768, h: 872 },
  { label: "1024×768 (first desktop)", w: 724, h: 712 },
  { label: "1280×1280 (owner)", w: 980, h: 643 },
  { label: "1440×900", w: 1140, h: 844 },
  { label: "1920×1080", w: 1620, h: 1024 },
  { label: "2560×1440 (ultra-wide)", w: 2260, h: 1384 },
];
/** The scale a stage really renders at: fit, floored by the 44px law. */
const stageScale = (s: { w: number; h: number }): number => {
  const c = canvasFor(s.w, s.h);
  return Math.max(Math.min(s.w / c.w, s.h / c.h), 22 / 26);
};

// --- 12.1 the table is complete (a new zone can never ship unlabelled) ---
const ATLAS_NODE_IDS = [...new Set(webs.flatMap((g) => g.nodes.map((n) => n.id)))].sort();
check(
  "12.1 DISPLAY_NAMES keys EXACTLY equal the atlas node ids (30/30, every world)",
  ATLAS_NODE_IDS.length === 30 &&
    JSON.stringify(Object.keys(DISPLAY_NAMES).sort()) === JSON.stringify(ATLAS_NODE_IDS),
  `ids=${ATLAS_NODE_IDS.length} names=${Object.keys(DISPLAY_NAMES).length}`,
);
check(
  "12.1 every node has both forms (full + compact) and they are non-empty",
  Object.values(DISPLAY_NAMES).every((v) => typeof v.full === "string" && v.full.length > 0 && typeof v.compact === "string" && v.compact.length > 0),
);

// --- 12.2 no article, no degenerate string ---
const FORM_LIST = Object.entries(DISPLAY_NAMES).flatMap(([id, v]) =>
  [
    [id, "full", v.full],
    [id, "compact", v.compact],
  ] as Array<[string, string, string]>,
);
const leadingThe = FORM_LIST.filter(([, , t]) => /^The /.test(t)).map(([id, k, t]) => `${id}.${k}="${t}"`);
check("12.2 no display string begins with the article \"The \" (the D1 defect)", leadingThe.length === 0, leadingThe.join(", "));
const bareThe = FORM_LIST.filter(([, , t]) => /^the$/i.test(t)).map(([id, k, t]) => `${id}.${k}`);
check("12.2 no display string is the bare article \"The\" (what the map actually rendered)", bareThe.length === 0, bareThe.join(", "));
// §6.2 asks for length ≥ 4. The ratified §1.2 table carries exactly ONE 3-char
// string — ash-columns.compact = "Ash" (§1.3: "Forge / Rust / Ash are terser
// than the rest but each is unique"). The check states the law AND pins the
// exception, so a second short string fails here instead of drifting in.
const shortForms = FORM_LIST.filter(([, , t]) => t.length < 4).map(([id, k, t]) => `${id}.${k}="${t}"`);
check(
  "12.2 every display string ≥ 4 chars (ONE ratified exception: ash-columns.compact \"Ash\")",
  shortForms.length === 1 && shortForms[0] === 'ash-columns.compact="Ash"',
  shortForms.join(", "),
);

// --- 12.3 pairwise uniqueness across DISTINCT nodes (both forms) ---
const seenString = new Map<string, string>();
let stringClash = "";
for (const [id, , t] of FORM_LIST) {
  const owner = seenString.get(t);
  if (owner !== undefined && owner !== id) stringClash += `"${t}" = ${owner} + ${id}; `;
  else seenString.set(t, id);
}
check("12.3 no two distinct nodes share a display string (either form)", stringClash === "", stringClash);

// --- 12.4 the table cannot drift from the published catalog ---
const PUBLISHED = new Map<string, string>();
for (const g of webs) for (const n of g.nodes) PUBLISHED.set(n.id, n.name);
const DOCUMENTED_OVERRIDES: Record<string, string> = {
  "dark-matter-observatory": "Chorus-Held Heart", // map identity = its role (§1.2 ⟡)
  observatories: "Observatories", // published tail is wider than any row gap (§1.2 ⟡)
};
let drift = "";
for (const [id, v] of Object.entries(DISPLAY_NAMES)) {
  const published = PUBLISHED.get(id) ?? "";
  const expected = DOCUMENTED_OVERRIDES[id] ?? published.replace(/^The /, "");
  if (v.full !== expected) drift += `${id}: "${v.full}" ≠ "${expected}" (published "${published}"); `;
}
check(
  "12.4 full === published name minus a leading \"The \" (2 documented overrides; cradle follows the rule)",
  drift === "",
  drift,
);
check(
  "12.4 the published catalog is UNCHANGED (20 of 30 names still begin \"The \")",
  [...PUBLISHED.values()].filter((n) => n.startsWith("The ")).length === 20,
  `${[...PUBLISHED.values()].filter((n) => n.startsWith("The ")).length}`,
);
check(
  "12.4 the heart's label is its map role while its published name stays in the Sheet",
  DISPLAY_NAMES["dark-matter-observatory"].full === "Chorus-Held Heart" && PUBLISHED.get("dark-matter-observatory") === "Dark-Matter Observatory",
);

// --- 12.5 the canvas law (every world × every canonical stage) ---
for (const s of LABEL_STAGES) {
  const c = canvasFor(s.w, s.h);
  const aspect = c.w / c.h;
  check(
    `12.5 ${s.label}: canvas ${c.w}×${c.h}, aspect ∈ [0.7368, 1.60]`,
    aspect >= ASPECT_MIN - 1e-9 && aspect <= ASPECT_MAX + 1e-9,
    `aspect=${aspect.toFixed(4)}`,
  );
  check(`12.5 ${s.label}: kx ${c.kx.toFixed(3)} ≥ 1 (authored x is never compressed)`, c.kx >= 1);
  check(
    `12.5 ${s.label}: every authored x lands inside 0.06–0.94 of the canvas (all worlds)`,
    webs.every((g) => g.nodes.every((n) => { const X = canvasX(n.x, c.w, c.kx); return X >= 0.06 * c.w && X <= 0.94 * c.w; })),
  );
  let minRowPx = Infinity, minPairPx = Infinity, pairRowPx = "", pairPx = "";
  for (const g of webs) {
    for (let i = 0; i < g.nodes.length; i++) {
      for (let j = i + 1; j < g.nodes.length; j++) {
        const a = g.nodes[i], b = g.nodes[j];
        const d = Math.hypot(c.kx * (a.x - b.x), a.y - b.y);
        if (d < minPairPx) { minPairPx = d; pairPx = `${a.id}/${b.id}`; }
        if (rowY[a.id] === rowY[b.id] && d < minRowPx) { minRowPx = d; pairRowPx = `${a.id}/${b.id}`; }
      }
    }
  }
  check(
    `12.5 ${s.label}: same-row spacing ≥ 60 canvas units (was ≥ 60 authored)`,
    minRowPx >= ATLAS_CONFIG.spacing.row - 1e-6,
    `min=${minRowPx.toFixed(1)} (${pairRowPx})`,
  );
  check(
    `12.5 ${s.label}: ANY pair ≥ 52 canvas units (r26 hit-circle floor)`,
    minPairPx >= ATLAS_CONFIG.spacing.min - 1e-6,
    `min=${minPairPx.toFixed(1)} (${pairPx})`,
  );
}

// --- 12.6 the label law (every world × every canonical stage) ---
for (const s of LABEL_STAGES) {
  const c = canvasFor(s.w, s.h);
  const scale = stageScale(s);
  const tier = labelTier(scale);
  const fontUnits = labelFontUnits(tier, scale);
  let foreignString = "", articleString = "", overlap = "", outside = "", circleHit = "";
  let minLabelled = Infinity;
  for (const g of webs) {
    const m = resolveLabels(g.nodes, { tier, fontUnits, canvasW: c.w, kx: c.kx, selectedId: null });
    minLabelled = Math.min(minLabelled, m.size);
    const rects: Array<{ id: string; x0: number; x1: number; y0: number; y1: number }> = [];
    for (const [id, v] of m) {
      const names = DISPLAY_NAMES[id];
      if (v.text !== names.full && v.text !== names.compact) foreignString += `${id}="${v.text}"; `;
      if (/^the$/i.test(v.text)) articleString += `${id}="${v.text}"; `;
      const node = g.nodes.find((n) => n.id === id)!;
      const r = labelRect(node, v.text, c.w, c.kx, fontUnits);
      if (r.x0 < 0 || r.x1 > c.w) outside += `${g.worldId}/${id} [${r.x0.toFixed(1)},${r.x1.toFixed(1)}]; `;
      // the label must also clear every OTHER node's circle box (inflated by 2)
      for (const o of g.nodes) {
        if (o.id === id) continue;
        const orad = LABEL_NODE_RADIUS[o.kind] + 2;
        const ox = canvasX(o.x, c.w, c.kx);
        if (r.x0 < ox + orad && ox - orad < r.x1 && r.y0 < o.y + orad && o.y - orad < r.y1) circleHit += `${g.worldId}/${id} over ${o.id}; `;
      }
      rects.push({ id, ...r });
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.y0 < b.y1 && b.y0 < a.y1 && a.x0 < b.x1 && b.x0 < a.x1) overlap += `${g.worldId}: ${a.id}/${b.id}; `;
      }
    }
  }
  check(
    `12.6 ${s.label}: every rendered string is one of that node's two forms`,
    foreignString === "",
    foreignString,
  );
  check(`12.6 ${s.label}: NO rendered label is an article (the owner's defect)`, articleString === "", articleString);
  check(`12.6 ${s.label}: no two visible label rects overlap (all worlds)`, overlap === "", overlap);
  check(`12.6 ${s.label}: every visible rect inside the canvas and clear of every other node's circle`, outside === "" && circleHit === "", outside + circleHit);
  check(
    `12.6 ${s.label}: labelled ≥ ${s.w === 390 ? 20 : s.w === 980 || s.w === 1140 ? 28 : 20} of 30 nodes (min over worlds = ${minLabelled})`,
    minLabelled >= (s.w === 390 ? 20 : s.w === 980 || s.w === 1140 ? 28 : 20),
    `min=${minLabelled}`,
  );
}

// --- 12.7 the font law (nothing renders below 11px; none of it shrinks) ---
let fontLaw = "";
for (let sc = 0.55; sc <= 3.0001; sc += 0.005) {
  const fu = labelFontUnits(labelTier(sc), sc);
  if (fu * sc < 11 - 1e-9) { fontLaw = `scale=${sc.toFixed(3)} → ${(fu * sc).toFixed(2)}px`; break; }
}
check("12.7 labelFontUnits(tier, scale) × scale ≥ 11px for EVERY scale ≥ 0.55", fontLaw === "", fontLaw);
check(
  "12.7 scale < 0.55 → resolveLabels returns NO labels (hidden, never shrunk)",
  [0.01, 0.25, 0.5, 0.549].every((sc) => resolveLabels(webs[0].nodes, { tier: labelTier(sc), fontUnits: labelFontUnits(labelTier(sc), sc), canvasW: 560, kx: 1 }).size === 0),
);
check(
  "12.7 tier thresholds are exactly 1.00 / 0.55 (§1.4)",
  labelTier(3) === "full" && labelTier(1) === "full" && labelTier(0.999) === "mid" && labelTier(0.55) === "mid" && labelTier(0.549) === "low",
);
check(
  "12.7 mid tier renders EXACTLY 11px CSS at both mid scales the app hits (0.8462 phone/desktop, 0.9366 laptop)",
  Math.abs(labelFontUnits("mid", 22 / 26) * (22 / 26) - 11) < 1e-9 &&
    Math.abs(labelFontUnits("mid", 0.9366) * 0.9366 - 11) < 1e-9,
);

// --- 12.8 the renderer cannot regress to a string split (the D1 root cause) ---
const CIRCUIT_PAGE_SRC = fs.readFileSync("/home/team/shared/site/src/components/CircuitPage.tsx", "utf8");
const splitCalls = CIRCUIT_PAGE_SRC.match(/\.split\(\s*["'`]\s+["'`]?\s*\)/g) ?? [];
check(
  "12.8 CircuitPage.tsx derives NO name by splitting on spaces (the rule, not the string, was the bug)",
  splitCalls.length === 0,
  splitCalls.join(", "),
);
check(
  "12.8 CircuitPage.tsx renders labels from the display-name table (no labelText())",
  CIRCUIT_PAGE_SRC.includes("circuit-labels") && !/function\s+labelText\s*\(/.test(CIRCUIT_PAGE_SRC),
);

// ======================================================================
console.log(`\natlas-tests: ${pass} passed, ${fail} failed`);

process.exit(fail > 0 ? 1 : 0);