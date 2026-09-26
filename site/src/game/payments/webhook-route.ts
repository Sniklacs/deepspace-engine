// THE WEBHOOK ROUTE'S SERVER SIDE — verify, resolve the payer, grant, persist.
//
// This is the ONLY place a real purchase becomes an entitlement. The verifier
// (stripe-webhook.ts) decides what the payload MEANS; this module is the part
// that touches the account store, and it is deliberately the thinnest possible
// layer between them.
//
// WHO CALLS IT. `serve.ts` (the production server the platform publishes) and
// the Vite dev-server middleware in `vite.config.ts`, both on the same path
// constant. TanStack Start 1.158's route files render HTML for the app shell;
// they are not the seam this route wants, because it must read the UNPARSED
// request body (the signature is over the exact bytes) and must answer with
// status codes rather than a page. Wiring both servers to one handler means the
// dev host and the live host behave identically, which is the only way a Stripe
// delivery can be tested before it matters.
//
// STATUS CODES (what makes Stripe retry, and what it means):
//   2xx — nothing is owed any more: the grant landed, or the event is one we
//         will never act on (another event type, or a session that is not paid).
//         Stripe stops re-delivering, which is correct in both cases.
//   400 — a request that cannot have come from Stripe (no / bad / stale
//         signature, malformed JSON). We refuse to look at it. Visible in the
//         Stripe dashboard's delivery log, and replayable from there if the
//         cause was a rotated secret on our side.
//   500 — WE OWE A GRANT AND COULD NOT MAKE IT: no signing secret configured,
//         an unknown SKU, an amount that disagrees with the price list, a
//         reference that names nobody, an account with no colony, or a refused
//         grant. Retryable and harmless (the grant is idempotent by session id)
//         and LOUD — which is the point: quiet money is the failure we cannot
//         accept. Nothing here is ever swallowed.
//
// SERVER-ONLY: this module imports the store (Postgres or the fs fallback).
// Nothing client-side may import it; `payments-tests` asserts that.

import { applyExternalPurchase } from "../monetization";
import { loadAccountSaves, loadAccounts, saveAccountSaves } from "../store";
import { verifyStripeEvent } from "./stripe-webhook";

/** The one path both servers answer on. `vite.config.ts` repeats this literal
 *  (the config cannot import this module at load time); payments-tests pins the
 *  two to each other so they cannot drift. */
export const STRIPE_WEBHOOK_PATH = "/api/dse-stripe-webhook";

/** The endpoint's signing secret, read from the environment at call time. */
export const STRIPE_WEBHOOK_SECRET_ENV = "STRIPE_WEBHOOK_SECRET";

export interface WebhookHttpResult {
  status: number;
  body: Record<string, unknown>;
}

export function readWebhookSecret(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env[STRIPE_WEBHOOK_SECRET_ENV];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * Handle one delivery. Never throws: an unexpected store failure becomes a 500
 * (Stripe retries), never a 200 (which would mean "already handled" for a
 * purchase nobody received).
 */
export async function handleStripeWebhookRequest(input: {
  rawBody: string;
  signatureHeader: string | null;
  now?: number;
  /** Test seam; production passes nothing and the env var is read. */
  secret?: string | null;
}): Promise<WebhookHttpResult> {
  const now = input.now ?? Date.now();
  const secret = input.secret !== undefined ? input.secret : readWebhookSecret();

  let decision;
  try {
    decision = await verifyStripeEvent({
      rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
      secret,
      now,
    });
  } catch (err) {
    console.error(`[stripe-webhook] verification threw: ${(err as Error)?.message ?? err}`);
    return { status: 500, body: { ok: false, error: "verification_failed" } };
  }

  if (decision.kind === "ignore") {
    console.log(`[stripe-webhook] ignored (${decision.reason}) type=${decision.eventType ?? "?"} event=${decision.eventId ?? "?"}`);
    return {
      status: 200,
      body: { ok: true, ignored: decision.reason, eventType: decision.eventType ?? null },
    };
  }

  if (decision.kind === "reject") {
    console.warn(
      `[stripe-webhook] REFUSED ${decision.code} (${decision.status}) event=${decision.eventId ?? "?"}: ${decision.message}`,
    );
    return {
      status: decision.status,
      body: { ok: false, error: decision.code, message: decision.message, eventId: decision.eventId ?? null },
    };
  }

  try {
    // 1) The account must exist. A reference that decodes cleanly but names no
    //    account is a mis-built link, not a customer we can credit.
    const accounts = await loadAccounts();
    if (!accounts[decision.accountId]) {
      console.warn(`[stripe-webhook] REFUSED unknown_account for ref event=${decision.eventId}`);
      return {
        status: 500,
        body: {
          ok: false,
          error: "unknown_account",
          message: "client_reference_id names no account on this server. Grant by hand or refund.",
        },
      };
    }

    // 2) The grant lands in the account's ACTIVE colony — the same game the
    //    player was looking at when they clicked. A purchase is never applied to
    //    a colony they cannot see.
    const saves = await loadAccountSaves(decision.accountId);
    const activeGameId = saves?.activeGameId ?? null;
    if (!saves || !activeGameId || !saves.games[activeGameId]) {
      console.warn(`[stripe-webhook] REFUSED no_active_colony account=${decision.accountId} event=${decision.eventId}`);
      return {
        status: 500,
        body: {
          ok: false,
          error: "no_active_colony",
          message: "This account has no active colony to credit. Start one (this retries), or grant by hand.",
        },
      };
    }

    // 3) Apply. Idempotent by session id: a re-delivered event cannot double-grant.
    const applied = applyExternalPurchase(
      saves.games[activeGameId],
      { purchaseId: decision.purchaseId, skuId: decision.skuId, confirmedAt: decision.confirmedAt },
      now,
    );
    if (!applied.ok) {
      console.error(`[stripe-webhook] apply_failed sku=${decision.skuId} event=${decision.eventId}: ${applied.error}`);
      return {
        status: 500,
        body: { ok: false, error: "apply_failed", message: applied.error ?? "The purchase could not be applied." },
      };
    }
    saves.games[activeGameId] = applied.state;
    await saveAccountSaves(decision.accountId, saves);

    console.log(
      `[stripe-webhook] applied sku=${decision.skuId} cents=${decision.amountCents} via=${decision.recognition} mode=${decision.mode} idempotent=${!!applied.idempotent} event=${decision.eventId}`,
    );
    return {
      status: 200,
      body: {
        ok: true,
        applied: true,
        idempotent: !!applied.idempotent,
        skuId: decision.skuId,
        sessionId: decision.purchaseId,
      },
    };
  } catch (err) {
    console.error(`[stripe-webhook] store failure event=${decision.eventId}: ${(err as Error)?.message ?? err}`);
    return { status: 500, body: { ok: false, error: "store_failure" } };
  }
}

/** JSON response for whichever server called the handler. */
export function webhookResponse(result: WebhookHttpResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
