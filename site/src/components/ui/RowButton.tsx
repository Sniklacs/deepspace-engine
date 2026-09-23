// RowButton / EmptyRow — the shell's list row (game-ui-shell-spec §5.3).
//
// icon + title + sub + chip, 44px minimum (56px when it carries two lines of
// sub), always a real button that opens a sheet or a modal. EmptyRow states an
// absence in one honest line — it is never a disabled button.
import type { ReactNode } from "react";
import { Icon } from "../icons";
import type { IconName } from "../icons";

export function RowButton({
  icon,
  title,
  sub,
  chip,
  onClick,
  testid,
  tone = "default",
}: {
  icon: IconName;
  title: ReactNode;
  sub?: ReactNode;
  chip?: ReactNode;
  onClick: () => void;
  testid?: string;
  tone?: "default" | "destructive";
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-haspopup="dialog"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
        tone === "destructive"
          ? "min-h-tap-lg border-danger/40 bg-danger/5 text-danger-soft hover:bg-danger/10"
          : "min-h-tap border-line bg-surf-3/60 text-text-1 hover:bg-surf-4"
      }`}
    >
      <Icon
        name={icon}
        size={18}
        className={`shrink-0 ${tone === "destructive" ? "text-danger-soft" : "text-ember-soft"}`}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{title}</span>
        {sub ? <span className="block truncate text-[11px] text-text-3">{sub}</span> : null}
      </span>
      {chip ? <span className="shrink-0">{chip}</span> : null}
    </button>
  );
}

export function EmptyRow({ icon, text }: { icon: IconName; text: string }) {
  return (
    <p className="flex min-h-tap items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2 text-[12px] text-text-3">
      <Icon name={icon} size={18} className="shrink-0 text-text-3" aria-hidden="true" />
      {text}
    </p>
  );
}
