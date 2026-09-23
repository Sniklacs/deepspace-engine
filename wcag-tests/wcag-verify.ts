// ============================================================================
// WCAG AA CONTRAST ACCEPTANCE GATE — design-system-rung1-spec.md §F.5
//
// Programmatic WCAG 2.x contrast verification of the design TOKENS — no
// browser, no rendering: pure hex math against the token block in
// src/styles/app.css (spec §A.1–A.3) and the races.ts accent single-source.
//
// Asserted contracts (spec §A tables + lead F.5 brief):
//   1 · required tokens exist + the @theme block and :root aliases stay in
//       sync (the file itself demands "keep the two blocks in sync").
//   2 · normal text  --text-1 / --text-2 on surf-2 AND surf-3 ≥ 4.5:1  (A.1)
//   3 · muted text   --text-3 on surf-2 AND surf-3 ≥ 5.0:1  (A.1 claim ~5.0,
//       stronger than the 4.5 AA floor on purpose — captions are ≥12px only)
//   4 · UI / large text — every functional color (ember, ember-soft, hazard,
//       hazard-soft, corrupt-text, purity, danger, danger-soft, focus) on
//       surf-2 AND surf-3 ≥ 3:1  (AA large-text / UI-component floor, A.2)
//   5 · race accent TEXT on surf-3 ≥ 4.5:1 for all six races  (A.3 table)
//   6 · storefront seam guards (visual-pass-1-storefront.md §3 — locked):
//         · EARNED badge & gold CTA: #11161d on purity ≥ 4.5:1
//         · WHITE-ON-GOLD BANNED: #fff on purity must stay < 4.5:1 (so nobody
//           can ever ship white text on the gold CTA — 1.44:1 today)
//         · price chips: --text-1 on surf-4 ≥ 4.5:1; DEED·LOCKED chip
//           --text-2 on surf-4 ≥ 4.5:1
//   7 · single source of truth: RACES[].accent/accentText in game/races.ts
//       exactly equal the --race-<id>-accent/-text tokens in app.css (A.3)
//
// Run:  cd /home/team/shared/wcag-tests && bun run wcag-verify.ts
// ============================================================================
import { readFileSync, existsSync } from "node:fs";

