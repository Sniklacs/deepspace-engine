// string-inventory.ts — THE UNTRANSLATED-STRING SCOREBOARD (re-based 2026-09-28).
//
// Run (the one command, from the served tree's runner):
//   cd /home/team/shared/i18n-tests && env -u DATABASE_URL bun run string-inventory.ts
//
// It prints the figure the language KPI quotes: un-keyed OCCURRENCES, DISTINCT
// strings, CATALOGUE KEYS (read from the catalogue files, never typed), and the
// numeral-in-value class (shipped keys + un-keyed strings). It exits non-zero
// only if its own controls fail.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE WAS REWRITTEN (two filed defects, both verified here)
// ---------------------------------------------------------------------------
// 1. IT PRINTED STALE LABELS. The old file reported "265 TOTAL keyed keys" and
//    a header count of 371. Both were typed/derived, not read: 371 came from a
//    regex that only matched `^  "[a-zA-Z0-9.]+":` and so missed every hyphenated
//    key (`store.pack.scavengers-kit.blurb` and its 22 siblings), and 265 was a
//    hand-typed prefix list summed at print time. The real catalogue is READ HERE
//    from `src/game/i18n/langs/*.ts` — all five files, with parity asserted.
// 2. ITS LINE REGEX MISSED JSX TEXT. It scanned one line at a time and took the
//    FIRST `>…<` pair on that line, so it missed (a) a text node that follows an
//    element on the same line — `<b>{n}</b> lines waiting` — and (b) every
//    text node whose own line carries no angle bracket, which is the normal shape
//    of a wrapped JSX paragraph:
//        <p>
//          The Last Academy holds the Ashline.
//        </p>
//    This file now parses each file with the TypeScript compiler and walks REAL
//    JSX TEXT NODES. §CONTROLS plants both shapes and proves the old regex misses
//    them and this walker catches them; §LEGACY prints both counts over the same
//    file set so the size of what the old scanner missed is visible, not argued.
//
// ---------------------------------------------------------------------------
// WHAT COUNTS AS ONE UN-KEYED PLAYER-FACING STRING (classes A–D)
// ---------------------------------------------------------------------------
//   A. JSX TEXT NODES — every `ts.isJsxText` node with a letter in it, however
//      the line is wrapped. (This is the class defect 2 blocked.)
//   B. JSX CHILD EXPRESSIONS — a string or template literal rendered from a
//      brace child (`{busy ? "Climbing…" : "Take the field"}`).
//   C. PLAYER-FACING PROPS — a literal in aria-label/aria-valuetext/title/
//      placeholder/alt/label/sub/subtitle/reason/note.
//   D. ENGINE PROSE — a string literal in a data table that reads as a sentence
//      under the rule in `proseLike()` below (has a space, has letters, is not a
//      key/CSS class/URL/identifier/developer string).
// A literal inside `t()`/`tf()`/`splitValue()`/`joinValue()` is KEYED and never
// counted; neither are comments (the AST contains none), `.gen.ts` files, module
// specifiers, `console.*`/`throw new Error` text, or `src/game/i18n/**`.
//
// ---------------------------------------------------------------------------
// HONEST LIMITS — what this counter still cannot see (also printed, §LIMITS)
// ---------------------------------------------------------------------------
//  * It counts SOURCE, not render. A string only reachable behind a false flag
//    (StorefrontOverlay's buy controls) is counted; a string built at runtime
//    out of fragments this scan cannot join is not.
//  * The Chronicle and the Fall's opening write ENGLISH PROSE INTO THE SAVE
//    (`state.log`, `GameSummary.summary`, the prologue's history/names books).
//    Those are persisted strings: a source scan can see the templates that make
//    them (`game/api.ts`, `game/prologue/*`), never the rows already written into
//    an existing save. Two data-shape changes, not a keying pass, close it.
//  * Engine refusal sentences built at call time (`fail(...)`, `failKey(...)`,
//    `domainEffect` prose) are visible only as the template; the interpolation is
//    a numeral, so those strings are counted in §NUMERAL, not as fixed text.
//  * Season-tier labels live in `monetization.ts` and are counted there; the
//    overlay that paints 79 of those rows contributes only its own chrome.
//  * Anything outside `src/` — `public/manifest.webmanifest`, `sw.js`, the
//    installed app's home-screen label (English for everyone, accepted limit).
//  * `src/game/i18n/**` is excluded by rule (it IS the translation system, and
//    its five catalogue files are counted as catalogue keys instead).
//  * "Distinct" is a global de-duplication of the counted text; a string that
//    repeats 35 times in `api.ts` is 35 occurrences and 1 distinct string.
//  * A numeral-bearing string is detected from its TEXT (`\d` or an
//    interpolation). Whether that interpolation can actually print a numeral is
//    a call-site question: §NUMERAL classifies each placeholder by the shape of
//    the argument passed to it, which is a heuristic, and it is labelled as one.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";

const SITE = "/home/team/shared/site";
const read = (p: string) => readFileSync(`${SITE}/${p}`, "utf8");

