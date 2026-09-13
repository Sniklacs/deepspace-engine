// Engine-level play-test for the MONETIZATION SEAMS (V5) — catalog, currency
// ledger, entitlements, payment-provider stub, battle pass, and the fairness
// guardrails. Mirrors the leader-xp/revelation verify style.
// Run: cd /home/team/shared/monetization-tests && bun run monetization-verify.ts
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import * as m from "/home/team/shared/site/src/game/monetization.ts";
import { publicState } from "/home/team/shared/site/src/game/api.ts";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}
/** Deterministic randomness: run fn with Math.random pinned to `v` (0.999 ⇒
 *  no wildcard / no radiation hit / no corruption — a clean run). */
function withRand<T>(v: number, fn: () => T): T {
  const orig = Math.random;
  Math.random = () => v;
  try { return fn(); } finally { Math.random = orig; }
}
/** Fabricate an in-flight expedition and resolve it deterministically.
 *  `at` fast-forwards PAST the previous advance (lastTick) so sequential
 *  runs each actually resolve. */
function runExpedition(st: GameState, zoneId: string, lossPct: number, pureAtLaunch: boolean, base: number, at?: number) {
  const id = "exp-mon-" + st.expeditions.length;
  st.expeditions.push({
    id, zoneId, label: zoneId, assignedScientists: 2, suppliesCost: 10,
    startedAt: base, durationMs: 60_000, status: "out", lossPct,
    protection: 0.95, pureAtLaunch,
  } as unknown as (typeof st.expeditions)[number]);
  withRand(0.999, () => engine.advance(st, at ?? base + 61_000));
}
/** Give a colony everything needed to launch a real expedition. */
function gearUp(st: GameState) {
  st.resources.supplies = 1000; st.resources.gas = 50; st.resources.battery = 50;
  st.resources.skmech = 5; st.resources.medkit = 2; st.resources.mechkit = 2;
  st.resources.armorkit = 2; st.resources.embers = 10;
}

const now = Date.now(); // real clock (never mock time)

// ======================================================================
console.log("— 0 · V5 defaults —");
const st0 = engine.newGame("Mon0", "watchers", now);
check("new game has currency", st0.currency.scrip === 0 && st0.currency.votives === 0 && st0.currency.ledger.length === 0);
check("new game has entitlements", st0.entitlements.cosmetics.length === 0 && st0.entitlements.packs.length === 0 && st0.entitlements.sigils === 0);
check("new game has battle pass", st0.battlePass.seasonId === "s0_the_shattering" && st0.battlePass.xp === 0 && st0.battlePass.premium === false);
check("version is 8 (V8 World Atlas — bumped from 7 by the V8 build)", st0.version === 8);
check("tier 1 at 0 XP", m.tierFromXp(0) === 1);
check("tier 2 at 1000 XP", m.tierFromXp(1000) === 2);
check("tier 28 at 27999 XP", m.tierFromXp(27999) === 28);
check("tier 28 caps", m.tierFromXp(999999) === 28);

// ======================================================================
console.log("— 1 · catalog validity (spec §2/§3/§4) —");
check("16 wave-1 cosmetics", m.COSMETICS.length === 16);
check("9 purchasable / 7 deed", m.PURCHASABLE_COSMETICS.length === 9 && m.DEED_COSMETICS.length === 7);
check("unique ids", new Set(m.COSMETICS.map((c) => c.id)).size === 16);
const EXP_PRICES: Record<string, number> = {
  "the-observatory-hull": 850, "basalt-citadel": 750, "the-long-vigil": 450, emberline: 350,
  "votive-bell": 400, "the-archivists-duster": 800, "the-sundered-ring": 300,
  "star-atlas-cloth": 450, "scaffold-bastion": 650,
};
const priceOk = m.PURCHASABLE_COSMETICS.every((c) => EXP_PRICES[c.id] === c.priceVotives);
check("purchasable prices match §2.1 exactly", priceOk);
check("all purchasable prices inside $3–9 band (300–900)", m.PURCHASABLE_COSMETICS.every((c) => c.priceVotives! >= 300 && c.priceVotives! <= 900));
const deedIds = m.DEED_COSMETICS.map((c) => c.deedId);
check("deed items carry D1–D7 deed ids and zero price",
  deedIds.includes("deed_first_clean") && deedIds.includes("deed_frontier") && deedIds.includes("deed_purify") &&
  deedIds.includes("deed_tier3_research") && deedIds.includes("deed_l5_specialized") &&
  deedIds.includes("deed_30day_devotion") && deedIds.includes("deed_contribution_award") &&
  m.DEED_COSMETICS.every((c) => !c.priceVotives));
