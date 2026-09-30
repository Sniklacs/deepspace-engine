// THE PAYMENTS SUITE — the money path, verified end to end without any network.
//
// WHAT THIS SUITE IS TRYING TO PROVE, and why each part exists:
//   §1  the SIGNATURE is what makes a payload real — valid accepted, tampered
//       body / wrong secret / missing / malformed header all refused;
//   §2  the EVENT maps to a purchase only when it is order_paid, a single
//       item, a known SKU, the right USD amount, and a user reference that
//       names an account (user_validation answers separately; anything else
//       is ignored, never granted);
//   §3  an account reference survives any username a player can pick (Persian,
//       spaces) and a forged one names nobody;
//   §4  the ROUTE grants exactly once, into the active colony, through the real
//       store (scratch cwd, fs backend) — including replay, user_validation,
//       cancellations, and every refusal;
//   §5  the wiring: the factory returns the Xsolla provider, token minting is
//       server-side and refuses honestly, every catalog row is pinned to the
//       game's own catalogue, an unconfigured SKU cannot be bought, the two
//       servers answer on one path, and the client cannot import the server
//       handler.
//
// Run: cd ~/workspace/deepspace-engine/payments-tests && env -u DATABASE_URL bun run payments-verify.ts
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SITE = "/home/hatch/workspace/deepspace-engine/site";
const read = (p: string) => readFileSync(`${SITE}/${p}`, "utf8");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

// The store writes to `process.cwd()/data` on the fs backend, so this suite runs
// in its own throwaway directory: no DATABASE_URL, no shared state, cleaned up
// at the end.
delete process.env.DATABASE_URL;
const SCRATCH = mkdtempSync(join(tmpdir(), "dse-payments-"));
process.chdir(SCRATCH);

const ref = (await import(`${SITE}/src/game/payments/account-ref.ts`)) as {
  encodeAccountRef: (id: string) => string;
  decodeAccountRef: (r: string | null | undefined) => string | null;
  ACCOUNT_REF_PREFIX: string;
};
const catalog = (await import(`${SITE}/src/game/payments/xsolla-catalog.ts`)) as {
  XSOLLA_CATALOG: Array<{ skuId: string; amountUsd: number; enabled: boolean }>;
  xsollaCatalogRow: (sku: string) => { skuId: string; amountUsd: number; enabled: boolean } | null;
  xsollaReturnUrl: (origin: string, skuId: string) => string;
  xsollaReturnUrlFor: (input: { skuId: string; origin?: string; sandbox?: boolean; canonicalOrigin?: string }) => string | null;
  isSellable: (sku: string) => boolean;
  sellableSkus: () => string[];
  xsollaSkuFor: (sku: string) => string;
  skuForXsollaSku: (s: string | null | undefined) => string | null;
  XSOLLA_WEBHOOK_PATH?: string;
};
const verifier = (await import(`${SITE}/src/game/payments/xsolla-webhook.ts`)) as {
  verifyXsollaEvent: (input: {
    rawBody: string;
    signatureHeader: string | null;
    secret: string | null | undefined;
    now?: number;
  }) => Promise<{ kind: string; [k: string]: unknown }>;
  verifyXsollaSignature: (input: {
    rawBody: string;
    signatureHeader: string | null | undefined;
    secret: string;
  }) => Promise<{ ok: boolean; code?: string }>;
  xsollaSignatureHex: (rawBody: string, secret: string) => Promise<string>;
  parseSignatureHeader: (h: string | null | undefined) => string | null;
};
const providerMod = (await import(`${SITE}/src/game/payments/xsolla-provider.ts`)) as {
  createXsollaPaymentProvider: (o?: Record<string, unknown>) => {
    name: string;
    createIntent: (i: { accountId: string; skuId: string; idempotencyKey: string; amountCents: number; currency: string }) => Promise<{ ok: boolean; url?: string; intentId?: string; error?: string }>;
    verifyWebhook: (p: unknown) => Promise<{ ok: boolean; error?: string }>;
    refund: (o: { purchaseId: string; reason: string }) => Promise<{ ok: boolean; error?: string }>;
  };
  mintXsollaPaymentToken: (input: Record<string, unknown>) => Promise<{ ok: boolean; token?: string; orderId?: number; payUrl?: string; error?: string }>;
  xsollaBasicAuth: (projectId: string, apiKey: string) => string;
  XSOLLA_PAY_STATION_URL: string;
  XSOLLA_PAY_STATION_SANDBOX_URL: string;
};
const intent = (await import(`${SITE}/src/game/payments/purchase-intent.ts`)) as {
  walletSignature: (w: unknown) => string;
  savePurchaseIntent: (s: unknown, i: { skuId: string; signature: string; at: number }) => void;
  readPurchaseIntent: (s: unknown, now?: number) => { skuId: string; signature: string; at: number } | null;
  clearPurchaseIntent: (s: unknown) => void;
  PURCHASE_INTENT_KEY: string;
  PURCHASE_INTENT_TTL_MS: number;
};
const monetization = (await import(`${SITE}/src/game/monetization.ts`)) as {
  createPaymentProvider: (o?: Record<string, unknown>) => { name: string };
  VOTIVE_PACKS: Array<{ id: string; name: string; votives: number; bonus: number; priceUsd: number }>;
  HEAD_START_PACKS: Array<{ id: string; name: string; priceUsd: number; blurb: string; playEquivalent: string; grants: Array<{ kind: string; key?: string; currency?: string; itemId?: string; vehicleId?: string; note: string }> }>;
  COSMETICS: Array<{ id: string; name: string; blurb: string }>;
  COSMETIC_BY_ID: Record<string, { blurb: string }>;
  TIME_TOKEN_PACKS: Array<{ id: string; sizeId: string; name: string; priceUsd: number; providerSkuId: string }>;
  MONETIZATION_CONFIG: { storefrontEnabled: boolean };
  assertCatalogFair: () => void;
};
// Server-only + store-backed: imported AFTER the chdir so the fs store lands in
// the scratch directory.
const route = (await import(`${SITE}/src/game/payments/webhook-route.ts`)) as {
  XSOLLA_WEBHOOK_PATH: string;
  XSOLLA_WEBHOOK_SECRET_ENV: string;
  readWebhookSecret: (env?: Record<string, string | undefined>) => string | null;
  handleXsollaWebhookRequest: (input: { rawBody: string; signatureHeader: string | null; now?: number; secret?: string | null }) => Promise<{
    status: number;
    body: Record<string, unknown> | null;
  }>;
  webhookResponse: (r: { status: number; body: Record<string, unknown> | null }) => Response;
};
const store = (await import(`${SITE}/src/game/store.ts`)) as {
  loadAccounts: () => Promise<Record<string, unknown>>;
  saveAccounts: (a: Record<string, unknown>) => Promise<void>;
  loadAccountSaves: (id: string) => Promise<{ activeGameId: string | null; games: Record<string, { currency: { votives: number; scrip: number; ledger: Array<{ reason: string; kind: string }> }; resources: Record<string, number>; entitlements: { packs: string[] } }> } | null>;
  saveAccountSaves: (id: string, s: unknown) => Promise<void>;
  emptySaves: () => { version: number; activeGameId: string | null; games: Record<string, unknown> };
};
const engine = (await import(`${SITE}/src/game/engine.ts`)) as {
  newGame: (name: string, race: string, now: number) => { gameId: string; currency: { votives: number }; resources: Record<string, number> };
};

