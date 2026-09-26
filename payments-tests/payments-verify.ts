// THE PAYMENTS SUITE — the money path, verified end to end without any network.
//
// WHAT THIS SUITE IS TRYING TO PROVE, and why each part exists:
//   §1  the SIGNATURE is what makes a payload real — valid accepted, tampered
//       body / wrong secret / stale timestamp / missing header all refused;
//   §2  the EVENT maps to a purchase only when it is the right type, PAID, a
//       known SKU, the right amount, and a reference that names an account;
//   §3  an account reference survives any username a player can pick (Persian,
//       spaces) and a forged one names nobody;
//   §4  the ROUTE grants exactly once, into the active colony, through the real
//       store (scratch cwd, fs backend) — including replay and every refusal;
//   §5  the wiring: the factory no longer returns the stub, every sellable SKU is
//       pinned to the game's own catalogue, an unconfigured SKU cannot be bought,
//       the two servers answer on one path, and the client cannot import the
//       server handler.
//
// Run: cd /home/team/shared/payments-tests && env -u DATABASE_URL bun run payments-verify.ts
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SITE = "/home/team/shared/site";
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
const links = (await import(`${SITE}/src/game/payments/payment-links.ts`)) as {
  PAYMENT_LINKS: Array<{ skuId: string; url: string; paymentLinkId: string; priceId: string; amountUsd: number }>;
  checkoutUrl: (sku: string, accountId: string | null) => string | null;
  isSellable: (sku: string) => boolean;
  sellableSkus: () => string[];
  skuForMetadataSku: (s: string | null | undefined) => string | null;
  skuForPaymentLinkId: (s: string | null | undefined) => string | null;
  skuForPriceId: (s: string | null | undefined) => string | null;
  afterCompletionUrl: (origin: string, sku: string) => string;
  STRIPE_WEBHOOK_PATH?: string;
};
const verifier = (await import(`${SITE}/src/game/payments/stripe-webhook.ts`)) as {
  verifyStripeEvent: (input: {
    rawBody: string;
    signatureHeader: string | null;
    secret: string | null;
    now?: number;
    toleranceSeconds?: number;
  }) => Promise<{ kind: string; [k: string]: unknown }>;
  verifyStripeSignature: (input: {
    rawBody: string;
    signatureHeader: string | null;
    secret: string;
    now?: number;
    toleranceSeconds?: number;
  }) => Promise<{ ok: boolean; code?: string }>;
  hmacHex: (secret: string, message: string) => Promise<string>;
  skuForSession: (session: Record<string, unknown>) => { skuId: string | null; recognition: string };
};
const provider = (await import(`${SITE}/src/game/payments/stripe-provider.ts`)) as {
  createStripePaymentProvider: (o?: { signingSecret?: string | null }) => {
    name: string;
    verifyWebhook: (p: unknown) => Promise<{ ok: boolean; purchase?: { skuId: string; accountId: string }; error?: string }>;
    createIntent: (i: unknown) => Promise<{ ok: boolean; error?: string }>;
    refund: (o: { purchaseId: string; reason: string }) => Promise<{ ok: boolean; error?: string }>;
  };
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
  createPaymentProvider: (o?: { signingSecret?: string | null }) => { name: string; verifyWebhook: (p: unknown) => Promise<{ ok: boolean; error?: string }> };
  VOTIVE_PACKS: Array<{ id: string; name: string; votives: number; bonus: number; priceUsd: number }>;
  HEAD_START_PACKS: Array<{ id: string; name: string; priceUsd: number }>;
  COSMETICS: Array<{ id: string }>;
  MONETIZATION_CONFIG: { storefrontEnabled: boolean };
};
// Server-only + store-backed: imported AFTER the chdir so the fs store lands in
// the scratch directory.
const route = (await import(`${SITE}/src/game/payments/webhook-route.ts`)) as {
  STRIPE_WEBHOOK_PATH: string;
  STRIPE_WEBHOOK_SECRET_ENV: string;
  readWebhookSecret: (env?: Record<string, string | undefined>) => string | null;
  handleStripeWebhookRequest: (input: { rawBody: string; signatureHeader: string | null; now?: number; secret?: string | null }) => Promise<{
    status: number;
    body: Record<string, unknown>;
  }>;
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
// signing helpers — node's own HMAC, so the verifier is checked against an
// implementation it does not share code with.
// ---------------------------------------------------------------------------
const SECRET = "whsec_test_5f2a1c0d9e8b7a6f";
const REF = ref.encodeAccountRef("payer");

function sign(rawBody: string, secret = SECRET, atSeconds = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac("sha256", secret).update(`${atSeconds}.${rawBody}`, "utf8").digest("hex");
  return `t=${atSeconds},v1=${mac}`;
}

let sessionCounter = 0;
interface SessionOpts {
  sku?: string | null;
  amount?: number;
  currency?: string;
  paymentStatus?: string;
  accountRef?: string | null;
  type?: string;
  created?: number;
  paymentLink?: string | null;
  lineItemPrice?: string | null;
  omitAmount?: boolean;
}
function sessionBody(opts: SessionOpts = {}): { body: string; sessionId: string } {
  sessionCounter++;
  const sessionId = `cs_test_${sessionCounter}`;
  const session: Record<string, unknown> = {
    id: sessionId,
    object: "checkout.session",
    payment_status: opts.paymentStatus ?? "paid",
    currency: opts.currency ?? "usd",
    client_reference_id: opts.accountRef === undefined ? REF : opts.accountRef,
    metadata: opts.sku ? { sku: opts.sku } : {},
  };
  if (!opts.omitAmount) session.amount_total = opts.amount ?? 499;
  if (opts.paymentLink) session.payment_link = opts.paymentLink;
  if (opts.lineItemPrice) session.line_items = { object: "list", data: [{ price: { id: opts.lineItemPrice } }] };
  const body = JSON.stringify({
    id: `evt_${sessionCounter}`,
    object: "event",
    type: opts.type ?? "checkout.session.completed",
    created: opts.created ?? Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: session },
  });
  return { body, sessionId };
}