// TypeScript lives in the served tree's node_modules (the suites run from
// /home/team/shared/<x>-tests, which has none of its own).
const req = createRequire(import.meta.url);
function loadTs(): any {
  for (const p of [`${SITE}/node_modules/typescript/lib/typescript.js`, "typescript"]) {
    try { return req(p); } catch { /* try the next candidate */ }
  }
  throw new Error("typescript not found (looked in the served tree's node_modules)");
}
const ts = loadTs();

// ---- exclusions -----------------------------------------------------------
const EXCLUDE_FILE = [
  /\.gen\.tsx?$/,            // routeTree.gen.ts — generated
  /^src\/game\/i18n\//,      // the translation system itself + its catalogues
  /^src\/db\.ts$/,           // SQL text, server-only, never rendered
  /^src\/styles\//,
];
const KEYED_CALLS = new Set(["t", "tf", "splitValue", "joinValue"]);
const FORMAT_CALLS = /^(format|fmt)/;
const DEV_CALLS = /^(console\.|console$)/;
/** props whose value a player is told/hears */
const PLAYER_PROPS = new Set([
  "aria-label", "ariaLabel", "aria-valuetext", "aria-description", "aria-description-text",
  "title", "placeholder", "alt", "label", "sub", "subtitle", "reason", "note",
]);
/** property names that can never be prose (structure, styling, identity) */
const STRUCT_PROPS = new Set([
  "id", "key", "type", "role", "slug", "css", "className", "style", "href", "to", "src",
  "icon", "emoji", "color", "hash", "sha", "sha256", "checksum", "mime", "version", "lang",
  "locale", "dir", "path", "route", "ref", "testid", "data-testid", "event", "kind", "tag",
  "unit", "method", "status", "errorKey", "code", "variant", "tone", "size", "align",
  "k", "params", "as", "content", "value", "amount", "tier", "index", "symbol", "glyph",
]);
/** property names under which a single capitalized word is still player copy */
const LABELISH_PROPS = new Set([
  "name", "label", "title", "text", "line", "lines", "blurb", "note", "noteText", "flavor",
  "flavorQuote", "lore", "homeRegion", "frontName", "frontLine", "chorusName", "what", "does",
  "how", "cue", "cueText", "prompt", "placeholder", "desc", "description", "sub", "subtitle",
  "reason", "error", "summary", "tagline", "worldName", "unit", "currencyNames", "effect",
  "effects", "mandate", "roleLine", "badge", "chip", "heading", "header", "eyebrow", "caption",
  "empty", "emptyText", "hint", "waiting", "readyText", "shortDuration",
]);
const ALLOW_TEXT = /^[\s✓·—–→/%:+×°.,!?()&'"-]*$/;
/** English literals passed as the FALLBACK of a `t(key, "English")` call. The key
 *  exists, so the player reads the translation, not this literal: it is keyed-ish
 *  and excluded from the scoreboard (counted, and printed, in §5). */
const FALLBACK_LITERALS = new Set<string>();

type Kind = "A jsx-text" | "B jsx-child" | "C player-prop" | "D data-prose";
type Hit = { file: string; line: number; kind: Kind; text: string; numeral: boolean; note?: string };

const stripTemplate = (s: string) => s.replace(/\$\{[^}]*\}/g, "0");
/** a numeral can reach the player from this literal: a digit in the text, or an
 *  interpolation whose expression is numeric-shaped (never "any template"). */
const NUM_EXPR = /\d|Math\.|\.length\b|\.size\b|toFixed|toLocaleString|formatNumber|parseInt|\bcount\b|\bamount\b|\bpercent\b|\bindex\b|\bi\b|\bn\b/;
function numeralIn(node: any, text: string): boolean {
  if (/\d/.test(text)) return true;
  if (ts.isTemplateExpression(node)) {
    if (/\d/.test(stripTemplate(text))) return true;
    return node.templateSpans.some((sp: any) => NUM_EXPR.test(sp.expression.getText()));
  }
  return false;
}