// ---------------------------------------------------------------------------
// signing helpers — node's own SHA-1, so the verifier is checked against an
// implementation it does not share code with. Xsolla's scheme: lowercase hex
// of SHA-1 over (rawBody + secretKey) — plain hash, NOT HMAC.
// ---------------------------------------------------------------------------
const SECRET = "test_secret_key_5f2a1c0d9e8b7a6f";
const REF = ref.encodeAccountRef("payer");

function sign(rawBody: string, secret = SECRET): string {
  const hex = createHash("sha1").update(rawBody + secret, "utf8").digest("hex");
  return `Signature ${hex}`;
}

let orderCounter = 0;
interface OrderOpts {
  skus?: (string | null)[];
  amount?: string | null;
  billingAmount?: number | null;
  currency?: string;
  userRef?: string | null;
  userId?: string | null;
  customRef?: string | null;
  type?: string;
  mode?: string;
  dryRun?: boolean;
  paymentDate?: string | null;
  txId?: number | string | null;
  omitAmount?: boolean;
  omitUser?: boolean;
  omitItems?: boolean;
}
function orderBody(opts: OrderOpts = {}): { body: string; txId: string } {
  orderCounter++;
  const n = orderCounter;
  const txId = opts.txId === undefined ? 87654000 + n : opts.txId;
  const skus = opts.skus === undefined ? ["votive-small"] : opts.skus;
  const amount = opts.amount === undefined ? "4.99" : opts.amount;
  const order: Record<string, unknown> = {
    id: 4567000 + n,
    mode: opts.mode ?? "default",
    currency: opts.currency ?? "USD",
    status: "paid",
    invoice_id: `inv_${n}`,
  };
  if (!opts.omitAmount && amount !== null) order.amount = amount;
  const body: Record<string, unknown> = {
    notification_type: opts.type ?? "order_paid",
    order,
    custom_parameters: { dse_account_ref: opts.customRef ?? null, dse_sku: skus[0] ?? null },
    billing: {
      transaction: {
        id: txId,
        payment_date: opts.paymentDate === undefined ? "2026-09-30T12:00:00+00:00" : opts.paymentDate,
        dry_run: opts.dryRun ? 1 : 0,
      },
      purchase: { total: { amount: opts.billingAmount ?? null, currency: opts.currency ?? "USD" } },
    },
  };
  if (!opts.omitItems) body.items = skus.map((s) => ({ sku: s, quantity: 1 }));
  if (!opts.omitUser) {
    body.user = {
      external_id: opts.userRef === undefined ? REF : opts.userRef,
      email: "payer@example.com",
      country: "US",
    };
    if (opts.userId !== undefined) (body.user as Record<string, unknown>).id = opts.userId;
  }
  return { body: JSON.stringify(body), txId: String(txId) };
}

function validationBody(userRef: string | null): string {
  return JSON.stringify({
    notification_type: "user_validation",
    user: { id: userRef, email: "payer@example.com", country: "US" },
    settings: { project_id: 12345 },
  });
}

async function decide(rawBody: string, header: string | null, secret: string | null | undefined = SECRET) {
  return verifier.verifyXsollaEvent({ rawBody, signatureHeader: header, secret });
}

// ===========================================================================
console.log("— 1 · the signature is what makes a payload real —");
{
  const known = await verifier.xsollaSignatureHex("hello", SECRET);
  const expected = createHash("sha1").update("hello" + SECRET, "utf8").digest("hex");
  check("our SHA-1 matches node's SHA-1 byte for byte (Web Crypto vs OpenSSL)", known === expected, known.slice(0, 12));
  check("the scheme is plain SHA-1 over body+secret, NOT an HMAC", known !== createHash("sha256").update("hello" + SECRET, "utf8").digest("hex"));

  const { body } = orderBody();
  check("a correctly signed event verifies", (await verifier.verifyXsollaSignature({ rawBody: body, signatureHeader: sign(body), secret: SECRET })).ok === true);
  check("an UPPERCASE hex signature verifies too (the header is lowercased before comparing)", (await verifier.verifyXsollaSignature({ rawBody: body, signatureHeader: `Signature ${createHash("sha1").update(body + SECRET, "utf8").digest("hex").toUpperCase()}`, secret: SECRET })).ok === true);
  check(
    "a TAMPERED body is refused (the signature covers the exact bytes, not the parsed meaning)",
    (await verifier.verifyXsollaSignature({ rawBody: body.replace("votive-small", "votive-circuit"), signatureHeader: sign(body), secret: SECRET })).ok === false,
  );
  check("a WRONG SECRET is refused", (await verifier.verifyXsollaSignature({ rawBody: body, signatureHeader: sign(body, "someone_elses_key"), secret: SECRET })).ok === false);
  check("a MISSING header is refused", (await verifier.verifyXsollaSignature({ rawBody: body, signatureHeader: null, secret: SECRET })).ok === false);
  check("a Bearer-style header is refused", (await verifier.verifyXsollaSignature({ rawBody: body, signatureHeader: "Bearer abc123", secret: SECRET })).ok === false);
  check("a truncated hex signature is refused", (await verifier.verifyXsollaSignature({ rawBody: body, signatureHeader: "Signature deadbeef", secret: SECRET })).ok === false);
  check("a non-hex signature is refused", (await verifier.verifyXsollaSignature({ rawBody: body, signatureHeader: `Signature ${"z".repeat(40)}`, secret: SECRET })).ok === false);
  check("parseSignatureHeader returns null for shapes it cannot read", verifier.parseSignatureHeader(null) === null && verifier.parseSignatureHeader("Signature") === null && verifier.parseSignatureHeader("") === null);
}

