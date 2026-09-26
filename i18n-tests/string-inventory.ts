// string-inventory.ts — the honest count of player-facing strings, slice 1.
// Run: cd /home/team/shared/i18n-tests && env -u DATABASE_URL bun run string-inventory.ts
//
// HOW IT COUNTS (so the number can be argued with, not just believed):
//   A. JSX TEXT NODES — a line whose text between > and < contains a letter and
//      no code punctuation.
//   B. PLAYER-FACING PROPS — aria-label/title/placeholder/alt/label/sub/subtitle/
//      reason/note written as a literal.
//   C. ENGINE CONFIG PROSE — in the data tables (tooltips/zones/races/research/
//      daily/armory/heroes/war/prologue), a quoted string of >= 12 chars that
//      starts with a capital or emoji and contains a space (i.e. reads as a
//      sentence, not an id).
//   D. AUTHORED CONTENT — counted per row/line from the source tables
//      (tutorial cues, rail rows, script lines), because these are content, not
//      chrome.
// A string already inside a t("key", "…") call is NOT counted (it is keyed).
import { readFileSync, readdirSync, statSync } from "node:fs";
const SITE = "/home/team/shared/site";
const read = (p: string) => readFileSync(`${SITE}/${p}`, "utf8");
const KEYED = /\bt\(\s*["'`]/;
const TEXT = />([^<>{}=;&!|]*[A-Za-z][^<>{}=;&!|]*)</;
const PROP = /\b(aria-label|title|placeholder|alt|label|sub|subtitle|reason|note)="([^"]+[A-Za-z][^"]*)"/;
const PROSE = /"[^"\n]{12,}"|`[^`\n]{12,}`/;
const count = (src: string) => {
  let a = 0, b = 0;
  for (const line of src.split("\n")) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line) || KEYED.test(line)) continue;
    const m = TEXT.exec(line); if (m && !/\{[^}]*\}/.test(m[1])) a++;
    const p = PROP.exec(line); if (p) b++;
  }
  return a + b;
};
const walk = (dir: string, out: string[] = []) => { for (const f of readdirSync(`${SITE}/${dir}`)) { const p = `${dir}/${f}`; if (statSync(`${SITE}/${p}`).isDirectory()) walk(p, out); else if (/\.tsx?$/.test(f) && !/\.gen\./.test(f)) out.push(p); } return out; };
const table: Record<string, { files: number; strings: number }> = {};
const add = (area: string, files: string[], f: (p: string) => number) => { table[area] = { files: files.length, strings: files.reduce((n, p) => n + f(p), 0) }; };

const components = walk("src/components").filter((p) => !/i18n\//.test(p));
const routes = walk("src/routes");
const gameFiles = walk("src/game");
add("shell chrome + Cradle home + screens (src/components)", components, (p) => count(read(p)));
add("routes (landing, play, the-fall)", routes, (p) => count(read(p)));
const engineAreas: Record<string, string[]> = {
  "engine config — tooltips (game/tooltips.tsx)": gameFiles.filter((p) => /tooltips/.test(p)),
  "engine config — zones/domains/radiation (game/zones.ts)": gameFiles.filter((p) => /zones/.test(p)),
  "engine config — races + lore (game/races.ts)": gameFiles.filter((p) => /races/.test(p)),
  "engine config — research/codices/leaders (research, leader-xp)": gameFiles.filter((p) => /research|leader-xp/.test(p)),
  "engine config — daily/devotion (game/daily.ts)": gameFiles.filter((p) => /daily/.test(p)),
  "engine config — armory/weapons (game/armory.ts)": gameFiles.filter((p) => /armory/.test(p)),
  "engine config — heroes (heroes-data, hero-xp)": gameFiles.filter((p) => /heroes-data|hero-xp/.test(p)),
  "engine config — war/battles (game/war/*, battle-decisions)": gameFiles.filter((p) => /war\/|battle/.test(p)),
  "engine config — prologue script/state (game/prologue/*)": gameFiles.filter((p) => /prologue\//.test(p)),
  "engine config — battle reports/notifications (report-events, nav-badges)": gameFiles.filter((p) => /report-events|nav-badges/.test(p)),
  "engine config — storefront copy (game/monetization.ts)": gameFiles.filter((p) => /monetization/.test(p)),
};
for (const [area, files] of Object.entries(engineAreas)) add(area, files, (p) => (read(p).match(PROSE) ?? []).filter((s) => /^["`][A-Z\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(s) && / /.test(s)).length);

const catalogue = read("src/game/i18n/langs/en.ts");
const keys = (catalogue.match(/^  "[a-zA-Z0-9.]+":/gm) ?? []).length;
console.log("AREA".padEnd(74), "FILES", "PLAYER-FACING STRINGS");
for (const [k, v] of Object.entries(table)) console.log(k.padEnd(74), String(v.files).padStart(5), String(v.strings).padStart(8));
const group = (pre: string) => (catalogue.match(new RegExp(`^  "${pre}[a-zA-Z0-9.]*":`, "gm")) ?? []).length;
console.log(`\nKEYED NOW (slice 1) — catalogue keys: ${keys}`);
for (const [label, pre] of [["app/landing/auth/nudge/help", ""], ["nav+ribbon+sheet+resource", ""]] as [string, string][]) void label, void pre;
const groups: [string, string][] = [["app/chrome", "app."], ["nav", "nav."], ["ribbon+ledger", "ribbon."], ["resources", "resource."], ["cradle home", "cradle."], ["building tiles+domains", "tile."], ["(domains)", "domain."], ["Cradle sheet", "cradleSheet."], ["settings+language picker", "settings."], ["(picker)", "lang."], ["landing page", "landing."], ["sign-in door", "auth."], ["nudge+help", "nudge."], ["(help)", "help."], ["Expeditions", "exp."], ["Lab", "lab."], ["Armory", "armory."]];
let total = 0; for (const [label, pre] of groups) { const n = group(pre); if (n) { total += n; console.log(`   ${String(n).padStart(4)}  ${label}`); } }
console.log(`   ${String(total).padStart(4)}  TOTAL keyed keys in the English catalogue`);
for (const [label, file, pattern] of [
  ["tutorial cues (game/war/tutorial-cues.ts rows)", "src/game/war/tutorial-cues.ts", /cue:|text:|line:/g],
  ["beat-rail rows (game/prologue/prologue-cues.ts rows)", "src/game/prologue/prologue-cues.ts", /line:|text:|cue:/g],
  ["prologue script lines (design/opening-script.md)", "../design/opening-script.md", /^\*\*[A-ZÀ-Ý]/gm],
] as [string, string, RegExp][]) {
  try { console.log(`   ${String((read(file).match(pattern) ?? []).length).padStart(4)}  ${label}`); } catch { console.log(`        n/a  ${label} (file not in this tree)`); }
}
