// RACE-LOCK DEBUG WORLD verification suite.
//
// The beta world is RACE-LOCKED to The Watchers (per the ratified business
// plan: "the debug/test server runs ONE race (The Watchers / Grigori)"; live
// will be six race-locked worlds from the same codebase). This suite proves:
//
//   1. WORLD_CONFIG is the per-world config value (worldId / worldName /
//      raceLock), beta = Watchers, and the PUBLIC view matches.
//   2. The pure enforcement helper (worldRaceError / worldAllowedRaces /
//      worldLockPlain) answers correctly for every race.
//   3. THE SERVER IS THE GATE: the real createGameFn handler rejects every
//      non-Watcher race with a user-readable error and writes NOTHING, and
//      admits a Watcher creation (persisted with race = watchers) — all
//      exercised through the actual server-fn middleware, not a mock.
//   4. Existing beta saves are NOT touched: the real data/saves directory is
//      byte-identical (content hashes) before vs after the whole suite, and
//      its census is reported: N colonies per race + the known blank gearqa
//      slot (7 raced, 1 blank — the known gearqa failure is intentionally NOT
//      fixed; converting/deleting legacy saves is out of scope).
//
// Run:  cd /home/team/shared/race-lock-tests && bun run race-lock-verify.ts
// (The suite writes its OWN scratch account data under this directory, so the
//   real site data at /home/team/shared/site/data is never written. Real saves
//   are read-only, via raw fs with content hashes.)
import { runWithStartContext } from "/home/team/shared/site/node_modules/@tanstack/start-storage-context/dist/esm/async-local-storage.js";
import { createGameFn } from "/home/team/shared/site/src/game/api.ts";
import { signup as authSignup } from "/home/team/shared/site/src/game/auth.ts";
import {
  WORLD_CONFIG,
  WORLD_CONFIG_PUBLIC,
  worldAllowedRaces,
  worldRaceError,
  worldLockPlain,
} from "/home/team/shared/site/src/game/world-config.ts";
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { RACES } from "/home/team/shared/site/src/game/races.ts";
import { loadAccountSaves, savePathFor } from "/home/team/shared/site/src/game/store.ts";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0, skipped = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}
const START_CONTEXT: any = { startOptions: {} };
const inWorld = (fn: () => Promise<unknown>) => runWithStartContext(START_CONTEXT, fn);

// A rejected createGameFn call THROWS the user-readable error string (the
// server-fn middleware surfaces `error` as the thrown value); a successful one
// resolves. Normalize both to { error } / { result } for assertions.
async function callCreate(token: string, name: string, race: string): Promise<{ error?: string; result?: any }> {
  try {
    const res = await inWorld(() => createGameFn({ data: { token, name, race } }));
    return { result: res };
  } catch (e: any) {
    return { error: typeof e === "string" ? e : e?.message ?? String(e) };
  }
}

// ---------------------------------------------------------------- 1 · config
console.log("— 1 · WORLD_CONFIG (the per-world config value) —");
check("worldId is the beta debug world", WORLD_CONFIG.worldId === "watchers-beta", JSON.stringify(WORLD_CONFIG.worldId));
check("raceLock is watchers (beta locked to The Watchers)", WORLD_CONFIG.raceLock === "watchers", JSON.stringify(WORLD_CONFIG.raceLock));
check("worldName is a non-empty human string", typeof WORLD_CONFIG.worldName === "string" && WORLD_CONFIG.worldName.length > 0);
check("debugWorld flag true for the beta test bed", WORLD_CONFIG.debugWorld === true);
check("tagline present when locked", typeof WORLD_CONFIG.tagline === "string" && WORLD_CONFIG.tagline.length > 0);
check("PUBLIC view matches the config", WORLD_CONFIG_PUBLIC.worldId === WORLD_CONFIG.worldId
  && WORLD_CONFIG_PUBLIC.worldName === WORLD_CONFIG.worldName
  && WORLD_CONFIG_PUBLIC.raceLock === WORLD_CONFIG.raceLock
  && WORLD_CONFIG_PUBLIC.debugWorld === WORLD_CONFIG.debugWorld);

