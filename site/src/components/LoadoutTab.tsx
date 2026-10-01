// LOADOUT TAB — the battle-dressing page (design/loadout.md). Roster rail of
// heroes + leaders, a five-slot mannequin (weapon/armor live; module1/module2
// and relic honestly locked until the module/artifact models land), a stores
// picker for racked forge pieces, and a read-only battle-modifier summary.
//
// Server-authoritative: every equip/unequip posts through the API fns; the
// component only renders `state.forgeItems[].equippedBy` and never invents
// worn state. Battle snapshots carry resolved deltas (engine.resolveHeroEquipment)
// stamped at pledge/commit time — the page shows the same deltas for the
// selected bearer so what you see is what marches.
import { useMemo, useState } from "react";
import type { GameState } from "../game/types";
import type { ForgeItem, LoadoutSlot } from "../game/forge";
import { forgeGrade } from "../game/forge";
import { useT } from "./i18n/I18n";

/** Race portrait SVGs live in public/art/races (ashtar's file is "asart.svg"). */
const RACE_PORTRAIT: Record<string, string> = {
  anunnaki: "/art/races/anunnaki.svg",
  ashtar: "/art/races/asart.svg",
  draconians: "/art/races/draconians.svg",
  grays: "/art/races/grays.svg",
  nephilim: "/art/races/nephilim.svg",
  watchers: "/art/races/watchers.svg",
};

/** Downscaled weapon thumbnails: public/art/loadout/weapons/{race}-{family}.webp */
function weaponThumb(item: ForgeItem): string | null {
  const race = item.provenance.race;
  if (!race) return null;
  return `/art/loadout/weapons/${race}-${item.family}.webp`;
}

const SLOT_SILHOUETTE: Record<LoadoutSlot, string> = {
  weapon: "/art/loadout/slot-weapon.webp",
  armor: "/art/loadout/slot-armor.webp",
  module1: "/art/loadout/slot-module.webp",
  module2: "/art/loadout/slot-module.webp",
  relic: "/art/loadout/slot-relic.webp",
};

export interface LoadoutBearer {
  kind: "hero" | "leader";
  id: string;
}

interface Props {
  state: GameState;
  busy: boolean;
  onEquip: (itemId: string, bearer: LoadoutBearer, slot: LoadoutSlot) => void;
  onUnequip: (itemId: string) => void;
}

const SLOTS: { id: LoadoutSlot; fits: "assault" | "defence" | null; lockedKey: string }[] = [
  { id: "weapon", fits: "assault", lockedKey: "" },
  { id: "armor", fits: "defence", lockedKey: "" },
  { id: "module1", fits: null, lockedKey: "loadout.lockedModules" },
  { id: "module2", fits: null, lockedKey: "loadout.lockedModules" },
  { id: "relic", fits: null, lockedKey: "loadout.lockedRelic" },
];

