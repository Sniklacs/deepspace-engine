// Real-save migration check for V4 + §8 acknowledgedOnce: every save in the
// beta data dir must advance with zero errors and gain the new fields.
// Run: cd /home/team/shared/revelation-tests && bun run realsave-migration-check.ts
import { loadAccountSaves } from "/home/team/shared/site/src/game/store.ts";
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { publicState } from "/home/team/shared/site/src/game/api.ts";
import { readdirSync } from "node:fs";
const dir = "/home/team/shared/site/data/saves";
let ok = 0, bad = 0, payloadLeaks = 0;
if (!require("node:fs").existsSync(dir)) {
  console.log("real saves dir missing — nothing to check");
  process.exit(0);
}
for (const f of readdirSync(dir)) {
  const acct = f.replace(/\.json$/, "");
  const saves = await loadAccountSaves(acct);
  if (!saves) { console.log("NO SAVES", acct); continue; }
  for (const gid in saves.games) {
    const st = saves.games[gid];
    try {
      engine.advance(st, Date.now());
      // §8 migration: never-acknowledged default on legacy saves.
      if (typeof st.acknowledgedOnce !== "boolean") throw new Error("acknowledgedOnce missing after advance");
      if (typeof st.revelationCounters?.cleanRecoveries !== "number") throw new Error("revelationCounters missing after advance");
      // Silence discipline on the REAL payload function.
      const payload = publicState(st);
      const s = JSON.stringify(payload);
      for (const k of ["revelationCounters", "acknowledgedOnce", "revelationFirstOpenAt", "cleanRecoveries", "zeroCorruptionSurvivals", "deepCleanLandings", "codicesEarnedByDeeds", "maxDomainDepth"]) {
        if (s.includes(`"${k}"`)) throw new Error(`payload leak: ${k}`);
      }
      ok++;
    } catch (e: any) { bad++; console.log("REVELATION MIGRATE/LEAK FAIL", acct, gid, e.message); }
  }
}
console.log(`real saves checked (V4+§8): ${ok} games OK, ${bad} failed`);
if (bad > 0) process.exit(1);