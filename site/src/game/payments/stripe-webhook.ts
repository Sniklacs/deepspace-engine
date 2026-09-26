// THE STRIPE WEBHOOK VERIFIER — the only thing in this codebase allowed to say
// "this purchase is real".
//
// WHAT IT PROVES. Stripe signs every webhook delivery: the `Stripe-Signature`
// header carries a timestamp `t` and one or more HMAC-SHA256 signatures `v1`,
// computed over `"{t}.{rawBody}"` with the endpoint's signing secret. Verifying
// that HMAC over the EXACT bytes that arrived is what makes the payload
// trustworthy — a JSON body re-serialised from a parsed object is NOT the same
// bytes and cannot be verified, which is why the raw body is threaded through
// every layer (serve.ts reads `await req.text()`; nothing parses first).
//
// WHY HAND-ROLLED CRYPTO AND NOT THE STRIPE SDK. The whole job is one HMAC and
// one timestamp check; the runtime (Bun, and Node ≥18) ships Web Crypto as a
// global, so an SDK would add a dependency — and an `apiVersion` to keep in step
// — for ~40 lines of standard, testable code. The signing secret is the only
// Stripe input this repo needs, and it is read from the environment, never
// committed.
//
// WHAT IT REFUSES (the failure side matters more than the happy path):
//   · no signing secret configured      → reject (never "trust it, we are only
//                                          testing" — that is how a fake grant
//                                          ships)
//   · missing / malformed / wrong secret / stale timestamp → reject
//   · any event that is not `checkout.session.completed` → ignore (2xx, so
//     Stripe stops re-delivering something we will never act on)
//   · a session that is not paid → ignore (a `completed` session can still be
//     unpaid under an async method; entitlement follows `payment_status`)
//   · an unknown SKU, an amount that disagrees with the price list, or a
//     reference that names no account → REFUSE LOUDLY (status 500 at the route:
//     money was taken and nobody was credited — a retry is harmless, silence is
//     not)
//
// This module is PURE (no node imports): the crypto is Web Crypto, and the SKU
// knowledge comes from payment-links.ts.

import { decodeAccountRef } from "./account-ref";
import {
  paymentLinkRow,
  skuForMetadataSku,
  skuForPaymentLinkId,
  skuForPriceId,
} from "./payment-links";

export const DEFAULT_TOLERANCE_SECONDS = 300;

export interface SignatureParts {
  t: number;
  v1: string[];
}

/** `t=1699999999,v1=hex,v1=hex2` → parts. Null when the header is not shape-
 *  valid (a header we cannot read is a header we cannot verify). */
export function parseSignatureHeader(header: string | null | undefined): SignatureParts | null {
  if (typeof header !== "string" || !header.trim()) return null;
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return null;
      t = Math.floor(n);
    } else if (key === "v1") {
      if (!/^[0-9a-fA-F]{8,}$/.test(value)) return null;
      v1.push(value.toLowerCase());
    }
  }
  if (t === null || v1.length === 0) return null;
  return { t, v1 };
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

/** HMAC-SHA256 over `"{t}.{rawBody}"`, hex. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

export type SignatureVerdict =
  | { ok: true; timestamp: number }
  | { ok: false; code: "missing_signature" | "invalid_signature" | "stale_timestamp"; message: string };

/** Verify the `Stripe-Signature` header against the raw body. */
export async function verifyStripeSignature(input: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret: string;
  now?: number;
  toleranceSeconds?: number;
}): Promise<SignatureVerdict> {
  const now = input.now ?? Date.now();
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const parts = parseSignatureHeader(input.signatureHeader);
  if (!parts) {
    return { ok: false, code: "missing_signature", message: "No usable Stripe-Signature header." };
  }
  // Tolerance first: a replayed capture from outside the window is refused
  // before it can reach the compare (the header's own age is not a secret).
  if (Math.abs(Math.floor(now / 1000) - parts.t) > tolerance) {
    return {
      ok: false,
      code: "stale_timestamp",
      message: `Signature timestamp is outside the ${tolerance}s tolerance.`,
    };
  }
  const expected = await hmacHex(input.secret, `${parts.t}.${input.rawBody}`);
  let matched = false;
  for (const candidate of parts.v1) if (timingSafeEqualHex(candidate, expected)) matched = true;
  if (!matched) {
    return { ok: false, code: "invalid_signature", message: "Signature does not match this endpoint's secret." };
  }
  return { ok: true, timestamp: parts.t };
}

// ---------------------------------------------------------------------------
// event → purchase
// ---------------------------------------------------------------------------

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
      mode: string;
      recognition: string;
    }
  /** Real event, deliberately not acted on: answer 2xx so Stripe stops. */
  | { kind: "ignore"; reason: string; eventId?: string; eventType?: string }
  /** We will not (or cannot) act, and a human must know: non-2xx at the route. */
  | { kind: "reject"; status: 400 | 500; code: string; message: string; eventId?: string; eventType?: string };

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Which SKU a Checkout Session is for. Three paths, most explicit first; a
 *  result that names nothing we sell is a refusal at the caller. */
