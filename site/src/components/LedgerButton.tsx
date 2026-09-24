// LEDGER BUTTON — the storefront seam's entry (visual-pass-1-storefront.md §1,
// design-system-rung1-spec §D, amendment A8): shows Scrip + Votives `.num`
// balances from SERVER state only, and opens the Cradle Ledger Sheet.
// NOT a 6th tab; no badge dots, no countdowns, ever. Emoji-free (line icons).
//
// `variant="ribbon"` (game-ui-shell-spec §1.2/§5.3) is the compact pill the
// sticky HUD uses: glyph + the two figures, no word, still 44px tall so the
// touch floor holds. The wallet is never invented or adjusted here.
import { Icon } from "./icons";

export function LedgerButton({
  scrip,
  votives,
  onClick,
  variant = "default",
}: {
  scrip: number;
  votives: number;
  onClick: () => void;
  variant?: "default" | "ribbon";
}) {
  if (variant === "ribbon") {
    return (
      <button
        type="button"
        data-testid="ribbon-ledger"
        onClick={onClick}
        aria-haspopup="dialog"
        aria-label={`Cradle Ledger — ${Math.floor(scrip)} Scrip, ${Math.floor(votives)} Votives`}
        title="Cradle Ledger — wallet and the honest shop"
        className="flex h-tap flex-none items-center gap-2 rounded-xl border border-line bg-surf-2 px-2 text-text-2"
      >
        <Icon name="ledger" size={16} className="shrink-0 text-text-2" aria-hidden="true" />
        <span className="flex items-center gap-1">
          <Icon name="coin" size={12} className="shrink-0 text-ember-soft" aria-hidden="true" />
          <b className="num text-[12px] text-ember-soft">{Math.floor(scrip).toLocaleString()}</b>
        </span>
        <span className="flex items-center gap-1">
          <Icon name="star" size={12} className="shrink-0 text-purity" aria-hidden="true" />
          <b className="num text-[12px] text-purity">{Math.floor(votives).toLocaleString()}</b>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      data-testid="ledger-button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={`Cradle Ledger — ${Math.floor(scrip)} Scrip, ${Math.floor(votives)} Votives`}
      title="Cradle Ledger — wallet and the honest shop"
      className="flex min-h-tap items-center gap-2 rounded-xl border border-line bg-surf-2/60 px-2.5 py-2 text-text-2 hover:bg-surf-3"
    >
      <Icon name="ledger" size={16} className="shrink-0 text-text-2" />
      <span className="hidden text-xs font-semibold text-text-2 sm:inline">Ledger</span>
      <span className="chip gap-1 text-text-2">
        <Icon name="coin" size={12} className="shrink-0 text-ember-soft" />
        <b className="num text-ember-soft">{Math.floor(scrip).toLocaleString()}</b>
      </span>
      <span className="chip gap-1 text-text-2">
        <Icon name="star" size={12} className="shrink-0 text-purity" />
        <b className="num text-purity">{Math.floor(votives).toLocaleString()}</b>
      </span>
    </button>
  );
}