function proseLike(s: string): boolean {
  if (s.length < 3) return false;
  if (!/[A-Za-z]/.test(s)) return false;
  if (!/\s/.test(s)) return false;
  if (/:\/\/|^\/|^\.\/|^#/.test(s)) return false;
  if (/^(select|insert|update|delete|create table|alter|drop)\b/i.test(s)) return false;
  const st = stripTemplate(s);
  if (/^[a-z0-9\s\-_./:[\]{}#%()]+$/.test(st)) return false;      // keys, css, ids (all lowercase)
  if (/^[\d\s.,:%+×xX\-/()]+$/.test(st)) return false;             // numbers only
  // a space-separated string of lowercase, hyphen-bearing tokens is a class list
  const toks = st.trim().split(/\s+/);
  if (toks.length > 1 && toks.every((t) => /^[a-z0-9[\]#%:._/-]+$/.test(t) && t.includes("-"))) return false;
  return true;
}
function singleWordLike(s: string): boolean {
  return /^[A-Z][A-Za-z'’.-]{2,99}$/.test(s.trim());
}

// ---- the JSX walker (defect 2's fix) --------------------------------------
function collectHits(file: string, src: string): Hit[] {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const hits: Hit[] = [];
  const lineOf = (n: any) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const raw = (n: any) => src.slice(n.getStart(sf), n.getEnd());
  const push = (n: any, k: Kind, text: string, note?: string) => {
    const t = text.trim();
    // a template that is nothing but interpolations and punctuation (`${w.id}:${action}`)
    // is an id, not copy: the test is on the SHAPED text, so `{n} lines waiting` stays.
    const shaped = stripTemplate(t);
    if (!t || !/[A-Za-z]/.test(shaped) || ALLOW_TEXT.test(t)) return;
    hits.push({ file, line: lineOf(n), kind: k, text: t, numeral: numeralIn(n, t), note });
  };
  /** Is this literal on a path that RENDERS? Each ancestor between it and the
   *  enclosing JSX expression must be transparent (parens, ternary, `+`/`&&`/`||`/
   *  `??`, a template, nested JSX, or a concise arrow body — the `list.map(x =>
   *  \`${x.n} items\`)` shape). A block body is not: `const k = \`${w.id}:${action}\``
   *  inside a map callback is an id, and a block holds IDs far more often than copy. */
  const rendersToPlayer = (n: any): boolean => {
    let p: any = n.parent;
    while (p) {
      if (ts.isJsxExpression(p) || ts.isJsxAttribute(p)) return true;
      if (ts.isJsxElement(p) || ts.isJsxFragment(p) || ts.isJsxSelfClosingElement(p)) return true;
      if (ts.isParenthesizedExpression(p) || ts.isConditionalExpression(p) || ts.isTemplateExpression(p) || ts.isTemplateSpan(p)) { p = p.parent; continue; }
      if (ts.isBinaryExpression(p) && /\+|&&|\|\||\?\?/.test(p.operatorToken.getText())) { p = p.parent; continue; }
      if (ts.isArrowFunction(p) && !ts.isBlock(p.body)) { p = p.parent; continue; }
      return false;
    }
    return false;
  };
  const literalText = (n: any): string | null => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    // a template literal is shown as written (interpolations intact) — the prose
    // test strips them, the reader should see them
    if (ts.isTemplateExpression(n)) return raw(n).replace(/^`|`$/g, "");
    return null;
  };
  /** is this literal an argument of t()/tf()/splitValue()/joinValue() or a format helper? */
  const isKeyed = (n: any): boolean => {
    const p = n.parent;
    if (!p) return false;
    if (ts.isCallExpression(p) && p.arguments.includes(n)) {
      const c: any = p.expression;
      const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "";
      if (KEYED_CALLS.has(name) || FORMAT_CALLS.test(name)) return true;
    }
    if (ts.isJsxAttribute(p)) {
      const nm = p.name.getText(sf);
      if (nm === "k" || nm === "params") return true;
    }
    return false;
  };
  const isDev = (n: any): boolean => {
    let p: any = n.parent;
    for (let i = 0; i < 4 && p; i++, p = p.parent) {
      if (ts.isThrowStatement(p)) return true;
      if (ts.isCallExpression(p)) {
        const c: any = p.expression;
        const txt = c && c.getText ? c.getText(sf) : "";
        if (DEV_CALLS.test(txt) || /^console\./.test(txt)) return true;
      }
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isImportTypeNode(p)) return true;
    }
    return false;
  };
  /** nearest enclosing property name, for prose classification */
  const propNameOf = (n: any): string | null => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isPropertyAssignment(p)) { const nm = p.name; return ts.isIdentifier(nm) || ts.isStringLiteral(nm) ? nm.text : null; }
      if (ts.isJsxAttribute(p)) return p.name.getText(sf);
      if (ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p)) return null;
    }
    return null;
  };
  const inJsx = (n: any): boolean => { for (let p = n.parent; p; p = p.parent) if (ts.isJsxElement(p) || ts.isJsxFragment(p) || ts.isJsxSelfClosingElement(p)) return true; return false; };
  const inAttrOfJsx = (n: any): boolean => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isJsxAttribute(p)) return true;
      if (ts.isJsxElement(p) || ts.isJsxFragment(p)) return false;
    }
    return false;
  };
  /** sinks whose string argument the player reads/hears (flash/setError/toast/…) */
  const PLAYER_SINKS = /^(flash|setError|setFlash|setToast|toast|alert|tip|setNote|setMsg|speak|say)$/;
  const COMPARISONS = new Set([
    ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken,
  ]);
  /** Reasons a literal inside a brace child is DATA, not copy — each one named
   *  because a false positive here inflates the scoreboard: a comparison operand
   *  (`tab === "circuit"`), an element of an id array (`(["signup","login"])`), a
   *  switch case, a property access object, an object-literal value (data tables:
   *  judged by the same prose rule as class D), or an argument to a call that is
   *  not a player-facing sink (`act(fn, "purify")`). */
  const dataNotCopy = (n: any, isChildExpr: boolean): boolean => {
    let p: any = n.parent;
    if (p && ts.isBinaryExpression(p) && COMPARISONS.has(p.operatorToken.kind)) return true;
    if (p && ts.isPropertyAccessExpression(p) && p.name === n) return true;
    if (p && ts.isArrayLiteralExpression(p)) return true;
    for (let a: any = n.parent, i = 0; a && i < 6; a = a.parent, i++) {
      if (ts.isCaseClause(a) || ts.isCaseOrDefaultClause?.(a)) return true;
      if (ts.isCallExpression(a) && a.arguments.includes(n)) {
        const c: any = a.expression;
        const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "";
        if (!isChildExpr || !PLAYER_SINKS.test(name)) { if (isChildExpr) return true; }
      }
      if (ts.isJsxExpression(a) || ts.isJsxAttribute(a)) break;
    }
    return false;
  };
  const attrNameOf = (n: any): string | null => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isJsxAttribute(p)) return p.name.getText(sf);
      if (ts.isJsxElement(p) || ts.isJsxFragment(p)) return null;
    }
    return null;
  };

  const visit = (n: any): void => {
    // A. JSX TEXT NODES — the class the old line scanner missed
    if (ts.isJsxText(n)) {
      push(n, "A jsx-text", n.text);
      return;
    }
    // C. literal player-facing props (in any JSX element, anywhere)
    if (ts.isJsxAttribute(n) && PLAYER_PROPS.has(n.name.getText(sf))) {
      const init: any = n.initializer;
      if (init && ts.isStringLiteral(init)) push(init, "C player-prop", init.text, n.name.getText(sf));
      else if (init && ts.isJsxExpression(init) && init.expression) {
        const walkAttr = (x: any) => {
          const lit = literalText(x);
          if (lit !== null && !isKeyed(x) && !isDev(x)) push(x, "C player-prop", lit, n.name.getText(sf));
          x.forEachChild(walkAttr);
        };
        walkAttr(init.expression);
      }
      return;
    }
    // literal string/template nodes
    const lit = literalText(n);
    if (lit !== null && !isKeyed(n) && !isDev(n)) {
      const isPropName = ts.isPropertyAssignment(n.parent) && n.parent.name === n;
      if (!isPropName) {
        const attr = attrNameOf(n);
        if (attr !== null) {
          if (PLAYER_PROPS.has(attr) && (ts.isJsxExpression(n.parent) || !inJsx(n))) push(n, "C player-prop", lit, attr);
        } else if (inJsx(n)) {
          // B. rendered from a brace child — unless it is data, not copy
          const pn = propNameOf(n);
          if (pn === "className" || pn === "style") { /* structural */ }
          else if (!rendersToPlayer(n)) { /* an id/constant on a block path, not rendered */ }
          else if (dataNotCopy(n, true)) { /* data, not copy */ }
          else push(n, "B jsx-child", lit, pn ?? undefined);
        } else {
          // D. engine prose / data tables
          const pn = propNameOf(n) ?? "";
          if (FALLBACK_LITERALS.has(lit)) { /* the fallback of an existing key */ }
          else if (!STRUCT_PROPS.has(pn) && (proseLike(lit) || (LABELISH_PROPS.has(pn) && singleWordLike(lit)))) {
            push(n, "D data-prose", lit, pn || undefined);
          }
        }
      }
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return hits;
}

// ---- the legacy scanner, kept only to MEASURE what it missed --------------
const LEGACY_TEXT = />([^<>{}=;&!|]*[A-Za-z][^<>{}=;&!|]*)</;
const LEGACY_PROP = /\b(aria-label|title|placeholder|alt|label|sub|subtitle|reason|note)="([^"]+[A-Za-z][^"]*)"/;
const LEGACY_KEYED = /\bt\(\s*["'`]/;
/** what the OLD scanner matched, kept only so the miss can be named string by string */
function legacyHits(src: string): string[] {
  const out: string[] = [];
  for (const line of src.split("\n")) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line) || LEGACY_KEYED.test(line)) continue;
    const m = LEGACY_TEXT.exec(line); if (m && !/\{[^}]*\}/.test(m[1])) out.push(m[1]);
    const p = LEGACY_PROP.exec(line); if (p) out.push(p[2]);
  }
  return out;
}
function legacyCount(src: string): number { return legacyHits(src).length; }

