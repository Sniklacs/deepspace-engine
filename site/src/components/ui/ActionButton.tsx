// ActionButton — the one button in the app (game-ui-shell-spec §3.3).
//
// Two-line by design: label + a second line that ALWAYS carries the cost or the
// effect, never buried in a tooltip. An action that can become unavailable is
// rendered with `aria-disabled` and a VISIBLE reason line — never the HTML
// `disabled` attribute (battles-panel-and-narration-spec §A.3, generalised).
// Sizes: sm 44 · md 48 (default) · lg 56. Nothing here is purchasable: the
// gold variant exists for the storefront's single gold CTA and is unused by the
// shell's own screens (G4).
import type { ReactNode } from "react";
import { Icon } from "../icons";
import type { IconName } from "../icons";

export type ActionVariant = "primary" | "gold" | "secondary" | "ghost" | "destructive";
export type ActionSize = "sm" | "md" | "lg";

const VARIANT: Record<ActionVariant, string> = {
  primary: "bg-ember text-black hover:brightness-110",
  gold: "bg-purity text-surf-2 hover:brightness-110",
  secondary: "border border-line-strong bg-surf-3 text-text-1 hover:bg-surf-4",
  ghost: "border border-line bg-transparent text-text-2 hover:bg-surf-4",
  destructive: "border border-danger/60 bg-danger/10 text-danger-soft hover:bg-danger/20",
};

const SIZE: Record<ActionSize, string> = {
  sm: "min-h-tap rounded-xl px-3 text-[13px]",
  md: "min-h-tap-lg rounded-xl px-4 text-sm",
  lg: "min-h-[56px] rounded-xl px-5 text-base",
};

export function ActionButton({
  label,
  sub,
  icon,
  variant = "primary",
  size = "md",
  full = false,
  onClick,
  reason,
  locked = false,
  busy = false,
  testid,
  dataAction,
  ariaLabel,
  className = "",
}: {
  label: string;
  /** the always-visible second line: cost, effect, or state */
  sub?: ReactNode;
  icon?: IconName;
  variant?: ActionVariant;
  size?: ActionSize;
  full?: boolean;
  onClick?: () => void;
  /** why the action is not available (rendered, never hidden) */
  reason?: string;
  /** aria-disabled — the action stays focusable and stays explained */
  locked?: boolean;
  busy?: boolean;
  testid?: string;
  dataAction?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const line = locked ? reason ?? sub : sub;
  return (
    <button
      type="button"
      data-testid={testid}
      data-action={dataAction}
      aria-label={ariaLabel}
      aria-disabled={locked || undefined}
      aria-busy={busy || undefined}
      onClick={locked ? undefined : onClick}
      className={`${SIZE[size]} ${VARIANT[variant]} ${
        full ? "w-full" : ""
      } flex items-center justify-center gap-2 font-semibold transition-colors ${
        locked ? "opacity-60" : ""
      } ${className}`}
    >
      {icon ? <Icon name={icon} size={18} className="shrink-0" aria-hidden="true" /> : null}
      <span className="flex min-w-0 flex-col items-start">
        <span className="truncate">{label}</span>
        {line ? (
          <span className="block text-[11px] font-normal leading-tight opacity-90">{line}</span>
        ) : null}
      </span>
    </button>
  );
}
