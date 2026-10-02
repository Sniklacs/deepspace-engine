// WorkshopShelf — the workshop inventory, inline on the page (owner 2026-09-30:
// the workshop lives on the EXPLORATION page now — that's what most of it is
// built for — and the old one-at-a-time sheet is gone with it).
//
// THE VALUE BOX (owner 2026-09-30: "click once then you have to open it again.
// It's redundant and annoying"): every kit row carries its own quantity stepper
// and a single Forge button that builds that many at once. One tap, N kits,
// no dialog to reopen — the server loops `craftItemBatch` and reports how many
// actually landed if supplies run dry mid-batch.
//
// PRESENTATION ONLY: every figure comes from `state` and `engineHelpers`; the
// only local state is each row's chosen quantity.
import { useState } from "react";
import { Panel } from "./ui/Panel";
import { ActionButton } from "./ui/ActionButton";
import { Icon } from "./icons";
import { Tooltip } from "./Tooltip";
import { Bdi } from "./ui/Bdi";
import { engineHelpers } from "../game/client-utils";
import { kitsHeld } from "../game/cradle-slots";
import { CRAFT, CRAFT_RESOURCE_KEY, canForgeAlloy, alloyRecipeRaces } from "../game/engine";
import type { CraftKind } from "../game/engine";
import { RACES, raceText } from "../game/races";
import { tipT, tipField, RESOURCE_TIPS } from "../game/tooltips";
import { useT } from "./i18n/I18n";
import { SplitValue } from "./i18n/SplitValue";
import type { GameState, RaceId } from "../game/types";
import type { IconName } from "./icons";

/** The kit glyph map — the CRAFT catalog's emoji never reach the chrome (§1.7). */
const KIT_ICON: Record<CraftKind, IconName> = {
  medkit: "aegis",
  mechkit: "gear",
  armorkit: "armor",
  skmech: "person",
  gas: "fuel",
  battery: "spark",
  hazmat: "shield",
  shots: "beacon",
  alloy: "crate",
};

const KIT_TIERS: { note: string; kinds: CraftKind[] }[] = [
  { note: "Tier 0 · Step Out — gates fielding ANY exploration", kinds: ["medkit", "mechkit", "armorkit"] },
  { note: "Tier 1 · Outer & mild zones — radiation shots, skilled mechanics, fuel & battery", kinds: ["skmech", "gas", "battery", "shots"] },
  { note: "Tier 2 · Deep zones — suits let you EXPLORE, alloys let you EXTRACT", kinds: ["hazmat", "alloy"] },
];

const QTY_PRESETS = [1, 5, 10] as const;

