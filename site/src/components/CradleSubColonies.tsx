// CradleSubColonies — the sub colony overview on the Cradle page (owner 2026-10-03).
//
// Hans: "have an overview ... basically showing that we are starting to send
// supplies and set it up and a progress bar countdown ticker whatever showing
// that we are taking over husk to yada yada yada"
//
// Plus (owner 2026-10-03): supply upkeep — every 24h each active sub colony
// demands 1,000 supplies. The overview shows "due in Xh Ym" with a Ship
// supplies button, and flags hungry colonies as NEEDS SUPPLIES.
import { useMemo } from "react";
import type { GameState } from "../game/types";
import type { GameResult } from "../game/api";
import {
  SUBCOLONY_SETUP_MS,
  SUBCOLONY_UPKEEP_PER_DAY,
  upkeepRemaining,
  isUpkeepOverdue,
  subColonyReverb,
} from "../game/subcolonies";
import { ensureWorldMap, type KnownColony } from "../game/worldmap";
import { shipSubColonySuppliesFn } from "../game/api";
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
            const troops = colony.approxTroops ?? 0;
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
