// ======================================================================
// STORE OFFERS — DAILY SPECIALS + WAR BUNDLES + THE EXTRACTION DEAL
// (owner direction, Hans, 2026-10-12).
// ======================================================================
//
// WHAT LIVES HERE. The store's selling systems beyond the Wave-1 catalog in
// monetization.ts:
//
//   1. DAILY SPECIALS — three offers a day, the SAME three for every player
//      on the world, rotating at the UTC dawn. The rotation is a pure
//      function of the UTC day key (a seeded hash of the date string), so
//      no server state decides it and every client agrees. Drawn from
//      DAILY_SPECIAL_POOL: featured war bundles at a deeper cut, plus
//      goods specials. Each special may be claimed ONCE per player per day.
//
//   2. WAR BUNDLES — crates of war goods (the craftable supplies / fuel /
//      gear-kit kinds a head-start pack may carry — the SAME grant
//      vocabulary, PackGrant) sold for Votives as their own store category.
//      A bundle's price sits below the standalone sum of its contents
//      (RESOURCE_UNIT_VOTIVES is the price list the discount is measured
//      against). Bundles are REPEATABLE purchases — they are consumable
//      goods, not one-time packs, so they never touch entitlements.packs.
//
//   3. THE EXTRACTION DEAL — two standing store items for the fallen-hero
//      recovery system (design/fallen-hero-recovery.md):
//        · EXTRACTION CONTRACT (450 Votives) — a hired extraction crew on
//          call. Held as a count in state.storeOffers.extractionPasses.
//        · RECOVERY EXPEDITE (300 Votives) — contracted care that completes
//          a recovered leader's 24-hour recovery. Held as a count in
//          state.storeOffers.expediteCredits.
//
// DOCTRINE (owner, locked 2026-10-12): HEROES AND LEADERS ARE NEVER SOLD —
// "you can't buy legend." Heroes are earned via signature deeds or Oracle
// vouching. This catalog sells goods, bundles and contracts ONLY: the grant
// vocabulary (PackGrant) structurally cannot carry a person, and the
// war-reserve rule (battle-side §9/B4 — troops grow only from play) means no
// bundle grants troops either. The extraction contract sells a SERVICE — a
// crew for hire — never the fallen leader it flies to recover.
//
// WHERE RECOVERY CONSUMES THESE (the stub, stated exactly):
//   The fallen-hero recovery gameplay (the fall → 5-minute window → crew
//   launch → 24-hour recovery flow) is not built yet. When it lands, it
//   reads ownership through THIS module and nowhere else:
//     · At extraction launch, alongside the player's own garrison crew, the
//       contract option is offered iff extractionPassesHeld(state) > 0;
//       launching on the contract calls
//       consumeExtractionPass(state, eventId, now) — one pass per launch.
//     · While a recovered leader's 24-hour recovery timer runs, the
//       expedite action is offered iff recoveryExpeditesHeld(state) > 0;
//       applying it calls consumeRecoveryExpedite(state, eventId, now) and
//       completes the recovery.
//   Both consume functions are idempotent by eventId, so a retried recovery
//   action can never burn two passes.
//
// MONEY. Everything here is priced in VOTIVES the player already holds and
// flows through monetization.ts's ledger (spendCurrency / grantCurrency) —
// the same seam purchaseWithVotives uses. No real-money path exists in this
// module; if Hans later wants a bundle on the Xsolla shelf, it gets a USD
// row + an applyExternalPurchase branch then, not a second grant path now.
//
// FAIRNESS. assertStoreOffersFair() below runs the same guardrails as
// monetization.assertCatalogFair(): the shared forbidden-vocabulary
// tripwire (catalogForbiddenHit), craftable-resource grants only, bounded
// amounts, honest discounts (a "special" must actually be cheaper).
// ======================================================================