export default function WorkshopShelf({ state, onCraft }: {
  state: GameState;
  /** Forge `count` of `kind` in one tap — the server loops and reports. */
  onCraft: (k: CraftKind, count: number) => void;
}) {
  const t = useT();
  const r = state.resources;
  const recipe = alloyRecipeRaces(state);
  return (
    <Panel testid="workshop-shelf" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-text-1">{t("cradle.workshop")}</h3>
        <span className="text-[11px] text-text-3">{t("cradle.workshopSub")}</span>
      </div>
      {/* THE KIT LIST (owner 2026-10-01: scrolls inside the box) — the header
          stays put; the tiers scroll within a phone-fitting bound so the whole
          inventory is reachable without the page growing nine rows tall. */}
      <div className="max-h-[55vh] space-y-2 overflow-y-auto overscroll-contain pe-1">
        {KIT_TIERS.map((tier, ti) => (
          <section key={ti} className="space-y-2">
            <h4 className="eyebrow">{tier.note}</h4>
            {tier.kinds.map((k) => (
              <KitRow key={k} state={state} kind={k} recipe={recipe} onCraft={onCraft} />
            ))}
          </section>
        ))}
      </div>
      {/* THE HOLDINGS (owner 2026-09-27: "we're missing an embers inventory I
          don't see how many embers I have"): the colony's OWN stock, in the same
          Panel, so the shelf reads as one inventory. `state.resources.embers`
          is the holding; lifetime loot lives in the stores band elsewhere. */}
      <Tooltip className="w-full" content={tipT(t, "resource", "embers", RESOURCE_TIPS.embers)}>
        <div className="flex min-h-tap w-full items-center gap-2 rounded-xl border border-line bg-surf-3/60 px-3 py-2">
          <Icon name="flame" size={16} className="shrink-0 text-ember-soft" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-[12px] text-text-2">{t("resource.embers")}</span>
          <b className="shrink-0 text-[12px] text-text-1">
            <Bdi dir="ltr" className="num">{Math.floor(r.embers).toLocaleString()}</Bdi>
          </b>
        </div>
      </Tooltip>
      <div className="flex min-h-tap items-center gap-2 rounded-xl border border-line bg-surf-3/60 px-3 py-2">
        <Icon name="gear" size={16} className="shrink-0 text-ember-soft" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[12px] text-text-2">{t("cradle.kitsHeld")}</span>
        <b className="shrink-0 text-[12px] text-text-1">
          <Bdi dir="ltr" className="num">{kitsHeld(state)}</Bdi>
        </b>
      </div>
      {/* the alloy row — the cross-race recipe at a glance */}
      <div className="flex min-h-tap items-center gap-2 rounded-xl border border-line bg-surf-3/60 px-3 py-2">
        <Icon name="crate" size={16} className="shrink-0 text-ember-soft" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[12px] text-text-2">
          {t("cradle.alloyLead")} <b className="text-text-1">{t("cradle.alloyBold")}</b>
          {t("cradle.alloyTail")}
        </span>
        <b className="shrink-0 text-[12px] text-text-1">
          {canForgeAlloy(state)
            ? t("cradle.alloyComplete")
            : <Bdi dir="ltr" className="num">{`${1 + recipe.filter((id) => id !== state.race).length}/5`}</Bdi>}
        </b>
      </div>
      {/* the alloy recipe strip — cross-race territory materials */}
      <section>
        <h4 className="eyebrow">Alloy recipe — 5 unique race materials</h4>
        <p className="mt-1 text-[11px] text-text-3">your own + any 4 other races.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {RACES.map((race) => {
            const count = state.resources.mats[race.id] ?? 0;
            const isOwn = state.race === race.id;
            const inRecipe = recipe.includes(race.id);
            return (
              <span
                key={race.id}
                className={`chip border ${
                  inRecipe
                    ? "border-ember/50 bg-ember/10 text-ember-soft"
                    : count > 0
                      ? "border-line-strong bg-surf-3 text-text-1"
                      : "border-line bg-surf-2 text-text-3"
                }`}
              >
                {raceText(t, race, "name", race.name).replace("The ", "")}
                {isOwn ? " (own)" : ""} <Bdi dir="ltr" className="num">&times;{count}</Bdi>
              </span>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-text-3">{tipField(t, "resource", "mats", "what", RESOURCE_TIPS.mats.what)}</p>
      </section>
    </Panel>
  );
}

/** One kit row: the value box (qty stepper) + a single Forge button.
 *  The most the row offers is what the stores can actually pay for — the
 *  server stays authoritative and reports the honest count if a batch stops
 *  early. */
function KitRow({ state, kind, recipe, onCraft }: {
  state: GameState; kind: CraftKind; recipe: string[];
  onCraft: (k: CraftKind, count: number) => void;
}) {
  const t = useT();
  const kit = CRAFT[kind];
  // Defensive: if the kit definition is missing, don't render rather than crash.
  if (!kit) return null;
  const cost = engineHelpers.craftCost(state, kind);
  const held = state.resources[CRAFT_RESOURCE_KEY[kind]] ?? 0;
  const supplies = Math.floor(state.resources.supplies);
  // The most this row can offer: what the stores can pay for (and, for alloy,
  // what the 5-race recipe can cover — one of each per kit).
  const maxBySupplies = cost > 0 ? Math.floor(supplies / cost) : 0;
  const maxByMats = kind === "alloy"
    ? Math.min(...recipe.map((rid) => state.resources.mats[rid as RaceId] ?? 0))
    : Infinity;
  const max = Math.max(0, Math.min(99, maxBySupplies, maxByMats));
  const [qty, setQty] = useState(1);
  const want = Math.max(1, Math.min(qty, Math.max(1, max)));
  const recipeOk = kind !== "alloy" || canForgeAlloy(state);
  const can = max >= 1 && recipeOk;
  const desc =
    kind === "alloy" && !recipeOk
      ? `Missing the recipe — need your own material plus ${4 - recipe.filter((rid) => rid !== state.race).length} more race materials.`
      : kit.description;
  return (
    <div className="rounded-xl border border-line bg-surf-3/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <Icon name={KIT_ICON[kind]} size={16} className="shrink-0 text-ember-soft" aria-hidden="true" />
          <span className="truncate text-[13px] font-semibold text-text-1">{kit.label}</span>
        </span>
        <span className="shrink-0 text-[11px] text-text-3">
          <Bdi dir="ltr" className="num">{held}</Bdi> {t("cradle.heldUnit")}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-tight text-text-3">{desc}</p>
      {/* the value box — pick a quantity, forge them all in one tap */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex flex-none items-center rounded-lg border border-line bg-surf-2" role="group" aria-label={t("workshop.qtyLabel", { label: kit.label })}>
          <button
            type="button"
            className="px-2.5 py-1.5 text-[13px] text-text-2 disabled:opacity-30"
            disabled={want <= 1}
            aria-label={t("workshop.qtyLess")}
            onClick={() => setQty((q) => Math.max(1, q - 1))}
          >−</button>
          <Bdi dir="ltr" className="num min-w-[2ch] text-center text-[13px] font-semibold text-text-1">{want}</Bdi>
          <button
            type="button"
            className="px-2.5 py-1.5 text-[13px] text-text-2 disabled:opacity-30"
            disabled={want >= Math.max(1, max)}
            aria-label={t("workshop.qtyMore")}
            onClick={() => setQty((q) => Math.min(Math.max(1, max), q + 1))}
          >+</button>
        </div>
        <div className="flex flex-none gap-1">
          {QTY_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              disabled={max < p}
              onClick={() => setQty(p)}
              className={`rounded-md border px-2 py-1.5 text-[11px] ${want === p ? "border-ember/60 bg-ember/10 text-ember-soft" : "border-line text-text-3 disabled:opacity-30"}`}
            >
              <Bdi dir="ltr" className="num">{p}</Bdi>
            </button>
          ))}
          <button
            type="button"
            disabled={max < 1}
            onClick={() => setQty(Math.max(1, max))}
            className={`rounded-md border px-2 py-1.5 text-[11px] ${want === Math.max(1, max) && max > 10 ? "border-ember/60 bg-ember/10 text-ember-soft" : "border-line text-text-3 disabled:opacity-30"}`}
          >
            {t("workshop.qtyMax")}
          </button>
        </div>
        <span className="ms-auto shrink-0 text-[11px] text-text-3">
          <Bdi dir="ltr" className="num">{cost * want}</Bdi> {t("resource.supplies")}
        </span>
      </div>
      <ActionButton
        className="mt-2"
        full
        size="md"
        label={want > 1 ? t("workshop.forgeN", { label: kit.label, n: want }) : t("cradle.forgeKit", { label: kit.label })}
        sub={<><Bdi dir="ltr" className="num">{cost * want}</Bdi> {t("resource.supplies")}</>}
        locked={!can}
        reason={
          kind === "alloy" && !recipeOk
            ? t("cradle.alloyLockedReason")
            : (
              <SplitValue
                k="cradle.needSupplies"
                params={{ cost, held: supplies }}
              />
            )
        }
        onClick={() => onCraft(kind, want)}
      />
    </div>
  );
}