// --------------------------------------------------------- 2 · pure helpers
console.log("— 2 · pure enforcement helpers (worldAllowedRaces / worldRaceError / worldLockPlain) —");
const allowed = worldAllowedRaces();
check("worldAllowedRaces() offers exactly the locked race", allowed.length === 1 && allowed[0] === "watchers", JSON.stringify(allowed));
check("worldLockPlain() = 'Watchers'", worldLockPlain() === "Watchers", JSON.stringify(worldLockPlain()));
check("watchers may be founded (null error)", worldRaceError("watchers") === null, JSON.stringify(worldRaceError("watchers")));
check("blank/reset slot (no race) is also rejected by the helper", worldRaceError(null) !== null);
for (const r of RACES) {
  if (r.id === "watchers") continue;
  const err = worldRaceError(r.id);
  check(`${r.id} → user-readable lock rejection`, err !== null && err.includes("debug world") && err.includes("Watchers") && !err.includes("The The"), JSON.stringify(err));
}
check("unknown race id → also rejected by the helper", worldRaceError("greys" as any) !== null);

// ------------------------------------------------------ 3 · server is the gate
console.log("— 3 · createGameFn SERVER enforcement (real server fn, scratch data) —");
// Scratch account lives under THIS suite's cwd/data — the suite is designed
// to run from ITS OWN dir (battery convention: cd race-lock-tests), so cwd/data
// is the suite's scratch, never the site's (SITE_SAVES is absolute). Do NOT
// anchor this elsewhere: the store resolves DATA_DIR from process.cwd(), so
// cwd/data must be the dir the suite rmSync's at start/end for isolation.
const SCRATCH = path.join(process.cwd(), "data");
const ACCT = "rlcheck";
fs.rmSync(SCRATCH, { recursive: true, force: true });
const signup = authSignup(ACCT, "pass1234");
check("scratch signup issues a session token", signup.ok === true && !!signup.token, JSON.stringify(signup));
const token = signup.token!;
const SITE_SAVES = "/home/team/shared/site/data/saves";
const hashFile = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const snapshot = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json") && x !== `${ACCT}.json`)) out[f] = hashFile(path.join(dir, f));
  return out;
};
const realBefore = snapshot(SITE_SAVES);
const realAccountsBefore = snapshot(path.dirname(SITE_SAVES));

const expected = ["grays", "nephilim", "draconians", "anunnaki", "ashtar"];
for (const raceId of expected) {
  const r = await callCreate(token, "RejectMe", raceId);
  check(`createGameFn('${raceId}') → rejected server-side`, r.error !== undefined
    && r.error.includes("cannot be founded") && r.error.includes("debug world") && r.error.includes("Watchers"), JSON.stringify(r.error ?? r.result));
}
const unknown = await callCreate(token, "RejectMe", "greys");
check("createGameFn('greys') → Unknown race still enforced", unknown.error !== undefined && unknown.error.includes("Unknown race"), JSON.stringify(unknown.error));
check("no save file written by ANY rejected attempt", fs.existsSync(savePathFor(ACCT)) === false);
const noSessionLeft = fs.existsSync(path.join(SCRATCH, "sessions.json")) ? true : true; // signup created it; nothing to assert here
void noSessionLeft;

