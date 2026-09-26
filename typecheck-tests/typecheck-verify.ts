// typecheck-verify — the gate `vite build` does not carry (P0, 2026-09-26).
//
// Run: cd /home/team/shared/typecheck-tests && env -u DATABASE_URL bun run typecheck-verify.ts
//
// WHY. `Sheet.tsx` called `useT()` without importing it. `vite build` bundles
// with esbuild, which does not resolve identifiers, so the live build shipped
// and the first render of any Sheet — i.e. everywhere past the race picker, in
// every language — threw `useT is not defined` and the router error boundary
// swallowed the app. `bun run build` was green. This suite is the answer to
// "so it cannot happen again silently".
//
// What this gates, in order:
//   §1 the app-code typecheck config exists and cannot be widened into the tests
//   §2 the guard is WIRED — package.json's build runs it (a gate nobody runs is
//      not a gate; this check fails if someone unwires it)
//   §3 the guard passes on this tree, and PRINTS the OK line (a SKIPPED run
//      fails here, even though it exits 0 for the build's sake)
//   §4 a planted defect — the P0 verbatim — is CAUGHT, through the guard's own
//      door and exit code (non-vacuity: a guard that never fails is decoration)
//   §5 the guard's own self-test passes
//   §6 the i18n import hygiene sweep — every i18n call site names its import,
//      plus the inventory of those call sites (the report the P0 asked for)
import { readdirSync, readFileSync, statSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const SITE = "/home/team/shared/site";
const read = (p: string) => readFileSync(`${SITE}/${p}`, "utf8");
const guard = (args: string[] = []) =>
  spawnSync("bun", ["run", "scripts/typecheck-guard.ts", ...args], {
    cwd: SITE, encoding: "utf8", timeout: 300_000,
    env: { ...process.env, DATABASE_URL: undefined },
  });

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const section = (t: string) => console.log(`\n— ${t} —`);

// ---------------------------------------------------- §1 the typecheck config
section("1 · THE APP-CODE TYPECHECK CONFIG (src/ only — the tests cannot mask it)");
const cfgText = read("tsconfig.typecheck.json");
check("tsconfig.typecheck.json exists and extends the project config", /"extends"\s*:\s*"\.\/tsconfig\.json"/.test(cfgText));
check("it includes the shipped app (src/**)", /src\/\*\*\/\*\.tsx?/.test(cfgText) || /src\/\*\*\/\*/.test(cfgText));
// The config's own "//" field NAMES `*-tests` (it explains why they are excluded),
// so this check must read the config FIELDS, never the prose around them: matching the
// raw text made the suite fail on a correct config (found 2026-09-26).
const cfg = JSON.parse(cfgText) as Record<string, unknown>;
const cfgFields = JSON.stringify({ ...cfg, "//": undefined });
check("it does NOT include the test suites (a suite can never inflate or mask the app's diagnostics)",
  !/\*-tests/.test(cfgFields) && !/"\.\."/.test(cfgFields), cfgFields.slice(0, 80));
check("it typechecks with node types too (the app has server modules; without them the check drowns in false errors)",
  /"types"\s*:\s*\[[^\]]*"node"/.test(cfgText));
check("the baseline exists, is JSON, and does not baseline an undefined identifier",
  (() => { const b = JSON.parse(read("typecheck-baseline.json")); return !["2304", "2551", "2552"].some((c) => c in b.counts); })(),
  read("typecheck-baseline.json").slice(0, 60));

// ----------------------------------------------------------- §2 the wiring
section("2 · THE GATE IS WIRED (a gate nobody runs is not a gate)");
const pkg = JSON.parse(read("package.json"));
check("`bun run typecheck` runs the guard", /typecheck-guard\.ts/.test(pkg.scripts.typecheck ?? ""), pkg.scripts.typecheck);
check("`bun run build` runs the typecheck BEFORE vite build — the live build can no longer ship this bug",
  /typecheck/.test(pkg.scripts.build ?? "") && /vite build/.test(pkg.scripts.build ?? ""), pkg.scripts.build);
check("the guard script itself is in the repo", existsSync(`${SITE}/scripts/typecheck-guard.ts`));
const guardSrc = read("scripts/typecheck-guard.ts");
check("the fatal class is the undefined identifier family (TS2304/2551/2552)", /2304/.test(guardSrc) && /2552/.test(guardSrc));
check("the guard fails OPEN on a missing toolchain (an environment fault must never brick shipping)",
  /SKIPPED/.test(guardSrc) && /return 0;/.test(guardSrc));

// ------------------------------------------------- §3 the guard on this tree
section("3 · THE GUARD ON THIS TREE");
const run = guard();
const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
console.log(out.trimEnd());
check("the guard ran (not skipped) and exited 0", run.status === 0 && /TYPECHECK-GUARD: OK/.test(out), `exit=${run.status}`);
check("no undefined identifier anywhere in the shipped app", /undefined identifiers \(fatal, never baselined\) : 0/.test(out));
check("pre-existing type debt is reported, not hidden", /pre-existing type debt \(baselined\)\s*:\s*\d+/.test(out));

// ---------------------------------------------- §4 non-vacuity, end to end
section("4 · THE GUARD CATCHES THE P0 (planted defect, same door, same exit code)");
const probeDir = "/tmp/typecheck-guard-probe";
rmSync(probeDir, { recursive: true, force: true });
mkdirSync(probeDir, { recursive: true });
try {
  writeFileSync(`${probeDir}/probe.tsx`, `// PLANTED: a screen that calls the i18n lookup without importing it —
// verbatim the /play P0 of 2026-09-26.
export function PlayScreen() {
  const t = useT();
  return t("sheet.close");
}
`);
  writeFileSync(`${probeDir}/tsconfig.json`, JSON.stringify({
    extends: `${SITE}/tsconfig.typecheck.json`,
    include: [`${SITE}/src/**/*.ts`, `${SITE}/src/**/*.tsx`, `${probeDir}/probe.tsx`],
  }, null, 2));
  const planted = guard([`${probeDir}/tsconfig.json`]);
  const pout = `${planted.stdout ?? ""}${planted.stderr ?? ""}`;
  check("the guard exits non-zero on a planted undefined hook", planted.status === 1, `exit=${planted.status}`);
  // tsc reports the undefined-identifier family by the code that fits the situation:
  // TS2304 ("cannot find name") when nothing similar exists, TS2552/TS2551 when it
  // has a suggestion. All three are the same fatal class (see §2), so accept all three.
  check(
    "it names the file, the line and the identifier",
    /probe\.tsx:\d+:\d+ — TS(2304|2551|2552) Cannot find name 'useT'/.test(pout),
    pout.split("\n").find((l) => l.includes("✖")) ?? "",
  );
  check("and it says which class of bug this is", /TYPECHECK-GUARD: FAILED/.test(pout));
  const cleanWithProbe = guard();
  check("the real tree is untouched by the probe (still OK)", cleanWithProbe.status === 0);
  console.log(`      planted run said: ${pout.split("\n").filter((l) => l.includes("✖")).slice(0, 2).join(" | ").trim()}`);
} finally {
  rmSync(probeDir, { recursive: true, force: true });
}

// --------------------------------------------------- §5 the guard's selftest
section("5 · THE GUARD'S OWN SELF-TEST");
const st = guard(["--selftest"]);
const sout = `${st.stdout ?? ""}${st.stderr ?? ""}`;
console.log(`      ${sout.trim().split("\n").join("\n      ")}`);
check("the self-test passes (planted defect caught, clean file quiet)", st.status === 0 && /SELFTEST: OK/.test(sout));

// ------------------------------------------- §6 i18n import hygiene + inventory
section("6 · EVERY i18n CALL SITE NAMES ITS IMPORT (the sweep the P0 asked for)");
const walk = (dir: string, rel = ""): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = `${dir}/${e}`;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel ? `${rel}/${e}` : e));
    else out.push(rel ? `${rel}/${e}` : e);
  }
  return out;
};
const appFiles = walk(`${SITE}/src`).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts"));
const HOOKS = /\b(useT|useLang|useDeviceSettings|langDir|isRtlLang)\b/;
/** Drop comments before scanning: a symbol named in a doc block is not a call. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const IMPORTS_I18N = /from\s+["'][^"']*i18n\/I18n["']/;
const callSites: { file: string; uses: string[]; imported: boolean }[] = [];
const bad: string[] = [];
for (const rel of appFiles) {
  const raw = readFileSync(`${SITE}/src/${rel}`, "utf8");
  // Comments are prose, not calls: game/i18n/index.ts MENTIONS useT in its doc block and
  // declares nothing (it is a barrel of `export * from`). Scanning raw text flagged it.
  const text = stripComments(raw);
  const uses = [...new Set(text.match(new RegExp(HOOKS.source, "g")) ?? [])];
  if (!uses.length) continue;
  // A file that DECLARES the symbol is its definition site, not a call site
  // (game/i18n/languages.ts defines langDir/isRtlLang itself).
  const declares = (u: string) => new RegExp(`(function|const)\\s+${u}\\b`).test(text);
  const defines = rel === "components/i18n/I18n.tsx" || uses.every(declares);
  const imported = IMPORTS_I18N.test(raw) || defines;
  callSites.push({ file: rel, uses, imported });
  if (!imported) bad.push(`${rel} uses ${uses.join("/")} but imports nothing from i18n/I18n`);
}
check(`every file that reaches for the i18n API imports it (${callSites.length} files checked)`, bad.length === 0, bad.join(" | "));
check("the sweep is not vacuous — it found the call sites at all", callSites.length >= 5, `${callSites.length}`);
// Same rule as above: a `t("…")` shown in a COMMENT is documentation, not a call —
// game/i18n/index.ts and game/i18n/types.ts document the API in their doc blocks and
// are not call sites. Scan the same comment-stripped text the sweep above uses.
const strippedSrc = (rel: string) => stripComments(readFileSync(`${SITE}/src/${rel}`, "utf8"));
const lookups = appFiles.filter((rel) => /\bt\(\s*"/.test(strippedSrc(rel)));
const undeclared = lookups.filter((rel) => {
  const t = strippedSrc(rel);
  // `t` must come from somewhere. game/battle-decisions.ts calls a LOCAL helper
  // (`const t = (text: string) => ({ text })` — it builds order-line parts, it is not a
  // translation lookup), so a plain `const t = …` / `const t: …` satisfies this too.
  return (
    !/const t\s*[=:]/.test(t) &&
    rel !== "components/i18n/I18n.tsx" &&
    !/useT|makeT/.test(t) &&
    !/\bt\b[^;\n]*from\s+["'][^"']*i18n/.test(t)
  );
});
check(`every file with a key lookup holds a lookup (${lookups.length} files with t("a.key") style calls)`, undeclared.length === 0, undeclared.join(" | "));
console.log("      i18n call sites checked:");
for (const c of callSites) console.log(`        ${c.imported ? "✅" : "❌"} src/${c.file} — ${c.uses.join(", ")}`);

console.log(`\n${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