check("slots are valid", m.COSMETICS.every((c) => ["cradleFacade", "banner", "vehicleTrim", "shrineMotif", "leaderGarb", "sigilFrame", "palette"].includes(c.slot)));
check("3 head-start packs", m.HEAD_START_PACKS.length === 3 && m.HEAD_START_PACKS.map((p) => p.id).join(",") === "scavengers-kit,expeditionary-kit,long-haul-cart");
const sk = m.PACK_BY_ID["scavengers-kit"];
check("Scavenger's Kit contents (spec §3.1)", sk.grants.filter((g) => g.kind === "resource").length === 5 && sk.grants.some((g) => g.kind === "resource" && g.key === "supplies" && g.amount === 150) && sk.grants.some((g) => g.kind === "resource" && g.key === "gas" && g.amount === 24) && sk.grants.some((g) => g.kind === "currency" && g.amount === 150));
const ek = m.PACK_BY_ID["expeditionary-kit"];
check("Expeditionary Kit contents (2× supplies/fuel + armor+tool set)", ek.grants.some((g) => g.kind === "resource" && g.key === "supplies" && g.amount === 300) && ek.grants.some((g) => g.kind === "resource" && g.key === "gas" && g.amount === 48) && ek.grants.some((g) => g.kind === "resource" && g.key === "armorkit" && g.amount === 2) && ek.grants.some((g) => g.kind === "resource" && g.key === "mechkit" && g.amount === 2) && ek.grants.some((g) => g.kind === "currency" && g.amount === 300));
const lhc = m.PACK_BY_ID["long-haul-cart"];
check("Long-Haul Cart contents (vehicle + Emberline trim + 450 Votives)", lhc.grants.some((g) => g.kind === "vehicle" && g.vehicleId === "base_cart") && lhc.grants.some((g) => g.kind === "cosmetic" && g.itemId === "emberline") && lhc.grants.some((g) => g.kind === "currency" && g.amount === 450));
check("all 3 packs carry 0 Scrip (spec lists none; §3.3 cap 200)", m.HEAD_START_PACKS.every((p) => p.scrip === 0));
check("4 votive pack sizes (§2.3)", m.VOTIVE_PACKS.length === 4 && m.VOTIVE_PACKS.map((p) => p.votives + p.bonus).join(",") === "550,1280,3300,7300");
check("28 battle-pass tiers", m.SEASON_TIERS.length === 28);
const freeKinds = m.SEASON_TIERS.map((t) => t.free.kind);
const premKinds = m.SEASON_TIERS.map((t) => t.premium.kind);
check("free track: 15 scrip / 8 cosmetics / 4 sigils / capstone", freeKinds.filter((k) => k === "scrip").length === 15 && freeKinds.filter((k) => k === "cosmetic").length === 8 && freeKinds.filter((k) => k === "sigil").length === 4 && freeKinds.filter((k) => k === "capstone_deed").length === 1);
check("free capstone at tier 28", m.SEASON_TIERS[27].free.kind === "capstone_deed" && m.SEASON_TIERS[27].free.item?.id === "s0-banner-shatterlands");
check("premium track: 17 cosmetics / 6 votives / 4 convenience / showcase", premKinds.filter((k) => k === "cosmetic").length === 17 && premKinds.filter((k) => k === "votives").length === 6 && premKinds.filter((k) => k === "convenience").length === 4 && premKinds.filter((k) => k === "showcase").length === 1);
check("premium showcase at tier 28", m.SEASON_TIERS[27].premium.kind === "showcase");
check("premium track has NO scrip/sigil (spec §4.3)", !premKinds.includes("scrip") && !premKinds.includes("sigil"));

