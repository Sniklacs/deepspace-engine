// Panel / PanelHeader — the shell's one container (game-ui-shell-spec §5.3).
//
// Shape only: heavy radius (radius-xl = 20px), token surfaces, zero hues of its
// own. `accent` is the ONE colour a caller may pass in, and only as
// `race.accent` from game/races.ts (identity, lawful — §9.1 rule 4).
import type { CSSProperties, ElementType, ReactNode } from "react";

export type PanelVariant = "default" | "raised" | "hero" | "tinted" | "inset";

const VARIANT: Record<PanelVariant, string> = {
  default: "border-line bg-surf-2",
  raised: "border-line bg-surf-3",
  // the base view's plate: ground glow from a token-derived alpha (§2.3)
  hero: "border-line bg-surf-2 bg-linear-to-b from-ember/5 to-transparent",
  tinted: "border-ember/25 bg-ember/5",
  inset: "border-line bg-surf-3/60",
};

export function Panel({
  children,
  variant = "default",
  as = "section",
  className = "",
  accent,
  id,
  labelledBy,
  testid,
  style,
}: {
  children: ReactNode;
  variant?: PanelVariant;
  as?: ElementType;
  className?: string;
  /** `race.accent` — identity tint only. Never a literal. */
  accent?: string;
  id?: string;
  labelledBy?: string;
  testid?: string;
  style?: CSSProperties;
}) {
  const Tag = as;
  return (
    <Tag
      id={id}
      aria-labelledby={labelledBy}
      data-testid={testid}
      className={`rounded-2xl border p-3 sm:p-4 ${VARIANT[variant]} ${
        accent ? "border-l-2" : ""
      } ${className}`}
      style={accent ? { ...style, borderLeftColor: accent } : style}
    >
      {children}
    </Tag>
  );
}

export function PanelHeader({
  title,
  sub,
  eyebrow,
  right,
  id,
  className = "",
}: {
  title: ReactNode;
  sub?: ReactNode;
  eyebrow?: string;
  right?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <header className={`flex items-start justify-between gap-2 ${className}`}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 id={id} className="truncate text-[15px] font-semibold text-text-1">
          {title}
        </h2>
        {sub ? <p className="mt-0.5 text-[11px] text-text-3">{sub}</p> : null}
      </div>
      {right ? <div className="flex flex-none items-center gap-1.5">{right}</div> : null}
    </header>
  );
}
