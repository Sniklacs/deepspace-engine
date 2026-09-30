// XSOLLA PAY STATION — the provider behind the crate of gold.
//
// This is what replaced Stripe (2026-09-30). Instead of pre-made payment links
// that pointed at fixed prices, the SERVER mints a short-lived checkout token
// per purchase via Xsolla's Store API, then sends the player to Pay Station
// with that token. The token binds:
//   · the SKU (from this game's own catalog, xsolla-catalog.ts),
//   · the buyer's account (their encoded account ref — the SAME value Xsolla
//     echoes back in the webhook, which is what lets the verifier pin the
//     credit to the right account),
//   · the return URL (back to the game),
//   · sandbox vs live.
//
// SECURITY POSTURE. The API key never leaves the server: this module takes it
// as an argument, reads it from the environment at the call site (api.ts), and
// the client bundle only ever sees the Pay Station URL. The webhook that
// grants the purchase is verified by xsolla-webhook.ts — an entitlement is
// granted ONLY by a signature-verified webhook, never by the token minting
// itself or by anything the client claims.
//
// HOW AUTH WORKS. Xsolla's Store admin token endpoint takes HTTP Basic auth:
// `Authorization: Basic base64(projectId:apiKey)`.
//
// URLS (stable, documented):
//   token:   https://store.xsolla.com/api/v3/project/{project_id}/admin/payment/token
//   pay live:    https://secure.xsolla.com/paystation4/?token={token}
//   pay sandbox: https://sandbox-secure.xsolla.com/paystation4/?token={token}
//
// This module is importable by the server only for the actual mint (it uses
// global fetch — present in Bun/Node ≥18 — but no node-specific imports). The
// verifier stays in xsolla-webhook.ts and the catalog in xsolla-catalog.ts so
// each of the three Xsolla pieces can be tested in isolation.

import type { PaymentProvider, PurchaseIntent } from "../monetization";
import { encodeAccountRef } from "./account-ref";
import { xsollaCatalogRow, isSellable, xsollaSkuFor } from "./xsolla-catalog";

export const XSOLLA_PAY_STATION_URL = "https://secure.xsolla.com/paystation4/?token=";
export const XSOLLA_PAY_STATION_SANDBOX_URL = "https://sandbox-secure.xsolla.com/paystation4/?token=";
export const XSOLLA_TOKEN_API = "https://store.xsolla.com/api/v3";

export interface XsollaProviderOptions {
  /** The Xsolla Publisher project id (Project ID in Publisher Account). */
  projectId?: string;
  /** The project's API key (secret — server only). */
  apiKey?: string;
  /** The project's webhook secret key (used by xsolla-webhook.ts, not here). */
  secretKey?: string;
  /** Use the sandbox Pay Station (test bank cards, no real money). */
  sandbox?: boolean;
  /** Computes the return URL per SKU (api.ts supplies this via
   *  `xsollaReturnUrlFor`). Null/omitted → Xsolla's default receipt page. */
  returnUrlFor?: (skuId: string) => string | null;
}

export interface MintedCheckout {
  ok: true;
  token: string;
  orderId: number;
  payUrl: string;
}

export interface MintFailure {
  ok: false;
  error: string;
}

/** Base64 of `projectId:apiKey` for HTTP Basic auth. `btoa` is global in Bun,
 *  Node ≥18 and browsers; the latin1 limitation is fine for Xsolla keys. */
export function xsollaBasicAuth(projectId: string, apiKey: string): string {
  return "Basic " + btoa(`${projectId}:${apiKey}`);
}

/**
 * Mint ONE checkout token for ONE SKU. Server-side only — the API key must
 * never reach the client. The token binds the account ref (echoed back by the
 * webhook), so Xsolla cannot be asked to credit a stranger.
 */