// ======================================================================
console.log("— 2 · currency ledger (§1.4) —");
const st2 = engine.newGame("Mon2", "grays", now);
check("grant scrip", m.grantCurrency(st2, "scrip", 100, "evt-1", "expedition reward", now).ok === true && st2.currency.scrip === 100);
check("grant idempotent (same eventId)", m.grantCurrency(st2, "scrip", 100, "evt-1", "retry", now).idempotent === true && st2.currency.scrip === 100);
check("ledger has exactly 1 entry", st2.currency.ledger.length === 1);
check("grant votives", m.grantCurrency(st2, "votives", 50, "evt-2", "purchase credit", now, "purchase").ok === true && st2.currency.votives === 50);
check("grant kind recorded", st2.currency.ledger.find((e) => e.eventId === "evt-2")?.kind === "purchase");
check("ledger entry shape", (() => { const e = st2.currency.ledger[0]; return typeof e.eventId === "string" && typeof e.amount === "number" && typeof e.reason === "string" && typeof e.ts === "number" && e.currency === "scrip"; })());
check("spend ok", m.spendCurrency(st2, "scrip", 40, "evt-3", "workshop", now).ok === true && st2.currency.scrip === 60);
check("spend idempotent", m.spendCurrency(st2, "scrip", 40, "evt-3", "retry", now).idempotent === true && st2.currency.scrip === 60);
check("balance never negative after ops", st2.currency.scrip === 60 && st2.currency.votives === 50);
check("overspend refused (no negative balance)", (() => { const before = st2.currency.votives; const r = m.spendCurrency(st2, "votives", 9999, "evt-4", "impossible", now); return !r.ok && st2.currency.votives === before && st2.currency.ledger.length === 3; })());
check("zero/negative amounts refused", !m.grantCurrency(st2, "scrip", 0, "evt-5", "x").ok && !m.spendCurrency(st2, "scrip", -5, "evt-6", "x").ok);
check("missing eventId refused", !m.grantCurrency(st2, "scrip", 5, "", "x").ok && !m.spendCurrency(st2, "scrip", 5, "", "x").ok);

// ======================================================================
console.log("— 3 · entitlements (§7.4) —");
const st3 = engine.newGame("Mon3", "nephilim", now);
const g1 = m.grantEntitlement(st3, "the-observatory-hull", "purchase", "ent-1", now);
check("grant ok", g1.ok === true);
check("owns true", m.owns(st3, "the-observatory-hull"));
check("grant twice same eventId → one entitlement", m.grantEntitlement(st3, "the-observatory-hull", "purchase", "ent-1", now).idempotent === true && st3.entitlements.cosmetics.filter((c) => c === "the-observatory-hull").length === 1);
check("grant twice different eventId → still one entitlement", m.grantEntitlement(st3, "the-observatory-hull", "purchase", "ent-2", now).idempotent === true && st3.entitlements.cosmetics.filter((c) => c === "the-observatory-hull").length === 1);
check("unknown item refused", m.grantEntitlement(st3, "nope", "purchase", "ent-3", now).ok === false);
check("deed item cannot be purchased", (() => { const r = m.grantEntitlement(st3, "first-light-sigil", "purchase", "ent-4", now); return !r.ok && !m.owns(st3, "first-light-sigil"); })());
check("deed item granted via deed source", m.grantEntitlement(st3, "first-light-sigil", "deed", "ent-5", now).ok === true && m.owns(st3, "first-light-sigil"));
check("revoke removes", (() => { const r = m.revokeEntitlement(st3, "first-light-sigil", "rev-1"); return r.ok && !m.owns(st3, "first-light-sigil"); })());
check("revoke idempotent", m.revokeEntitlement(st3, "first-light-sigil", "rev-2").idempotent === true);
check("equip unowned refused", m.equipCosmetic(st3, "basalt-citadel", "cradleFacade").ok === false);
check("equip wrong slot refused", m.equipCosmetic(st3, "the-observatory-hull", "banner").ok === false);
check("equip owned ok", m.equipCosmetic(st3, "the-observatory-hull", "cradleFacade").ok === true && st3.entitlements.equips.cradleFacade === "the-observatory-hull");
check("equip unowned 2 refused", m.equipCosmetic(st3, "scaffold-bastion", "cradleFacade").ok === false && st3.entitlements.equips.cradleFacade === "the-observatory-hull");

