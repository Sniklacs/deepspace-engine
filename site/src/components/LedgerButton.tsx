// LEDGER BUTTON — the storefront seam's entry (visual-pass-1-storefront.md §1,
// design-system-rung1-spec §D): header button showing Scrip + Votives `.chip`s
// with `.num` balances (server state only). Opens the Cradle Ledger Sheet.
// NOT a 6th tab; no badge dots, no countdowns, ever. Emoji-free (line icons).
import { Icon } from "./icons";

export function LedgerButton({
  scrip,
  votives,
  onClick,
}: {
  scrip: number;
  votives: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-haspopup="dialog"
      title="Cradle Ledger — wallet and the honest shop"
      className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surf-2/60 px-2.5 py-2 text-gray-400 hover:bg-white/10 md:min-h-0"
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