// ---- the catalogue (defect 1's fix: READ, never typed) --------------------
const LANGS = ["en", "es", "fa", "pt-BR", "ru"];
type Cat = { keys: string[]; values: Map<string, string> };
function readCatalogue(lang: string): Cat {
  const file = `src/game/i18n/langs/${lang}.ts`;
  const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const keys: string[] = [];
  const values = new Map<string, string>();
  const visit = (n: any): void => {
    if (ts.isPropertyAssignment(n) && (ts.isStringLiteral(n.name) || ts.isIdentifier(n.name))) {
      const k = ts.isStringLiteral(n.name) ? n.name.text : n.name.text;
      if (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer)) {
        keys.push(k); values.set(k, n.initializer.text);
      }
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return { keys, values };
}
const catalogues = LANGS.map((l) => ({ lang: l, ...readCatalogue(l) }));
const catEn = catalogues[0];
const keySets = catalogues.map((c) => new Set(c.keys));
const parity = catalogues.map((c, i) => `${c.lang} ${c.keys.length}${i === 0 ? "" : ""}`).join(" · ");
const parityExact = catalogues.every((c) => c.keys.length === catEn.keys.length) &&
  catalogues.slice(1).every((c, i) => [...keySets[0]].every((k) => keySets[i + 1].has(k)) && c.keys.every((k) => keySets[0].has(k)));

// ---- walk the tree --------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(`${SITE}/${dir}`)) {
    const p = `${dir}/${f}`;
    if (statSync(`${SITE}/${p}`).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}
const allFiles = walk("src").filter((p) => !EXCLUDE_FILE.some((r) => r.test(p))).sort();

// ---- reachability: is this file painted by the app today, or dormant? -----
// Source-wide counting and "would a player see it today" are different
// questions, and the filed manual passes answered the second one (they named
// the rail captions, the arms of the prologue and `heroes-data`'s dormant rows
// as excluded). This walks the real import graph from the app's entry points so
// the scoreboard can show BOTH, instead of the reader having to guess which is
// which. Entry points: `src/routes/**` and the router. Server-only files reach
// the graph through the route modules that import them.
import { dirname, posix } from "node:path";
const srcExists = (p: string) => { try { return statSync(`${SITE}/${p}`).isFile(); } catch { return false; } };
function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = posix.normalize(posix.join(dirname(from), spec));
  for (const c of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base]) if (srcExists(c)) return c;
  return null;
}
function importsOf(f: string): string[] {
  const src = read(f);
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, /\.tsx$/.test(f) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: any): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.arguments.length && ts.isStringLiteral(n.arguments[0]) &&
        (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) out.push(n.arguments[0].text);
    n.forEachChild(visit);
  };
  visit(sf);
  return out.map((s) => resolveSpec(f, s)).filter((x): x is string => !!x);
}
const graphFiles = walk("src");
const live = new Set<string>();
const queue = graphFiles.filter((p) => p.startsWith("src/routes/") || p === "src/router.tsx");
for (const q of queue) live.add(q);
while (queue.length) {
  const f = queue.pop() as string;
  for (const dep of importsOf(f)) if (!live.has(dep)) { live.add(dep); queue.push(dep); }
}
const isLive = (p: string) => live.has(p);