// ======================================================================
console.log("— 4 · head-start packs (§3) —");
const st4 = engine.newGame("Mon4", "draconians", now);
const sup0 = st4.resources.supplies, gas0 = st4.resources.gas, vot0 = st4.currency.votives;
const pk = m.applyPack(st4, "scavengers-kit", "pk-1", now);
check("apply pack ok", pk.ok === true);
check("supplies +150", st4.resources.supplies === sup0 + 150);
check("gas +24", st4.resources.gas === gas0 + 24);
check("gear set granted", st4.resources.medkit === 1 && st4.resources.mechkit === 1 && st4.resources.armorkit === 1);
check("votives +150", st4.currency.votives === vot0 + 150);
check("pack recorded", st4.entitlements.packs.includes("scavengers-kit"));
check("re-apply same eventId idempotent", m.applyPack(st4, "scavengers-kit", "pk-1", now).idempotent === true && st4.currency.votives === vot0 + 150);
check("re-apply other eventId idempotent", m.applyPack(st4, "scavengers-kit", "pk-2", now).idempotent === true && st4.currency.votives === vot0 + 150);
const st4b = engine.newGame("Mon4b", "ashtar", now);
m.applyPack(st4b, "long-haul-cart", "pk-3", now);
check("cart vehicle granted", st4b.entitlements.vehicles.includes("base_cart"));
check("cart grants Emberline cosmetic", m.owns(st4b, "emberline"));
check("cart votives +450", st4b.currency.votives === 450);
check("unknown pack refused", m.applyPack(st4, "no-pack", "pk-4", now).ok === false);
check("claim without eventId refused", m.applyPack(st4, "expeditionary-kit", "", now).ok === false);

// ======================================================================
console.log("— 5 · in-game Votives shop (§2.1 + §7.4) —");
const st5 = engine.newGame("Mon5", "anunnaki", now);
m.grantCurrency(st5, "votives", 1000, "seed", "test seed", now, "grant");
const buy = m.purchaseWithVotives(st5, "the-observatory-hull", "buy-1", now);
check("purchase ok", buy.ok === true);
check("votives reduced by 850", st5.currency.votives === 150);
check("item owned", m.owns(st5, "the-observatory-hull"));
check("purchase retry idempotent", m.purchaseWithVotives(st5, "the-observatory-hull", "buy-1", now).idempotent === true && st5.currency.votives === 150);
check("insufficient votives refused", (() => { const r = m.purchaseWithVotives(st5, "basalt-citadel", "buy-2", now); return !r.ok && !m.owns(st5, "basalt-citadel") && st5.currency.votives === 150; })());
check("deed item refused in shop", (() => { const r = m.purchaseWithVotives(st5, "the-visionarys-robes", "buy-3", now); return !r.ok && !m.owns(st5, "the-visionarys-robes"); })());
check("unknown item refused", m.purchaseWithVotives(st5, "wat", "buy-4", now).ok === false);

// ======================================================================
console.log("— 6 · payment provider seam (§7.3) —");
const prov = m.createPaymentProvider();
check("factory returns the stub", prov.name === "StubPaymentProvider");
check("createIntent simulates success", await (async () => { const r = await prov.createIntent({ accountId: "a", skuId: "votive-steady", idempotencyKey: "k1", amountCents: 999, currency: "usd" }); return r.ok === true && typeof r.intentId === "string"; })());
check("stub(simulate:false) rejects", await (async () => { const p = m.createStubPaymentProvider(false); const r = await p.createIntent({ accountId: "a", skuId: "x", idempotencyKey: "k", amountCents: 1, currency: "usd" }); return !r.ok; })());
check("verifyWebhook returns verified purchase", await (async () => { const r = await prov.verifyWebhook({ purchaseId: "purch-1", skuId: "votive-steady", accountId: "a" }); return r.ok === true && r.purchase?.skuId === "votive-steady"; })());
check("webhook without skuId rejected", await (async () => { const r = await prov.verifyWebhook({ foo: 1 }); return !r.ok; })());
check("refund simulates ok", await (async () => { const r = await prov.refund({ purchaseId: "purch-1", reason: "chargeback" }); return r.ok; })());

