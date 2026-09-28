// THE PAYMENT LINKS — THE ONE FILE THE OWNER (OR THE LEAD) FILLS WITH REAL URLs.
//
// Mechanism (decided, not up for redesign): Stripe PAYMENT LINKS, one per SKU,
// created in the Stripe dashboard by whoever holds the Stripe account. The game
// never calls the Stripe API — it only OPENS a link — so no secret key is needed
// in this environment, and no Stripe SDK is added. What the game must know is:
//
//   1. which SKU a link sells (`url` is the only mandatory column), and
//   2. how to recognise the link again in the webhook, so a paid session can be
//      mapped back to the SKU we are allowed to grant.
//
// Recognition, in the order the verifier tries it (see stripe-webhook.ts):
//   · `metadata.sku` on the Payment Link / session  ← RECOMMENDED, exact
//   · `payment_link` id (`plink_…`)                 ← `paymentLinkId`
//   · `price` id (`price_…`)                        ← `priceId`
//   · `price.product` id (`prod_…`)                 ← `productId`
// At least one of the four must resolve, or the webhook refuses to grant and
// says so loudly (status 500 — see webhook-route.ts). A price the game cannot
// name is money taken for nothing, and silence there is the one failure mode we
// refuse to ship.
//
// WIRED 2026-09-27 — the ids below are LIVE objects on the team's Stripe
// account, created by the lead under the owner's go-ahead, verbatim: "Yes go
// ahead and put the links in for the store". The seven packs/kits have `url`s;
// THE SIX TIME TOKENS DO NOT, and that is deliberate (see the token block below).
//
// EMPTY `url` = NOT SOLD. The storefront does not render a buy control for a SKU
// with no link, and NEVER presents an unlinked SKU as purchasable. `url` is also
// the only thing `isSellable()` reads, so a SKU can carry every Stripe id it has
// and still be un-buyable — which is exactly the state the six tokens are in.
//
// `amountUsd` is a TRIPWIRE, not a second price list: the verifier refuses a
// session whose `amount_total` disagrees with it, which is how a wrong link on
// the wrong card (a $4.99 link granting the $39.99 pack) becomes a loud failure
// instead of a quiet gift. A test pins every row against the game's own
// catalogue (monetization.ts) so the two cannot drift — including the six
// time-token rows, whose price is the owner's `TIME_TOKEN_PACKS[*].priceUsd`.
//
// This module is PURE (no node imports) — storefront-tests and the unit tests
// import it directly, and the client uses it to build the checkout URL.

import { ACCOUNT_REF_PREFIX, encodeAccountRef } from "./account-ref";

export interface PaymentLinkRow {
  /** The game's own SKU id — the key `applyExternalPurchase()` grants by. */
  skuId: string;
  /** The Stripe Payment Link URL. "" = not sold yet (no buy control renders). */
  url: string;
  /** `plink_…` as shown in the Stripe dashboard for that link (optional). */
  paymentLinkId: string;
  /** The `price_…` behind the link (optional; the fallback recognition path). */
  priceId: string;
  /** What Stripe charges, in USD — the tripwire described above. */
  amountUsd: number;
  /** The `prod_…` behind the price (optional). A session's line items carry it
   *  as `price.product`, and it is the ONE id a time-token sale can be
   *  recognised by that the token catalogue itself also holds: monetization.ts
   *  reads this column for `TIME_TOKEN_PACKS[*].providerSkuId`, so the product
   *  id is written once, here. */
  productId?: string;
}

/** The Stripe catalogue the game RECOGNISES: seven sellable SKUs with live
 *  Payment Links, plus the six time tokens, whose ids are live but whose `url` is
 *  deliberately empty because no token has a purchase surface yet.
 *
 *  LIVE STRIPE CATALOGUE (created 2026-09-26, links created 2026-09-27, live
 *  mode; every id read back from the Stripe API by the lead — the authoritative
 *  table is /home/team/shared/store-wiring-table-2026-09-27.md):
 *    seven with links: votive-small $4.99 · votive-steady $9.99 · votive-grand
 *              $19.99 · votive-circuit $39.99 · scavengers-kit $4.99
 *              expeditionary-kit $9.99 · long-haul-cart $12.99
 *    six tokens, ids only: 30m $2.99 · 1h $3.99 · 8h $7.99 · 12h $9.99
 *              24h $14.99 · 48h $24.99
 */