// ===========================================================================
console.log("— 2 · event → purchase: only order_paid, one item, known, correctly priced —");
{
  const { body, txId } = orderBody({ skus: ["votive-small"] });
  const d = await decide(body, sign(body));
  check("a paid order_paid for a known SKU maps to an apply", d.kind === "apply");
  check("it carries the SKU, the account, the amount and the transaction id as the purchase id",
    d.kind === "apply" && d["skuId"] === "votive-small" && d["accountId"] === "payer" && d["amountCents"] === 499 && d["purchaseId"] === txId);
  check("the recognition path is recorded (items[0].sku here)", d.kind === "apply" && d["recognition"] === "items[0].sku");
  check("a live order is live mode", d.kind === "apply" && d["mode"] === "live");

  const test = orderBody({ mode: "sandbox" });
  const dt = await decide(test.body, sign(test.body));
  check("a sandbox order still applies, but is marked test (review before production)", dt.kind === "apply" && dt["mode"] === "test");

  const dry = orderBody({ dryRun: true });
  const dd = await decide(dry.body, sign(dry.body));
  check("a dry_run transaction is marked test too", dd.kind === "apply" && dd["mode"] === "test");

  const canceled = orderBody({ type: "order_canceled" });
  const dc = await decide(canceled.body, sign(canceled.body));
  check("order_canceled is ignored, not refused (it never grants and Xsolla stops re-delivering)", dc.kind === "ignore" && String(dc["reason"]).includes("order_canceled"));

  const other = orderBody({ type: "payment_succeeded" });
  const do_ = await decide(other.body, sign(other.body));
  check("an UNHANDLED event type is ignored, not refused", do_.kind === "ignore" && String(do_["reason"]).startsWith("unhandled_notification:"));

  const missingType = JSON.stringify({ order: { id: 1, amount: "4.99", currency: "USD" } });
  const dm = await decide(missingType, sign(missingType));
  check("an event with NO notification_type is ignored", dm.kind === "ignore" && dm["reason"] === "missing_notification_type");

  const unknown = orderBody({ skus: ["votive-mega"] });
  const dn = await decide(unknown.body, sign(unknown.body));
  check("an UNKNOWN SKU is refused loudly (500) — money taken, nobody credited", dn.kind === "reject" && dn["status"] === 500 && dn["code"] === "unknown_sku");

  const noSku = orderBody({ skus: [null] });
  const dns = await decide(noSku.body, sign(noSku.body));
  check("an item naming no SKU at all is refused (no recognition path resolves)", dns.kind === "reject" && dns["code"] === "unknown_sku");

  const twoItems = orderBody({ skus: ["votive-small", "votive-steady"] });
  const dti = await decide(twoItems.body, sign(twoItems.body));
  check("TWO items are refused 500 (a cart is never silently granted as a single pack)", dti.kind === "reject" && dti["status"] === 500 && dti["code"] === "unexpected_items");

  const noItems = orderBody({ omitItems: true });
  const dni = await decide(noItems.body, sign(noItems.body));
  check("an order with NO items is refused, never granted on trust", dni.kind === "reject" && dni["code"] === "unexpected_items");

  const wrongAmount = orderBody({ skus: ["votive-small"], amount: "39.99" });
  const dwa = await decide(wrongAmount.body, sign(wrongAmount.body));
  check("an AMOUNT that disagrees with the catalog is refused (a wrong SKU must not gift a bigger pack)", dwa.kind === "reject" && dwa["code"] === "amount_mismatch");

  const wrongCurrency = orderBody({ skus: ["votive-small"], currency: "EUR" });
  const dwc = await decide(wrongCurrency.body, sign(wrongCurrency.body));
  check("a non-USD order is refused", dwc.kind === "reject" && dwc["code"] === "unexpected_currency");

  const missingAmount = orderBody({ skus: ["votive-small"], amount: null });
  const dma = await decide(missingAmount.body, sign(missingAmount.body));
  check("an order reporting NO amount is refused, never granted on trust", dma.kind === "reject" && dma["code"] === "amount_mismatch");

  // Billing echo tolerance: order.amount is the invoice of record; when it is
  // missing the billing total stands in, and a disagreement there also refuses.
  const billingMissing = orderBody({ amount: null, billingAmount: 4.99 });
  const dbm = await decide(billingMissing.body, sign(billingMissing.body));
  check("a missing order.amount falls back to the billing total and still applies", dbm.kind === "apply" && dbm["amountCents"] === 499);
  const billingWrong = orderBody({ amount: null, billingAmount: 39.99 });
  const dbw = await decide(billingWrong.body, sign(billingWrong.body));
  check("…but a billing total that disagrees with the catalog is refused", dbw.kind === "reject" && dbw["code"] === "amount_mismatch");

  const blankRef = orderBody({ userRef: "" });
  const dbr = await decide(blankRef.body, sign(blankRef.body));
  check("a BLANK user reference is refused (500) — there is nobody to credit", dbr.kind === "reject" && dbr["status"] === 500 && dbr["code"] === "unresolvable_user");

  const missingRef = orderBody({ omitUser: true });
  check("a MISSING user block is refused", (await decide(missingRef.body, sign(missingRef.body)))["code"] === "unresolvable_user");

  const junkRef = orderBody({ userRef: "not-an-account-ref!!" });
  const djr = await decide(junkRef.body, sign(junkRef.body));
  check("an UNRESOLVABLE reference is refused (500) — it names nobody this game ever wrote", djr.kind === "reject" && djr["code"] === "unresolvable_user");

  const viaCustom = orderBody({ omitUser: true, customRef: ref.encodeAccountRef("payer") });
  const dcp = await decide(viaCustom.body, sign(viaCustom.body));
  check("custom_parameters.dse_account_ref is the fallback when user.external_id is absent", dcp.kind === "apply" && dcp["accountId"] === "payer");

  const noSecret = await decide(orderBody().body, "Signature deadbeef", null);
  check("NO SECRET KEY means refuse everything (fail closed, never trust-and-pray)", noSecret.kind === "reject" && noSecret["status"] === 500 && noSecret["code"] === "no_secret_key");

  const malformed = "{\"notification_type\":\"order_paid\",\"order\":{";
  const dmf = await decide(malformed, sign(malformed));
  check("a signed but malformed body is refused 400 (it cannot have come from Xsolla)", dmf.kind === "reject" && dmf["status"] === 400 && dmf["code"] === "malformed_body");

  const notJson = "not json at all";
  check("a non-JSON body is refused 400 too", (await decide(notJson, sign(notJson)))["code"] === "malformed_body");

  // ---- user_validation -------------------------------------------------------
  // The verifier answers with the RAW reference; decoding and the account
  // lookup happen at the route (which is where the store lives).
  const uvBody = validationBody(REF);
  const uv = await decide(uvBody, sign(uvBody));
  check("user_validation decodes the reference and answers validate_user", uv.kind === "validate_user" && uv["userRef"] === REF);
  const uvfBody = validationBody("dse1_%%%%");
  const uvForged = await decide(uvfBody, sign(uvfBody));
  check("user_validation with a FORGED reference still answers validate_user (the route checks the account)", uvForged.kind === "validate_user" && uvForged["userRef"] === "dse1_%%%%");

  // ---- §2b · THE SIX TIME TOKENS ----------------------------------------------
  // A token is recognised by the SAME catalog lookup and gets the SAME amount
  // tripwire as a pack.
  const tokenPaid = orderBody({ skus: ["time-token-8h"], amount: "7.99" });
  const dtm = await decide(tokenPaid.body, sign(tokenPaid.body));
  check("a paid TOKEN order is recognised and amount-checked ($7.99)", dtm.kind === "apply" && dtm["skuId"] === "time-token-8h" && dtm["amountCents"] === 799);

  const tokenWrong = orderBody({ skus: ["time-token-8h"], amount: "2.99" });
  check("A TOKEN AMOUNT THAT DISAGREES IS REFUSED — $2.99 paid for the 8h token",
    (await decide(tokenWrong.body, sign(tokenWrong.body)))["code"] === "amount_mismatch");
  const tokenUnknown = orderBody({ skus: ["time-token-3h"], amount: "7.99" });
  check("a token size the game does not sell is refused loudly (never a guess)",
    (await decide(tokenUnknown.body, sign(tokenUnknown.body)))["code"] === "unknown_sku");
  const earnedSize = orderBody({ skus: ["time-token-1m"], amount: "1.00" });
  const earned5m = orderBody({ skus: ["time-token-5m"], amount: "1.00" });
  check("NEGATIVE CONTROL · the EARNED sizes are not purchasable at any price (1m/5m are refused by name)",
    (await decide(earnedSize.body, sign(earnedSize.body)))["code"] === "unknown_sku"
    && (await decide(earned5m.body, sign(earned5m.body)))["code"] === "unknown_sku");
}