import type { GameState } from "./types";
import {
  ensureMonetization,
  grantCurrency,
  spendCurrency,
  grantEntitlement,
  utcDayKey,
  catalogForbiddenHit,
  COSMETIC_BY_ID,
  type PackGrant,
  type PackResourceKey,
} from "./monetization";

// ----------------------------------------------------------------------
// STATE
// ----------------------------------------------------------------------

export interface StoreOffersState {
  /** Extraction Contracts held (the extraction deal — see header). */
  extractionPasses: number;
  /** Recovery Expedites held. */
  expediteCredits: number;
  /** UTC day key -> daily-special ids claimed that day (once per day each). */
  dailyBuys: Record<string, string[]>;
}

export function freshStoreOffers(): StoreOffersState {
  return { extractionPasses: 0, expediteCredits: 0, dailyBuys: {} };
}

/** Idempotent migration: pre-offers saves get an empty offers block. */
export function ensureStoreOffers(state: GameState): StoreOffersState {
  if (!state.storeOffers || typeof state.storeOffers !== "object") {
    state.storeOffers = freshStoreOffers();
  }
  const s = state.storeOffers;
  if (typeof s.extractionPasses !== "number" || !(s.extractionPasses >= 0)) s.extractionPasses = 0;
  if (typeof s.expediteCredits !== "number" || !(s.expediteCredits >= 0)) s.expediteCredits = 0;
  if (!s.dailyBuys || typeof s.dailyBuys !== "object") s.dailyBuys = {};
  return s;
}

/** Colony Chronicle append (mirrors monetization's private log helper). */
function logLine(state: GameState, msg: string) {
  if (!Array.isArray(state.log)) state.log = [];
  state.log.unshift(msg);
  state.log = state.log.slice(0, 60);
}

// ----------------------------------------------------------------------
// STANDALONE PRICES — what one unit of each craftable good costs alone.
// Bundle/special discounts are measured against these, never invented.
// ----------------------------------------------------------------------

export const RESOURCE_UNIT_VOTIVES: Record<PackResourceKey, number> = {
  supplies: 2,
  gas: 3,
  battery: 3,
  medkit: 25,
  mechkit: 25,
  armorkit: 30,
  skmech: 40,
  hazmat: 30,
  shots: 20,
  alloys: 15,
};

/** The buy-separately total of a grant list, in Votives. Currency grants
 *  count at face value; cosmetic grants at their catalog price. */
export function grantsSeparateVotives(grants: PackGrant[]): number {
  let total = 0;
  for (const g of grants) {
    if (g.kind === "resource") total += RESOURCE_UNIT_VOTIVES[g.key] * g.amount;
    else if (g.kind === "currency") total += g.amount;
    else if (g.kind === "cosmetic") total += COSMETIC_BY_ID[g.itemId]?.priceVotives ?? 0;
    // vehicles carry no standalone Votive price — they are not sold by unit.
  }
  return total;
}

// ----------------------------------------------------------------------
// WAR BUNDLES — three tiers of war goods at a bundle price.
// ----------------------------------------------------------------------

export interface WarBundleDef {
  id: string;
  tier: "skirmish" | "raid" | "war";
  name: string;
  blurb: string;
  /** a plain comparison to play, in the packs' style */
  playEquivalent: string;
  grants: PackGrant[];
  /** the shelf price (Votives) — below the contents' standalone sum */
  priceVotives: number;
  /** the deeper price when this bundle is a featured daily special */
  specialPriceVotives: number;
}

