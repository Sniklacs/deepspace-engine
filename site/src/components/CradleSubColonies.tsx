// CradleSubColonies — the sub colony overview on the Cradle page (owner 2026-10-03).
//
// Hans: "have an overview ... basically showing that we are starting to send
// supplies and set it up and a progress bar countdown ticker whatever showing
// that we are taking over husk to yada yada yada"
//
// Plus (owner 2026-10-03): supply upkeep — every 24h each active sub colony
// demands 1,000 supplies. The overview shows "due in Xh Ym" with a Ship
// supplies button, and flags hungry colonies as NEEDS SUPPLIES.
import { useMemo, useState } from "react";
import type { GameState } from "../game/types";
import type { GameResult } from "../game/api";
import {
  SUBCOLONY_SETUP_MS,
  SUBCOLONY_UPKEEP_PER_DAY,
  SUBCOLONY_GARRISON_CAP,
  SUBCOLONY_MUSTER_SPEED_MULT,
  upkeepRemaining,
  isUpkeepOverdue,
  subColonyReverb,
  subColonyTroopCount,
  subColonyTroopsByType,
} from "../game/subcolonies";
import { ensureWorldMap, type KnownColony } from "../game/worldmap";
import { musterSubColonyTroopsFn, shipSubColonySuppliesFn } from "../game/api";
import { musterCost, musterDurationMs, TROOP_TYPES, type TroopType } from "../game/war/troops";
import { Panel } from "./ui/Panel";
import { ActionButton } from "./ui/ActionButton";
import { Icon } from "./icons";
import { useT } from "./i18n/I18n";
import { Bdi } from "./ui/Bdi";

type Act = (fn: () => Promise<GameResult>, label: string) => void;

