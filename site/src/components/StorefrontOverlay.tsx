// STOREFRONT OVERLAY SEAM — Rung 1b (visual-pass-1-storefront.md §2–§5,
// design-system-rung1-spec §D).
//
// The storefront is a SEAM, not a store: MONETIZATION_CONFIG.storefrontEnabled
// is false today (owner flips it later). The overlay renders fully — packs,
// pass rail, deed commemoratives, honesty copy — and every purchase control is
// disabled at 75% + lock glyph with the honest "the ledger opens when the
// world is ready" line (no fabricated ETA). No badge dots, no countdowns, no
// urgency theater — permanent spec locks.
//
// Design locks enforced here (asserted by wcag-tests):
//   · copy from visual-pass-1-storefront.md §3 VERBATIM (trust footer, pass
//     footer, never-sale lines — do not editorialize)
//   · EARNED badge = black #11161d on bg-purity (✓ EARNED, server ownership)
//   · gold CTA = the ONLY gold CTA in the app: bg-purity text-[#11161d]
//     (white-on-gold is banned, 1.44:1)
//   · price chips = text-1 on surf-4, 12px bold
//   · play-equivalent tag = ember-soft 11px on surf-0 inset
//   · no emoji anywhere in this markup — the 16px line-icon family (icons.tsx)
//   · wallet renders server state only; .num on every balance/value
import { Icon, type IconName } from "./icons";
import { Sheet, SheetHeader } from "./Sheet";
import { useT } from "./i18n/I18n";
import type { ReactNode } from "react";
import {
  MONETIZATION_CONFIG,
  HEAD_START_PACKS,
  VOTIVE_PACKS,
  PURCHASABLE_COSMETICS,
  DEED_COSMETICS,
  SEASON_TIERS,
  tierFromXp,
  type PackGrant,
  type HeadStartPackDef,
  type VotivePackDef,
} from "../game/monetization";
import { checkoutUrl, isSellable } from "../game/payments/payment-links";
import { savePurchaseIntent, walletSignature } from "../game/payments/purchase-intent";
import type { GameState, CosmeticSlot } from "../game/types";

// ---- VERBATIM copy (visual-pass-1-storefront.md §3 — locked) ----
const G1_G4_FOOTER =
  "Purchases may strengthen a colony — they can never win a battle alone. Hero power is never for sale. No timers skipped · no research · no Oracle trust.";
const PASS_FOOTER = "Passes never expire. Unclaimed items return next season. No tier skips are sold.";
const NEVER_SALE_ORACLE =
  "Oracle trust is earned by purity — clean recoveries, carried Codices, shielded allies. Feeding recovered AI turns them cold. No offering ever buys a moment of it.";
const NEVER_SALE_CONTRIBUTION = "Contribution is measured by the server's watch — never by spend or votes.";
const LEDGER_WAIT = "The Cradle Market isn't open yet — the ledger opens when the world is ready.";

const SLOT_ICON: Record<CosmeticSlot, IconName> = {
  cradleFacade: "building",
  banner: "emblem",
  vehicleTrim: "cart",
  shrineMotif: "bell",
  leaderGarb: "person",
  sigilFrame: "star",
  palette: "palette",
};

const PACK_GRANT_ICON: Record<string, IconName> = {
  supplies: "crate",
  gas: "fuel",
  medkit: "aegis",
  mechkit: "gear",
  armorkit: "armor",
  skmech: "gear",
  battery: "coin",
  hazmat: "shield",
  shots: "gear",
  alloys: "gear",
  currency: "coin",
  cosmetic: "emblem",
  vehicle: "cart",
};

function WalletNum({ value, tone }: { value: number; tone: string }) {
  const v = Math.floor(value);
  return (
    <b key={v} className={`num wallet-num ${tone}`}>
      {v.toLocaleString()}
    </b>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-text-3">{children}</h3>
  );
}

/** ✓ EARNED — black on bg-purity, server-owned entitlement only (12.59:1). */
function EarnedBadge() {
  return (
    <span className="chip bg-purity font-semibold text-[#11161d]">
      <Icon name="check" size={12} className="mr-1 shrink-0" />
      EARNED
    </span>
  );
}

