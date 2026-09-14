// BATTLES TAB — the live battle view (battle-side-rvr-spec.md §15.4, B2
// ratified 2026-09-12). The strategic tool: every battle your colony is in,
// its committed composition (hero squad by name, weapon families/tiers, troop
// counts, FOB stage), casualties ticking per resolution interval, the shifting
// line, and the after-action report ledger that closes the loop (§15.6).
//
// READ-ONLY over the existing 4 s poll: this component renders `state.battles` /
// `state.battleReports` plus a client-side `now` clock, and derives EVERY live
// number (elapsed/ETA, chip, ticks, line) through the SAME pure functions the
// server resolves with (battle-engine battleMoment/liveCasualties/…) — so the
// ticking view is provably the server's math, no websockets, no new deps.
//
// The designer polishes the visuals later (visual-pass-1-style brief); this is
// the clean minimal shell with the design-system tokens.
import { useState } from "react";
import type { GameState } from "../game/types";
import type { Battle, BattleReport, CommittedForce } from "../game/war/war-types";
import { battleMoment, battleEndAt } from "../game/war/battle-engine";
import { familyFor } from "../game/armory";

const CHIP_META: Record<string, { label: string; cls: string }> = {
  stalemate: { label: "Stalemate", cls: "bg-sky-400/15 text-sky-200 border-sky-400/30" },
  pressing: { label: "Pressing", cls: "bg-amber-400/15 text-amber-200 border-amber-400/30" },
  "rout-risk": { label: "Rout risk", cls: "bg-red-400/15 text-red-200 border-red-400/30" },
};

/** mm:ss / h:mm:ss clock for elapsed & ETA. */
function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function weaponLabel(state: GameState, kit: { family: string; tier: number; count: number }): string {
  const fam = state.race ? familyFor(state.race, kit.family) : undefined;
  const base = fam ? fam.name : kit.family;
  return `${base} T${kit.tier} × ${kit.count}`;
}

function fobLabel(stage: number): string {
  const names = ["No FOB", "Landing Pad", "Garrison", "Foundry", "Arsenal/Citadel"];
  return names[Math.max(0, Math.min(4, stage))] ?? names[0];
}

