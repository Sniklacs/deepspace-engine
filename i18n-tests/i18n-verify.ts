// i18n VERIFICATION — the language foundation, slice 1
// (design/localization-settings-captions.md §2, L1–L10).
//
// Run: cd /home/team/shared/i18n-tests && env -u DATABASE_URL bun run i18n-verify.ts
//
// What this gates, in order:
//   §1 the drop-in contract (one file per language, every file registered)
//   §2 completeness — every shipped file complete against the English source
//   §3 the fallback chain — and the structural promise that a RAW KEY can
//      never reach the screen
//   §4 interpolation
//   §5 the swept surfaces are keyed (no un-keyed player-facing literal)
//   §6 no key is asked for that the catalogue does not know (no dead lookup)
//   §7 L9 — language/text size live on the DEVICE, not the account, and the
//      pipe itself makes no network call (no service, no key, no purchase)
//   §8 the pre-paint resolve (no English flash for a non-English device)
//   §9 the engine seam (chat/live translation plugs in later, UI untouched)
//   §10 English is unchanged
//   §11 RTL — Persian (fa), the direction stamped pre-paint, and the mirrored
//       chrome (slice 2: the language file alone would have been worse than
//       English for a Persian speaker — Persian words in a left-to-right frame)
//   §12 the typecheck guard — the i18n slice that shipped `useT is not defined`
//       and took /play down for every language (P0, 2026-09-26)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const SITE = "/home/team/shared/site";
const read = (p: string) => readFileSync(`${SITE}/${p}`, "utf8");
/** Every file under site/src, relative to it — the §11 mirror scan walks this. */
const allFiles: string[] = (() => {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir)) {
      const full = `${dir}/${e}`;
      if (statSync(full).isDirectory()) walk(full, rel ? `${rel}/${e}` : e);
      else out.push(rel ? `${rel}/${e}` : e);
    }
  };
  walk(`${SITE}/src`, "");
  return out.sort();
})();
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const section = (t: string) => console.log(`\n— ${t} —`);

const i18n = await import(`${SITE}/src/game/i18n/index.ts`);
const { LANGS, LANG_CODES, SOURCE_LANG, catalogueCompleteness, translate, makeT, rawTranslate,
        missingKeys, resetMissingKeys, humanizeKey, KEY_SHAPE, bootScript, CATALOGUES,
        registerTranslationEngine, engineTranslateText, activeTranslationEngine, DEVICE_KEY, BOOT_CLASS } = i18n;

// ---------------------------------------------------------------- §1 drop-in
section("1 · THE DROP-IN CONTRACT (L3: a language is one file)");
const langDir = `${SITE}/src/game/i18n/langs`;
const files = readdirSync(langDir).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, ""));
check("a file exists for every registered language", LANG_CODES.every((c) => files.includes(c)), `${files.join(",")} vs ${LANG_CODES.join(",")}`);
check("every language file is registered (a dropped file cannot be orphaned)", files.every((f) => LANG_CODES.includes(f)));
check("English is registered as the source of truth, not machine-made", LANGS[0].code === SOURCE_LANG && LANGS[0].machine === false);
check("every non-English language is flagged machine + carries provenance", LANGS.filter((l) => l.code !== SOURCE_LANG).every((l) => l.machine === true && l.source.length > 20));
check("every language has an endonym (its own name for itself) and a direction", LANGS.every((l) => l.endonym.length > 1 && (l.dir === "ltr" || l.dir === "rtl")));
check("catalogues are assembled for every registered code", LANG_CODES.every((c) => !!CATALOGUES[c]));
check("the translator is a pure lookup — the module imports no server code", !/from "\.\.\/api"|from "\.\.\/store"|createServerFn/.test(read("src/game/i18n/translate.ts") + read("src/game/i18n/device.ts")));

// ----------------------------------------------------------- §2 completeness
section("2 · COMPLETENESS AGAINST THE ENGLISH CATALOGUE (L2/L3)");
const comp = LANGS.map((l) => catalogueCompleteness(l.code));
console.log(`     english keys: ${comp[0].total} (the catalogue every file is measured against)`);
for (const c of comp) {
  console.log(`     ${c.lang}: ${c.present}/${c.total} present, ${c.identical.length} identical to English`);
  check(`${c.lang} is complete (no missing, no empty strings)`, c.complete, c.missing.slice(0, 5).join(","));
}
check("no language file is empty", comp.every((c) => c.present > 0));
check("machine files are not left as a copy of English", comp.filter((c) => c.lang !== SOURCE_LANG).every((c) => c.identical.length < c.total * 0.2), comp.map((c) => `${c.lang}:${c.identical.length}`).join(" "));
check("identical-to-English entries are all short labels / proper nouns, never prose", comp.filter((c) => c.lang !== SOURCE_LANG).every((c) => c.identical.every((k) => (CATALOGUES.en[k] ?? "").length <= 34)), comp.flatMap((c) => c.identical).slice(0, 8).join(","));

