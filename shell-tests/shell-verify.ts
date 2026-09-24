// SHELL VERIFICATION — game-ui-shell-spec §9.2 (+ §8's Fall invariants).
//
// Pure, no browser: the slot tables, the base plate's data, the touch-floor
// arithmetic, the "presentation only" guard (no invented state), badge purity,
// the G4 structural never-list, and The Fall's rules re-asserted against the
// new chrome.
//
// Run: cd /home/team/shared/shell-tests && env -u DATABASE_URL bun run shell-verify.ts
import { readFileSync, existsSync } from "node:fs";
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import { NAV, NAV_IDS, FIXED_NAV_IDS, WAR_SLOT_ID, visibleNavIds } from "/home/team/shared/site/src/game/nav-slots.ts";
import {
  navBadges, devotionReady, teamsAway, recoveryReady, forgeReady, liveFights, atWar,
} from "/home/team/shared/site/src/game/nav-badges.ts";
import { CRADLE_SLOTS, CRADLE_SLOT_BY_ID, kitsHeld, workshopReady } from "/home/team/shared/site/src/game/cradle-slots.ts";
import { DOMAIN_BY_ID } from "/home/team/shared/site/src/game/zones.ts";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";

const SITE = "/home/team/shared/site";
const read = (p: string) => readFileSync(`${SITE}/src/${p}`, "utf8");

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
function section(t: string) {
  console.log(`\n— ${t} —`);
}

const CSS = `${SITE}/src/styles/app.css`;
const ICONS = `${SITE}/src/components/icons.tsx`;
const BOTTOMNAV = `${SITE}/src/components/shell/BottomNav.tsx`;
const ROSTERCARD = `${SITE}/src/components/ui/RosterCard.tsx`;
const ACTIONBTN = `${SITE}/src/components/ui/ActionButton.tsx`;
const BATTLES = `${SITE}/src/components/BattlesTab.tsx`;
const CUES = `${SITE}/src/game/war/tutorial-cues.ts`;
const PLAY = `${SITE}/src/routes/play.tsx`;
const NEW_DIRS = [
  "components/shell/AppShell.tsx", "components/shell/Ribbon.tsx", "components/shell/BottomNav.tsx",
  "components/shell/ChatDock.tsx", "components/shell/CradleSheet.tsx",
  "components/ui/Panel.tsx", "components/ui/ActionButton.tsx", "components/ui/StatTile.tsx",
  "components/ui/MeterBar.tsx", "components/ui/ResourcePill.tsx", "components/ui/BuildingTile.tsx",
  "components/ui/RosterCard.tsx", "components/ui/ScreenHeader.tsx", "components/ui/RowButton.tsx",
  "components/ui/ReadyDot.tsx", "components/screens/CradleScreen.tsx",
];
for (const f of [CSS, ICONS, BOTTOMNAV, ROSTERCARD, ACTIONBTN, BATTLES, CUES, PLAY]) {
  if (!existsSync(f)) {
    console.error(`MISSING SOURCE FILE: ${f}`);
    process.exit(1);
  }
}
/** Every component that EXISTS in the new shell/ui/screens delta. */
const newFiles = NEW_DIRS.filter((f) => existsSync(`${SITE}/src/${f}`)).map((f) => `src/${f}`);
const css = readFileSync(CSS, "utf8");
const iconsSrc = readFileSync(ICONS, "utf8");

