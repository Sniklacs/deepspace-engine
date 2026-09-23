// ResourcePill — the ribbon's currency capsule (game-ui-shell-spec §1.2).
//
// One pill = one resource: line glyph + .num figure + (wide screens) the word.
// Tone is the ONLY colour decision and it is a token pair: `ember` = earned /
// positive, `plain` = neutral. There is deliberately no "rare loot" hue — the
// palette has none, and inventing one would cross meaning with hazard.
import { Icon } from "../icons";
import type { IconName } from "../icons";

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
  return (
    <button
      type="button"
      data-testid={testid}
      aria-haspopup="dialog"
      aria-label={`${label} — ${value.toLocaleString()}. Colony stores.`}
      onClick={onClick}
      className="pill flex-none gap-1 border border-line bg-surf-2/80 text-text-2 hover:bg-surf-3"
    >
      <Icon
        name={icon}
        size={14}
        className={tone === "ember" ? "text-ember-soft" : "text-text-2"}
        aria-hidden="true"
      />
      <b className={`num ${tone === "ember" ? "text-ember-soft" : "text-text-1"}`}>
        {value.toLocaleString()}
      </b>
      <span className="hidden text-[11px] text-text-3 sm:inline">{label}</span>
    </button>
  );
}
