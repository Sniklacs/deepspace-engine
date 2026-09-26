// THE REAL PAYMENT PROVIDER — the object `createPaymentProvider()` now returns.
//
// It speaks the existing `PaymentProvider` interface (monetization.ts §7.3), so
// nothing downstream changed shape when the stub was retired: the same
// `verifyWebhook()` call now performs real signature verification, and it has no
// "simulate" switch to fall back on.
//
// WHAT IT DELIBERATELY DOES NOT DO:
//   · createIntent() — this integration opens a Payment Link the owner created
//     in the Stripe dashboard; the game never mints a Checkout Session, so no
//     secret API key exists in the deployment at all. The honest answer is a
//     refusal, not a pretend intent id.
//   · refund() — refunds are issued in the Stripe dashboard by the account
//     holder. A game endpoint that could move money back would be a second way
//     to move money, and it is not needed to sell anything.
//
// This module is PURE (type-only import of the interface + Web Crypto inside the
// verifier), so it can be unit-tested without a server and without a network.

import type { PaymentProvider, VerifiedPurchase } from "../monetization";
import { verifyStripeEvent } from "./stripe-webhook";

export interface StripeProviderOptions {
  /** The endpoint's signing secret (`whsec_…`). Absent = nothing verifies. */
  signingSecret?: string | null;
  /** Clock injection for tests; production passes nothing. */
  now?: () => number;
  toleranceSeconds?: number;
}

export const STRIPE_PROVIDER_NAME = "StripePaymentProvider";

export function createStripePaymentProvider(options: StripeProviderOptions = {}): PaymentProvider {
  const secret = options.signingSecret ?? null;
  return {
    name: STRIPE_PROVIDER_NAME,

    async createIntent() {
      console.log("[PaymentProvider#createIntent] Stripe Payment Links are created in the Stripe dashboard; the game only opens them.");
      return {
        ok: false,
        error: "This integration opens owner-created Stripe Payment Links; it does not create Checkout Sessions.",
      };
    },

    async verifyWebhook(payload: unknown) {
      const p = (payload ?? {}) as { rawBody?: unknown; signatureHeader?: unknown };
      const rawBody = typeof p.rawBody === "string" ? p.rawBody : null;
      if (rawBody === null) {
        return {
          ok: false,
          error: "A Stripe webhook is verified over its RAW body — pass { rawBody, signatureHeader }.",
        };
      }
      const decision = await verifyStripeEvent({
        rawBody,
        signatureHeader: typeof p.signatureHeader === "string" ? p.signatureHeader : null,
        secret,
        now: options.now?.(),
        toleranceSeconds: options.toleranceSeconds,
      });
      if (decision.kind === "reject") return { ok: false, error: `${decision.code}: ${decision.message}` };
      if (decision.kind === "ignore") return { ok: false, error: `ignored: ${decision.reason}` };
      const purchase: VerifiedPurchase = {
        purchaseId: decision.purchaseId,
        accountId: decision.accountId,
        skuId: decision.skuId,
        idempotencyKey: decision.eventId,
        confirmedAt: decision.confirmedAt,
        amountCents: decision.amountCents,
        currency: decision.currency,
      };
      return { ok: true, purchase };
    },

    async refund(opts) {
      console.log(`[PaymentProvider#refund] refunds are issued in the Stripe dashboard. purchase=${opts.purchaseId} reason=${opts.reason}`);
      return { ok: false, error: "Refunds are issued in the Stripe dashboard, not from the game." };
    },
  };
}
