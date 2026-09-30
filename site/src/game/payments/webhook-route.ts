// THE WEBHOOK ROUTE'S SERVER SIDE — verify, resolve the payer, grant, persist.
//
// This is the ONLY place a real purchase becomes an entitlement. The verifier
// (xsolla-webhook.ts) decides what the payload MEANS; this module is the part
// that touches the account store, and it is deliberately the thinnest possible
// layer between them.
//
// WHO CALLS IT. `serve.ts` (the production server the platform publishes) and
// the Vite dev-server middleware in `vite.config.ts`, both on the same path
// constant. TanStack Start 1.158's route files render HTML for the app shell;
// they are not the seam this route wants, because it must read the UNPARSED
// request body (the signature is over the exact bytes) and must answer with
// status codes rather than a page. Wiring both servers to one handler means the
// dev host and the live host behave identically, which is the only way an
// Xsolla delivery can be tested before it matters.
//
// STATUS CODES (what makes Xsolla retry, and what it means):
//   2xx — nothing is owed any more: the grant landed, or the event is one we
//         will never act on (another notification type, or a user_validation
//         we answered). Xsolla stops re-delivering, which is correct in both
//         cases. (Xsolla asks for 204 on success; empty 204 IS the success.)
//   400 — a request that cannot have come from Xsolla (no / bad signature,
//         malformed JSON) or a user that does not exist (user_validation of an
//         unknown ref). Visible in the Publisher dashboard's webhook log.
//   500 — WE OWE A GRANT AND COULD NOT MAKE IT: no secret key configured, an
//         unknown SKU, an amount that disagrees with the price list, a user
//         reference that names nobody, an account with no colony, or a refused
//         grant. Retryable and harmless (the grant is idempotent by
//         transaction id) and LOUD — which is the point: quiet money is the
//         failure we cannot accept. Nothing here is ever swallowed.
//
// SERVER-ONLY: this module imports the store (Postgres or the fs fallback).
// Nothing client-side may import it; `payments-tests` asserts that.

import { applyExternalPurchase } from "../monetization";
import { loadAccountSaves, loadAccounts, saveAccountSaves } from "../store";
import { decodeAccountRef } from "./account-ref";
import { verifyXsollaEvent } from "./xsolla-webhook";

/** The one path both servers answer on. `vite.config.ts` repeats this literal
 *  (the config cannot import this module at load time); payments-tests pins the
 *  two to each other so they cannot drift. */
export const XSOLLA_WEBHOOK_PATH = "/api/dse-xsolla-webhook";

/** The endpoint's secret key, read from the environment at call time. */
export const XSOLLA_WEBHOOK_SECRET_ENV = "XSOLLA_WEBHOOK_SECRET";

export interface WebhookHttpResult {
  status: number;
  /** null → answer with an empty 204, which is what Xsolla asks for. */
  body: Record<string, unknown> | null;
}

