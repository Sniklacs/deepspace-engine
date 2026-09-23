// ScreenHeader — every screen's title row (game-ui-shell-spec §5.3).
// 24px bold title, 13px sub, and one right-hand chip or action. 44px minimum.
import type { ReactNode } from "react";
import { Icon } from "../icons";
import type { IconName } from "../icons";

export function ScreenHeader({
  title,
  sub,
  icon,
  right,
  id,
  className = "",
}: {
  title: string;
  sub?: ReactNode;
  icon?: IconName;
  right?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={`flex min-h-tap items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2 id={id} className="flex items-center gap-2 text-2xl font-bold text-text-1">
          {icon ? <Icon name={icon} size={22} className="shrink-0 text-ember-soft" aria-hidden="true" /> : null}
          <span className="truncate">{title}</span>
        </h2>
        {sub ? <p className="mt-1 text-[13px] text-text-2">{sub}</p> : null}
      </div>
      {right ? <div className="flex flex-none flex-wrap items-center justify-end gap-1.5">{right}</div> : null}
    </div>
  );
}