export const WAR_BUNDLES: WarBundleDef[] = [
  {
    id: "skirmish-crate",
    tier: "skirmish",
    name: "Skirmish Crate",
    blurb: "A light war crate: stores, fuel and field kits for a colony that expects trouble before the week is out.",
    playEquivalent: "≈ a few days of steady explorations",
    priceVotives: 295,
    specialPriceVotives: 235,
    grants: [
      { kind: "resource", key: "supplies", amount: 120, note: "war stores" },
      { kind: "resource", key: "gas", amount: 24, note: "fuel for the column" },
      { kind: "resource", key: "medkit", amount: 2, note: "field medicine kits" },
      { kind: "resource", key: "armorkit", amount: 1, note: "armor kit" },
    ],
  },
  {
    id: "raid-crate",
    tier: "raid",
    name: "Raid Crate",
    blurb: "A full expedition load: deep fuel, battery packs, machine and armor kits, and support shots for the column going out.",
    playEquivalent: "≈ a week of deliberate expeditions",
    priceVotives: 775,
    specialPriceVotives: 620,
    grants: [
      { kind: "resource", key: "supplies", amount: 300, note: "war stores" },
      { kind: "resource", key: "gas", amount: 60, note: "fuel for the column" },
      { kind: "resource", key: "battery", amount: 20, note: "battery packs — quiet running" },
      { kind: "resource", key: "mechkit", amount: 2, note: "mechanics kits" },
      { kind: "resource", key: "armorkit", amount: 2, note: "armor kits" },
      { kind: "resource", key: "shots", amount: 4, note: "radiation support shots" },
    ],
  },
  {
    id: "war-crate",
    tier: "war",
    name: "War Crate",
    blurb: "The heavy crate: everything a colony stages before a campaign — stores, fuel, deep kits, hazmat sets and forged alloys.",
    playEquivalent: "≈ two weeks of a driven colony's gathering",
    priceVotives: 1570,
    specialPriceVotives: 1255,
    grants: [
      { kind: "resource", key: "supplies", amount: 500, note: "war stores" },
      { kind: "resource", key: "gas", amount: 120, note: "fuel for the column" },
      { kind: "resource", key: "battery", amount: 40, note: "battery packs — quiet running" },
      { kind: "resource", key: "skmech", amount: 3, note: "skilled mechanics sets" },
      { kind: "resource", key: "hazmat", amount: 4, note: "hazmat suits" },
      { kind: "resource", key: "alloys", amount: 10, note: "forged alloys" },
      { kind: "resource", key: "armorkit", amount: 4, note: "armor kits" },
      { kind: "resource", key: "mechkit", amount: 4, note: "mechanics kits" },
    ],
  },
];

export const WAR_BUNDLE_BY_ID = Object.fromEntries(WAR_BUNDLES.map((b) => [b.id, b])) as Record<string, WarBundleDef>;

/** A bundle's buy-separately total (Votives) — the discount's denominator. */
export function bundleSeparateVotives(bundle: WarBundleDef): number {
  return grantsSeparateVotives(bundle.grants);
}

// ----------------------------------------------------------------------
// THE EXTRACTION DEAL — standing items (never in the daily rotation).
// ----------------------------------------------------------------------

export interface StoreServiceItemDef {
  id: string;
  name: string;
  blurb: string;
  priceVotives: number;
}

/** A hired extraction crew, on call (design/fallen-hero-recovery.md). */
export const EXTRACTION_CONTRACT: StoreServiceItemDef = {
  id: "extraction-contract",
  name: "Extraction Contract",
  blurb:
    "A hired extraction crew, held on call at the Cradle. When a leader falls in the field, spend this contract to send the crew in during the window — no garrison crew of your own needs to be standing ready.",
  priceVotives: 450,
};

/** Contracted care that completes a recovered leader's 24-hour recovery. */
export const RECOVERY_EXPEDITE: StoreServiceItemDef = {
  id: "recovery-expedite",
  name: "Recovery Expedite",
  blurb:
    "Contracted care for a leader in recovery. Spend it on a leader brought home by an extraction and their 24-hour recovery is completed under the surgeons' care.",
  priceVotives: 300,
};

// ----------------------------------------------------------------------
// DAILY SPECIALS — the pool + the deterministic daily rotation.
// ----------------------------------------------------------------------

export type DailySpecialDef =
  | { id: string; kind: "bundle-feature"; bundleId: string }
  | { id: string; kind: "goods"; name: string; blurb: string; grants: PackGrant[]; priceVotives: number };

