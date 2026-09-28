// LEDGER BUTTON — the storefront seam's entry (visual-pass-1-storefront.md §1,
// design-system-rung1-spec §D, amendment A8): shows Scrip + Votives `.num`
// balances from SERVER state only, and opens the Cradle Ledger Sheet.
// NOT a 6th tab; no badge dots, no countdowns, ever. Emoji-free (line icons).
//
// `variant="ribbon"` (game-ui-shell-spec §1.2/§5.3) is the compact pill the
// sticky HUD uses: glyph + the two figures, no word, still 44px tall so the
// touch floor holds. The wallet is never invented or adjusted here.
import { Icon } from "./icons";
import { Bdi } from "./ui/Bdi";
import { useLang, useT } from "./i18n/I18n";
import { formatNumber } from "../game/i18n/format";

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
  const t = useT();
  const lang = useLang();
  // The ribbon's two always-on money figures, through the ONE formatter: a bare
  // `toLocaleString()` is device-locale (1234 in Persian-Indic digits on a
  // Persian phone), and these are the most-seen numbers in the game. Formatting
  // the value once also keeps the accessible name and the painted figure the
  // same string — the floor itself is untouched.
  const scripShown = formatNumber(lang, Math.floor(scrip));
  const votivesShown = formatNumber(lang, Math.floor(votives));
  if (variant === "ribbon") {
    return (
      <button
        type="button"
        data-testid="ribbon-ledger"
        onClick={onClick}
        aria-haspopup="dialog"
        aria-label={t("ribbon.ledgerAria", {
          scrip: scripShown,
          votives: votivesShown,
        })}
        title={t("ribbon.ledger")}
        className="flex h-tap flex-none items-center gap-2 rounded-xl border border-line bg-surf-2 px-2 text-text-2"
      >
        <Icon name="ledger" size={16} className="shrink-0 text-text-2" aria-hidden="true" />
        <span className="flex items-center gap-1">
          <Icon name="coin" size={12} className="shrink-0 text-ember-soft" aria-hidden="true" />
          <b className="text-[12px] text-ember-soft"><Bdi dir="ltr" className="num">{scripShown}</Bdi></b>
        </span>
        <span className="flex items-center gap-1">
          <Icon name="star" size={12} className="shrink-0 text-purity" aria-hidden="true" />
          <b className="text-[12px] text-purity"><Bdi dir="ltr" className="num">{votivesShown}</Bdi></b>
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
      aria-label={t("ribbon.ledgerAria", {
          scrip: scripShown,
          votives: votivesShown,
        })}
      title={t("ribbon.ledger")}
      className="flex min-h-tap items-center gap-2 rounded-xl border border-line bg-surf-2/60 px-2.5 py-2 text-text-2 hover:bg-surf-3"
    >
      <Icon name="ledger" size={16} className="shrink-0 text-text-2" />
      <span className="hidden text-xs font-semibold text-text-2 sm:inline">{t("ribbon.ledgerWord")}</span>
      <span className="chip gap-1 text-text-2">
        <Icon name="coin" size={12} className="shrink-0 text-ember-soft" />
        <b className="text-ember-soft"><Bdi dir="ltr" className="num">{scripShown}</Bdi></b>
      </span>
      <span className="chip gap-1 text-text-2">
        <Icon name="star" size={12} className="shrink-0 text-purity" />
        <b className="text-purity"><Bdi dir="ltr" className="num">{votivesShown}</Bdi></b>
      </span>
    </button>
  );
}