// ---- applyExternalPurchase: provider-confirmed purchases, idempotent ----
const st6 = engine.newGame("Mon6", "watchers", now);
check("votive pack (base+bonus) applied", m.applyExternalPurchase(st6, { purchaseId: "px-1", skuId: "votive-steady" }, now).ok === true && st6.currency.votives === 1280);
check("votive pack replay idempotent", m.applyExternalPurchase(st6, { purchaseId: "px-1", skuId: "votive-steady" }, now).idempotent === true && st6.currency.votives === 1280);
const sup6 = st6.resources.supplies;
check("head-start pack applied", m.applyExternalPurchase(st6, { purchaseId: "px-2", skuId: "scavengers-kit" }, now).ok === true && st6.resources.supplies === sup6 + 150);
check("head-start replay idempotent", m.applyExternalPurchase(st6, { purchaseId: "px-2", skuId: "scavengers-kit" }, now).idempotent === true && st6.resources.supplies === sup6 + 150);
const vot6 = st6.currency.votives;
check("external pass grants WITHOUT spending Votives", m.applyExternalPurchase(st6, { purchaseId: "px-3", skuId: "season-pass-s0_the_shattering" }, now).ok === true && st6.battlePass.premium === true && st6.currency.votives === vot6);
check("pass replay idempotent", m.applyExternalPurchase(st6, { purchaseId: "px-3", skuId: "season-pass-s0_the_shattering" }, now).idempotent === true && st6.currency.votives === vot6);
check("single cosmetic via provider", m.applyExternalPurchase(st6, { purchaseId: "px-4", skuId: "the-observatory-hull" }, now).ok === true && m.owns(st6, "the-observatory-hull") && st6.currency.votives === vot6);
check("unknown sku refused", m.applyExternalPurchase(st6, { purchaseId: "px-5", skuId: "not-a-sku" }, now).ok === false);
check("external purchase requires ids", m.applyExternalPurchase(st6, { purchaseId: "", skuId: "x" }, now).ok === false);

// ======================================================================
console.log("— 7 · battle pass state machine (§4/§7.5) —");
const st7 = engine.newGame("Mon7", "grays", now);
check("claim tier 1 free at 0 XP", m.claimTierReward(st7, 1, "free", now).ok === true && st7.currency.scrip === 200);
check("reclaim idempotent", m.claimTierReward(st7, 1, "free", now).idempotent === true && st7.currency.scrip === 200);
check("claim unearned tier refused", m.claimTierReward(st7, 2, "free", now).ok === false);
check("premium claim without pass refused", m.claimTierReward(st7, 1, "premium", now).ok === false);
st7.battlePass.xp = 1000; // tier 2
check("tier 2 unlocked", m.tierFromXp(st7.battlePass.xp) === 2);
m.grantCurrency(st7, "votives", 750, "vseed", "seed", now, "grant");
check("premium pass via Votives", m.purchasePremiumPass(st7, "pass-1", now).ok === true && st7.battlePass.premium === true && st7.currency.votives === 0);
check("pass idempotent", m.purchasePremiumPass(st7, "pass-2", now).idempotent === true);
check("premium tier 2 claim grants cosmetic", m.claimTierReward(st7, 2, "premium", now).ok === true && m.owns(st7, "s0-banner-shatterline"));
check("premium claim idempotent", m.claimTierReward(st7, 2, "premium", now).idempotent === true);
st7.battlePass.xp = 10000; // tier 11 — unlocks tiers 3/5/10 for the claims below
check("sigil claim adds sigils", (() => { m.claimTierReward(st7, 5, "free", now); return st7.entitlements.sigils === 1; })());
check("convenience claim adds conveniences", (() => { m.claimTierReward(st7, 10, "premium", now); return st7.entitlements.conveniences.includes("preset-slot-1"); })());
check("votive tier claim grants", (() => { const v0 = st7.currency.votives; m.claimTierReward(st7, 3, "premium", now); return st7.currency.votives === v0 + 50; })());