// ===========================================================================
console.log("— 3 · the account reference (a username may be ANY text, Persian included) —");
{
  for (const id of ["payer", "bob 2", "بابک", "señor-a", "dse1_fake"]) {
    const encoded = ref.encodeAccountRef(id);
    check(`reference round-trips for ${JSON.stringify(id)}`, ref.decodeAccountRef(encoded) === id.trim().toLowerCase());
    check(`…and is URL-safe for ${JSON.stringify(id)}`, /^dse1_[A-Za-z0-9_-]+$/.test(encoded));
  }
  check("a reference the game never wrote decodes to nobody", ref.decodeAccountRef("dse1_%%%%") === null && ref.decodeAccountRef("dse1_") === null);
  check("an empty reference names nobody", ref.decodeAccountRef("") === null && ref.decodeAccountRef(null) === null);
  check("a raw safe id is accepted (a hand-written checkout still works for a smoke test)", ref.decodeAccountRef("payer") === "payer");
  check("a raw id with different case is refused (ids are stored lowercased; \"Payer\" is not an id)", ref.decodeAccountRef("Payer") === null);
  check("a padded raw id is trimmed to the id it names, never rejected as an id", ref.decodeAccountRef("  payer  ") === "payer");
  check("an over-long reference is refused", ref.decodeAccountRef(ref.encodeAccountRef("x".repeat(40))) === null);
  check("a padded/prefixed forgery cannot smuggle a short id in", ref.decodeAccountRef(ref.ACCOUNT_REF_PREFIX + "cGF5ZXI") === "payer");
}

