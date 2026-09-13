// V8 OPTIONAL-REAL-SAVE MIGRATION CHECK — the site's REAL data/saves.
// Same spine as the daily-tests realsave check (which was the earlier chassis
// for the leader-xp / revelation / contribution variants): load every real
// account, advance() it (exercising the V8 ensure+migrate path on production
// data), and assert the state is still coherent. V8 adds NO state fields —
// the Atlas is pure client-rendered geography — so the real-save contract is
// "legacy saves load with zero errors, blanks stay quiet" (unchanged).
// Also proves the Atlas module generates deterministically for the LIVE
// world id (the exact id the deployed client will render).
//
// READ-ONLY for the site's data dir: nothing is written back.
import { loadAccountSaves } from "/home/team/shared/site/src/game/store.ts";
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { generateAtlas } from "/home/team/shared/site/src/game/map.ts";
import { readdirSync, existsSync } from "node:fs";
const dir = "/home/team/shared/site/data/saves";
let ok = 0, bad = 0, raced = 0, blank = 0, skippedBlank = 0;
if (!existsSync(dir)) {
  console.log("real saves dir missing — nothing to check");
  process.exit(0);
}
for (const f of readdirSync(dir)) {
  const acct = f.replace(/\.json$/, "");
  const saves = loadAccountSaves(acct);
  if (!saves) { console.log("NO SAVES", acct); continue; }
  try {
    for (const gid in saves.games) {
      const st = saves.games[gid];
      engine.advance(st, Date.now());
      if (st.race) {
        raced++;
        if (typeof st.daily !== "object" || st.daily === null) throw new Error("daily block missing for " + acct + "/" + gid);
        if (typeof st.devotion !== "number" || !isFinite(st.devotion) || st.devotion < 0) throw new Error("devotion missing for " + acct + "/" + gid);
        ok++;
      } else {
        blank++;
        skippedBlank++; // race-null slot: must advance quietly (V7/V8 guard)
      }
    }
  } catch (e: any) { bad++; console.log("MIGRATE FAIL", acct, e.message); }
}
console.log(`real saves checked: ${ok} raced OK + ${skippedBlank} blank slots skipped quietly (${blank} blanks), ${bad} failed`);
// Determinism on the live world id — the exact inputs the deployed client uses.
const atlas = generateAtlas({ worldId: "watchers-beta", raceId: "watchers" });
const atlas2 = generateAtlas({ worldId: "watchers-beta", raceId: "watchers" });
if (JSON.stringify(atlas) !== JSON.stringify(atlas2)) { bad++; console.log("ATLAS NON-DETERMINISTIC on the live world id"); }
else console.log(`live-world atlas deterministic (${atlas.nodes.length} nodes, ${atlas.edges.length} traces, seed ${atlas.seed})`);
process.exit(bad > 0 ? 1 : 0);