/** The pool the daily three are drawn from. Featured bundles ride the
 *  bundle's special price; goods specials carry their own grant lists. */
export const DAILY_SPECIAL_POOL: DailySpecialDef[] = [
  { id: "feat-skirmish-crate", kind: "bundle-feature", bundleId: "skirmish-crate" },
  { id: "feat-raid-crate", kind: "bundle-feature", bundleId: "raid-crate" },
  { id: "feat-war-crate", kind: "bundle-feature", bundleId: "war-crate" },
  {
    id: "fuel-reserve",
    kind: "goods",
    name: "Fuel Reserve",
    blurb: "A topped-off fuel reserve for the colony's vehicles, priced for today only.",
    priceVotives: 120,
    grants: [{ kind: "resource", key: "gas", amount: 60, note: "fuel reserve" }],
  },
  {
    id: "field-medicine",
    kind: "goods",
    name: "Field Medicine",
    blurb: "Medicine kits and support shots, bundled for the day's special.",
    priceVotives: 105,
    grants: [
      { kind: "resource", key: "medkit", amount: 3, note: "field medicine kits" },
      { kind: "resource", key: "shots", amount: 4, note: "radiation support shots" },
    ],
  },
  {
    id: "armor-works",
    kind: "goods",
    name: "Armor Works",
    blurb: "Armor kits with the alloys to fit them, at the day's price.",
    priceVotives: 125,
    grants: [
      { kind: "resource", key: "armorkit", amount: 3, note: "armor kits" },
      { kind: "resource", key: "alloys", amount: 6, note: "forged alloys" },
    ],
  },
  {
    id: "deep-kit",
    kind: "goods",
    name: "Deep Kit",
    blurb: "Hazmat suits and battery packs for the deep zones, bundled for today.",
    priceVotives: 100,
    grants: [
      { kind: "resource", key: "hazmat", amount: 3, note: "hazmat suits" },
      { kind: "resource", key: "battery", amount: 20, note: "battery packs — quiet running" },
    ],
  },
  {
    id: "supply-surge",
    kind: "goods",
    name: "Supply Surge",
    blurb: "A deep stack of colony stores at the day's price.",
    priceVotives: 560,
    grants: [{ kind: "resource", key: "supplies", amount: 400, note: "colony stores" }],
  },
  {
    id: "machine-shop",
    kind: "goods",
    name: "Machine Shop",
    blurb: "Mechanics kits and skilled sets from the machine shop, bundled for today.",
    priceVotives: 110,
    grants: [
      { kind: "resource", key: "mechkit", amount: 3, note: "mechanics kits" },
      { kind: "resource", key: "skmech", amount: 2, note: "skilled mechanics sets" },
    ],
  },
];

export const DAILY_SPECIALS_PER_DAY = 3;

/** One day's special, resolved to everything a card or a purchase needs.
 *  For a bundle-feature, `noteKeyBase` points at the bundle's own i18n grant
 *  notes (the contents are the bundle's); for goods it is the special's. */
export interface DailySpecialOffer {
  specialId: string;
  kind: "bundle-feature" | "goods";
  bundleId?: string;
  name: string;
  blurb: string;
  grants: PackGrant[];
  priceVotives: number;
  separateVotives: number;
  noteKeyBase: string;
  dayKey: string;
}

/** FNV-1a — a small stable string hash (the rotation's seed source). */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — a tiny deterministic PRNG; same seed, same stream, anywhere. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveSpecial(def: DailySpecialDef, dayKey: string): DailySpecialOffer {
  if (def.kind === "bundle-feature") {
    const bundle = WAR_BUNDLE_BY_ID[def.bundleId];
    return {
      specialId: def.id,
      kind: def.kind,
      bundleId: def.bundleId,
      name: bundle.name,
      blurb: bundle.blurb,
      grants: bundle.grants,
      priceVotives: bundle.specialPriceVotives,
      separateVotives: bundleSeparateVotives(bundle),
      noteKeyBase: `store.bundle.${bundle.id}`,
      dayKey,
    };
  }
  return {
    specialId: def.id,
    kind: def.kind,
    name: def.name,
    blurb: def.blurb,
    grants: def.grants,
    priceVotives: def.priceVotives,
    separateVotives: grantsSeparateVotives(def.grants),
    noteKeyBase: `store.special.${def.id}`,
    dayKey,
  };
}