// ---- season XP from play events (daily once/day, weekly target) ----
const st8 = engine.newGame("Mon8", "watchers", now);
m.recordSeasonEvent(st8, "launch_expedition", now);
check("daily launch objective +10", st8.battlePass.xp === 10 && st8.battlePass.dayObjectives.includes("launch_expedition"));
m.recordSeasonEvent(st8, "launch_expedition", now);
check("daily objective only once per day", st8.battlePass.xp === 10);
const prevDay = st8.battlePass.day;
st8.battlePass.day = "2000-01-01"; // roll the window back
m.recordSeasonEvent(st8, "launch_expedition", now);
check("new day grants again", st8.battlePass.xp === 20);
for (let i = 0; i < 10; i++) m.recordSeasonEvent(st8, "expedition_complete", now);
check("weekly expeditions objective +40 once", st8.battlePass.xp === 60 && st8.battlePass.weekCompleted.includes("expedition_complete"));
for (let i = 0; i < 12; i++) m.recordSeasonEvent(st8, "expedition_complete", now);
check("weekly objective done once per week", st8.battlePass.xp === 60);
m.recordSeasonEvent(st8, "deep_site", now);
check("weekly deep-site objective +60", st8.battlePass.xp === 120);
for (let i = 0; i < 3; i++) m.recordSeasonEvent(st8, "codex_recovered", now, 3);
check("weekly codices objective +40 (9 ≥ 8)", st8.battlePass.xp === 160);
st8.battlePass.week = "2000-W1"; // roll the week
m.recordSeasonEvent(st8, "deep_site", now);
check("new week resets weekly counters", st8.battlePass.xp === 160 + 60 && st8.battlePass.weekCompleted.length === 1);

// ---- engine hooks fire the objectives ----
const st9 = engine.newGame("Mon9", "watchers", now);
gearUp(st9);
const l = engine.launchExpedition(st9, "outer-ruins", 2, now);
check("launchExpedition ok", l.ok === true, l.error || "");
check("launch hook fired", st9.battlePass.xp >= 10 && st9.battlePass.dayObjectives.includes("launch_expedition"));
const c = engine.craftItem(st9, "medkit", now);
check("craftItem ok", c.ok === true, c.error || "");
check("craft hook fired", st9.battlePass.dayObjectives.includes("craft_item"));
const sd = engine.beginStudy(st9, "ember", now);
check("beginStudy ok", sd.ok === true, sd.error || "");
check("study hook fired", st9.battlePass.dayObjectives.includes("study"));
const st9b = engine.newGame("Mon9b", "watchers", now);
st9b.codices = 20;
const br = engine.beginResearch(st9b, "w1", st9b.leaders[0].id, now + 500);
check("beginResearch ok", br.ok === true, br.error || "");
const dur = st9b.researchJobs[0].durationMs;
engine.advance(st9b, now + 500 + dur + 1);
check("research hook fired (+15)", st9b.battlePass.dayObjectives.includes("complete_research") && st9b.battlePass.xp >= 15);
const st9c = engine.newGame("Mon9c", "watchers", now);
runExpedition(st9c, "outer-ruins", 0, true, now, now + 61_000);
check("expedition resolve hooks fire", st9c.battlePass.weekCounts["expedition_complete"] === 1 && st9c.battlePass.weekCounts["deep_site"] === undefined);
runExpedition(st9c, "quantum-facility", 0, true, now, now + 122_000);
check("deep-site resolve counts rad≥60 zones", st9c.battlePass.weekCounts["deep_site"] === 1);
check("codex recovery counted", (st9c.battlePass.weekCounts["codex_recovered"] ?? 0) >= 2);