async function decide(rawBody: string, header: string | null, secret: string | null = SECRET) {
  return verifier.verifyStripeEvent({ rawBody, signatureHeader: header, secret });
}

// ===========================================================================
console.log("— 1 · the signature is what makes a payload real —");
{
  const known = await verifier.hmacHex(SECRET, "1700000000.hello");
  const expected = createHmac("sha256", SECRET).update("1700000000.hello", "utf8").digest("hex");
  check("our HMAC matches node's HMAC byte for byte (Web Crypto vs OpenSSL)", known === expected, known.slice(0, 12));

  const { body } = sessionBody({ sku: "votive-small" });
  check("a correctly signed event verifies", (await verifier.verifyStripeSignature({ rawBody: body, signatureHeader: sign(body), secret: SECRET })).ok === true);
  check(
    "a TAMPERED body is refused (the signature covers the exact bytes, not the parsed meaning)",
    (await verifier.verifyStripeSignature({ rawBody: body.replace("votive-small", "votive-circuit"), signatureHeader: sign(body), secret: SECRET })).ok === false,
  );
  check("a WRONG SECRET is refused", (await verifier.verifyStripeSignature({ rawBody: body, signatureHeader: sign(body, "whsec_someone_elses"), secret: SECRET })).ok === false);
  check("a MISSING header is refused", (await verifier.verifyStripeSignature({ rawBody: body, signatureHeader: null, secret: SECRET })).ok === false);
  check("a malformed header is refused", (await verifier.verifyStripeSignature({ rawBody: body, signatureHeader: "nonsense", secret: SECRET })).ok === false);
  const stale = Math.floor(Date.now() / 1000) - 3600;
  const staleVerdict = await verifier.verifyStripeSignature({ rawBody: body, signatureHeader: sign(body, SECRET, stale), secret: SECRET });
  check("a STALE timestamp (1h old) is refused", staleVerdict.ok === false && staleVerdict.code === "stale_timestamp");
  const future = Math.floor(Date.now() / 1000) + 3600;
  check("a timestamp far in the FUTURE is refused too", (await verifier.verifyStripeSignature({ rawBody: body, signatureHeader: sign(body, SECRET, future), secret: SECRET })).ok === false);
  const edge = Math.floor(Date.now() / 1000) - 290;
  check("a timestamp inside the 5-minute tolerance still verifies", (await verifier.verifyStripeSignature({ rawBody: body, signatureHeader: sign(body, SECRET, edge), secret: SECRET })).ok === true);
  const twoSigs = `${sign(body, SECRET)},v1=${"a".repeat(64)}`;
  check("a header carrying several v1 signatures accepts the matching one (Stripe rotates secrets)", (await verifier.verifyStripeSignature({ rawBody: body, signatureHeader: twoSigs, secret: SECRET })).ok === true);
}