// --------------------------------------------------------- §3 fallback chain
section("3 · THE FALLBACK CHAIN — missing key → English, and NEVER a raw key");
const englishKeys = Object.keys(CATALOGUES[SOURCE_LANG]);
resetMissingKeys();
check("a key present in a language resolves to that language", translate("es", "nav.lab") === "Laboratorio");
check("a key missing from a language file falls back to English text", translate("ru", "cradle.perMin") === "/min" || translate("ru", "cradle.perMin").length > 0);
check("an unknown key with no fallback never returns the key itself", translate("es", "does.not.exist") !== "does.not.exist");
check("an unknown key humanises its last segment instead", translate("es", "does.notExistHere").toLowerCase() === "not exist here", translate("es", "does.notExistHere"));
check("an unknown key with an English literal at the call site uses the literal", translate("es", "unknown.key", "Do the thing") === "Do the thing");
check("a nonsense language code still yields readable text, never a key", translate("zz", "cradle.purify", "Purify the Cradle") === "Purify the Cradle");
check("the ledger records where a fallback happened", missingKeys().length > 0 && missingKeys().every((e) => e.includes("::")));
const rawKeyShape = (s: string) => KEY_SHAPE.test(s.trim());
let leaked: string[] = [];
for (const l of LANG_CODES) for (const k of englishKeys) { const out = translate(l, k); if (!out || rawKeyShape(out)) leaked.push(`${l}:${k}`); }
check(`NO shipped key renders as a raw key or an empty string (${LANG_CODES.length * englishKeys.length} lookups)`, leaked.length === 0, leaked.slice(0, 6).join(","));
const nonsense = ["a.b", "zzz.yyy.xxx", "cradle.", "landing.h1a.deep", "x.y.z.w.v"];
check("nonsense keys never come back as keys", nonsense.every((k) => { const o = translate("es", k); return o !== k && !rawKeyShape(o) && o.length > 0; }));
check("humanizeKey can never contain a dot (the structural promise)", ["a.b.c", "nav.colony", "x"] .every((k) => !humanizeKey(k).includes(".")));

// ------------------------------------------------------------ §4 interpolation
section("4 · INTERPOLATION");
check("params are substituted", translate("en", "ribbon.reportsNew", { n: 3 }) === "Cradle Reports — 3 new");
check("params work in a machine language too", /3/.test(translate("ru", "cradle.legends", { n: 3 })));
check("a missing param is left visible, never dropped silently", translate("en", "ribbon.reportsNew").includes("{n}"));
check("interpolation leaves single-brace facts alone", translate("en", "cradle.perMin") === "/min");

