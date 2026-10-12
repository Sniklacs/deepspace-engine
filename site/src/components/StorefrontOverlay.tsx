// STOREFRONT OVERLAY SEAM — Rung 1b (visual-pass-1-storefront.md §2–§5,
// design-system-rung1-spec §D).
//
// The storefront is a SEAM, not a store: MONETIZATION_CONFIG.storefrontEnabled
// is false today (owner flips it later). The overlay renders fully — packs,
// pass rail, deed commemoratives, wallet — and every purchase control is
// disabled at 75% + lock glyph with the honest "the ledger opens when the
// world is ready" line (no fabricated ETA). No badge dots, no countdowns, no
// urgency theater — permanent spec locks.
//
// COPY — OWNER RULING 2026-09-13: the player-facing store PRESENTS the packs and
// lets people buy. It carries NO pay-to-win and NO limitation language — no G1–G4
// footer, no "no solo win", no "earnable in play / a head start within the earned
// cap" framing, no "no tier skips", no what-you-can't-do framing. Those guardrails
// are INTERNAL and stay internal: assertCatalogFair() in game/monetization.ts, the
// fairness checks in monetization-verify.ts, and design/*.md. This surface renders
// the copy the PLAYER reads, in the player's own language (the catalogue keys
// below), and nothing else.
//
// Design locks still enforced here (asserted by wcag-tests):
//   · EARNED badge = black #11161d on bg-purity (✓ EARNED, server ownership)
//   · gold CTA = the ONLY gold CTA in the app: bg-purity text-[#11161d]
//     (white-on-gold is banned, 1.44:1)
//   · price chips = text-1 on surf-4, 12px bold
//   · play-equivalent tag = ember-soft 11px on surf-0 inset
//   · no emoji anywhere in this markup — the 16px line-icon family (icons.tsx)
//   · wallet renders server state only; .num on every balance/value
import { Icon, type IconName } from "./icons";
import { Sheet, SheetHeader } from "./Sheet";
import PageBanner from "./PageBanner";
import { Bdi } from "./ui/Bdi";
import { useLang, useT } from "./i18n/I18n";
import { formatNumber, formatUsd } from "../game/i18n/format";
import { SplitValue } from "./i18n/SplitValue";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
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
import { isSellable } from "../game/payments/xsolla-catalog";
import { purchaseStoreOfferFn, xsollaCheckoutFn } from "../game/api";
import {
  EXTRACTION_CONTRACT,
  RECOVERY_EXPEDITE,
  WAR_BUNDLES,
  bundleSeparateVotives,
  dailySpecials,
  type DailySpecialOffer,
  type WarBundleDef,
} from "../game/store-offers";
import { savePurchaseIntent, walletSignature } from "../game/payments/purchase-intent";
import type { GameState, CosmeticSlot } from "../game/types";

// ---- the store's own copy -------------------------------------------------

/**
 * The catalogue key for one grant bullet — `store.pack.<pack>.g.<kind>.<what>`.
 * The pack's blurb / play-equivalent lines are written as inline templates at the
 * call site (`store.pack.${pack.id}.blurb`) on purpose: that is the shape the i18n
 * suite recognises as a dynamic key family, so a store line cannot quietly go
 * missing from the catalogue.
 */
function grantNoteKey(packId: string, g: PackGrant): string {
  const what =
    g.kind === "resource" ? g.key
    : g.kind === "currency" ? g.currency
    : g.kind === "cosmetic" ? g.itemId
    : g.vehicleId;
  return `store.pack.${packId}.g.${g.kind}.${what}`;
}

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
  const lang = useLang();
  const v = Math.floor(value);
  return (
    <b key={v} className={`wallet-num ${tone}`}>
      <Bdi dir="ltr" className="num">{formatNumber(lang, v)}</Bdi>
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
  const t = useT();
  return (
    <span className="chip bg-purity font-semibold text-[#11161d]">
      <Icon name="check" size={12} className="mr-1 shrink-0" />
      {t("store.earned", "EARNED")}
    </span>
  );
}

/** DEED · LOCKED — text-2 on surf-4 (6.14:1; NEVER text-3 here — 4.3:1 < AA). */
function DeedLockedChip() {
  const t = useT();
  return (
    <span className="chip bg-surf-4 text-text-2">
      <Icon name="lock" size={12} className="mr-1 shrink-0" />
      {t("store.deedLocked", "DEED · LOCKED")}
    </span>
  );
}