export const PAYMENT_LINKS: PaymentLinkRow[] = [
  // ---- Votive packs (Cradle Ledger, monetization.ts §2.3) ----
  { skuId: "votive-small", url: "https://buy.stripe.com/8x2fZh7xQeMh7Mp8CLdjO05", paymentLinkId: "plink_1UKLG4DzrKy7FKhapupfUGDf", priceId: "price_1UJotkDzrKy7FKha0fWNgYvJ", amountUsd: 4.99, productId: "prod_VKTrjjhpXSi6qn" },
  { skuId: "votive-steady", url: "https://buy.stripe.com/00weVd5pIdId8Qt5qzdjO06", paymentLinkId: "plink_1UKLG4DzrKy7FKhaXldk4bHc", priceId: "price_1UJotpDzrKy7FKhafuXbHXAr", amountUsd: 9.99, productId: "prod_VKTrkuulYgooOd" },
  { skuId: "votive-grand", url: "https://buy.stripe.com/aFa3cvdWe33z4Ad9GPdjO07", paymentLinkId: "plink_1UKLG5DzrKy7FKhawNis22AZ", priceId: "price_1UJotpDzrKy7FKhakvHCijDn", amountUsd: 19.99, productId: "prod_VKTrf2L5vh0KO6" },
  { skuId: "votive-circuit", url: "https://buy.stripe.com/eVq28r19s1Zv7Mpg5ddjO08", paymentLinkId: "plink_1UKLG5DzrKy7FKhaQQXbfMuo", priceId: "price_1UJotpDzrKy7FKhaAJu1OxpW", amountUsd: 39.99, productId: "prod_VKTr428aD677Vx" },
  // ---- Head-start packs (monetization.ts §3) ----
  { skuId: "scavengers-kit", url: "https://buy.stripe.com/eVq9ATdWegUp8Qt9GPdjO09", paymentLinkId: "plink_1UKLG5DzrKy7FKhatEb3qHnW", priceId: "price_1UJottDzrKy7FKha7v2B03Oz", amountUsd: 4.99, productId: "prod_VKTrbrWIfy9RBX" },
  { skuId: "expeditionary-kit", url: "https://buy.stripe.com/fZu5kD7xQ7jP6IldX5djO0a", paymentLinkId: "plink_1UKLG6DzrKy7FKhaBvZzCuRV", priceId: "price_1UJottDzrKy7FKhad2b6DKFE", amountUsd: 9.99, productId: "prod_VKTrTHva3d6gsZ" },
  { skuId: "long-haul-cart", url: "https://buy.stripe.com/5kQ28r05o33z6IldX5djO0b", paymentLinkId: "plink_1UKLG6DzrKy7FKhaSJOY1AsQ", priceId: "price_1UJottDzrKy7FKhaGrx5qItD", amountUsd: 12.99, productId: "prod_VKTroUkggNJqbn" },
  // ---- The six sellable TIME TOKENS (monetization.ts TIME_TOKEN_PACKS) ----
  //
  // A token row is HERE for one reason: RECOGNITION. A paid token session must
  // map back to `time-token-8h` so the webhook can grant it — and without these
  // rows `skuForSession()` resolved to null and answered 500 `unknown_sku`,
  // i.e. money taken and nothing granted.
  //
  // `url` IS EMPTY ON PURPOSE, and it is the honest state of the build: the six
  // live Payment Link URLs exist in Stripe (rows 8–13 of the wiring table) but
  // NO PLAYER-FACING DOMAIN FOR A TOKEN EXISTS YET, so the game does not offer
  // one. Storing the URL here would make `isSellable()` true for a size whose
  // card nothing renders — an id "wired" into a surface that is not there.
  // When the token shop lands, its row gets its `url` and the size becomes
  // buyable with no other change to this file.
  { skuId: "time-token-30m", url: "", paymentLinkId: "plink_1UKLGMDzrKy7FKhajAtBOtQA", priceId: "price_1UKLFuDzrKy7FKhaYGrKPc6v", amountUsd: 2.99, productId: "prod_VL1IlrKotjeEc8" },
  { skuId: "time-token-1h", url: "", paymentLinkId: "plink_1UKLGMDzrKy7FKhauB7BViAm", priceId: "price_1UKLFuDzrKy7FKha0Gn7s9jl", amountUsd: 3.99, productId: "prod_VL1I6RcBYf9ip1" },
  { skuId: "time-token-8h", url: "", paymentLinkId: "plink_1UKLGMDzrKy7FKhaeU3rkft9", priceId: "price_1UKLFuDzrKy7FKhaCaw7m7Oc", amountUsd: 7.99, productId: "prod_VL1IhfQkbh15q2" },
  { skuId: "time-token-12h", url: "", paymentLinkId: "plink_1UKLGLDzrKy7FKhaKqPENQCX", priceId: "price_1UKLFtDzrKy7FKhaxFFoV8nC", amountUsd: 9.99, productId: "prod_VL1IEaKNpi2sXz" },
  { skuId: "time-token-24h", url: "", paymentLinkId: "plink_1UKLGLDzrKy7FKhakJxG5pqr", priceId: "price_1UKLFtDzrKy7FKhavcYIkj0V", amountUsd: 14.99, productId: "prod_VL1IvxuGGlgwN2" },
  { skuId: "time-token-48h", url: "", paymentLinkId: "plink_1UKLGLDzrKy7FKhaDk8UMFvU", priceId: "price_1UKLFtDzrKy7FKhao41jV0nY", amountUsd: 24.99, productId: "prod_VL1IdZr899TCNt" },
];

