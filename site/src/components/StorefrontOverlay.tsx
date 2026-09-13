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
import type { ReactNode } from "react";
import {
  MONETIZATION_CONFIG,
  HEAD_START_PACKS,
  PURCHASABLE_COSMETICS,
  DEED_COSMETICS,
  SEASON_TIERS,
  tierFromXp,
  type PackGrant,
  type HeadStartPackDef,
} from "../game/monetization";
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

function PackCard({ pack, disabled }: { pack: HeadStartPackDef; disabled: boolean }) {
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
      <button
        type="button"
        disabled={disabled}
        aria-disabled={disabled}
        className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-line bg-surf-3 px-3 py-2 text-xs font-medium text-text-2 ${
          disabled ? "storef-disabled" : ""
        }`}
      >
        <Icon name="lock" size={14} className="shrink-0" />
        {disabled ? "The ledger opens when the world is ready" : "Purchasable when the ledger opens"}
      </button>
    </article>
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

export function StorefrontOverlay({
  state,
  open,
  onClose,
}: {
  state: GameState;
  open: boolean;
  onClose: () => void;
}) {
  const enabled = MONETIZATION_CONFIG.storefrontEnabled;
  const ownedCosmetics = new Set(state.entitlements.cosmetics);
  const passOwned = state.battlePass.premium || state.entitlements.passes.includes(MONETIZATION_CONFIG.season0Id);
  const hasWallet = !!state.currency;

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

        {/* ---- Head-Start Packs ---- */}
        <div className="pt-5">
          <SectionHeading>Head-Start Packs</SectionHeading>
          <p className="mt-1 text-xs text-text-2">
            Everything a pack grants is craftable or earnable in play — a head start on the earned
            curve, never above it. Packs are purchased with real money; none are purchasable yet.
          </p>
          <div className="mt-2 space-y-2">
            {HEAD_START_PACKS.map((p) => (
              <PackCard key={p.id} pack={p} disabled={!enabled} />
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