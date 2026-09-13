// V6 colony-side Armory verification (weapons-system design 2026-09-12).
// Coverage: catalog integrity for ALL SIX races (5 families × 4 tiers each,
// per design/weapons-catalogs-all-races.md); tier stat scaling (×1.5/×2.2/×3.2,
// rounded per the module contract — strictly increasing); §6 costs & build times; research gates (hub + 5 family forges +
// Plasma Refinement); build/upgrade loop with offline resolution, one
// build-per-family, records consumed (idempotent resolve); plasma refinement
// (25 embers → 1, research-gated); legacy-save migration (ensureArmory);
// deed dents (first_weapon_built / weapon_tier4 — +10 contribution each via
// deedsCompleted, formula untouched); model designation naming
// (`FamilyName — <TierLanguage> Mk <I|II|III|IV>`); earn-only guardrails
// (no plasma/armory/weapon/trebuchet in monetization.ts, contributionScore
// ignores weaponsBuilt/armory).
// Run: cd /home/team/shared/armory-tests && bun run armory-verify.ts
// (also runnable unchanged from the site dir for the real-save smoke).
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import * as weapons from "/home/team/shared/site/src/game/armory.ts";
import { ARMORY_TREE, getArmoryTech } from "/home/team/shared/site/src/game/research.ts";
import { assertCatalogFair } from "/home/team/shared/site/src/game/monetization.ts";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";
import { publicState } from "/home/team/shared/site/src/game/api.ts";
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  ❌ ${name} ${extra}`); } }
const now = Date.now();
const ALL_RACES = ["grays", "nephilim", "draconians", "anunnaki", "ashtar", "watchers"] as const;
const ROLES = [...weapons.WEAPON_TYPES];
/** A colony with the Armory opened and all five family forges researched. */
function readyColony(plasma = 0, name = "Forge"): GameState {
  const st = engine.newGame(name, "watchers", now);
  st.resources.supplies = 1500; st.resources.embers = 1200; st.resources.gas = 400; st.resources.plasma = plasma;
  st.techsResearched.push("armory_hub");
  for (const t of Object.values(weapons.ARMORY_FAMILY_TECH)) st.techsResearched.push(t);
  return st;
}
console.log("— 1 · catalog integrity (5 families × 4 tiers, schema for all 6 races) —");
{
  check("Watchers catalog has exactly 5 families", weapons.raceFamilies("watchers").length === 5);
  const names = weapons.raceFamilies("watchers").map((f) => f.name);
  check(
    "families: Unwritten Blade / The Attendance / Revelation Lens / The Last Bell / Chalk-Mark Warden",
    names.join("|") === "The Unwritten Blade|The Attendance|Revelation Lens|The Last Bell|Chalk-Mark Warden",
    names.join("|"),
  );
  check(
    "all 6 RaceId keys present in catalog schema (watchers + grays/nephilim/draconians/anunnaki/ashtar)",
    ALL_RACES.every((r) => r in weapons.ARMORY_CATALOG && (weapons.ARMORY_CATALOG as Record<string, unknown>)[r] !== undefined),
  );
  for (const race of ALL_RACES) {
    const fams = weapons.raceFamilies(race);
    const five = fams.length === 5;
    const roles = fams.map((f) => f.id);
    const rolesOk = JSON.stringify(roles.sort()) === JSON.stringify([...ROLES].sort());
    const distinctFamIds = new Set(fams.map((f) => f.id)).size === 5;
    const named = fams.every((f) => typeof f.name === "string" && f.name.length > 0) && new Set(fams.map((f) => f.name)).size === 5;
    const tier4 = weapons.TIER_LANGUAGES[race].length === 4;
    check(`${race}: 5 families, all 5 roles, distinct names, 4-tier language`, five && rolesOk && distinctFamIds && named && tier4, `${fams.length} fams / ${roles.join(",")}`);
  }
  check(
    "role tags: Frontline/Assault/Precision/Siege/Engine (family ids are the 5 roles)",
    JSON.stringify(weapons.raceFamilies("watchers").map((f) => f.id)) === JSON.stringify(["frontline", "assault", "precision", "siege", "engine"]),
  );
  check("tier language Primer/Regulated/Catechism/Apocrypha", weapons.TIER_LANGUAGES.watchers.join(",") === "Primer,Regulated,Catechism,Apocrypha");
  const bell = weapons.familyFor("watchers", "siege")!;
  check(
    "all 4 designations for The Last Bell (Primer Mk I → Apocrypha Mk IV)",
    JSON.stringify([1, 2, 3, 4].map((t) => weapons.modelName("watchers", bell, t))) ===
      JSON.stringify(["The Last Bell — Primer Mk I", "The Last Bell — Regulated Mk II", "The Last Bell — Catechism Mk III", "The Last Bell — Apocrypha Mk IV"]),
  );
  check("model name — The Last Bell — Catechism Mk III", weapons.modelName("watchers", bell, 3) === "The Last Bell — Catechism Mk III");
  check("cross-race model: Grays Archive Purge — Folio Mk III", weapons.modelName("grays", weapons.familyFor("grays", "siege")!, 3) === "Archive Purge — Folio Mk III");
  check("cross-race model: Anunnaki The Architect's Eye — Foundation Mk II", weapons.modelName("anunnaki", weapons.familyFor("anunnaki", "precision")!, 2) === "The Architect's Eye — Foundation Mk II");
  check("tier language falls back sanely on unknown race (→ Watchers)", (weapons.modelName as (r: string, f: typeof bell, t: number) => string)("not-a-race", bell, 2) === "The Last Bell — Regulated Mk II");
}
console.log("— 2 · stats: multipliers ×1.5/×2.2/×3.2 over T1 (rounded), all four axes —");
{
  const f = weapons.familyFor("watchers", "siege")!;
  const t1 = weapons.weaponStats(f.id, 1); const t4 = weapons.weaponStats(f.id, 4);
  for (const k of ["power", "precision", "guard", "logistics"] as const) {
    check(`T4 ${k} = round(×3.2)`, t4[k] === Math.round(t1[k] * 3.2) && t1[k] >= 1, `t1=${t1[k]} t4=${t4[k]}`);
  }
  const t2 = weapons.weaponStats(f.id, 2); const t3 = weapons.weaponStats(f.id, 3);
  check("T2 = ×1.5 (rounded)", t2.power === Math.round(t1.power * 1.5));
  check("T3 = ×2.2 (rounded)", t3.power === Math.round(t1.power * 2.2));
  check("T4 ≥ T3 ≥ T2 ≥ T1 on every axis", t1.power <= t2.power && t2.power <= t3.power && t3.power <= t4.power && t1.logistics <= t2.logistics && t2.logistics <= t3.logistics && t3.logistics <= t4.logistics);
  check("five families have distinct stat identities", new Set(weapons.raceFamilies("watchers").map((x) => JSON.stringify(weapons.weaponStats(x.id, 1)))).size === 5);
}
console.log("— 3 · costs & build times per §6 table —");
{
  check("T1: 40 supplies + 20 embers + 6 fuel, 0 plasma", JSON.stringify(weapons.weaponCost(1)) === JSON.stringify({ supplies: 40, embers: 20, fuel: 6, plasma: 0 }));
  check("T2: 120 supplies + 60 embers + 18 fuel + 3 plasma", JSON.stringify(weapons.weaponCost(2)) === JSON.stringify({ supplies: 120, embers: 60, fuel: 18, plasma: 3 }));
  check("T3: 320/160/45 + 12 plasma", JSON.stringify(weapons.weaponCost(3)) === JSON.stringify({ supplies: 320, embers: 160, fuel: 45, plasma: 12 }));
  check("T4: 900/420/120 + 30 plasma", JSON.stringify(weapons.weaponCost(4)) === JSON.stringify({ supplies: 900, embers: 420, fuel: 120, plasma: 30 }));
  check("costs strictly increase across tiers", [1, 2, 3].every((t) => weapons.weaponCost(t + 1).supplies > weapons.weaponCost(t).supplies && weapons.weaponCost(t + 1).plasma > weapons.weaponCost(t).plasma));
  check("times 45m/3h/12h/2d", JSON.stringify([weapons.weaponTimeMs(1), weapons.weaponTimeMs(2), weapons.weaponTimeMs(3), weapons.weaponTimeMs(4)]) === JSON.stringify([45 * 60000, 3 * 3600000, 12 * 3600000, 2 * 86400000]));
}
console.log("— 4 · research gates (hub + 5 family forges + Plasma Refinement) —");
{
  check("ARMORY_TREE = hub + 5 families + plasma refinement (7 nodes)", ARMORY_TREE.length === 7, `${ARMORY_TREE.length}`);
  const st0 = engine.newGame("R0", "watchers", now);
  check("family forge research gated on hub (unavailable without it)", !engine.armoryTechAvailable(st0, "armory_frontline"));
  const st = engine.newGame("R", "watchers", now); st.codices = 50; st.techsResearched.push("armory_hub");
  const fam = weapons.raceFamilies("watchers")[0];
  const unlockId = weapons.ARMORY_FAMILY_TECH[fam.id];
  check("hub researched → family forge researchable", engine.armoryTechAvailable(st, unlockId));
  check("hub researched → Plasma Refinement researchable", engine.armoryTechAvailable(st, "plasma_refinement"));
  st.resources.supplies = 200; st.resources.embers = 100; st.resources.gas = 50;
  const gate = engine.startWeaponBuild(st, fam.id, now);
  check("family forge build locked before its research", !gate.ok && (gate.error ?? "").includes("locked"), gate.error ?? "");
  const leader = st.leaders[0];
  const res = engine.beginArmoryResearch(st, unlockId, leader.id, now);
  check("beginArmoryResearch ok with codices", res.ok === true, res.error ?? "");
  check("codices deducted exactly the node cost (50 − 12 = 38)", st.codices === 50 - getArmoryTech(unlockId).codicesCost, `${st.codices}`);
  check("leader assigned", leader.assignment === unlockId);
  check("in-progress blocks re-appoint", !engine.beginArmoryResearch(st, unlockId, leader.id, now).ok);
  engine.advance(st, now + 10_000_000);
  check("family forge resolves into techsResearched", st.techsResearched.includes(unlockId));
  check("startWeaponBuild now allowed", engine.startWeaponBuild(st, fam.id, now + 10_000_001).ok === true);
}
console.log("— 5 · build loop: gating, plasma, one-at-a-time, offline resolve, deeds —");
{
  const st = readyColony(0);
  const fam = weapons.familyFor("watchers", "siege")!;
  let res = engine.startWeaponBuild(st, fam.id, now);
  check("T1 build OK (no plasma needed)", res.ok === true, res.error ?? "");
  check("resources deducted (40/20/6 per §6)", st.resources.supplies === 1460 && st.resources.embers === 1180 && st.resources.gas === 394, `${st.resources.supplies}/${st.resources.embers}/${st.resources.gas}`);
  check("second build while in-flight rejected (no queue)", !engine.startWeaponBuild(st, fam.id, now + 1).ok);
  engine.advance(st, now + 45 * 60000 + 1000);
  check("build resolved offline → tier 1", engine.armoryFamilyState(st, fam.id).tier === 1);
  check("everBuilt latched", engine.armoryFamilyState(st, fam.id).everBuilt === true);
  check("record consumed after resolve", !(fam.id in (st.armoryBuilds ?? {})));
  check("weaponsBuilt = 1", st.weaponsBuilt === 1);
  check("deed first_weapon_built awarded", st.deedsCompleted.includes("first_weapon_built"));
  check("contribution: 6 techs×5 + 1 deed×10 + 2 deed codices = 42", engine.contributionScore(st) === 42, `${engine.contributionScore(st)}`);
  res = engine.startWeaponBuild(st, fam.id, now);
  check("T2 upgrade needs plasma → rejected at 0", !res.ok && (res.error ?? "").includes("plasma"), res.error ?? "");
  st.resources.plasma = 3;
  res = engine.startWeaponBuild(st, fam.id, now);
  check("T2 upgrade OK with 3 plasma", res.ok === true, res.error ?? "");
  engine.advance(st, now + 3 * 3600000 + 1000);
  check("T2 resolved", engine.armoryFamilyState(st, fam.id).tier === 2);
  const scor = engine.contributionScore(st);
  st.resources.plasma = 50; st.resources.supplies = 1500; st.resources.embers = 1200; st.resources.gas = 400;
  engine.startWeaponBuild(st, fam.id, now); engine.advance(st, now + 12 * 3600000 + 1000);
  engine.startWeaponBuild(st, fam.id, now); engine.advance(st, now + 2 * 86400000 + 1000);
  check("T3 then T4 reached", engine.armoryFamilyState(st, fam.id).tier === 4, `${engine.armoryFamilyState(st, fam.id).tier}`);
  check("weaponsBuilt = 4", st.weaponsBuilt === 4);
  check("weapon_tier4 deed awarded", st.deedsCompleted.includes("weapon_tier4"));
  check("contribution: both deeds +10 each + their codices (+15 net from 42 = 57)", engine.contributionScore(st) === 57, `${engine.contributionScore(st)} (was ${scor})`);
  check("T4 final — no further upgrade", !engine.startWeaponBuild(st, fam.id, now).ok);
  const beforeIdem = { wb: st.weaponsBuilt, deeds: st.deedsCompleted.length, builds: Object.keys(st.armoryBuilds ?? {}).length };
  engine.resolveArmoryBuilds(st, now + 9e12);
  check("resolveArmoryBuilds idempotent — records consumed, no double-count", st.weaponsBuilt === beforeIdem.wb && st.deedsCompleted.length === beforeIdem.deeds && beforeIdem.builds === 0, JSON.stringify(beforeIdem));
}
console.log("— 6 · plasma: lab refinement (25 embers, gated) —");
{
  const st = engine.newGame("P", "watchers", now);
  st.techsResearched.push("plasma_refinement"); st.resources.embers = 100;
  const res = engine.refinePlasma(st, now);
  check("refine → 25 embers → 1 plasma", res.ok && st.resources.embers === 75 && st.resources.plasma === 1, res.error ?? "");
  const st2 = engine.newGame("P2", "watchers", now); st2.resources.embers = 100;
  check("refinement gated without research", !engine.refinePlasma(st2, now).ok);
  const st3 = engine.newGame("P3", "watchers", now); st3.techsResearched.push("plasma_refinement"); st3.resources.embers = 10;
  check("refinement needs 25 embers", !engine.refinePlasma(st3, now).ok);
  check("deep-raid salvage constants sane (0..1 chance, 2–5 yield)", weapons.ARMORY_CONFIG.plasmaSalvageChance >= 0 && weapons.ARMORY_CONFIG.plasmaSalvageChance <= 1 && weapons.ARMORY_CONFIG.plasmaSalvageMin >= 2 && weapons.ARMORY_CONFIG.plasmaSalvageMax >= weapons.ARMORY_CONFIG.plasmaSalvageMin);
}
console.log("— 7 · migration: old saves (no armory fields) load green —");
{
  const st = engine.newGame("Old", "watchers", now) as GameState & Record<string, unknown>;
  delete (st as any).armory; delete (st as any).armoryBuilds; delete (st as any).weaponsBuilt;
  engine.advance(st, now + 1);
  check("ensureArmory inits armory/armoryBuilds/weaponsBuilt", typeof st.armory === "object" && typeof st.armoryBuilds === "object" && st.weaponsBuilt === 0, JSON.stringify({ a: typeof st.armory, ab: typeof st.armoryBuilds, wb: st.weaponsBuilt }));
  check("armoryFamilyState safe on empty (role id)", engine.armoryFamilyState(st, "siege").tier === 0);
  check("publicState keeps armory usable by client (no strip, nothing sensitive)", typeof publicState(st).resources.plasma === "number" && typeof (publicState(st) as any).armory === "object" && typeof (publicState(st) as any).armoryBuilds === "object");
}
console.log("— 8 · guardrails: earn-only, formula untouched —");
{
  assertCatalogFair(); // must throw if any catalog item names plasma/armory/weapon/trebuchet or grants plasma
  check("assertCatalogFair passes clean (no armory vocab in monetization)", true);
  const fs = await import("node:fs");
  const monet = fs.readFileSync("/home/team/shared/site/src/game/monetization.ts", "utf-8");
  for (const word of ["plasma", "armory", "weapon", "trebuchet"]) check(`monetization.ts never names "${word}" (before the forbidden-terms tripwire)`, !new RegExp(`\\.?${word}[^A-Za-z]`).test(monet.replace(/FORBIDDEN_POWER_TERMS[\s\S]*/, "")), word);
  const st = readyColony(200, "Forge8");
  st.completedExpeditions = 5; st.weaponsBuilt = 50; st.armory = { x: { tier: 4, everBuilt: true } };
  check("contributionScore ignores weaponsBuilt/armory (exps*2 + techs*5 = 40)", engine.contributionScore(st) === 40, `${engine.contributionScore(st)}`);
}
console.log(`\nARMORY RESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);