// V7 OPTIONAL-REAL-SAVE MIGRATION CHECK — the site's REAL data/saves.
// Same spine as the leader-xp / revelation / contribution real-save blocks:
// load every real account, advance() it (exercising the V7 ensure+migrate
// path on production data), and assert the daily block + Devotion fields.
// Blank/reset slots (race null) are expected to advance QUIETLY — the V7
// blank-safety guard makes that path green instead of the pre-V7 crash.
//
// READ-ONLY for the site's data dir: nothing is written back.
import { loadAccountSaves } from "/home/team/shared/site/src/game/store.ts";
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { readdirSync } from "node:fs";
const dir = "/home/team/shared/site/data/saves";
let ok = 0, bad = 0, raced = 0, blank = 0, skippedBlank = 0;
if (!require("node:fs").existsSync(dir)) {
  console.log("real saves dir missing — nothing to check");
  process.exit(0);
}
for (const f of readdirSync(dir)) {
  const acct = f.replace(/\.json$/, "");
  const saves = await loadAccountSaves(acct);
  if (!saves) { console.log("NO SAVES", acct); continue; }
  try {
    for (const gid in saves.games) {
      const st = saves.games[gid];
      const beforeTick = st.lastTick;
      engine.advance(st, Date.now());
      if (st.race) {
        raced++;
        if (typeof st.daily !== "object" || st.daily === null) throw new Error("daily block missing for " + acct + "/" + gid);
        if (typeof st.devotion !== "number" || !isFinite(st.devotion) || st.devotion < 0) throw new Error("devotion missing for " + acct + "/" + gid);
        if (typeof st.devotionStreak !== "number" || !isFinite(st.devotionStreak) || st.devotionStreak < 0) throw new Error("streak missing for " + acct + "/" + gid);
        if (!Array.isArray(st.daily.list) || st.daily.list.length > 4) throw new Error("bad list for " + acct + "/" + gid);
        ok++;
      } else {
        blank++;
        skippedBlank++; // race-null slot: must advance quietly (V7 guard)
      }
      void beforeTick;
    }
  } catch (e: any) { bad++; console.log("MIGRATE FAIL", acct, e.message); }
}
console.log(`real saves checked: ${ok} raced OK + ${skippedBlank} blank slots skipped quietly (${blank} blanks), ${bad} failed`);
process.exit(bad > 0 ? 1 : 0);