// THE XSOLLA WEBHOOK VERIFIER — the only thing in this codebase allowed to say
// "this purchase is real".
//
// WHAT IT PROVES. Xsolla signs every webhook delivery: the `Authorization`
// header carries `Signature <sha1-hex>`, computed as the lowercase hex of
// SHA-1 over `(rawBody + project secret key)` — plain SHA-1, the key APPENDED
// after the body, NOT an HMAC. Verifying that hash over the EXACT bytes that
// arrived is what makes the payload trustworthy — a JSON body re-serialised
// from a parsed object is NOT the same bytes and cannot be verified, which is
// why the raw body is threaded through every layer (serve.ts reads
// `await req.text()`; nothing parses first).
//
// WHY HAND-ROLLED CRYPTO AND NOT AN SDK. The whole job is one SHA-1 and a
// constant-time compare; the runtime (Bun, and Node ≥18) ships Web Crypto as a
// global, so an SDK would add a dependency for ~40 lines of standard, testable
// code. The secret key is the only Xsolla input this repo needs, and it is read
// from the environment, never committed.
//
// DELIVERY MODE. Projects registered after 2025-01-22 get COMBINED webhooks:
// `user_validation`, `order_paid`, `order_canceled`. This integration targets
// combined mode (a new Publisher project lands there). Fulfillment happens ONLY
// on `order_paid`; `order_canceled` is a financial record, never a grant — we
// do not revoke paid goods automatically, and the ignore is logged.
//
// WHAT IT REFUSES (the failure side matters more than the happy path):
//   · no secret key configured                → reject 500 (fail closed — never
//                                               "trust it, we are only testing")
//   · missing / malformed / wrong signature    → reject 400
//   · malformed JSON                           → reject 400
//   · `user_validation`                       → validate_user (the ROUTE answers:
//                                               204 if the account exists, 400
//                                               INVALID_USER if not — Xsolla
//                                               sends this several times per
//                                               payment and blocks the pay flow
//                                               on a non-2xx)
//   · `order_paid` that is not exactly one item, names an unknown SKU, is not
//     USD, or whose amount disagrees with the catalog tripwire → reject 500
//     (money moved and nobody can be credited correctly — a retry is harmless,
//     silence is not)
//   · an order whose user reference names no account → reject 500 (same reason)
//   · any other notification type               → ignore (2xx, so Xsolla stops
//                                               re-delivering what we never act on)
//
// SANDBOX. `order.mode === "sandbox"` (or a dry-run transaction) is recorded as
// mode "test" and still applied — the owner's own test purchases must exercise
// the real grant path, and the grant is idempotent by transaction id.
//
// This module is PURE (no node imports): the crypto is Web Crypto, and the SKU
// knowledge comes from xsolla-catalog.ts.

import { decodeAccountRef } from "./account-ref";
import { xsollaCatalogRow, skuForXsollaSku } from "./xsolla-catalog";

export type PurchaseDecision =
  /** Verified and mapped: grant it. */
  | {
      kind: "apply";
      eventId: string;
      eventType: string;
      purchaseId: string;
      accountId: string;
      skuId: string;
      amountCents: number;
      currency: string;
      confirmedAt: number;
      mode: "live" | "test";
      recognition: string;
    }
  /** Xsolla is asking "does this user exist": the route answers from the store. */
  | { kind: "validate_user"; userRef: string; eventId?: string; eventType?: string }
  /** Real event, deliberately not acted on: answer 2xx so Xsolla stops. */
  | { kind: "ignore"; reason: string; eventId?: string; eventType?: string }
  /** We will not (or cannot) act, and a human must know: 4xx/5xx at the route. */
  | { kind: "reject"; status: 400 | 500; code: string; message: string; eventId?: string; eventType?: string };

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Length-independent, branch-free comparison — no early exit on the first
 *  differing byte (a timing signal on a signature check is a real one). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** SHA-1 over (rawBody + secretKey), lowercase hex. Plain hash, NOT HMAC —
 *  that is Xsolla's scheme (key appended after the body). */
export async function xsollaSignatureHex(rawBody: string, secretKey: string): Promise<string> {
  const data = new TextEncoder().encode(rawBody + secretKey);
  return toHex(await crypto.subtle.digest("SHA-1", data));
}