// ---- numeral-in-value, shipped half --------------------------------------
const NUMERIC_NAMES = /^(n|num|count|cost|held|amount|percent|pct|rate|level|lvl|days?|hours?|minutes?|mins?|secs?|seconds?|ms|streak|size|done|total|max|cap|tier|index|i|scrip|votives|embers|chipsets|supplies|qty|depth|value|bonus|left|used|owned|need|need_)$/i;
/** every `t("key", {a: expr})` / `<SplitValue k="key" params={{…}}>` call site */
function callSiteArgs(): Map<string, { name: string; expr: string }[]> {
  const out = new Map<string, { name: string; expr: string }[]>();
  const add = (k: string, name: string, expr: string) => {
    if (!k) return;
    const arr = out.get(k) ?? []; arr.push({ name, expr }); out.set(k, arr);
  };
  for (const f of allFiles) {
    const src = read(f);
    const kind = /\.tsx$/.test(f) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, kind);
    const visit = (n: any): void => {
      if (ts.isCallExpression(n) && n.arguments.length >= 2) {
        const c: any = n.expression;
        const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "";
        const a0 = n.arguments[0];
        if (KEYED_CALLS.has(name) && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) && !a0.text.includes("${")) {
          const obj = n.arguments[1];
          if (ts.isObjectLiteralExpression(obj)) {
            for (const p of obj.properties) {
              if (ts.isPropertyAssignment(p)) add(a0.text, p.name.getText(sf), p.initializer.getText(sf));
            }
          } else if (ts.isStringLiteral(obj)) {
            FALLBACK_LITERALS.add(obj.text);   // `t("key", "English fallback")`
          }
        }
      }
      if (ts.isJsxAttribute(n) && n.name.getText(sf) === "k" && n.initializer && ts.isStringLiteral(n.initializer)) {
        const k = n.initializer.text;
        const el: any = n.parent?.parent;
        const params = el?.attributes?.properties?.find((p: any) => ts.isJsxAttribute(p) && p.name.getText(sf) === "params");
        const ex: any = params?.initializer;
        const obj = ex && ts.isJsxExpression(ex) ? ex.expression : null;
        if (obj && ts.isObjectLiteralExpression(obj)) {
          for (const p of obj.properties) if (ts.isPropertyAssignment(p)) add(k, p.name.getText(sf), p.initializer.getText(sf));
        }
      }
      n.forEachChild(visit);
    };
    visit(sf);
  }
  return out;
}
const CALL_SITES = callSiteArgs();
function exprIsNumeral(expr: string, name: string): boolean {
  const e = expr.trim();
  if (NUMERIC_NAMES.test(name)) return true;
  if (/^\d/.test(e)) return true;
  if (/\bMath\.|\.length\b|\.size\b|toFixed|toLocaleString|formatNumber|formatInt|parseInt|Number\(/.test(e)) return true;
  if (/[+\-*/]\s*\d|\d\s*[+\-*/]/.test(e)) return true;
  if (/\bcount\b|\bamount\b|\bpercent\b|\bpercentOf\b/.test(e)) return true;
  return false;
}
const valueDigitKeys: string[] = [];
const placeholderKeys: string[] = [];
const placeholderNumeralKeys: string[] = [];
const placeholderJudged: string[] = [];
for (const [k, v] of catEn.values) {
  if (/\d/.test(v)) valueDigitKeys.push(k);
  const phs = [...v.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]);
  if (phs.length) {
    placeholderKeys.push(k);
    const sites = CALL_SITES.get(k) ?? [];
    let judged = false;
    let numeral = false;
    for (const ph of phs) {
      const named = sites.filter((s) => s.name === ph);
      if (named.length) { judged = true; if (named.some((s) => exprIsNumeral(s.expr, ph))) numeral = true; }
      else if (NUMERIC_NAMES.test(ph)) numeral = true;
    }
    if (judged) placeholderJudged.push(k);
    if (numeral) placeholderNumeralKeys.push(k);
  }
}
const numeralKeys = [...new Set([...valueDigitKeys, ...placeholderNumeralKeys])].sort();