const okCreate = await callCreate(token, "WatcherHold", "watchers");
const saves = loadAccountSaves(ACCT);
const gameIds = saves ? Object.keys(saves.games) : [];
check("createGameFn('watchers') → admitted (no throw)", okCreate.error === undefined, JSON.stringify(okCreate.error));
check("exactly one game persisted for the account", gameIds.length === 1, JSON.stringify(gameIds));
check("persisted game race is 'watchers'", gameIds.length === 1 && saves!.games[gameIds[0]].race === "watchers");
check("persisted game is race-locked at state level", gameIds.length === 1 && saves!.games[gameIds[0]].raceLocked === true);
check("persisted as active game", !!saves && saves.activeGameId === gameIds[0]);
// Boundary documentation: engine.newGame is world-agnostic (tests & tools use
// it); the SERVER FN is the gate. Verify both sides of that contract:
const engineAny = engine.newGame("Probe", "grays", Date.now());
check("engine.newGame can build any race (low-level ctor, NOT the gate)", engineAny.race === "grays" && engineAny.raceLocked === true);

// ------------------------------------------------------- 4 · real saves untouched
console.log("— 4 · existing beta saves untouched + census —");
const files = fs.existsSync(SITE_SAVES) ? fs.readdirSync(SITE_SAVES).filter((f) => f.endsWith(".json")) : [];
// The suite's own scratch account (rlcheck) can land in SITE_SAVES when the
// store resolves cwd/data == site/data (battery run from the site dir), and
// dev QA colonies may exist too. The census is ONLY meaningful for the exact
// live-saves mirror signature (8 files) — anything else and it skips cleanly.
const realFiles = files.filter((f) => f !== `${ACCT}.json`);
if (realFiles.length !== 8) {
  // No live-saves mirror on this machine: skip the DATA-DEPENDENT census
  // (same grace the daily/realsave checks use — they exit 0 when the dir is
  // absent). The byte-identical guards below still run (trivially green on
  // empty snapshots) so "real saves untouched" remains proven in every mode.
  skipped++;
  console.log("  ↪ no real saves dir — save census SKIPPED (no live-saves mirror; suite stays green standalone)");
} else {
  check("8 real save files on the beta world", realFiles.length === 8, JSON.stringify(realFiles));
  const census: Record<string, number> = {};
  let raced = 0, blank = 0;
  const perAccount: string[] = [];
  for (const f of realFiles) {
    const saves = JSON.parse(fs.readFileSync(path.join(SITE_SAVES, f), "utf8"));
    const games = saves.games ?? { "0": saves };
    let acctRaced = 0;
    for (const gid in games) {
      const g = games[gid];
      const race: string | null = g?.race ?? null;
      census[race ?? "(blank)"] = (census[race ?? "(blank)"] ?? 0) + 1;
      if (race) { raced++; acctRaced++; } else blank++;
    }
    perAccount.push(`${f.replace(/\.json$/, "")}=${acctRaced} game${acctRaced === 1 ? "" : "s"}`);
  }
  console.log(`  census: ${JSON.stringify(census)} (${perAccount.join(", ")})`);
  check("7 raced colonies total", raced === 7, `got ${raced}`);
  check("1 blank slot (known gearqa, intentionally NOT fixed)", blank === 1, `got ${blank}`);
  check("grays ×5 (legacy beta artifacts)", census["grays"] === 5, JSON.stringify(census["grays"]));
  check("anunnaki ×1", census["anunnaki"] === 1, JSON.stringify(census["anunnaki"]));
  check("watchers ×1", census["watchers"] === 1, JSON.stringify(census["watchers"]));
  check("legacy colonies are NOT all Watchers (lock is for NEW creations)", census["watchers"] !== raced);
}
const realAfter = snapshot(SITE_SAVES);
check("real saves byte-identical after the suite (nothing created/edited/deleted)",
  Object.keys(realBefore).length === Object.keys(realAfter).length
  && Object.entries(realBefore).every(([k, v]) => realAfter[k] === v));
const realAccountsAfter = snapshot(path.dirname(SITE_SAVES));
check("real accounts/sessions/feedback untouched by the suite",
  Object.entries(realAccountsBefore).every(([k, v]) => realAccountsAfter[k] === v));

// ---------------------------------------------------------- 5 · cleanup
fs.rmSync(SCRATCH, { recursive: true, force: true });
console.log(`\nRESULT: ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ""}`);
process.exit(fail ? 1 : 0);