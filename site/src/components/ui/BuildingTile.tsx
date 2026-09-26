// BuildingTile — one slot on the Cradle plate (game-ui-shell-spec §2.3).
//
// A real button with a real level and a real readiness state. `data-slot` and
// `data-ready` are the hooks the Phase-2 isometric render keeps: only the
// grid changes (slots carry x/y), never this component's contract.
import type { CradleSlot } from "../../game/cradle-slots";
import { Icon } from "../icons";
import { ReadyDot } from "./ReadyDot";
import { useT } from "../i18n/I18n";
import { slotLabel } from "../../game/i18n";

export function BuildingTile({
  slot,
  state,
  onOpen,
}: {
  slot: CradleSlot;
  state: Parameters<CradleSlot["level"]>[0];
  onOpen: (id: CradleSlot["id"]) => void;
}) {
  const t = useT();
  const level = slot.level(state);
  const ready = slot.ready(state);
  const label = slotLabel(t, slot);
  return (
    <button
      type="button"
      data-slot={slot.id}
      data-testid={`slot-${slot.id}`}
      data-ready={ready || undefined}
      aria-haspopup="dialog"
      aria-label={
        ready
          ? t("tile.readyToAdvance", { slot: label })
          : t("tile.level", { slot: label, level })
      }
      onClick={() => onOpen(slot.id)}
      className="relative flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-tile border border-line bg-surf-3/85 px-1 py-2 text-center transition-colors hover:bg-surf-4"
    >
      <Icon name={slot.icon} size={22} className="text-text-2" aria-hidden="true" />
      <span className="text-[11px] font-medium leading-tight text-text-1">{label}</span>
      {slot.counter ? (
        <span className="num text-[11px] text-ember-soft">
          {level} {t(`tile.${slot.counter}`, slot.counter)}
        </span>
      ) : (
        <span className="num text-[11px] text-ember-soft">{t("tile.lv", { level })}</span>
      )}
      {ready ? (
        <ReadyDot label={t("tile.ready", { slot: label })} className="absolute end-1.5 top-1.5" />
      ) : null}
    </button>
  );
}