// ===========================================================================
console.log("— 4 · the route grants exactly once, through the real store —");
{
  const now = Date.now();
  const accounts = await store.loadAccounts();
  accounts["payer"] = { passwordHash: "x", salt: "y", createdAt: now };
  accounts["فرزانه"] = { passwordHash: "x", salt: "y", createdAt: now };
  accounts["colonyless"] = { passwordHash: "x", salt: "y", createdAt: now };
  await store.saveAccounts(accounts);

  // `newGame()` builds the colony; the game id is stamped by the server when the
  // colony is created (api.ts createGameFn), so the suite stamps it here.
  const game = engine.newGame("Payer", "watchers", now);
  game.gameId = "g-payer";
  const saves = store.emptySaves();
  saves.activeGameId = game.gameId;
  saves.games[game.gameId] = game;
  await store.saveAccountSaves("payer", saves);

  const votivesOf = async (id: string) => {
    const s = await store.loadAccountSaves(id);
    return s && s.activeGameId ? s.games[s.activeGameId].currency.votives : -1;
  };

  const before = await votivesOf("payer");
  const { body, txId } = orderBody({ skus: ["votive-small"] });
  const header = sign(body);
  const first = await route.handleXsollaWebhookRequest({ rawBody: body, signatureHeader: header, secret: SECRET });
  check("a verified event is applied (204 + empty body)", first.status === 204 && first.body === null);
  check("the wallet the player sees gains exactly the pack (550 Votives)", (await votivesOf("payer")) === before + 550);
  const ledger = (await store.loadAccountSaves("payer"))!.games[saves.activeGameId as string].currency.ledger;
  check("the grant is recorded in the ledger as a purchase, not as play", ledger.some((e) => e.kind === "purchase" && e.reason.includes("Small Offering")));

  const replay = await route.handleXsollaWebhookRequest({ rawBody: body, signatureHeader: header, secret: SECRET });
  check("a REPLAYED delivery answers 204 but is idempotent", replay.status === 204 && replay.body === null);
  check("…and does not double-grant", (await votivesOf("payer")) === before + 550);

  const packBefore = (await store.loadAccountSaves("payer"))!.games[saves.activeGameId as string].resources.supplies;
  const pack = orderBody({ skus: ["scavengers-kit"] });
  const packRes = await route.handleXsollaWebhookRequest({ rawBody: pack.body, signatureHeader: sign(pack.body), secret: SECRET });
  const after = (await store.loadAccountSaves("payer"))!.games[saves.activeGameId as string];
  check("a HEAD-START PACK grants its listed resources (150 supplies)", packRes.status === 204 && after.resources.supplies === packBefore + 150);
  check("…and its entitlement is recorded", after.entitlements.packs.includes("scavengers-kit"));

  const strangerId = "nobody-here";
  const stranger = orderBody({ userRef: ref.encodeAccountRef(strangerId) });
  const strangerRes = await route.handleXsollaWebhookRequest({ rawBody: stranger.body, signatureHeader: sign(stranger.body), secret: SECRET });
  check("an account the reference decodes to but THIS SERVER DOES NOT HAVE is refused 500", strangerRes.status === 500 && strangerRes.body?.error === "unknown_account");

  const colonyless = orderBody({ userRef: ref.encodeAccountRef("colonyless") });
  const colonylessRes = await route.handleXsollaWebhookRequest({ rawBody: colonyless.body, signatureHeader: sign(colonyless.body), secret: SECRET });
  check("an account with no active colony is refused 500 (visible, retryable — never silently dropped)", colonylessRes.status === 500 && colonylessRes.body?.error === "no_active_colony");

  const faGame = engine.newGame("فرزانه", "watchers", now);
  faGame.gameId = "g-fa";
  const faSaves = store.emptySaves();
  faSaves.activeGameId = faGame.gameId;
  faSaves.games[faGame.gameId] = faGame;
  await store.saveAccountSaves("فرزانه", faSaves);
  const faBody = orderBody({ skus: ["votive-steady"], amount: "9.99", userRef: ref.encodeAccountRef("فرزانه") });
  const faRes = await route.handleXsollaWebhookRequest({ rawBody: faBody.body, signatureHeader: sign(faBody.body), secret: SECRET });
  check("a PERSIAN username pays and is credited (the reference carries any UTF-8 account id)", faRes.status === 204 && (await votivesOf("فرزانه")) === 1280);

  // ---- user_validation at the route -------------------------------------------
  // The route decodes the reference and checks the store: known → 204,
  // unknown or forged → 400 INVALID_USER (Xsolla's documented shape).
  const uvKnownBody = validationBody(REF);
  const uvKnown = await route.handleXsollaWebhookRequest({ rawBody: uvKnownBody, signatureHeader: sign(uvKnownBody), secret: SECRET });
  check("user_validation for a known account answers 204", uvKnown.status === 204 && uvKnown.body === null);
  const uvGhostBody = validationBody(ref.encodeAccountRef("ghost"));
  const uvGhost = await route.handleXsollaWebhookRequest({ rawBody: uvGhostBody, signatureHeader: sign(uvGhostBody), secret: SECRET });
  check("user_validation for an UNKNOWN account answers 400 INVALID_USER", uvGhost.status === 400 && (uvGhost.body?.error as { code?: string } | undefined)?.code === "INVALID_USER");
  const uvForgedBody = validationBody("dse1_%%%%");
  const uvForged = await route.handleXsollaWebhookRequest({ rawBody: uvForgedBody, signatureHeader: sign(uvForgedBody), secret: SECRET });
  check("user_validation for a FORGED reference answers 400 INVALID_USER", uvForged.status === 400 && (uvForged.body?.error as { code?: string } | undefined)?.code === "INVALID_USER");

  // ---- a cancellation is a no-op -------------------------------------------------
  // (the pack above also granted 150 Votives — the point here is the cancel
  // moves nothing, so measure against the pre-cancel wallet, not the pre-test one)
  const cancelVotivesBefore = await votivesOf("payer");
  const cancel = orderBody({ type: "order_canceled" });
  const cancelRes = await route.handleXsollaWebhookRequest({ rawBody: cancel.body, signatureHeader: sign(cancel.body), secret: SECRET });
  check("order_canceled answers 204 and touches nothing", cancelRes.status === 204 && cancelRes.body === null && (await votivesOf("payer")) === cancelVotivesBefore);

  // ---- §4b · A TIME TOKEN, END TO END -------------------------------------------
  //
  // Money in at Xsolla → one held token of that size in the colony, keyed by the
  // transaction id so a re-delivered webhook cannot double-grant, with no
  // resource, no Votives and no strength moving with it.
  const grants = async (id: string) => {
    const s = await store.loadAccountSaves(id);
    const g = s?.games[s.activeGameId as string] as unknown as {
      timeTokens?: Record<string, number>;
      timeTokenLedger?: Array<{ kind: string; sizeId: string; amount: number; eventId: string; reason: string }>;
      resources: Record<string, number>;
    };
    return g;
  };
  const tokensOf = async (id: string, size: string) => ((await grants(id))?.timeTokens ?? {})[size] ?? 0;

  const votivesBeforeToken = await votivesOf("payer");
  const suppliesBeforeToken = (await grants("payer")).resources.supplies;
  const tokenBuy = orderBody({ skus: ["time-token-8h"], amount: "7.99" });
  const tokenRes = await route.handleXsollaWebhookRequest({ rawBody: tokenBuy.body, signatureHeader: sign(tokenBuy.body), secret: SECRET });
  check("a verified 8h TOKEN order is applied (204) and grants exactly one held token",
    tokenRes.status === 204 && (await tokensOf("payer", "8h")) === 1,
    JSON.stringify(tokenRes));
  const tokenLedger = (await grants("payer")).timeTokenLedger ?? [];
  check("…recorded in the TOKEN LEDGER, keyed by the purchase (Xsolla transaction) id",
    tokenLedger.some((e) => e.kind === "earn" && e.sizeId === "8h" && e.amount === 1
      && e.eventId === `purch:${tokenBuy.txId}` && e.reason.includes(tokenBuy.txId)),
    JSON.stringify(tokenLedger));
  check("…and the colony's wallet and stores did NOT move (a token is TIME, never a resource)",
    (await votivesOf("payer")) === votivesBeforeToken && (await grants("payer")).resources.supplies === suppliesBeforeToken);
  const tokenReplay = await route.handleXsollaWebhookRequest({ rawBody: tokenBuy.body, signatureHeader: sign(tokenBuy.body), secret: SECRET });
  check("a REPLAYED token delivery answers 204 but is idempotent — no second token",
    tokenReplay.status === 204 && (await tokensOf("payer", "8h")) === 1);
  const tokenWrong = orderBody({ skus: ["time-token-48h"], amount: "7.99" });
  const tokenWrongRes = await route.handleXsollaWebhookRequest({ rawBody: tokenWrong.body, signatureHeader: sign(tokenWrong.body), secret: SECRET });
  check("an order paying the 8h price for the 48h token is refused 500 and grants NOTHING",
    tokenWrongRes.status === 500 && tokenWrongRes.body?.error === "amount_mismatch" && (await tokensOf("payer", "48h")) === 0);
  const tokenUnknownSku = orderBody({ skus: ["time-token-3h"], amount: "7.99" });
  const tokenUnknownRes = await route.handleXsollaWebhookRequest({ rawBody: tokenUnknownSku.body, signatureHeader: sign(tokenUnknownSku.body), secret: SECRET });
  check("a token size the game does not define is refused 500 unknown_sku (loud, never a silent grant)",
    tokenUnknownRes.status === 500 && tokenUnknownRes.body?.error === "unknown_sku");
  const tokenEarnedSize = orderBody({ skus: ["time-token-1m"], amount: "1.00" });
  const tokenEarnedRes = await route.handleXsollaWebhookRequest({ rawBody: tokenEarnedSize.body, signatureHeader: sign(tokenEarnedSize.body), secret: SECRET });
  check("NEGATIVE CONTROL · the EARNED size 1m cannot be bought from the route either (no row, refused by name)",
    tokenEarnedRes.status === 500 && tokenEarnedRes.body?.error === "unknown_sku" && (await tokensOf("payer", "1m")) === 0);

  const forgedBefore = await votivesOf("payer");
  const forged = orderBody();
  const forgedRes = await route.handleXsollaWebhookRequest({ rawBody: forged.body, signatureHeader: sign(forged.body, "forged_key"), secret: SECRET });
  check("a FORGED request grants nothing at all", forgedRes.status === 400 && (await votivesOf("payer")) === forgedBefore);

  const noSecretRes = await route.handleXsollaWebhookRequest({ rawBody: forged.body, signatureHeader: sign(forged.body), secret: null });
  check("with no secret configured the route refuses (500) rather than granting", noSecretRes.status === 500 && noSecretRes.body?.error === "no_secret_key");

  check("readWebhookSecret reads the env var, trims it, and treats blank as unset", route.readWebhookSecret({ XSOLLA_WEBHOOK_SECRET: " secret_x " }) === "secret_x" && route.readWebhookSecret({}) === null && route.readWebhookSecret({ XSOLLA_WEBHOOK_SECRET: "  " }) === null);
  check("the env var name is the one the ops notes tell the lead to set", route.XSOLLA_WEBHOOK_SECRET_ENV === "XSOLLA_WEBHOOK_SECRET");
  check("webhookResponse renders 204 with an empty body", route.webhookResponse({ status: 204, body: null }).status === 204);
}

