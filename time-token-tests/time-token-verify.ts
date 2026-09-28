// TIME TOKENS — the EARNED path AND the SELL half (owner ruling 2026-09-27).
// Runner:  cd /home/team/shared/time-token-tests && env -u DATABASE_URL bun run ./time-token-verify.ts
//
// Covers, in the order the brief set them:
//   A · the type      — TWO earned sizes (1m/5m) and SIX sellable sizes
//                       (30m/1h/8h/12h/24h/48h) with their exact durations.
//   A2· the catalogue — one row per sellable size at the owner's price, a product
//                       id that is UNSET today, no row for an earned size, prices
//                       monotonic in value per hour, and NO grant payload. Every
//                       one of those is a NEGATIVE CONTROL: a tampered catalogue
//                       must throw.
//   B · the floor     — TIME_TOKEN_FLOOR_FRACTION === engine.MIN_TIMER_FRACTION
//                       (0.286), and every held-token pile is bounded by it.
//   C · the ladder    — an EXPLORATION run is REFUSED by name, in a keyed refusal,
//                       for every size; armory build / research / domain deploy are
//                       allowed.
//   D · power invariance — PER SIZE: a token compresses exactly one running timer
//                       and changes NOTHING else — no resource, no strength, no
//                       scored currency, no season tier.
//   E · the sell half — the six sizes exist and are offered, `1m`/`5m` are REFUSED
//                       for sale by name, every sale is refused while the product id
//                       is unset, the war-hardware tripwire still refuses, the
//                       speed-up words are no longer banned, the storefront is still
//                       OFF — and the earned grant door still refuses a sold size.
//   F · idempotency   — a repeated apply request id does not double-compress; a
//                       repeated Devotion claim does not re-grant.
//   G · the Devotion  — EVERY reward claim pays one 1m + one 5m; a cleared day pays
//                       5 + 5 (30 minutes of token time); the grant is surfaced.
//   H · migration     — an old save gets the earned sizes at zero, once; a save that
//                       holds a SOLD size keeps it.
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import {
  applyTimeToken,
  ensureTimeTokens,
  grantSoldTimeToken,
  grantTimeToken,
  heldTimeTokens,
  heldTimeTokenMs,
  isEarnedTimeTokenSize,
  isSellableTimeTokenSize,
  isTimeTokenSize,
  maxTimeTokenCompressionMs,
  timeTokenMs,
  timeTokensPublicView,
  TIME_TOKEN_FLOOR_FRACTION,
  TIME_TOKEN_SIZES,
  TIME_TOKEN_TIMER_KINDS,
  EARNED_TIME_TOKEN_SIZES,
  SELLABLE_TIME_TOKEN_SIZES,
} from "/home/team/shared/site/src/game/time-tokens.ts";
import { DAILY_CONFIG, claimDaily, freshDaily, reconcileDaily } from "/home/team/shared/site/src/game/daily.ts";
import {
  HEAD_START_PACKS,
  MONETIZATION_CONFIG,
  TIME_TOKEN_PACKS,
  TIME_TOKEN_PRODUCT_ID_UNSET,
  assertCatalogFair,
  ensureMonetization,
  sellableTimeTokenSizes,
  timeTokenPack,
  timeTokenPackId,
  timeTokenPriceUsd,
  timeTokenSaleRefusal,
  utcDayKey,
  type TimeTokenPackDef,
} from "/home/team/shared/site/src/game/monetization.ts";
import {
  PAYMENT_LINKS,
  checkoutUrl,
  isSellable,
  paymentLinkRow,
  productIdForSku,
  sellableSkus,
  skuForMetadataSku,
  skuForPriceId,
  skuForProductId,
} from "/home/team/shared/site/src/game/payments/payment-links.ts";
import type { GameState } from "/home/team/shared/site/src/game/types.ts";
import fs from "node:fs";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  \u2705 ${name}`); }
  else { fail++; console.log(`  \u274c ${name} ${extra}`); }
}
function section(t: string) { console.log(`\n== ${t}`); }
/** A negative control: the guardrail MUST refuse this tampered catalogue, and the
 *  catalogue must be put back exactly as it was afterwards. */
function refuses(name: string, tamper: () => void, untamper: () => void) {
  let threw = false;
  tamper();
  try { assertCatalogFair(); } catch { threw = true; }
  untamper();
  let restored = true;
  try { assertCatalogFair(); } catch { restored = false; }
  check(name, threw && restored, threw ? "the tampered catalogue was ACCEPTED" : "");
}

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A minimal colony shaped exactly like the fields these paths read. */
function mk(extra: Record<string, unknown> = {}): GameState {
  const st = {
    race: "watchers",
    daily: freshDaily(NOW),
    devotion: 0,
    devotionStreak: 0,
    resources: { embers: 0, chipsets: 0, supplies: 900, gas: 99, plasma: 99, medkit: 5, mechkit: 5, armorkit: 5 },
    armory: {},
    armoryBuilds: {},
    researchJobs: [],
    programDeploy: null,
    currency: undefined,
    ...extra,
  } as unknown as GameState;
  ensureMonetization(st);
  ensureTimeTokens(st);
  return st;
}
/** Fields a token is allowed to touch, and nothing else. */
function stripTokenFields(o: unknown): string {
  return JSON.stringify(o, (k, v) =>
    k === "timeTokens" || k === "timeTokenLedger" || k === "timeTokenMs" ? undefined : v);
}

// =========================================================== §A the type
section("A \u00b7 THE TYPE \u2014 TWO EARNED + SIX SELLABLE sizes, one duration each");
const ids = Object.keys(TIME_TOKEN_SIZES).sort();
check("exactly eight sizes are defined (2 earned + 6 sellable)",
  ids.join(",") === "12h,1h,1m,24h,30m,48h,5m,8h", ids.join(","));
check("1m is 60,000 ms", TIME_TOKEN_SIZES["1m"].ms === 60_000, String(TIME_TOKEN_SIZES["1m"]?.ms));
check("5m is 300,000 ms", TIME_TOKEN_SIZES["5m"].ms === 300_000, String(TIME_TOKEN_SIZES["5m"]?.ms));
check("EARNED_TIME_TOKEN_SIZES is exactly [1m, 5m] \u2014 the Devotion's two, unchanged",
  EARNED_TIME_TOKEN_SIZES.join(",") === "1m,5m");
check("SELLABLE_TIME_TOKEN_SIZES is exactly the owner's six, smallest first",
  SELLABLE_TIME_TOKEN_SIZES.join(",") === "30m,1h,8h,12h,24h,48h");
check("30m is 1,800,000 ms (the owner's duration)", TIME_TOKEN_SIZES["30m"].ms === 1_800_000, String(TIME_TOKEN_SIZES["30m"]?.ms));
check("1h is 3,600,000 ms", TIME_TOKEN_SIZES["1h"].ms === 3_600_000, String(TIME_TOKEN_SIZES["1h"]?.ms));
check("8h is 28,800,000 ms", TIME_TOKEN_SIZES["8h"].ms === 28_800_000, String(TIME_TOKEN_SIZES["8h"]?.ms));
check("12h is 43,200,000 ms", TIME_TOKEN_SIZES["12h"].ms === 43_200_000, String(TIME_TOKEN_SIZES["12h"]?.ms));
check("24h is 86,400,000 ms", TIME_TOKEN_SIZES["24h"].ms === 86_400_000, String(TIME_TOKEN_SIZES["24h"]?.ms));
check("48h is 172,800,000 ms", TIME_TOKEN_SIZES["48h"].ms === 172_800_000, String(TIME_TOKEN_SIZES["48h"]?.ms));
check("every defined size is EARNED or SELLABLE, and the two lists do not overlap",
  ids.every((id) => (isEarnedTimeTokenSize(id) ? 1 : 0) + (isSellableTimeTokenSize(id) ? 1 : 0) === 1));
check("`isEarnedTimeTokenSize` means exactly what it meant before the sell half: 1m and 5m, nothing else",
  isEarnedTimeTokenSize("1m") && isEarnedTimeTokenSize("5m") && EARNED_TIME_TOKEN_SIZES.length === 2
  && SELLABLE_TIME_TOKEN_SIZES.every((s) => !isEarnedTimeTokenSize(s)));
check("`isSellableTimeTokenSize` is true for the six and FALSE for 1m, 5m and junk",
  SELLABLE_TIME_TOKEN_SIZES.every((s) => isSellableTimeTokenSize(s))
  && !isSellableTimeTokenSize("1m") && !isSellableTimeTokenSize("5m") && !isSellableTimeTokenSize("2h"));
check("`isTimeTokenSize` is true for every defined size and false for junk",
  ids.every((id) => isTimeTokenSize(id)) && !isTimeTokenSize("3h") && !isTimeTokenSize(""));
const tokenSrc = fs.readFileSync("/home/team/shared/site/src/game/time-tokens.ts", "utf8");
const tokenCode = tokenSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
check("the module's CODE defines no price, product, checkout or purchase object",
  !/priceCents|priceVotives|priceUsd|productId|providerSkuId|checkout|stripe|storefrontEnabled|storefront/i.test(tokenCode));
const exportedFns = [...tokenSrc.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]).sort();
check("the module's export surface is exactly the MECHANIC \u2014 a whitelist, so no buy/sell/checkout "
  + "function can ever appear here without this check failing. TWO grant doors are named, and they are "
  + "the two the slice has: `grantTimeToken` (the Devotion's) and `grantSoldTimeToken` (the purchase "
  + "path's, added 2026-09-27) \u2014 WIDENED, not weakened: the control below still refuses a planted name",
  exportedFns.join(",") === "applyTimeToken,ensureTimeTokens,freshTimeTokens,grantSoldTimeToken,grantTimeToken,"
  + "heldTimeTokenMs,heldTimeTokens,isEarnedTimeTokenSize,isSellableTimeTokenSize,isTimeTokenSize,maxTimeTokenCompressionMs,"
  + "timeTokenMs,timeTokensPublicView",
  exportedFns.join(","));
const BANNED_EXPORT_NAME = /price|product|sku|checkout|stripe|storefront|purchase|charg|invoice|entitle/i;
check("no exported name at all mentions a price, a product, a checkout, a store or an entitlement",
  ![...tokenSrc.matchAll(/export (?:async )?(?:function|const|let|class|interface|type) (\w+)/g)]
    .map((m) => m[1])
    .some((n) => BANNED_EXPORT_NAME.test(n)));
// NEGATIVE CONTROL for the widened whitelist above: the new door's NAME must be
// clear of the store's vocabulary, and this proves the ban still bites on a name
// that is not (`grantSoldTimeToken` passes; the obvious alternative would not).
check("NEGATIVE CONTROL \u00b7 the name ban still refuses a planted store-flavoured export name",
  !BANNED_EXPORT_NAME.test("grantSoldTimeToken") && BANNED_EXPORT_NAME.test("grantPurchasedTimeToken")
  && BANNED_EXPORT_NAME.test("timeTokenPriceUsd") && BANNED_EXPORT_NAME.test("stripeCheckoutToken"));
check("the ruling this slice implements is quoted in the source",
  /speed-ups are sold, they compress one timer by at most 3\.5/.test(tokenSrc) && /sign-off, go build it/.test(tokenSrc));
check("and the owner's never-sell-these words are quoted too",
  /don't sell the one minute or the 5 minutes speed UPS/.test(tokenSrc));

// =========================================================== §A2 the catalogue
section("A2 \u00b7 THE CATALOGUE \u2014 six rows, the owner's prices, one place for the product id");
check("six catalogue rows, one per sellable size", TIME_TOKEN_PACKS.length === 6, String(TIME_TOKEN_PACKS.length));
check("every sellable size has exactly one row, and no other size has one",
  SELLABLE_TIME_TOKEN_SIZES.every((s) => TIME_TOKEN_PACKS.filter((p) => p.sizeId === s).length === 1)
  && TIME_TOKEN_PACKS.every((p) => isSellableTimeTokenSize(p.sizeId)));
check("the owner's prices, exactly: 30m $2.99 \u00b7 1h $3.99 \u00b7 8h $7.99 \u00b7 12h $9.99 \u00b7 24h $14.99 \u00b7 48h $24.99",
  timeTokenPriceUsd("30m") === 2.99 && timeTokenPriceUsd("1h") === 3.99 && timeTokenPriceUsd("8h") === 7.99
  && timeTokenPriceUsd("12h") === 9.99 && timeTokenPriceUsd("24h") === 14.99 && timeTokenPriceUsd("48h") === 24.99,
  TIME_TOKEN_PACKS.map((p) => `${p.sizeId}:${p.priceUsd}`).join(" "));
check("nothing prices 1m or 5m (timeTokenPriceUsd is 0 and there is no row)",
  timeTokenPriceUsd("1m") === 0 && timeTokenPriceUsd("5m") === 0 && !timeTokenPack("1m") && !timeTokenPack("5m"));
check("the catalogue id is one formula from the size, and every row uses it",
  TIME_TOKEN_PACKS.every((p) => p.id === timeTokenPackId(p.sizeId))
  && new Set(TIME_TOKEN_PACKS.map((p) => p.id)).size === 6);
check("THE PRODUCT ID COLUMN IS FILLED \u2014 with the six LIVE Stripe product ids, one per size, no duplicates",
  TIME_TOKEN_PACKS.map((p) => p.providerSkuId).join(",")
  === "prod_VL1IlrKotjeEc8,prod_VL1I6RcBYf9ip1,prod_VL1IhfQkbh15q2,prod_VL1IEaKNpi2sXz,prod_VL1IvxuGGlgwN2,prod_VL1IdZr899TCNt"
  && new Set(TIME_TOKEN_PACKS.map((p) => p.providerSkuId)).size === 6
  && TIME_TOKEN_PACKS.every((p) => /^prod_[A-Za-z0-9]+$/.test(p.providerSkuId)),
  TIME_TOKEN_PACKS.map((p) => p.providerSkuId).join(","));
check("the empty id still means UNSET, and the referee still has that state to refuse",
  TIME_TOKEN_PRODUCT_ID_UNSET === "");
check("…and each product id is READ from the one place it is written (payment-links.ts), not typed twice",
  TIME_TOKEN_PACKS.every((p) => paymentLinkRow(p.id)?.productId === p.providerSkuId),
  TIME_TOKEN_PACKS.map((p) => `${p.id}:${paymentLinkRow(p.id)?.productId ?? "MISSING"}`).join(" "));
check("…while the price column is untouched \u2014 no amountUsd/priceUsd moved in this slice",
  TIME_TOKEN_PACKS.map((p) => p.priceUsd).join(",") === "2.99,3.99,7.99,9.99,14.99,24.99"
  && PAYMENT_LINKS.filter((r) => r.skuId.startsWith("time-token-")).every((r) => r.amountUsd === timeTokenPriceUsd(r.skuId.replace("time-token-", ""))),
  PAYMENT_LINKS.filter((r) => r.skuId.startsWith("time-token-")).map((r) => `${r.skuId}:${r.amountUsd}`).join(" "));
check("a speed-up row carries NO grant payload \u2014 it grants time and nothing else",
  TIME_TOKEN_PACKS.every((p) => !Object.prototype.hasOwnProperty.call(p, "grants")));
check("no catalogue row references a resource, a strength or a scored currency field at all",
  TIME_TOKEN_PACKS.every((p) => {
    const keys = Object.keys(p).sort().join(",");
    return keys === "id,name,priceUsd,providerSkuId,sizeId";
  }), TIME_TOKEN_PACKS.map((p) => Object.keys(p).sort().join(","))[0]);
check("prices are monotonic in value per hour \u2014 a bigger token is better value",
  (() => {
    const rows = [...TIME_TOKEN_PACKS].sort((a, b) => timeTokenMs(a.sizeId) - timeTokenMs(b.sizeId));
    return rows.every((r, i) => i === 0 || r.priceUsd / timeTokenMs(r.sizeId) < rows[i - 1].priceUsd / timeTokenMs(rows[i - 1].sizeId));
  })());
check("assertCatalogFair passes on the whole catalogue (packs, cosmetics, tiers, tokens)",
  (() => { try { assertCatalogFair(); return true; } catch { return false; } })());
// ---- and the widened guardrail is not vacuous: five tampered catalogues must throw
refuses("NEGATIVE CONTROL \u00b7 a price on an EARNED size (1m) is refused by assertCatalogFair",
  () => { TIME_TOKEN_PACKS.push({ id: "time-token-1m", sizeId: "1m" as never, name: "One-Minute Token", priceUsd: 1.99, providerSkuId: "" } as TimeTokenPackDef); },
  () => { TIME_TOKEN_PACKS.pop(); });
refuses("NEGATIVE CONTROL \u00b7 a zero price is refused (a speed-up is sold, not given away)",
  () => { TIME_TOKEN_PACKS[0].priceUsd = 0; },
  () => { TIME_TOKEN_PACKS[0].priceUsd = 2.99; });
refuses("NEGATIVE CONTROL \u00b7 a grant payload on a speed-up row is refused",
  () => { (TIME_TOKEN_PACKS[0] as unknown as Record<string, unknown>).grants = [{ kind: "resource", key: "supplies", amount: 5 }]; },
  () => { delete (TIME_TOKEN_PACKS[0] as unknown as Record<string, unknown>).grants; });
refuses("NEGATIVE CONTROL \u00b7 a price that breaks monotonicity is refused",
  () => { TIME_TOKEN_PACKS[TIME_TOKEN_PACKS.length - 1].priceUsd = 44.99; },
  () => { TIME_TOKEN_PACKS[TIME_TOKEN_PACKS.length - 1].priceUsd = 24.99; });
refuses("NEGATIVE CONTROL \u00b7 a WAR-HARDWARE name on a speed-up row is refused",
  () => { TIME_TOKEN_PACKS[0].name = "Plasma cache with a speed-up"; },
  () => { TIME_TOKEN_PACKS[0].name = "Half-Hour Token"; });
// NEW with the wiring (2026-09-27): now that the product ids are real, the guard
// that matters is that a PLACEHOLDER cannot pass as one.
refuses("NEGATIVE CONTROL \u00b7 a placeholder product id is refused (it is a prod_\u2026 id or it is nothing)",
  () => { TIME_TOKEN_PACKS[0].providerSkuId = "TODO"; },
  () => { TIME_TOKEN_PACKS[0].providerSkuId = productIdForSku("time-token-30m"); });
// A blank product id is a legal catalogue VALUE ("not wired yet") — the guard
// that refuses it is the SALE REFEREE, not assertCatalogFair, so it is asserted
// there (§E) rather than through `refuses()` above.
check("the catalogue is byte-identical to the shipped one after the controls",
  JSON.stringify(TIME_TOKEN_PACKS) === JSON.stringify([
    { id: "time-token-30m", sizeId: "30m", name: "Half-Hour Token", priceUsd: 2.99, providerSkuId: "prod_VL1IlrKotjeEc8" },
    { id: "time-token-1h", sizeId: "1h", name: "One-Hour Token", priceUsd: 3.99, providerSkuId: "prod_VL1I6RcBYf9ip1" },
    { id: "time-token-8h", sizeId: "8h", name: "Eight-Hour Token", priceUsd: 7.99, providerSkuId: "prod_VL1IhfQkbh15q2" },
    { id: "time-token-12h", sizeId: "12h", name: "Twelve-Hour Token", priceUsd: 9.99, providerSkuId: "prod_VL1IEaKNpi2sXz" },
    { id: "time-token-24h", sizeId: "24h", name: "Day Token", priceUsd: 14.99, providerSkuId: "prod_VL1IvxuGGlgwN2" },
    { id: "time-token-48h", sizeId: "48h", name: "Two-Day Token", priceUsd: 24.99, providerSkuId: "prod_VL1IdZr899TCNt" },
  ]));

// =========================================================== §B the floor
section("B \u00b7 THE FLOOR \u2014 0.286, one constant, every pile bounded");
check("TIME_TOKEN_FLOOR_FRACTION mirrors engine.MIN_TIMER_FRACTION exactly",
  TIME_TOKEN_FLOOR_FRACTION === engine.MIN_TIMER_FRACTION, `${TIME_TOKEN_FLOOR_FRACTION} vs ${engine.MIN_TIMER_FRACTION}`);
check("the floor is the ratified 0.286", TIME_TOKEN_FLOOR_FRACTION === 0.286);
const BASE = 12 * HOUR; // armory tier 1: the shortest real timer in the build
check("max compression is base x (1 - 0.286)", maxTimeTokenCompressionMs(BASE) === Math.floor(BASE * 0.714));
check("engine.timerFloor applies the SAME constant to the earned stack",
  engine.timerFloor(BASE, 0) === Math.round(BASE * engine.MIN_TIMER_FRACTION));
check("the 3.5x ceiling is the owner's own arithmetic: 1 / 0.286 is 3.4965…",
  Math.abs(1 / TIME_TOKEN_FLOOR_FRACTION - 3.5) < 0.01);

const st = mk({ armoryBuilds: { lastBell: { targetTier: 1, startedAt: NOW, doneAt: NOW + BASE } } });
st.timeTokens = { "1m": 100_000, "5m": 100_000 };
let steps = 0, refused = false, minRemaining = Infinity, maxSeenCompressed = 0;
for (let i = 0; i < 2000; i++) {
  const r = applyTimeToken(st, "1m", `pile:${i}`, { kind: "armory_build", id: "lastBell" }, NOW);
  if (!r.ok) { refused = true; check("the refusal at the floor carries a keyed reason", r.errorKey === "time.refusedFloor", String(r.errorKey)); break; }
  steps++;
  maxSeenCompressed = Math.max(maxSeenCompressed, r.compressedTotalMs ?? 0);
  minRemaining = Math.min(minRemaining, r.remainingMs ?? 0);
}
check(`a pile of 1m tokens is eventually REFUSED at the floor (after ${steps} applications)`, refused && steps > 0);
check("accumulated compression never passes 71.4% of the timer's own base",
  maxSeenCompressed <= maxTimeTokenCompressionMs(BASE), `${maxSeenCompressed} > ${maxTimeTokenCompressionMs(BASE)}`);
check("the remaining time never reaches zero or below", minRemaining > 0, String(minRemaining));
check("the floor is read from the build's own base, not from the compressed length",
  st.armoryBuilds.lastBell.timeTokenMs === maxSeenCompressed);
const st2 = mk({ armoryBuilds: { a: { targetTier: 1, startedAt: NOW, doneAt: NOW + BASE } } });
st2.timeTokens = { "1m": 1, "5m": 0 };
const one = applyTimeToken(st2, "1m", "one:1", { kind: "armory_build", id: "a" }, NOW);
check("one 1m token takes exactly 60,000 ms off the timer", one.ok && one.compressedMs === 60_000, JSON.stringify(one));
check("and hands the effective finish an hour forward at 12h scale",
  (one.remainingMs ?? 0) === BASE - 60_000, String(one.remainingMs));

// =========================================================== §C the ladder
section("C \u00b7 THE LADDER \u2014 an exploration run is refused BY NAME, for every size");
const st3 = mk({ armoryBuilds: { a: { targetTier: 1, startedAt: NOW, doneAt: NOW + 4 * HOUR } } });
st3.timeTokens = { "1m": 5, "5m": 5, "48h": 5 };
const exp = applyTimeToken(st3, "1m", "exp:1", { kind: "expedition", id: "z-rim" }, NOW);
check("an expedition timer REFUSES a token", !exp.ok);
check("the refusal is a catalogue key (player-facing, translated in five files)",
  exp.errorKey === "time.refusedExpedition", String(exp.errorKey));
check("the refusal names the rule in English for the log too", /exploration run/.test(exp.error ?? ""));
check("the SAME refusal covers a SELLABLE size \u2014 a bought speed-up cannot touch the ladder either",
  (() => {
    const r = applyTimeToken(st3, "48h", "exp:2", { kind: "expedition", id: "z-rim" }, NOW);
    return !r.ok && r.errorKey === "time.refusedExpedition";
  })());
check("expedition is NOT on the allow-list", !TIME_TOKEN_TIMER_KINDS.includes("expedition" as never));
check("the allow-list is exactly armory build / research / domain deploy",
  TIME_TOKEN_TIMER_KINDS.join(",") === "armory_build,research,domain_deploy");
check("the refused run is untouched (no compression written anywhere)",
  !/[0-9]/.test(JSON.stringify(st3.armoryBuilds.a.timeTokenMs ?? "u")) && st3.armoryBuilds.a.timeTokenMs === undefined);
check("no token was spent on the refusal, earned or sold",
  heldTimeTokens(st3, "1m") === 5 && heldTimeTokens(st3, "48h") === 5);
const st4 = mk({
  researchJobs: [{ id: "r1", techId: "t1", leaderId: "L", startedAt: NOW, durationMs: 8 * HOUR, status: "researching" }],
  programDeploy: { domain: "logistics", startedAt: NOW, durationMs: 6 * HOUR },
  armoryBuilds: { a: { targetTier: 2, startedAt: NOW, doneAt: NOW + 3 * DAY } },
});
st4.timeTokens = { "1m": 3, "5m": 3 };
const rRes = applyTimeToken(st4, "5m", "res:1", { kind: "research", id: "r1" }, NOW);
const rDep = applyTimeToken(st4, "5m", "dep:1", { kind: "domain_deploy" }, NOW);
const rArm = applyTimeToken(st4, "5m", "arm:1", { kind: "armory_build", id: "a" }, NOW);
check("a Lab research job accepts a token", rRes.ok && rRes.compressedMs === 300_000, JSON.stringify(rRes));
check("a domain deployment accepts a token", rDep.ok && rDep.compressedMs === 300_000, JSON.stringify(rDep));
check("an armory build accepts a token", rArm.ok && rArm.compressedMs === 300_000, JSON.stringify(rArm));
check("each token was deducted exactly once", heldTimeTokens(st4, "5m") === 0);
check("a missing timer is refused with its own key",
  applyTimeToken(st4, "1m", "none:1", { kind: "research", id: "nope" }, NOW).errorKey === "time.refusedNoTimer");
check("an unknown target kind is refused with its own key",
  applyTimeToken(st4, "1m", "bad:1", { kind: "study" }, NOW).errorKey === "time.refusedUnknownKind");
check("an unheld size is refused with its own key",
  applyTimeToken(mk({ armoryBuilds: { a: { targetTier: 1, startedAt: NOW, doneAt: NOW + BASE } } }), "1m", "none:2", { kind: "armory_build", id: "a" }, NOW).errorKey === "time.refusedNoTokens");
check("an unknown size id is refused with its own key",
  applyTimeToken(st4, "3h", "size:1", { kind: "armory_build", id: "a" }, NOW).errorKey === "time.refusedSize");

// =========================================================== §D power invariance
section("D \u00b7 POWER INVARIANCE \u2014 per size: one timer compresses, nothing else moves");
const rich = mk({ armoryBuilds: { a: { targetTier: 3, startedAt: NOW, doneAt: NOW + 12 * DAY } } });
const poor = mk({ armoryBuilds: { a: { targetTier: 3, startedAt: NOW, doneAt: NOW + 12 * DAY } } });
ensureTimeTokens(rich);
rich.timeTokens = { "1m": 1_000_000, "5m": 1_000_000 };
const beforeRich = stripTokenFields(rich);
for (let i = 0; i < 50; i++) applyTimeToken(rich, "1m", `unlim:${i}`, { kind: "armory_build", id: "a" }, NOW);
check("a colony holding unlimited EARNED tokens has an IDENTICAL state to one holding none "
  + "(every field except the tokens themselves and the timer's own compression)", stripTokenFields(rich) === beforeRich);
check("no resource was granted by granting or spending tokens",
  JSON.stringify(rich.resources) === JSON.stringify(poor.resources));
check("no currency was granted", JSON.stringify(rich.currency) === JSON.stringify(poor.currency));
check("no season tier, pass XP or Leader XP moved", JSON.stringify(rich.battlePass) === JSON.stringify(poor.battlePass));
check("the module exports no grant of strength, resource or scored currency",
  !/export function (grantResource|grantStrength|grantXp|grantSeason|addContribution|boostPower)\b/.test(tokenSrc));
// ---- EVERY size, one at a time: exact compression, and no other field moves ----
const SIZE_CASES: Array<{ size: string; label: string }> = [
  ...EARNED_TIME_TOKEN_SIZES.map((s) => ({ size: s as string, label: "earned" })),
  ...SELLABLE_TIME_TOKEN_SIZES.map((s) => ({ size: s as string, label: "sellable" })),
];
for (const { size, label } of SIZE_CASES) {
  const base = 12 * DAY; // armory tier 3 — longer than any single token, so the token is the binding limit
  const before = mk({ armoryBuilds: { a: { targetTier: 3, startedAt: NOW, doneAt: NOW + base } } });
  const after = mk({ armoryBuilds: { a: { targetTier: 3, startedAt: NOW, doneAt: NOW + base } } });
  after.timeTokens = { [size]: 3 };
  const snapshot = stripTokenFields(after);
  const r = applyTimeToken(after, size, `inv:${size}`, { kind: "armory_build", id: "a" }, NOW);
  const ms = timeTokenMs(size);
  const expected = Math.min(ms, base, maxTimeTokenCompressionMs(base));
  check(`[${label} ${size}] applies exactly min(size, remaining, headroom) = ${expected.toLocaleString("en-US")} ms`,
    r.ok && r.compressedMs === expected, JSON.stringify(r));
  check(`[${label} ${size}] the timer moved by exactly that and is still running`,
    after.armoryBuilds.a.timeTokenMs === expected && (r.remainingMs ?? 0) > 0 && (r.remainingMs ?? 0) === base - expected, String(r.remainingMs));
  check(`[${label} ${size}] NO other field changed \u2014 no resource, no strength, no scored currency, no season tier`,
    stripTokenFields(after) === snapshot);
  check(`[${label} ${size}] exactly one token left the colony`,
    heldTimeTokens(after, size) === 2 && heldTimeTokens(before, size) === 0);
  check(`[${label} ${size}] compression stays inside the 3.5x ceiling`,
    (after.armoryBuilds.a.timeTokenMs ?? 0) <= maxTimeTokenCompressionMs(base));
}
// ---- a pile of the BIGGEST sellable size is bounded the same way ----
const pile = mk({ armoryBuilds: { a: { targetTier: 1, startedAt: NOW, doneAt: NOW + BASE } } });
pile.timeTokens = { "48h": 100 };
let pileSteps = 0, pileRefused = false, pileMax = 0;
for (let i = 0; i < 500; i++) {
  const r = applyTimeToken(pile, "48h", `pile48:${i}`, { kind: "armory_build", id: "a" }, NOW);
  if (!r.ok) { pileRefused = true; check("a pile of 48h tokens is refused at the floor with the floor's own key",
    r.errorKey === "time.refusedFloor", String(r.errorKey)); break; }
  pileSteps++;
  pileMax = Math.max(pileMax, r.compressedTotalMs ?? 0);
}
check(`a pile of 100 x 48h tokens compresses ONE timer by at most 71.4% (refused after ${pileSteps})`,
  pileRefused && pileMax <= maxTimeTokenCompressionMs(BASE), `${pileMax}`);
check("a 48h token cannot put a timer below the floor even though it is longer than the timer",
  (pile.armoryBuilds.a.timeTokenMs ?? 0) === maxTimeTokenCompressionMs(BASE), String(pile.armoryBuilds.a.timeTokenMs));
check("held tokens map to every size the build defines and nothing else",
  JSON.stringify(Object.keys(timeTokensPublicView({ "1m": 2, "5m": 3, "8h": 1, junk: 99 })).sort())
  === JSON.stringify([...EARNED_TIME_TOKEN_SIZES, ...SELLABLE_TIME_TOKEN_SIZES].sort()));
check("the public view never reports a negative or fractional holding",
  timeTokensPublicView({ "1m": -5, "5m": 1.7 })["1m"] === 0 && timeTokensPublicView({ "1m": -5, "5m": 1.7 })["5m"] === 1);
check("a size held zero times reads 0 in the public view, never undefined",
  timeTokensPublicView({ "1m": 1 })["48h"] === 0);
check("total held time is read from the sizes, never invented",
  heldTimeTokenMs({ timeTokens: { "1m": 2, "5m": 1 } } as unknown as GameState) === 2 * 60_000 + 300_000);
check("total held time counts a SOLD size too (it is a held thing like any other)",
  heldTimeTokenMs({ timeTokens: { "8h": 2 } } as unknown as GameState) === 2 * 28_800_000);

// =========================================================== §E the sell half
section("E \u00b7 THE SELL HALF \u2014 six sizes offered, 1m/5m refused, every sale refused by name today");
const monSrc = fs.readFileSync("/home/team/shared/site/src/game/monetization.ts", "utf8");
const monCode = monSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
// ---- the record, both halves ----
check("the tripwire list NO LONGER bans the words for what we sell (\"speed-up\"/\"speedup\" are gone)",
  !/"speed-up"/.test(monCode) && !/"speedup"/.test(monCode) && !/speedup/i.test(monCode));
check("…while every term that would MISdescribe a speed-up is still banned",
  /"skip"/.test(monCode) && /"rush"/.test(monCode) && /"instant"/.test(monCode) && /"finish"/.test(monCode)
  && /"boost"/.test(monCode) && /"timer"/.test(monCode) && /"xp"/.test(monCode) && /"tier-skip"/.test(monCode));
check("and the WAR-HARDWARE terms are untouched: plasma, armory, weapon, trebuchet",
  /"plasma"/.test(monCode) && /"armory"/.test(monCode) && /"weapon"/.test(monCode) && /"trebuchet"/.test(monCode));
check("the earn-only tripwire still exists as code (FORBIDDEN_POWER_TERMS + assertCatalogFair)",
  /FORBIDDEN_POWER_TERMS/.test(monCode) && /export function assertCatalogFair/.test(monCode));
check("the armory's earn-only claim is still stated in the engine and the api",
  /EARN-ONLY/.test(fs.readFileSync("/home/team/shared/site/src/game/engine.ts", "utf8"))
  && /EARN-ONLY/.test(fs.readFileSync("/home/team/shared/site/src/game/api.ts", "utf8")));
// ---- the tripwire's own three controls: widened, not weakened ----
function probePack(name: string, blurb: string, playEquivalent: string) {
  return { id: "probe_pack", name, blurb, playEquivalent, priceUsd: 4.99, providerSkuId: "",
    scrip: 0, grants: [{ kind: "resource", key: "supplies", amount: 1, note: "" }] };
}
function refusedPack(name: string, blurb: string, playEquivalent: string): boolean {
  const probe = probePack(name, blurb, playEquivalent);
  HEAD_START_PACKS.push(probe as unknown as (typeof HEAD_START_PACKS)[number]);
  let thrown = false;
  try { assertCatalogFair(); } catch { thrown = true; }
  HEAD_START_PACKS.pop();
  return thrown;
}
const speedUpAccepted = !refusedPack("One-Hour Token", "Takes one hour off a single build or deployment you have running.", "an hour of waiting removed");
check("POSITIVE CONTROL \u00b7 a purchasable pack NAMED for the thing we now sell is ACCEPTED (the record changed)",
  speedUpAccepted);
check("NEGATIVE CONTROL \u00b7 a pack that claims to SKIP a timer is still REFUSED",
  refusedPack("Skip-Timer Pack", "Compress a build.", "skip the wait"));
check("NEGATIVE CONTROL \u00b7 a pack that claims to RUSH or INSTANTLY FINISH is still REFUSED",
  refusedPack("Rush Pack", "Finish it instantly.", "rush a build"));
check("NEGATIVE CONTROL \u00b7 a pack that names WAR HARDWARE is still REFUSED (earn-only holds)",
  refusedPack("Pre-War Plasma Cache", "A cache of war material.", "armory supplies"));
check("NEGATIVE CONTROL \u00b7 a pack that GRANTS plasma is still refused by the structural check",
  (() => {
    const probe = probePack("Deed Cache", "A plain cache.", "one week of steady explorations");
    probe.grants = [{ kind: "resource", key: "plasma" as never, amount: 1, note: "" }];
    HEAD_START_PACKS.push(probe as unknown as (typeof HEAD_START_PACKS)[number]);
    let thrown = false;
    try { assertCatalogFair(); } catch { thrown = true; }
    HEAD_START_PACKS.pop();
    return thrown;
  })());
check("the probe packs were removed again (the catalogue is unchanged)",
  !HEAD_START_PACKS.some((p) => p.id === "probe_pack") && HEAD_START_PACKS.length === 3);
check("no head-start pack grants a timer at all \u2014 time is sold as a token, never inside a pack",
  !/\bkind:\s*"time"/.test(monCode));
// ---- the sale referee ----
check("an unknown size cannot be sold, and says so with the size key",
  timeTokenSaleRefusal("3h")?.errorKey === "time.refusedSize", JSON.stringify(timeTokenSaleRefusal("3h")));
check("1m is REFUSED FOR SALE by name (earned-only, keyed for five languages)",
  timeTokenSaleRefusal("1m")?.errorKey === "time.earnedOnly", JSON.stringify(timeTokenSaleRefusal("1m")));
check("5m is REFUSED FOR SALE by name too", timeTokenSaleRefusal("5m")?.errorKey === "time.earnedOnly");
check("the 1m/5m refusal names the Devotion as where they come from",
  /Devotion/.test(timeTokenSaleRefusal("1m")?.error ?? ""));
check("NOW THE STRIPE PRODUCTS EXIST: all six are OFFERED \u2014 the referee returns null for every size",
  SELLABLE_TIME_TOKEN_SIZES.every((s) => timeTokenSaleRefusal(s) === null),
  SELLABLE_TIME_TOKEN_SIZES.map((s) => `${s}:${JSON.stringify(timeTokenSaleRefusal(s))}`).join(" "));
// WIDENED, NOT WEAKENED: filling the ids removed the "every size is refused"
// state, so the refusal it proved is re-proved on a planted UNSET id \u2014 the row
// still cannot be sold without a Stripe object, by name, with both facts in it.
check("…while a row whose product id is UNSET is STILL refused by name (the control for that removal)",
  (() => {
    const row = TIME_TOKEN_PACKS.find((p) => p.sizeId === "8h")!;
    const before = row.providerSkuId;
    row.providerSkuId = TIME_TOKEN_PRODUCT_ID_UNSET;
    const refused = timeTokenSaleRefusal("8h");
    row.providerSkuId = before;
    return refused?.errorKey === "store.notForSale" && /8h/.test(refused.error) && /providerSkuId/.test(refused.error)
      && timeTokenSaleRefusal("8h") === null;
  })());
check("the set of sizes actually sellable is exactly the six (read from the rows, not assumed)",
  sellableTimeTokenSizes().join(",") === SELLABLE_TIME_TOKEN_SIZES.join(","), sellableTimeTokenSizes().join(","));
check("a link-table row exists for all six \u2014 that is the RECOGNITION path (metadata/plink/price/product ids)",
  SELLABLE_TIME_TOKEN_SIZES.every((s) => {
    const r = paymentLinkRow(timeTokenPackId(s));
    return !!r && /^plink_/.test(r.paymentLinkId) && /^price_/.test(r.priceId) && /^prod_/.test(r.productId ?? "");
  }),
  PAYMENT_LINKS.filter((r) => r.skuId.startsWith("time-token-")).map((r) => r.skuId).join(",") || "(none)");
check("…and the three token resolvers answer for every one of the six (nothing is recognised by accident)",
  SELLABLE_TIME_TOKEN_SIZES.every((s) => {
    const r = paymentLinkRow(timeTokenPackId(s))!;
    return skuForMetadataSku(r.skuId) === r.skuId && skuForPriceId(r.priceId) === r.skuId && skuForProductId(r.productId) === r.skuId
      && skuForProductId("prod_not_ours") === null && skuForPriceId("price_not_ours") === null;
  }));
// THE HONEST SURFACE ANSWER, asserted rather than asserted-in-prose: six rows
// exist and NOT ONE has a url, so no token is buyable and checkout refuses.
check("NOT ONE token row carries a url \u2014 there is no buy surface for a token today",
  PAYMENT_LINKS.filter((r) => r.skuId.startsWith("time-token-")).every((r) => r.url === ""),
  PAYMENT_LINKS.filter((r) => r.skuId.startsWith("time-token-")).map((r) => `${r.skuId}:${r.url || "(no url)"}`).join(" "));
check("…so no token is sellable and checkout refuses for every one of the six",
  SELLABLE_TIME_TOKEN_SIZES.every((s) => !isSellable(timeTokenPackId(s)) && checkoutUrl(timeTokenPackId(s), "acct") === null)
  && sellableSkus().every((s) => !s.startsWith("time-token-")));
check("NEGATIVE CONTROL \u00b7 the URL is the gate: a planted url makes a token buyable, and removing it restores the refusal",
  (() => {
    const row = paymentLinkRow("time-token-8h")!;
    row.url = "https://buy.stripe.com/test_token_planted";
    const becameBuyable = isSellable("time-token-8h") && checkoutUrl("time-token-8h", "acct") !== null;
    row.url = "";
    return becameBuyable && !isSellable("time-token-8h") && checkoutUrl("time-token-8h", "acct") === null;
  })());
check("THE STOREFRONT IS STILL OFF \u2014 this slice did not flip the switch",
  MONETIZATION_CONFIG.storefrontEnabled === false);
check("…and BOTH purchase handlers are still gated on it (no way around the switch)",
  (fs.readFileSync("/home/team/shared/site/src/game/api.ts", "utf8").match(/storefrontEnabled\)/g) ?? []).length >= 2);
// ---- the earned door cannot conjure what is sold ----
check("the EARNED grant door REFUSES a sellable size \u2014 no free 8h token",
  (() => {
    const s = mk();
    const g = grantTimeToken(s, "8h", "evt-sell-1", "test", NOW);
    return !g.ok && heldTimeTokens(s, "8h") === 0 && (s.timeTokenLedger ?? []).length === 0;
  })());
check("…the same door still pays the two earned sizes",
  (() => {
    const s = mk();
    return grantTimeToken(s, "1m", "evt-earn-1", "test", NOW).ok && grantTimeToken(s, "5m", "evt-earn-2", "test", NOW).ok
      && heldTimeTokens(s, "1m") === 1 && heldTimeTokens(s, "5m") === 1;
  })());
check("and it still refuses a size that does not exist",
  (() => { const s = mk(); return !grantTimeToken(s, "3h", "evt-x", "test", NOW).ok; })());
check("the catalogue module cannot GRANT a token at all \u2014 no grant door is reachable from it",
  !/grantTimeToken/.test(monCode) && !/applyTimeToken/.test(monCode));
check("and no pack grant kind is 'time' anywhere in the catalogue",
  !/kind:\s*"time"/.test(monCode));

// =========================================================== §I the purchase door
section("I \u00b7 THE PURCHASE DOOR \u2014 the entitlement a verified purchase lands, floored and idempotent");
// The door exists because a purchased token has to be GRANTABLE without widening
// the earned door. Every assertion below is about the two properties that matter:
// it pays exactly the six sold sizes, and a bought token is not a stronger token.
check("every one of the six is GRANTABLE through the purchase door, one held token each",
  SELLABLE_TIME_TOKEN_SIZES.every((s) => {
    const st = mk();
    const g = grantSoldTimeToken(st, s, `purch:cs_${s}`, `Purchased token ${s} (Stripe session cs_${s})`, NOW);
    return g.ok && heldTimeTokens(st, s) === 1;
  }));
check("the grant is RECORDED in the ledger, with its size, its amount and the session it came from",
  (() => {
    const st = mk();
    grantSoldTimeToken(st, "8h", "purch:cs_test_8h", "Purchased Eight-Hour Token (Stripe session cs_test_8h)", NOW);
    const rows = st.timeTokenLedger ?? [];
    return rows.length === 1 && rows[0].kind === "earn" && rows[0].sizeId === "8h" && rows[0].amount === 1
      && rows[0].eventId === "purch:cs_test_8h" && /cs_test_8h/.test(rows[0].reason);
  })());
check("it REFUSES the two EARNED sizes by name \u2014 the two doors cannot reach each other's sizes",
  (() => {
    const st = mk();
    const a = grantSoldTimeToken(st, "1m", "purch:cs_1m", "test", NOW);
    const b = grantSoldTimeToken(st, "5m", "purch:cs_5m", "test", NOW);
    return !a.ok && /EARNED/.test(a.error ?? "") && !b.ok && heldTimeTokens(st, "1m") === 0 && heldTimeTokens(st, "5m") === 0
      && (st.timeTokenLedger ?? []).length === 0;
  })());
check("…and it refuses an unknown size and a request with no eventId",
  (() => {
    const st = mk();
    return !grantSoldTimeToken(st, "3h", "purch:cs_x", "test", NOW).ok
      && !grantSoldTimeToken(st, "8h", "", "test", NOW).ok
      && heldTimeTokens(st, "8h") === 0;
  })());
check("IDEMPOTENT: a replayed purchase (same session id) pays ONCE and says it was already paid",
  (() => {
    const st = mk();
    const first = grantSoldTimeToken(st, "24h", "purch:cs_replay", "Purchased Day Token (Stripe session cs_replay)", NOW);
    const again = grantSoldTimeToken(st, "24h", "purch:cs_replay", "Purchased Day Token (Stripe session cs_replay)", NOW);
    return first.ok && !first.idempotent && again.ok && again.idempotent === true
      && heldTimeTokens(st, "24h") === 1 && (st.timeTokenLedger ?? []).length === 1;
  })());
check("an eventId is spent ONCE across both doors (a purchase id can never buy a free earned token, or the reverse)",
  (() => {
    const st = mk();
    grantTimeToken(st, "1m", "shared-id", "Devotion", NOW);
    const sold = grantSoldTimeToken(st, "8h", "shared-id", "test", NOW);
    return sold.ok && sold.idempotent === true && heldTimeTokens(st, "8h") === 0;
  })());
check("POWER INVARIANCE per size: a purchase grant changes the token fields and NOTHING else",
  SELLABLE_TIME_TOKEN_SIZES.every((s) => {
    const st = mk();
    const before = stripTokenFields(st);
    grantSoldTimeToken(st, s, `purch:cs_inv_${s}`, "test", NOW);
    return stripTokenFields(st) === before;
  }));
check("FLOORED: a bought 48h token on a 2h timer takes it to the floor, never below, never to zero",
  (() => {
    const st = mk({ armoryBuilds: { a: { targetTier: 2, startedAt: NOW, doneAt: NOW + 2 * HOUR } } });
    grantSoldTimeToken(st, "48h", "purch:cs_floor", "test", NOW);
    const r = applyTimeToken(st, "48h", "req-bought-floor", { kind: "armory_build", id: "a" }, NOW);
    const base = 2 * HOUR;
    return r.ok && r.baseMs === base && (r.compressedTotalMs ?? 0) <= maxTimeTokenCompressionMs(base)
      && (r.remainingMs ?? 0) >= base * TIME_TOKEN_FLOOR_FRACTION - 1 && (r.remainingMs ?? 0) > 0
      && heldTimeTokens(st, "48h") === 0;
  })());
check("FLOORED: a PILE of bought tokens cannot go past the same ceiling either (100 × 48h vs a 30-day timer)",
  (() => {
    const st = mk({ armoryBuilds: { a: { targetTier: 4, startedAt: NOW, doneAt: NOW + 30 * DAY } } });
    for (let i = 0; i < 100; i++) grantSoldTimeToken(st, "48h", `purch:cs_pile_${i}`, "test", NOW);
    let applied = 0;
    while (heldTimeTokens(st, "48h") > 0) {
      const r = applyTimeToken(st, "48h", `req-pile-${applied}`, { kind: "armory_build", id: "a" }, NOW);
      if (!r.ok) break;
      applied++;
      if (applied > 120) break;
    }
    const compressed = st.armoryBuilds.a.timeTokenMs ?? 0;
    return compressed <= maxTimeTokenCompressionMs(30 * DAY) && compressed === maxTimeTokenCompressionMs(30 * DAY)
      && (30 * DAY - compressed) >= 30 * DAY * TIME_TOKEN_FLOOR_FRACTION - 1;
  })());
check("the earn door and the purchase door are DISJOINT on both sides (a sold size is never earned, and vice versa)",
  SELLABLE_TIME_TOKEN_SIZES.every((s) => !isEarnedTimeTokenSize(s) && !grantTimeToken(mk(), s, `evt-${s}`, "test", NOW).ok)
  && EARNED_TIME_TOKEN_SIZES.every((s) => !isSellableTimeTokenSize(s)));
check("the PURCHASE PATH is where the catalogue reaches it: monetization routes a token SKU to this door",
  /grantSoldTimeToken\(/.test(monCode) && /TIME_TOKEN_PACK_BY_ID\[purchase\.skuId\]/.test(monCode));
check("…and nothing on the EARNED side can reach it: neither daily.ts nor api.ts names the purchase door",
  !/grantSoldTimeToken/.test(fs.readFileSync("/home/team/shared/site/src/game/daily.ts", "utf8"))
  && !/grantSoldTimeToken/.test(fs.readFileSync("/home/team/shared/site/src/game/api.ts", "utf8")));

// =========================================================== §F idempotency
section("F \u00b7 IDEMPOTENCY \u2014 both ways");
const st5 = mk({ armoryBuilds: { a: { targetTier: 2, startedAt: NOW, doneAt: NOW + 3 * DAY } } });
st5.timeTokens = { "1m": 2, "5m": 0 };
const a1 = applyTimeToken(st5, "1m", "req-dup", { kind: "armory_build", id: "a" }, NOW);
const a2 = applyTimeToken(st5, "1m", "req-dup", { kind: "armory_build", id: "a" }, NOW);
check("the first apply compresses", a1.ok && a1.compressedMs === 60_000);
check("the repeated request id is a no-op, flagged idempotent", a2.ok && a2.idempotent === true && a2.compressedMs === 0);
check("the timer was not double-compressed", st5.armoryBuilds.a.timeTokenMs === 60_000, String(st5.armoryBuilds.a.timeTokenMs));
check("only one token was spent", heldTimeTokens(st5, "1m") === 1);
const a3 = (() => {
  const s = mk({ armoryBuilds: { a: { targetTier: 2, startedAt: NOW, doneAt: NOW + 3 * DAY } } });
  s.timeTokens = { "8h": 2 };
  const f = applyTimeToken(s, "8h", "req-dup-8h", { kind: "armory_build", id: "a" }, NOW);
  const g = applyTimeToken(s, "8h", "req-dup-8h", { kind: "armory_build", id: "a" }, NOW);
  return { f, g, spent: heldTimeTokens(s, "8h"), compressed: s.armoryBuilds.a.timeTokenMs };
})();
check("idempotency holds for a SOLD size as well \u2014 a retried purchase-spend cannot double-compress",
  a3.f.ok && a3.g.idempotent === true && a3.spent === 1 && a3.compressed === 8 * HOUR, JSON.stringify(a3.g));
const g1 = grantTimeToken(st5, "5m", "evt-dup", "test", NOW);
const g2 = grantTimeToken(st5, "5m", "evt-dup", "test", NOW);
check("a repeated grant eventId is idempotent", g1.ok && !g1.idempotent && g2.ok && g2.idempotent === true);
check("and paid exactly one token", heldTimeTokens(st5, "5m") === 1);
check("an eventId already used by the CURRENCY ledger cannot pay a token",
  (() => {
    const s = mk();
    s.currency.ledger.push({ eventId: "shared-id", kind: "earn", currency: "scrip", amount: 1, reason: "x", ts: NOW });
    return grantTimeToken(s, "1m", "shared-id", "x", NOW).idempotent === true && heldTimeTokens(s, "1m") === 0;
  })());
check("a requestId used on a timer that has since RESOLVED is still a no-op",
  (() => {
    const s = mk({ armoryBuilds: {} });
    s.timeTokens = { "1m": 1, "5m": 0 };
    grantTimeToken(s, "1m", "gone-req", "x", NOW);
    return true;
  })());

// =========================================================== §G the Devotion
section("G \u00b7 THE DEVOTION PAYS THEM \u2014 every reward claim, one of each earned size");
check("one 1m + one 5m per reward claim is the CONFIGURED schedule \u2014 unchanged by this slice",
  DAILY_CONFIG.timeTokensPerClaim.join(",") === "1m,5m");
check("no SELLABLE size is anywhere in the Devotion's schedule",
  DAILY_CONFIG.timeTokensPerClaim.every((s: string) => isEarnedTimeTokenSize(s)));
const dev = mk({ race: "watchers" });
dev.daily!.dayKey = "1999-01-01"; // force a rollover onto today
reconcileDaily(dev, NOW);
dev.daily!.completed = [...dev.daily!.list];
const c1 = claimDaily(dev, NOW);
check("a full day's claim pays 5 one-minute tokens (4 items + the bonus)",
  c1.granted!.timeTokens["1m"] === 5, JSON.stringify(c1.granted!.timeTokens));
check("and 5 five-minute tokens", c1.granted!.timeTokens["5m"] === 5, JSON.stringify(c1.granted!.timeTokens));
check("held: 5 x 1m and 5 x 5m", heldTimeTokens(dev, "1m") === 5 && heldTimeTokens(dev, "5m") === 5);
check("a full day is 30 minutes of token time (5x1 + 5x5)", heldTimeTokenMs(dev) === 30 * 60_000, String(heldTimeTokenMs(dev)));
check("the Devotion pays NOTHING sellable \u2014 no sold size moved",
  SELLABLE_TIME_TOKEN_SIZES.every((s) => heldTimeTokens(dev, s) === 0));
const c2 = claimDaily(dev, NOW);
check("re-claiming the same day grants ZERO tokens",
  (c2.granted!.timeTokens["1m"] ?? 0) === 0 && (c2.granted!.timeTokens["5m"] ?? 0) === 0, JSON.stringify(c2.granted!.timeTokens));
check("and the holdings did not move", heldTimeTokens(dev, "1m") === 5 && heldTimeTokens(dev, "5m") === 5);
check("the claim result CARRIES what was granted (the UI lists it, never derives it)",
  typeof c1.granted!.timeTokens === "object" && "1m" in c1.granted!.timeTokens);
// a single item claim pays one of each too
const dev2 = mk({ race: "watchers" });
dev2.daily!.dayKey = "1999-01-01";
reconcileDaily(dev2, NOW);
dev2.daily!.completed = [dev2.daily!.list[0]];
const c3 = claimDaily(dev2, NOW);
check("one completed item's claim pays one 1m AND one 5m",
  c3.granted!.timeTokens["1m"] === 1 && c3.granted!.timeTokens["5m"] === 1, JSON.stringify(c3.granted!.timeTokens));
check("the ledger records the grant with source kind 'earn'",
  dev2.timeTokenLedger!.every((e) => e.kind === "earn") && dev2.timeTokenLedger!.length === 2);
check("the ledger is append-only and eventId-keyed (one row per token)",
  new Set(dev2.timeTokenLedger!.map((e) => e.eventId)).size === dev2.timeTokenLedger!.length);
// the earned tokens are spendable on a real timer
const dev3 = mk({
  race: "watchers",
  armoryBuilds: { a: { targetTier: 1, startedAt: NOW, doneAt: NOW + 12 * HOUR } },
});
dev3.daily!.dayKey = "1999-01-01";
reconcileDaily(dev3, NOW);
dev3.daily!.completed = [...dev3.daily!.list];
claimDaily(dev3, NOW);
const spend = applyTimeToken(dev3, "5m", "dev-spend", { kind: "armory_build", id: "a" }, NOW);
check("a token the Devotion paid can compress a real build", spend.ok && spend.compressedMs === 300_000, JSON.stringify(spend));
check("and cannot be spent on an exploration run", applyTimeToken(dev3, "5m", "dev-exp", { kind: "expedition" }, NOW).ok === false);

// =========================================================== §H migration
section("H \u00b7 MIGRATION \u2014 an old save gets zeros, once; a sold holding survives");
const legacy = { race: "watchers", resources: {} } as unknown as GameState;
ensureTimeTokens(legacy);
check("a save written before time tokens existed gets both earned sizes at zero",
  heldTimeTokens(legacy, "1m") === 0 && heldTimeTokens(legacy, "5m") === 0);
check("…and the migration INVENTS no sellable size (no key for what was never held)",
  SELLABLE_TIME_TOKEN_SIZES.every((s) => !Object.prototype.hasOwnProperty.call(legacy.timeTokens ?? {}, s)));
check("and an empty ledger", Array.isArray(legacy.timeTokenLedger) && legacy.timeTokenLedger.length === 0);
const snap = JSON.stringify(legacy.timeTokens);
ensureTimeTokens(legacy);
check("running the migration twice changes nothing (idempotent)", JSON.stringify(legacy.timeTokens) === snap);
const corrupt = { race: "watchers", resources: {}, timeTokens: { "1m": -4, "5m": "x" } } as unknown as GameState;
ensureTimeTokens(corrupt);
check("a corrupt holding is repaired to zero, never trusted",
  heldTimeTokens(corrupt, "1m") === 0 && heldTimeTokens(corrupt, "5m") === 0);
const corruptSold = { race: "watchers", resources: {}, timeTokens: { "8h": -2, "12h": "x", "48h": 1.9 } } as unknown as GameState;
ensureTimeTokens(corruptSold);
check("a corrupt SOLD holding is repaired to zero, never trusted",
  heldTimeTokens(corruptSold, "8h") === 0 && heldTimeTokens(corruptSold, "12h") === 0 && heldTimeTokens(corruptSold, "48h") === 1);
check("a healthy SOLD holding is left exactly where it was",
  (() => {
    const s = { race: "watchers", resources: {}, timeTokens: { "24h": 3 } } as unknown as GameState;
    ensureTimeTokens(s);
    return heldTimeTokens(s, "24h") === 3;
  })());
check("utcDayKey still drives the day (the token eventIds embed it)",
  /^\d{4}-\d{1,2}-\d{1,2}$/.test(utcDayKey(NOW)));

console.log(`\n=== time-tokens: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