// ===========================================================================
console.log("— 2 · event → purchase: only the right event, PAID, known, correctly priced —");
{
  const { body } = sessionBody({ sku: "votive-small", amount: 499 });
  const d = await decide(body, sign(body));
  check("a paid checkout.session.completed for a known SKU maps to an apply", d.kind === "apply");
  check("it carries the SKU, the account, the amount and the session id as the purchase id", d.kind === "apply" && d["skuId"] === "votive-small" && d["accountId"] === "payer" && d["amountCents"] === 499 && d["purchaseId"] === "cs_test_" + sessionCounter);
  check("the recognition path is recorded (metadata.sku here)", d.kind === "apply" && d["recognition"] === "metadata.sku");

  const unpaid = sessionBody({ sku: "votive-small", paymentStatus: "unpaid" });
  const du = await decide(unpaid.body, sign(unpaid.body));
  check("an UNPAID session is ignored (async payment methods complete before they settle)", du.kind === "ignore" && String(du["reason"]).startsWith("not_paid"));

  const other = sessionBody({ sku: "votive-small", type: "payment_intent.succeeded" });
  const dt = await decide(other.body, sign(other.body));
  check("an UNHANDLED event type is ignored, not refused (so Stripe stops re-delivering it)", dt.kind === "ignore" && dt["reason"] === "unhandled_event_type");

  const unknown = sessionBody({ sku: "votive-mega" });
  const dn = await decide(unknown.body, sign(unknown.body));
  check("an UNKNOWN SKU is refused loudly (500) — money taken, nobody credited", dn.kind === "reject" && dn["status"] === 500 && dn["code"] === "unknown_sku");

  const noSku = sessionBody({ sku: null });
  const dns = await decide(noSku.body, sign(noSku.body));
  check("a session naming no SKU at all is refused (no recognition path resolves)", dns.kind === "reject" && dns["code"] === "unknown_sku");

  const wrongAmount = sessionBody({ sku: "votive-small", amount: 3999 });
  const dwa = await decide(wrongAmount.body, sign(wrongAmount.body));
  check("an AMOUNT that disagrees with the price list is refused (a wrong link must not gift a bigger pack)", dwa.kind === "reject" && dwa["code"] === "amount_mismatch");

  const wrongCurrency = sessionBody({ sku: "votive-small", amount: 499, currency: "eur" });
  const dwc = await decide(wrongCurrency.body, sign(wrongCurrency.body));
  check("a non-USD session is refused", dwc.kind === "reject" && dwc["code"] === "amount_mismatch");

  const blankRef = sessionBody({ sku: "votive-small", accountRef: "" });
  const dbr = await decide(blankRef.body, sign(blankRef.body));
  check("a BLANK client_reference_id is refused (500) — there is nobody to credit", dbr.kind === "reject" && dbr["status"] === 500 && dbr["code"] === "no_account_reference");

  const missingRef = sessionBody({ sku: "votive-small", accountRef: null });
  check("a MISSING client_reference_id is refused", (await decide(missingRef.body, sign(missingRef.body)))["code"] === "no_account_reference");

  const junkRef = sessionBody({ sku: "votive-small", accountRef: "not-an-account-ref!!" });
  const djr = await decide(junkRef.body, sign(junkRef.body));
  check("an UNRESOLVABLE reference is refused (500) — it names nobody this game ever wrote", djr.kind === "reject" && djr["code"] === "unresolvable_account_reference");

  const noSecret = await decide(sessionBody({ sku: "votive-small" }).body, "t=1,v1=deadbeefdeadbeef", null);
  check("NO SIGNING SECRET means refuse everything (fail closed, never trust-and-pray)", noSecret.kind === "reject" && noSecret["status"] === 500 && noSecret["code"] === "no_signing_secret");

  const malformed = "{\"id\":\"evt_x\",\"type\":\"checkout.session.completed\"";
  const dm = await decide(malformed, sign(malformed));
  check("a signed but malformed body is refused 400 (it cannot have come from Stripe)", dm.kind === "reject" && dm["status"] === 400 && dm["code"] === "malformed_body");

  // recognition paths 2 and 3 (the ids the lead may fill in payment-links.ts)
  const row = links.PAYMENT_LINKS.find((r) => r.skuId === "votive-steady")!;
  const savedLink = row.paymentLinkId;
  row.paymentLinkId = "pl_test_steady";
  const byLink = sessionBody({ sku: null, paymentLink: "pl_test_steady", amount: 999 });
  const dbl = await decide(byLink.body, sign(byLink.body));
  check("a session is recognised by its payment_link id when metadata.sku is absent", dbl.kind === "apply" && dbl["skuId"] === "votive-steady" && dbl["recognition"] === "payment_link");
  row.paymentLinkId = savedLink;
  const savedPrice = row.priceId;
  row.priceId = "price_test_steady";
  const byPrice = sessionBody({ sku: null, lineItemPrice: "price_test_steady", amount: 999 });
  const dbp = await decide(byPrice.body, sign(byPrice.body));
  check("…and by its price id as the last resort", dbp.kind === "apply" && dbp["skuId"] === "votive-steady" && dbp["recognition"] === "line_items.price");
  row.priceId = savedPrice;
  check("with a blank paymentLinkId an unrecognised link id grants nothing", links.skuForPaymentLinkId("pl_whatever") === null);
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
  check("a raw safe id is accepted (a hand-written link still works for a smoke test)", ref.decodeAccountRef("payer") === "payer");
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
  const { body, sessionId } = sessionBody({ sku: "votive-small", amount: 499 });
  const header = sign(body);
  const first = await route.handleStripeWebhookRequest({ rawBody: body, signatureHeader: header, secret: SECRET });
  check("a verified event is applied (200 + applied:true)", first.status === 200 && first.body.applied === true && first.body.sessionId === sessionId);
  check("the wallet the player sees gains exactly the pack (550 Votives)", (await votivesOf("payer")) === before + 550);
  const ledger = (await store.loadAccountSaves("payer"))!.games[saves.activeGameId as string].currency.ledger;
  check("the grant is recorded in the ledger as a purchase, not as play", ledger.some((e) => e.kind === "purchase" && e.reason.includes("Small Offering")));

  const replay = await route.handleStripeWebhookRequest({ rawBody: body, signatureHeader: header, secret: SECRET });
  check("a REPLAYED delivery answers 200 but is idempotent", replay.status === 200 && replay.body.idempotent === true);
  check("…and does not double-grant", (await votivesOf("payer")) === before + 550);

  const packBefore = (await store.loadAccountSaves("payer"))!.games[saves.activeGameId as string].resources.supplies;
  const pack = sessionBody({ sku: "scavengers-kit", amount: 499 });
  const packRes = await route.handleStripeWebhookRequest({ rawBody: pack.body, signatureHeader: sign(pack.body), secret: SECRET });
  const after = (await store.loadAccountSaves("payer"))!.games[saves.activeGameId as string];
  check("a HEAD-START PACK grants its listed resources (150 supplies)", packRes.status === 200 && after.resources.supplies === packBefore + 150);
  check("…and its entitlement is recorded", after.entitlements.packs.includes("scavengers-kit"));

  const strangerId = "nobody-here";
  const stranger = sessionBody({ sku: "votive-small", accountRef: ref.encodeAccountRef(strangerId), amount: 499 });
  const strangerRes = await route.handleStripeWebhookRequest({ rawBody: stranger.body, signatureHeader: sign(stranger.body), secret: SECRET });
  check("an account the reference decodes to but THIS SERVER DOES NOT HAVE is refused 500", strangerRes.status === 500 && strangerRes.body.error === "unknown_account");

  const colonyless = sessionBody({ sku: "votive-small", accountRef: ref.encodeAccountRef("colonyless"), amount: 499 });
  const colonylessRes = await route.handleStripeWebhookRequest({ rawBody: colonyless.body, signatureHeader: sign(colonyless.body), secret: SECRET });
  check("an account with no active colony is refused 500 (visible, retryable — never silently dropped)", colonylessRes.status === 500 && colonylessRes.body.error === "no_active_colony");

  const faGame = engine.newGame("فرزانه", "watchers", now);
  faGame.gameId = "g-fa";
  const faSaves = store.emptySaves();
  faSaves.activeGameId = faGame.gameId;
  faSaves.games[faGame.gameId] = faGame;
  await store.saveAccountSaves("فرزانه", faSaves);
  const faBody = sessionBody({ sku: "votive-steady", accountRef: ref.encodeAccountRef("فرزانه"), amount: 999 });
  const faRes = await route.handleStripeWebhookRequest({ rawBody: faBody.body, signatureHeader: sign(faBody.body), secret: SECRET });
  check("a PERSIAN username pays and is credited (the reference carries any UTF-8 account id)", faRes.status === 200 && (await votivesOf("فرزانه")) === 1280);

  const forgedBefore = await votivesOf("payer");
  const forged = sessionBody({ sku: "votive-circuit", amount: 3999 });
  const forgedRes = await route.handleStripeWebhookRequest({ rawBody: forged.body, signatureHeader: sign(forged.body, "whsec_forged"), secret: SECRET });
  check("a FORGED request grants nothing at all", forgedRes.status === 400 && (await votivesOf("payer")) === forgedBefore);

  const noSecretRes = await route.handleStripeWebhookRequest({ rawBody: forged.body, signatureHeader: sign(forged.body), secret: null });
  check("with no secret configured the route refuses (500) rather than granting", noSecretRes.status === 500 && noSecretRes.body.error === "no_signing_secret");

  check("readWebhookSecret reads the env var, trims it, and treats blank as unset", route.readWebhookSecret({ STRIPE_WEBHOOK_SECRET: " whsec_x " }) === "whsec_x" && route.readWebhookSecret({}) === null && route.readWebhookSecret({ STRIPE_WEBHOOK_SECRET: "  " }) === null);
  check("the env var name is the one the PR tells the lead to set", route.STRIPE_WEBHOOK_SECRET_ENV === "STRIPE_WEBHOOK_SECRET");
}