// ======================================================================
console.log("— 8 · deed cosmetics (§2.2) —");
check("7 deeds mapped", m.DEED_COSMETIC_MAP.length === 7);
check("wired deeds are the deterministic ones", m.DEED_COSMETIC_MAP.filter((d) => d.wired).map((d) => d.deedId).sort().join(",") === "deed_30day_devotion,deed_first_clean,deed_l5_specialized,deed_tier3_research");
check("unknown deed refused", m.awardDeedCosmetic(engine.newGame("X", "watchers", now), "deed_bogus").ok === false);
const stD1 = engine.newGame("MonD1", "nephilim", now);
runExpedition(stD1, "outer-ruins", 0, true, now, now + 61_000); // clean recovery
check("D1 granted by first clean recovery", m.owns(stD1, "first-light-sigil"));
runExpedition(stD1, "boneyard", 80, false, now, now + 122_000); // second run
check("D1 not double-granted", m.owns(stD1, "first-light-sigil") && stD1.entitlements.consumed.filter((c) => c.startsWith("deed_first_clean")).length === 1);
const stD4 = engine.newGame("MonD4", "anunnaki", now);
stD4.techsResearched = Array.from({ length: 12 }, (_, i) => "t" + i);
engine.advance(stD4, now);
check("D4 granted at research completions ≥ 12", m.owns(stD4, "the-visionarys-robes"));
const stD5 = engine.newGame("MonD5", "watchers", now);
const lead = stD5.leaders[0];
lead.xp = 1250; // L5
lead.specialization = "scholar";
engine.advance(stD5, now);
check("D5 granted when a Leader hits L5 + specialization", m.owns(stD5, "wardens-livery"));
const stD5b = engine.newGame("MonD5b", "watchers", now);
stD5b.leaders[0].xp = 800; // L4 only — no grant
engine.advance(stD5b, now);
check("D5 withheld below threshold", !m.owns(stD5b, "wardens-livery"));

// ======================================================================
console.log("— 9 · fairness guardrails (§5/§6, §3.2, §4.3) —");
check("assertCatalogFair passes on the whole catalog", (() => { m.assertCatalogFair(); return true; })());
check("no conversion path in module exports", (() => { m.assertNoConversionPath(); const bad = Object.keys(m).filter((k) => /convert|exchange|swap|fx/i.test(k)); return bad.length === 0; })());
check("cosmetics carry NO grant payload fields (schema guard)", m.COSMETICS.every((c) => Object.keys(c).every((k) => ["id", "name", "slot", "source", "blurb", "priceVotives", "deedId", "providerSkuId"].includes(k))));
check("no energy/stamina/skip-timer purchasable", !m.HEAD_START_PACKS.some((p) => /energy|stamina|skip|rush|timer|instant/i.test(p.name + p.blurb)) && !m.PURCHASABLE_COSMETICS.some((c) => /energy|stamina|skip|rush|timer/i.test(c.name)));
check("no XP/leader/oracle/repair/heal pack grants", m.HEAD_START_PACKS.every((p) => p.grants.every((g) => g.kind === "resource" || g.kind === "currency" || g.kind === "cosmetic" || g.kind === "vehicle")));
check("pack resources ⊆ craftable kinds", m.HEAD_START_PACKS.every((p) => p.grants.every((g) => g.kind !== "resource" || ["supplies", "gas", "medkit", "mechkit", "armorkit", "skmech", "battery", "hazmat", "shots", "alloys"].includes(g.key))));
check("no randomized purchases (no loot boxes)", m.MONETIZATION_CONFIG.allowRandomizedPurchases === false && !m.HEAD_START_PACKS.some((p) => /mystery|random|loot/i.test(p.name)) && !m.COSMETICS.some((c) => /mystery|random|loot/i.test(c.name)));
check("passes never expire", m.MONETIZATION_CONFIG.passesNeverExpire === true && !("expiresAt" in st0.entitlements.passes));
check("no paid stat subscription", !m.HEAD_START_PACKS.some((p) => /subscription|vip/i.test(p.name)) && !m.COSMETICS.some((c) => /subscription|vip/i.test(c.name)));
check("battle pass free capstone is deed-only", m.SEASON_TIERS[27].free.kind === "capstone_deed" && m.PURCHASABLE_COSMETICS.every((c) => c.id !== "s0-banner-shatterlands"));