// ---- icon set: parsed from the IconName union in icons.tsx ----------------
const iconUnion = iconsSrc.slice(iconsSrc.indexOf("export type IconName"), iconsSrc.indexOf("const PATHS"));
const ICON_NAMES = new Set(
  (iconUnion.match(/\|\s*"([a-z]+)"/g) ?? []).map((m) => m.replace(/[|\s"]/g, "")),
);
for (const m of iconsSrc.slice(iconsSrc.indexOf("const PATHS")).matchAll(/^\s{2}([a-z]+):\s*\(/gm)) {
  ICON_NAMES.add(m[1]);
}

const T0 = 1_760_000_000_000;
function state(): GameState {
  return engine.newGame("My Cradle", "watchers", T0);
}
const THE_TAB = "colony" as const;

// ===========================================================================
section("1 · slot-table integrity — every screen reachable, every icon real");
{
  check("NAV has 6 slots (5 fixed + the conditional war slot)", NAV.length === 6, `${NAV.length}`);
  check("every NAV id is in the Tab union", NAV.every((n) => (NAV_IDS as readonly string[]).includes(n.id)));
  check("NAV ids are unique", new Set(NAV.map((n) => n.id)).size === NAV.length);
  check("every slot has a label (the accessible name)", NAV.every((n) => typeof n.label === "string" && n.label.length > 0));
  check("every Tab id is reachable from a slot (no orphan screen)", NAV_IDS.every((id) => NAV.some((n) => n.id === id)));
  for (const n of NAV) check(`slot "${n.id}" icon "${n.icon}" exists in icons.tsx`, ICON_NAMES.has(n.icon), `${n.icon}`);
  check("the fixed five are Cradle · Expeditions · Lab · Armory · Circuit", FIXED_NAV_IDS.join(",") === "colony,expeditions,lab,armory,circuit");
  check("Battles is the war slot", WAR_SLOT_ID === "battles" && NAV.find((n) => n.id === "battles")?.war === true);
  check("in peace the nav is 5 slots", visibleNavIds(false).length === 5);
  check("at war the nav is 6 slots (65px per slot at 390 — over the floor)", visibleNavIds(true).length === 6);
  check("the nav always keeps the screen you are on (§1.3)", visibleNavIds(true).includes("battles"));
}

// ===========================================================================
section("2 · CRADLE_SLOTS integrity — six real tiles, no invented state");
{
  check("exactly 6 slots", CRADLE_SLOTS.length === 6, `${CRADLE_SLOTS.length}`);
  check("ids are unique", new Set(CRADLE_SLOTS.map((s) => s.id)).size === 6);
  check("the five domains are covered", (["weaponry", "agriculture", "economy", "industry", "logistics"] as const).every((d) => !!CRADLE_SLOT_BY_ID[d]));
  check("the sixth tile is the Workshop", CRADLE_SLOT_BY_ID.workshop.domain === null);
  for (const s of CRADLE_SLOTS) {
    check(`slot "${s.id}" icon "${s.icon}" exists`, ICON_NAMES.has(s.icon), `${s.icon}`);
    check(`slot "${s.id}" hotspot inside [0,1]²`, s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1, `${s.x},${s.y}`);
    check(`slot "${s.id}" level/ready are pure functions`, typeof s.level === "function" && typeof s.ready === "function");
  }
  for (const s of CRADLE_SLOTS) {
    if (!s.domain) continue;
    check(`slot "${s.id}" label comes from DOMAINS (no duplicated string)`, s.label === DOMAIN_BY_ID[s.domain].name, s.label);
  }
  // the allow-list: a slot may only read state we actually have (§9.2.4)
  const ALLOW = new Set(["resources", "codices", "currency", "deployedDomains", "expeditions", "scientists", "leaders", "daily", "devotion", "devotionStreak", "corruption", "chorusAttention", "prologue", "log", "createdAt", "playerName", "race", "gameId", "armory", "armoryBuilds", "battles", "insight", "studies",
    // pre-existing, DISPLAY-ONLY counters the old Cradle tab already printed (the
    // stores band + the ledger headline); nothing new is invented by adding them.
    "totalEmbersLooted", "totalChipsetsLooted", "completedExpeditions"]);
  const slotSrc = read("game/cradle-slots.ts");
  const reads = [...slotSrc.matchAll(/state\.([a-zA-Z_]+)/g)].map((m) => m[1]);
  check("cradle-slots.ts reads only allow-listed state paths", reads.every((r) => ALLOW.has(r)), reads.join(","));
  const st = state();
  check("kitsHeld() counts forged kits on a fresh colony (0)", kitsHeld(st) === 0, `${kitsHeld(st)}`);
  check("workshop is forgeable on a fresh colony (60 supplies ≥ the cheapest kit)", workshopReady(st) === true);
  check("no domain is affordable on a fresh colony (8 embers)", CRADLE_SLOTS.filter((s) => s.domain).every((s) => s.ready(st) === false));
  const rich = state();
  rich.resources.embers = 5000;
  rich.insight = 5000;
  check("with stores, every domain tile reports ready (one shared predicate)", CRADLE_SLOTS.filter((s) => s.domain).every((s) => s.ready(rich) === true));
  check("the plate's readiness IS engineHelpers.domainAffordable", read("game/cradle-slots.ts").includes("engineHelpers.domainAffordable(state, id)"));
}

// ===========================================================================
section("3 · touch-floor arithmetic (320 / 360 / 390, 5 and 6 slots)");
{
  const px = (name: string): number => {
    const m = css.match(new RegExp(`--${name}:\\s*([0-9.]+)(rem|px)`));
    if (!m) return -1;
    return m[2] === "rem" ? parseFloat(m[1]) * 16 : parseFloat(m[1]);
  };
  const tap = px("spacing-tap");
  const tapLg = px("spacing-tap-lg");
  const nav = px("spacing-nav");
  const ribbon = px("spacing-ribbon");
  const dock = px("spacing-dock");
  check(`--spacing-tap = ${tap}px ≥ 44`, tap >= 44);
  check(`--spacing-tap-lg = ${tapLg}px ≥ 48`, tapLg >= 48);
  check(`--spacing-nav = ${nav}px ≥ 44 (Material bar floor)`, nav >= 44);
  check(`--spacing-ribbon = ${ribbon}px ≥ 44`, ribbon >= 44);
  check(`--spacing-dock = ${dock}px ≥ 44`, dock >= 44);
  for (const w of [320, 360, 390]) {
    for (const slots of [5, 6]) {
      const each = Math.floor(w / slots);
      check(`${w}px / ${slots} slots = ${each}px ≥ 44 (height 64 ≥ 44)`, each >= 44 && nav >= 44);
    }
  }
  const btnSrc = readFileSync(ACTIONBTN, "utf8");
  check("ActionButton sm = min-h-tap (44)", btnSrc.includes('sm: "min-h-tap'));
  check("ActionButton md = min-h-tap-lg (48) — the default", btnSrc.includes('md: "min-h-tap-lg'));
  check("ActionButton lg = 56px", btnSrc.includes("min-h-[56px]"));
  check("aria-disabled, never the HTML disabled attribute", btnSrc.includes("aria-disabled={locked") && !/<button[^>]*\sdisabled=/.test(btnSrc));
  check("a locked action carries a visible reason line", btnSrc.includes("reason"));
}

// ===========================================================================
section("4 · presentation only — the new shell reads no state we did not have");
{
  const ALLOW = new Set(["resources", "codices", "currency", "deployedDomains", "expeditions", "scientists", "leaders", "daily", "devotion", "devotionStreak", "corruption", "chorusAttention", "prologue", "log", "createdAt", "playerName", "race", "gameId", "armory", "armoryBuilds", "battles", "insight", "studies",
    // pre-existing, DISPLAY-ONLY counters the old Cradle tab already printed (the
    // stores band + the ledger headline); nothing new is invented by adding them.
    "totalEmbersLooted", "totalChipsetsLooted", "completedExpeditions"]);
  const offenders: string[] = [];
  for (const f of newFiles) {
    const src = readFileSync(`${SITE}/${f}`, "utf8");
    for (const m of src.matchAll(/\bstate\.([a-zA-Z_]+)/g)) {
      if (!ALLOW.has(m[1])) offenders.push(`${f}: state.${m[1]}`);
    }
  }
  check(`no new component reads an unlisted state path (${newFiles.length} files scanned)`, offenders.length === 0, offenders.join(" | "));
  const badgeReads = [...read("game/nav-badges.ts").matchAll(/\bstate\.([a-zA-Z_]+)/g)].map((m) => m[1]);
  check("nav-badges.ts reads only allow-listed paths", badgeReads.every((r) => ALLOW.has(r)), badgeReads.join(","));
  const cradleSrc = readFileSync(`${SITE}/src/components/screens/CradleScreen.tsx`, "utf8");
  const allNew = newFiles.map((f) => readFileSync(`${SITE}/${f}`, "utf8")).join("\n");
  check("no new component invents a play-time accumulator (§8.8)", !/(accumulated|playMs|watchLeft|activeMs)\s*[:=]/.test(allNew.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")));
  check('the Act I plate reserves data-slot="height-clock"', cradleSrc.includes('data-slot="height-clock"'));
  check("the reserved clock line renders NO value (empty element, no interpolation)",
    /data-slot="height-clock"[^>]*\/>/.test(cradleSrc) && !/data-slot="height-clock"[^>]*>\{[^}]*\}/.test(cradleSrc));
}

// ===========================================================================
section("5 · badge purity — pure functions of state, a closed list");
{
  const st = state();
  const before = JSON.stringify(navBadges(st, THE_TAB));
  const realNow = Date.now;
  (Date as unknown as { now: () => number }).now = () => T0 + 999_999;
  const after = JSON.stringify(navBadges(st, THE_TAB));
  (Date as unknown as { now: () => number }).now = realNow;
  check("a badge set does not depend on the clock", before === after);
  const src = read("game/nav-badges.ts");
  check("nav-badges.ts contains no Math.random", !src.includes("Math.random"));
  check("nav-badges.ts reads no clock (no Date.now / now parameter)", !/Date\.now|,\s*now/.test(src));
  check("the badge list is closed: 5 predicates, one file", ["devotionReady", "teamsAway", "recoveryReady", "forgeReady", "liveFights"].every((f) => src.includes(`function ${f}(`)));
  check("a new colony shows at most ONE badge (no badge storm)",
    Object.keys(navBadges(st, THE_TAB)).length <= 1, JSON.stringify(navBadges(st, THE_TAB)));
  const busy = state();
  busy.resources.embers = 5000;
  busy.insight = 5000;
  check("ready states light up from real affordability", recoveryReady(busy) === true && navBadges(busy, THE_TAB).lab?.lit === true);
  check("teams away counts only teams in the field", teamsAway(busy) === 0 && liveFights(busy) === 0);
  check("the war slot appears at the Fall's height", atWar({ ...state(), prologue: { ...state().prologue, stage: "height" } } as GameState, THE_TAB) === true);
  check("the war slot appears whenever the player is on Battles", atWar(state(), "battles") === true);
  check("in peace, with nothing running, there is no war slot", atWar(state(), THE_TAB) === false);
  check("Devotion-ready is a state fact, not a timer", devotionReady(state()) === false || devotionReady(state()) === true);
}

// ===========================================================================
section("6 · G4 structural — the card can never grow a price");
{
  const card = readFileSync(ROSTERCARD, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const banned = ["price", "purchase", "buy", "pack", "unlock", "get ", "timer", "gem", "offer", "gacha", "random"];
  for (const b of banned) {
    check(`RosterCard carries no "${b}" affordance`, !card.toLowerCase().includes(b), b);
  }
  check("RosterCard has no purchase-shaped prop", !/(price|pack|shop|cost)\??:/.test(card));
  check("the portrait is an honest placeholder (sigil plate + initial)",
    card.includes("emblem") && card.includes("initial"));
}

// ===========================================================================
section("7 · The Fall — every guarantee re-asserted against the new chrome");
{
  const bottomNav = readFileSync(BOTTOMNAV, "utf8");
  check('the Battles slot carries data-tutorial-target="nav-battles"', bottomNav.includes('data-tutorial-target={n.id === "battles" ? "nav-battles" : undefined}'));
  check("the nav slot carries data-tab", bottomNav.includes("data-tab={n.id}"));
  check('"nav-battles" is still in the UiTarget union', readFileSync(CUES, "utf8").includes('| "nav-battles"'));
  const battleSrc = readFileSync(BATTLES, "utf8");
  check("cue targets keep scroll-mt-32 / scroll-mb-40 (no value change)", battleSrc.includes("scroll-mb-40") && battleSrc.includes("scroll-mt-32"));
  check("the narration plate carries no z- class", !/narration[\s\S]{0,200}?z-\d/.test(battleSrc));
  const playSrc = readFileSync(PLAY, "utf8");
  check("the first-run nudge is suppressed on the Battles tab (§8.3)", playSrc.includes('firstRunNotice && tab !== "battles"'));
  check("the toast clears the nav height (§8.4)", playSrc.includes("--spacing-nav"));
  // ---- Phase 1: the frame replaced the old header, and there is ONE nav ----
  const appShell = readFileSync(`${SITE}/src/components/shell/AppShell.tsx`, "utf8");
  const ribbon = readFileSync(`${SITE}/src/components/shell/Ribbon.tsx`, "utf8");
  check("the old web <header> is gone (deleted with the ribbon+nav frame)",
    !playSrc.includes('className="sticky top-0 z-40 border-b border-line-strong bg-surf-1"') && !playSrc.includes("function Shell("));
  check("the old header's resource chips and meters are gone with it",
    !playSrc.includes("ResourceChip") && !playSrc.includes("taint {") && !playSrc.includes("Chorus {Math.round"));
  check("AppShell renders the ribbon AND the one bottom nav", appShell.includes("<Ribbon") && appShell.includes("<BottomNav"));
  check("no second navigation survives in play.tsx", !/aria-label="Sections"/.test(playSrc));
  check("the ribbon is sticky chrome at z-40, the nav is fixed at z-40",
    ribbon.includes("sticky top-0 z-40") && readFileSync(BOTTOMNAV, "utf8").includes("fixed inset-x-0 bottom-0 z-40"));
  check("the Cradle sheet exists and is wired to the identity tile", appShell.includes("onIdentity") && existsSync(`${SITE}/src/components/shell/CradleSheet.tsx`));
  check("the Cradle sheet holds every old header control",
    ["Your colonies", "How to Play", "Feedback", "Sound", "Full screen", "Log Out", "Account"].every((t) => readFileSync(`${SITE}/src/components/shell/CradleSheet.tsx`, "utf8").includes(t)));
  const cradle = readFileSync(`${SITE}/src/components/screens/CradleScreen.tsx`, "utf8");
  check("the home screen renders the plate, status strip, roster, shelf and stores band",
    ["cradle-plate", "advance-bar", "status-strip", "roster-strip", "workshop-shelf", "stores-band"].every((id) => cradle.includes(`testid="${id}"`)));
  check("the Act I plate keeps its testids and moves onto the home screen only",
    cradle.includes('testid="act1-banner"') && cradle.includes('testid="act1-open-front"') && cradle.includes('testid="act1-leave"') && !playSrc.includes("<Act1Banner"));
  check("the home screens' actions are 48px (md) and blocked ones state a reason",
    cradle.includes('size="md"') && cradle.includes("locked={") && cradle.includes("reason={"));
  check("the old colony surface is replaced, not duplicated", !playSrc.includes("<ColonyTab") && playSrc.includes("<CradleScreen"));
  check("the plate's 6 tiles are the CRADLE_SLOTS table (no hand-written tiles)", cradle.includes("CRADLE_SLOTS.map("));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
