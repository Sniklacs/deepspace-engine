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
//   · `payment_link` id (`pl_…`)                    ← fill `paymentLinkId`
//   · `price` id (`price_…`)                        ← fill `priceId`
// At least one of the three must resolve, or the webhook refuses to grant and
// says so loudly (status 500 — see webhook-route.ts). A price the game cannot
// name is money taken for nothing, and silence there is the one failure mode we
// refuse to ship.
//
// EMPTY `url` = NOT SOLD. The storefront does not render a buy control for a SKU
// with no link, and NEVER presents an unlinked SKU as purchasable.
//
// `amountUsd` is a TRIPWIRE, not a second price list: the verifier refuses a
// session whose `amount_total` disagrees with it, which is how a wrong link on
// the wrong card (a $4.99 link granting the $39.99 pack) becomes a loud failure
// instead of a quiet gift. A test pins every row against the game's own
// catalogue (monetization.ts) so the two cannot drift.
//
// This module is PURE (no node imports) — storefront-tests and the unit tests
// import it directly, and the client uses it to build the checkout URL.

import { ACCOUNT_REF_PREFIX, encodeAccountRef } from "./account-ref";

export interface PaymentLinkRow {
  /** The game's own SKU id — the key `applyExternalPurchase()` grants by. */
  skuId: string;
  /** The Stripe Payment Link URL. "" = not sold yet (no buy control renders). */
  url: string;
  /** `pl_…` as shown in the Stripe dashboard for that link (optional). */
  paymentLinkId: string;
  /** The `price_…` behind the link (optional; the fallback recognition path). */
  priceId: string;
  /** What Stripe charges, in USD — the tripwire described above. */
  amountUsd: number;
}

/** The sellable catalogue. FILL THE `url` COLUMN — nothing else is required to
 *  go live, and the two optional id columns only add recognition paths.
 *
 *  LIVE STRIPE CATALOGUE (created 2026-09-26, live mode, prices match the game's
 *  own code — the Stripe product ids are the `skuId`s below):
 *    invoiced: votive-small $4.99 · votive-steady $9.99 · votive-grand $19.99
 *              votive-circuit $39.99 · scavengers-kit $4.99
 *              expeditionary-kit $9.99 · long-haul-cart $12.99
 */
export const PAYMENT_LINKS: PaymentLinkRow[] = [
  // ---- Votive packs (Cradle Ledger, monetization.ts §2.3) ----
  { skuId: "votive-small", url: "", paymentLinkId: "", priceId: "", amountUsd: 4.99 },
  { skuId: "votive-steady", url: "", paymentLinkId: "", priceId: "", amountUsd: 9.99 },
  { skuId: "votive-grand", url: "", paymentLinkId: "", priceId: "", amountUsd: 19.99 },
  { skuId: "votive-circuit", url: "", paymentLinkId: "", priceId: "", amountUsd: 39.99 },
  // ---- Head-start packs (monetization.ts §3) ----
  { skuId: "scavengers-kit", url: "", paymentLinkId: "", priceId: "", amountUsd: 4.99 },
  { skuId: "expeditionary-kit", url: "", paymentLinkId: "", priceId: "", amountUsd: 9.99 },
  { skuId: "long-haul-cart", url: "", paymentLinkId: "", priceId: "", amountUsd: 12.99 },
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

/** A SKU is sellable ONLY when its link is configured. */
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

/** The three recognition paths, used by the verifier. Exact match on the ids
 *  Stripe puts on the session; unknown values resolve to null. */
export function skuForPaymentLinkId(paymentLinkId: string | null | undefined): string | null {
  if (!paymentLinkId) return null;
  return PAYMENT_LINKS.find((r) => r.paymentLinkId && r.paymentLinkId === paymentLinkId)?.skuId ?? null;
}

export function skuForPriceId(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  return PAYMENT_LINKS.find((r) => r.priceId && r.priceId === priceId)?.skuId ?? null;
}

/** The SKU named by a session's metadata, but ONLY if we actually sell it. An
 *  unknown metadata value is a wiring error, never a grant. */
export function skuForMetadataSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  return PAYMENT_LINKS.some((r) => r.skuId === sku) ? sku : null;
}

/** Every SKU that currently has a buyable link — the storefront's allow-list. */
export function sellableSkus(): string[] {
  return PAYMENT_LINKS.filter((r) => isHttpUrl(r.url)).map((r) => r.skuId);
}

/** The account reference is recognisable at a glance in a Stripe dashboard. */
export function isAccountRef(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ACCOUNT_REF_PREFIX);
}
