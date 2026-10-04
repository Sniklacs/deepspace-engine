// StackedShips — the shared ship-stacking helper (owner 2026-10-04).
//
// Hans's rule: wherever ships are listed, stop rendering one row per
// individual ship. Identical ships (same class + race) collapse into ONE
// stacked row with a quantity badge ("Frigate ×12"). Tap the stack to
// expand and inspect the individual ships underneath; the default view is
// stacked so long fleets don't turn into an endless scroll.
//
// One helper for every ship list — don't build three different stackers.
// Used by: AllianceShipyard (fleet), WorldMapView (raid ship picker),
// RaidAlarmOverlay (hostile composition, counted inline). FormationsTab
// keeps per-ship rows on purpose: each reserved ship is an
// individually-loaded troop container, and stacking would hide its loader.
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { shipArtUrl, shipName, type ShipClass } from "../game/worldmap";
import { useT } from "./i18n/I18n";

/** Minimum shape for a stackable ship. */
export interface StackableShip {
  id: string;
  class: ShipClass;
  raceId: string;
  name: string;
}

/** One stack: every identical ship (same class + race). */
export interface ShipStack<T extends StackableShip> {
  class: ShipClass;
  raceId: string;
  ships: T[];
}

/**
 * Group identical ships (same class + race) into stacks, in first-seen
 * order. Pure function — covered by StackedShips.test.ts.
 */
export function groupShipsByClass<T extends StackableShip>(ships: T[]): ShipStack<T>[] {
  const byKey = new Map<string, ShipStack<T>>();
  for (const s of ships) {
    const key = `${s.raceId}:${s.class}`;
    let stack = byKey.get(key);
    if (!stack) {
      stack = { class: s.class, raceId: s.raceId, ships: [] };
      byKey.set(key, stack);
    }
    stack.ships.push(s);
  }
  return [...byKey.values()];
}

/**
 * ShipArt — shared ship thumbnail with the same onError-fallback pattern
 * as TurretThumb: it hides itself when the art is missing, so there is
 * never a broken image. Races without an art set yet render nothing.
 */
export function ShipArt({
  raceId,
  shipClass,
  size = 32,
  className = "shrink-0 rounded-md border border-line object-cover",
  alt,
}: {
  raceId: string;
  shipClass: ShipClass;
  size?: number;
  className?: string;
  alt?: string;
}) {
  const url = shipArtUrl(raceId, shipClass);
  const [ok, setOk] = useState(true);
  if (!url || !ok) return null;
  return (
    <img
      src={url}
      alt={alt ?? shipName(raceId, shipClass)}
      loading="lazy"
      width={size}
      height={size}
      onError={() => setOk(false)}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * StackedShips — render one stacked row per identical-ship group.
 * The header shows the thumb, the class name, and a "×N" quantity badge
 * whenever there's more than one. The chevron expands the stack to
 * reveal the individual ships (rendered by `renderShip`); the default
 * view stays stacked.
 */
export function StackedShips<T extends StackableShip>({
  ships,
  renderShip,
  renderHeaderThumb,
  stackExtra,
  onStackClick,
  emptyText,
  defaultExpanded = false,
  testid,
}: {
  ships: T[];
  /** One row per individual ship inside an expanded stack. */
  renderShip: (ship: T, stack: ShipStack<T>) => ReactNode;
  /** Thumb for the stack header. Defaults to the race's ShipArt. */
  renderHeaderThumb?: (stack: ShipStack<T>) => ReactNode;
  /** Extra content pinned in the stack header, before the chevron. */
  stackExtra?: (stack: ShipStack<T>, expanded: boolean) => ReactNode;
  /**
   * Tap on the stack header row (thumb + name + badge). When omitted,
   * tapping the header toggles expand/collapse itself. The chevron always
   * toggles expand/collapse regardless.
   */
  onStackClick?: (stack: ShipStack<T>, setExpanded: (open: boolean) => void) => void;
  emptyText?: string;
  defaultExpanded?: boolean;
  testid?: string;
}) {
  const t = useT();
  const stacks = useMemo(() => groupShipsByClass(ships), [ships]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (stacks.length === 0) {
    return emptyText ? <p className="text-xs text-text-2">{emptyText}</p> : null;
  }

  return (
    <ul className="space-y-1" data-testid={testid}>
      {stacks.map((stack) => {
        const key = `${stack.raceId}:${stack.class}`;
        const expanded = defaultExpanded || open[key] === true;
        const setExpanded = (v: boolean) => setOpen((prev) => ({ ...prev, [key]: v }));
        const count = stack.ships.length;
        const label = shipName(stack.raceId, stack.class);
        return (
          <li key={key} className="rounded-lg border border-line bg-surf-1">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <button
                type="button"
                onClick={() =>
                  onStackClick ? onStackClick(stack, setExpanded) : setExpanded(!expanded)
                }
                aria-expanded={expanded}
                title={
                  onStackClick
                    ? t("stacked.tapHint", "Tap to select the whole stack")
                    : t("stacked.tapExpandHint", "Tap to expand the stack")
                }
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                {renderHeaderThumb ? (
                  renderHeaderThumb(stack)
                ) : (
                  <ShipArt raceId={stack.raceId} shipClass={stack.class} size={32} />
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-text-1">{label}</span>
                {count > 1 && (
                  <span className="shrink-0 rounded-full border border-acc/50 bg-acc/15 px-2 py-0.5 text-[11px] font-semibold text-acc">
                    ×{count}
                  </span>
                )}
              </button>
              {stackExtra?.(stack, expanded)}
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                aria-label={
                  expanded
                    ? t("stacked.collapse", "Collapse {label}", { label })
                    : t("stacked.expand", "Expand {label} — {count} ships", { label, count })
                }
                className="shrink-0 rounded px-1.5 py-0.5 text-sm text-text-2 hover:text-text-1"
              >
                {expanded ? "▾" : "▸"}
              </button>
            </div>
            {expanded && (
              <div className="border-t border-line px-2 py-1.5">
                {stack.ships.map((s) => (
                  <div key={s.id} className="py-0.5">
                    {renderShip(s, stack)}
                  </div>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