/** One side's committed composition — the observable facts of the fight. */
function ForceBlock({ state, force, power, tag }: { state: GameState; force: CommittedForce; power: number; tag: string }) {
  const squad = force.heroSquad.length > 0 ? (
    <ul className="space-y-0.5">
      {force.heroSquad.map((h) => (
        <li key={h.id} className="text-xs text-gray-300">
          <span className="text-gray-400">{h.role} · L{h.level}</span> {h.name}
          {h.specialization ? <span className="text-purple-300"> — {h.specialization}</span> : null}
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-xs text-gray-500">No hero squad committed.</p>
  );
  const weapons = force.weapons.length > 0 ? (
    <ul className="space-y-0.5">
      {force.weapons.map((k, i) => (
        <li key={i} className="text-xs text-gray-300">{weaponLabel(state, k)}</li>
      ))}
    </ul>
  ) : (
    <p className="text-xs text-gray-500">No weapon kits fielded.</p>
  );
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className={`text-sm font-semibold ${tag === "attacker" ? "text-amber-200" : "text-cyan-200"}`}>
          {tag === "attacker" ? "⚔️ Attacker" : "🛡️ Defender"}
        </span>
        <span className="truncate text-xs text-gray-400">{force.colonyName}</span>
      </div>
      <div className="space-y-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Hero squad</p>
          {squad}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Weapons</p>
          {weapons}
        </div>
        <div className="grid grid-cols-3 gap-1 text-xs">
          <span className="text-gray-400">Troops <b className="text-gray-200">{Math.trunc(force.troops)}</b></span>
          <span className="text-gray-400">FOB <b className="text-gray-200">{fobLabel(force.fobStage)}</b></span>
          <span className="text-gray-400">Power <b className="text-gray-200">{power}</b></span>
        </div>
      </div>
    </div>
  );
}

/** The live list + detail for ongoing battles. */
function ActiveBattles({ state, now }: { state: GameState; now: number }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const active = (state.battles ?? []).filter((b) => b.status === "active").sort((a, b) => a.startedAt - b.startedAt);
  const selected = active.find((b) => b.id === selectedId) ?? active[0] ?? null;

  if (active.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/30 p-6 text-center">
        <p className="text-3xl">⚔️</p>
        <p className="mt-2 text-sm text-gray-300">No battles are running on your fronts.</p>
        <p className="mt-1 text-xs text-gray-500">
          When a march meets a defending force, the battle opens here as a real-time entity — strength in, strength out,
          casualties ticking per resolution interval, a report when it falls. This is the engine The Fall is built on.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
      <div className="space-y-2">
        {active.map((b) => {
          const m = battleMoment(b, now);
          const chip = CHIP_META[m.chip];
          return (
            <button
              key={b.id}
              onClick={() => setSelectedId(b.id)}
              aria-pressed={selected?.id === b.id}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                selected?.id === b.id ? "border-amber-400/50 bg-amber-400/5" : "border-white/10 bg-black/30 hover:bg-white/5"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-gray-100">{b.zoneName || b.zoneId}</span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${chip.cls}`}>{chip.label}</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {b.attacker.colonyName} <span className="text-gray-600">vs</span> {b.defender.colonyName}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {Math.trunc(b.attacker.troops)}/{Math.max(0, b.defender.troops)} troops · {fmtClock(m.elapsedMs)} elapsed · {fmtClock(m.remainingMs)} left
              </p>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4">
          <BattleDetail state={state} battle={selected} now={now} />
        </div>
      )}
    </div>
  );
}

/** The detail pane — composition both sides, ticking casualties, the line. */
function BattleDetail({ state, battle, now }: { state: GameState; battle: Battle; now: number }) {
  const m = battleMoment(battle, now);
  const chip = CHIP_META[m.chip];
  const end = battleEndAt(battle);
  const aCas = Math.min(m.casualties.attacker, Math.trunc(battle.attacker.troops));
  const dCas = Math.min(m.casualties.defender, Math.trunc(battle.defender.troops));
  const linePct = Math.round(m.attackerWinProb * 100);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-gray-100">{battle.zoneName || battle.zoneId}</h3>
          <p className="text-xs text-gray-500">Power {battle.forcePower.attacker} vs {battle.forcePower.defender} · gap {Math.round(m.gap * 100)}%</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${chip.cls}`}>{chip.label}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
        <span>Elapsed <b className="text-gray-200">{fmtClock(m.elapsedMs)}</b></span>
        <span>Ends in <b className="text-gray-200">{fmtClock(m.remainingMs)}</b></span>
        <span className="text-gray-400">Casualties tick per ~1 min resolution interval</span>
        <span className="text-right">Wall-clock end {new Date(end).toLocaleTimeString()}</span>
      </div>

      {/* the shifting line */}
      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-amber-200">{battle.attacker.colonyName}</span>
          <span className="text-gray-400">line — attacker {linePct}%</span>
          <span className="text-cyan-200">{battle.defender.colonyName}</span>
        </div>
        <div className="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-white/10" role="img" aria-label={`Attacker win probability ${linePct} percent`}>
          <div className="bg-amber-400/80 transition-all duration-1000" style={{ width: `${linePct}%` }} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <ForceBlock state={state} force={battle.attacker} power={battle.forcePower.attacker} tag="attacker" />
          <p className="mt-1 text-right text-xs text-gray-400">{aCas} casualties</p>
        </div>
        <div>
          <ForceBlock state={state} force={battle.defender} power={battle.forcePower.defender} tag="defender" />
          <p className="mt-1 text-right text-xs text-gray-400">{dCas} casualties</p>
        </div>
      </div>
    </>
  );
}

/** The append-only report ledger, newest first (the §7 History Book's raw
 *  material — composition, duration, casualties, result). */
function BattleLog({ reports }: { reports: BattleReport[] }) {
  if (reports.length === 0) {
    return (
      <p className="text-xs text-gray-500">
        No battles decided yet. Every resolved battle appends a report here — the History Book starts with these.
      </p>
    );
  }
  const sorted = [...reports].sort((a, b) => b.resolvedAt - a.resolvedAt);
  return (
    <ul className="space-y-2">
      {sorted.map((r) => (
        <li key={r.battleId} className="rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-100">{r.zoneName || r.zoneId}</span>
            <span className={`text-xs font-semibold ${
              r.outcome === "attacker_victory" ? "text-amber-200"
                : r.outcome === "defender_victory" ? "text-cyan-200"
                  : "text-gray-400"
            }`}>
              {r.outcome === "attacker_victory" ? `⚔️ ${r.attacker.colonyName} wins`
                : r.outcome === "defender_victory" ? `🛡️ ${r.defender.colonyName} holds`
                  : "Standoff — both sides break off"}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Fought {fmtClock(r.durationMs)} · power {r.attacker.power} vs {r.defender.power} · casualties{" "}
            {r.attacker.casualties}/{r.defender.casualties}
          </p>
          <p className="mt-1 text-[11px] text-gray-600">
            {r.attacker.heroNames.join(", ") || "no squad"} vs {r.defender.heroNames.join(", ") || "no squad"} ·{" "}
            {r.attacker.troops} vs {r.defender.troops} troops · {new Date(r.resolvedAt).toLocaleString()}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** The Battles tab root: live list + detail, then the report log below. */
export default function BattlesTab({ state, now }: { state: GameState; now: number }) {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-100">⚔️ Battles</h2>
        <p className="text-xs text-gray-500">
          Real-time battles on your fronts — live over the 4 s poll, no websockets. Watch, learn how the enemy fields,
          and rebuild your squad against what you observe.
        </p>
      </div>
      <ActiveBattles state={state} now={now} />
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-200">Battle log</h3>
        <BattleLog reports={state.battleReports ?? []} />
      </div>
    </div>
  );
}