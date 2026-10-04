// TROOPS TAB — the Barracks page (owner 2026-10-04: "don't be afraid to make
// pages"). A dedicated page for building troops: artwork for every troop type,
// what each troop DOES, muster queues with costs and timers, garrison counts.
//
// OWNER UI RULE: every action has a button. The Muster button is ALWAYS
// visible — when requirements aren't met it says what's missing and how to
// fix it, inline, instead of hiding.
import { useState } from "react";
import type { GameState } from "../game/types";
import {
  TROOP_TYPES,
  TROOP_JOBS,
  TROOPS_CONFIG,
  homeGarrisonCap,
  label,
  musterCost,
  musterDurationMs,
  rosterByType,
  rosterCount,
  supplyWeight,
  type TroopType,
} from "../game/war/troops";
import { cradleTier } from "../game/engine";
import PageBanner from "./PageBanner";
import { useT } from "./i18n/I18n";

function fmtLeft(ms: number): string {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** What each troop does on the battlefield — plain words, not stat soup. */
const TROOP_LORE: Record<TroopType, { tagline: string; body: string; combat: string }> = {
  bulwark: {
    tagline: "The wall",
    body: "Heavy infantry in plate and tower shields. They stand where the line would break and take the beating so nobody else has to. If you need ground held, you need Bulwarks.",
    combat: "−25% casualties on HOLD orders. The backbone of any MAIN vector.",
  },
  reaver: {
    tagline: "The shock",
    body: "Fast assault troops who hit before the enemy knows it's hit. Dual blades, no hesitation. Send them in first to crack a line open — they don't do standing around.",
    combat: "+25% power on ADVANCE orders. Breakthrough specialists.",
  },
  longeye: {
    tagline: "The eyes",
    body: "Marksmen and scouts with long rifles and longer patience. They kill from beyond reach and see the battlefield before it unfolds. A prepared Longeye line is murder.",
    combat: "+25% power on HOLD orders. Ranged denial — screen your flanks with them.",
  },
  thunder: {
    tagline: "The siege",
    body: "Heavy ordnance crews. Each Thunder eats double supplies and counts double in battle — walls, bunkers, and entrenched lines are what they're for. Nothing dug-in survives them.",
    combat: "Supply weight 2 (counts double). +50% against fortifications.",
  },
  warden: {
    tagline: "The engine",
    body: "Combat engineers and escorts. They shield the column, keep the supply lines alive, and make the dangerous maneuvers possible. No Wardens, no back door.",
    combat: "+25% on FLANK orders. REAR entry requires 20% Warden escort.",
  },
};

const TROOP_ART: Record<TroopType, string> = {
  bulwark: "/art/troops/bulwark.webp",
  reaver: "/art/troops/reaver.webp",
  longeye: "/art/troops/longeye.webp",
  thunder: "/art/troops/thunder.webp",
  warden: "/art/troops/warden.webp",
};

interface TroopsTabProps {
  state: GameState;
  now: number;
  onMuster: (type: TroopType, count: number) => void;
}

export default function TroopsTab({ state, now, onMuster }: TroopsTabProps) {
  const t = useT();
  const home = state.troops?.home ?? null;
  const roster = home?.roster ?? null;
  const queue = home?.musterQueue ?? [];
  const byType = roster ? rosterByType(roster) : null;
  const total = roster ? rosterCount(roster) : 0;
  const cap = homeGarrisonCap(cradleTier(state));
  const supplies = Math.floor(state.resources?.supplies ?? 0);
  const upkeepPerHour = (total * TROOPS_CONFIG.upkeepSuppliesPerTroopPerHour).toFixed(1);

  const [counts, setCounts] = useState<Record<TroopType, string>>({
    bulwark: "50",
    reaver: "50",
    longeye: "50",
    thunder: "25",
    warden: "25",
  });
  const [hint, setHint] = useState<Record<TroopType, string | null>>({
    bulwark: null,
    reaver: null,
    longeye: null,
    thunder: null,
    warden: null,
  });

  function tryMuster(type: TroopType) {
    const n = Math.trunc(Number(counts[type]));
    if (!(n > 0)) {
      setHint((h) => ({ ...h, [type]: t("troops.hintCount", "Enter how many to muster first.") }));
      return;
    }
    if (queue.some((o) => o.type === type)) {
      setHint((h) => ({ ...h, [type]: t("troops.hintQueue", "A {label} muster is already training — one queue per type.", { label: label(type) }) }));
      return;
    }
    const queuedCount = queue.reduce((s, o) => s + o.count, 0);
    if (total + queuedCount + n > cap) {
      setHint((h) => ({ ...h, [type]: t("troops.hintCap", "Garrison cap is {cap} — no room for {n} more. Raise your Cradle tier or spend troops.", { cap, n }) }));
      return;
    }
    const cost = musterCost(type, n);
    if (supplies < cost) {
      setHint((h) => ({ ...h, [type]: t("troops.hintSupplies", "Need {cost} supplies — you have {have}. Run explorations or claim devotion.", { cost, have: supplies }) }));
      return;
    }
    setHint((h) => ({ ...h, [type]: null }));
    onMuster(type, n);
  }

  return (
    <div className="space-y-4 pb-8" data-testid="troops-tab">
      <PageBanner
        image="/art/battles/battle-siege.webp"
        title={t("troops.title", "Barracks")}
        sub={t("troops.sub", "Raise your army. Every soldier is real — mustered, fed, and counted.")}
      />

      {/* Garrison overview */}
      <section className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 p-4" aria-label={t("troops.garrison", "Garrison")}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-amber-100">{t("troops.garrison", "Garrison")}</h2>
          <p className="text-sm text-zinc-300">
            <span className="font-bold text-white">{total}</span>
            {" / "}
            <span>{cap}</span>
            <span className="text-zinc-500"> {t("troops.troops", "troops")}</span>
          </p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-amber-500/80"
            style={{ width: `${cap > 0 ? Math.min(100, (total / cap) * 100) : 0}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-5 gap-2">
          {TROOP_TYPES.map((type) => (
            <div key={type} className="rounded-lg bg-zinc-800/60 p-2 text-center">
              <p className="text-xs text-zinc-400">{label(type)}</p>
              <p className="text-base font-bold text-white">{byType ? byType[type] : 0}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-400">
          {t("troops.upkeep", "Upkeep: {rate} supplies/hour. Troops eat — a dry stockpile starts desertions after 24h.", { rate: upkeepPerHour })}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {t("troops.supplies", "Your supplies: {n}", { n: supplies.toLocaleString() })}
        </p>
      </section>

      {/* Muster queues */}
      <section className="rounded-xl border border-zinc-700/60 bg-zinc-900/60 p-4" aria-label={t("troops.training", "Training")}>
        <h2 className="text-lg font-bold text-amber-100">{t("troops.training", "Training")}</h2>
        {queue.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">
            {t("troops.noQueues", "No musters training. Pick a troop below and muster — queues run one per type, in parallel.")}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {queue.map((o) => {
              const span = Math.max(1, o.completesAt - o.startedAt);
              const done = Math.min(1, Math.max(0, (now - o.startedAt) / span));
              return (
                <li key={o.id} className="rounded-lg bg-zinc-800/60 p-3">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-bold text-white">
                      {o.count} × {label(o.type)}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {t("troops.readyIn", "ready in {time}", { time: fmtLeft(o.completesAt - now) })}
                    </p>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-700">
                    <div className="h-full rounded-full bg-emerald-500/80" style={{ width: `${done * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Troop cards */}
      <section className="space-y-4" aria-label={t("troops.recruit", "Recruit")}>
        <h2 className="text-lg font-bold text-amber-100">{t("troops.recruit", "Recruit")}</h2>
        {TROOP_TYPES.map((type) => {
          const lore = TROOP_LORE[type];
          const weight = supplyWeight(type);
          const perTroop = musterCost(type, 1);
          const perTime = fmtLeft(musterDurationMs(1));
          const queuedForType = queue.some((o) => o.type === type);
          return (
            <article key={type} className="overflow-hidden rounded-xl border border-zinc-700/60 bg-zinc-900/60" data-testid={`troop-card-${type}`}>
              <div className="flex flex-col sm:flex-row">
                <img
                  src={TROOP_ART[type]}
                  alt={t("troops.artAlt", "{label} troop artwork", { label: label(type) })}
                  loading="lazy"
                  className="h-44 w-full object-cover object-top sm:h-auto sm:w-44 sm:shrink-0"
                />
                <div className="flex-1 p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-base font-black text-white">
                      {label(type)}{" "}
                      <span className="text-xs font-normal text-amber-300/90">· {lore.tagline}</span>
                    </h3>
                    <p className="shrink-0 text-xs text-zinc-400">
                      {t("troops.have", "have {n}", { n: byType ? byType[type] : 0 })}
                    </p>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-sky-300">{TROOP_JOBS[type]}</p>
                  <p className="mt-2 text-sm text-zinc-300">{lore.body}</p>
                  <p className="mt-1 text-xs text-emerald-300/90">⚔ {lore.combat}</p>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-zinc-800/60 p-2">
                      <dt className="text-[10px] uppercase tracking-wide text-zinc-500">{t("troops.weight", "Supply wt.")}</dt>
                      <dd className="text-sm font-bold text-white">{weight}</dd>
                    </div>
                    <div className="rounded-lg bg-zinc-800/60 p-2">
                      <dt className="text-[10px] uppercase tracking-wide text-zinc-500">{t("troops.costEach", "Cost each")}</dt>
                      <dd className="text-sm font-bold text-white">{perTroop} 📦</dd>
                    </div>
                    <div className="rounded-lg bg-zinc-800/60 p-2">
                      <dt className="text-[10px] uppercase tracking-wide text-zinc-500">{t("troops.timeEach", "Time each")}</dt>
                      <dd className="text-sm font-bold text-white">{perTime}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex items-center gap-2">
                    <label className="sr-only" htmlFor={`muster-count-${type}`}>
                      {t("troops.countLabel", "How many {label} to muster", { label: label(type) })}
                    </label>
                    <input
                      id={`muster-count-${type}`}
                      type="number"
                      min={1}
                      max={2000}
                      value={counts[type]}
                      onChange={(e) => {
                        setCounts((c) => ({ ...c, [type]: e.target.value }));
                        setHint((h) => ({ ...h, [type]: null }));
                      }}
                      className="w-24 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-2 text-sm text-white"
                      inputMode="numeric"
                    />
                    <button
                      type="button"
                      onClick={() => tryMuster(type)}
                      data-testid={`muster-${type}`}
                      className="flex-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 active:bg-amber-700"
                    >
                      {queuedForType
                        ? t("troops.mustering", "Training…")
                        : t("troops.muster", "Muster {label}", { label: label(type) })}
                    </button>
                  </div>
                  {hint[type] && (
                    <p role="status" className="mt-2 rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
                      {hint[type]}
                    </p>
                  )}
                  {!hint[type] && (
                    <p className="mt-2 text-xs text-zinc-500">
                      {t("troops.costLine", "{cost} supplies · {time} — paid up front, linear builds, no discounts.", {
                        cost: musterCost(type, Math.max(1, Math.trunc(Number(counts[type])) || 0)).toLocaleString(),
                        time: fmtLeft(musterDurationMs(Math.max(1, Math.trunc(Number(counts[type])) || 0))),
                      })}
                    </p>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