const allHits: Hit[] = [];
const perFile = new Map<string, Hit[]>();
let legacyTotal = 0;
const DEBUG_FILE = (() => { const i = process.argv.indexOf("--file"); return i > -1 ? process.argv[i + 1] : null; })();
for (const f of allFiles) {
  const src = read(f);
  legacyTotal += legacyCount(src);
  const hits = collectHits(f, src);
  for (const h of hits) { (h as any).live = isLive(f); allHits.push(h); }
  if (hits.length) perFile.set(f, hits);
  if (DEBUG_FILE && f.includes(DEBUG_FILE)) {
    console.log(`\n--- DEBUG ${f} (live=${isLive(f)}) — every hit ---`);
    for (const h of hits.sort((x, y) => x.line - y.line)) {
      console.log(`  :${h.line} ${h.kind}${h.note ? ` (${h.note})` : ""} ${h.numeral ? "NUM " : "    "} ${JSON.stringify(h.text.slice(0, 110))}`);
    }
  }
}
const liveHits = allHits.filter((h) => (h as any).live);
const dormantHits = allHits.filter((h) => !(h as any).live);
const distinctOf = (hs: Hit[]) => new Set(hs.map((h) => h.text)).size;

const areaOf = (f: string) => {
  if (f.startsWith("src/routes/")) return "routes";
  if (f.startsWith("src/game/")) {
    const parts = f.split("/");
    return parts.length > 3 ? `game/${parts[2]}/` : "game/";
  }
  if (f.startsWith("src/components/")) {
    const parts = f.split("/");
    return parts.length > 3 ? `components/${parts[2]}/` : "components/";
  }
  return "other";
};
const byArea = new Map<string, { occ: number; distinct: Set<string>; files: Set<string> }>();
for (const h of allHits) {
  const a = byArea.get(areaOf(h.file)) ?? { occ: 0, distinct: new Set<string>(), files: new Set<string>() };
  a.occ++; a.distinct.add(h.text); a.files.add(h.file);
  byArea.set(areaOf(h.file), a);
}
const byKind = new Map<Kind, number>();
for (const h of allHits) byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + 1);

const distinct = new Set(allHits.map((h) => h.text)).size;
const numeralHits = allHits.filter((h) => h.numeral);

// ---- controls (the negative control is the point) -------------------------
// The planted shape is a JSX text node that SHARES A LINE WITH AN ELEMENT. It
// cannot be planted in product code (this slice changes none), so it is planted
// here and driven through the same `collectHits` the real scan uses.
const CONTROL_MISSED = `export const Missed = () => (
  <div>
    <p>
      The Last Academy holds the Ashline.
    </p>
    <span className="chip">Quiet the voices</span> <b>{n}</b> lines waiting
  </div>
);`;
const CONTROL_KEYED = `export const Keyed = () => (
  <div className="wrap">
    <span>{t("nav.colony")}</span>
    <b className="num">{n}</b>
    <SplitValue k="cradle.devotionStreak" params={{ n }} />
  </div>
);`;
const oldTexts = legacyHits(CONTROL_MISSED);
const newHits = collectHits("control-missed.tsx", CONTROL_MISSED);
const newTexts = newHits.map((h) => h.text.trim());
const keyedNew = collectHits("control-keyed.tsx", CONTROL_KEYED);
const keyedOld = legacyHits(CONTROL_KEYED);
const controls: [string, boolean, string][] = [
  ["N1 a text node that shares a line with an element, with no closing tag after it (`</b> lines waiting`) — the old scanner MISSES it, the walker CATCHES it",
    !oldTexts.includes("lines waiting") && newTexts.includes("lines waiting"),
    `old saw ${JSON.stringify(oldTexts)} · new saw ${JSON.stringify(newTexts)}`],
  ["N2 a text node whose own line carries no angle bracket (the wrapped `<p>`) — the old scanner MISSES it, the walker CATCHES it",
    !oldTexts.some((t) => t.includes("The Last Academy holds the Ashline.")) && newTexts.some((t) => t.includes("The Last Academy holds the Ashline.")),
    `old=${oldTexts.length} new=${newTexts.length}`],
  ["N3 the old scanner is NOT blind to every element-shared node — an unwrapped `<span>…</span>` IS caught, so the miss is a shape",
    oldTexts.some((t) => t === "Quiet the voices"),
    `old saw ${JSON.stringify(oldTexts.filter((t) => t === "Quiet the voices"))}`],
  ["N4 on the same fixture the walker finds strictly more than the old scanner",
    newTexts.length > oldTexts.length,
    `old=${oldTexts.length} new=${newTexts.length}`],
  ["P1 a KEYED surface is not counted (no false positive) — `{t(\"nav.colony\")}`, `<SplitValue k=…>`, a bare `{n}` child, a `className`",
    keyedNew.length === 0 && keyedOld.length === 0,
    `old=${keyedOld.length} new=${keyedNew.length}`],
];
const controlsPassed = controls.filter(([, ok]) => ok).length;