export function readWebhookSecret(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env[XSOLLA_WEBHOOK_SECRET_ENV];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * Handle one delivery. Never throws: an unexpected store failure becomes a 500
 * (Xsolla retries), never a 204 (which would mean "already handled" for a
 * purchase nobody received).
 */
export async function handleXsollaWebhookRequest(input: {
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
    decision = await verifyXsollaEvent({
      rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
      secret,
      now,
    });
  } catch (err) {
    console.error(`[xsolla-webhook] verification threw: ${(err as Error)?.message ?? err}`);
    return { status: 500, body: { ok: false, error: "verification_failed" } };
  }

  // user_validation: Xsolla asks several times per payment whether this user
  // exists, and blocks the pay flow until we answer 2xx. The verifier hands us
  // the RAW reference (the value the token request sent); the store is keyed
  // by decoded account id, so decode before the lookup. Unknown or forged
  // ref → 400 INVALID_USER (Xsolla's documented shape) so the dashboard says
  // why.
  if (decision.kind === "validate_user") {
    try {
      const accountId = decodeAccountRef(decision.userRef);
      const accounts = await loadAccounts();
      if (!accountId || !accounts[accountId]) {
        console.warn(`[xsolla-webhook] user_validation UNKNOWN user=${decision.userRef}`);
        return { status: 400, body: { error: { code: "INVALID_USER", message: "No such account." } } };
      }
      console.log(`[xsolla-webhook] user_validation ok user=${decision.userRef}`);
      return { status: 204, body: null };
    } catch (err) {
      console.error(`[xsolla-webhook] user_validation store failure: ${(err as Error)?.message ?? err}`);
      return { status: 500, body: { ok: false, error: "store_failure" } };
    }
  }

  if (decision.kind === "ignore") {
    console.log(`[xsolla-webhook] ignored (${decision.reason}) type=${decision.eventType ?? "?"} event=${decision.eventId ?? "?"}`);
    return { status: 204, body: null };
  }

  if (decision.kind === "reject") {
    console.warn(
      `[xsolla-webhook] REFUSED ${decision.code} (${decision.status}) event=${decision.eventId ?? "?"}: ${decision.message}`,
    );
    return {
      status: decision.status,
      body: { ok: false, error: decision.code, message: decision.message, eventId: decision.eventId ?? null },
    };
  }

  try {
    // 1) The account must exist. A reference that decodes cleanly but names no
    //    account is a mis-built token request, not a customer we can credit.
    const accounts = await loadAccounts();
    if (!accounts[decision.accountId]) {
      console.warn(`[xsolla-webhook] REFUSED unknown_account for ref event=${decision.eventId}`);
      return {
        status: 500,
        body: {
          ok: false,
          error: "unknown_account",
          message: "The order's user reference names no account on this server. Grant by hand or refund.",
        },
      };
    }

    // 2) The grant lands in the account's ACTIVE colony — the same game the
    //    player was looking at when they clicked. A purchase is never applied to
    //    a colony they cannot see.
    const saves = await loadAccountSaves(decision.accountId);
    const activeGameId = saves?.activeGameId ?? null;
    if (!saves || !activeGameId || !saves.games[activeGameId]) {
      console.warn(`[xsolla-webhook] REFUSED no_active_colony account=${decision.accountId} event=${decision.eventId}`);
      return {
        status: 500,
        body: {
          ok: false,
          error: "no_active_colony",
          message: "This account has no active colony to credit. Start one (this retries), or grant by hand.",
        },
      };
    }

    // 3) Apply. Idempotent by transaction id: a re-delivered event cannot
    //    double-grant.
    const applied = applyExternalPurchase(
      saves.games[activeGameId],
      { purchaseId: decision.purchaseId, skuId: decision.skuId, confirmedAt: decision.confirmedAt },
      now,
    );
    if (!applied.ok) {
      console.error(`[xsolla-webhook] apply_failed sku=${decision.skuId} event=${decision.eventId}: ${applied.error}`);
      return {
        status: 500,
        body: { ok: false, error: "apply_failed", message: applied.error ?? "The purchase could not be applied." },
      };
    }
    saves.games[activeGameId] = applied.state;
    await saveAccountSaves(decision.accountId, saves);

    console.log(
      `[xsolla-webhook] applied sku=${decision.skuId} cents=${decision.amountCents} via=${decision.recognition} mode=${decision.mode} idempotent=${!!applied.idempotent} event=${decision.eventId}`,
    );
    return { status: 204, body: null };
  } catch (err) {
    console.error(`[xsolla-webhook] store failure event=${decision.eventId}: ${(err as Error)?.message ?? err}`);
    return { status: 500, body: { ok: false, error: "store_failure" } };
  }
}

/** Response for whichever server called the handler. Success/ignored is an
 *  empty 204 — exactly what Xsolla asks for. */
export function webhookResponse(result: WebhookHttpResult): Response {
  if (result.body === null) {
    return new Response(null, { status: result.status, headers: { "cache-control": "no-store" } });
  }
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