// ===========================================================================
console.log("— 5 · the factory, the token mint, the catalog wiring —");
{
  const prov = monetization.createPaymentProvider();
  check("createPaymentProvider() NO LONGER returns the stub", prov.name === "XsollaPaymentProvider");
  check("…and an unconfigured provider refuses a plausible payload instead of simulating one", (await prov.verifyWebhook({ purchaseId: "p1", skuId: "votive-small", accountId: "a" })).ok === false);
  check("createIntent is refused honestly when unconfigured (no project id, no token, no checkout)", (await providerMod.createXsollaPaymentProvider({}).createIntent({ accountId: "a", skuId: "votive-small", idempotencyKey: "k", amountCents: 499, currency: "usd" })).ok === false);
  check("refund is refused honestly (refunds happen in the Xsolla Publisher Account)", (await providerMod.createXsollaPaymentProvider({ projectId: "1", apiKey: "k" }).refund({ purchaseId: "p1", reason: "x" })).ok === false);
  check("Basic auth is exactly the documented form", providerMod.xsollaBasicAuth("123", "key") === "Basic " + Buffer.from("123:key", "utf8").toString("base64"));

  // ---- token minting, with the network stubbed ---------------------------------
  // createXsollaPaymentProvider.createIntent uses the global fetch; the stub
  // below stands in for the Xsolla API server so the request shape can be read.
  const realFetch = globalThis.fetch;
  let seenUrl = "";
  let seenInit: RequestInit = {};
  const okToken = { token: "tok_abc123", order_id: 98765 };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(url);
    seenInit = init ?? {};
    return new Response(JSON.stringify(okToken), { status: 201, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const configured = providerMod.createXsollaPaymentProvider({
    projectId: "999",
    apiKey: "api_key",
    sandbox: true,
    returnUrlFor: (skuId) => catalog.xsollaReturnUrlFor({ skuId, sandbox: true, canonicalOrigin: "https://play.example" }),
  });
  const mint = await configured.createIntent({ accountId: "payer", skuId: "votive-small", idempotencyKey: "k1", amountCents: 499, currency: "usd" });
  check("a configured provider mints a token and returns the SANDBOX Pay Station URL",
    mint.ok === true && mint.url === `${providerMod.XSOLLA_PAY_STATION_SANDBOX_URL}tok_abc123` && mint.intentId === "xsolla-98765");
  const reqBody = JSON.parse(String((seenInit as { body?: string }).body));
  check("the token request carries the game's SKU, the user reference and the return url",
    seenUrl === "https://store.xsolla.com/api/v3/project/999/admin/payment/token"
    && reqBody?.user?.id?.value === REF
    && reqBody?.custom_parameters?.dse_account_ref === REF
    && reqBody?.custom_parameters?.dse_sku === "votive-small"
    && reqBody?.purchase?.items?.[0]?.sku === "votive-small"
    && reqBody?.settings?.currency === "USD"
    && reqBody?.settings?.return_url === catalog.xsollaReturnUrlFor({ skuId: "votive-small", sandbox: true, canonicalOrigin: "https://play.example" })
    && reqBody?.sandbox === true);
  check("the request is Basic-authed over the project id and API key",
    (seenInit.headers as Record<string, string>).Authorization === providerMod.xsollaBasicAuth("999", "api_key"));
  globalThis.fetch = realFetch;

  // ---- the mint refuses honestly ------------------------------------------------
  const mintInput = { projectId: "1", apiKey: "k", accountId: "payer", returnUrl: "https://x" };
  check("minting an unknown SKU is refused", (await providerMod.mintXsollaPaymentToken({ ...mintInput, skuId: "votive-mega" })).ok === false);
  check("minting a NOT-SELLABLE SKU is refused (the six tokens have catalog rows but no shop)",
    (await providerMod.mintXsollaPaymentToken({ ...mintInput, skuId: "time-token-8h" })).ok === false);
  check("minting without a project id is refused before any network happens",
    await (async () => {
      const r = await providerMod.mintXsollaPaymentToken({ ...mintInput, projectId: "", skuId: "votive-small", fetchImpl: async () => { throw new Error("must not be called"); } });
      return r.ok === false && String(r.error).includes("not configured");
    })());
  check("a network failure is refused, never retried silently", (await providerMod.mintXsollaPaymentToken({ ...mintInput, skuId: "votive-small", fetchImpl: async () => { throw new Error("down"); } })).ok === false);
  check("a non-2xx Xsolla answer is refused with its status",
    (await providerMod.mintXsollaPaymentToken({ ...mintInput, skuId: "votive-small", fetchImpl: async () => new Response(JSON.stringify({ message: "bad project" }), { status: 401 }) })).error === "Xsolla refused the checkout (HTTP 401: bad project).");
  check("a 2xx answer with no token is refused", (await providerMod.mintXsollaPaymentToken({ ...mintInput, skuId: "votive-small", fetchImpl: async () => new Response("{}", { status: 201 }) })).ok === false);
  const liveMint = await providerMod.mintXsollaPaymentToken({ ...mintInput, skuId: "votive-small", fetchImpl: async () => new Response(JSON.stringify({ token: "t1" }), { status: 200 }) });
  check("a live mint returns the LIVE Pay Station URL", liveMint.ok === true && liveMint.payUrl === `${providerMod.XSOLLA_PAY_STATION_URL}t1`);

  // ---- THE WIRING ----------------------------------------------------------------
  //
  // Thirteen catalog rows, every one pinned against the game's own catalogue:
  // the seven sellable SKUs plus the six time tokens, which have rows and NO
  // shop surface. Xsolla-side SKU for every row is the game's own sku id, so a
  // typo cannot ship as a "wired" object.
  check("the catalog carries thirteen rows — the seven sellable SKUs plus the six time tokens",
    catalog.XSOLLA_CATALOG.length === 13, String(catalog.XSOLLA_CATALOG.length));
  const votiveIds = monetization.VOTIVE_PACKS.map((p) => p.id);
  const kitIds = monetization.HEAD_START_PACKS.map((p) => p.id);
  const tokenIds = monetization.TIME_TOKEN_PACKS.map((p) => p.id);
  check("every catalog row exists in the game's own catalogue",
    catalog.XSOLLA_CATALOG.every((r) => votiveIds.includes(r.skuId) || kitIds.includes(r.skuId) || tokenIds.includes(r.skuId)));
  const priceOk = catalog.XSOLLA_CATALOG.every((r) => {
    const v = monetization.VOTIVE_PACKS.find((p) => p.id === r.skuId);
    const k = monetization.HEAD_START_PACKS.find((p) => p.id === r.skuId);
    const t = monetization.TIME_TOKEN_PACKS.find((p) => p.id === r.skuId);
    return r.amountUsd === (v?.priceUsd ?? k?.priceUsd ?? t?.priceUsd);
  });
  check("…and every price matches the catalogue exactly (the tripwire cannot drift from the game)", priceOk);
  check("the Xsolla-side SKU is the game's own id for every row (no mapping table to typo)",
    catalog.XSOLLA_CATALOG.every((r) => catalog.xsollaSkuFor(r.skuId) === r.skuId && catalog.skuForXsollaSku(r.skuId) === r.skuId));
  check("a foreign SKU maps to nothing", catalog.skuForXsollaSku("someone_elses_sku") === null && catalog.xsollaCatalogRow("nope") === null);

  // ---- WHAT THE PLAYER CAN REACH ---------------------------------------------
  check("exactly the seven sellable SKUs are sellable — the six tokens carry rows and NO surface",
    catalog.sellableSkus().length === 7 && catalog.sellableSkus().every((s) => !s.startsWith("time-token-")), catalog.sellableSkus().join(","));
  check("no token is sellable", tokenIds.every((id) => !catalog.isSellable(id)));
  // NEGATIVE CONTROL: the allow-list is read from `enabled`, not from the row's
  // existence — so the check above cannot be vacuous.
  const controlRow = catalog.xsollaCatalogRow("votive-small")!;
  controlRow.enabled = false;
  const droppedOut = !catalog.isSellable("votive-small") && catalog.sellableSkus().length === 6;
  controlRow.enabled = true;
  check("NEGATIVE CONTROL · disabling a live row takes that SKU out of the allow-list",
    droppedOut && catalog.isSellable("votive-small") && catalog.sellableSkus().length === 7);

  // ---- the return url ----------------------------------------------------------
  const ret = catalog.xsollaReturnUrlFor({ skuId: "votive-small", origin: "https://game.example" });
  check("the return url keeps the sku and the return marker so the ledger can open honestly",
    ret === "https://game.example/play?purchase=return&sku=votive-small");
  check("…an http origin is refused in live mode", catalog.xsollaReturnUrlFor({ skuId: "votive-small", origin: "http://game.example" }) === null);
  check("…but accepted in sandbox mode", catalog.xsollaReturnUrlFor({ skuId: "votive-small", origin: "http://localhost:5173", sandbox: true }) === "http://localhost:5173/play?purchase=return&sku=votive-small");
  check("…and a garbage origin falls back to the canonical site, never to a null",
    catalog.xsollaReturnUrlFor({ skuId: "votive-small", origin: "https://", canonicalOrigin: "https://play.deepspace-engine.gg" }) === "https://play.deepspace-engine.gg/play?purchase=return&sku=votive-small");

  check("the storefront switch is still OFF in this commit", monetization.MONETIZATION_CONFIG.storefrontEnabled === false);

  // The two servers on one path, and the client kept out of the server module.
  const serveSrc = read("serve.ts");
  const viteSrc = read("vite.config.ts");
  check("serve.ts answers the Xsolla webhook path (the published build)", serveSrc.includes("XSOLLA_WEBHOOK_PATH") && serveSrc.includes("handleXsollaWebhookRequest"));
  check("vite.config.ts repeats the SAME path literal (the dev host behaves identically)", viteSrc.includes(`"${route.XSOLLA_WEBHOOK_PATH}"`));
  check("the dev middleware loads the same handler through ssrLoadModule", viteSrc.includes("/src/game/payments/webhook-route.ts") && viteSrc.includes("ssrLoadModule"));
  const clientFiles = [
    "src/components/StorefrontOverlay.tsx",
    "src/routes/play.tsx",
    "src/game/monetization.ts",
    "src/game/payments/xsolla-catalog.ts",
    "src/game/payments/purchase-intent.ts",
  ];
  // An IMPORT of the server module, not a mention of its name in prose: the
  // specifier is quoted, a comment is not.
  const importsServer = (src: string) => /["'][^"'\n]*webhook-route[^"'\n]*["']/.test(src);
  check("no client file imports the server handler (the store can never be reached from the browser)", clientFiles.every((f) => !importsServer(read(f))));
  check("…while serve.ts does import it (the check above can actually fail)", importsServer(read("serve.ts")));
  const overlay = read("src/components/StorefrontOverlay.tsx");
  check("the storefront opens the Pay Station url the authenticated checkout mints, in the same tab", overlay.includes("xsollaCheckoutFn") && overlay.includes("window.location.assign(res.url)"));
  check("…and a SKU is buyable only when the store is open, the player is signed in, and its catalog row exists", overlay.includes("storeOpen && signedIn && isSellable("));
  check("…and the client never grants anything (no entitlement write on the buy path)", !overlay.includes("saveActiveState") && !overlay.includes("applyExternalPurchase"));
  const apiSrc = read("src/game/api.ts");
  check("the checkout fn reads the Xsolla project credentials from the server environment…",
    apiSrc.includes("XSOLLA_PROJECT_ID") && apiSrc.includes("XSOLLA_API_KEY"));
  check("…and returns ONLY the Pay Station URL to the client (the API key never leaves the server)",
    apiSrc.includes("return { ok: true, url: intent.url };"));

  // ---- i18n: the store's strings are keyed and translated in all five languages --
  const cat = (await import(`${SITE}/src/game/i18n/index.ts`)) as { CATALOGUES: Record<string, Record<string, string>>; SOURCE_LANG: string };
  const storeKeys = Object.keys(cat.CATALOGUES[cat.SOURCE_LANG]).filter((k) => k.startsWith("store."));
  // 13 keys from the payments slice (the buy control, the honest reasons it can be
  // locked, the post-purchase panel) + 30 from the store-copy slice.
  check("every store string the player reads is keyed (13 payments + 30 store-copy)", storeKeys.length === 43, storeKeys.join(","));
  for (const code of ["es", "pt-BR", "ru", "fa"]) {
    check(`${code} translates every one of them`, storeKeys.every((k) => (cat.CATALOGUES[code][k] ?? "").length > 0));
    check(`${code} keeps every {placeholder}`, storeKeys.every((k) => {
      const params = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
      return params(cat.CATALOGUES[code][k] ?? "") === params(cat.CATALOGUES.en[k]);
    }));
  }

  /** The key one grant bullet renders under — mirrors grantNoteKey() in the overlay. */
  const noteKey = (packId: string, g: any): string =>
    `store.pack.${packId}.g.${g.kind}.${g.kind === "resource" ? g.key : g.kind === "currency" ? g.currency : g.kind === "cosmetic" ? g.itemId : g.vehicleId}`;
  // Pack lines are rendered through TEMPLATE keys, so the i18n suite's dead-lookup
  // scan treats them as a dynamic family and cannot see the individual keys. This
  // suite checks them one by one: the key exists, its English value IS the catalog
  // literal, and all four other files carry a translation.
  const packLines: [string, string][] = [];
  for (const p of monetization.HEAD_START_PACKS) {
    packLines.push([`store.pack.${p.id}.blurb`, p.blurb]);
    packLines.push([`store.pack.${p.id}.play`, p.playEquivalent]);
    for (const g of p.grants) packLines.push([noteKey(p.id, g), g.note]);
  }
  check(`every pack line the store renders is keyed in English, verbatim (${packLines.length} lines)`,
    packLines.every(([k, v]) => cat.CATALOGUES.en[k] === v),
    packLines.filter(([k, v]) => cat.CATALOGUES.en[k] !== v).map(([k]) => k).join(","));
  check("…and every one of them is translated in the other four files",
    packLines.every(([k]) => ["es", "pt-BR", "ru", "fa"].every((c) => (cat.CATALOGUES[c][k] ?? "").length > 0)));
  const KEYED_COSMETICS = ["votive-bell", "wardens-livery", "the-contribution-ring"];
  check("the three rewritten cosmetic blurbs are keyed in English, verbatim",
    KEYED_COSMETICS.every((id) => cat.CATALOGUES.en[`store.cosmetic.${id}.blurb`] === monetization.COSMETIC_BY_ID[id].blurb));
  check("…and translated in the other four files",
    KEYED_COSMETICS.every((id) => ["es", "pt-BR", "ru", "fa"].every((c) => (cat.CATALOGUES[c][`store.cosmetic.${id}.blurb`] ?? "").length > 0)));

  /**
   * THE STORE SURFACE — gated on INTENT, not on wording.
   *
   * OWNER RULING (2026-09-13): store copy carries NO pay-to-win and NO limitation
   * language. G1–G4 verbatim, "no solo win", the "earnable in play / a head start
   * within the earned cap" footer, "no tier skips", and any what-you-can't-do framing
   * are OUT of the player's view — the store presents the packs and lets people buy.
   *
   * This scan asserts the same intent over everything the player can actually
   * read — every store.* value, every pack line, every cosmetic name and blurb, and
   * the overlay's own markup with comments stripped — so a string that is rendered but
   * never keyed cannot hide from it either.
   *
   * NOTE (2026-09-30): the owner has since REVOKED the no-pay-to-win guardrails and
   * ordered a fresh monetization direction. This scan stays until the revamp lands —
   * it pins the CURRENT store copy, which predates the revamp.
   */
  const LIMITATION = /earnable|earned cap|head[-\s]start|never (?:buy|buyable|for sale|sale)|pay-to-win|p2w|solo win|no solo|tier[-\s]?skip|timers? skipped|no research|no oracle trust|hero power|no stat|no speed|no edge|craftable/i;
  // ONE documented allowance: "Head-Start Packs" is the pack CATEGORY's name — the
  // words the catalog itself uses for the group. It asserts nothing about a purchase,
  // and "a head start on the earned curve" still fails the scan (proved below).
  const CATEGORY_NAME = /head[-\s]?start packs?/gi;
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(CATEGORY_NAME, "");
  const scan = (where: string, text: string) => (strip(text).match(LIMITATION) ?? []).map((h) => `${where}: "${h}"`);
  const storeCopy: [string, string][] = [
    ...storeKeys.map((k) => [k, cat.CATALOGUES.en[k]] as [string, string]),
    ...packLines,
    ...monetization.COSMETICS.map((c) => [`cosmetic:${c.id}`, c.name] as [string, string]),
    ...monetization.COSMETICS.map((c) => [`cosmetic:${c.id}`, c.blurb] as [string, string]),
  ];
  const leaks = storeCopy.flatMap(([k, v]) => scan(k, v));
  // …plus the overlay's own markup, comments stripped: its JSX text and any literal
  // that renders without going through the catalogue.
  leaks.push(...scan("StorefrontOverlay.tsx", read("src/components/StorefrontOverlay.tsx")));
  check(`NO limitation or anti-P2W language anywhere in the store surface (${storeKeys.length} keys + ${packLines.length} pack lines + ${monetization.COSMETICS.length * 2} cosmetic lines + the overlay)`,
    leaks.length === 0, leaks.slice(0, 6).join(" | "));
  check("the scan is not vacuous — every line we removed is caught by it",
    LIMITATION.test("Purchases may strengthen a colony — they can never win a battle alone. Hero power is never for sale. No timers skipped · no research · no Oracle trust.") &&
    LIMITATION.test("Everything a pack grants is craftable or earnable in play — a head start on the earned curve, never above it. Packs are purchased with real money; none are purchasable yet.") &&
    LIMITATION.test("Passes never expire. Unclaimed items return next season. No tier skips are sold.") &&
    LIMITATION.test("Pure appearance — no stat, no speed, no edge. Owned items show their server-recorded check; deed items live below in the commemorative section.") &&
    LIMITATION.test("Deed cosmetics are won by what you do in the world, not by what you spend. They appear here so their deeds stay visible — they are viewable, never buyable."));
  check("…and the single allowance is narrow: the category name passes, the claim does not",
    !LIMITATION.test(strip("Head-Start Packs")) && LIMITATION.test(strip("a head start on the earned curve")));
  check("…and an identifier that merely starts with those letters is not copy (no false positive)",
    !LIMITATION.test("HeadStartPackDef") && !LIMITATION.test("HEAD_START_PACKS"));

  // THE GUARDRAIL IS INTERNAL — and, until the revamp lands, still armed. G1–G4
  // live in the code, not on the store surface, and assertCatalogFair() still
  // refuses a catalog that carries power vocabulary.
  const monSrc = read("src/game/monetization.ts");
  check("the fairness guardrail still exists in code (FORBIDDEN_POWER_TERMS + assertCatalogFair)",
    /FORBIDDEN_POWER_TERMS/.test(monSrc) && /export function assertCatalogFair/.test(monSrc));
  check("…and it still bites: a planted power term in pack copy makes the guard throw", (() => {
    const p = monetization.HEAD_START_PACKS[0];
    const before = p.blurb;
    try {
      p.blurb = `${before} includes a tier skip`;
      monetization.assertCatalogFair();
      return false;
    } catch {
      return true;
    } finally {
      p.blurb = before;
    }
  })());

  // The post-purchase note.
  const memory = new Map<string, string>();
  const fakeStorage = {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
  const wallet = { currency: { votives: 0, scrip: 10 }, entitlements: { packs: [], cosmetics: [], passes: [] }, battlePass: { premium: false } };
  const sig = intent.walletSignature(wallet);
  intent.savePurchaseIntent(fakeStorage, { skuId: "votive-small", signature: sig, at: Date.now() });
  check("the purchase note round-trips (and is what tells 'it landed' from 'not yet')", intent.readPurchaseIntent(fakeStorage)?.skuId === "votive-small");
  check("a wallet that grew does NOT match the note (that is the confirmation signal)", intent.walletSignature({ ...wallet, currency: { votives: 550, scrip: 10 } }) !== sig);
  check("a wallet whose TIME TOKENS grew does NOT match the note either — a token purchase confirms like any other",
    intent.walletSignature({ ...wallet, timeTokens: { "1m": 0, "5m": 0, "8h": 1 } }) !== sig
    && intent.walletSignature({ ...wallet, timeTokens: { "1m": 0, "5m": 0, "8h": 1 } }) !== intent.walletSignature({ ...wallet })
    && intent.walletSignature({ ...wallet }) === intent.walletSignature({ ...wallet, timeTokens: {} })
    // compared PER SIZE: a size that moved is a change even when the total did not
    && intent.walletSignature({ ...wallet, timeTokens: { "1m": 1 } }) !== intent.walletSignature({ ...wallet, timeTokens: { "5m": 1 } }));
  check("a stale note reads as absent — an old note can never claim a purchase", intent.readPurchaseIntent(fakeStorage, Date.now() + intent.PURCHASE_INTENT_TTL_MS + 1) === null);
  intent.clearPurchaseIntent(fakeStorage);
  check("the note can be cleared (Dismiss)", intent.readPurchaseIntent(fakeStorage) === null);
}

rmSync(SCRATCH, { recursive: true, force: true });
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
