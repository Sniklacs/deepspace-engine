import { loadAccountSaves } from "/home/team/shared/site/src/game/store.ts";
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { readdirSync } from "node:fs";
const dir = "/home/team/shared/site/data/saves";
let ok = 0, bad = 0;
if (!require("node:fs").existsSync(dir)) {
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
      const l = st.leaders[0];
      if (typeof l.xp !== "number" || typeof l.unspentPoints !== "number" || typeof l.specialization !== "string" && l.specialization !== null || typeof st.leaderXpCaps !== "object") {
        throw new Error("fields missing for " + acct + "/" + gid + " leader0: xp=" + l.xp);
      }
      ok++;
    }
  } catch (e: any) { bad++; console.log("MIGRATE FAIL", acct, e.message); }
}
console.log(`real saves checked: ${ok} games OK, ${bad} failed`);