/** DEED · LOCKED — text-2 on surf-4 (6.14:1; NEVER text-3 here — 4.3:1 < AA). */
function DeedLockedChip() {
  return (
    <span className="chip bg-surf-4 text-text-2">
      <Icon name="lock" size={12} className="mr-1 shrink-0" />
      DEED · LOCKED
    </span>
  );
}

function GrantLine({ g }: { g: PackGrant }) {
  const icon: IconName =
    (g.kind === "resource" && PACK_GRANT_ICON[g.key]) ||
    (g.kind === "currency" ? "coin" : g.kind === "cosmetic" ? "emblem" : "cart");
  return (
    <li className="flex items-start gap-2 text-xs text-text-2">
      <Icon name={icon} size={14} className="mt-px shrink-0 text-text-3" />
      <span>{g.note}</span>
    </li>
  );
}

function PackCard({
  pack,
  storeOpen,
  signedIn,
  onBuy,
}: {
  pack: HeadStartPackDef;
  storeOpen: boolean;
  signedIn: boolean;
  onBuy: (skuId: string) => void;
}) {
  const t = useT();
  // A SKU with no Stripe link configured is NEVER presented as buyable, and a
  // signed-out player has no account to attach to a purchase — so the control
  // stays locked and says why.
  const buyable = storeOpen && signedIn && isSellable(pack.id);
  return (
    <article className="rounded-lg border border-line bg-surf-2 p-3">
      <div className="flex items-center gap-2.5">
        <Icon name="crate" size={24} className="shrink-0 text-ember-soft" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-1">{pack.name}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-text-3">{pack.blurb}</div>
        </div>
        <span className="chip shrink-0 bg-surf-4 text-xs font-bold text-text-1">
          ${pack.priceUsd.toFixed(2)}
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {pack.grants.map((g, i) => (
          <GrantLine key={i} g={g} />
        ))}
      </ul>
      {/* Play-equivalent tag — verbatim from the catalog def (§3.1 framing). */}
      <div className="mt-2 rounded bg-surf-0 px-2 py-1.5 text-[11px] leading-snug text-ember-soft">
        {pack.playEquivalent}
      </div>
      {buyable ? (
        <button
          type="button"
          onClick={() => onBuy(pack.id)}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-line bg-surf-3 px-3 py-2 text-xs font-semibold text-text-1"
        >
          <Icon name="card" size={14} className="shrink-0 text-ember-soft" />
          {t("store.buy", "Buy")} · ${pack.priceUsd.toFixed(2)}
        </button>
      ) : (
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="storef-disabled mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-line bg-surf-3 px-3 py-2 text-xs font-medium text-text-2"
        >
          <Icon name="lock" size={14} className="shrink-0" />
          {!storeOpen
            ? "The ledger opens when the world is ready"
            : !signedIn
              ? t("store.signInToBuy", "Sign in to purchase")
              : t("store.notForSale", "Not for sale yet")}
        </button>
      )}
    </article>
  );
}

/** Votive packs — real money, bought through a Stripe Payment Link. Rendered as
 *  part of the seam whether or not the store is open (consistent with the rest
 *  of the ledger); the buy control appears only when the store is open, the
 *  player is signed in, and that SKU's link is configured. */
function VotiveCard({
  pack,
  storeOpen,
  signedIn,
  onBuy,
}: {
  pack: VotivePackDef;
  storeOpen: boolean;
  signedIn: boolean;
  onBuy: (skuId: string) => void;
}) {
  const t = useT();
  const buyable = storeOpen && signedIn && isSellable(pack.id);
  return (
    <article className="flex items-center gap-2.5 rounded-lg border border-line bg-surf-2 p-3">
      <Icon name="coin" size={22} className="shrink-0 text-ember-soft" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-1">{pack.name}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-3">
          <span className="num">
            {t("store.votivesAmount", { votives: pack.votives })}
          </span>
          {pack.bonus > 0 && (
            <span className="text-ember-soft">{t("store.votivesBonus", { bonus: pack.bonus })}</span>
          )}
        </div>
      </div>
      <span className="chip shrink-0 bg-surf-4 text-xs font-bold text-text-1">
        ${pack.priceUsd.toFixed(2)}
      </span>
      {buyable ? (
        <button
          type="button"
          onClick={() => onBuy(pack.id)}
          className="shrink-0 rounded-md border border-line bg-surf-3 px-3 py-2 text-xs font-semibold text-text-1"
        >
          {t("store.buy", "Buy")}
        </button>
      ) : (
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="storef-disabled shrink-0 rounded-md border border-line bg-surf-3 px-3 py-2 text-xs font-medium text-text-2"
        >
          <Icon name="lock" size={13} className="mx-auto" />
        </button>
      )}
    </article>
  );
}