/**
 * THE ROTATION. Pure in the UTC day key: hash the date, shuffle the pool
 * with the seeded stream, take the first DAILY_SPECIALS_PER_DAY. Every
 * player on every client computes the same three for the same day; the
 * server resolves purchases against its own clock, never the client's.
 */
export function dailySpecialsForDay(dayKey: string): DailySpecialOffer[] {
  const rand = seededRandom(hashString(`unbound-daily-specials:${dayKey}`));
  const order = DAILY_SPECIAL_POOL.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order
    .slice(0, DAILY_SPECIALS_PER_DAY)
    .map((i) => resolveSpecial(DAILY_SPECIAL_POOL[i], dayKey));
}

/** Today's specials + the ms until the rotation turns (next UTC midnight). */
export function dailySpecials(now = Date.now()): { dayKey: string; offers: DailySpecialOffer[]; msLeft: number } {
  const dayKey = utcDayKey(now);
  return { dayKey, offers: dailySpecialsForDay(dayKey), msLeft: msUntilNextUtcDay(now) };
}

/** Milliseconds from `now` to the next UTC midnight (the rotation moment). */
export function msUntilNextUtcDay(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(0, next - now);
}

// ----------------------------------------------------------------------
// GRANT PLUMBING — the same primitives applyPack uses, so an offer's
// contents land exactly the way a head-start pack's contents land.
// ----------------------------------------------------------------------

function applyOfferGrants(
  state: GameState,
  grants: PackGrant[],
  eventId: string,
  label: string,
  now: number,
): { ok: boolean; error?: string } {
  for (const g of grants) {
    if (g.kind === "resource") {
      (state.resources as unknown as Record<string, number>)[g.key] += g.amount;
    } else if (g.kind === "currency") {
      const r = grantCurrency(state, g.currency, g.amount, `${eventId}:currency:${g.currency}`, `${label} — ${g.note}`, now, "grant");
      if (!r.ok) return { ok: false, error: r.error };
    } else if (g.kind === "cosmetic") {
      const r = grantEntitlement(state, g.itemId, "pack", `${eventId}:cosmetic:${g.itemId}`, now);
      if (!r.ok) return { ok: false, error: r.error };
    } else if (g.kind === "vehicle") {
      if (!state.entitlements.vehicles.includes(g.vehicleId)) state.entitlements.vehicles.push(g.vehicleId);
      if (!state.entitlements.consumed.includes(`${eventId}:vehicle:${g.vehicleId}`)) {
        state.entitlements.consumed.push(`${eventId}:vehicle:${g.vehicleId}`);
      }
    }
  }
  return { ok: true };
}

export interface StorePurchaseResult {
  ok: boolean;
  error?: string;
  idempotent?: boolean;
  state: GameState;
}

/**
 * Shared purchase spine: idempotency mark FIRST (the entitlements consumed
 * set is the store's processed-event registry), then spend, then the effect.
 * A failed spend unmarks nothing (the mark is only written after the spend
 * lands); a failed effect refunds the spend, mirroring purchaseWithVotives.
 */
