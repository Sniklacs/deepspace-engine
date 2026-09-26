// THE PURCHASE INTENT — a client-side note to self, and nothing more.
//
// THE PROBLEM IT SOLVES. The player is sent to Stripe in the same tab, so the
// page they come back to has been destroyed and reloaded. To answer "did my
// purchase land?" honestly we need to know what the wallet looked like BEFORE
// the click, and the only place that survives the round trip is the device.
//
// WHAT IT IS NOT. It is not a receipt, not a claim, and not an entitlement. The
// value stored here is a signature of numbers the SERVER already sent us; the
// return panel compares it against the server's own numbers again. Forging this
// note changes nothing — the webhook is still the only writer, and a forged note
// can at worst make the player's own screen say "confirmed" about a purchase
// they did not make. Nothing is granted from the client, ever.
//
// WHY NOT THE URL. Stripe's return URL carries `{CHECKOUT_SESSION_ID}`, and we
// keep it (it is useful for support), but it proves nothing on its own: anyone
// can type it. It is never used to grant, and the panel's state comes from the
// server's wallet, not from the query string.
//
// PURE + storage-injected, so it is unit-testable without a browser.

export const PURCHASE_INTENT_KEY = "dse_purchase_intent";

/** How long a note stays useful. A purchase flow that took longer than this is
 *  over — the note is stale, never a reason to claim anything. */
export const PURCHASE_INTENT_TTL_MS = 2 * 60 * 60 * 1000;

export interface PurchaseIntent {
  skuId: string;
  /** Wallet signature (see walletSignature) captured at the moment of the click. */
  signature: string;
  at: number;
}

/** The minimal shape both `GameState` and `walletView()` satisfy. */
export interface Walletish {
  currency?: { scrip?: number; votives?: number } | null;
  entitlements?: {
    cosmetics?: string[];
    packs?: string[];
    passes?: string[];
  } | null;
  battlePass?: { premium?: boolean } | null;
}

/**
 * A signature of everything a purchase is allowed to change in the wallet:
 * Votives, pack entitlements, cosmetic entitlements, pass entitlements. Scrip is
 * in here too (a pack may carry it) — while the daily-reward scrip is not,
 * because that is a different edge's grant. Two equal signatures mean the wallet
 * has NOT moved for purchase-shaped reasons.
 */
export function walletSignature(w: Walletish | null | undefined): string {
  const votives = Math.floor(Number(w?.currency?.votives ?? 0) * 100) / 100;
  const scrip = Math.floor(Number(w?.currency?.scrip ?? 0) * 100) / 100;
  const packs = new Set(w?.entitlements?.packs ?? []).size;
  const cosmetics = new Set(w?.entitlements?.cosmetics ?? []).size;
  const passes = new Set(w?.entitlements?.passes ?? []).size;
  const premium = w?.battlePass?.premium === true ? 1 : 0;
  return `v${votives}|s${scrip}|p${packs}|c${cosmetics}|r${passes}|x${premium}`;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Write the note at click time (device storage; a browser with no storage
 *  simply gets no confirmation panel — it must never break the purchase). */
export function savePurchaseIntent(storage: StorageLike | null | undefined, intent: PurchaseIntent): void {
  if (!storage) return;
  try {
    storage.setItem(PURCHASE_INTENT_KEY, JSON.stringify(intent));
  } catch {
    /* private mode / quota — the flow continues without the note */
  }
}

/** Read the note back on return. Stale or unreadable notes read as null, and a
 *  null note can never produce a "confirmed" claim. */
export function readPurchaseIntent(storage: StorageLike | null | undefined, now = Date.now()): PurchaseIntent | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(PURCHASE_INTENT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PurchaseIntent>;
    if (typeof parsed?.skuId !== "string" || typeof parsed?.signature !== "string" || typeof parsed?.at !== "number") return null;
    if (!Number.isFinite(parsed.at) || now - parsed.at > PURCHASE_INTENT_TTL_MS) return null;
    return { skuId: parsed.skuId, signature: parsed.signature, at: parsed.at };
  } catch {
    return null;
  }
}

export function clearPurchaseIntent(storage: StorageLike | null | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(PURCHASE_INTENT_KEY);
  } catch {
    /* nothing to clean */
  }
}