export function skuForSession(session: Json): { skuId: string | null; recognition: string } {
  const metadata = asObject(session.metadata) ?? {};
  const metaSku = skuForMetadataSku(asString(metadata.sku));
  if (metaSku) return { skuId: metaSku, recognition: "metadata.sku" };

  const linkSku = skuForPaymentLinkId(asString(session.payment_link));
  if (linkSku) return { skuId: linkSku, recognition: "payment_link" };

  const lineItems = asObject(session.line_items);
  const first = Array.isArray(lineItems?.data) ? asObject((lineItems!.data as unknown[])[0]) : null;
  const priceSku = skuForPriceId(asString(asObject(first?.price)?.id));
  if (priceSku) return { skuId: priceSku, recognition: "line_items.price" };

  return { skuId: null, recognition: "none" };
}

/**
 * THE VERIFIER. Raw body + signature header + endpoint secret in; one decision
 * out. Every branch below is covered by payments-tests/payments-verify.ts.
 */
export async function verifyStripeEvent(input: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret: string | null | undefined;
  now?: number;
  toleranceSeconds?: number;
}): Promise<PurchaseDecision> {
  const now = input.now ?? Date.now();
  // FAIL CLOSED. An unconfigured endpoint verifies nothing — it must not fall
  // back to trusting the payload, and 500 (not 400) is the honest answer: we are
  // not ready to judge, and Stripe retrying later is exactly what we want.
  if (!input.secret) {
    return {
      kind: "reject",
      status: 500,
      code: "no_signing_secret",
      message: "This endpoint has no Stripe signing secret configured; nothing can be verified yet.",
    };
  }

  const verdict = await verifyStripeSignature({
    rawBody: input.rawBody,
    signatureHeader: input.signatureHeader,
    secret: input.secret,
    now,
    toleranceSeconds: input.toleranceSeconds,
  });
  if (!verdict.ok) {
    return {
      kind: "reject",
      status: 400,
      code: verdict.code,
      message: verdict.message,
    };
  }

  let event: Json | null = null;
  try {
    event = asObject(JSON.parse(input.rawBody));
  } catch {
    event = null;
  }
  if (!event) {
    return { kind: "reject", status: 400, code: "malformed_body", message: "Body is not a JSON object." };
  }

  const eventId = asString(event.id) ?? undefined;
  const eventType = asString(event.type) ?? undefined;
  // Any event type we do not sell or grant on: answer 2xx, do nothing. Stripe
  // re-delivers non-2xx for days; an event we will never act on must not.
  if (eventType !== "checkout.session.completed") {
    return { kind: "ignore", reason: "unhandled_event_type", eventId, eventType };
  }

  const session = asObject(asObject(event.data)?.object);
  if (!session || asString(session.object) === "charge") {
    return { kind: "reject", status: 400, code: "malformed_session", message: "Event carries no Checkout Session.", eventId, eventType };
  }

  // `checkout.session.completed` fires for async payment methods before the
  // money has settled; `payment_status` is the only field that means "paid".
  const paymentStatus = asString(session.payment_status) ?? "unknown";
  if (paymentStatus !== "paid") {
    return { kind: "ignore", reason: `not_paid:${paymentStatus}`, eventId, eventType };
  }

  const sessionId = asString(session.id);
  if (!sessionId) {
    return { kind: "reject", status: 400, code: "malformed_session", message: "Session has no id.", eventId, eventType };
  }

  const { skuId, recognition } = skuForSession(session);
  if (!skuId) {
    return {
      kind: "reject",
      status: 500,
      code: "unknown_sku",
      message: "This session names no SKU the game sells (set metadata.sku on the Payment Link, or fill paymentLinkId in payment-links.ts). Money was taken; grant it by hand or refund it.",
      eventId,
      eventType,
    };
  }

  const amountCents = typeof session.amount_total === "number" ? session.amount_total : -1;
  const currency = (asString(session.currency) ?? "").toLowerCase();
  const row = paymentLinkRow(skuId);
  const expectedCents = row ? Math.round(row.amountUsd * 100) : -1;
  if (amountCents !== expectedCents || currency !== "usd") {
    return {
      kind: "reject",
      status: 500,
      code: "amount_mismatch",
      message: `Session paid ${amountCents} ${currency || "?"} but ${skuId} is listed at ${expectedCents} usd. Refusing to grant the wrong pack.`,
      eventId,
      eventType,
    };
  }

  const accountRef = asString(session.client_reference_id);
  if (!accountRef || !accountRef.trim()) {
    return {
      kind: "reject",
      status: 500,
      code: "no_account_reference",
      message: "Session carries no client_reference_id — the link was opened without an account attached. Grant by hand or refund.",
      eventId,
      eventType,
    };
  }
  const accountId = decodeAccountRef(accountRef);
  if (!accountId) {
    return {
      kind: "reject",
      status: 500,
      code: "unresolvable_account_reference",
      message: "client_reference_id is not a reference this game ever writes. Grant by hand or refund.",
      eventId,
      eventType,
    };
  }

  const created = typeof event.created === "number" ? event.created * 1000 : now;
  return {
    kind: "apply",
    eventId: eventId ?? sessionId,
    eventType: eventType ?? "checkout.session.completed",
    purchaseId: sessionId,
    accountId,
    skuId,
    amountCents,
    currency,
    confirmedAt: created,
    mode: session.livemode === false ? "test" : "live",
    recognition,
  };
}
