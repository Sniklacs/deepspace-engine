// BottomNav — the fixed 64px slot bar (game-ui-shell-spec §1.3).
//
// Five fixed slots (Cradle · Expeditions · Lab · Armory · Circuit) plus the
// conditional WAR slot (Battles). The active slot is encoded four ways — hue,
// a top rule, label weight and icon stroke — plus `aria-current="page"`; a
// badge is a real count or an "an action awaits" dot with its own aria-label,
// never colour alone.
import { NAV, visibleNavIds } from "../../game/nav-slots";
import type { Tab } from "../../game/nav-slots";
import type { NavBadge } from "../../game/nav-badges";
import { Icon } from "../icons";
import { ReadyDot } from "../ui/ReadyDot";

export default function BottomNav({
  tab,
  onSwitch,
  badges,
}: {
  tab: Tab;
  onSwitch: (t: Tab) => void;
  badges: Record<string, NavBadge>;
}) {
  const ids = visibleNavIds(!!badges.battles);
  return (
    <nav
      aria-label="Sections"
      data-testid="bottom-nav"
      className="botnav fixed inset-x-0 bottom-0 z-40 border-t border-line-strong bg-surf-1/95 backdrop-blur-sm"
    >
      <ul className="mx-auto flex h-nav w-full max-w-6xl items-stretch">
        {NAV.filter((n) => ids.includes(n.id)).map((n) => {
          const b = badges[n.id] ?? {};
          const active = tab === n.id;
          const ready = b.lit || (b.count ?? 0) > 0 || b.live;
          return (
            <li key={n.id} className="flex-1">
              <button
                type="button"
                id={n.id === "circuit" ? "nav-tab-circuit" : undefined}
                data-tab={n.id}
                data-testid={`nav-${n.id}`}
                data-ready={b.lit || undefined}
                data-tutorial-target={n.id === "battles" ? "nav-battles" : undefined}
                aria-current={active ? "page" : undefined}
                aria-label={b.label}
                onClick={() => onSwitch(n.id)}
                className={`relative flex h-nav w-full min-w-tap flex-col items-center justify-center gap-0.5 ${
                  active ? "text-ember" : "text-text-3 hover:text-text-2"
                }`}
              >
                {active ? (
                  <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-ember" />
                ) : null}
                <Icon name={n.icon} size={24} strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
                <span className={`text-nav leading-none ${active ? "font-semibold" : "font-medium"}`}>
                  {n.label}
                </span>
                {b.count ? (
                  <span className="num absolute right-1/4 top-1.5 text-nav text-ember-soft">{b.count}</span>
                ) : null}
                {b.live ? (
                  <span aria-hidden="true" className="report-blink absolute right-1/4 top-2 h-2 w-2 rounded-full bg-ember" />
                ) : null}
                {ready && n.id !== "battles" ? (
                  <ReadyDot label={b.label ?? `${n.label} — there is an action available here`} size="sm" className="absolute right-1/4 top-2" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
