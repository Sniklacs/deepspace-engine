// TacticalBattleView — the live tactical battle UI (owner 2026-10-03).
//
// Hans: "I want act and react... real life combat." After touchdown and
// deployment, the battle is fought round by round: the player issues orders
// to each vector, the round resolves, and the battle continues until one
// side breaks. This is the UI for that — the battle map, order input, and
// round log.

import { useState } from "react";
import { useT } from "./i18n/I18n";
import type { RaidParty } from "../game/raids";
import type {
  OrdersMap,
  TacticalBattle,
  TacticalOrderKind,
  TacticalVectorState,
  VectorOrder,
} from "../game/war/tactical-combat";
import type { ManeuverVector } from "../game/war/war-types";
import type { TroopType } from "../game/war/troops";

const VECTORS: ManeuverVector[] = ["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"];

const VECTOR_LABELS: Record<ManeuverVector, string> = {
  MAIN: "MAIN",
  FLANK_LEFT: "FLANK L",
  FLANK_RIGHT: "FLANK R",
  REAR: "REAR",
  RESERVE: "RESERVE",
};

const ORDER_OPTIONS: { id: TacticalOrderKind; label: string; desc: string }[] = [
  { id: "advance", label: "⚔️ Advance", desc: "+30% dealt, +20% taken — push the line" },
  { id: "hold", label: "🛡️ Hold", desc: "-30% taken, -20% dealt — dig in" },
  { id: "focus", label: "🎯 Focus", desc: "+50% dealt to one target — pick your victim" },
  { id: "flank", label: "↗️ Flank", desc: "+40% dealt — needs 20% warden escort" },
  { id: "reinforce", label: "📦 Reinforce", desc: "Move troops from reserve to this vector" },
  { id: "retreat", label: "↩️ Retreat", desc: "-50% taken, -80% dealt — save the troops" },
  { id: "withdraw", label: "🏳️ Withdraw", desc: "End the battle — defender wins, no loot" },
];

function headcount(v: TacticalVectorState): number {
  return (Object.values(v.troops) as number[]).reduce((n, c) => n + (c ?? 0), 0);
}

function composition(v: TacticalVectorState): string {
  const parts = (Object.entries(v.troops) as [TroopType, number][])
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([t, n]) => `${(n ?? 0).toLocaleString()} ${t}`);
  return parts.length > 0 ? parts.join(", ") : "—";
}

function MoraleBar({ morale }: { morale: number }) {
  const color = morale > 60 ? "bg-emerald-500" : morale > 30 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className={`h-full ${color} transition-all`} style={{ width: `${Math.max(0, Math.min(100, morale))}%` }} />
    </div>
  );
}