export async function mintXsollaPaymentToken(input: {
  projectId: string;
  apiKey: string;
  accountId: string;
  skuId: string;
  /** Where Xsolla sends the payer back. Null/omitted → Xsolla's default
   *  receipt page. Computed by the caller (api.ts) via `xsollaReturnUrlFor`. */
  returnUrl?: string | null;
  sandbox?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<MintedCheckout | MintFailure> {
  const row = xsollaCatalogRow(input.skuId);
  if (!row) return { ok: false, error: `Unknown SKU: ${input.skuId}` };
  if (!isSellable(input.skuId)) return { ok: false, error: `That item is not on sale: ${input.skuId}` };
  if (!input.projectId || !input.apiKey) {
    return { ok: false, error: "Xsolla is not configured (project id / API key missing)." };
  }

  const settings: Record<string, unknown> = {
    currency: "USD",
    language: "en",
    redirect_policy: {
      // back to the game on every terminal state — the webhook, not the
      // return URL, grants the purchase; the return just shows the receipt
      redirect_conditions: "any",
    },
  };
  if (input.returnUrl) settings.return_url = input.returnUrl;

  const url = `${XSOLLA_TOKEN_API}/project/${encodeURIComponent(input.projectId)}/admin/payment/token`;
  let res: Response;
  try {
    res = await (input.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: xsollaBasicAuth(input.projectId, input.apiKey),
      },
      body: JSON.stringify({
        user: {
          // the value Xsolla echoes in user_validation AND order_paid — this is
          // the only thing the webhook verifier trusts to name the buyer
          id: { value: encodeAccountRef(input.accountId) },
          country: { value: "US", allow_modify: true },
          email: { value: "", hide: true },
        },
        purchase: { items: [{ sku: xsollaSkuFor(input.skuId), quantity: 1 }] },
        sandbox: input.sandbox === true,
        settings,
        custom_parameters: {
          dse_account_ref: encodeAccountRef(input.accountId),
          dse_sku: input.skuId,
        },
      }),
    });
  } catch (e) {
    return { ok: false, error: `Could not reach Xsolla: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { message?: string; errorMessage?: string };
      detail = j.message ?? j.errorMessage ?? "";
    } catch {
      detail = "";
    }
    return { ok: false, error: `Xsolla refused the checkout (HTTP ${res.status}${detail ? `: ${detail}` : ""}).` };
  }
  let data: { token?: string; order_id?: number };
  try {
    data = (await res.json()) as { token?: string; order_id?: number };
  } catch {
    return { ok: false, error: "Xsolla answered in a shape we don't recognise." };
  }
  if (typeof data.token !== "string" || data.token.length === 0) {
    return { ok: false, error: "Xsolla returned no checkout token." };
  }
  const base = input.sandbox === true ? XSOLLA_PAY_STATION_SANDBOX_URL : XSOLLA_PAY_STATION_URL;
  return {
    ok: true,
    token: data.token,
    orderId: typeof data.order_id === "number" ? data.order_id : 0,
    payUrl: base + encodeURIComponent(data.token),
  };
}

/**
 * THE provider wired into `createPaymentProvider()`. Refuses everything until
 * configured — there is no "simulate" fallback for real money.
 *
 * createIntent: expects `intent.accountId` to be the signed-in account id and
 * `intent.skuId` a sellable SKU; mints the token and returns the Pay Station
 * URL the client should navigate to.
 *
 * verifyWebhook: DELIBERATELY unsupported on the provider — webhook
 * verification is `verifyXsollaEvent` in xsolla-webhook.ts (pure, raw-body
 * signature), wired through the webhook route. This returns { ok: false } so
 * no caller can mistake the provider for the verifier.
 */
export function createXsollaPaymentProvider(options: XsollaProviderOptions = {}): PaymentProvider {
  const { projectId, apiKey, sandbox, returnUrlFor } = options;
  return {
    name: "XsollaPaymentProvider",
    async createIntent(intent: PurchaseIntent) {
      if (!projectId || !apiKey) {
        return { ok: false, error: "Xsolla is not configured (project id / API key missing)." };
      }
      if (intent.currency !== "usd") {
        return { ok: false, error: `Unsupported currency: ${intent.currency}` };
      }
      const minted = await mintXsollaPaymentToken({
        projectId,
        apiKey,
        accountId: intent.accountId,
        skuId: intent.skuId,
        returnUrl: returnUrlFor ? returnUrlFor(intent.skuId) : null,
        sandbox,
      });
      if (!minted.ok) return { ok: false, error: minted.error };
      return { ok: true, intentId: `xsolla-${minted.orderId || minted.token.slice(0, 12)}`, url: minted.payUrl };
    },
    async verifyWebhook() {
      return { ok: false, error: "Use verifyXsollaEvent (xsolla-webhook.ts) for webhook verification." };
    },
    async refund() {
      return { ok: false, error: "Refunds are handled in the Xsolla Publisher Account." };
    },
  };
}