function GrantLine({ g, packId }: { g: PackGrant; packId: string }) {
  const t = useT();
  const icon: IconName =
    (g.kind === "resource" && PACK_GRANT_ICON[g.key]) ||
    (g.kind === "currency" ? "coin" : g.kind === "cosmetic" ? "emblem" : "cart");
  return (
    <li className="flex items-start gap-2 text-xs text-text-2">
      <Icon name={icon} size={14} className="mt-px shrink-0 text-text-3" />
      {/* The English source stays the catalog literal in game/monetization.ts (so
          assertCatalogFair keeps policing the wording); the catalogue carries it in
          all five languages. */}
      <span>{t(grantNoteKey(packId, g), g.note)}</span>
    </li>
  );
}

function PackCard({
  pack,
  storeOpen,
  signedIn,
  onBuy,
  buying,
}: {
  pack: HeadStartPackDef;
  storeOpen: boolean;
  signedIn: boolean;
  onBuy: (skuId: string) => void;
  buying: boolean;
}) {
  const t = useT();
  // A SKU with no Xsolla catalog row configured is NEVER presented as buyable, and a
  // signed-out player has no account to attach to a purchase — so the control
  // stays locked and says why.
  const buyable = storeOpen && signedIn && isSellable(pack.id);
  return (
    <article className="rounded-lg border border-line bg-surf-2 p-3">
      <div className="flex items-center gap-2.5">
        <Icon name="crate" size={24} className="shrink-0 text-ember-soft" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-1">{pack.name}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-text-3">
            {t(`store.pack.${pack.id}.blurb`, pack.blurb)}
          </div>
        </div>
        <span className="chip shrink-0 bg-surf-4 text-xs font-bold text-text-1">
          <Bdi dir="ltr" className="num">{"$" + formatUsd(pack.priceUsd)}</Bdi>
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {pack.grants.map((g, i) => (
          <GrantLine key={i} g={g} packId={pack.id} />
        ))}
      </ul>
      {/* Play-equivalent tag — a plain comparison to play, in the player's language. */}
      <div className="mt-2 rounded bg-surf-0 px-2 py-1.5 text-[11px] leading-snug text-ember-soft">
        {t(`store.pack.${pack.id}.play`, pack.playEquivalent)}
      </div>
      {buyable ? (
        <button
          type="button"
          onClick={() => onBuy(pack.id)}
          disabled={buying}
          aria-disabled={buying}
          data-testid={buying ? "store-buy-busy" : "store-buy"}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-line bg-surf-3 px-3 py-2 text-xs font-semibold text-text-1 disabled:opacity-70"
        >
          <Icon name="card" size={14} className="shrink-0 text-ember-soft" />
          {buying
            ? t("store.buyOpening", "Opening checkout…")
            : (<>{t("store.buy", "Buy")} ·{" "}<Bdi dir="ltr" className="num">{"$" + formatUsd(pack.priceUsd)}</Bdi></>)}
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
            ? t("store.ledgerOpens", "The ledger opens when the world is ready")
            : !signedIn
              ? t("store.signInToBuy", "Sign in to purchase")
              : t("store.notForSale", "Not for sale yet")}
        </button>
      )}
    </article>
  );
}

/** Votive packs — real money, bought through Xsolla Pay Station. Rendered as
 *  part of the seam whether or not the store is open (consistent with the rest
 *  of the ledger); the buy control appears only when the store is open, the
 *  player is signed in, and that SKU's link is configured. */