/** Where Stripe sends the player back to. The `{CHECKOUT_SESSION_ID}` token MUST
 *  survive this template byte for byte — Stripe replaces it on redirect. */
export const STORE_RETURN_PATH = "/play";
export const STORE_RETURN_SKU_PARAM = "sku";

/** The exact `after_completion` redirect to paste into each Payment Link, with
 *  that link's own SKU filled in. The browser re-opens the Cradle Ledger in a
 *  "confirming your purchase" state; nothing is granted by the return itself. */
export function afterCompletionUrl(origin: string, skuId: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}${STORE_RETURN_PATH}?purchase=return&${STORE_RETURN_SKU_PARAM}=${encodeURIComponent(skuId)}&session_id={CHECKOUT_SESSION_ID}`;
}

/** How the game asks Stripe "who is this session for" (the query parameter the
 *  click appends, and the field the webhook reads back). */
export const ACCOUNT_REF_PARAM = "client_reference_id";

export function paymentLinkRow(skuId: string): PaymentLinkRow | null {
  return PAYMENT_LINKS.find((r) => r.skuId === skuId) ?? null;
}

/** A SKU is sellable ONLY when its link is configured. Note what this does NOT
 *  read: the ids. A row may carry a live product, price and link id and still be
 *  un-buyable — that is the six tokens' state, and it is the rule that keeps
 *  "wired into the catalogue" from meaning "offered to the player". */
export function isSellable(skuId: string): boolean {
  const row = paymentLinkRow(skuId);
  return !!row && isHttpUrl(row.url);
}

export function isHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** The checkout URL for a signed-in account: the link with the account attached.
 *  Returns null when the SKU has no link (never a bare URL that would take money
 *  for nobody) or the account id is unusable. */
export function checkoutUrl(skuId: string, accountId: string | null | undefined): string | null {
  const row = paymentLinkRow(skuId);
  if (!row || !isHttpUrl(row.url)) return null;
  if (typeof accountId !== "string" || accountId.trim().length < 2) return null;
  const u = new URL(row.url);
  u.searchParams.set(ACCOUNT_REF_PARAM, encodeAccountRef(accountId));
  return u.toString();
}

/** The four recognition paths, used by the verifier. Exact match on the ids
 *  Stripe puts on the session; unknown values resolve to null. */
export function skuForPaymentLinkId(paymentLinkId: string | null | undefined): string | null {
  if (!paymentLinkId) return null;
  return PAYMENT_LINKS.find((r) => r.paymentLinkId && r.paymentLinkId === paymentLinkId)?.skuId ?? null;
}

export function skuForPriceId(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  return PAYMENT_LINKS.find((r) => r.priceId && r.priceId === priceId)?.skuId ?? null;
}

/** The PRODUCT-id path — the last resort, and the one that also covers the six
 *  time tokens: a session's `line_items[].price.product` names the product, and
 *  a product id we do not sell resolves to null (never to a guess). */
export function skuForProductId(productId: string | null | undefined): string | null {
  if (!productId) return null;
  return PAYMENT_LINKS.find((r) => r.productId && r.productId === productId)?.skuId ?? null;
}

/** The SKU named by a session's metadata, but ONLY if we actually sell it. An
 *  unknown metadata value is a wiring error, never a grant. */
export function skuForMetadataSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  return PAYMENT_LINKS.some((r) => r.skuId === sku) ? sku : null;
}

/** Every SKU that currently has a buyable link — the storefront's allow-list.
 *  Empty of tokens today: their rows carry ids and no url. */
export function sellableSkus(): string[] {
  return PAYMENT_LINKS.filter((r) => isHttpUrl(r.url)).map((r) => r.skuId);
}

/** The `prod_…` behind a SKU — what `TIME_TOKEN_PACKS[*].providerSkuId` is filled
 *  from, so the product id is written ONCE. Throws on a SKU with no product id:
 *  a catalogue row pointing at a token we have no Stripe object for is a wiring
 *  fault that must fail at load, not a silent "" that quietly disables a sale. */
export function productIdForSku(skuId: string): string {
  const row = paymentLinkRow(skuId);
  if (!row?.productId) {
    throw new Error(`payment-links.ts: no Stripe product id is wired for "${skuId}" — the catalogue cannot name what it sells.`);
  }
  return row.productId;
}

/** The account reference is recognisable at a glance in a Stripe dashboard. */
export function isAccountRef(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ACCOUNT_REF_PREFIX);
}
