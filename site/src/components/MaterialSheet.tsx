// MaterialSheet — THE explanation box for materials (owner 2026-10-14):
// "a box explaining where you get it, what it's for, how you obtain it."
//
// The copy has lived in game/tooltips.tsx all along, but its only doors
// were hover (desktop) and a 480 ms long-press (touch) — a player who
// simply taps never saw any of it. This sheet is the tap door: one shared
// bottom sheet, opened from anywhere via game/material-sheet's
// openMaterialSheet(), rendering the same registry copy (what / does /
// how) big enough to actually read.
//
// EXIT LAW: a 44px ✕, a tap on the backdrop, and Escape all close it.
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import {
  closeMaterialSheet,
  getMaterialSheet,
  openMaterialSheet,
  subscribeMaterialSheet,
  type MaterialSheetId,
} from "../game/material-sheet";
import { RESOURCE_TIPS, tipT } from "../game/tooltips";
import { getRace } from "../game/races";
import type { RaceId } from "../game/types";
import { Icon, type IconName } from "./icons";
import { useT } from "./i18n/I18n";
import { Bdi } from "./ui/Bdi";

export const MATERIAL_ICONS: Record<MaterialSheetId, IconName> = {
  embers: "flame",
  chipsets: "chip",
  supplies: "crate",
  warplate: "shield",
  plasma: "spark",
  mats: "globe",
  alloy: "gear",
  hazmat: "aegis",
  shots: "flask",
  medkit: "aegis",
  mechkit: "gear",
  armorkit: "armor",
  skmech: "hammer",
  gas: "fuel",
  battery: "spark",
  insight: "beacon",
  codices: "scroll",
};

/** Fallback display names (the catalogue's `resource.<id>` wins when set). */
export const MATERIAL_NAMES: Record<MaterialSheetId, string> = {
  embers: "Embers",
  chipsets: "Chipsets",
  supplies: "Supplies",
  warplate: "Warplate",
  plasma: "Plasma",
  mats: "Territory materials",
  alloy: "Alloy extractors",
  hazmat: "Hazmat suits",
  shots: "Radiation shots",
  medkit: "Medical kit",
  mechkit: "Mechanics kit",
  armorkit: "Armor kit",
  skmech: "Skilled mechanics",
  gas: "Fuel",
  battery: "Battery packs",
  insight: "Insight",
  codices: "Codices",
};

/**
 * A tappable material chip — icon + name + (optional) amount. Tapping it
 * opens the explanation sheet. ≥44px tall: it is a control, and the size
 * law applies to controls. Drop it anywhere a material is named as a
 * cost, a requirement, or a balance.
 */
export function MaterialTag({
  id,
  amount,
  count,
  mats,
  label,
  className = "",
}: {
  id: MaterialSheetId;
  /** the figure shown on the chip (a cost, a need, a yield) */
  amount?: ReactNode;
  /** the player's holding, shown inside the sheet */
  count?: number;
  mats?: Record<string, number>;
  label?: string;
  className?: string;
}) {
  const t = useT();
  const name = label ?? t(`resource.${id}`, MATERIAL_NAMES[id]);
  return (
    <button
      type="button"
      onClick={() => openMaterialSheet({ id, count, mats })}
      aria-label={t("material.explain", "What is {name}? What is it for, and how do I get it?", { name })}
      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-line bg-surf-2/70 px-3 py-1.5 text-[13px] text-text-2 transition-colors hover:bg-surf-3 hover:text-text-1 ${className}`}
    >
      <Icon name={MATERIAL_ICONS[id]} size={14} aria-hidden="true" className="flex-none text-amber-300" />
      <span className="font-medium">{name}</span>
      {amount != null && (
        <b className="text-text-1">
          <Bdi dir="ltr" className="num">{amount}</Bdi>
        </b>
      )}
      <span aria-hidden="true" className="text-text-3">ⓘ</span>
    </button>
  );
}

/** The ⓘ-only variant for rows whose own tap already has another job. */
export function MaterialInfoButton({
  id,
  count,
  mats,
  className = "",
}: {
  id: MaterialSheetId;
  count?: number;
  mats?: Record<string, number>;
  className?: string;
}) {
  const t = useT();
  const name = t(`resource.${id}`, MATERIAL_NAMES[id]);
  return (
    <button
      type="button"
      onClick={() => openMaterialSheet({ id, count, mats })}
      aria-label={t("material.explain", "What is {name}? What is it for, and how do I get it?", { name })}
      className={`flex h-11 w-11 flex-none items-center justify-center rounded-full border border-line text-[15px] text-text-2 hover:bg-surf-3 hover:text-text-1 ${className}`}
    >
      <span aria-hidden="true">ⓘ</span>
    </button>
  );
}

/** Mount once (in the play shell). Renders nothing until a material opens. */
export default function MaterialSheet() {
  const t = useT();
  const req = useSyncExternalStore(subscribeMaterialSheet, getMaterialSheet, getMaterialSheet);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMaterialSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req]);

  if (!req) return null;
  const block = RESOURCE_TIPS[req.id];
  if (!block) return null;
  const name = t(`resource.${req.id}`, MATERIAL_NAMES[req.id]);
  const matsEntries = req.id === "mats" && req.mats ? Object.entries(req.mats) : [];

  return (
    <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label={name}>
      <button
        type="button"
        aria-label={t("common.close", "Close")}
        onClick={closeMaterialSheet}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <section className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surf-1 p-4 pb-8 shadow-2xl">
        <div className="mb-3 flex items-start gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-line bg-surf-2">
            <Icon name={MATERIAL_ICONS[req.id]} size={20} aria-hidden="true" className="text-amber-300" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold leading-tight text-text-1">{name}</h3>
            {req.count != null && (
              <p className="mt-0.5 text-[13px] text-text-2">
                {t("material.youHold", "You hold")}{" "}
                <b className="text-text-1">
                  <Bdi dir="ltr" className="num">{Math.floor(req.count)}</Bdi>
                </b>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={closeMaterialSheet}
            aria-label={t("common.close", "Close")}
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-line text-text-1 hover:bg-surf-3"
          >
            <Icon name="x" size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="text-sm leading-relaxed text-text-2">{tipT(t, "resource", req.id, block)}</div>

        {matsEntries.length > 0 && (
          <ul className="mt-3 space-y-1">
            {matsEntries.map(([rid, n]) => (
              <li
                key={rid}
                className="flex items-center justify-between rounded-lg border border-line bg-surf-2/60 px-3 py-2 text-[13px]"
              >
                <span className="text-text-2">{getRace(rid as RaceId)?.name ?? rid}</span>
                <b className="text-text-1">
                  <Bdi dir="ltr" className="num">{n}</Bdi>
                </b>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