function VotiveCard({
  pack,
  storeOpen,
  signedIn,
  onBuy,
  buying,
}: {
  pack: VotivePackDef;
  storeOpen: boolean;
  signedIn: boolean;
  onBuy: (skuId: string) => void;
  buying: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const buyable = storeOpen && signedIn && isSellable(pack.id);
  return (
    <article className="flex items-center gap-2.5 rounded-lg border border-line bg-surf-2 p-3">
      <Icon name="coin" size={22} className="shrink-0 text-ember-soft" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-1">{pack.name}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-3">
          <span>
            <SplitValue
              k="store.votivesAmount"
              params={{ votives: formatNumber(lang, pack.votives) }}
            />
          </span>
          {pack.bonus > 0 && (
            <span className="text-ember-soft">
              {t("store.votivesBonus", { bonus: formatNumber(lang, pack.bonus) })}
            </span>
          )}
        </div>
      </div>
      <span className="chip shrink-0 bg-surf-4 text-xs font-bold text-text-1">
        <Bdi dir="ltr" className="num">{"$" + formatUsd(pack.priceUsd)}</Bdi>
      </span>
      {buyable ? (
        <button
          type="button"
          onClick={() => onBuy(pack.id)}
          disabled={buying}
          aria-disabled={buying}
          data-testid={buying ? "store-buy-busy" : "store-buy"}
          className="shrink-0 rounded-md border border-line bg-surf-3 px-3 py-2 text-xs font-semibold text-text-1 disabled:opacity-70"
        >
          {buying ? t("store.buyOpening", "Opening checkout…") : t("store.buy", "Buy")}
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
 *  arrives from the Xsolla webhook, and this panel only re-reads the wallet the
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
  const lang = useLang();
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
              <span className="w-6 shrink-0 text-end text-xs text-text-3">
                <Bdi dir="ltr" className="num">{formatNumber(lang, t.tier)}</Bdi>
              </span>
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

/** h:mm:ss for the daily-specials rotation line. */
function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** One content line of a store offer (bundle / special) — the packs'
 *  GrantLine with the offer's own i18n note base (`store.bundle.<id>` or
 *  `store.special.<id>`); the English note stays the catalog literal. */
function OfferGrantLine({ g, noteKeyBase }: { g: PackGrant; noteKeyBase: string }) {
  const t = useT();
  const icon: IconName =
    (g.kind === "resource" && PACK_GRANT_ICON[g.key]) ||
    (g.kind === "currency" ? "coin" : g.kind === "cosmetic" ? "emblem" : "cart");
  const what =
    g.kind === "resource" ? g.key
    : g.kind === "currency" ? g.currency
    : g.kind === "cosmetic" ? g.itemId
    : g.vehicleId;
  return (
    <li className="flex items-start gap-2 text-xs text-text-2">
      <Icon name={icon} size={14} className="mt-px shrink-0 text-text-3" />
      <span>{t(`${noteKeyBase}.g.${g.kind}.${what}`, g.note)}</span>
    </li>
  );
}

/** "−25%" against the buy-separately sum — a plain fact, no urgency theater. */
function DiscountChip({ price, separate }: { price: number; separate: number }) {
  const lang = useLang();
  const t = useT();
  const pct = separate > price ? Math.round((1 - price / separate) * 100) : 0;
  if (pct <= 0) return null;
  return (
    <span className="chip shrink-0 bg-surf-4 text-xs font-bold text-ember-soft">
      {t("store.bundles.off", "−{pct}%", { pct: formatNumber(lang, pct) })}
    </span>
  );
}

function VotivePrice({ amount }: { amount: number }) {
  const lang = useLang();
  const t = useT();
  return (
    <span className="chip shrink-0 bg-surf-4 text-xs font-bold text-text-1">
      <Bdi dir="ltr" className="num">{formatNumber(lang, amount)}</Bdi>
      <span className="ml-1 font-medium text-text-3">{t("store.votivesName", "Votives")}</span>
    </span>
  );
}

/** The buy control shared by every in-game (Votives) offer card: the packs'
 *  lock discipline — never presented as buyable while the ledger is shut or
 *  the player is signed out. */
function OfferBuyButton({
  buyable,
  storeOpen,
  signedIn,
  busy,
  price,
  onBuy,
}: {
  buyable: boolean;
  storeOpen: boolean;
  signedIn: boolean;
  busy: boolean;
  price: number;
  onBuy: () => void;
}) {
  const t = useT();
  const lang = useLang();
  if (buyable) {
    return (
      <button
        type="button"
        onClick={onBuy}
        disabled={busy}
        aria-disabled={busy}
        data-testid={busy ? "store-buy-busy" : "store-buy"}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-line bg-surf-3 px-3 py-2 text-xs font-semibold text-text-1 disabled:opacity-70"
      >
        <Icon name="coin" size={14} className="shrink-0 text-ember-soft" />
        {busy
          ? t("store.buyOpening", "Opening checkout…")
          : t("store.offer.buyFor", "Buy · {n} Votives", { n: formatNumber(lang, price) })}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className="storef-disabled mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-line bg-surf-3 px-3 py-2 text-xs font-medium text-text-2"
    >
      <Icon name="lock" size={14} className="shrink-0" />
      {!storeOpen
        ? t("store.ledgerOpens", "The ledger opens when the world is ready")
        : !signedIn
          ? t("store.signInToBuy", "Sign in to purchase")
          : t("store.notForSale", "Not for sale yet")}
    </button>
  );
}

function DailySpecialCard({
  offer,
  claimed,
  storeOpen,
  signedIn,
  busy,
  onBuy,
}: {
  offer: DailySpecialOffer;
  claimed: boolean;
  storeOpen: boolean;
  signedIn: boolean;
  busy: boolean;
  onBuy: () => void;
}) {
  const t = useT();
  const buyable = storeOpen && signedIn && !claimed;
  return (
    <article className="rounded-lg border border-ember/50 bg-surf-2 p-3">
      <div className="flex items-center gap-2.5">
        <Icon name="star" size={24} className="shrink-0 text-ember-soft" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-1">
            {t(`${offer.noteKeyBase}.name`, offer.name)}
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-text-3">
            {t(`${offer.noteKeyBase}.blurb`, offer.blurb)}
          </div>
        </div>
        <DiscountChip price={offer.priceVotives} separate={offer.separateVotives} />
        <VotivePrice amount={offer.priceVotives} />
      </div>
      <ul className="mt-2 space-y-1">
        {offer.grants.map((g, i) => (
          <OfferGrantLine key={i} g={g} noteKeyBase={offer.noteKeyBase} />
        ))}
      </ul>
      {claimed ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-purity">
          <Icon name="check" size={13} className="shrink-0" />
          {t("store.specials.claimed", "Claimed today")}
        </div>
      ) : (
        <OfferBuyButton
          buyable={buyable}
          storeOpen={storeOpen}
          signedIn={signedIn}
          busy={busy}
          price={offer.priceVotives}
          onBuy={onBuy}
        />
      )}
    </article>
  );
}

function WarBundleCard({
  bundle,
  storeOpen,
  signedIn,
  busy,
  onBuy,
}: {
  bundle: WarBundleDef;
  storeOpen: boolean;
  signedIn: boolean;
  busy: boolean;
  onBuy: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const separate = bundleSeparateVotives(bundle);
  const buyable = storeOpen && signedIn;
  return (
    <article className="rounded-lg border border-line bg-surf-2 p-3">
      <div className="flex items-center gap-2.5">
        <Icon name="crate" size={24} className="shrink-0 text-ember-soft" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-1">
            {t(`store.bundle.${bundle.id}.name`, bundle.name)}
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-text-3">
            {t(`store.bundle.${bundle.id}.blurb`, bundle.blurb)}
          </div>
        </div>
        <DiscountChip price={bundle.priceVotives} separate={separate} />
        <VotivePrice amount={bundle.priceVotives} />
      </div>
      <ul className="mt-2 space-y-1">
        {bundle.grants.map((g, i) => (
          <OfferGrantLine key={i} g={g} noteKeyBase={`store.bundle.${bundle.id}`} />
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-text-3">
        <span>
          {t("store.bundles.separate", "Separately {n} Votives", { n: formatNumber(lang, separate) })}
        </span>
        <span className="text-ember-soft">{t(`store.bundle.${bundle.id}.play`, bundle.playEquivalent)}</span>
      </div>
      <OfferBuyButton
        buyable={buyable}
        storeOpen={storeOpen}
        signedIn={signedIn}
        busy={busy}
        price={bundle.priceVotives}
        onBuy={onBuy}
      />
    </article>
  );
}

/** A standing store service item (the extraction deal): the card shows how
 *  many the player already holds — the count the recovery system reads. */
function ServiceItemCard({
  itemId,
  name,
  blurb,
  price,
  held,
  icon,
  storeOpen,
  signedIn,
  busy,
  onBuy,
}: {
  itemId: string;
  name: string;
  blurb: string;
  price: number;
  held: number;
  icon: IconName;
  storeOpen: boolean;
  signedIn: boolean;
  busy: boolean;
  onBuy: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const buyable = storeOpen && signedIn;
  return (
    <article className="rounded-lg border border-line bg-surf-2 p-3">
      <div className="flex items-center gap-2.5">
        <Icon name={icon} size={24} className="shrink-0 text-ember-soft" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-1">{t(`store.item.${itemId}.name`, name)}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-text-3">
            {t(`store.item.${itemId}.blurb`, blurb)}
          </div>
        </div>
        <VotivePrice amount={price} />
      </div>
      <div className="mt-2 text-[11px] text-text-3">
        {t("store.extraction.held", "Held: {n}", { n: formatNumber(lang, held) })}
      </div>
      <OfferBuyButton
        buyable={buyable}
        storeOpen={storeOpen}
        signedIn={signedIn}
        busy={busy}
        price={price}
        onBuy={onBuy}
      />
    </article>
  );
}

export function StorefrontOverlay({
  state,
  open,
  onClose,
  accountId = null,
  token = null,
  purchaseReturn = null,
  onError,
  onPurchaseState,
}: {
  state: GameState;
  open: boolean;
  onClose: () => void;
  /** The signed-in account id — the value a purchase is attached to. Absent
   *  means signed out, and a signed-out player cannot start a purchase (there
   *  would be nobody to grant it to). */
  accountId?: string | null;
  /** The session token — the server mints the Xsolla checkout token for the
   *  account this token resolves to, so checkout needs it, not just the id. */
  token?: string | null;
  purchaseReturn?: PurchaseReturnView | null;
  /**
   * Called with a human-readable message when checkout cannot start or fails.
   * The buy flow used to fail silently (console.warn only) — the player tapped
   * Buy and nothing happened. Every refusal now surfaces here.
   */
  onError?: (msg: string) => void;
  /**
   * Called with the fresh server state after an in-game (Votives) offer
   * purchase lands — the play route applies it so the wallet, stores and held
   * contract counts the player sees are the server's, never a local guess.
   */
  onPurchaseState?: (state: GameState) => void;
}) {
  const t = useT();
  const lang = useLang();
  const enabled = MONETIZATION_CONFIG.storefrontEnabled;
  const signedIn = typeof accountId === "string" && accountId.trim().length >= 2;
  const ownedCosmetics = new Set(state.entitlements.cosmetics);
  const passOwned = state.battlePass.premium || state.entitlements.passes.includes(MONETIZATION_CONFIG.season0Id);
  const hasWallet = !!state.currency;

  /**
   * Which SKU is mid-checkout (the async Xsolla token mint is in flight).
   * While set: that card's button reads "Opening checkout…", is disabled, and
   * further taps are ignored — no double-submits, no dead-feeling silence.
   */
  const [buyingSku, setBuyingSku] = useState<string | null>(null);
  const [premiumHint, setPremiumHint] = useState<string | null>(null);
  /**
   * The last checkout failure, kept VISIBLE in the sheet until dismissed.
   * The buy flow used to fail into a toast that was easy to miss — the player
   * tapped Buy and the button just sat there. Now the reason stays on screen.
   */
  const [buyError, setBuyError] = useState<string | null>(null);

  /**
   * OPEN CHECKOUT — the entire client half of the money path.
   *
   * The server mints an Xsolla Pay Station token bound to this account and
   * hands back the URL; the client navigates there in the SAME tab so Xsolla's
   * return URL brings the player back into /play carrying the purchase-return
   * marker. Nothing is granted here: the entitlement is applied by the
   * signature-verified webhook, which is the only writer. If the SKU is not
   * sellable, or there is no session to mint for, this refuses rather than
   * starting a checkout that would take money for nobody.
   */
  const buy = async (skuId: string) => {
    const fail = (msg: string) => {
      console.warn(`[storefront] checkout failed for ${skuId}: ${msg}`);
      setBuyError(msg);
      onError?.(msg);
    };
    // No double-submits: a tap while a checkout is already opening is ignored.
    if (buyingSku) return;
    if (!isSellable(skuId)) {
      fail(t("store.buyNotSellable", "That item isn't for sale right now."));
      return;
    }
    if (!token) {
      fail(t("store.buySignIn", "Sign in to purchase."));
      return;
    }
    setBuyingSku(skuId);
    setBuyError(null);
    // A private note to self about what the wallet looked like at the click, so
    // the return panel can tell "it landed" from "we haven't seen it" honestly.
    // Granting happens in the webhook; this changes nothing on the server.
    savePurchaseIntent(typeof window === "undefined" ? null : window.localStorage, {
      skuId,
      signature: walletSignature(state),
      at: Date.now(),
    });
    try {
      const res = await xsollaCheckoutFn({
        data: {
          token,
          skuId,
          origin: typeof window === "undefined" ? undefined : window.location.origin,
        },
      });
      if (res.ok && res.url) {
        window.location.assign(res.url);
      } else if (res.signedOut) {
        fail(t("store.buySignedOut", "Your session expired — sign in again to purchase."));
      } else {
        fail(res.error ?? t("store.buyFailed", "Checkout failed — try again in a moment."));
      }
    } catch (err) {
      fail(`${t("store.buyFailed", "Checkout failed — try again in a moment.")} (${(err as Error)?.message ?? err})`);
    } finally {
      setBuyingSku(null);
    }
  };

  // ---- Store offers (owner 2026-10-12): daily specials, war bundles, the
  // extraction deal. All spend Votives the player already holds through
  // purchaseStoreOfferFn; the server resolves prices, contents and the daily
  // rotation — the client only names the offer. The returned server state is
  // handed up via onPurchaseState so every number on screen stays the
  // server's.
  const [buyingOffer, setBuyingOffer] = useState<string | null>(null);
  const [offerNotice, setOfferNotice] = useState<string | null>(null);
  const buyOffer = async (kind: "special" | "bundle" | "extraction" | "expedite", offerId?: string) => {
    const fail = (msg: string) => {
      console.warn(`[storefront] offer purchase failed (${kind}/${offerId ?? "-"}): ${msg}`);
      setBuyError(msg);
      onError?.(msg);
    };
    if (buyingOffer) return;
    if (!token) {
      fail(t("store.buySignIn", "Sign in to purchase."));
      return;
    }
    setBuyingOffer(offerId ?? kind);
    setBuyError(null);
    setOfferNotice(null);
    const eventId = `store-${kind}-${offerId ?? "x"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const res = await purchaseStoreOfferFn({ data: { token, kind, offerId, eventId } });
      if (res.ok && res.state) {
        onPurchaseState?.(res.state);
        setOfferNotice(t("store.offer.purchased", "Done — it's in your stores."));
      } else if (res.signedOut) {
        fail(t("store.buySignedOut", "Your session expired — sign in again to purchase."));
      } else {
        fail(res.error ?? t("store.buyFailed", "Checkout failed — try again in a moment."));
      }
    } catch (err) {
      fail(`${t("store.buyFailed", "Checkout failed — try again in a moment.")} (${(err as Error)?.message ?? err})`);
    } finally {
      setBuyingOffer(null);
    }
  };

  // The specials board + its rotation clock. Recomputed from the pure
  // rotation on a 1s tick while the sheet is open; the server re-resolves
  // the same board at purchase time, so a stale render can never buy
  // yesterday's price.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open ]);
  const specials = dailySpecials(nowMs);
  const claimedToday = new Set(state.storeOffers?.dailyBuys?.[specials.dayKey] ?? []);
  const passesHeld = state.storeOffers?.extractionPasses ?? 0;
  const expeditesHeld = state.storeOffers?.expediteCredits ?? 0;

  return (
    <Sheet open={open} onClose={onClose} labelledBy="ledger-title" title={t("store.title", "The Cradle Ledger")}>
      <SheetHeader
        id="ledger-title"
        title={t("store.title", "The Cradle Ledger")}
        subtitle={t("store.subtitle", "earned Scrip, premium Votives, and everything the world has trusted you with")}
        onClose={onClose}
      />
      <div className="sheet-body px-4 pb-8 md:px-5">
        {/* market vault art behind the ledger (owner 2026-10-01: every page
            gets a background picture) */}
        <div className="-mx-4 md:-mx-5">
          <PageBanner image="/art/pages/store-banner.webp" raceId={state.race} skinDir="store" className="rounded-none" focal="center 40%" />
        </div>
        {/* ---- Wallet (server state only; .num everywhere) ---- */}
        <div className="flex flex-wrap items-center gap-2 pt-4">
          <span className="chip gap-1 bg-surf-2 text-text-2">
            <Icon name="coin" size={13} className="text-ember-soft" />
            {t("store.scrip", "Scrip")}
            <WalletNum value={hasWallet ? state.currency.scrip : 0} tone="text-ember-soft" />
          </span>
          <span className="chip gap-1 bg-surf-2 text-text-2">
            <Icon name="star" size={13} className="text-purity" />
            {t("store.votivesName", "Votives")}
            <WalletNum value={hasWallet ? state.currency.votives : 0} tone="text-purity" />
          </span>
          {!enabled && (
            <span className="ml-auto text-[11px] text-text-3">{t("store.ledgerWait", "The Cradle Market isn't open yet — the ledger opens when the world is ready.")}</span>
          )}
        </div>

        {/* ---- Back from a purchase: the webhook decides, this only re-reads ---- */}
        {purchaseReturn && <PurchaseReturnPanel view={purchaseReturn} />}

        {/* ---- Checkout failure: stays on screen until dismissed. The tap-to-buy
            used to die into a toast; now the reason is impossible to miss. ---- */}
        {buyError && (
          <div
            role="alert"
            data-testid="store-buy-error"
            className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/50 bg-red-950/50 px-3 py-2.5"
          >
            <Icon name="bell" size={16} className="mt-0.5 shrink-0 text-red-300" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-red-100">{buyError}</p>
            <button
              type="button"
              onClick={() => setBuyError(null)}
              aria-label={t("store.dismissError", "Dismiss")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-red-300 hover:bg-red-900/50"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        {/* ---- Store-offer purchase confirmation (in-game Votives buys) ---- */}
        {offerNotice && (
          <div
            role="status"
            data-testid="store-offer-notice"
            className="mt-3 flex items-start gap-2 rounded-lg border border-purity/50 bg-surf-2 px-3 py-2.5"
          >
            <Icon name="check" size={16} className="mt-0.5 shrink-0 text-purity" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-text-1">{offerNotice}</p>
            <button
              type="button"
              onClick={() => setOfferNotice(null)}
              aria-label={t("store.dismissError", "Dismiss")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-3 hover:bg-surf-3"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        {/* ---- Daily Specials (owner 2026-10-12): three offers, the same for
            every colony on the world, turning at the UTC dawn. The rotation
            clock is a plain fact line — when the board turns, not a hurry. ---- */}
        <div className="pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <SectionHeading>{t("store.specials.heading", "Daily Specials")}</SectionHeading>
            <span className="ml-auto text-[11px] text-text-3">
              {t("store.specials.rotatesIn", "New specials in {time}", { time: formatCountdown(specials.msLeft) })}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-2">
            {t(
              "store.specials.sub",
              "Three offers a day, the same for every colony on the world. Each may be claimed once a day.",
            )}
          </p>
          <div className="mt-2 space-y-2">
            {specials.offers.map((offer) => (
              <DailySpecialCard
                key={offer.specialId}
                offer={offer}
                claimed={claimedToday.has(offer.specialId)}
                storeOpen={enabled}
                signedIn={signedIn && !!token}
                busy={buyingOffer === offer.specialId}
                onBuy={() => void buyOffer("special", offer.specialId)}
              />
            ))}
          </div>
        </div>

        {/* ---- War Bundles (owner 2026-10-12): crates of war goods at a
            bundle price, contents listed, discount against the parts. ---- */}
        <div className="pt-5">
          <SectionHeading>{t("store.bundles.heading", "War Bundles")}</SectionHeading>
          <p className="mt-1 text-xs text-text-2">
            {t(
              "store.bundles.sub",
              "Crates of war goods priced below the sum of their parts. Buy one and everything in it lands in your stores.",
            )}
          </p>
          <div className="mt-2 space-y-2">
            {WAR_BUNDLES.map((b) => (
              <WarBundleCard
                key={b.id}
                bundle={b}
                storeOpen={enabled}
                signedIn={signedIn && !!token}
                busy={buyingOffer === b.id}
                onBuy={() => void buyOffer("bundle", b.id)}
              />
            ))}
          </div>
        </div>

        {/* ---- The Extraction Deal (owner 2026-10-12): standing contracts
            for the fallen-hero recovery system — a hired extraction crew on
            call, and contracted care that completes a 24-hour recovery. ---- */}
        <div className="pt-5">
          <SectionHeading>{t("store.extraction.heading", "Extraction & Recovery")}</SectionHeading>
          <p className="mt-1 text-xs text-text-2">
            {t(
              "store.extraction.sub",
              "Contracts held at the Cradle, ready before the day they are needed.",
            )}
          </p>
          <div className="mt-2 space-y-2">
            <ServiceItemCard
              itemId={EXTRACTION_CONTRACT.id}
              name={EXTRACTION_CONTRACT.name}
              blurb={EXTRACTION_CONTRACT.blurb}
              price={EXTRACTION_CONTRACT.priceVotives}
              held={passesHeld}
              icon="aegis"
              storeOpen={enabled}
              signedIn={signedIn && !!token}
              busy={buyingOffer === "extraction"}
              onBuy={() => void buyOffer("extraction")}
            />
            <ServiceItemCard
              itemId={RECOVERY_EXPEDITE.id}
              name={RECOVERY_EXPEDITE.name}
              blurb={RECOVERY_EXPEDITE.blurb}
              price={RECOVERY_EXPEDITE.priceVotives}
              held={expeditesHeld}
              icon="shield"
              storeOpen={enabled}
              signedIn={signedIn && !!token}
              busy={buyingOffer === "expedite"}
              onBuy={() => void buyOffer("expedite")}
            />
          </div>
        </div>

        {/* ---- Votives (real money, Xsolla Pay Station) ---- */}
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
              <VotiveCard key={p.id} pack={p} storeOpen={enabled} signedIn={signedIn} onBuy={buy} buying={buyingSku === p.id} />
            ))}
          </div>
        </div>

        {/* ---- Head-Start Packs ---- */}
        <div className="pt-5">
          <SectionHeading>{t("store.headingsPacks", "Head-Start Packs")}</SectionHeading>
          <p className="mt-1 text-xs text-text-2">
            {t(
              "store.packsSub",
              "Supplies, fuel, gear and Votives to open a colony. Each pack lists everything it carries.",
            )}
          </p>
          <div className="mt-2 space-y-2">
            {HEAD_START_PACKS.map((p) => (
              <PackCard key={p.id} pack={p} storeOpen={enabled} signedIn={signedIn} onBuy={buy} buying={buyingSku === p.id} />
            ))}
          </div>
        </div>

        {/* ---- Season Pass (two-lane rail) ---- */}
        <div className="pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <SectionHeading>{t("store.passHeading", "Season 0 · The Shattering — 28 tiers")}</SectionHeading>
            <span className="ml-auto text-xs text-text-3">
              {t("store.tierLabel", "Tier")}{" "}
              <b className="text-text-2">
                <Bdi dir="ltr" className="num">{formatNumber(lang, tierFromXp(state.battlePass.xp))}</Bdi>
              </b>
              <span className="text-text-3">{t("store.passOfTiers", " / {n}", { n: 28 })}</span>
            </span>
          </div>
          {passOwned ? (
            <span className="chip mt-1.5 bg-surf-4 text-text-2">
              <Icon name="check" size={12} className="mr-1" />
              {t("store.premiumOwned", "PREMIUM TRACK OWNED")}
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPremiumHint(t("store.premiumHint", "Premium Track isn't available yet — it unlocks when Season 0 begins. Your free track progress carries over."))}
                className="storef-disabled mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-purity px-3 py-2.5 text-sm font-bold text-[#11161d]"
              >
                <Icon name="lock" size={14} className="shrink-0" />
                {t("store.premiumTrack", "Premium Track · 750 Votives")}
              </button>
              {premiumHint && <p className="mt-1 text-xs text-amber-200">{premiumHint}</p>}
            </>
          )}
          <div className="mt-3">
            <PassRail state={state} />
          </div>
          {/* Pass footer */}
          <p className="mt-2 flex items-start gap-2 text-[11px] leading-snug text-text-3">
            <Icon name="card" size={13} className="mt-px shrink-0 text-text-3" />
            <span>
              {t("store.passFooter", "Passes never expire. Unclaimed items return next season.")}
            </span>
          </p>
        </div>

        {/* ---- Cosmetic catalog (purchasable) ---- */}
        <div className="pt-5">
          <SectionHeading>{t("store.headingsCosmetics", "Cradle Cosmetics")}</SectionHeading>
          <p className="mt-1 text-xs text-text-2">
            {t(
              "store.cosmeticsSub",
              "Cradle facades, banners, vehicle trim, shrine motifs and Leader garb. Owned items show their server-recorded check; deed items live below in the commemorative section.",
            )}
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
                    <div className="truncate text-[11px] text-text-3">
                      {t(`store.cosmetic.${c.id}.blurb`, c.blurb)}
                    </div>
                  </div>
                  {owned ? (
                    <span className="chip shrink-0 bg-surf-4 text-text-3">
                      <Icon name="check" size={12} className="mr-1" />
                      {t("store.owned", "OWNED")}
                    </span>
                  ) : (
                    <span className="chip shrink-0 bg-surf-4 text-xs font-bold text-text-1">
                      {/* `priceVotives` is optional on the cosmetic type: a piece with
                          no price renders nothing — never an invented 0. */}
                      {c.priceVotives == null ? null : (
                        <Bdi dir="ltr" className="num">{formatNumber(lang, c.priceVotives)}</Bdi>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ---- Commemorative: deed-earned + never-for-sale ---- */}
        <div className="pt-5">
          <SectionHeading>{t("store.headingsDeed", "Earned by Deed — commemorative")}</SectionHeading>
          <p className="mt-1 text-xs text-text-2">
            {t(
              "store.deedSub",
              "Commemorative pieces earned in the world. They appear here so their deeds stay visible.",
            )}
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
                    <div className="truncate text-[11px] text-text-3">
                      {t(`store.cosmetic.${c.id}.blurb`, c.blurb)}
                    </div>
                  </div>
                  {owned ? <EarnedBadge /> : <DeedLockedChip />}
                </div>
              );
            })}
          </div>
          {/* Callings/Oracle block — commemorative (no for-sale framing) */}
          <div className="mt-2 rounded-md bg-surf-0 px-2.5 py-2.5">
            <span className="chip bg-surf-4 text-text-2">
              <Icon name="star" size={12} className="mr-1" />
              {t("store.commemorative", "Commemorative")}
            </span>
            <p className="mt-2 text-xs leading-snug text-text-2">
              {t(
                "store.oracleNote",
                "Oracle trust grows from purity — clean recoveries, carried Codices, shielded allies. Feeding recovered AI turns them cold.",
              )}
            </p>
            <p className="mt-1.5 text-xs leading-snug text-text-2">
              {t("store.contributionNote", "Contribution is measured by the server's watch.")}
            </p>
          </div>
        </div>
      </div>
    </Sheet>
  );
}