function buyWithVotives(
  state: GameState,
  priceVotives: number,
  eventId: string,
  reason: string,
  now: number,
  effect: () => { ok: boolean; error?: string },
): StorePurchaseResult {
  ensureMonetization(state);
  ensureStoreOffers(state);
  if (!eventId) return { ok: false, error: "A purchase requires an eventId (idempotency).", state };
  const mark = `store-buy:${eventId}`;
  if (state.entitlements.consumed.includes(mark)) return { ok: true, idempotent: true, state };
  const spend = spendCurrency(state, "votives", priceVotives, `${mark}:spend`, reason, now);
  if (!spend.ok) return { ok: false, error: spend.error, state };
  const r = effect();
  if (!r.ok) {
    grantCurrency(state, "votives", priceVotives, `${mark}:rollback`, "defensive rollback", now, "grant");
    return { ok: false, error: r.error, state };
  }
  state.entitlements.consumed.push(mark);
  return { ok: true, state };
}

/** Buy a war bundle at its shelf price. Repeatable — goods, not a pack. */
export function purchaseWarBundle(
  state: GameState,
  bundleId: string,
  eventId: string,
  now = Date.now(),
): StorePurchaseResult {
  const bundle = WAR_BUNDLE_BY_ID[bundleId];
  if (!bundle) return { ok: false, error: `Unknown war bundle: ${bundleId}`, state };
  return buyWithVotives(state, bundle.priceVotives, eventId, `War bundle — ${bundle.name}`, now, () => {
    const r = applyOfferGrants(state, bundle.grants, `store-buy:${eventId}`, bundle.name, now);
    if (r.ok) logLine(state, `📦 ${bundle.name} opened — its goods are in your stores.`);
    return r;
  });
}

/** Claim one of today's daily specials. Once per player per special per
 *  day; the rotation is resolved against the SERVER's clock (`now` here),
 *  so a client can never buy yesterday's price or tomorrow's early. */
export function purchaseDailySpecial(
  state: GameState,
  specialId: string,
  eventId: string,
  now = Date.now(),
): StorePurchaseResult {
  const offersState = ensureStoreOffers(state);
  const { dayKey, offers } = dailySpecials(now);
  const offer = offers.find((o) => o.specialId === specialId);
  if (!offer) {
    return { ok: false, error: "That special isn't on today's board — the board turns at the dawn.", state };
  }
  const claimed = offersState.dailyBuys[dayKey] ?? [];
  // A retry of the SAME purchase event stays idempotent even though the
  // day-record would otherwise read as "already claimed".
  const mark = `store-buy:${eventId}`;
  if (!state.entitlements.consumed.includes(mark) && claimed.includes(specialId)) {
    return { ok: false, error: "You've claimed that special today — it returns on a later board.", state };
  }
  return buyWithVotives(state, offer.priceVotives, eventId, `Daily special — ${offer.name}`, now, () => {
    const r = applyOfferGrants(state, offer.grants, `store-buy:${eventId}`, offer.name, now);
    if (!r.ok) return r;
    const s = ensureStoreOffers(state);
    (s.dailyBuys[dayKey] ??= []).push(specialId);
    logLine(state, `🌅 Daily special claimed — ${offer.name}.`);
    return { ok: true };
  });
}

/** Buy an Extraction Contract (held in state.storeOffers.extractionPasses). */
export function purchaseExtractionPass(
  state: GameState,
  eventId: string,
  now = Date.now(),
): StorePurchaseResult {
  return buyWithVotives(state, EXTRACTION_CONTRACT.priceVotives, eventId, EXTRACTION_CONTRACT.name, now, () => {
    ensureStoreOffers(state).extractionPasses += 1;
    logLine(state, `🛟 ${EXTRACTION_CONTRACT.name} signed — a hired extraction crew stands on call.`);
    return { ok: true };
  });
}

/** Buy a Recovery Expedite (held in state.storeOffers.expediteCredits). */
export function purchaseRecoveryExpedite(
  state: GameState,
  eventId: string,
  now = Date.now(),
): StorePurchaseResult {
  return buyWithVotives(state, RECOVERY_EXPEDITE.priceVotives, eventId, RECOVERY_EXPEDITE.name, now, () => {
    ensureStoreOffers(state).expediteCredits += 1;
    logLine(state, `✚ ${RECOVERY_EXPEDITE.name} held — contracted care, ready when a leader comes home.`);
    return { ok: true };
  });
}