/** `Signature <40 hex>` → the hex, lowercased. Null when the header is not
 *  shape-valid (a header we cannot read is a header we cannot verify). */
export function parseSignatureHeader(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const m = header.trim().match(/^Signature\s+([0-9a-fA-F]{40})$/);
  return m ? m[1].toLowerCase() : null;
}

export type SignatureVerdict =
  | { ok: true }
  | { ok: false; code: "missing_signature" | "invalid_signature"; message: string };

/** Verify the `Authorization: Signature …` header against the raw body. */
export async function verifyXsollaSignature(input: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret: string;
}): Promise<SignatureVerdict> {
  const provided = parseSignatureHeader(input.signatureHeader);
  if (!provided) {
    return { ok: false, code: "missing_signature", message: "No usable Authorization: Signature header." };
  }
  const expected = await xsollaSignatureHex(input.rawBody, input.secret);
  if (!timingSafeEqualHex(provided, expected)) {
    return { ok: false, code: "invalid_signature", message: "Signature does not match this endpoint's secret key." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// event → purchase
// ---------------------------------------------------------------------------

/** `"9.99"` → 999. Null on anything not shaped like a plain decimal amount. */
function amountStringToCents(s: string): number | null {
  const t = s.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

/** The user reference Xsolla echoes. Combined-mode `order_paid` carries it as
 *  `user.external_id`; `user_validation` carries it flat as `user.id`; the
 *  token request also stamps it into `custom_parameters.dse_account_ref` as a
 *  backstop. First hit wins; all three are the value we sent. */
function userRefOf(body: Json): string | null {
  const user = asObject(body.user);
  const custom = asObject(body.custom_parameters);
  return (
    asString(user?.external_id) ??
    asString(user?.id) ??
    asString(custom?.dse_account_ref) ??
    null
  );
}

/**
 * THE VERIFIER. Raw body + signature header + secret key in; one decision out.
 * Every branch below is covered by payments-tests/payments-verify.ts.
 */
export async function verifyXsollaEvent(input: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret: string | null | undefined;
  now?: number;
}): Promise<PurchaseDecision> {
  const now = input.now ?? Date.now();
  // FAIL CLOSED. An unconfigured endpoint verifies nothing — it must not fall
  // back to trusting the payload, and 500 (not 400) is the honest answer: we are
  // not ready to judge, and Xsolla retrying later is exactly what we want.
  if (!input.secret) {
    return {
      kind: "reject",
      status: 500,
      code: "no_secret_key",
      message: "This endpoint has no Xsolla secret key configured; nothing can be verified yet.",
    };
  }

  const verdict = await verifyXsollaSignature({
    rawBody: input.rawBody,
    signatureHeader: input.signatureHeader,
    secret: input.secret,
  });
  if (!verdict.ok) {
    return { kind: "reject", status: 400, code: verdict.code, message: verdict.message };
  }

  let body: Json | null = null;
  try {
    body = asObject(JSON.parse(input.rawBody));
  } catch {
    body = null;
  }
  if (!body) {
    return { kind: "reject", status: 400, code: "malformed_body", message: "Body is not a JSON object." };
  }

  const eventType = asString(body.notification_type) ?? undefined;
  const eventId =
    asString(asObject(body.billing)?.transaction ? String((asObject(body.billing)!.transaction as Json).id) : null) ??
    (typeof asObject(body.order)?.id === "number" ? String((asObject(body.order)!.id as number)) : null) ??
    undefined;

  // Xsolla asks "does this user exist" several times per payment, and blocks
  // the pay flow until we answer 2xx. The route does the store lookup.
  if (eventType === "user_validation") {
    const ref = userRefOf(body);
    if (!ref) {
      return { kind: "reject", status: 400, code: "no_user", message: "user_validation carries no user id.", eventId, eventType };
    }
    return { kind: "validate_user", userRef: ref, eventId, eventType };
  }

  // Anything that is not a paid order is a financial record or a lifecycle
  // event we never fulfill on: answer 2xx and move on. (Separate-mode `payment`
  // / `refund` would only arrive for a pre-2025 project; this integration runs
  // combined mode, where order_paid already includes the payment.)
  if (eventType !== "order_paid") {
    return { kind: "ignore", reason: eventType ? `unhandled_notification:${eventType}` : "missing_notification_type", eventId, eventType };
  }

  // ---- order_paid: the one event that grants ----
  const items = Array.isArray(body.items) ? body.items.map(asObject) : [];
  if (items.length !== 1 || !items[0]) {
    return {
      kind: "reject",
      status: 500,
      code: "unexpected_items",
      message: `order_paid must carry exactly one item; got ${items.length}. A human must look at this order.`,
      eventId,
      eventType,
    };
  }
  const orderSku = asString(items[0]!.sku);
  const skuId = skuForXsollaSku(orderSku);
  if (!skuId) {
    return {
      kind: "reject",
      status: 500,
      code: "unknown_sku",
      message: `This order names no SKU the game sells (items[0].sku=${JSON.stringify(orderSku)}). Money was taken; grant it by hand or refund it.`,
      eventId,
      eventType,
    };
  }

  const order = asObject(body.order) ?? {};
  const billing = asObject(body.billing) ?? {};
  const transaction = asObject(billing.transaction) ?? {};
  const billingPurchase = asObject(billing.purchase) ?? {};
  const billingTotal = asObject(billingPurchase.total) ?? {};

  const currency = (asString(order.currency) ?? "").toLowerCase();
  if (currency !== "usd") {
    return {
      kind: "reject",
      status: 500,
      code: "unexpected_currency",
      message: `Order is in ${JSON.stringify(currency || "?")}, not usd. The catalog tripwire is USD-only; grant by hand or refund.`,
      eventId,
      eventType,
    };
  }

  // The amount tripwire: what Xsolla says was paid must equal the catalog row,
  // to the cent. `order.amount` is the string form ("9.99"); the billing total
  // is the numeric backstop.
  const row = xsollaCatalogRow(skuId)!;
  const expectedCents = Math.round(row.amountUsd * 100);
  const orderAmountStr = asString(order.amount);
  const billingAmountNum = typeof billingTotal.amount === "number" ? billingTotal.amount : null;
  const paidCents =
    (orderAmountStr !== null ? amountStringToCents(orderAmountStr) : null) ??
    (billingAmountNum !== null ? Math.round(billingAmountNum * 100) : null);
  if (paidCents === null || paidCents !== expectedCents) {
    return {
      kind: "reject",
      status: 500,
      code: "amount_mismatch",
      message: `Order paid ${paidCents ?? "?"} cents but ${skuId} is listed at ${expectedCents} usd cents. Refusing to grant the wrong pack.`,
      eventId,
      eventType,
    };
  }

  const ref = userRefOf(body);
  const accountId = decodeAccountRef(ref);
  if (!accountId) {
    return {
      kind: "reject",
      status: 500,
      code: "unresolvable_user",
      message: "The order's user reference is not a reference this game ever writes. Grant by hand or refund.",
      eventId,
      eventType,
    };
  }

  const txId =
    (typeof transaction.id === "number" || typeof transaction.id === "string" ? String(transaction.id) : null) ??
    asString(order.invoice_id) ??
    (typeof order.id === "number" ? String(order.id) : null);
  if (!txId) {
    return {
      kind: "reject",
      status: 500,
      code: "no_transaction_id",
      message: "order_paid carries no transaction id — idempotency is impossible. Grant by hand.",
      eventId,
      eventType,
    };
  }

  const sandbox =
    asString(order.mode) === "sandbox" || transaction.dry_run === 1 || transaction.dry_run === true;
  const paymentDate = asString(transaction.payment_date);
  const confirmedAt = paymentDate ? Date.parse(paymentDate) : NaN;

  return {
    kind: "apply",
    eventId: eventId ?? txId,
    eventType: "order_paid",
    purchaseId: txId,
    accountId,
    skuId,
    amountCents: paidCents,
    currency: "usd",
    confirmedAt: Number.isFinite(confirmedAt) ? confirmedAt : now,
    mode: sandbox ? "test" : "live",
    recognition: "items[0].sku",
  };
}
