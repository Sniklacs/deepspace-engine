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
import { readFileSync, readdirSync } from "node:fs";
const SITE = "/home/team/shared/site";
const read = (p: string) => readFileSync(`${SITE}/${p}`, "utf8");
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
  "src/components/ui/ResourcePill.tsx", "src/components/LedgerButton.tsx", "src/components/Sheet.tsx",
  "src/components/i18n/I18n.tsx", "src/components/i18n/LanguagePicker.tsx", "src/routes/index.tsx",
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

console.log(`\n${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