// ----------------------------------------------------------------------
// RECOVERY READ POINTS — where the fallen-hero recovery system (not yet
// built) checks ownership and spends what the store sold. See the header.
// ----------------------------------------------------------------------

/** Extraction Contracts the player holds right now. */
export function extractionPassesHeld(state: GameState): number {
  return ensureStoreOffers(state).extractionPasses;
}

/** Recovery Expedites the player holds right now. */
export function recoveryExpeditesHeld(state: GameState): number {
  return ensureStoreOffers(state).expediteCredits;
}

/**
 * RECOVERY HOOK — extraction launch. The recovery flow calls this when a
 * player launches an extraction on the store's contract (instead of their
 * own garrison crew) inside the 5-minute window. Burns exactly one pass;
 * idempotent by eventId so a retried launch can't burn two.
 */
export function consumeExtractionPass(
  state: GameState,
  eventId: string,
  now = Date.now(),
): StorePurchaseResult {
  void now;
  ensureMonetization(state);
  const s = ensureStoreOffers(state);
  if (!eventId) return { ok: false, error: "A consume requires an eventId (idempotency).", state };
  const mark = `store-use:extraction:${eventId}`;
  if (state.entitlements.consumed.includes(mark)) return { ok: true, idempotent: true, state };
  if (s.extractionPasses <= 0) {
    return { ok: false, error: "No Extraction Contract held — the store sells them, or send your own garrison crew.", state };
  }
  s.extractionPasses -= 1;
  state.entitlements.consumed.push(mark);
  logLine(state, `🛟 Extraction Contract spent — the hired crew is away to the field.`);
  return { ok: true, state };
}

/**
 * RECOVERY HOOK — recovery completion. The recovery flow calls this when a
 * player spends an expedite on a leader in the 24-hour recovery; the timer
 * completes. Burns exactly one credit; idempotent by eventId.
 */
export function consumeRecoveryExpedite(
  state: GameState,
  eventId: string,
  now = Date.now(),
): StorePurchaseResult {
  void now;
  ensureMonetization(state);
  const s = ensureStoreOffers(state);
  if (!eventId) return { ok: false, error: "A consume requires an eventId (idempotency).", state };
  const mark = `store-use:expedite:${eventId}`;
  if (state.entitlements.consumed.includes(mark)) return { ok: true, idempotent: true, state };
  if (s.expediteCredits <= 0) {
    return { ok: false, error: "No Recovery Expedite held — the store sells them.", state };
  }
  s.expediteCredits -= 1;
  state.entitlements.consumed.push(mark);
  logLine(state, `✚ Recovery Expedite spent — the surgeons take over the recovery.`);
  return { ok: true, state };
}

// ----------------------------------------------------------------------
// FAIRNESS GUARDRAILS for this catalog (mirrors assertCatalogFair).
// ----------------------------------------------------------------------

const ALLOWED_GRANT_RESOURCES: PackResourceKey[] = [
  "supplies", "gas", "medkit", "mechkit", "armorkit", "skmech", "battery", "hazmat", "shots", "alloys",
];
const MAX_GRANT_PER_LINE = 600;