function VectorCard({
  state,
  label,
  isAttacker,
}: {
  state: TacticalVectorState;
  label: string;
  isAttacker: boolean;
}) {
  const heads = headcount(state);
  const border = state.routed
    ? "border-red-500/50"
    : isAttacker
      ? "border-sky-400/30"
      : "border-orange-400/30";
  const bg = state.routed ? "bg-red-950/30" : isAttacker ? "bg-sky-950/20" : "bg-orange-950/20";
  return (
    <div className={`rounded-lg border ${border} ${bg} p-2`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-gray-200">{label}</span>
        {state.routed ? (
          <span className="text-[10px] font-bold text-red-400">ROUTED</span>
        ) : (
          <span className="text-[11px] font-semibold text-gray-300">{heads.toLocaleString()}</span>
        )}
      </div>
      {!state.routed && heads > 0 && (
        <>
          <div className="mt-1">
            <MoraleBar morale={state.morale} />
          </div>
          <div className="mt-1 text-[10px] leading-tight text-gray-400">{composition(state)}</div>
        </>
      )}
      {state.fortified && !state.routed && (
        <div className="mt-1 text-[10px] text-amber-300/80">🏰 Fortified</div>
      )}
    </div>
  );
}

export function TacticalBattleView({
  raid,
  onIssueOrders,
  onQuickResolve,
}: {
  raid: RaidParty;
  onIssueOrders: (raidId: string, orders: OrdersMap) => void;
  onQuickResolve: (raidId: string) => void;
}) {
  const t = useT();
  const battle = raid.tacticalBattle as TacticalBattle | null | undefined;
  const [orders, setOrders] = useState<OrdersMap>({});
  const [hint, setHint] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  if (!battle) {
    return (
      <div className="mt-3 rounded-xl border border-purple-400/30 bg-purple-950/20 p-3">
        <p className="text-[12px] text-purple-200">
          ⚔️ {t("raid.battleForming", "The battle is forming — your orders will be needed shortly.")}
        </p>
      </div>
    );
  }

  const isOver = battle.status !== "active";
  const lastLog = battle.log[battle.log.length - 1];

  const setOrder = (vector: ManeuverVector, order: VectorOrder | undefined) => {
    setOrders((prev) => {
      const next = { ...prev };
      if (!order) delete next[vector];
      else next[vector] = order;
      return next;
    });
    setHint(null);
    setConfirmWithdraw(false);
  };

  const handleIssueOrders = () => {
    // Default empty vectors to hold.
    const full: OrdersMap = {};
    for (const v of VECTORS) {
      const vec = battle.attacker.vectors[v];
      if (vec.routed || headcount(vec) === 0) continue;
      full[v] = orders[v] ?? { order: "hold" };
    }
    // Withdraw needs explicit confirmation.
    if (Object.values(full).some((o) => o?.order === "withdraw") && !confirmWithdraw) {
      setConfirmWithdraw(true);
      setHint(t("raid.withdrawConfirm", "Tap again to confirm full withdrawal — the raid ends with no loot."));
      return;
    }
    setHint(null);
    setConfirmWithdraw(false);
    onIssueOrders(raid.id, full);
    setOrders({});
  };

  const statusLabel =
    battle.status === "attacker_won"
      ? "🏆 VICTORY"
      : battle.status === "defender_won"
        ? "💀 DEFEATED"
        : battle.status === "stalemate"
          ? "⏳ STALEMATE"
          : `⚔️ ROUND ${battle.round + 1}`;

  return (
    <div className="mt-3 rounded-xl border border-purple-400/30 bg-purple-950/20 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[13px] font-bold text-purple-100">
          {t("raid.tacticalTitle", "Tactical Battle")} — {statusLabel}
        </h4>
        {battle.shipsHoldOrbit && battle.orbitalStrikesLeft > 0 && !isOver && (
          <span className="text-[11px] text-sky-300">
            🛰️ {battle.orbitalStrikesLeft} {t("raid.strikesLeft", "strikes left")}
          </span>
        )}
      </div>

      {!isOver && (
        <p className="mt-1 text-[11px] text-gray-400">
          {t("raid.tacticalIntro", "Issue orders to each vector, then resolve the round. The enemy reacts to your moves.")}
        </p>
      )}

      {/* Battle map: attacker on top, defender below */}
      <div className="mt-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-sky-300/80">
          {t("raid.yourForces", "Your forces")}
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {VECTORS.map((v) => (
            <VectorCard key={v} state={battle.attacker.vectors[v]} label={VECTOR_LABELS[v]} isAttacker />
          ))}
        </div>
      </div>
      <div className="mt-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-orange-300/80">
          {t("raid.enemyForces", "Enemy forces")}
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {VECTORS.map((v) => (
            <VectorCard key={v} state={battle.defender.vectors[v]} label={VECTOR_LABELS[v]} isAttacker={false} />
          ))}
        </div>
      </div>

      {/* Order input */}
      {!isOver && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-purple-300/80">
            {t("raid.issueOrders", "Issue orders")}
          </div>
          <div className="space-y-1.5">
            {VECTORS.map((v) => {
              const vec = battle.attacker.vectors[v];
              if (vec.routed || headcount(vec) === 0) return null;
              const current = orders[v]?.order ?? "hold";
              return (
                <div key={v} className="flex flex-col gap-1 rounded-lg bg-white/5 p-2 sm:flex-row sm:items-center">
                  <span className="w-20 shrink-0 text-[11px] font-bold text-gray-200">{VECTOR_LABELS[v]}</span>
                  <select
                    value={current}
                    onChange={(e) => {
                      const kind = e.target.value as TacticalOrderKind;
                      setOrder(v, { order: kind, target: orders[v]?.target, count: orders[v]?.count });
                    }}
                    className="flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] text-gray-200"
                  >
                    {ORDER_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id} className="bg-gray-900">
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {(current === "focus" || current === "flank") && (
                    <select
                      value={orders[v]?.target ?? ""}
                      onChange={(e) =>
                        setOrder(v, { ...(orders[v] ?? { order: current }), target: e.target.value as ManeuverVector })
                      }
                      className="rounded-lg bg-white/10 px-2 py-1.5 text-[11px] text-gray-200"
                    >
                      <option value="" className="bg-gray-900">{t("raid.autoTarget", "Auto")}</option>
                      {VECTORS.filter((tv) => tv !== "RESERVE").map((tv) => (
                        <option key={tv} value={tv} className="bg-gray-900">
                          {VECTOR_LABELS[tv]}
                        </option>
                      ))}
                    </select>
                  )}
                  {current === "reinforce" && (
                    <input
                      type="number"
                      min={1}
                      placeholder={t("raid.reinforceCount", "Troops")}
                      value={orders[v]?.count ?? ""}
                      onChange={(e) =>
                        setOrder(v, { ...(orders[v] ?? { order: current }), count: Math.max(0, parseInt(e.target.value) || 0) })
                      }
                      className="w-24 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] text-gray-200"
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Orbital strike */}
          {battle.shipsHoldOrbit && battle.orbitalStrikesLeft > 0 && (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-sky-950/30 p-2">
              <span className="text-[11px] text-sky-200">🛰️ {t("raid.orbitalStrike", "Orbital strike:")}</span>
              <select
                value={Object.values(orders).find((o) => o?.orbitalStrike)?.orbitalStrike ?? ""}
                onChange={(e) => {
                  const target = e.target.value as ManeuverVector | "";
                  // Attach the strike to MAIN's order (or create a hold order for MAIN).
                  const main = orders.MAIN ?? { order: "hold" as TacticalOrderKind };
                  if (!target) {
                    const { orbitalStrike: _drop, ...rest } = main;
                    setOrder("MAIN", Object.keys(rest).length > 1 || rest.order !== "hold" ? (rest as VectorOrder) : undefined);
                  } else {
                    setOrder("MAIN", { ...main, orbitalStrike: target });
                  }
                }}
                className="flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] text-gray-200"
              >
                <option value="" className="bg-gray-900">{t("raid.noStrike", "No strike this round")}</option>
                {VECTORS.filter((tv) => tv !== "RESERVE").map((tv) => (
                  <option key={tv} value={tv} className="bg-gray-900">
                    {VECTOR_LABELS[tv]}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-2 flex gap-2">
            <button
              onClick={handleIssueOrders}
              className="flex-1 rounded-lg bg-purple-600 px-3 py-2 text-[12px] font-bold text-white hover:bg-purple-500"
            >
              ⚔️ {t("raid.resolveRound", "Resolve Round")}
            </button>
            <button
              onClick={() => onQuickResolve(raid.id)}
              className="rounded-lg bg-white/10 px-3 py-2 text-[12px] font-semibold text-gray-300 hover:bg-white/20"
              title={t("raid.quickResolveHint", "Auto-play the rest of the battle")}
            >
              ⏩ {t("raid.quickResolve", "Quick")}
            </button>
          </div>
          {hint && (
            <p className={`mt-1.5 text-[11px] leading-relaxed ${confirmWithdraw ? "text-amber-200/90" : "text-red-200/90"}`}>
              {hint}
            </p>
          )}
        </div>
      )}

      {/* Battle result */}
      {isOver && (
        <div className="mt-2 rounded-lg bg-white/5 p-2 text-[11px] text-gray-300">
          {battle.status === "attacker_won" && (
            <span>🏆 {t("raid.battleWon", "Victory! The field is yours. Loot and exfil are being organized.")}</span>
          )}
          {battle.status === "defender_won" && (
            <span>💀 {t("raid.battleLost", "Defeated. Your survivors are falling back to the ships.")}</span>
          )}
          {battle.status === "stalemate" && (
            <span>⏳ {t("raid.battleStalemate", "Stalemate — both sides are spent. Your force withdraws.")}</span>
          )}
        </div>
      )}

      {/* Round log */}
      <button
        onClick={() => setShowLog(!showLog)}
        className="mt-2 w-full rounded-lg bg-white/5 px-2 py-1.5 text-[11px] font-semibold text-gray-300 hover:bg-white/10"
      >
        📜 {t("raid.battleLog", "Battle log")} ({battle.log.length}) {showLog ? "▲" : "▼"}
      </button>
      {showLog && (
        <div className="mt-1 max-h-48 space-y-1.5 overflow-y-auto">
          {[...battle.log].reverse().map((entry) => (
            <div key={entry.round} className="rounded-lg bg-white/5 p-2">
              <div className="text-[10px] font-bold text-purple-200">
                {t("raid.round", "Round")} {entry.round}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {entry.events.map((e, i) => (
                  <div key={i} className="text-[10px] leading-tight text-gray-400">
                    {e}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {lastLog && !isOver && (
        <div className="mt-2 rounded-lg bg-white/5 p-2">
          <div className="text-[10px] font-bold text-purple-200">
            {t("raid.lastRound", "Last round")} ({lastLog.round})
          </div>
          <div className="mt-0.5 space-y-0.5">
            {lastLog.events.slice(0, 4).map((e, i) => (
              <div key={i} className="text-[10px] leading-tight text-gray-400">
                {e}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
