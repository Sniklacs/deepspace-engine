#!/usr/bin/env bun
/**
 * typecheck-guard — the gate `vite build` does not carry.
 *
 * WHY THIS EXISTS (the P0 of 2026-09-26): `Sheet.tsx` called `useT()` without
 * importing it. `vite build` bundles with esbuild, which does not resolve
 * identifiers — every call to a name that is not defined is left for the
 * browser to discover. So the live build shipped, and the first render of any
 * Sheet (i.e. everywhere past the race picker, in every language) threw
 * `useT is not defined` and the router error boundary swallowed the app.
 * `bun run build` was green the whole time. That is the hole this closes.
 *
 * WHAT IT CHECKS — typescript's own diagnostics over the SHIPPED APP
 * (`tsconfig.typecheck.json` → `src/**`), not the test suites:
 *
 *   1. UNDEFINED IDENTIFIERS — zero tolerance, never baselined:
 *      TS2304 `Cannot find name 'x'` · TS2552 `Cannot find name 'x'. Did you
 *      mean 'y'?` · TS2551 `Property 'x' does not exist … did you mean 'y'?`
 *      (the typo'd-import case). This is the whole class of the P0.
 *   2. EVERYTHING ELSE — counted against the frozen `typecheck-baseline.json`.
 *      Real pre-existing type debt (data-model mismatches, DOM listener
 *      overloads) does not block; an *increase* in any code does, and a code
 *      that is not in the baseline at all counts as an increase. Debt that
 *      shrinks is reported with a nudge to tighten the baseline.
 *
 * FAIL-OPEN, DELIBERATELY: if typescript or the config cannot be loaded, this
 * prints TYPECHECK-GUARD: SKIPPED and exits 0. A build environment problem must
 * never be able to brick shipping. The gate (i18n-verify §12) inverts that —
 * it requires TYPECHECK-GUARD: OK, so a skipped run FAILS the gate.
 *
 * Usage:  bun run scripts/typecheck-guard.ts            # the check
 *         bun run scripts/typecheck-guard.ts <tsconfig> # same check, another config
 *                                                      # (typecheck-verify.ts plants a
 *                                                      #  defect through this door)
 *         bun run scripts/typecheck-guard.ts --selftest # prove it can fail
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SITE = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_TSCONFIG = join(SITE, "tsconfig.typecheck.json");
const BASELINE = join(SITE, "typecheck-baseline.json");

/** Fatal, never baselined: a name that is used but not defined/imported. */
const UNDEFINED_FAMILY: Record<number, string> = {
  2304: "Cannot find name",
  2552: "Cannot find name (did you mean?)",
  2551: "Property does not exist (did you mean?)",
};

export type Diag = { code: number; file: string; line: number; col: number; message: string };

const flatten = (d: ts.Diagnostic) => ts.flattenDiagnosticMessageText(d.messageText, " ");

function toDiag(d: ts.Diagnostic, root: string): Diag {
  const file = d.file ? d.file.fileName.replace(`${root}/`, "") : "<global>";
  const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
  return { code: d.code, file, line: pos ? pos.line + 1 : 0, col: pos ? pos.character + 1 : 0, message: flatten(d) };
}

/** Every diagnostic the app code produces, through one code path (the self-test
 *  runs a fixture through exactly this function — so a green result means the
 *  check ran, not that it was skipped). */
export function collectDiagnostics(tsconfigPath: string): Diag[] {
  const root = dirname(tsconfigPath);
  const cfg = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (cfg.error) throw new Error(flatten(cfg.error));
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root, { noEmit: true }, tsconfigPath);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  return ts.getPreEmitDiagnostics(program).map((d) => toDiag(d, root));
}

const counts = (diags: Diag[]) => {
  const out: Record<string, number> = {};
  for (const d of diags) out[String(d.code)] = (out[String(d.code)] ?? 0) + 1;
  return out;
};