// ======================================================================
console.log("— 10 · §8 config values (spec defaults) —");
const cfg = m.MONETIZATION_CONFIG;
check("currency names = Scrip/Votives", cfg.currencyNames.scrip === "Scrip" && cfg.currencyNames.votives === "Votives");
check("~100 Votives ≈ $1", cfg.votivesPerUsd === 100);
check("no conversion locked", cfg.allowScripVotiveConversion === false);
check("no randomized purchases locked", cfg.allowRandomizedPurchases === false);
check("passes never expire locked", cfg.passesNeverExpire === true);
check("Season 0 duration = 6 weeks", cfg.season0DurationMs === 6 * 7 * 24 * 60 * 60 * 1000);
check("Scrip-in-pack cap = 200", cfg.maxScripPerPack === 200);
check("storefront disabled in beta", cfg.storefrontEnabled === false);
check("deed display flag on", cfg.deedDisplayInShop === true);
check("season pacing 1000 XP/tier", cfg.seasonXpPerTier === 1000);
check("weekly targets present", cfg.weeklyExpeditionTarget === 10 && cfg.weeklyCodexTarget === 8 && cfg.weeklyDailyListTarget === 5);
check("D4 research threshold = 12", cfg.d4ResearchCompletions === 12);

// ======================================================================
console.log("— 11 · V5 migration + publicState discipline —");
const stM = engine.newGame("Mig", "grays", now) as GameState & { currency?: never; entitlements?: never; battlePass?: never };
const mig = stM as unknown as Record<string, unknown>;
delete mig.currency;
delete mig.entitlements;
delete mig.battlePass;
(mig as { version?: number }).version = 4; // legacy V4 save
engine.advance(stM, now + 1000);
check("legacy save gains currency", typeof stM.currency === "object" && stM.currency.scrip === 0 && stM.currency.votives === 0 && stM.currency.ledger.length === 0);
check("legacy save gains entitlements", typeof stM.entitlements === "object" && stM.entitlements.cosmetics.length === 0);
check("legacy save gains battle pass", typeof stM.battlePass === "object" && stM.battlePass.xp === 0 && stM.battlePass.seasonId === "s0_the_shattering");

const pub = publicState(engine.newGame("Pub", "watchers", now));
const pubStr = JSON.stringify(pub);
check("balances in public payload", pub.currency?.scrip === 0 && pub.currency?.votives === 0);
check("ledger entries never leave the server", !pubStr.includes('"ledger"'));
check("idempotency set never leaves the server", !pubStr.includes('"consumed"'));
check("pack-scrip counter never leaves the server", !pubStr.includes("scripFromPacks"));
check("owned lists + equips exposed", Array.isArray(pub.entitlements?.cosmetics) && typeof pub.entitlements?.equips === "object");
check("battle pass public view", pub.battlePass?.tier === 1 && pub.battlePass?.seasonId === "s0_the_shattering");
check("revelation secrecy still holds", !pubStr.includes("revelationCounters") && !pubStr.includes("acknowledgedOnce") && !pubStr.includes("cleanRecoveries"));

// walletView shape
const wv = m.walletView(engine.newGame("W", "watchers", now));
check("walletView shape", typeof wv.currency.scrip === "number" && Array.isArray(wv.entitlements.cosmetics) && typeof wv.battlePass.tier === "number");

// ======================================================================
console.log("— 12 · ledger survives advance (persistence seam) —");
const stA = engine.newGame("MonA", "grays", now);
m.grantCurrency(stA, "scrip", 55, "evt-A1", "award", now);
engine.advance(stA, now + 5000);
check("balance persists across advance", stA.currency.scrip === 55 && stA.currency.ledger.length === 1);
check("no double-grant after advance", stA.currency.scrip === 55);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);