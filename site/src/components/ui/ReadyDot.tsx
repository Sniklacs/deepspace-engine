// ReadyDot — "there is an action available here" (game-ui-shell-spec §5.3/§1.3).
//
// A dot means an available action, NEVER a notification. It always carries
// `data-ready="true"` and a label saying what awaits, so the signal is never
// colour alone. The derivation is a closed predicate list (game/nav-badges.ts
// + game/cradle-slots.ts) so a badge storm cannot grow.
export function ReadyDot({
  label,
  size = "md",
  className = "",
}: {
  /** what awaits — required, so a dot can never be unexplained */
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      data-ready="true"
      className={`inline-block flex-none rounded-full bg-ember ${
        size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2"
      } ${className}`}
    />
  );
}