/** The post-purchase return state. It NEVER grants anything: the entitlement
 *  arrives from the Stripe webhook, and this panel only re-reads the wallet the
 *  server already holds. A forged return URL therefore buys nothing — the worst
 *  it can do is show "not confirmed yet". */
function PurchaseReturnPanel({ view }: { view: PurchaseReturnView }) {
  const t = useT();
  const line =
    view.status === "confirmed"
      ? t("store.return.confirmed", "Payment confirmed — your purchase is in your wallet.")
      : view.status === "checking"
        ? t("store.return.checking", "Checking with the server…")
        : t("store.return.pending", "Not confirmed yet. If you were charged, it lands within a minute — this screen grants nothing by itself.");
  return (
    <div className="mt-3 rounded-md border border-line bg-surf-2 px-2.5 py-2.5">
      <div className="flex items-center gap-2">
        <Icon
          name={view.status === "confirmed" ? "check" : "card"}
          size={14}
          className={`shrink-0 ${view.status === "confirmed" ? "text-purity" : "text-ember-soft"}`}
        />
        <span className="text-sm font-semibold text-text-1">
          {t("store.return.title", "Confirming your purchase")}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-snug text-text-2">{line}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={view.onCheckAgain}
          className="rounded-md border border-line bg-surf-3 px-3 py-1.5 text-xs font-semibold text-text-1"
        >
          {t("store.return.checkAgain", "Check again")}
        </button>
        <button
          type="button"
          onClick={view.onDismiss}
          className="rounded-md border border-line bg-surf-3 px-3 py-1.5 text-xs font-medium text-text-2"
        >
          {t("store.return.dismiss", "Dismiss")}
        </button>
      </div>
    </div>
  );
}


