// THE XSOLLA CATALOG — THE ONE FILE THE OWNER (OR THE LEAD) KEEPS TRUE.
//
// Mechanism (decided, not up for redesign): Xsolla Pay Station. The game mints
// a payment token server-side (xsolla-provider.ts) for a SKU in THIS table and
// opens the Pay Station URL it returns. Xsolla's Publisher Account holds a
// matching virtual-item catalog: the SAME SKU strings, the SAME USD prices.
// The webhook (xsolla-webhook.ts) maps a paid order's `items[].sku` back
// through this table and refuses anything it cannot name.
//
// `amountUsd` is a TRIPWIRE, not a second price list: the verifier refuses an
// order whose paid amount disagrees with it, which is how a mis-priced catalog
// item on Xsolla's side becomes a loud failure instead of a quiet gift. A test
// pins every row against the game's own catalogue (monetization.ts) so the two
// cannot drift.
//
// `enabled` is the SELL SWITCH, and it is separate from recognition on purpose:
// a row may be catalogued (the webhook recognises and can grant it) without
// being offered in the storefront. The six time tokens lived in that state
// until their shop surface landed (2026-10-15, owner ruling: tokens GO ON
// SALE — players compressing the 12-week season is intended); all thirteen
// rows are enabled today.
//
// This module is PURE (no node imports) — the client uses it to list what is
// sellable, and the unit tests import it directly.

export interface XsollaCatalogRow {
  /** The game's own SKU id — the key `applyExternalPurchase()` grants by, and
   *  the SKU string registered in Xsolla's Publisher catalog. One string, both
   *  sides; there is no second id to keep in sync. */
  skuId: string;
  /** What Xsolla charges, in USD — the tripwire described above. */
  amountUsd: number;
  /** False = recognised by the webhook, but never offered in the storefront. */
  enabled: boolean;
}

/** The Xsolla catalogue the game RECOGNISES — all thirteen rows sellable.
 *
 *  SEVEN PACKS: Votive-small $4.99 · votive-steady $9.99 · votive-grand
 *           $19.99 · votive-circuit $39.99 · scavengers-kit $4.99 ·
 *           expeditionary-kit $9.99 · long-haul-cart $12.99
 *  SIX TIME TOKENS: 30m $2.99 · 1h $3.99 · 8h $7.99 ·
 *           12h $9.99 · 24h $14.99 · 48h $24.99
 */
export const XSOLLA_CATALOG: XsollaCatalogRow[] = [
  // ---- Votive packs (Cradle Ledger, monetization.ts §2.3) ----
  { skuId: "Votive-small", amountUsd: 4.99, enabled: true },
  { skuId: "votive-steady", amountUsd: 9.99, enabled: true },
  { skuId: "votive-grand", amountUsd: 19.99, enabled: true },
  { skuId: "votive-circuit", amountUsd: 39.99, enabled: true },
  // ---- Head-start packs (monetization.ts §3) ----
  { skuId: "scavengers-kit", amountUsd: 4.99, enabled: true },
  { skuId: "expeditionary-kit", amountUsd: 9.99, enabled: true },
  { skuId: "long-haul-cart", amountUsd: 12.99, enabled: true },
  // ---- The six TIME TOKENS (monetization.ts TIME_TOKEN_PACKS) ----
  //
  // A token row is HERE for two reasons: RECOGNITION (a paid token order must
  // map back to `time-token-8h` so the webhook can grant it) and SALE. The
  // rows were recognition-only until the token shelf landed in the storefront
  // (2026-10-15, owner ruling — tokens on sale); `enabled: true` is now the
  // honest state of the build, and the storefront's Time Tokens section is
  // their player-facing domain.
  { skuId: "time-token-30m", amountUsd: 2.99, enabled: true },
  { skuId: "time-token-1h", amountUsd: 3.99, enabled: true },
  { skuId: "time-token-8h", amountUsd: 7.99, enabled: true },
  { skuId: "time-token-12h", amountUsd: 9.99, enabled: true },
  { skuId: "time-token-24h", amountUsd: 14.99, enabled: true },
  { skuId: "time-token-48h", amountUsd: 24.99, enabled: true },
];

/** Where Xsolla sends the player back to after Pay Station. */
export const STORE_RETURN_PATH = "/play";
export const STORE_RETURN_SKU_PARAM = "sku";

/** The return URL handed to Xsolla when the token is minted. Nothing is
 *  granted by the return itself — the webhook is still the only writer. */
export function xsollaReturnUrl(origin: string, skuId: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}${STORE_RETURN_PATH}?purchase=return&${STORE_RETURN_SKU_PARAM}=${encodeURIComponent(skuId)}`;
}

/**
 * The return URL for a checkout minted from a client-supplied origin
 * (`window.location.origin`). Any https origin is accepted — the return URL is
 * cosmetic (it is where the payer's browser lands; the grant comes from the
 * webhook, never from the return), and the game's own client is the only
 * caller. In sandbox mode plain http is accepted too, so localhost/dev hosts
 * work for test purchases. A client origin that is missing or unusable falls
 * back to the canonical origin; null only when no usable origin exists at
 * all — the token request then omits return_url and Xsolla shows its default
 * receipt page.
 */
export function xsollaReturnUrlFor(input: {
  skuId: string;
  origin?: string;
  sandbox?: boolean;
  canonicalOrigin?: string;
}): string | null {
  const candidates = [input.origin, input.canonicalOrigin];
  for (const raw of candidates) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    try {
      const o = new URL(raw.trim());
      if (o.protocol === "https:" || (input.sandbox === true && o.protocol === "http:")) {
        return xsollaReturnUrl(o.origin, input.skuId);
      }
    } catch {
      // unusable — try the next candidate
    }
  }
  return null;
}

export function xsollaCatalogRow(skuId: string): XsollaCatalogRow | null {
  return XSOLLA_CATALOG.find((r) => r.skuId === skuId) ?? null;
}

/** A SKU is sellable ONLY when its row is enabled. Note what this does NOT do:
 *  offer a SKU the webhook cannot recognise. Recognition and offering are the
 *  same table, so they cannot drift. */
export function isSellable(skuId: string): boolean {
  const row = xsollaCatalogRow(skuId);
  return !!row && row.enabled;
}

/** Every SKU the storefront may offer — the buy control's allow-list. All
 *  thirteen rows today, tokens included (enabled 2026-10-15). */
export function sellableSkus(): string[] {
  return XSOLLA_CATALOG.filter((r) => r.enabled).map((r) => r.skuId);
}

/** The SKU string to register in Xsolla's Publisher catalog for a game SKU —
 *  deliberately the game SKU itself, so there is exactly one id. Throws on a
 *  SKU with no row: a catalogue pointing at something Xsolla cannot name is a
 *  wiring fault that must fail at load, not a silent "" that quietly disables
 *  a sale. */
export function xsollaSkuFor(skuId: string): string {
  const row = xsollaCatalogRow(skuId);
  if (!row) {
    throw new Error(`xsolla-catalog.ts: no Xsolla catalog row for "${skuId}" — the catalogue cannot name what it sells.`);
  }
  return row.skuId;
}

/** The SKU named by a paid order's `items[].sku`, but ONLY if we actually sell
 *  it. An unknown SKU value is a wiring error, never a grant. */
export function skuForXsollaSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  return XSOLLA_CATALOG.some((r) => r.skuId === sku) ? sku : null;
}