const SITE = "/home/team/shared/site";
const CSS = `${SITE}/src/styles/app.css`;
const RACES_TS = `${SITE}/src/game/races.ts`;
for (const f of [CSS, RACES_TS]) {
  if (!existsSync(f)) {
    console.error(`MISSING SOURCE FILE: ${f}`);
    process.exit(1);
  }
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

// ---- token parsing --------------------------------------------------------
const css = readFileSync(CSS, "utf8");

/** Pull `--name: value` custom props out of one block of css text. */
function parseTokens(block: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

function extractBlock(src: string, open: RegExp, close: string): string {
  const start = src.search(open);
  if (start < 0) return "";
  const end = src.indexOf(close, start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

const themeBlock = extractBlock(css, /@theme\s*\{/, "}");
const rootBlock = extractBlock(css, /:root\s*\{/, "/* 3");
const theme = parseTokens(themeBlock);
const root = parseTokens(rootBlock);

// Map spec-name token -> its @theme --color-* counterpart.
const hexToken = (name: string): string | undefined =>
  root.get(`--${name}`)?.match(/#[0-9a-fA-F]{6}/)?.[0]?.toLowerCase();

const themeCounterpart = (name: string): string | undefined =>
  theme.get(`--color-${name}`)?.match(/#[0-9a-fA-F]{6}/)?.[0]?.toLowerCase();

// ---- WCAG math ------------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
function channelL(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelL(r) + 0.7152 * channelL(g) + 0.0722 * channelL(b);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
const r1 = (n: number) => Math.round(n * 100) / 100;
const pair = (fg: string, bg: string) =>
  `${fg} on ${bg} = ${r1(contrast(fg, bg))}:1`;

console.log("— 1 · token presence + @theme/:root sync —");
{
  const required = [
    "surf-0", "surf-1", "surf-2", "surf-3", "surf-4",
    "text-1", "text-2", "text-3",
    "ember", "ember-soft", "hazard", "hazard-soft",
    "corrupt-text", "purity", "danger", "danger-soft", "focus",
  ];
  for (const t of required) {
    check(`token --${t} present with a hex`, hexToken(t) !== undefined);
  }
  for (const t of required) {
    check(
      `@theme --color-${t} in sync with :root --${t} (${hexToken(t) ?? "?"})`,
      hexToken(t) !== undefined &&
        themeCounterpart(t) !== undefined &&
        hexToken(t) === themeCounterpart(t),
      `${hexToken(t)} vs ${themeCounterpart(t)}`,
    );
  }
  check(
    "race accent token block present (grays..watchers)",
    ["grays", "nephilim", "draconians", "anunnaki", "ashtar", "watchers"].every(
      (id) => hexToken(`race-${id}-accent`) && hexToken(`race-${id}-text`),
    ),
  );
}

console.log("— 2 · normal text ≥ 4.5:1 on surf-2 AND surf-3 (A.1) —");
{
  for (const t of ["text-1", "text-2"]) {
    for (const surf of ["surf-2", "surf-3"]) {
      const fg = hexToken(t)!;
      const bg = hexToken(surf)!;
      check(
        `--${t} on ${surf} ${pair(fg, bg)} ≥ 4.5`,
        contrast(fg, bg) >= 4.5,
      );
    }
  }
}

console.log("— 3 · muted text --text-3 ≥ 5.0:1 on surf-2 AND surf-3 (A.1 claim) —");
{
  for (const surf of ["surf-2", "surf-3"]) {
    const fg = hexToken("text-3")!;
    const bg = hexToken(surf)!;
    check(
      `--text-3 on ${surf} ${pair(fg, bg)} ≥ 5.0`,
      contrast(fg, bg) >= 5.0,
    );
  }
}

console.log("— 4 · UI / large text ≥ 3:1 — every functional color on surf-2 AND surf-3 (A.2) —");
{
  const functional = [
    "ember", "ember-soft", "hazard", "hazard-soft",
    "corrupt-text", "purity", "danger", "danger-soft", "focus",
  ];
  for (const t of functional) {
    for (const surf of ["surf-2", "surf-3"]) {
      const fg = hexToken(t)!;
      const bg = hexToken(surf)!;
      check(
        `--${t} on ${surf} ${pair(fg, bg)} ≥ 3.0`,
        contrast(fg, bg) >= 3.0,
      );
    }
  }
}

console.log("— 5 · race accent TEXT ≥ 4.5:1 on surf-3 (A.3 contract) —");
{
  // Note: the spec's A.3 "Ratio" column was computed on the darkest surface
  // (surf-0). The CONTRACT is ≥4.5:1 on surf-3 (the sheet/modal surface where
  // race accent text actually renders) — asserted here; the spec figure is
  // printed for reference only.
  const specClaim: Record<string, number> = {
    grays: 11.4, nephilim: 6.7, draconians: 9.4,
    anunnaki: 12.9, ashtar: 12.6, watchers: 7.0,
  };
  for (const [id, spec] of Object.entries(specClaim)) {
    const fg = hexToken(`race-${id}-text`)!;
    const bg = hexToken("surf-3")!;
    const c = contrast(fg, bg);
    check(
      `--race-${id}-text on surf-3 ${pair(fg, bg)} ≥ 4.5 (spec ratio ${spec}:1 was on surf-0)`,
      c >= 4.5,
    );
  }
}

console.log("— 6 · storefront seam guards (visual-pass-1-storefront.md §3) —");
{
  const purity = hexToken("purity")!;
  const ink = "#11161d";
  const cInk = contrast(ink, purity);
  check(`EARNED badge / gold CTA black-on-gold ${pair(ink, purity)} ≥ 4.5`, cInk >= 4.5);
  const cWhite = contrast("#ffffff", purity);
  check(
    `WHITE-ON-GOLD BANNED: #fff on purity ${cWhite.toFixed(2)}:1 < 4.5 (1.44:1 today)`,
    cWhite < 4.5,
    `white-on-gold would now pass AA — remove it anyway, black is canon`,
  );
  const t1on4 = contrast(hexToken("text-1")!, hexToken("surf-4")!);
  check(`price chip --text-1 on surf-4 ${pair(hexToken("text-1")!, hexToken("surf-4")!)} ≥ 4.5`, t1on4 >= 4.5);
  const t2on4 = contrast(hexToken("text-2")!, hexToken("surf-4")!);
  check(`DEED·LOCKED chip --text-2 on surf-4 ${pair(hexToken("text-2")!, hexToken("surf-4")!)} ≥ 4.5`, t2on4 >= 4.5);
}

console.log("— 7 · single source of truth: races.ts accent/accentText == app.css tokens (A.3) —");
{
  const racesSrc = readFileSync(RACES_TS, "utf8");
  const ids = ["grays", "nephilim", "draconians", "anunnaki", "ashtar", "watchers"];
  // RACES[] is in canonical order; read accent/accentText pairs in order.
  const accPairs: Array<[string, string]> = [];
  const re = /accent:\s*"(#[0-9a-fA-F]{6})"[^]*?accentText:\s*"(#[0-9a-fA-F]{6})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(racesSrc)) !== null) accPairs.push([m[1].toLowerCase(), m[2].toLowerCase()]);
  check("races.ts has exactly 6 accent/accentText pairs (one per race)", accPairs.length === 6, `got ${accPairs.length}`);
  ids.forEach((id, i) => {
    const [acc, txt] = accPairs[i] ?? ["", ""];
    check(
      `race #${i + 1} (${id}) accent ${acc} == --race-${id}-accent ${hexToken(`race-${id}-accent`)}`,
      acc === hexToken(`race-${id}-accent`),
      `${acc} vs ${hexToken(`race-${id}-accent`)}`,
    );
    check(
      `race #${i + 1} (${id}) accentText ${txt} == --race-${id}-text ${hexToken(`race-${id}-text`)}`,
      txt === hexToken(`race-${id}-text`),
      `${txt} vs ${hexToken(`race-${id}-text`)}`,
    );
  });
}

console.log("— 8 · circuit §5 color table machine-enforced (circuit-fullscreen-page.md §5) —");
{
  const TOK = `${SITE}/src/game/circuit-tokens.ts`;
  const PAGE = `${SITE}/src/components/CircuitPage.tsx`;
  for (const f of [TOK, PAGE]) {
    if (!existsSync(f)) { console.error(`MISSING SOURCE FILE: ${f}`); process.exit(1); }
  }
  const tok = readFileSync(TOK, "utf8");
  const page = readFileSync(PAGE, "utf8");
  const hexOf = (re: RegExp): string | undefined => tok.match(re)?.[1]?.toLowerCase();
  // TIER_COLORS (V8 canon; same on all six worlds — global functional depth)
  const t1 = hexOf(/TIER_COLORS[\s\S]*?1:\s*"(#[0-9a-fA-F]{6})"/);
  const t2 = hexOf(/TIER_COLORS[\s\S]*?2:\s*"(#[0-9a-fA-F]{6})"/);
  const t3 = hexOf(/TIER_COLORS[\s\S]*?3:\s*"(#[0-9a-fA-F]{6})"/);
  check("TIER_COLORS[1] == #4d7cc7 (V8 canon)", t1 === "#4d7cc7", `${t1}`);
  check("TIER_COLORS[2] == #a78bfa (V8 canon)", t2 === "#a78bfa", `${t2}`);
  check("TIER_COLORS[3] == #fb923c (V8 canon)", t3 === "#fb923c", `${t3}`);
  // KIND_COLORS (kind fills — heart/near/cradle; rim carries the tier)
  const heart = hexOf(/heart:\s*"(#[0-9a-fA-F]{6})"/); // KIND_COLORS precedes RING_COLORS in the file
  const near = hexOf(/near:\s*"(#[0-9a-fA-F]{6})"/);
  const cradle = hexOf(/cradle:\s*"(#[0-9a-fA-F]{6})"/);
  check("KIND_COLORS.heart == #7f1d1d", heart === "#7f1d1d", `${heart}`);
  check("KIND_COLORS.near == #18181b", near === "#18181b", `${near}`);
  check("KIND_COLORS.cradle == #14532d", cradle === "#14532d", `${cradle}`);
  // TRACE_COLORS
  const road = hexOf(/road:\s*"(#[0-9a-fA-F]{6})"/);
  const ruin = hexOf(/ruin:\s*"(#[0-9a-fA-F]{6})"/);
  const severed = hexOf(/severed:\s*"(#[0-9a-fA-F]{6})"/);
  check("TRACE_COLORS.road == #8f9bb3", road === "#8f9bb3", `${road}`);
  check("TRACE_COLORS.ruin == #b45309", ruin === "#b45309", `${ruin}`);
  check("TRACE_COLORS.severed == #7f1d1d", severed === "#7f1d1d", `${severed}`);
  // §5 contrast contract (PASS column holds verbatim)
  const surf0 = hexToken("surf-0")!;
  if (t1 && t2 && t3 && heart && cradle && road && ruin) {
    const pairs: Array<[string, string, number]> = [
      [t1, surf0, 4.5], // tier 1 pip — spec 4.76:1 PASS
      [t2, surf0, 4.5], // tier 2 pip — spec 7.31:1 PASS
      [t3, surf0, 4.5], // tier 3 pip — spec 8.79:1 PASS
      ["#fdba74", heart, 4.5], // heart label — spec 5.94:1 PASS
      ["#fde68a", cradle, 4.5], // cradle label — spec 7.32:1 PASS
      [road, surf0, 3.0], // conductor lane — spec ~3.3:1 UI OK
      [ruin, surf0, 3.0], // burnt pass — spec 3.96:1 UI OK
    ];
    for (const [fg, bg, min] of pairs) {
      check(`§5 ${fg} on ${bg} ${pair(fg, bg)} ≥ ${min}`, contrast(fg, bg) >= min);
    }
  } else {
    check("§5 contrast pairs resolvable from circuit-tokens.ts", false, "missing parsed hex");
  }
  // §5 single-source law: ZERO hex literals in the page component.
  const hexes = page.match(/#[0-9a-fA-F]{6}/g) ?? [];
  check(
    "CircuitPage.tsx has ZERO hex literals (renderer imports circuit-tokens.ts)",
    hexes.length === 0,
    `found: ${hexes.join(", ")}`,
  );
  // §8 extension (circuit-map-layout-spec.md §4/§6): the label halo is ONE new
  // token, it IS --surf-0, and the new pure label module carries no colour at
  // all — so the map label layer can never grow a second palette.
  const halo = tok.match(/halo:\s*"(#[0-9a-fA-F]{6})"/)?.[1]?.toLowerCase();
  check("LABEL_COLORS.halo parses to a hex", halo !== undefined, `${halo}`);
  check(
    `LABEL_COLORS.halo ${halo} == --surf-0 ${surf0} (the label halo is not a new hue)`,
    halo === surf0,
    `${halo} vs ${surf0}`,
  );
  check(
    "the label halo is applied as paint-order:stroke 3 units (the AA-over-traces fix)",
    /paintOrder:\s*"stroke"/.test(page) && /stroke:\s*LABEL_COLORS\.halo/.test(page) && /strokeWidth:\s*3/.test(page),
  );
  const LABELS = `${SITE}/src/game/circuit-labels.ts`;
  if (!existsSync(LABELS)) {
    console.error(`MISSING SOURCE FILE: ${LABELS}`);
    process.exit(1);
  }
  const labelsSrc = readFileSync(LABELS, "utf8");
  const labelHexes = labelsSrc.match(/#[0-9a-fA-F]{6}/g) ?? [];
  check(
    "circuit-labels.ts has ZERO hex literals (labels carry no colour of their own)",
    labelHexes.length === 0,
    `found: ${labelHexes.join(", ")}`,
  );
}

console.log("— 9 · shell geometry + token discipline (game-ui-shell-spec §5.1/§9.1) —");
{
  // 1 · the seven size tokens, read from the SAME :root slice, against floors.
  const px = (n: string): number => {
    const v = root.get(`--${n}`);
    if (!v) return -1;
    const m = v.match(/([0-9.]+)(rem|px)/);
    if (!m) return -1;
    return m[2] === "rem" ? parseFloat(m[1]) * 16 : parseFloat(m[1]);
  };
  const floors: Array<[string, number]> = [
    ["spacing-ribbon", 44], ["spacing-nav", 44], ["spacing-dock", 44],
    ["spacing-tap", 44], ["spacing-tap-lg", 48],
  ];
  for (const [t, floor] of floors) {
    check(`--${t} = ${px(t)}px ≥ ${floor}px`, px(t) >= floor, `${root.get(`--${t}`)}`);
  }
  // 2 · shape: the tile radius, and the 11px caption floor.
  check(`--radius-tile parses and equals 1rem (16px)`, px("radius-tile") === 16, `${root.get("--radius-tile")}`);
  check(`--text-nav = ${px("text-nav")}px ≥ 11 (the caption floor)`, px("text-nav") >= 11, `${root.get("--text-nav")}`);
  // 3 · @theme and :root stay in sync for every NEW token (mirror §1's rule).
  const NEW_TOKENS = ["spacing-ribbon", "spacing-nav", "spacing-dock", "spacing-tap", "spacing-tap-lg", "radius-tile", "text-nav"];
  for (const t of NEW_TOKENS) {
    check(`--${t} present in BOTH blocks and in sync`, !!root.get(`--${t}`) && root.get(`--${t}`) === theme.get(`--${t}`), `${root.get(`--${t}`)} vs ${theme.get(`--${t}`)}`);
  }
  const ut = readFileSync(CSS, "utf8");
  for (const u of ["@utility pill", "@utility eyebrow", ".plate-ground", ".app-shell", ".shell-body", ".botnav"]) {
    check(`${u} utility present`, ut.includes(u));
  }
  check("the shell tokens are SIZE/SHAPE ONLY (no colour token added in §A.6)", !/--(?:color-)?(?:shell|ribbon|nav|dock|tap)[a-z-]*:\s*#/.test(ut));
  // 4 · zero hex literals in the new shell/ui components (mirrors the CircuitPage rule).
  const fs = require("node:fs") as typeof import("node:fs");
  const dirs = [`${SITE}/src/components/shell`, `${SITE}/src/components/ui`, `${SITE}/src/components/screens`];
  const NEW: string[] = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith(".tsx")) NEW.push(`${d}/${f}`);
  }
  check(`the new shell/ui components exist to be checked (${NEW.length} files)`, NEW.length >= 5, `${NEW.length}`);
  let hexes: string[] = [];
  for (const f of NEW) {
    const src = readFileSync(f, "utf8");
    for (const h of src.match(/#[0-9a-fA-F]{6}/g) ?? []) hexes.push(`${f.split("/").pop()}:${h}`);
  }
  check("ZERO hex literals in the new shell/ui components", hexes.length === 0, hexes.join(", "));
  // 5 · the §6 sweep, machine-enforced on the new components. The one documented
  //     exception is the Battles aid family (sky-400, battles-panel spec §A.1).
  const HUE = /(amber|red|rose|lime|purple|fuchsia|cyan|emerald|gray|white\/|black\/)(-[0-9]{2,3})?/g;
  const ALLOW = /sky-400/g;
  const off: string[] = [];
  for (const f of NEW) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/"[^"\n]*"/g)) {
      const cls = m[0];
      if (!/(^|\s)[a-z-]+:/.test(cls) && !/bg-|text-|border-|from-|to-/.test(cls)) continue;
      const hits = (cls.replace(ALLOW, "").match(HUE) ?? []);
      for (const h of hits) off.push(`${f.split("/").pop()}: ${h.trim()} in ${cls.slice(0, 60)}`);
    }
  }
  check("no Tailwind palette hue in the new components (§6 sweep is machine-enforced)", off.length === 0, off.join(" | "));
}

console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);