function PassRail({ state }: { state: GameState }) {
  const bp = state.battlePass;
  const tier = tierFromXp(bp.xp);
  const claimed = new Set(bp.claimed);
  const ownedCapstone = state.entitlements.cosmetics.includes("s0-banner-shatterlands");
  return (
    <div className="space-y-1.5">
      {SEASON_TIERS.map((t) => {
        const isCurrent = t.tier === tier;
        const freeClaimed = claimed.has(`${t.tier}-free`);
        const premClaimed = claimed.has(`${t.tier}-premium`);
        const isCapstone = t.free.kind === "capstone_deed";
        return (
          <div
            key={t.tier}
            className={`rounded-md border bg-surf-2 px-2 py-1.5 ${
              isCurrent ? "border-ember/70" : "border-line"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="num w-6 shrink-0 text-right text-xs text-text-3">{t.tier}</span>
              {/* FREE lane — ember family */}
              <div className="pass-lane-node min-w-0 flex-1 bg-ember/10 text-ember-soft">
                {isCapstone ? (
                  ownedCapstone ? <EarnedBadge /> : <DeedLockedChip />
                ) : (
                  <>
                    {freeClaimed && <Icon name="check" size={12} className="shrink-0" />}
                    <span className="truncate">{t.free.label}</span>
                  </>
                )}
              </div>
              {/* PREMIUM lane — purity gold */}
              <div className="pass-lane-node min-w-0 flex-1 bg-purity/10 text-purity">
                {premClaimed && <Icon name="check" size={12} className="shrink-0" />}
                <span className="truncate">{t.premium.label}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The post-purchase state the play route hands down. `status` is derived from
 *  the SERVER's wallet, never from the URL the player came back on. */
export interface PurchaseReturnView {
  status: "checking" | "confirmed" | "pending";
  onCheckAgain: () => void;
  onDismiss: () => void;
}

export function StorefrontOverlay({
  state,
  open,
  onClose,
  accountId = null,
  purchaseReturn = null,
}: {
  state: GameState;
  open: boolean;
  onClose: () => void;
  /** The signed-in account id — the value a purchase is attached to. Absent
   *  means signed out, and a signed-out player cannot start a purchase (there
   *  would be nobody to grant it to). */
  accountId?: string | null;
  purchaseReturn?: PurchaseReturnView | null;
}) {
  const t = useT();
  const enabled = MONETIZATION_CONFIG.storefrontEnabled;
  const signedIn = typeof accountId === "string" && accountId.trim().length >= 2;
  const ownedCosmetics = new Set(state.entitlements.cosmetics);
  const passOwned = state.battlePass.premium || state.entitlements.passes.includes(MONETIZATION_CONFIG.season0Id);
  const hasWallet = !!state.currency;

  /**
   * OPEN THE PAYMENT LINK — the entire client half of the money path.
   *
   * The Stripe Payment Link is opened with `client_reference_id` set to this
   * account, in the SAME tab so Stripe's `after_completion` redirect returns the
   * player into /play carrying {CHECKOUT_SESSION_ID}. Nothing is granted here:
   * the entitlement is applied by the signature-verified webhook, which is the
   * only writer. If the SKU has no link, or there is no account to attach, this
   * refuses rather than opening a link that would take money for nobody.
   */
  const buy = (skuId: string) => {
    const url = checkoutUrl(skuId, accountId);
    if (!url) {
      console.warn(`[storefront] refused to open a checkout link for ${skuId}: no link configured or no account reference`);
      return;
    }
    // A private note to self about what the wallet looked like at the click, so
    // the return panel can tell "it landed" from "we haven't seen it" honestly.
    // Granting happens in the webhook; this changes nothing on the server.
    savePurchaseIntent(typeof window === "undefined" ? null : window.localStorage, {
      skuId,
      signature: walletSignature(state),
      at: Date.now(),
    });
    window.location.assign(url);
  };

  return (
    <Sheet open={open} onClose={onClose} labelledBy="ledger-title" title="The Cradle Ledger">
      <SheetHeader
        id="ledger-title"
        title="The Cradle Ledger"
        subtitle="earned Scrip, premium Votives, and everything the world has trusted you with"
        onClose={onClose}
      />
      <div className="sheet-body px-4 pb-8 md:px-5">
        {/* ---- Wallet (server state only; .num everywhere) ---- */}
        <div className="flex flex-wrap items-center gap-2 pt-4">
          <span className="chip gap-1 bg-surf-2 text-text-2">
            <Icon name="coin" size={13} className="text-ember-soft" />
            Scrip
            <WalletNum value={hasWallet ? state.currency.scrip : 0} tone="text-ember-soft" />
          </span>
          <span className="chip gap-1 bg-surf-2 text-text-2">
            <Icon name="star" size={13} className="text-purity" />
            Votives
            <WalletNum value={hasWallet ? state.currency.votives : 0} tone="text-purity" />
          </span>
          {!enabled && (
            <span className="ml-auto text-[11px] text-text-3">{LEDGER_WAIT}</span>
          )}
        </div>

        {/* ---- Back from a purchase: the webhook decides, this only re-reads ---- */}
        {purchaseReturn && <PurchaseReturnPanel view={purchaseReturn} />}

        {/* ---- Votives (real money, Stripe Payment Links) ---- */}
        <div className="pt-5">
          <SectionHeading>{t("store.votivesHeading", "Votives")}</SectionHeading>
          <p className="mt-1 text-xs text-text-2">
            {t(
              "store.votivesSub",
              "Votives are the Cradle's premium currency — appearance and the premium season track. Bought here, they land in your wallet.",
            )}
          </p>
          <div className="mt-2 space-y-2">
            {VOTIVE_PACKS.map((p) => (
              <VotiveCard key={p.id} pack={p} storeOpen={enabled} signedIn={signedIn} onBuy={buy} />
            ))}
          </div>
        </div>

        {/* ---- Head-Start Packs ---- */}
        <div className="pt-5">
          <SectionHeading>Head-Start Packs</SectionHeading>
          <p className="mt-1 text-xs text-text-2">
            Everything a pack grants is craftable or earnable in play — a head start on the earned
            curve, never above it. Packs are purchased with real money; none are purchasable yet.
          </p>
          <div className="mt-2 space-y-2">
            {HEAD_START_PACKS.map((p) => (
              <PackCard key={p.id} pack={p} storeOpen={enabled} signedIn={signedIn} onBuy={buy} />
            ))}
          </div>
          {/* G1–G4 trust footer — verbatim (spec §3.2) */}
          <p className="mt-2 flex items-start gap-2 rounded-md bg-surf-2/60 px-2.5 py-2 text-xs leading-snug text-text-2">
            <Icon name="shield" size={14} className="mt-px shrink-0 text-ember-soft" />
            <span>{G1_G4_FOOTER}</span>
          </p>
        </div>

        {/* ---- Season Pass (two-lane rail) ---- */}
        <div className="pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <SectionHeading>Season 0 · The Shattering — 28 tiers</SectionHeading>
            <span className="ml-auto text-xs text-text-3">
              Tier <b className="num text-text-2">{tierFromXp(state.battlePass.xp)}</b>
              <span className="text-text-3"> / 28</span>
            </span>
          </div>
          {passOwned ? (
            <span className="chip mt-1.5 bg-surf-4 text-text-2">
              <Icon name="check" size={12} className="mr-1" />
              PREMIUM TRACK OWNED
            </span>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="storef-disabled mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-purity px-3 py-2.5 text-sm font-bold text-[#11161d]"
            >
              <Icon name="lock" size={14} className="shrink-0" />
              Premium Track · 750 Votives
            </button>
          )}
          <div className="mt-3">
            <PassRail state={state} />
          </div>
          {/* Pass footer — verbatim (spec §4 footer) */}
          <p className="mt-2 flex items-start gap-2 text-[11px] leading-snug text-text-3">
            <Icon name="card" size={13} className="mt-px shrink-0 text-text-3" />
            <span>{PASS_FOOTER}</span>
          </p>
        </div>

        {/* ---- Cosmetic catalog (purchasable) ---- */}
        <div className="pt-5">
          <SectionHeading>Cradle Cosmetics</SectionHeading>
          <p className="mt-1 text-xs text-text-2">
            Pure appearance — no stat, no speed, no edge. Owned items show their server-recorded
            check; deed items live below in the commemorative section.
          </p>
          <div className="mt-2 space-y-1.5">
            {PURCHASABLE_COSMETICS.map((c) => {
              const owned = ownedCosmetics.has(c.id);
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-2.5 rounded-md border border-line bg-surf-2 px-2.5 py-2"
                >
                  <Icon name={SLOT_ICON[c.slot]} size={20} className="shrink-0 text-text-3" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-text-1">{c.name}</div>
                    <div className="truncate text-[11px] text-text-3">{c.blurb}</div>
                  </div>
                  {owned ? (
                    <span className="chip shrink-0 bg-surf-4 text-text-3">
                      <Icon name="check" size={12} className="mr-1" />
                      OWNED
                    </span>
                  ) : (
                    <span className="chip shrink-0 bg-surf-4 text-xs font-bold text-text-1">
                      {c.priceVotives}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ---- Commemorative: deed-earned + never-for-sale ---- */}
        <div className="pt-5">
          <SectionHeading>Earned by Deed — commemorative</SectionHeading>
          <p className="mt-1 text-xs text-text-2">
            Deed cosmetics are won by what you do in the world, not by what you spend. They appear
            here so their deeds stay visible — they are viewable, never buyable.
          </p>
          <div className="mt-2 space-y-1.5">
            {DEED_COSMETICS.map((c) => {
              const owned = ownedCosmetics.has(c.id);
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-2.5 rounded-md border border-line bg-surf-2 px-2.5 py-2"
                >
                  <Icon name={SLOT_ICON[c.slot]} size={20} className="shrink-0 text-text-3" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-text-1">{c.name}</div>
                    <div className="truncate text-[11px] text-text-3">{c.blurb}</div>
                  </div>
                  {owned ? <EarnedBadge /> : <DeedLockedChip />}
                </div>
              );
            })}
          </div>
          {/* Callings/Oracle block — verbatim never-sale copy */}
          <div className="mt-2 rounded-md bg-surf-0 px-2.5 py-2.5">
            <span className="chip border border-corrupt-text/50 text-corrupt-text">
              <Icon name="lock" size={12} className="mr-1" />
              NEVER FOR SALE
            </span>
            <p className="mt-2 text-xs leading-snug text-text-2">{NEVER_SALE_ORACLE}</p>
            <p className="mt-1.5 text-xs leading-snug text-text-2">{NEVER_SALE_CONTRIBUTION}</p>
          </div>
        </div>
      </div>
    </Sheet>
  );
}