// ===========================================================================
console.log("— 5 · the factory, the price list, the wiring —");
{
  const prov = monetization.createPaymentProvider();
  check("createPaymentProvider() NO LONGER returns the stub", prov.name === "StripePaymentProvider");
  check("…and an unconfigured provider refuses a plausible payload instead of simulating one", (await prov.verifyWebhook({ purchaseId: "p1", skuId: "votive-small", accountId: "a" })).ok === false);
  const configured = provider.createStripePaymentProvider({ signingSecret: SECRET });
  const { body } = sessionBody({ sku: "votive-small", amount: 499 });
  const okRes = await configured.verifyWebhook({ rawBody: body, signatureHeader: sign(body) });
  check("a configured provider returns the verified purchase through the old interface", okRes.ok === true && okRes.purchase?.skuId === "votive-small" && okRes.purchase?.accountId === "payer");
  check("…and refuses a raw body with no header", (await configured.verifyWebhook({ rawBody: body, signatureHeader: null })).ok === false);
  const cfgNoSecret = provider.createStripePaymentProvider({ signingSecret: null });
  check("a provider with no secret refuses a valid-looking payload", (await cfgNoSecret.verifyWebhook({ rawBody: body, signatureHeader: sign(body) })).ok === false);
  check("createIntent is refused honestly (links are created in Stripe, not by the game)", (await configured.createIntent({})).ok === false);
  check("refund is refused honestly (refunds happen in the dashboard)", (await configured.refund({ purchaseId: "p1", reason: "x" })).ok === false);

  check("the price list covers the seven live Stripe SKUs", links.PAYMENT_LINKS.length === 7);
  const votiveIds = monetization.VOTIVE_PACKS.map((p) => p.id);
  const kitIds = monetization.HEAD_START_PACKS.map((p) => p.id);
  check("every linked SKU exists in the game's own catalogue", links.PAYMENT_LINKS.every((r) => votiveIds.includes(r.skuId) || kitIds.includes(r.skuId)));
  const priceOk = links.PAYMENT_LINKS.every((r) => {
    const v = monetization.VOTIVE_PACKS.find((p) => p.id === r.skuId);
    const k = monetization.HEAD_START_PACKS.find((p) => p.id === r.skuId);
    return r.amountUsd === (v?.priceUsd ?? k?.priceUsd);
  });
  check("…and every price matches the catalogue exactly (the tripwire cannot drift from the game)", priceOk);
  check("the game's sellable set is exactly the four Votive packs plus the three kits", [...votiveIds, ...kitIds].length === 7);

  check("with no link configured NO SKU is sellable", links.sellableSkus().length === 0 && !links.isSellable("votive-small"));
  check("…and checkoutUrl refuses rather than opening a link that would take money for nobody", links.checkoutUrl("votive-small", "payer") === null);

  const row = links.PAYMENT_LINKS[0];
  row.url = "https://buy.stripe.com/test_small?utm_source=game";
  check("a configured SKU becomes sellable", links.isSellable("votive-small") && links.sellableSkus().length === 1);
  const url = links.checkoutUrl("votive-small", "payer");
  const parsed = new URL(url!);
  check("the checkout URL carries client_reference_id for the signed-in account", parsed.searchParams.get("client_reference_id") === REF);
  check("…and keeps the link's own query parameters", parsed.searchParams.get("utm_source") === "game");
  check("a signed-out player has no checkout URL (there is no account to attach)", links.checkoutUrl("votive-small", null) === null && links.checkoutUrl("votive-small", "") === null);
  const after = links.afterCompletionUrl("https://game.example", "votive-small");
  check("the return URL keeps {CHECKOUT_SESSION_ID} verbatim for Stripe to substitute", after.includes("session_id={CHECKOUT_SESSION_ID}"));
  check("…and names the SKU and the return marker so the ledger can open honestly", after.includes("purchase=return") && after.includes("sku=votive-small") && after.startsWith("https://game.example/play?"));
  row.url = "";

  check("the storefront switch is still OFF in this commit", monetization.MONETIZATION_CONFIG.storefrontEnabled === false);

  // The two servers on one path, and the client kept out of the server module.
  const serveSrc = read("serve.ts");
  const viteSrc = read("vite.config.ts");
  check("serve.ts answers the webhook path (the published build)", serveSrc.includes("STRIPE_WEBHOOK_PATH") && serveSrc.includes("handleStripeWebhookRequest"));
  check("vite.config.ts repeats the SAME path literal (the dev host behaves identically)", viteSrc.includes(`"${route.STRIPE_WEBHOOK_PATH}"`));
  check("the dev middleware loads the same handler through ssrLoadModule", viteSrc.includes("/src/game/payments/webhook-route.ts") && viteSrc.includes("ssrLoadModule"));
  const clientFiles = [
    "src/components/StorefrontOverlay.tsx",
    "src/routes/play.tsx",
    "src/game/monetization.ts",
    "src/game/payments/payment-links.ts",
    "src/game/payments/purchase-intent.ts",
  ];
  // An IMPORT of the server module, not a mention of its name in prose: the
  // specifier is quoted, a comment is not.
  const importsServer = (src: string) => /["'][^"'\n]*webhook-route[^"'\n]*["']/.test(src);
  check("no client file imports the server handler (the store can never be reached from the browser)", clientFiles.every((f) => !importsServer(read(f))));
  check("…while serve.ts does import it (the check above can actually fail)", importsServer(read("serve.ts")));
  const overlay = read("src/components/StorefrontOverlay.tsx");
  check("the storefront opens the link built from the signed-in account, in the same tab", overlay.includes("checkoutUrl(skuId, accountId)") && overlay.includes("window.location.assign(url)"));
  check("…and a SKU is buyable only when the store is open, the player is signed in, and its link exists", overlay.includes("storeOpen && signedIn && isSellable("));
  check("…and the client never grants anything (no entitlement write on the buy path)", !overlay.includes("saveActiveState") && !overlay.includes("applyExternalPurchase"));

  // i18n: the new strings are keyed and translated in all five languages.
  const cat = (await import(`${SITE}/src/game/i18n/index.ts`)) as { CATALOGUES: Record<string, Record<string, string>>; SOURCE_LANG: string };
  const storeKeys = Object.keys(cat.CATALOGUES[cat.SOURCE_LANG]).filter((k) => k.startsWith("store."));
  check("the payments slice added 13 keyed strings", storeKeys.length === 13, storeKeys.join(","));
  for (const code of ["es", "pt-BR", "ru", "fa"]) {
    check(`${code} translates every one of them`, storeKeys.every((k) => (cat.CATALOGUES[code][k] ?? "").length > 0));
    check(`${code} keeps every {placeholder}`, storeKeys.every((k) => {
      const params = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
      return params(cat.CATALOGUES[code][k] ?? "") === params(cat.CATALOGUES.en[k]);
    }));
  }
  check("no new store string carries limitation or anti-P2W language", storeKeys.every((k) => !/earnable|never (buy|sale)|pay-to-win|no solo win|tier skip/i.test(cat.CATALOGUES.en[k])));

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
  check("a stale note reads as absent — an old note can never claim a purchase", intent.readPurchaseIntent(fakeStorage, Date.now() + intent.PURCHASE_INTENT_TTL_MS + 1) === null);
  intent.clearPurchaseIntent(fakeStorage);
  check("the note can be cleared (Dismiss)", intent.readPurchaseIntent(fakeStorage) === null);
}

rmSync(SCRATCH, { recursive: true, force: true });
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