export default function LoadoutTab({ state, busy, onEquip, onUnequip }: Props) {
  const t = useT();
  const playerRace = state.race ?? null;
  const heroes = useMemo(
    () =>
      (state.prologue?.heroes ?? []).map((h) => ({
        kind: "hero" as const,
        id: h.id,
        name: h.name,
        race: h.race as string | null,
      })),
    [state],
  );
  const leaders = useMemo(
    () =>
      (state.leaders ?? []).map((l) => ({
        kind: "leader" as const,
        id: l.id,
        name: l.name,
        race: playerRace,
      })),
    [state, playerRace],
  );
  const roster = useMemo(() => [...heroes, ...leaders], [heroes, leaders]);

  const [bearerId, setBearerId] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<LoadoutSlot>("weapon");
  const bearer: LoadoutBearer | null = useMemo(() => {
    const found = roster.find((r) => r.id === (bearerId ?? roster[0]?.id));
    return found ? { kind: found.kind, id: found.id } : null;
  }, [roster, bearerId]);
  const bearerName = roster.find((r) => r.id === bearer?.id)?.name ?? "";

  const items = state.forgeItems ?? [];
  const worn = useMemo(() => {
    const out = {} as Partial<Record<LoadoutSlot, ForgeItem>>;
    if (!bearer) return out;
    for (const it of items) {
      const eb = it.equippedBy;
      if (eb && eb.kind === bearer.kind && eb.id === bearer.id) out[eb.slot] = it;
    }
    return out;
  }, [items, bearer]);

  const activeSlot = SLOTS.find((s) => s.id === slotId)!;
  const rack = useMemo(() => {
    if (!activeSlot.fits) return [];
    return items.filter(
      (it) => it.kind === activeSlot.fits && it.location === "cradle" && !it.equippedBy,
    );
  }, [items, activeSlot]);

  // Read-only battle-modifier summary: the same resolved deltas the server
  // stamps into battle snapshots (power/guard in hero-attribute space).
  const mods = useMemo(() => {
    const w = worn.weapon;
    const a = worn.armor;
    return {
      power: (w?.stats.power ?? 0) + (a?.stats.power ?? 0),
      guard: (w?.stats.guard ?? 0) + (a?.stats.guard ?? 0),
      pieces: [w, a].filter(Boolean).length,
    };
  }, [worn]);

  if (roster.length === 0) {
    return (
      <div className="p-6 text-sm text-text-3">{t("loadout.noRoster")}</div>
    );
  }

  return (
    <div>
      {/* armory banner */}
      <div className="relative h-32 overflow-hidden rounded-xl border border-white/10 md:h-40">
        <img
          src="/art/loadout/armory-banner.webp"
          alt=""
          aria-hidden
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <h2 className="absolute bottom-3 start-4 text-lg font-bold text-amber-100">{t("loadout.title")}</h2>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr_280px]">
      {/* roster rail */}
      <section aria-label={t("loadout.roster")} className="rounded-xl border border-white/10 bg-white/5 p-3">
        <h3 className="text-sm font-semibold text-text-1">{t("loadout.roster")}</h3>
        <div className="mt-2 space-y-1">
          {roster.map((r) => {
            const portrait = r.race ? RACE_PORTRAIT[r.race] : undefined;
            return (
              <button
                key={r.id}
                onClick={() => setBearerId(r.id)}
                aria-pressed={bearer?.id === r.id}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-sm ${
                  bearer?.id === r.id ? "bg-amber-400/20 text-amber-100" : "text-text-2 hover:bg-white/5"
                }`}
              >
                {portrait && (
                  <img src={portrait} alt="" aria-hidden className="h-9 w-9 shrink-0 rounded-full object-cover" />
                )}
                <span>
                  <span className="me-2 text-xs text-text-3">{r.kind === "hero" ? t("loadout.hero") : t("loadout.leader")}</span>
                  {r.name}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* mannequin */}
      <section aria-label={t("loadout.slots")} className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h3 className="text-sm font-semibold text-text-1">
          {t("loadout.dressing")} — {bearerName}
        </h3>
        <div className="mt-3 grid gap-2">
          {SLOTS.map((s) => {
            const it = worn[s.id];
            const locked = s.fits === null;
            const selected = slotId === s.id;
            const art = it ? weaponThumb(it) : SLOT_SILHOUETTE[s.id];
            return (
              <div
                key={s.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                  selected ? "border-amber-400/60 bg-amber-400/10" : "border-white/10 bg-black/20"
                } ${locked ? "opacity-60" : ""}`}
              >
                {art && (
                  <img
                    src={art}
                    alt=""
                    aria-hidden
                    className={`h-12 w-12 shrink-0 rounded-md object-cover ${it ? "" : "opacity-70"}`}
                  />
                )}
                <button
                  onClick={() => setSlotId(s.id)}
                  disabled={locked}
                  aria-pressed={selected}
                  className="flex-1 text-start"
                >
                  <div className="text-xs uppercase tracking-wider text-text-3">{t(`loadout.slot.${s.id}`)}</div>
                  {locked ? (
                    <div className="text-xs text-text-3">{t(s.lockedKey)}</div>
                  ) : it ? (
                    <div className="text-sm text-text-1">
                      {it.name} <span className="text-xs text-text-3">({t(forgeGrade(it.grade).labelKey)})</span>
                    </div>
                  ) : (
                    <div className="text-sm text-text-3">{t("loadout.empty")}</div>
                  )}
                </button>
                {!locked && it && (
                  <button
                    onClick={() => onUnequip(it.id)}
                    disabled={busy}
                    className="ms-2 rounded-lg border border-white/15 px-2 py-1 text-xs text-text-2 hover:bg-white/10 disabled:opacity-50"
                    aria-label={t("loadout.remove", { name: it.name })}
                  >
                    {t("loadout.removeShort")}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* battle-modifier summary */}
        <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-3">{t("loadout.mods")}</h4>
          {mods.pieces === 0 ? (
            <p className="mt-1 text-xs text-text-3">{t("loadout.noMods")}</p>
          ) : (
            <p className="mt-1 text-sm text-text-1">
              {t("loadout.modsLine", { power: mods.power, guard: mods.guard })}
            </p>
          )}
          <p className="mt-1 text-xs text-text-3">{t("loadout.modsNote")}</p>
        </div>
      </section>

      {/* stores picker */}
      <section aria-label={t("loadout.stores")} className="rounded-xl border border-white/10 bg-white/5 p-3">
        <h3 className="text-sm font-semibold text-text-1">{t("loadout.stores")}</h3>
        <p className="mt-1 text-xs text-text-3">
          {activeSlot.fits
            ? t("loadout.pickFor", { slot: t(`loadout.slot.${activeSlot.id}`) })
            : t(activeSlot.lockedKey)}
        </p>
        <div className="mt-2 max-h-96 space-y-1 overflow-y-auto">
          {rack.length === 0 && activeSlot.fits && (
            <p className="text-xs text-text-3">{t("loadout.rackEmpty")}</p>
          )}
          {rack.map((it) => {
            const thumb = weaponThumb(it);
            return (
              <button
                key={it.id}
                onClick={() => bearer && onEquip(it.id, bearer, activeSlot.id)}
                disabled={busy || !bearer}
                className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-start hover:border-amber-400/50 disabled:opacity-50"
              >
                {thumb && <img src={thumb} alt="" aria-hidden className="h-10 w-10 shrink-0 rounded-md object-cover" />}
                <span>
                  <div className="text-sm text-text-1">{it.name}</div>
                  <div className="text-xs text-text-3">
                    {t(forgeGrade(it.grade).labelKey)} · +{it.stats.power} {t("loadout.power")} · +{it.stats.guard} {t("loadout.guard")}
                  </div>
                </span>
              </button>
            );
          })}
        </div>
      </section>
      </div>
    </div>
  );
}
