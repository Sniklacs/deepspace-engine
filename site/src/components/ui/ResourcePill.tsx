// ResourcePill — the ribbon's currency capsule (game-ui-shell-spec §1.2).
//
// One pill = one resource: line glyph + .num figure + (wide screens) the word.
// Tone is the ONLY colour decision and it is a token pair: `ember` = earned /
// positive, `plain` = neutral. There is deliberately no "rare loot" hue — the
// palette has none, and inventing one would cross meaning with hazard.
import { Icon } from "../icons";
import type { IconName } from "../icons";
import { useLang, useT } from "../i18n/I18n";
import { Bdi } from "./Bdi";
import { formatNumber } from "../../game/i18n/format";

export function ResourcePill({
  icon,
  value,
  label,
  tone = "plain",
  onClick,
  testid,
}: {
  icon: IconName;
  value: number;
  label: string;
  tone?: "ember" | "plain";
  onClick?: () => void;
  testid?: string;
}) {
  const t = useT();
  const lang = useLang();
  // The ONE formatter (game/i18n/format.ts) pins the digits ASCII. A bare
  // `toLocaleString()` reads the DEVICE's locale, so this primitive — which
  // paints every resource pill in the HUD — printed 1234 with Persian-Indic
  // digits on a Persian phone, against a catalogue that is ASCII-pinned.
  const shown = formatNumber(lang, value);
  return (
    <button
      type="button"
      data-testid={testid}
      aria-haspopup="dialog"
      aria-label={t("ribbon.pill", { label, value: shown })}
      onClick={onClick}
      className="pill flex-none gap-1 border border-line bg-surf-2/80 text-text-2 hover:bg-surf-3"
    >
      <Icon
        name={icon}
        size={14}
        className={tone === "ember" ? "text-ember-soft" : "text-text-2"}
        aria-hidden="true"
      />
      <b className={tone === "ember" ? "text-ember-soft" : "text-text-1"}>
        <Bdi dir="ltr" className="num">{shown}</Bdi>
      </b>
      <span className="hidden text-[11px] text-text-3 sm:inline">{label}</span>
    </button>
  );
}