function assertGrantsFair(owner: string, grants: PackGrant[]): void {
  for (const g of grants) {
    if (g.kind === "resource") {
      if (!ALLOWED_GRANT_RESOURCES.includes(g.key)) {
        throw new Error(`${owner} grants resource "${g.key}" — not a craftable kind (packs §3.2.6).`);
      }
      if (g.amount <= 0 || g.amount > MAX_GRANT_PER_LINE) {
        throw new Error(`${owner} grant amount ${g.amount} out of budget (1–${MAX_GRANT_PER_LINE}).`);
      }
    } else if (g.kind === "currency") {
      if (g.currency !== "votives") throw new Error(`${owner} may only carry Votives as currency.`);
    } else if (g.kind === "cosmetic") {
      const c = COSMETIC_BY_ID[g.itemId];
      if (!c || c.source !== "purchasable") {
        throw new Error(`${owner} cosmetic grant ${g.itemId} must be a purchasable cosmetic.`);
      }
    } else if (g.kind !== "vehicle") {
      throw new Error(`${owner} has an unknown grant kind "${(g as { kind: string }).kind}".`);
    }
    const hit = catalogForbiddenHit(g.note);
    if (hit) throw new Error(`${owner} grant note touches forbidden power vocabulary ("${hit}").`);
  }
}

function assertCopyFair(owner: string, text: string): void {
  const hit = catalogForbiddenHit(text);
  if (hit) throw new Error(`${owner} touches forbidden power vocabulary ("${hit}").`);
}

/** Validates the store-offers catalog against the fairness rules and throws
 *  with a precise message on the first violation. Tests call this. */
export function assertStoreOffersFair(): void {
  // War bundles: honest discount, bounded contents, clean copy.
  for (const b of WAR_BUNDLES) {
    assertCopyFair(`War bundle ${b.id}`, `${b.name} ${b.blurb} ${b.playEquivalent}`);
    assertGrantsFair(`War bundle ${b.id}`, b.grants);
    const separate = bundleSeparateVotives(b);
    if (!(b.priceVotives > 0) || b.priceVotives >= separate) {
      throw new Error(`War bundle ${b.id} price ${b.priceVotives} must be positive and below its standalone sum ${separate}.`);
    }
    if (!(b.specialPriceVotives > 0) || b.specialPriceVotives >= b.priceVotives) {
      throw new Error(`War bundle ${b.id} special price ${b.specialPriceVotives} must undercut its shelf price ${b.priceVotives}.`);
    }
    // A discount deeper than half off the standalone sum is not a bundle
    // price, it's a misprint — refuse it like the fairness layer refuses
    // out-of-budget grants.
    if (b.specialPriceVotives < separate * 0.5) {
      throw new Error(`War bundle ${b.id} special price ${b.specialPriceVotives} is deeper than half its standalone sum ${separate}.`);
    }
  }
  // Daily pool: bundle features must name real bundles; goods specials must
  // be real discounts with bounded contents and clean copy.
  const seen = new Set<string>();
  for (const def of DAILY_SPECIAL_POOL) {
    if (seen.has(def.id)) throw new Error(`Daily special id "${def.id}" is in the pool twice.`);
    seen.add(def.id);
    if (def.kind === "bundle-feature") {
      if (!WAR_BUNDLE_BY_ID[def.bundleId]) {
        throw new Error(`Daily special ${def.id} features unknown bundle "${def.bundleId}".`);
      }
    } else {
      assertCopyFair(`Daily special ${def.id}`, `${def.name} ${def.blurb}`);
      assertGrantsFair(`Daily special ${def.id}`, def.grants);
      const separate = grantsSeparateVotives(def.grants);
      if (!(def.priceVotives > 0) || def.priceVotives >= separate) {
        throw new Error(`Daily special ${def.id} price ${def.priceVotives} must be positive and below its standalone sum ${separate}.`);
      }
    }
  }
  if (DAILY_SPECIAL_POOL.length < DAILY_SPECIALS_PER_DAY) {
    throw new Error("The daily pool must hold at least as many specials as a day shows.");
  }
  // The extraction deal: a service contract and a care contract. Neither
  // grants a person, a stat or a good — they are held counts, nothing more.
  for (const item of [EXTRACTION_CONTRACT, RECOVERY_EXPEDITE]) {
    assertCopyFair(`Store item ${item.id}`, `${item.name} ${item.blurb}`);
    if (!(item.priceVotives > 0)) throw new Error(`Store item ${item.id} must carry a real price.`);
  }
}