// ---- print ----------------------------------------------------------------
const pad = (s: string | number, n: number) => String(s).padStart(n);
const padR = (s: string | number, n: number) => String(s).padEnd(n);
console.log(`\n=== DEEPSPACE UNTRANSLATED-STRING SCOREBOARD — re-based 2026-09-28 ===`);
console.log(`tree: ${SITE}  ·  scanned ${allFiles.length} source files (${allFiles.filter((f) => f.endsWith(".tsx")).length} tsx / ${allFiles.filter((f) => f.endsWith(".ts")).length} ts)`);
console.log(`run:  cd /home/team/shared/i18n-tests && env -u DATABASE_URL bun run string-inventory.ts`);

console.log(`\n§1 SCOREBOARD`);
console.log(`  un-keyed player-facing OCCURRENCES        ${pad(allHits.length, 6)}   (${liveHits.length} in files the app paints today · ${dormantHits.length} in dormant files)`);
console.log(`  DISTINCT strings (global de-dup)          ${pad(distinct, 6)}   (${distinctOf(liveHits)} live · ${distinctOf(dormantHits)} dormant)`);
console.log(`  KEYED catalogue keys (read from the files)${pad(catEn.keys.length, 6)}   ${parity}   parity: ${parityExact ? "EXACT" : "BROKEN"}`);
console.log(`  numeral-in-value · shipped keys           ${pad(numeralKeys.length, 6)}   (${valueDigitKeys.length} value carries a digit · ${placeholderNumeralKeys.length} through a placeholder)`);
console.log(`  numeral-in-value · un-keyed strings       ${pad(numeralHits.length, 6)}   (${numeralHits.filter((h) => /\d/.test(h.text)).length} carry a literal digit · ${numeralHits.filter((h) => !/\d/.test(h.text)).length} through an interpolation)`);
console.log(`  by class:  ${[...byKind.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`);

console.log(`\n§2 BY SURFACE`);
console.log(`  ${padR("AREA", 26)}${pad("FILES", 7)}${pad("OCC", 7)}${pad("LIVE", 7)}${pad("DORMANT", 9)}${pad("DISTINCT", 10)}`);
for (const [a, v] of [...byArea.entries()].sort((x, y) => y[1].occ - x[1].occ)) {
  const liveN = allHits.filter((h) => areaOf(h.file) === a && (h as any).live).length;
  console.log(`  ${padR(a, 26)}${pad(v.files.size, 7)}${pad(v.occ, 7)}${pad(liveN, 7)}${pad(v.occ - liveN, 9)}${pad(v.distinct.size, 10)}`);
}

console.log(`\n§3 BY FILE — every file with at least one un-keyed string (occurrences / distinct / live?)`);
for (const [f, hits] of [...perFile.entries()].sort((x, y) => y[1].length - x[1].length)) {
  console.log(`  ${pad(hits.length, 5)} /${pad(new Set(hits.map((h) => h.text)).size, 5)}  ${isLive(f) ? "LIVE   " : "dormant"}  ${f}`);
}
console.log(`\n  --- first 40 occurrences in file order (file:line · class · text) ---`);
const shown = [...allHits].sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1)).slice(0, 40);
for (const h of shown) console.log(`  ${h.file}:${h.line} · ${h.kind}${h.note ? ` (${h.note})` : ""} · ${JSON.stringify(h.text.slice(0, 90))}`);