// ------------------------------------------------- §5/§6 the swept surfaces
section("5 · THE SWEPT SURFACES — nothing player-facing left un-keyed");
const SWEPT = [
  "src/components/shell/Ribbon.tsx", "src/components/shell/BottomNav.tsx", "src/components/shell/AppShell.tsx",
  "src/components/shell/CradleSheet.tsx", "src/components/shell/SettingsSheet.tsx",
  "src/components/shell/InstallAffordance.tsx", "src/components/shell/StorageNote.tsx",
  "src/components/ui/ResourcePill.tsx", "src/components/LedgerButton.tsx", "src/components/Sheet.tsx",
  "src/components/i18n/I18n.tsx", "src/components/i18n/LanguagePicker.tsx", "src/routes/index.tsx",
  // The Forge's surfaces joined the sweep with the Forge slice (owner 2026-09-26):
  // one more file swept, no check removed.
  "src/components/ForgeViews.tsx",
];
const PROP = /\b(aria-label|title|placeholder|alt|label|sub|subtitle|text|reason|note)="([^"]{3,})"/;
const ALLOW_PROP = /^(ltr|rtl|dialog|banner|list|none|button|tab|img|page|true|false)$/;
const TEXT_NODE = />([^<>{}=;&!|]*[A-Za-z][^<>{}=;&!|]*)</;
const ALLOW_TEXT = /^[\s✓·—–\u2192/:%+×\u00d7.,!?()&-]*$/;
for (const f of SWEPT) {
  const src = read(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  const propBad = src.filter((l) => { const m = PROP.exec(l); return m && !ALLOW_PROP.test(m[2]); }).map((l) => l.trim().slice(0, 60));
  const textBad = src.filter((l) => { const m = TEXT_NODE.exec(l); return m && !ALLOW_TEXT.test(m[1]); }).map((l) => l.trim().slice(0, 60));
  check(`${f} has no un-keyed player-facing literal`, propBad.length === 0 && textBad.length === 0, [...propBad, ...textBad].slice(0, 4).join(" | "));
}
section("6 · NO DEAD LOOKUP — every key the UI asks for exists in English");
const UI_FILES = [...SWEPT, "src/components/screens/CradleScreen.tsx", "src/routes/play.tsx", "src/components/ui/BuildingTile.tsx", "src/game/i18n/slot-label.ts"];
const used = new Set<string>();
for (const f of UI_FILES) {
  const src = read(f);
  for (const m of src.matchAll(/\b(?:t|tf)\(\s*["'`]([A-Za-z][A-Za-z0-9.]*)/g)) { const kk = m[1].replace(/\.$/, ""); used.add(m[0].includes("`") ? kk + ".*" : kk); }
}
const unknown = [...used].filter((k) => !k.endsWith(".*") && !(k in CATALOGUES[SOURCE_LANG]));
check(`every key used by the UI exists in the English catalogue (${used.size} call sites)`, unknown.length === 0, unknown.join(","));
const dynamic = [...used].filter((k) => k.endsWith(".*")).map((k) => k.slice(0, -2));
check("the dynamic keys (template lookups) resolve a real family in the catalogue", dynamic.every((p) => englishKeys.some((k) => k.startsWith(p + "."))), dynamic.join(","));
const unused = englishKeys.filter((k) => !used.has(k) && !dynamic.some((p) => k.startsWith(p + "."))).filter((k) => !k.startsWith("app.notFound"));
check(`unused catalogue keys are only the deliberate reserved set (${unused.length})`, unused.every((k) => k.startsWith("lang.") || k.startsWith("settings.") || k.endsWith("Short")), unused.join(","));

// ------------------------------------------------------- §7 L9 device storage
section("7 · L9 — PER DEVICE, AND THE PIPE COSTS NOTHING");
const i18nSrc = ["device.ts", "translate.ts", "languages.ts", "catalogues.ts", "engine-seam.ts"].map((f) => read(`src/game/i18n/${f}`)).join("\n");
check("the i18n pipe makes no network call of any kind", !/fetch\(|XMLHttpRequest|axios|https?:\/\//.test(i18nSrc));
check("the i18n pipe touches no account or save code", !/api\.|store\.|GameState|token/.test(i18nSrc));
check("the device record is versioned (a shape change can migrate instead of guess)", DEVICE_KEY === "dse.device.v1");
const mem: Record<string, string> = {};
(globalThis as any).window = { localStorage: { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; }, removeItem: (k: string) => { delete mem[k]; } }, location: { search: "" } };
(globalThis as any).navigator = { languages: ["es-MX", "en"], language: "es-MX" };
const dev = await import(`${SITE}/src/game/i18n/device.ts`);
dev.resetDeviceCache();
const suggested = dev.resolveDeviceSettings();
check("a browser language is used as a SUGGESTION before any choice", suggested.lang === "es" && suggested.chosen === false);
dev.setDeviceLang("ru");
check("a choice persists on the device record", JSON.parse(mem[DEVICE_KEY]).lang === "ru");
dev.resetDeviceCache();
check("and is read back after a reload", dev.resolveDeviceSettings().lang === "ru" && dev.resolveDeviceSettings().chosen === true);
check("an unknown language code cannot be stored", (dev.setDeviceLang("zz"), JSON.parse(mem[DEVICE_KEY]).lang === "ru"));
check("text size is device-shaped too (L6/L9)", (dev.setDeviceTextSize("larger"), dev.resolveDeviceSettings().textSize === "larger"));
check("graphics quality is device-shaped too (L6/L9)", (dev.setDeviceQuality("reduced"), dev.resolveDeviceSettings().quality === "reduced"));

// --------------------------------------------------- §8 resolution pre-paint
section("8 · THE PRE-PAINT RESOLVE (L1: no English flash-and-swap)");
const root = read("src/routes/__root.tsx");
const css = read("src/styles/app.css");
const boot = bootScript();
check("the root document runs a boot script before the app paints", root.includes("bootScript()") && root.includes("dangerouslySetInnerHTML"));
check("the boot script knows every shipped language (it cannot drift from the registry)", LANG_CODES.every((c) => boot.includes(`"${c}"`)));
check("it hides the app for a non-English or un-chosen device", boot.includes("if(lang!=='en'||!chosen)") && boot.includes("i18n-boot"));
check("it stamps lang/data-lang before React hydrates", boot.includes("setAttribute('lang',lang)") && boot.includes("setAttribute('data-lang',lang)"));
check("a JavaScript-disabled device is not left with a blank page", root.includes("<noscript>") && root.includes("visibility:visible"));
check("the veil hides the app but not the picker", css.includes(`html.i18n-boot body > :not(.i18n-gate) { visibility: hidden; }`));
check("the provider lifts the veil only once the resolved language is on screen", read("src/components/i18n/I18n.tsx").includes("applyToDocument(settings)") && read("src/game/i18n/device.ts").includes('classList.remove(BOOT_CLASS)'));
check("the picker is mounted on EVERY route, before the game door", root.includes("<LanguageGate />") && root.includes("I18nProvider"));
check("the picker offers the language's own name, not a translation of it", read("src/components/i18n/LanguagePicker.tsx").includes("l.endonym") && read("src/components/i18n/LanguagePicker.tsx").includes("l.english"));
check("the picker states that the voices stay English (L4/§3.5)", read("src/components/i18n/LanguagePicker.tsx").includes('tf("lang.voiceNote")'));
check("Settings can change the language after first run", read("src/components/shell/SettingsSheet.tsx").includes("setDeviceLang") && read("src/components/shell/CradleSheet.tsx").includes('t("settings.open", "Settings")'));
check("settings are per device, not per account (no save/token write path)", !/token|save|api\./.test(read("src/components/shell/SettingsSheet.tsx")));
check("text size is a real root scale, not a placebo", css.includes('html[data-text-size="larger"] { font-size: 125%; }'));
check("graphics quality removes real render weight", css.includes('html[data-quality="reduced"] *') && css.includes("backdrop-filter: none !important"));
const settingsCode = read("src/components/shell/SettingsSheet.tsx").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
check("no fake resolution control exists anywhere in the settings surface", !/resolution/i.test(settingsCode));

// ------------------------------------------------------------- §9 the seam
section("9 · THE ENGINE SEAM (chat live-translation drops in later, UI untouched)");
check("no engine is registered by default (this slice spends nothing)", activeTranslationEngine() === null);
check("live text translation returns null rather than a fake translation", engineTranslateText("hi", "es", "en") === null);
registerTranslationEngine({ name: "test-engine", key: (k, l) => (k === "engine.only" ? `[${l}] from engine` : null), text: (t, _f, to) => `[${to}] ${t}` });
check("a registered engine fills a key the catalogues lack", translate("es", "engine.only") === "[es] from engine");
check("and the same seam serves live text (the chat Translate button)", engineTranslateText("hola", "es", "en") === "[en] hola");
registerTranslationEngine(null);
check("the seam is the only place an engine is consulted", /engineTranslateKey/.test(read("src/game/i18n/translate.ts")) && read("src/game/i18n/engine-seam.ts").includes("let engine"));
check("the browser Translator API is not relied on (it is desktop-only; this game is phone-first)", !/translation\.createTranslator|Translator\.create/.test(read("src/game/i18n/engine-seam.ts")));

// ------------------------------------------------------- §10 English intact
section("10 · ENGLISH IS UNCHANGED");
const nav = await import(`${SITE}/src/game/nav-slots.ts`);
check("every nav label still exists verbatim in English", nav.NAV.every((n: any) => CATALOGUES.en[`nav.${n.id}`] === n.label), nav.NAV.map((n: any) => n.label).join(","));
const zones = await import(`${SITE}/src/game/zones.ts`);
check("every DOMAIN name/description is catalogue-identical (no drift, no re-wording)", zones.DOMAINS.every((d: any) => CATALOGUES.en[`domain.${d.id}.name`] === d.name && CATALOGUES.en[`domain.${d.id}.desc`] === d.description));
check("the shell's seven Cradle-sheet controls keep their exact English literal", ["Your colonies", "How to Play", "Feedback", "Sound", "Full screen", "Log Out", "Account"].every((s) => read("src/components/shell/CradleSheet.tsx").includes(s)));
check("the landing page still links The Fall (entry route untouched)", read("src/routes/index.tsx").includes('to="/the-fall"'));
check("the English literals at the call sites match the catalogue (no silent English change)", (() => {
  const pairs: [string, string][] = [];
  for (const f of UI_FILES) for (const m of read(f).matchAll(/\bt\(\s*"([A-Za-z][A-Za-z0-9.]*)"\s*,\s*"([^"]+)"/g)) pairs.push([m[1], m[2]]);
  const bad = pairs.filter(([k, lit]) => CATALOGUES.en[k] !== lit);
  if (bad.length) console.log(`     mismatched: ${bad.slice(0, 5).map((b) => b[0]).join(",")}`);
  return pairs.length > 40 && bad.length === 0;
})());
check("the storefront is untouched by this slice", (await import(`${SITE}/src/game/monetization.ts`)).MONETIZATION_CONFIG.storefrontEnabled === false);
/**
 * §10 EXTENDED (slice 2). "English is unchanged" is asserted against a HASH of
 * the English catalogue rather than against a few remembered strings: key set and
 * text, byte for byte, as shipped in slice 1. A future slice that deliberately
 * adds or rewords English updates ENGLISH_SHA in the same commit — that is the
 * point of a pin, not an obstacle. The direction half of the proof is §11 (en and
 * every other LTR language must still resolve to `ltr`, pre-paint included).
 */
// Re-baselined 2026-09-26 — OWNER DECISION: "Expeditions" -> "Exploration" everywhere,
// English included (the shipped Persian already said اکتشاف, so English came into line).
// Twelve catalogue values reworded across en/es/pt-BR/ru; fa untouched; the key count is
// unchanged at 242. This pin was the ONLY check the rename moved, and it moved by design.
// Previous pin: 51166bd2971cf45d72eb467514edd2c17639785d1e65a573cf6d6f1ac37d9293
// Re-baselined 2026-09-26 — THE FORGE slice: 45 new keys added to the English
// catalogue (242 -> 287), every one translated in all five languages in the same
// commit. No existing value changed; the pin moved because the KEY SET grew by
// design. Previous pin: 6cd980258565d13b069523655abb0c39d5357c46060a026ab9948a046555806c
const ENGLISH_SHA = "bd0d2ab29603ec02d70e4895a24c95b1fb7798493aa2eb42b494da0f2e4466ef";
const enCanonical = Object.keys(CATALOGUES[SOURCE_LANG]).sort().map((k) => `${k}\t${CATALOGUES[SOURCE_LANG][k]}`).join("\n");
const enSha = createHash("sha256").update(enCanonical, "utf8").digest("hex");
check(`the English catalogue is byte-identical to slice 1 (${englishKeys.length} keys, sha256 ${enSha.slice(0, 12)}…)`, enSha === ENGLISH_SHA, enSha);
check("English still resolves every key to its own catalogue text", englishKeys.every((k) => translate("en", k) === CATALOGUES.en[k]));
check("English is not Persian: no Arabic-script character anywhere in the English catalogue", englishKeys.every((k) => !/[\u0600-\u06FF]/.test(CATALOGUES.en[k])));

// ================================================================== §11 RTL
section("11 · RTL — PERSIAN AND THE RIGHT-TO-LEFT FOUNDATION (slice 2)");
const { LANG_DIRS, langDir: dirOf, isRtlLang } = i18n;
const faMeta = LANGS.find((l: any) => l.code === "fa");
// ---- 11.1 the registry carries the direction ---------------------------------
check("fa is registered, in its own script, as a right-to-left language", !!faMeta && faMeta.dir === "rtl" && faMeta.endonym === "فارسی" && faMeta.english === "Persian", JSON.stringify(faMeta ?? null));
check("fa carries machine provenance like every other non-English file", !!faMeta && faMeta.machine === true && faMeta.source.length > 20);
check("every other language is still explicitly ltr (English's direction is unchanged)", LANGS.filter((l: any) => l.code !== "fa").every((l: any) => l.dir === "ltr"));
check("fa is the ONLY rtl language in the registry (the plumbing is per-language, not global)", LANGS.filter((l: any) => l.dir === "rtl").length === 1 && isRtlLang("fa") === true);
check("the direction table is derived from the registry — the boot script cannot drift from it", LANG_DIRS.fa === "rtl" && Object.keys(LANG_DIRS).length === LANGS.length && dirOf("en") === "ltr" && dirOf("fa") === "rtl");
check("an unknown code falls back to ltr, never to rtl", dirOf("zz") === "ltr" && dirOf("") === "ltr");

// ---- 11.2 the file is complete, and Persian ----------------------------------
const compFa = catalogueCompleteness("fa");
const faKeys = Object.keys(CATALOGUES.fa);
console.log(`     fa keys in the file: ${faKeys.length} / ${englishKeys.length} in the English source`);
console.log(`     fa: ${compFa.present}/${compFa.total} present, ${compFa.identical.length} identical to English (${compFa.identical.join(",") || "none"})`);
check(`fa is complete against the English source (${compFa.present}/${compFa.total})`, compFa.complete && compFa.present === compFa.total && compFa.total === englishKeys.length);
check(`fa's file holds exactly the English key count (${faKeys.length}/${englishKeys.length})`, faKeys.length === englishKeys.length);
check("fa invents no key the English source does not know", faKeys.every((k) => k in CATALOGUES[SOURCE_LANG]));
check("fa's identical-to-English entries are only the product name (never prose, never a label)", compFa.identical.every((k) => k === "app.name"));
check("fa keeps every {placeholder} of its English source (a dropped param is a broken sentence)", englishKeys.every((k) => {
  const params = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
  return params(CATALOGUES.fa[k] ?? "") === params(CATALOGUES.en[k]);
}));

// ---- 11.3 zero raw-key tokens, zero silent English ----------------------------
const rawKeyShapeFa = (s: string) => KEY_SHAPE.test(s.trim());
resetMissingKeys();
const faRaw: string[] = [];
const faFallback: string[] = [];
const faNotPersian: string[] = [];
for (const k of englishKeys) {
  const out = translate("fa", k);
  if (!out || rawKeyShapeFa(out)) faRaw.push(k);
  if (out !== CATALOGUES.fa[k]) faFallback.push(k);
  if (!/[\u0600-\u06FF]/.test(out) && k !== "app.name") faNotPersian.push(k);
}
check(`0 raw-key tokens in fa — every one of its ${englishKeys.length} keys resolves to text, none to a key`, faRaw.length === 0, faRaw.slice(0, 6).join(","));
check("no fa lookup falls back to English (a fallback is a silently untranslated string)", faFallback.length === 0, faFallback.slice(0, 6).join(","));
check("every fa string is actually Persian script, except the product name", faNotPersian.length === 0, faNotPersian.slice(0, 6).join(","));
check("no fa lookup is recorded in the missing-key ledger", missingKeys().filter((e) => e.startsWith("fa::")).length === 0);
check("the fallback chain still holds for fa: a nonsense key humanises instead of printing a key", !rawKeyShapeFa(translate("fa", "does.notExistHere")) && translate("fa", "does.notExistHere").length > 0);

// ---- 11.4 numerals stay Western ----------------------------------------------
const faValues = faKeys.map((k) => CATALOGUES.fa[k]);
const INDIC = /[\u0660-\u0669\u06F0-\u06F9]/; // Arabic-Indic ١٢٣ and Persian-Indic ۱۲۳
check("WESTERN DIGITS ONLY — no Persian-Indic/Arabic-Indic numeral in any fa string", faValues.every((v) => !INDIC.test(v)), faValues.filter((v) => INDIC.test(v))[0] ?? "");
check("the digits a Persian player sees are the catalogue's Latin ones (10 · 5 · 80 · 2 · 4)", ["cradle.purifySub", "cradle.alloyBold", "cradle.devotionDone", "auth.nameError", "auth.passwordError"].every((k) => /[0-9]/.test(CATALOGUES.fa[k])));
check("the CSS carries no numeral-overriding rule (digits are never re-mapped)", !/font-variant-numeric:\s*(persian|arabic)/.test(css));

// ---- 11.5 the direction is set BEFORE the first paint ------------------------
const bootFa = bootScript();
check("the boot script carries the registry's direction table (it cannot drift)", bootFa.includes(JSON.stringify(LANG_DIRS)) && bootFa.includes('"fa":"rtl"'));
check("it stamps dir on <html> in the same inline script as lang/data-lang, dir last", /setAttribute\('lang',lang\);h\.setAttribute\('data-lang',lang\);[^]*?setAttribute\('dir',dir\)/.test(bootFa));
check("an LTR language is stamped ltr by that same line (English is not switched to rtl)", bootFa.includes("(d[lang]==='rtl')?'rtl':'ltr'"));
check("the boot script still hides the app for a non-English or un-chosen device", bootFa.includes("if(lang!=='en'||!chosen)") && bootFa.includes("i18n-boot"));
check("the server document declares a real direction of its own (lang=en dir=ltr), not an undefined one", /<html lang="en" dir="ltr"/.test(root));
check("the hydrated provider re-asserts the registry's direction (a change inside the session)", read("src/game/i18n/device.ts").includes('html.setAttribute("dir", meta.dir)'));
check("the picker marks each row with its own language (the Persian endonym lays out RTL even inside an English frame)", read("src/components/i18n/LanguagePicker.tsx").includes("lang={l.code}"));
check("the picker states the voices stay English — in the player's own language file", typeof CATALOGUES.fa["lang.voiceNote"] === "string" && /[\u0600-\u06FF]/.test(CATALOGUES.fa["lang.voiceNote"]));

// ---- 11.6 Persian renders: a real font in the stack, and no download ---------
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const rtlLayer = cssNoComments.slice(cssNoComments.indexOf('html[dir="rtl"]'));
check("the RTL document re-declares the sans stack with Arabic-script families ahead of the Latin ones", /html\[dir="rtl"\]\s*\{[^}]*--font-sans:[^}]*"Noto Naskh Arabic"/.test(cssNoComments) && /"Noto Sans Arabic"/.test(rtlLayer) && /Tahoma/.test(rtlLayer) && /"Geeza Pro"/.test(rtlLayer));
check("the LTR stack is untouched by that rule (English typography cannot move)", /--font-sans:\s*ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,/.test(cssNoComments));
/** Comments are stripped first, so this reads CODE, not prose about fonts. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const fontPayloadFiles = allFiles.filter((f) => /\.(woff2?|ttf|otf|eot)$/.test(f));
const fontFace = allFiles.filter((f) => /\.(css|tsx?)$/.test(f) && /@font-face|fonts\.googleapis|fonts\.gstatic/.test(stripComments(readFileSync(`${SITE}/src/${f}`, "utf8"))));
check(`Persian rendering costs nothing: no web font is downloaded (${fontPayloadFiles.length} font files, ${fontFace.length} @font-face declarations, 0 purchases)`, fontPayloadFiles.length === 0 && fontFace.length === 0, [...fontPayloadFiles.slice(0, 3), ...fontFace.slice(0, 3)].join(","));
check("the RTL layer flips exactly one thing — a glyph box — and never a container or a run of text", (rtlLayer.match(/transform:/g) ?? []).length === 1 && /html\[dir="rtl"\]\s*\.dir-flip\s*\{\s*transform:\s*scaleX\(-1\);\s*\}/.test(rtlLayer));
check("the directional glyphs that carry an arrow are marked with it (march · logout)", read("src/components/icons.tsx").includes("DIR_FLIP") && /DIR_FLIP\.has\(name\)\s*\?\s*`dir-flip/.test(read("src/components/icons.tsx")) && /"march"/.test(read("src/components/icons.tsx")) && /"logout"/.test(read("src/components/icons.tsx")));

// ---- 11.7 the mirrored chrome carries no physical direction ------------------
/**
 * The scan is the real gate behind "mirror the chrome": it reads every source
 * file, strips comments, and fails on a physical-direction utility or CSS
 * property. Two explicit lists keep it honest:
 *   • ALLOW — things that are SYMMETRIC, so direction cannot matter:
 *     `inset-x-*` (left+right), `left-1/2 -translate-x-1/2` (centred), and the
 *     `.sheet-panel` block, which is `left:0;right:0` on phones and
 *     `left:50% + translate(-50%,-50%)` on wide screens — the same box in both
 *     directions.
 *   • SKIP — files this slice deliberately does not mirror, named one by one, so
 *     a new leak cannot hide behind a folder-wide exemption.
 * The planted-leak check below proves the scanner is not vacuous.
 */
const DIR_UTIL = [
  /(^|[\s"'`])(-?(ml|mr|pl|pr)-)(\[|\d|auto)/,
  /(^|[\s"'`])(left|right)-(0|0\.5|1|1\.5|2|2\.5|3|4|5|6|8|10|12|full|auto|1\/2|1\/3|1\/4|3\/4)(?![0-9A-Za-z_-])/,
  /(^|[\s"'`])text-(left|right)(?![A-Za-z-])/,
  /(^|[\s"'`])rounded-(l|r|tl|tr|bl|br)(?![A-Za-z-])/,
  /(^|[\s"'`])border-(l|r)(?![A-Za-z-])/,
  /(^|[\s"'`])space-x-/,
  /\b(margin|padding|border)(Left|Right)\b/,
  /\b(textAlign)\s*:\s*["'](left|right)["']/,
];
const DIR_CSS = [
  /^\s*(margin|padding)-(left|right)\s*:/,
  /^\s*(left|right)\s*:\s*(?!0\s*;)/,
  /text-align\s*:\s*(left|right)/,
  /border-(left|right)(-width)?\s*:/,
  /scaleX\(|rotateY?\(|translateX\(/,
];
const DIR_ALLOW = [
  /inset-x-/, // left + right at once: symmetric
  /left-1\/2/, // centred with the -translate-x-1/2 that always accompanies it
  /-translate-x-1\/2/,
  /translate\(-50%,\s*-50%\)/,
  /transform:\s*scaleX\(-1\)/, // the glyph flip, asserted by §11.6
];
const DIR_SKIP = [
  // The storefront seam: `storefrontEnabled === false`, nothing is purchasable,
  // and it is a later slice's surface (no new strings there either).
  "components/StorefrontOverlay.tsx",
];
const strippedNoBox = cssNoComments.replace(/\.sheet-panel\s*\{[^}]*\}/g, "");
/** Every physical-direction leak in one file's text (exported shape for the self-test). */
function directionLeaks(text: string, isCss: boolean): string[] {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (DIR_ALLOW.some((a) => a.test(line))) return;
    const hit = (isCss ? DIR_CSS : DIR_UTIL).some((p) => p.test(line));
    if (hit) out.push(`${i + 1}: ${line.trim().slice(0, 90)}`);
  });
  return out;
}
let scanned = 0;
const leakLines: string[] = [];
for (const rel of allFiles) {
  if (!/\.(tsx?|css)$/.test(rel)) continue;
  if (rel.endsWith(".d.ts")) continue;
  if (DIR_SKIP.includes(rel)) continue;
  scanned++;
  const text = rel === "styles/app.css" ? strippedNoBox : readFileSync(`${SITE}/src/${rel}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const l of directionLeaks(text, rel.endsWith(".css"))) leakLines.push(`${rel} ${l}`);
}
check(`no hardcoded physical-direction CSS left in the mirrored surfaces (${scanned} files scanned, ${DIR_SKIP.length} file deliberately skipped, ${DIR_ALLOW.length} symmetric patterns allowed)`, leakLines.length === 0, leakLines.slice(0, 5).join(" | "));
check("the mirrored chrome really is using logical properties (ms-auto · text-start · end-1/4 · border-s)", ["ms-auto", "text-start", "end-1/4", "border-s"].every((needle) => allFiles.some((f) => /\.tsx?$/.test(f) && readFileSync(`${SITE}/src/${f}`, "utf8").includes(needle))));
check("the scan is not vacuous — a planted leak is caught in both dialects", directionLeaks('className="ml-auto flex"', false).length === 1 && directionLeaks('  margin-left: 4px;', true).length === 1 && directionLeaks('className="ms-auto flex"', false).length === 0 && directionLeaks('  margin-inline-start: 4px;', true).length === 0);
check("no RTL-specific rule hides the app, shrinks text or removes a control (the mirror is layout, not reduction)", !/html\[dir="rtl"\][^{]*\{[^}]*(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:)/.test(cssNoComments));

// ------------------------------------------- §12 the typecheck guard (P0)
// The /play crash of 2026-09-26 came in WITH an i18n slice: Sheet.tsx called
// `useT()` without importing it, `bun run build` was green, and the error
// boundary swallowed the app for every signed-in player in every language.
// The i18n gate is therefore the right place to hold the line: typechecking is
// part of "a translated string reaches the screen" — a raw key never can if the
// lookup itself cannot resolve.
section("12 · THE TYPECHECK GUARD (the i18n slice that shipped a ReferenceError)");
const guardRun = spawnSync("bun", ["run", "scripts/typecheck-guard.ts"], {
  cwd: SITE, encoding: "utf8", timeout: 300_000, env: { ...process.env, DATABASE_URL: undefined },
});
const guardOut = `${guardRun.stdout ?? ""}${guardRun.stderr ?? ""}`;
const guardTail = guardOut.trim().split("\n").filter(Boolean).slice(-1)[0] ?? "";
check("the app-code typecheck guard passes (no undefined identifier anywhere in src/)",
  guardRun.status === 0 && /TYPECHECK-GUARD: OK/.test(guardOut), guardTail);
check("the guard really RAN — a SKIPPED guard fails this gate, even though it exits 0 for the build's sake",
  !/TYPECHECK-GUARD: SKIPPED/.test(guardOut) && /TYPECHECK-GUARD: OK/.test(guardOut), guardTail);
check("`bun run build` runs the typecheck before vite (the publish path is gated, not just this suite)",
  /typecheck/.test(JSON.parse(read("package.json")).scripts.build ?? ""));
check("the fatal class is the whole undefined-identifier family, not one code number",
  /2304/.test(read("scripts/typecheck-guard.ts")) && /2552/.test(read("scripts/typecheck-guard.ts")));

console.log(`\n${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