/** The verdict, exported so the suite can assert the classifier itself. */
export function judge(diags: Diag[], baseline: Record<string, number>) {
  const fatal = diags.filter((d) => UNDEFINED_FAMILY[d.code]);
  const rest = counts(diags.filter((d) => !UNDEFINED_FAMILY[d.code]));
  const grown: string[] = [];
  for (const [code, n] of Object.entries(rest)) {
    const allowed = baseline[code] ?? 0;
    if (n > allowed) grown.push(`TS${code}: ${n} (baseline allows ${allowed})`);
  }
  const shrank = Object.keys(baseline)
    .filter((code) => (rest[code] ?? 0) < (baseline[code] ?? 0))
    .map((code) => `TS${code}: ${rest[code] ?? 0} (baseline said ${baseline[code]})`);
  return { fatal, rest, grown, shrank, ok: fatal.length === 0 && grown.length === 0 };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) return selftest();
  const cfgArg = args.find((a) => !a.startsWith("--"));
  const TSCONFIG = cfgArg ? resolve(SITE, cfgArg) : DEFAULT_TSCONFIG;

  if (!existsSync(TSCONFIG) || !existsSync(join(SITE, "node_modules/typescript"))) {
    console.log("TYPECHECK-GUARD: SKIPPED (no typescript or tsconfig.typecheck.json in this tree)");
    console.log("  → run it where the app builds (the served tree has node_modules).");
    return 0;
  }
  let diags: Diag[];
  const t0 = Date.now();
  try {
    diags = collectDiagnostics(TSCONFIG);
  } catch (e) {
    console.log(`TYPECHECK-GUARD: SKIPPED (typescript could not run: ${(e as Error).message})`);
    return 0;
  }
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")).counts as Record<string, number>;
  const { fatal, rest, grown, shrank, ok } = judge(diags, baseline);

  console.log("=== TYPECHECK GUARD — the shipped app (src/), which `vite build` does not check ===");
  console.log(`typescript ${ts.version} · ${((Date.now() - t0) / 1000).toFixed(1)}s · ${diags.length} diagnostics`);
  console.log(`  undefined identifiers (fatal, never baselined) : ${fatal.length}`);
  console.log(`  pre-existing type debt (baselined)             : ${Object.values(rest).reduce((a, b) => a + b, 0)} ` +
    `[${Object.entries(rest).sort().map(([c, n]) => `TS${c}×${n}`).join(" ") || "none"}]`);
  for (const d of fatal) {
    console.log(`  ✖ ${d.file}:${d.line}:${d.col} — TS${d.code} ${d.message}`);
    if (d.code === 2304 || d.code === 2552) {
      console.log(`      → "${d.message.replace(/.*name '([^']+)'.*/, "$1")}" is used but never defined or imported: add the import (or fix the typo).`);
    }
  }
  for (const g of grown) console.log(`  ✖ new type error — ${g}`);
  for (const s of shrank) console.log(`  · debt paid — ${s}: tighten typecheck-baseline.json`);

  if (!ok) {
    console.log("TYPECHECK-GUARD: FAILED — this is the class of bug that took the live build down on 2026-09-26.");
    return 1;
  }
  console.log("TYPECHECK-GUARD: OK");
  return 0;
}

/** Prove the check can fail: run a planted undefined hook through the same path. */
function selftest() {
  const dir = mkdtempSync(join(tmpdir(), "typecheck-guard-"));
  try {
    writeFileSync(join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022" }, include: ["*.ts"] }));
    writeFileSync(join(dir, "planted.ts"), "export function probe() {\n  return useT();\n}\n");
    const caught = collectDiagnostics(join(dir, "tsconfig.json"));
    writeFileSync(join(dir, "tsconfig-clean.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022" }, include: ["clean.ts"] }));
    writeFileSync(join(dir, "clean.ts"), "const useT = () => (k: string) => k;\nexport function probe() {\n  return useT()(\"a\");\n}\n");
    const clean = collectDiagnostics(join(dir, "tsconfig-clean.json"));
    // Classified by the guard's own predicate — so the self-test proves the
    // fatal class, not a hand-copied code list. (Note TS answers a misspelt-ish
    // undefined name with TS2552 'Did you mean …?' rather than TS2304 — which is
    // exactly why the fatal set is a set and not one number.)
    const hit = caught.find((d) => UNDEFINED_FAMILY[d.code] && /useT/.test(d.message));
    const caughtIt = !!hit;
    const quiet = clean.length === 0;
    console.log(`self-test: planted 'useT is not defined' ${caughtIt ? `CAUGHT (TS${hit!.code}: ${hit!.message})` : "MISSED"}`);
    console.log(`self-test: the same file with the import present reports ${clean.length} diagnostics (want 0)`);
    console.log(caughtIt && quiet ? "TYPECHECK-GUARD SELFTEST: OK" : "TYPECHECK-GUARD SELFTEST: FAILED");
    return caughtIt && quiet ? 0 : 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(main());