console.log(`\n§4 THE LEGACY SCANNER, MEASURED (defect 2, quantified)`);
const abc = (byKind.get("A jsx-text") ?? 0) + (byKind.get("B jsx-child") ?? 0) + (byKind.get("C player-prop") ?? 0);
console.log(`  the old scanner's own two classes (text nodes + literal props), same file set:`);
console.log(`     old per-line regex:      ${legacyTotal}`);
console.log(`     JSX text-node walk:      ${abc}   (A=${byKind.get("A jsx-text") ?? 0} · B=${byKind.get("B jsx-child") ?? 0} · C=${byKind.get("C player-prop") ?? 0})`);
console.log(`     missed by the old regex: ${abc - legacyTotal}  (${abc ? (100 * (abc - legacyTotal) / abc).toFixed(1) : "n/a"}% of that class pair)`);
console.log(`  class D (engine/data prose, ${byKind.get("D data-prose") ?? 0}) was never walked at all by the old scanner — it is not part of that pair.`);

console.log(`\n§5 NUMERAL-IN-VALUE CLASS`);
console.log(`  shipped keys whose English VALUE carries an ASCII digit (${valueDigitKeys.length}):`);
for (const k of valueDigitKeys) console.log(`     ${k} = ${JSON.stringify(catEn.values.get(k)?.slice(0, 80))}`);
console.log(`  shipped keys with >=1 placeholder (${placeholderKeys.length}); of those, ${placeholderNumeralKeys.length} fill a numeral-shaped argument:`);
for (const k of placeholderNumeralKeys) {
  const sites = (CALL_SITES.get(k) ?? []).map((s) => `${s.name}=${s.expr}`).join(", ");
  console.log(`     ${k}${sites ? `   [${sites}]` : ""}`);
}
console.log(`  (${placeholderJudged.length} of the ${placeholderKeys.length} were judged from a real call site; the rest from the placeholder's name — the heuristic is named in §LIMITS.)`);
console.log(`  keys with a placeholder that this rule does NOT judge numeral-shaped (${placeholderKeys.filter((k) => !placeholderNumeralKeys.includes(k)).length}):`);
for (const k of placeholderKeys.filter((x) => !placeholderNumeralKeys.includes(x))) console.log(`     ${k} = ${JSON.stringify(catEn.values.get(k)?.slice(0, 70))}`);
console.log(`  un-keyed numeral-bearing occurrences: ${numeralHits.length} — by file (the filed passes named 25 engine refusals · 5 domainEffect · 25 season-tier labels · MAX_GAMES · summaryOf · shortDuration):`);
const numByFile = new Map<string, number>();
for (const h of numeralHits) numByFile.set(h.file, (numByFile.get(h.file) ?? 0) + 1);
for (const [f, n] of [...numByFile.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${pad(n, 4)}  ${f}`);
for (const h of numeralHits.slice(0, 15)) console.log(`     e.g. ${h.file}:${h.line} · ${JSON.stringify(h.text.slice(0, 80))}`);
console.log(`  keyed-ish literals EXCLUDED because they are the fallback of an existing key (t("key","English")): ${FALLBACK_LITERALS.size} distinct`);
for (const s of [...FALLBACK_LITERALS].slice(0, 8)) console.log(`     ${JSON.stringify(s.slice(0, 70))}`);

console.log(`\n§6 CONTROLS — widening a checker needs its negative control (${controlsPassed}/${controls.length} pass)`);
for (const [name, ok, detail] of controls) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}   [${detail}]`);
if (controlsPassed !== controls.length) { console.log(`\nCONTROLS FAILED — the figure above is not trustworthy.`); process.exit(1); }

console.log(`\n§7 HONEST LIMITS — what this counter still cannot see`);
for (const l of [
  "strings persisted into the save (the Chronicle's `state.log`, `GameSummary.summary`, the prologue's history/names books): the source templates are countable, the rows already written into an existing save are not — a data-shape change, not a keying pass",
  "engine refusal sentences composed at call time (`fail(...)`, `failKey(...)`, `domainEffect` prose): the template is counted, the numeral that fills it is counted in §5, the finished sentence never exists in source",
  "english prose that reaches a player through a translated label's data (`zones.ts` names, hero deeds) only while the surface that paints it is itself un-keyed",
  "season-tier labels (25 numeral-bearing) are counted in `monetization.ts`; `StorefrontOverlay` contributes only its own chrome",
  "anything outside `src/` — `public/manifest.webmanifest`, `sw.js`, and the installed app's home-screen label (English for everyone: accepted limit)",
  "`src/game/i18n/**` by rule, `src/db.ts` (SQL), `.gen.ts` files",
  "not rendered-vs-source: a string behind a false flag is counted (StorefrontOverlay's buy controls), a string assembled at runtime from fragments is not",
  "reachability is per FILE, not per string: a reachable file can still hold rows no surface paints today (`heroes-data.ts` is imported by the Cradle, and the Cradle paints 19 of its 100 strings — the other 81 are counted as live because the file is)",
  "a data-table literal that is rendered through a *family* key at its call site (`t(\\`store.pack.${id}.blurb\\`, pack.blurb)`) is counted even though the key exists: the literal is still English in the file and a missing family member renders it silently. Only the direct `t(\"key\", \"English\")` form is excluded, and the count of those is printed in §5",
  "the placeholder heuristic in §5: 46-keys-by-name is a judgement; this counter prefers a real call site and says how many it had",
]) console.log(`  · ${l}`);
console.log(``);