function fmtLeft(ms: number): string {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

interface Mine {
  key: string;
  colony: KnownColony;
  settingUp: boolean;
}

export default function CradleSubColoniesSection({
  state,
  now,
  token,
  onAction,
}: {
  state: GameState;
  now: number;
  token?: string;
  onAction: Act;
}) {
  const t = useT();
  const me = state.gameId ?? "";

  const mine = useMemo((): Mine[] => {
    if (!me) return [];
    const wm = ensureWorldMap(state, now);
    const out: Mine[] = [];
    for (const [key, colony] of Object.entries(wm.known)) {
      const claim = colony.subClaim;
      if (!claim || claim.claimedBy !== me) continue;
      if (colony.status === "setting_up" && now < claim.setupCompleteAt) {
        out.push({ key, colony, settingUp: true });
      } else if (colony.status === "sub_colony") {
        out.push({ key, colony, settingUp: false });
      }
    }
    // Hungry first, then setting-up, then active.
    out.sort((a, b) => {
      const aHungry = !a.settingUp && isUpkeepOverdue(a.colony, now);
      const bHungry = !b.settingUp && isUpkeepOverdue(b.colony, now);
      if (aHungry !== bHungry) return aHungry ? -1 : 1;
      if (a.settingUp !== b.settingUp) return a.settingUp ? -1 : 1;
      return 0;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, now, me]);

  if (!me) return null;

  const haveSupplies = state.resources.supplies ?? 0;
  const canShip = token && haveSupplies >= SUBCOLONY_UPKEEP_PER_DAY;

  return (
    <Panel testid="cradle-subcolonies" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-text-1">
          <Icon name="building" size={15} aria-hidden="true" />
          {t("cradleSubColonies.title", "Sub colonies")}
        </h3>
        {mine.length > 0 && (
          <span className="chip border border-line text-text-2">
            <Bdi dir="ltr" className="num">{mine.length}</Bdi>
          </span>
        )}
      </div>

      {mine.length === 0 ? (
        <p className="text-[13px] text-text-2">
          {t(
            "cradleSubColonies.none",
            "Claim husks on the world map to raise sub colonies — more troops, more reverb, a cleaner map.",
          )}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {mine.map(({ key, colony, settingUp }) => {
            const claim = colony.subClaim!;
            const name = colony.ownerName || colony.id;
            if (settingUp) {
              const total = Math.max(1, SUBCOLONY_SETUP_MS);
              const elapsed = Math.min(total, Math.max(0, now - claim.claimedAt));
              const pct = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
              return (
                <li key={key} className="rounded-lg border border-line bg-surf-1 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm text-text-1">
                      {t("cradleSubColonies.takingOver", "Taking over {name}", { name })}
                    </span>
                    <span className="shrink-0 text-[11px] text-text-2">
                      <Bdi dir="ltr" className="num">{pct}%</Bdi> ·{" "}
                      {t("cradleSubColonies.readyIn", "ready in {time}", {
                        time: fmtLeft(claim.setupCompleteAt - now),
                      })}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surf-3">
                    <div className="h-full rounded-full bg-acc" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-text-3">
                    {t(
                      "cradleSubColonies.suppliesFlowing",
                      "Supplies are flowing — getting everything running.",
                    )}
                  </p>
                </li>
              );
            }
            // Active sub colony.
            const troops = subColonyTroopCount(colony);
            const overdue = isUpkeepOverdue(colony, now);
            const remaining = upkeepRemaining(colony, now);
            const reverb = subColonyReverb(troops);
            return (
              <li
                key={key}
                className={`rounded-lg border px-3 py-2 ${
                  overdue ? "border-red-500/50 bg-red-950/20" : "border-line bg-surf-1"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-text-1">{name}</span>
                  {overdue ? (
                    <span className="shrink-0 rounded bg-red-600/20 px-1.5 py-0.5 text-[11px] font-semibold text-red-300">
                      {t("cradleSubColonies.needsSupplies", "NEEDS SUPPLIES")}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-text-2">
                      {t("cradleSubColonies.troops", "{n} troops", { n: troops.toLocaleString() })}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-text-3">
                  {overdue
                    ? t(
                        "cradleSubColonies.overdue",
                        "Hungry — ship {n} supplies to keep it running.",
                        { n: SUBCOLONY_UPKEEP_PER_DAY.toLocaleString() },
                      )
                    : t(
                        "cradleSubColonies.dueIn",
                        "{n} supplies due in {time} · +{reverb} reverb",
                        {
                          n: SUBCOLONY_UPKEEP_PER_DAY.toLocaleString(),
                          time: fmtLeft(remaining),
                          reverb: reverb.toLocaleString(),
                        },
                      )}
                </p>
                <SubColonyMuster
                  colonyKey={key}
                  colony={colony}
                  now={now}
                  token={token}
                  onAction={onAction}
                  haveSupplies={haveSupplies}
                />
                <div className="mt-2">
                  <ActionButton
                    size="sm"
                    icon="send"
                    label={t("cradleSubColonies.shipSupplies", "Ship supplies")}
                    sub={
                      canShip
                        ? t("cradleSubColonies.shipSub", "Send 1,000 supplies — next due in 24h.")
                        : t(
                            "cradleSubColonies.needSupplies",
                            "Need 1,000 supplies — you have {have}.",
                            { have: Math.floor(haveSupplies).toLocaleString() },
                          )
                    }
                    onClick={() =>
                      onAction(
                        () => shipSubColonySuppliesFn({ data: { token: token!, key } }),
                        "shipSubColonySupplies",
                      )
                    }
                    testid={`subcolony-ship-${key}`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/**
 * SubColonyMuster — build troops at an active sub colony (owner 2026-10-03).
 *
 * Hans: "a sub colony ... where you can build in and build your troops."
 * Troops only, owner's research level, 2x build speed, fixed garrison cap.
 * Always tappable — tap explains what's missing (Hans's UI rule).
 */
function SubColonyMuster({
  colonyKey,
  colony,
  now,
  token,
  onAction,
  haveSupplies,
}: {
  colonyKey: string;
  colony: KnownColony;
  now: number;
  token?: string;
  onAction: Act;
  haveSupplies: number;
}) {
  const t = useT();
  const [show, setShow] = useState(false);
  const [type, setType] = useState<TroopType>("bulwark");
  const [count, setCount] = useState("100");

  const queue = colony.subMusterQueue ?? [];
  const byType = subColonyTroopsByType(colony);
  const garrison = subColonyTroopCount(colony);
  const room = SUBCOLONY_GARRISON_CAP - garrison;

  const n = Math.max(0, Math.trunc(Number(count) || 0));
  const cost = n > 0 ? musterCost(type, n) : 0;
  // 2x speed: halve the home duration.
  const durMs = n > 0 ? Math.ceil(musterDurationMs(n) / SUBCOLONY_MUSTER_SPEED_MULT) : 0;
  const typeQueued = queue.some((o) => o.type === type);
  const canMuster =
    token && n > 0 && n <= 2000 && !typeQueued && n <= room && haveSupplies >= cost;

  const reason = !token
    ? t("cradleSubColonies.signIn", "Sign in to muster troops.")
    : n <= 0
      ? t("cradleSubColonies.enterCount", "Enter how many troops to muster.")
      : typeQueued
        ? t("cradleSubColonies.typeQueued", "{type} is already mustering — one queue per type.", { type })
        : n > room
          ? t("cradleSubColonies.noRoom", "Garrison cap {cap} — room for {room} more.", {
              cap: SUBCOLONY_GARRISON_CAP.toLocaleString(),
              room: Math.max(0, room).toLocaleString(),
            })
          : haveSupplies < cost
            ? t("cradleSubColonies.needCost", "Need {cost} supplies — you have {have}.", {
                cost: cost.toLocaleString(),
                have: Math.floor(haveSupplies).toLocaleString(),
              })
            : null;

  return (
    <div className="mt-2 rounded-lg border border-line bg-surf-2/50 px-3 py-2">
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[13px] font-medium text-text-1">
          ⚔️ {t("cradleSubColonies.musterTitle", "Muster troops")} ·{" "}
          <span className="text-text-2">
            {t("cradleSubColonies.garrison", "{n}/{cap}", {
              n: garrison.toLocaleString(),
              cap: SUBCOLONY_GARRISON_CAP.toLocaleString(),
            })}
          </span>
        </span>
        <span className="text-[11px] text-text-3">{show ? "▾" : "▸"}</span>
      </button>

      {/* Garrison breakdown + queue. */}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {TROOP_TYPES.map((tp) => {
          const c = byType[tp] ?? 0;
          if (c <= 0) return null;
          return (
            <span key={tp} className="rounded bg-surf-3 px-1.5 py-0.5 text-[11px] text-text-2">
              {tp}: <Bdi dir="ltr" className="num">{c.toLocaleString()}</Bdi>
            </span>
          );
        })}
        {garrison === 0 && (
          <span className="text-[11px] text-text-3">
            {t("cradleSubColonies.emptyGarrison", "Empty garrison — muster troops to defend it.")}
          </span>
        )}
      </div>
      {queue.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {queue.map((o) => {
            const total = Math.max(1, o.completesAt - o.startedAt);
            const elapsed = Math.min(total, Math.max(0, now - o.startedAt));
            const pct = Math.round((elapsed / total) * 100);
            return (
              <li key={o.id} className="text-[11px] text-text-2">
                <div className="flex justify-between">
                  <span>
                    {o.type} × <Bdi dir="ltr" className="num">{o.count.toLocaleString()}</Bdi>
                  </span>
                  <span>{t("cradleSubColonies.readyIn", "ready in {time}", { time: fmtLeft(o.completesAt - now) })}</span>
                </div>
                <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surf-3">
                  <div className="h-full rounded-full bg-acc" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {show && (
        <div className="mt-2 space-y-2 border-t border-line pt-2">
          <p className="text-[11px] text-text-3">
            {t(
              "cradleSubColonies.musterHint",
              "Troops only — builds at your research level, twice as fast as the Cradle.",
            )}
          </p>
          <div className="flex flex-wrap gap-1">
            {TROOP_TYPES.map((tp) => (
              <button
                key={tp}
                type="button"
                onClick={() => setType(tp)}
                className={`rounded-lg border px-2 py-1 text-[12px] ${
                  type === tp
                    ? "border-acc bg-acc/15 text-text-1"
                    : "border-line bg-surf-1 text-text-2"
                }`}
              >
                {tp}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={2000}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-24 rounded-lg border border-line bg-surf-1 px-2 py-1.5 text-[13px] text-text-1"
              aria-label={t("cradleSubColonies.count", "Troop count")}
            />
            <span className="text-[11px] text-text-3">
              {n > 0 && (
                <>
                  <Bdi dir="ltr" className="num">{cost.toLocaleString()}</Bdi>{" "}
                  {t("cradleSubColonies.supplies", "supplies")} ·{" "}
                  {t("cradleSubColonies.buildTime", "{time} build", { time: fmtLeft(durMs) })}
                </>
              )}
            </span>
          </div>
          <ActionButton
            size="sm"
            icon="swords"
            label={t("cradleSubColonies.muster", "Muster {type}", { type })}
            sub={
              reason ??
              t("cradleSubColonies.musterSub", "{n} {type} — 2x speed, ready in {time}.", {
                n: n.toLocaleString(),
                type,
                time: fmtLeft(durMs),
              })
            }
            onClick={() =>
              canMuster &&
              onAction(
                () => musterSubColonyTroopsFn({ data: { token: token!, key: colonyKey, type, count: n } }),
                "musterSubColonyTroops",
              )
            }
            testid={`subcolony-muster-${colonyKey}`}
          />
        </div>
      )}
    </div>
  );
}
