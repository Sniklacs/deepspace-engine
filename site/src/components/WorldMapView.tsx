// WorldMapView — the world map (design/abandoned-colonies-world-map.md §2).
//
// Separate from the Circuit map (sites): the world map shows COLONIES, not
// sites. v1 is a scrollable list of colony cards — markers on a canvas come
// later. Each card: "<owner>'s Colony", status color, reverb if known.
// Tap a card → detail panel. Abandoned → the Explore Yes/No confirmation.
// Hans's rule: every button is always tappable; a tap that can't proceed
// shows the reason inline, right below the button.
import { useEffect, useMemo, useRef, useState } from "react";
import { TacticalBattleView } from "./TacticalBattleView";
import type { GameState, Zone } from "../game/types";
import {
  abandonmentIn,
  colonyKey,
  colonyMarkerName,
  isAbandoned,
  lootTotal,
  type ColonyStatus,
  type KnownColony,
  type ShipClass,
} from "../game/worldmap";
import {
  SUBCOLONY_CLAIM_COST,
  setupRemaining,
} from "../game/subcolonies";
import { WORLD_CONFIG_PUBLIC } from "../game/world-config";
import {
  RAID_MAX_MEMBERS,
  SHIP_FIREPOWER,
  SHIP_HULL,
  raidJumpCharge,
  raidLaunchBlocker,
  raidLootCapacity,
  raidTroopCapacity,
  raidTroopCount,
  type RaidParty,
} from "../game/raids";
import type { TroopType } from "../game/war/troops";
import { targetBlockReason } from "../game/raid-targeting";
import { TurretThumb } from "./TurretThumb";
import { StackedShips } from "./StackedShips";
import { useT } from "./i18n/I18n";
import { sound } from "../game/sound";
import { Bdi } from "./ui/Bdi";
import MemorialsView from "./MemorialsView";
import WorldGlobe, { type GlobeFocusTarget } from "./WorldGlobe";
import WorldIntelPanel from "./WorldIntelPanel";
import ProbeStation from "./ProbeStation";
import PlanetSheet from "./PlanetSheet";
import { planetDefById } from "../game/system-view";
import { currentHomeGlobePosition } from "../game/globe-layers";
import { memorialNodeIds } from "../game/memorials";
import { allianceOf } from "../game/war/alliances";
import { openRallies } from "../game/war/rallies";
import {
  colonyNodeId,
  coveredNodeName,
  partialShipIntel,
  satelliteIntelFor,
} from "../game/satellites";

// ---------------------------------------------------------------------------
// Pure helpers (tested in WorldMapView.test.ts)
// ---------------------------------------------------------------------------

/** Ship-class display labels for the satellite-gated incoming-raid intel. */
const RAID_SHIP_CLASS_LABEL: Record<ShipClass, string> = {
  scout: "Scout",
  frigate: "Frigate",
  bulwark: "Bulwark",
  vanguard: "Vanguard",
  fatcat: "Fat Cat",
  herald: "Herald",
};

/** Status dot color: green = active/sub_colony, amber = abandoned/setting_up, gray = husk. */
export function statusColor(status: ColonyStatus): string {
  switch (status) {
    case "active":
    case "sub_colony":
      return "#34d399"; // emerald-400
    case "abandoned":
    case "setting_up":
      return "#fbbf24"; // amber-400
    case "husk":
      return "#6b7280"; // gray-500
  }
}

/** Sort colonies: abandoned first (opportunity), then active, then husks. */
export function sortColonies(colonies: KnownColony[]): KnownColony[] {
  const rank = (s: ColonyStatus) =>
    s === "abandoned" || s === "setting_up" ? 0 : s === "active" || s === "sub_colony" ? 1 : 2;
  return [...colonies].sort((a, b) => rank(a.status) - rank(b.status) || a.ownerName.localeCompare(b.ownerName));
}

/** "Abandons in Xd Xh" — only meaningful while under the 30-day threshold. */
export function abandonCountdownText(ms: number): string {
  if (ms <= 0) return "0";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

/** Localized status label for a colony. */
export function statusLabel(t: (k: string, f: string) => string, status: ColonyStatus): string {
  switch (status) {
    case "active":
      return t("worldmap.statusActive", "Active");
    case "abandoned":
      return t("worldmap.statusAbandoned", "Abandoned");
    case "husk":
      return t("worldmap.statusHusk", "Husk");
    case "setting_up":
      return t("worldmap.statusSettingUp", "Setting up");
    case "sub_colony":
      return t("worldmap.statusSubColony", "Sub colony");
  }
}

/** Colony-list accordion state (owner 2026-10-04): single-open — tapping the
 *  open row collapses it, tapping a different row switches the open box to
 *  it. Pure — tested in WorldMapView.test.ts. */
export function toggleAccordion(openKey: string | null, tappedKey: string): string | null {
  return openKey === tappedKey ? null : tappedKey;
}

// ---------------------------------------------------------------------------
// Raid panel — form, outfit, and launch a raiding party (game/raids.ts).
// Hans's rule: every button always tappable; a tap that can't proceed shows
// the reason inline, right below the button.
// ---------------------------------------------------------------------------

/** Ready ships the player can assign: personal + alliance fleet. */
function readyShips(state: GameState): { id: string; name: string; class: ShipClass; raceId: string }[] {
  const out: { id: string; name: string; class: ShipClass; raceId: string }[] = [];
  const seen = new Set<string>();
  const psy = state.worldMap?.shipyard;
  const fallbackRace = state.race ?? "draconians";
  if (psy) {
    for (const s of psy.ships) {
      if (s.status === "ready" && !seen.has(s.id)) {
        seen.add(s.id);
        // Crash-hardening (2026-10-04): legacy rows may store `shipClass`.
        const cls = (s.class ?? (s as unknown as { shipClass?: ShipClass }).shipClass) as ShipClass;
        out.push({ id: s.id, name: s.name, class: cls, raceId: s.raceId ?? fallbackRace });
      }
    }
  }
  const alliances = (state as { alliances?: Record<string, { members?: { colonyId: string }[]; shipyard?: { ships: { id: string; name: string; class?: string; shipClass?: string; status: string; raceId?: string }[] } }> }).alliances;
  if (alliances) {
    for (const a of Object.values(alliances)) {
      for (const s of a.shipyard?.ships ?? []) {
        if (s.status === "ready" && !seen.has(s.id)) {
          seen.add(s.id);
          const cls = ((s.class ?? s.shipClass) as ShipClass);
          out.push({ id: s.id, name: s.name, class: cls, raceId: s.raceId ?? fallbackRace });
        }
      }
    }
  }
  return out;
}

/** Player's mustered troops by type (heads). */
function homeTroopsByType(state: GameState): Partial<Record<TroopType, number>> {
  const out: Partial<Record<TroopType, number>> = {};
  const cohorts = state.troops?.home.roster.cohorts ?? [];
  for (const c of cohorts) {
    out[c.type] = (out[c.type] ?? 0) + c.count;
  }
  return out;
}

function RaidPanel({
  state,
  raid,
  selectedColony,
  selectedKey,
  onFormRaid,
  onJoinRaid,
  onSetTarget,
  onClearTarget,
  onAssignShips,
  onLoadTroops,
  onLoadSupplies,
  onLaunch,
  onDeploy,
  onHireDeserters,
  onDismissDeserters,
  onTacticalRound,
  onQuickResolveTactical,
}: {
  state: GameState;
  raid: RaidParty | null;
  selectedColony: KnownColony | null;
  selectedKey: string | null;
  onFormRaid?: () => void;
  onJoinRaid?: (inviteCode: string) => void;
  onSetTarget?: (raidId: string, key: string) => void;
  onClearTarget?: (raidId: string) => void;
  onAssignShips?: (raidId: string, shipIds: string[]) => void;
  onLoadTroops?: (raidId: string, type: TroopType, count: number) => void;
  onLoadSupplies?: (raidId: string, amount: number) => void;
  onLaunch?: (raidId: string) => void;
  onDeploy?: (raidId: string, deployment: Record<string, Record<string, number>>, shipsHoldOrbit: boolean) => void;
  onHireDeserters?: (raidId: string, bandId: string) => void;
  onDismissDeserters?: (raidId: string, bandId: string) => void;
  onTacticalRound?: (raidId: string, orders: Record<string, { order: string; target?: string; count?: number; orbitalStrike?: string }>) => void;
  onQuickResolveTactical?: (raidId: string) => void;
}) {
  const t = useT();
  const [hint, setHint] = useState<string | null>(null);
  const [pickedShips, setPickedShips] = useState<string[]>([]);
  const [troopInputs, setTroopInputs] = useState<Partial<Record<TroopType, string>>>({});
  const [supplyInput, setSupplyInput] = useState<string>("");
  const [joinCode, setJoinCode] = useState("");

  const ships = useMemo(() => readyShips(state), [state]);
  const homeTroops = useMemo(() => homeTroopsByType(state), [state]);

  if (!raid) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[12px] font-semibold text-gray-200">{t("raid.title", "Raiding Party")}</h3>
          <span className="text-[10px] text-gray-500">{t("raid.partyForming", "Party forming — max 5 raiders.")}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            sound.click();
            if (onFormRaid) onFormRaid();
            else setHint("noHandler");
          }}
          className="mt-2 w-full rounded-xl border border-red-400/40 bg-red-400/15 px-3 py-2 text-sm font-semibold text-red-100 hover:bg-red-400/25"
        >
          {t("raid.formParty", "Form Raid Party")}
        </button>
        {hint === "noHandler" && (
          <p className="mt-1.5 text-[11px] text-red-200/80">
            {t("raid.noRaidYet", "No raid party yet. Form one to hit an active colony.")}
          </p>
        )}
        <p className="mt-1.5 text-[10px] leading-relaxed text-gray-500">
          {t("raid.whatYouCarry", "What you carry is all you have — no troop building on a raid.")}
        </p>
        {/* Join a raid via invite code (multiplayer, owner 2026-10-03) */}
        <div className="mt-2 border-t border-white/10 pt-2">
          <p className="text-[11px] font-semibold text-gray-300">
            {t("raid.joinTitle", "Join a raid party")}
          </p>
          <div className="mt-1 flex gap-1.5">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
              placeholder={t("raid.codePlaceholder", "Invite code")}
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 font-mono text-[13px] tracking-widest text-amber-100 placeholder:text-gray-600"
              maxLength={6}
            />
            <button
              type="button"
              onClick={() => {
                sound.click();
                if (onJoinRaid && joinCode.trim()) {
                  onJoinRaid(joinCode.trim());
                  setJoinCode("");
                } else {
                  setHint("needCode");
                }
              }}
              className="shrink-0 rounded-lg border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-[12px] font-semibold text-emerald-100 hover:bg-emerald-400/25"
            >
              {t("raid.join", "Join")}
            </button>
          </div>
          {hint === "needCode" && (
            <p className="mt-1 text-[11px] text-red-200/80">
              {t("raid.needCode", "Enter the invite code from the raid leader.")}
            </p>
          )}
        </div>
      </div>
    );
  }

  const blocker = raidLaunchBlocker(raid);
  const charge = raidJumpCharge(raid);

  return (
    <div className="rounded-xl border border-red-400/25 bg-red-950/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-red-100">
          {t("raid.title", "Raiding Party")} · {raid.id}
        </h3>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{
            background: raid.status === "preparing" ? "#fbbf24/20" : raid.status === "done" ? "#34d399/20" : "#60a5fa/20",
            color: raid.status === "preparing" ? "#fbbf24" : raid.status === "done" ? "#34d399" : "#60a5fa",
          }}
        >
          {raid.status === "preparing" ? t("raid.partyForming", "Party forming — max 5 raiders.")
            : raid.status === "in_transit" ? t("raid.inTransit", "In transit — touchdown soon.")
            : raid.status === "deploying" ? t("raid.deploying", "TOUCHDOWN — deploy your troops!")
            : raid.status === "returning" ? t("raid.returning", "Returning with the loot.")
            : raid.status === "done" ? (raid.won ? t("raid.won", "Raid succeeded — loot delivered.") : t("raid.lost", "Raid repelled — survivors came home."))
            : raid.status}
        </span>
      </div>

      {/* Members */}
      <p className="mt-1.5 text-[11px] text-gray-400">
        {t("raid.members", "Members")} ({raid.memberIds.length}/{RAID_MAX_MEMBERS}):{" "}
        <span className="text-gray-200">{raid.memberNames.join(", ")}</span>
      </p>

      {/* Invite code (multiplayer, owner 2026-10-03) */}
      {raid.status === "preparing" && raid.inviteCode && (
        <p className="mt-1 text-[11px] text-gray-400">
          {t("raid.inviteCode", "Invite code")}:{" "}
          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[12px] font-bold tracking-widest text-amber-200">
            {raid.inviteCode}
          </span>{" "}
          <span className="text-gray-500">{t("raid.shareCode", "— share with alliance to recruit.")}</span>
        </p>
      )}

      {/* Target */}
      <p className="mt-1 text-[11px] text-gray-400">
        {t("raid.target", "Target")}:{" "}
        {raid.targetColonyId ? (
          <span className="text-amber-200">{raid.targetOwnerName}'s colony <Bdi dir="ltr">({raid.targetServerId})</Bdi></span>
        ) : (
          <span className="text-gray-500">{t("raid.noTarget", "No target — pick a colony on the map.")}</span>
        )}
      </p>
      {/* Clear target (owner 2026-10-04): a set target must be clearable /
          changeable — nothing dead-ends. Clearing re-opens target picking. */}
      {raid.status === "preparing" && raid.targetColonyId && (
        <button
          type="button"
          onClick={() => {
            sound.click();
            if (!onClearTarget) {
              setHint("noHandler");
            } else {
              setHint(null);
              onClearTarget(raid.id);
            }
          }}
          className="mt-1 rounded-lg border border-line px-2 py-1 text-[11px] text-text-2 hover:bg-white/5"
        >
          ✕ {t("raid.clearTarget", "Clear target")}
        </button>
      )}
      {raid.status === "preparing" && !raid.targetColonyId && (
        <button
          type="button"
          onClick={() => {
            sound.click();
            if (!onSetTarget) {
              setHint("noHandler");
            } else {
              // Same rule as engine.setRaidTarget — never silently reject.
              const block = targetBlockReason(selectedColony, selectedKey, state.gameId ?? undefined);
              if (!block && selectedKey) {
                setHint(null);
                onSetTarget(raid.id, selectedKey);
              } else {
                setHint(block ?? "noColonySelected");
              }
            }
          }}
          className="mt-1 rounded-lg border border-amber-400/40 bg-amber-400/15 px-2 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-400/25"
        >
          🎯 {t("raid.targetThis", "Target this colony")}
        </button>
      )}
      {hint === "noColonySelected" && (
        <p className="mt-1 text-[11px] text-amber-200/80">{t("raid.noColonySelectedHint", "Tap a colony card on the map first, then tap this button to target it.")}</p>
      )}
      {hint === "notRaidable" && (
        <p className="mt-1 text-[11px] text-amber-200/80">{t("raid.notRaidableHint", `Raids hit ACTIVE colonies — this one's ${selectedColony?.status ?? "unknown"}. Glean it instead.`)}</p>
      )}
      {hint === "noHandler" && (
        <p className="mt-1 text-[11px] text-amber-200/80">{t("raid.noHandlerHint", "Targeting isn't wired up yet — try again in a moment.")}</p>
      )}

      {raid.status === "preparing" && (
        <>
          {/* Ships */}
          <div className="mt-2">
            <p className="text-[11px] font-semibold text-gray-300">
              {t("raid.ships", "Ships")} ({raid.shipIds.length} {t("raid.assigned", "assigned")})
            </p>
            {ships.length === 0 ? (
              <div className="mt-1">
                <p className="text-[11px] text-gray-500">{t("raid.noShips", "No jump ships ready. Build ships at the shipyard first.")}</p>
                <p className="mt-1 text-[11px] text-amber-200/80">
                  {t("raid.shipyardHint", "→ Cradle → Alliance → Ship Factory to build ships")}
                </p>
              </div>
            ) : (
              /* Stacked by class+race (owner 2026-10-04): one row per
                 identical hull group instead of an endless scroll of ship
                 buttons. Tap a stack to select the whole group at once;
                 expand it (▸) to pick individual ships. */
              <StackedShips
                ships={ships}
                testid="raid-ship-picker"
                renderHeaderThumb={(stack) => <TurretThumb shipClass={stack.class} size={20} />}
                stackExtra={(stack) => {
                  const picked = stack.ships.filter((s) => pickedShips.includes(s.id)).length;
                  const aboard = stack.ships.filter((s) => raid.shipIds.includes(s.id)).length;
                  return (
                    <span className="shrink-0 text-[10px] text-gray-400">
                      {picked}/{stack.ships.length} {t("raid.picked", "picked")}
                      {aboard > 0 && ` · ${aboard} ${t("raid.aboard", "aboard")}`}
                    </span>
                  );
                }}
                onStackClick={(stack) => {
                  sound.click();
                  const ids = stack.ships.map((s) => s.id);
                  const allOn = ids.every((id) => pickedShips.includes(id) || raid.shipIds.includes(id));
                  setPickedShips((prev) =>
                    allOn
                      ? prev.filter((x) => !ids.includes(x))
                      : [...prev, ...ids.filter((id) => !prev.includes(id) && !raid.shipIds.includes(id))],
                  );
                }}
                renderShip={(s) => {
                  const on = pickedShips.includes(s.id) || raid.shipIds.includes(s.id);
                  const cls = s.class;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      title={`${s.name} — ⚔ ${SHIP_FIREPOWER[cls] ?? 0} firepower · 🛡 ${SHIP_HULL[cls] ?? 0} hull`}
                      onClick={() => {
                        sound.click();
                        setPickedShips((prev) =>
                          prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                        );
                      }}
                      className={`w-full rounded-lg border px-2 py-1 text-left text-[11px] ${
                        on ? "border-amber-400/60 bg-amber-400/15 text-amber-100" : "border-white/10 bg-white/5 text-gray-300 hover:border-white/25"
                      }`}
                    >
                      <span className="flex items-center gap-1">
                        <TurretThumb shipClass={cls} size={16} />
                        {s.name}
                      </span>
                      <span className="block text-[9px] opacity-70">⚔{SHIP_FIREPOWER[cls] ?? 0} 🛡{SHIP_HULL[cls] ?? 0}</span>
                    </button>
                  );
                }}
              />
            )}
            {pickedShips.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  sound.click();
                  if (onAssignShips) {
                    onAssignShips(raid.id, pickedShips);
                    setPickedShips([]);
                    setHint(null);
                  } else setHint("noHandler");
                }}
                className="mt-1.5 rounded-lg border border-amber-400/40 bg-amber-400/15 px-2 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-400/25"
              >
                {t("raid.assignShips", "Assign Ships")} ({pickedShips.length})
              </button>
            )}
          </div>

          {/* Troops */}
          <div className="mt-2">
            <p className="text-[11px] font-semibold text-gray-300">
              {t("raid.troops", "Troops loaded")}: <span className="text-gray-200">{raidTroopCount(raid).toLocaleString()}</span>
              <span className="text-gray-500"> / {raidTroopCapacity(raid).toLocaleString()} · {t("raid.cargo", "cargo")}: {raidLootCapacity(raid).toLocaleString()}</span>
            </p>
            <div className="mt-1 space-y-1">
              {(Object.entries(homeTroops) as [TroopType, number][]).filter(([, n]) => n > 0).map(([type, have]) => (
                <div key={type} className="flex items-center gap-2 text-[11px]">
                  <span className="w-20 text-gray-300">{type} <span className="text-gray-500">({have.toLocaleString()})</span></span>
                  <input
                    type="number"
                    min={1}
                    max={have}
                    value={troopInputs[type] ?? ""}
                    onChange={(e) => setTroopInputs((prev) => ({ ...prev, [type]: e.target.value }))}
                    placeholder="0"
                    className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      sound.click();
                      const n = Math.trunc(Number(troopInputs[type] ?? 0));
                      if (!onLoadTroops) {
                        setHint("troopNoHandler");
                      } else if (n > 0) {
                        onLoadTroops(raid.id, type, n);
                        setTroopInputs((prev) => ({ ...prev, [type]: "" }));
                        setHint(null);
                      } else {
                        setHint("troopCount");
                      }
                    }}
                    className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-gray-200 hover:bg-white/10"
                  >
                    {t("raid.loadTroops", "Load Troops")}
                  </button>
                </div>
              ))}
            </div>
            {hint === "troopCount" && (
              <p className="mt-1 text-[11px] text-amber-200/80">{t("raid.troopCountHint", "Enter how many to load first.")}</p>
            )}
            {hint === "troopNoHandler" && (
              <p className="mt-1 text-[11px] text-amber-200/80">{t("raid.troopNoHandlerHint", "Troop loading isn't wired up — try again in a moment.")}</p>
            )}
            {(Object.entries(homeTroops) as [TroopType, number][]).filter(([, n]) => (n ?? 0) > 0).length === 0 && (
              <p className="mt-1 text-[11px] text-amber-200/80">{t("raid.noTroopsHint", "No troops mustered. Build troops at the Cradle first, then load them here.")}</p>
            )}
          </div>

          {/* Supplies — for deserters, emergencies, the unknown (owner 2026-10-03) */}
          <div className="mt-2">
            <p className="text-[11px] font-semibold text-gray-300">
              {t("raid.supplies", "Supplies loaded")}: <span className="text-gray-200">{(raid.supplies ?? 0).toLocaleString()}</span>
              <span className="text-gray-500"> · {t("raid.supplyHint", "for deserters & field costs")}</span>
            </p>
            <div className="mt-1 flex items-center gap-2 text-[11px]">
              <input
                type="number"
                min={1}
                value={supplyInput ?? ""}
                onChange={(e) => setSupplyInput(e.target.value)}
                placeholder="0"
                className="w-20 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white"
              />
              <button
                type="button"
                onClick={() => {
                  sound.click();
                  const n = Math.trunc(Number(supplyInput ?? 0));
                  if (!onLoadSupplies) {
                    setHint("supplyNoHandler");
                  } else if (n > 0) {
                    onLoadSupplies(raid.id, n);
                    setSupplyInput("");
                    setHint(null);
                  } else {
                    setHint("supplyCount");
                  }
                }}
                className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-gray-200 hover:bg-white/10"
              >
                {t("raid.loadSupplies", "Load Supplies")}
              </button>
            </div>
            {hint === "supplyCount" && (
              <p className="mt-1 text-[11px] text-amber-200/80">{t("raid.supplyCountHint", "Enter how many supplies to load first.")}</p>
            )}
            {hint === "supplyNoHandler" && (
              <p className="mt-1 text-[11px] text-amber-200/80">{t("raid.supplyNoHandlerHint", "Supply loading isn't wired up — try again in a moment.")}</p>
            )}
          </div>

          {/* Jump charge + launch */}
          <p className="mt-2 text-[10px] text-gray-500">
            {t("raid.jumpCharge", "Jump charge: {fuel} fuel, {supplies} supplies per ship.", { fuel: charge.fuel, supplies: charge.supplies })}
          </p>
          <button
            type="button"
            onClick={() => {
              sound.click();
              if (blocker) {
                setHint("blocker");
              } else if (onLaunch) {
                setHint(null);
                onLaunch(raid.id);
              } else {
                setHint("noHandler");
              }
            }}
            className="mt-1.5 w-full rounded-xl border border-red-400/50 bg-red-400/20 px-3 py-2 text-sm font-bold text-red-50 hover:bg-red-400/30"
          >
            🚀 {t("raid.launch", "Launch Raid")}
          </button>
          {hint === "blocker" && blocker && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-red-200/90">{blocker}</p>
          )}
        </>
      )}

      {raid.status === "deploying" && (
        <DeploymentPanel
          raid={raid}
          onDeploy={(dep, hold) => onDeploy?.(raid.id, dep, hold)}
          onHireDeserters={(bandId) => onHireDeserters?.(raid.id, bandId)}
          onDismissDeserters={(bandId) => onDismissDeserters?.(raid.id, bandId)}
        />
      )}

      {raid.status === "tactical" && (
        <TacticalBattleView
          raid={raid}
          onIssueOrders={(raidId, orders) => onTacticalRound?.(raidId, orders as Record<string, { order: string; target?: string; count?: number; orbitalStrike?: string }>)}
          onQuickResolve={(raidId) => onQuickResolveTactical?.(raidId)}
        />
      )}
    </div>
  );
}

/** Deserter encounter UI (owner 2026-10-03): a mercenary band is waiting.
 *  They name their price in supplies — unknown until this moment. */
function DeserterPanel({
  raid,
  onHireDeserters,
  onDismissDeserters,
}: {
  raid: RaidParty;
  onHireDeserters: (bandId: string) => void;
  onDismissDeserters: (bandId: string) => void;
}) {
  const t = useT();
  const [hint, setHint] = useState<string | null>(null);
  const band = raid.deserters;
  if (!band) return null;

  const total = Object.values(band.troops).reduce((a, b) => a + (b ?? 0), 0);
  const canAfford = (raid.supplies ?? 0) >= band.price;

  const composition = Object.entries(band.troops)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([type, n]) => `${(n ?? 0).toLocaleString()} ${type}`)
    .join(", ");

  return (
    <div className="mt-2 rounded-xl border border-emerald-400/40 bg-emerald-950/25 p-3">
      <h5 className="text-[12px] font-bold text-emerald-100">
        🏕️ {t("raid.deserterTitle", "Deserters in the wilds")}
      </h5>
      <p className="mt-1 text-[11px] text-gray-300">
        {t("raid.deserterIntro", "A band of deserters wants to fight with you — for a price.")}
      </p>
      <div className="mt-1.5 text-[11px] text-gray-400">
        <div>👥 <span className="text-gray-200 font-semibold">{total.toLocaleString()}</span> {t("raid.deserterHeads", "sellswords")}</div>
        <div className="mt-0.5">⚔️ {composition}</div>
        <div className="mt-0.5">💰 {t("raid.deserterPrice", "Their price")}: <span className="text-emerald-200 font-semibold">{band.price.toLocaleString()}</span> {t("raid.suppliesWord", "supplies")}</div>
        <div className="mt-0.5">📦 {t("raid.deserterCarried", "You brought")}: <span className="text-gray-200">{(raid.supplies ?? 0).toLocaleString()}</span> {t("raid.suppliesWord", "supplies")}</div>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          className="flex-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-500"
          onClick={() => {
            if (!canAfford) {
              setHint(t("raid.deserterShort", `They want ${band.price.toLocaleString()} supplies — you only brought ${(raid.supplies ?? 0).toLocaleString()}. Bring more next time.`));
              return;
            }
            setHint(null);
            onHireDeserters(band.id);
          }}
        >
          🤝 {t("raid.hire", "Hire")} ({band.price.toLocaleString()})
        </button>
        <button
          className="flex-1 rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-gray-300 hover:bg-white/20"
          onClick={() => {
            setHint(null);
            onDismissDeserters(band.id);
          }}
        >
          {t("raid.decline", "Decline")}
        </button>
      </div>
      {hint && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-red-200/90">{hint}</p>
      )}
    </div>
  );
}

/** Tactical deployment UI (owner 2026-10-03): assign troops to entry vectors after touchdown. */
function DeploymentPanel({
  raid,
  onDeploy,
  onHireDeserters,
  onDismissDeserters,
}: {
  raid: RaidParty;
  onDeploy: (deployment: Record<string, Record<string, number>>, shipsHoldOrbit: boolean) => void;
  onHireDeserters: (bandId: string) => void;
  onDismissDeserters: (bandId: string) => void;
}) {
  const t = useT();
  // deployment[vector][troopType] = count
  const [deployment, setDeployment] = useState<Record<string, Record<string, number>>>({});
  const [shipsHoldOrbit, setShipsHoldOrbit] = useState(true);
  const [hint, setHint] = useState<string | null>(null);

  // Flatten raid troops into a by-type total for the UI.
  const troopsByType = useMemo(() => {
    const out: Partial<Record<TroopType, number>> = {};
    for (const byType of Object.values(raid.troops)) {
      for (const [type, n] of Object.entries(byType) as [TroopType, number][]) {
        out[type] = (out[type] ?? 0) + (n ?? 0);
      }
    }
    return out;
  }, [raid.troops]);

  const totalDeployed = useMemo(() => {
    let total = 0;
    for (const vec of Object.values(deployment)) {
      for (const n of Object.values(vec)) total += n ?? 0;
    }
    return total;
  }, [deployment]);

  const totalCarried = useMemo(() => {
    let total = 0;
    for (const n of Object.values(troopsByType)) total += n ?? 0;
    return total;
  }, [troopsByType]);

  const VECTORS: { id: string; label: string; desc: string; bonus: string }[] = [
    { id: "MAIN", label: t("raid.vecMain", "MAIN"), desc: t("raid.vecMainDesc", "Frontal assault. No surprise bonus, but straightforward."), bonus: "×1.0" },
    { id: "FLANK_LEFT", label: t("raid.vecFlankL", "FLANK L"), desc: t("raid.vecFlankDesc", "Hidden until entry. Surprise bonus if unscreened."), bonus: "×1.25" },
    { id: "FLANK_RIGHT", label: t("raid.vecFlankR", "FLANK R"), desc: t("raid.vecFlankDesc", "Hidden until entry. Surprise bonus if unscreened."), bonus: "×1.25" },
    { id: "REAR", label: t("raid.vecRear", "REAR"), desc: t("raid.vecRearDesc", "Highest surprise. Requires 20% Warden escort."), bonus: "×1.5" },
    { id: "RESERVE", label: t("raid.vecReserve", "RESERVE"), desc: t("raid.vecReserveDesc", "Held back. Deploys in wave 2, no surprise bonus."), bonus: "×1.0" },
  ];

  const setTroop = (vector: string, type: TroopType, count: number) => {
    setDeployment((prev) => {
      const next = { ...prev };
      const vec = { ...(next[vector] ?? {}) };
      if (count <= 0) delete vec[type];
      else vec[type] = count;
      if (Object.keys(vec).length === 0) delete next[vector];
      else next[vector] = vec;
      return next;
    });
    setHint(null);
  };

  const assignAll = (vector: string) => {
    // Assign all unassigned troops to this vector.
    const assigned: Partial<Record<TroopType, number>> = {};
    for (const vec of Object.values(deployment)) {
      for (const [type, n] of Object.entries(vec) as [TroopType, number][]) {
        assigned[type] = (assigned[type] ?? 0) + (n ?? 0);
      }
    }
    const next: Record<string, Record<string, number>> = { ...deployment };
    const vec: Record<string, number> = { ...(next[vector] ?? {}) };
    for (const [type, have] of Object.entries(troopsByType) as [TroopType, number][]) {
      const already = assigned[type] ?? 0;
      const remaining = (have ?? 0) - already;
      if (remaining > 0) vec[type] = (vec[type] ?? 0) + remaining;
    }
    next[vector] = vec;
    setDeployment(next);
    setHint(null);
  };

  return (
    <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-950/20 p-3">
      <h4 className="text-[12px] font-bold text-amber-100">
        🛬 {t("raid.deployTitle", "Touchdown — deploy your troops")}
      </h4>
      <p className="mt-1 text-[11px] text-gray-400">
        {t("raid.deployIntro", "Assign your troops to entry vectors. Ships hold in orbit by default.")}
        {" "}{totalDeployed.toLocaleString()} / {totalCarried.toLocaleString()} {t("raid.assigned", "assigned")}
      </p>

      {/* Deserter encounter (owner 2026-10-03): a band is waiting. */}
      {raid.deserters && !raid.deserters.resolved && (
        <DeserterPanel
          raid={raid}
          onHireDeserters={onHireDeserters}
          onDismissDeserters={onDismissDeserters}
        />
      )}

      {VECTORS.map((v) => {
        const vecTroops = deployment[v.id] ?? {};
        const vecTotal = Object.values(vecTroops).reduce((a, b) => a + (b ?? 0), 0);
        return (
          <div key={v.id} className="mt-2 rounded-lg border border-white/10 bg-black/30 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-gray-200">
                {v.label} <span className="text-amber-300">{v.bonus}</span>
                {vecTotal > 0 && <span className="ml-1 text-gray-400">({vecTotal.toLocaleString()})</span>}
              </span>
              <button
                type="button"
                onClick={() => { sound.click(); assignAll(v.id); }}
                className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-300 hover:bg-white/10"
              >
                {t("raid.assignAll", "All")}
              </button>
            </div>
            <p className="mt-0.5 text-[10px] text-gray-500">{v.desc}</p>
            <div className="mt-1.5 space-y-1">
              {(Object.entries(troopsByType) as [TroopType, number][]).filter(([, n]) => (n ?? 0) > 0).map(([type, have]) => {
                const val = vecTroops[type] ?? 0;
                return (
                  <div key={type} className="flex items-center gap-2 text-[11px]">
                    <span className="w-20 truncate text-gray-300">{type}</span>
                    <input
                      type="number"
                      min={0}
                      max={have}
                      value={val === 0 ? "" : val}
                      placeholder="0"
                      onChange={(e) => {
                        const n = Math.max(0, Math.min(have ?? 0, parseInt(e.target.value) || 0));
                        setTroop(v.id, type, n);
                      }}
                      className="w-20 rounded border border-white/10 bg-black/50 px-1.5 py-0.5 text-[11px] text-white"
                    />
                    <span className="text-gray-500">/ {(have ?? 0).toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Ship holding pattern */}
      <div className="mt-2 rounded-lg border border-white/10 bg-black/30 p-2">
        <p className="text-[11px] font-semibold text-gray-200">{t("raid.shipsTitle", "Ships")}</p>
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={() => { sound.click(); setShipsHoldOrbit(true); }}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${
              shipsHoldOrbit ? "border-amber-400/60 bg-amber-400/15 text-amber-100" : "border-white/10 bg-white/5 text-gray-400"
            }`}
          >
            🛰️ {t("raid.holdOrbit", "Hold in orbit")}
            <span className="block text-[10px] font-normal opacity-70">{t("raid.holdOrbitDesc", "Safe from ground fire. Fast extract.")}</span>
          </button>
          <button
            type="button"
            onClick={() => { sound.click(); setShipsHoldOrbit(false); }}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${
              !shipsHoldOrbit ? "border-amber-400/60 bg-amber-400/15 text-amber-100" : "border-white/10 bg-white/5 text-gray-400"
            }`}
          >
            🛬 {t("raid.landShips", "Land with troops")}
            <span className="block text-[10px] font-normal opacity-70">{t("raid.landShipsDesc", "+10% fire support. Risk ground fire.")}</span>
          </button>
        </div>
      </div>

      {/* Deploy button — always tappable per Hans's UI rule */}
      <button
        type="button"
        onClick={() => {
          sound.click();
          if (totalDeployed === 0) {
            setHint("empty");
            return;
          }
          setHint(null);
          onDeploy(deployment, shipsHoldOrbit);
        }}
        className="mt-2 w-full rounded-xl border border-red-400/50 bg-red-400/20 px-3 py-2 text-sm font-bold text-red-50 hover:bg-red-400/30"
      >
        ⚔️ {t("raid.deploy", "Deploy — Attack!")}
      </button>
      {hint === "empty" && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200">
          {t("raid.deployEmpty", "Assign at least one troop group to a vector first.")}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colony card (the "marker")
// ---------------------------------------------------------------------------

function ColonyCard({
  colony,
  expanded,
  onSelect,
  hasMemorial,
}: {
  colony: KnownColony;
  /** The row's action box is open directly beneath it. */
  expanded: boolean;
  onSelect: () => void;
  /** A battle plaque stands at this site (owner 2026-09-30). */
  hasMemorial?: boolean;
}) {
  const t = useT();
  const color = statusColor(colony.status);
  return (
    <button
      type="button"
      onClick={() => {
        sound.click();
        onSelect();
      }}
      aria-expanded={expanded}
      className={`w-full rounded-xl border p-3 text-start transition-colors ${
        expanded ? "border-amber-400/60 bg-amber-400/10" : "border-white/10 bg-black/30 hover:border-white/25"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: color }}
          />
          <span className="truncate text-sm font-semibold text-white">
            {colonyMarkerName(colony.ownerName)}
          </span>
          {hasMemorial && (
            <span title={t("worldmap.memorialSite", "A battle plaque stands here")} aria-label={t("worldmap.memorialSite", "A battle plaque stands here")}>
              🕯️
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide" style={{ color }}>
            {statusLabel(t, colony.status)}
          </span>
          <span aria-hidden="true" className="text-[10px] text-gray-500">
            {expanded ? "▾" : "▸"}
          </span>
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
        <span>
          {t("worldmap.server", "Server")}: <Bdi dir="ltr">{colony.serverId}</Bdi>
        </span>
        {colony.reverb != null && (
          <span>
            {t("worldmap.reverb", "Reverb")}: <b className="text-amber-200">{colony.reverb.toLocaleString()}</b>
          </span>
        )}
        {colony.approxTroops != null && (
          <span>
            {t("worldmap.troops", "Troops")}: <b className="text-gray-200">~{colony.approxTroops.toLocaleString()}</b>
          </span>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// WS5 — the raided site as a tappable element (owner 2026-10-04): tapping it
// snaps the globe to the site. Phone-first: real <button>, padded, underlined
// so it reads as tappable at 360px.
// ---------------------------------------------------------------------------

function SnapToSiteButton({ nodeName, onSnap }: { nodeName: string; onSnap: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onSnap}
      aria-label={t("raid.snapToSite", "Snap the globe to {node}", { node: nodeName })}
      className="rounded px-1.5 py-1 text-amber-200 underline decoration-amber-200/40 underline-offset-2 hover:bg-amber-400/10"
    >
      🎯 {nodeName}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function ColonyDetail({
  colony,
  colonyKeyStr,
  now,
  state,
  onClose,
  onExplore,
  onRaid,
  onClaimHusk,
}: {
  colony: KnownColony;
  colonyKeyStr: string;
  now: number;
  state: GameState;
  onClose: () => void;
  onExplore: (colony: KnownColony) => void;
  onRaid?: (colony: KnownColony, key: string) => void;
  onClaimHusk?: (colony: KnownColony, key: string) => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [claimConfirming, setClaimConfirming] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [raidHint, setRaidHint] = useState<string | null>(null);
  const [claimHint, setClaimHint] = useState<string | null>(null);
  const color = statusColor(colony.status);
  const loot = colony.lootObserved;
  const lootLeft = loot ? lootTotal(loot) : 0;
  const hasMercs = colony.mercenaries != null && colony.mercenaries !== undefined;
  const explorable = colony.status !== "active";
  const me = state.gameId ?? "";

  return (
    <div className="rounded-2xl border border-white/10 bg-black/50 p-4" role="dialog" aria-label={colonyMarkerName(colony.ownerName)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-white">
            <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: color }} />
            {colonyMarkerName(colony.ownerName)}
          </h3>
          <p className="mt-0.5 text-[11px] text-gray-400">
            {t("worldmap.server", "Server")}: <Bdi dir="ltr">{colony.serverId}</Bdi>
            {" · "}
            {statusLabel(t, colony.status)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            sound.click();
            onClose();
          }}
          aria-label={t("worldmap.close", "Close")}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-gray-300 hover:bg-white/10"
        >
          ✕
        </button>
      </div>

      {/* Intel lines */}
      <div className="mt-3 space-y-1 text-[12px] leading-relaxed text-gray-300">
        {(() => {
          const ageMs = Math.max(0, now - colony.lastScouted);
          const age = ageMs <= 0 ? t("worldmap.justNow", "just now") : abandonCountdownText(ageMs);
          return (
            <p className="text-[11px] text-gray-500">
              {t("worldmap.intelAge", "Intel gathered {age} ago — it stales.", { age })}
            </p>
          );
        })()}
        {colony.reverb != null && (
          <p>
            {t("worldmap.reverbLine", "Reverb: {n} — overall strength signature. It tells you how much, not what.", { n: colony.reverb.toLocaleString() })}
          </p>
        )}
        {colony.approxTroops != null && (
          <p>
            {t("worldmap.troopsLine", "Approximate troops on the ground: ~{n}.", { n: colony.approxTroops.toLocaleString() })}
          </p>
        )}
        {colony.status === "abandoned" && (
          <>
            {lootLeft > 0 ? (
              <p className="text-amber-200/90">
                {t("worldmap.lootHint", "Scouts report supplies and materials remain — but intel goes stale. No guarantees until boots are on the ground.")}
              </p>
            ) : (
              <p className="text-gray-400">
                {t("worldmap.lootEmpty", "No loot observed. Either it was already gleaned, or the scouts saw nothing worth taking.")}
              </p>
            )}
            {hasMercs && (
              <p className="text-cyan-200/90">
                {t("worldmap.mercHint", "A mercenary band is camped here — the colony's old troops, hireable by anyone with supplies.")}
              </p>
            )}
          </>
        )}
        {colony.status === "husk" && (
          <p className="text-gray-400">
            {t("worldmap.huskHint", "A husk — picked clean. Nothing left to glean. It stays on the map until its owner returns or the season wipes it.")}
          </p>
        )}
        {colony.status === "active" && (
          <p className="text-gray-400">
            {t("worldmap.activeHint", "An active colony. No gleaning here — raiding an active colony is a separate operation, and its defenders will be warned.")}
          </p>
        )}
        {colony.status === "setting_up" && colony.subClaim && (
          <p className="text-amber-200/90">
            {t(
              "worldmap.settingUpHint",
              "Being supplied by {name} — sub colony coming online.",
              { name: colony.subClaim.claimedByName },
            )}
          </p>
        )}
        {colony.status === "sub_colony" && (
          <p className="text-emerald-200/90">
            {t("worldmap.subColonyHint", "Your sub colony — build troops here. It fights at your research level and feeds your reverb.")}
          </p>
        )}
      </div>

      {/* Claim — husks only. Always tappable; tap explains (Hans's rule). */}
      {colony.status === "husk" && (
        <div className="mt-3">
          {!claimConfirming ? (
            <>
              <button
                type="button"
                onClick={() => {
                  sound.click();
                  if (!onClaimHusk) {
                    setClaimHint("noHandler");
                  } else if (colony.serverId !== WORLD_CONFIG_PUBLIC.worldId) {
                    setClaimHint("offworld");
                  } else if (colony.subClaim) {
                    setClaimHint("claimed");
                  } else if ((state.resources.supplies ?? 0) < SUBCOLONY_CLAIM_COST) {
                    setClaimHint("poor");
                  } else {
                    setClaimHint(null);
                    setClaimConfirming(true);
                  }
                }}
                className="w-full rounded-xl border border-cyan-400/40 bg-cyan-400/15 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-400/25"
              >
                🏚️ {t("worldmap.claimHusk", "Claim as sub colony")}
              </button>
              {claimHint === "offworld" && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200/80">
                  {t(
                    "worldmap.claimOffworld",
                    "Sub colonies are planet-locked — you can only claim husks on your own world.",
                  )}
                </p>
              )}
              {claimHint === "claimed" && colony.subClaim && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200/80">
                  {t(
                    "worldmap.alreadySupplied",
                    "This colony is already being supplied by {name}.",
                    { name: colony.subClaim.claimedByName },
                  )}
                </p>
              )}
              {claimHint === "poor" && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200/80">
                  {t(
                    "worldmap.claimPoor",
                    "Need {cost} supplies to kickstart a sub colony — you have {have}.",
                    {
                      cost: SUBCOLONY_CLAIM_COST.toLocaleString(),
                      have: (state.resources.supplies ?? 0).toLocaleString(),
                    },
                  )}
                </p>
              )}
              {claimHint === "noHandler" && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
                  {t("worldmap.claimSoon", "Sub colony claiming isn't wired up yet — the husk stays on your map.")}
                </p>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-3">
              <p className="text-[13px] leading-relaxed text-cyan-100">
                {t(
                  "worldmap.claimPrompt",
                  "Supply this husk and make it your sub colony? Costs {cost} supplies, 24h setup. First come, first serve.",
                  { cost: SUBCOLONY_CLAIM_COST.toLocaleString() },
                )}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    sound.click();
                    setClaimConfirming(false);
                    if (onClaimHusk) onClaimHusk(colony, colonyKeyStr);
                  }}
                  className="flex-1 rounded-lg border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/25"
                >
                  {t("worldmap.yes", "Yes")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    sound.click();
                    setClaimConfirming(false);
                  }}
                  className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10"
                >
                  {t("worldmap.no", "No")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Setting up — show progress. */}
      {colony.status === "setting_up" && colony.subClaim && (
        <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
          <p className="text-[13px] text-amber-100">
            {colony.subClaim.claimedBy === me
              ? t(
                  "worldmap.settingUpYours",
                  "Setting up your sub colony — ready in {time}.",
                  { time: abandonCountdownText(setupRemaining(colony, now)) },
                )
              : t(
                  "worldmap.settingUpTheirs",
                  "Being supplied by {name} — ready in {time}.",
                  {
                    name: colony.subClaim.claimedByName,
                    time: abandonCountdownText(setupRemaining(colony, now)),
                  },
                )}
          </p>
        </div>
      )}

      {/* Raid — active colonies and rival sub colonies. Always tappable; tap explains.
          SUB COLONY (owner 2026-10-03): rivals can raid your sub colony — a
          decisive win SEIZES it. Your own sub colony can't be raided by you. */}
      {(colony.status === "active" ||
        (colony.status === "sub_colony" && colony.subClaim?.claimedBy !== (state.gameId ?? ""))) && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => {
              sound.click();
              if (onRaid) {
                setRaidHint(null);
                onRaid(colony, colonyKeyStr);
              } else {
                setRaidHint("noHandler");
              }
            }}
            className="w-full rounded-xl border border-red-400/40 bg-red-400/15 px-3 py-2 text-sm font-semibold text-red-100 hover:bg-red-400/25"
          >
            ⚔️ {t("raid.raid", "Raid")}
          </button>
          {raidHint === "noHandler" && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-red-200/80">
              {t("raid.noRaidYet", "No raid party yet. Form one to hit an active colony.")}
            </p>
          )}
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
            {colony.status === "sub_colony"
              ? t("raid.subColonySeize", "A decisive win SEIZES this sub colony — you take it, garrison and all is lost to them.")
              : t("raid.defenderWarned", "Loot-only v1. The defender is warned the moment you touch down.")}
          </p>
        </div>
      )}

      {/* Explore — abandoned & husk only. Always tappable; tap explains. */}
      {explorable && !confirming && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => {
              sound.click();
              if (colony.status === "husk") {
                setHint("husk");
              } else {
                setHint(null);
                setConfirming(true);
              }
            }}
            className="w-full rounded-xl border border-amber-400/40 bg-amber-400/15 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-400/25"
          >
            {t("worldmap.explore", "Explore")}
          </button>
          {hint === "husk" && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200/80">
              {t("worldmap.huskExploreHint", "Nothing to explore — this colony is a husk. No loot, no mercenaries. Check back after its owner returns.")}
            </p>
          )}
        </div>
      )}

      {/* The abandoned-colony prompt, inline (owner: no popups). */}
      {explorable && confirming && colony.status === "abandoned" && (
        <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
          <p className="text-[13px] leading-relaxed text-amber-100">
            {t("worldmap.abandonedPrompt", "This seems to be an abandoned colony. Do you want to explore further?")}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                sound.click();
                setConfirming(false);
                onExplore(colony);
              }}
              className="flex-1 rounded-lg border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/25"
            >
              {t("worldmap.yes", "Yes")}
            </button>
            <button
              type="button"
              onClick={() => {
                sound.click();
                setConfirming(false);
              }}
              className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-semibold text-gray-200 hover:bg-white/10"
            >
              {t("worldmap.no", "No")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The world map view
// ---------------------------------------------------------------------------

export default function WorldMapView({
  state,
  now,
  onExplore,
  onClaimHusk,
  onFormRaid,
  onSetRaidTarget,
  onClearRaidTarget,
  onAssignRaidShips,
  onLoadRaidTroops,
  onLoadRaidSupplies,
  onLaunchRaid,
  onJoinRaid,
  onDeployRaid,
  onHireDeserters,
  onDismissDeserters,
  onTacticalRound,
  onQuickResolveTactical,
  onEpitaph,
  onRespondToRaid,
  onOpenWarBand,
  onEnterArena,
  onEnterBeachhead,
  onExploreSite,
  onRelocateColony,
  onBuildProbe,
  onLaunchProbe,
  onCollectProbe,
}: {
  state: GameState;
  now: number;
  /** Scout probes (Hans, Oct 6 2026): the World page is the probe home —
   *  build/collect here via ProbeStation, launch from the solar-system
   *  planet sheets. Same server fns as the Lab card (one probe economy). */
  onBuildProbe?: () => void;
  onLaunchProbe?: (serverId: string) => void;
  onCollectProbe?: (probeId: string) => void;
  /** Hive relocation (owner 2026-10-04, WS-E): confirm a picked hive point.
   *  Resolves with an inline error message, or null on success (Hans's UI
   *  rule). Unwired = the globe says the linking pass lands next. */
  onRelocateColony?: (lat: number, lon: number) => Promise<string | null>;
  /** Called when the player confirms exploring an abandoned colony. v1: the
   *  parent may not wire gleaning yet — then the detail shows a "soon" note. */
  onExplore?: (colony: KnownColony) => void;
  /** Called when the player confirms claiming a husk as a sub colony. */
  onClaimHusk?: (colony: KnownColony, key: string) => void;
  /** Raid wiring (optional — unwired buttons explain inline per Hans's rule). */
  onFormRaid?: () => void;
  onSetRaidTarget?: (raidId: string, key: string) => void;
  onClearRaidTarget?: (raidId: string) => void;
  onAssignRaidShips?: (raidId: string, shipIds: string[]) => void;
  onLoadRaidTroops?: (raidId: string, type: TroopType, count: number) => void;
  onLoadRaidSupplies?: (raidId: string, amount: number) => void;
  onLaunchRaid?: (raidId: string) => void;
  onJoinRaid?: (inviteCode: string) => void;
  onDeployRaid?: (raidId: string, deployment: Record<string, Record<string, number>>, shipsHoldOrbit: boolean) => void;
  onHireDeserters?: (raidId: string, bandId: string) => void;
  onDismissDeserters?: (raidId: string, bandId: string) => void;
  onTacticalRound?: (raidId: string, orders: Record<string, { order: string; target?: string; count?: number; orbitalStrike?: string }>) => void;
  onQuickResolveTactical?: (raidId: string) => void;
  /** Victor carves an epitaph on a memorial plaque (owner 2026-09-30). */
  onEpitaph?: (plaqueId: string, epitaph: string) => void;
  /** Rally the defense against an incoming raid (owner 2026-10-04). Resolves
   *  with an inline error when the rally can't be called; null on success.
   *  Unwired buttons explain inline per Hans's rule. */
  onRespondToRaid?: (raid: { raidId: string; nodeName: string; landsAt: number }) => Promise<string | null>;
  /** Jump to the war band (Battles tab) — used when a defense rally already
   *  exists for the raid. */
  onOpenWarBand?: () => void;
  /** Globe sheet actions (owner 2026-10-13): ENTER ARENA on the globe's
   *  arena sheet leaves for the Arena tab (practice, duels, ladder). */
  onEnterArena?: () => void;
  /** Globe sheet actions (Slice 1): ENTER BEACHHEAD on the globe's
   *  beachhead sheet leaves for the full-screen Beachhead page. */
  onEnterBeachhead?: () => void;
  /** Globe sheet actions: a world site's Explore goes to the Expeditions
   *  tab, where zone launches actually live. */
  onExploreSite?: (zone: Zone, tier: 1 | 2 | 3) => void;
}) {
  const t = useT();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [exploreNote, setExploreNote] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // WS5 (owner 2026-10-04): snap-to-site — tapping an incoming raid's
  // location eases the globe to the raided site.
  const [globeFocus, setGlobeFocus] = useState<GlobeFocusTarget | null>(null);
  const raidEntryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // SOLAR SYSTEM (Hans, Oct 6 2026): the selected planet's sheet + the
  // "Enter home world" zoom-back signal for the globe.
  const [selectedPlanetId, setSelectedPlanetId] = useState<string | null>(null);
  const [enterHomeNonce, setEnterHomeNonce] = useState(0);
  const selectedPlanet = selectedPlanetId
    ? planetDefById(selectedPlanetId, WORLD_CONFIG_PUBLIC.worldId)
    : undefined;
  // THE WORLD STAGE (owner 2026-10-14): the globe IS the landing now —
  // full-screen, edge to edge. Every panel that used to stack UNDER the
  // globe in one long scroll column (probe station, intel, raids, the
  // colony list…) lives behind the desk door on the stage and opens as
  // its own surface; nothing is deleted, it is one tap away in the scene.
  const [deskOpen, setDeskOpen] = useState(false);
  // A globe action that names a panel entry (Raid on a marker, Rally on
  // an incoming raid) opens the desk already aimed at that entry.
  const [deskFocus, setDeskFocus] = useState<
    { kind: "raid"; id: string } | { kind: "colony"; key: string } | null
  >(null);
  const colonyEntryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // EXIT LAW: the desk always has a way back — its back button, and
  // Escape on keyboards.
  useEffect(() => {
    if (!deskOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDeskOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deskOpen]);

  // Once the desk is open, bring the focused entry into view.
  useEffect(() => {
    if (!deskOpen || !deskFocus) return;
    const id = window.setTimeout(() => {
      const el = deskFocus.kind === "raid"
        ? raidEntryRefs.current[deskFocus.id]
        : colonyEntryRefs.current[deskFocus.key];
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setDeskFocus(null);
    }, 60);
    return () => window.clearTimeout(id);
  }, [deskOpen, deskFocus]);

  // Pending raid target: when the user taps "Raid" with no party yet, we form
  // the party and remember the colony — once the party appears (server round-trip),
  // we auto-set it as the target so the user doesn't have to tap twice.
  const [pendingRaidTarget, setPendingRaidTarget] = useState<string | null>(null);
  const wm = state.worldMap;

  const colonies = useMemo(() => {
    if (!wm) return [];
    const all = sortColonies(Object.values(wm.known));
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) => (c.ownerName ?? "").toLowerCase().includes(q));
  }, [wm, searchQuery]);

  const selected = selectedKey ? (wm?.known[selectedKey] ?? null) : null;

  // Active raid (the one the panel manages): newest non-done, else newest.
  const activeRaid = useMemo(() => {
    const raids = wm?.raids ?? [];
    return raids.find((r) => r.status !== "done") ?? raids[raids.length - 1] ?? null;
  }, [wm]);

  // Unseen defender warnings.
  const warnings = useMemo(() => (wm?.raidWarnings ?? []).filter((w) => !w.seen), [wm]);

  // Incoming cross-server raids (defender side, owner 2026-10-03).
  const incomingRaids = useMemo(
    () => (wm?.incomingRaids ?? []).filter((r) => !r.resolved),
    [wm],
  );

  // Satellite-gated raid intel (owner 2026-10-03/04): blind (stage 0) = no
  // evidence of the raid anywhere — the panel below does not render at all.
  // Stage 1 = unidentified signature + node only; stage 2 = + attacker
  // identity/world + partial ship classes; stage 3 = full identity + ship
  // composition/count + troop count. Matches the klaxon alarm's gating.
  const raidIntel = useMemo(() => satelliteIntelFor(state, colonyNodeId(state)), [state]);
  const raidNodeName = useMemo(() => coveredNodeName(colonyNodeId(state)), [state]);

  // WS5 (owner 2026-10-04): incoming raids are always inbound to the player's
  // own colony — the raided site's globe position is the home marker's own.
  // Hive-aware (WS-E): follows the relocation override when set.
  const homeGlobePos = useMemo(() => currentHomeGlobePosition(state), [state]);

  /** Tap a raid's location → the globe snaps to the raided site, and the
   *  raid's entry (with its defense/rally buttons) scrolls into view. */
  const snapToRaidSite = (raidId: string) => {
    sound.click();
    setGlobeFocus({ lat: homeGlobePos.lat, lon: homeGlobePos.lon, nonce: Date.now() });
    raidEntryRefs.current[raidId]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  // RESPOND (owner 2026-10-04): which incoming raids already have a defense
  // rally mustering — one defense rally per raid (same dedupe key the klaxon
  // overlay uses). Those show "rally active" instead of a second button.
  const myAllianceId = useMemo(
    () => allianceOf(state, state.gameId ?? "")?.id ?? null,
    [state],
  );
  const defenseRallyRaidIds = useMemo(() => {
    if (!myAllianceId) return new Set<string>();
    return new Set(
      openRallies(state, myAllianceId)
        .filter((r) => r.target.kind === "defense-point" && r.target.zoneId)
        .map((r) => r.target.zoneId as string),
    );
  }, [state, myAllianceId]);
  const [raidResponding, setRaidResponding] = useState<Record<string, boolean>>({});
  const [raidRespondError, setRaidRespondError] = useState<Record<string, string>>({});

  // The player's own colony: "abandons in Xd" warning lives here too.
  const ownLastActive = wm?.lastActive ?? now;
  const ownAbandoned = isAbandoned(ownLastActive, now);
  const ownCountdown = abandonmentIn(ownLastActive, now);

  // Memorial sites (owner 2026-09-30): subtle 🕯️ markers on colony cards
  // whose node earned a battle plaque.
  const memorialSites = useMemo(
    () => memorialNodeIds((state as any).memorials ?? []),
    [state],
  );

  const handleExplore = (colony: KnownColony) => {
    if (onExplore) {
      onExplore(colony);
    } else {
      setExploreNote(colonyKey(colony.serverId, colony.id));
    }
  };

  /** Raid button on an active colony: form a party if none, then target it. */
  const handleRaid = (_colony: KnownColony, key: string) => {
    const preparing = wm?.raids.find((r) => r.status === "preparing");
    if (preparing) {
      if (onSetRaidTarget) onSetRaidTarget(preparing.id, key);
    } else if (onFormRaid) {
      onFormRaid();
      // Remember the target — once the party appears (server round-trip),
      // the effect below auto-sets it. No second tap needed.
      setPendingRaidTarget(key);
    }
  };

  // Auto-apply pending raid target once the new party appears.
  useEffect(() => {
    if (!pendingRaidTarget) return;
    const preparing = wm?.raids.find((r) => r.status === "preparing" && !r.targetColonyId);
    if (preparing && onSetRaidTarget) {
      onSetRaidTarget(preparing.id, pendingRaidTarget);
      setPendingRaidTarget(null);
    }
  }, [wm?.raids, pendingRaidTarget, onSetRaidTarget]);

  return (
    <div>
      {/* THE WORLD STAGE (owner 2026-10-14 — "take the whole 'the world'
          section away… make it full screen"): the globe fills the whole
          stage between the ribbon and the nav — no banner band above it,
          no scroll column under it. The world's name lives ON the scene
          as an overlay; alerts ride as pills; and every panel that used
          to stack below opens behind the desk door as its own surface
          (the Cradle pattern: the scene is a place, business waits
          behind a door). Same stage boxes as the colony stage: ribbon +
          safe top, nav + dock + safe bottom. */}
      <div
        data-testid="world-stage"
        className="fixed inset-x-0 z-0"
        style={{
          top: "calc(var(--spacing-ribbon) + var(--safe-inset-top, 0px))",
          bottom: "calc(var(--spacing-nav) + var(--dock-h, 0px) + var(--safe-inset-bottom, 0px))",
        }}
      >
      <WorldGlobe
        fill
        state={state}
        now={now}
        focusTarget={globeFocus ?? undefined}
        onRelocateColony={onRelocateColony}
        selectedPlanetId={selectedPlanetId}
        onSelectPlanet={setSelectedPlanetId}
        enterHomeNonce={enterHomeNonce}
        onEnterArena={onEnterArena}
        onEnterBeachhead={onEnterBeachhead}
        onExploreSite={onExploreSite}
        onRaidColony={(colony, key) => {
          // Same flow as the colony list's Raid button, plus select the
          // colony in the list so its action box opens under its card —
          // the formed party and its target live in the panels below.
          handleRaid(colony, key);
          setSelectedKey(key);
          setDeskFocus({ kind: "colony", key });
          setDeskOpen(true);
        }}
        onClaimHuskColony={onClaimHusk}
        onGleanColony={handleExplore}
        onRallyRaid={(raid) => {
          // The real rally button (with its respond flow) lives on the
          // raid's entry in the Incoming raids panel: snap the globe to
          // the raided site and scroll that entry into view.
          snapToRaidSite(raid.raidId);
          setDeskFocus({ kind: "raid", id: raid.raidId });
          setDeskOpen(true);
        }}
      />

      {/* STAGE OVERLAY: the world's identity + the doors, riding on the
          scene itself. pointer-events-none lets globe drags pass
          everywhere except the controls themselves. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[15] flex flex-col items-center gap-2 px-4 pb-3">
        {warnings.length > 0 && (
          <button
            type="button"
            onClick={() => { sound.click(); setDeskOpen(true); }}
            className="pointer-events-auto min-h-[44px] rounded-full border border-red-400/60 bg-red-950/80 px-4 py-2 text-[12px] font-bold text-red-100 backdrop-blur-sm"
          >
            {t("worldmap.alertWarnings", "⚠️ {n} raid warning(s) — tap to view", { n: String(warnings.length) })}
          </button>
        )}
        {raidIntel !== "none" && incomingRaids.length > 0 && (
          <button
            type="button"
            onClick={() => {
              sound.click();
              setDeskFocus({ kind: "raid", id: incomingRaids[0].raidId });
              setDeskOpen(true);
            }}
            className="pointer-events-auto min-h-[44px] rounded-full border border-red-400/60 bg-red-950/80 px-4 py-2 text-[12px] font-bold text-red-100 backdrop-blur-sm"
          >
            🚨 {t("raid.incomingTitle", "Incoming raids")} ({incomingRaids.length})
          </button>
        )}
        <div className="text-center">
          <h2 className="text-xl font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
            {t("world.title", "The World")}
          </h2>
          <p className="mx-auto mt-0.5 max-w-md text-[11px] leading-snug text-gray-200 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
            {t("world.sub", "Your colonies, rival holdings, Chorus sites, and incoming raids — the globe is your workstation.")}
          </p>
        </div>
        <button
          type="button"
          data-testid="world-desk-door"
          onClick={() => { sound.click(); setDeskOpen(true); }}
          className="pointer-events-auto min-h-[48px] rounded-full border border-white/25 bg-black/60 px-5 py-3 text-[13px] font-bold text-white backdrop-blur-sm"
        >
          🗺️ {t("worldmap.desk", "Colonies, raids & intel")}
        </button>
      </div>
      </div>

      {/* THE DESK: every panel that used to stack under the globe, behind
          one door, in its own scrollable surface with a way back. */}
      {deskOpen && (
      <div
        data-testid="world-desk"
        role="dialog"
        aria-label={t("world.title", "The World")}
        className="fixed inset-x-0 z-30 flex flex-col bg-surf-0"
        style={{
          top: "calc(var(--spacing-ribbon) + var(--safe-inset-top, 0px))",
          bottom: "calc(var(--spacing-nav) + var(--dock-h, 0px) + var(--safe-inset-bottom, 0px))",
        }}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-3 py-2">
          <button
            type="button"
            onClick={() => { sound.click(); setDeskOpen(false); }}
            className="min-h-[44px] shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[13px] font-semibold text-gray-100"
          >
            ← {t("world.deskBack", "Back to the globe")}
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-bold text-white">{t("world.title", "The World")}</h2>
            <p className="line-clamp-2 text-[11px] leading-snug text-gray-400">
              {t("world.sub", "Your colonies, rival holdings, Chorus sites, and incoming raids — the globe is your workstation.")}
            </p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4">

      {/* SCOUT PROBE HOME (Hans, Oct 6 2026): probes live on the World
          page now — counts, build, in-flight status. Launching happens
          from the solar-system planet sheets (zoom − all the way out). */}
      <ProbeStation
        state={state}
        now={now}
        onBuildProbe={onBuildProbe}
        onCollectProbe={onCollectProbe}
      />

      {/* WORLD INTEL (owner 2026-10-04, WS D): planet flavor (labeled as
          flavor, never telemetry), live colony/alliance counts, and the
          Chorus reverb ladder. Alliance rows snap the globe to their turf
          via the same WS5 globeFocus mechanism as snap-to-site. */}
      <WorldIntelPanel
        state={state}
        onSnap={(lat, lon) => setGlobeFocus({ lat, lon, nonce: Date.now() })}
      />
      <header>
        <h2 className="text-lg font-bold text-white">{t("worldmap.title", "World Map")}</h2>
        <p className="mt-0.5 text-[12px] leading-relaxed text-gray-400">
          {t(
            "worldmap.intro",
            "Colonies, not sites. Every marker is named for its owner. Amber means abandoned and gleanable — but intel goes stale, and what the scouts saw is never a promise.",
          )}
        </p>
      </header>

      {/* Defender warnings — raids that touched down. */}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-red-400/50 bg-red-950/40 p-3">
          {warnings.map((w) => (
            <p key={w.raidId} className="text-[12px] leading-relaxed text-red-100">
              {t("raid.warning", "⚠️ RAID INCOMING: {names} landed with {ships} ships and ~{troops} troops. Defend your colony!", {
                names: w.attackerNames.join(", "),
                ships: w.shipCount,
                troops: w.troopCount.toLocaleString(),
              })}
            </p>
          ))}
        </div>
      )}

      {/* Raiding party panel */}
      <RaidPanel
        state={state}
        raid={activeRaid}
        selectedColony={selected}
        selectedKey={selectedKey}
        onFormRaid={onFormRaid}
        onJoinRaid={onJoinRaid}
        onSetTarget={onSetRaidTarget}
        onClearTarget={onClearRaidTarget}
        onAssignShips={onAssignRaidShips}
        onLoadTroops={onLoadRaidTroops}
        onLoadSupplies={onLoadRaidSupplies}
        onLaunch={onLaunchRaid}
        onDeploy={onDeployRaid}
        onHireDeserters={onHireDeserters}
        onDismissDeserters={onDismissDeserters}
        onTacticalRound={onTacticalRound}
        onQuickResolveTactical={onQuickResolveTactical}
      />

      {/* Incoming cross-server raids (defender warnings, owner 2026-10-03).
          Satellite-gated (owner 2026-10-04): blind (stage 0) = no evidence of
          the raid anywhere — this panel does not render. */}
      {raidIntel !== "none" && incomingRaids.length > 0 && (
        <div className="rounded-xl border border-red-500/50 bg-red-950/30 p-3">
          <h3 className="text-[12px] font-semibold text-red-200">
            ⚠️ {t("raid.incomingTitle", "Incoming raids")} ({incomingRaids.length})
          </h3>
          {incomingRaids.map((r) => {
            const etaMs = Math.max(0, (r.landsAt || now) - now);
            const etaMin = Math.floor(etaMs / 60000);
            const etaSec = Math.floor((etaMs % 60000) / 1000);
            // Stage-2 partial ship-class reveal (deterministic per raid; never
            // the full set when more than one class is present).
            const partialShips = raidIntel === "identity" ? partialShipIntel(r.shipClasses, r.raidId) : [];
            const totalClasses = new Set(r.shipClasses ?? []).size;
            const moreUnknown = totalClasses > partialShips.length;
            return (
              <div
                key={r.raidId}
                ref={(el) => {
                  raidEntryRefs.current[r.raidId] = el;
                }}
                className="mt-2 rounded-lg border border-red-400/30 bg-black/40 p-2"
              >
                {raidIntel === "presence" ? (
                  <>
                    <p className="text-[12px] font-semibold text-red-100">
                      {t("raid.unidentifiedSignature", "🚨 UNIDENTIFIED SIGNATURE")}
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      {t("raid.inboundTo", "Inbound to")}{" "}
                      <SnapToSiteButton nodeName={raidNodeName} onSnap={() => snapToRaidSite(r.raidId)} />
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[12px] font-semibold text-red-100">
                      {r.attackerNames.join(", ") || t("raid.unknownRaiders", "Unknown raiders")}
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      {t("raid.incomingFrom", "from")} <span className="text-amber-200">{r.attackerWorldName}</span>
                      {raidIntel === "full" && (
                        <>
                          {" · "}{r.shipCount} {t("raid.ships", "ships")}
                          {" · ~"}{r.troopCount.toLocaleString()} {t("raid.troops", "troops")}
                        </>
                      )}
                    </p>
                    {/* WS5: the raided site is tappable at every intel stage. */}
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      {t("raid.inboundTo", "Inbound to")}{" "}
                      <SnapToSiteButton nodeName={raidNodeName} onSnap={() => snapToRaidSite(r.raidId)} />
                    </p>
                    {raidIntel === "identity" && partialShips.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {t("raid.partialContacts", "Partial contacts")}:{" "}
                        <span className="text-amber-200">
                          {partialShips.map((c) => RAID_SHIP_CLASS_LABEL[c] ?? c).join(", ")}
                        </span>
                        {moreUnknown && (
                          <span className="text-red-300/70"> + {t("raid.moreUnknown", "more unknown")}</span>
                        )}
                      </p>
                    )}
                  </>
                )}
                <p className="mt-0.5 text-[11px] font-semibold text-red-300">
                  {t("raid.eta", "Touchdown in")}: {etaMin > 0 ? `${etaMin}m ` : ""}{etaSec}s
                </p>
                {/* RESPOND (owner 2026-10-04): the war band's real response is a
                 * defense rally. One per raid — a raid that already has one
                 * shows "rally active" instead. */}
                <div className="mt-2">
                  {defenseRallyRaidIds.has(r.raidId) ? (
                    <div>
                      <p className="text-[12px] font-semibold text-emerald-200">
                        {t("raid.defenseRallyActive", "🛡️ Defense rally already mustering — your war band is on it.")}
                      </p>
                      {onOpenWarBand && (
                        <button
                          type="button"
                          onClick={() => onOpenWarBand()}
                          className="mt-1 rounded-lg border border-emerald-400/40 px-3 py-1.5 text-[12px] font-semibold text-emerald-100"
                        >
                          {t("raid.openWarBand", "Open war band")}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        disabled={!!raidResponding[r.raidId]}
                        onClick={async () => {
                          if (!onRespondToRaid) return;
                          setRaidResponding((p) => ({ ...p, [r.raidId]: true }));
                          setRaidRespondError((p) => {
                            const n = { ...p };
                            delete n[r.raidId];
                            return n;
                          });
                          try {
                            const err = await onRespondToRaid({
                              raidId: r.raidId,
                              nodeName: state.playerName ?? "Home colony",
                              landsAt: r.landsAt,
                            });
                            if (err) setRaidRespondError((p) => ({ ...p, [r.raidId]: err }));
                          } finally {
                            setRaidResponding((p) => ({ ...p, [r.raidId]: false }));
                          }
                        }}
                        className="rounded-lg border border-red-400/50 bg-red-500/20 px-3 py-1.5 text-[12px] font-bold text-red-100 disabled:opacity-60"
                      >
                        {raidResponding[r.raidId]
                          ? t("raid.rallying", "⏳ Rallying…")
                          : t("raid.rallyDefense", "⚔️ Rally the defense")}
                      </button>
                      {raidRespondError[r.raidId] && (
                        <p role="status" className="mt-1 text-[11px] text-red-200">
                          {raidRespondError[r.raidId]}
                        </p>
                      )}
                      {!onRespondToRaid && (
                        <p className="mt-1 text-[11px] text-gray-500">
                          {t("raid.respondSoon", "Respond isn't wired up yet — check back soon.")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <p className="mt-1.5 text-[10px] text-gray-500">
            {t("raid.incomingHint", "Man your defenses — the raid warning is real.")}
          </p>
        </div>
      )}

      {/* Your own colony's abandonment clock */}
      <div
        className={`rounded-xl border p-3 ${
          ownAbandoned ? "border-amber-400/50 bg-amber-400/10" : "border-white/10 bg-black/30"
        }`}
      >
        <p className="text-[12px] text-gray-300">
          {ownAbandoned ? (
            <span className="text-amber-200">
              {t("worldmap.ownAbandoned", "Your colony has gone quiet long enough to show as abandoned to others. Return and reclaim what's left.")}
            </span>
          ) : (
            <>
              {t("worldmap.ownActive", "Your colony is active.")}
              {" — "}
              <span className="text-gray-400">
                {t("worldmap.ownCountdown", "Go quiet and it abandons in {d}.", { d: abandonCountdownText(ownCountdown) })}
              </span>
            </>
          )}
        </p>
      </div>

      {/* Probe reports (odds, not guarantees) */}
      {wm && Object.keys(wm.reports).length > 0 && (
        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
          <h3 className="text-[12px] font-semibold text-gray-200">{t("worldmap.reports", "Scout reports")}</h3>
          <ul className="mt-1 space-y-1 text-[11px] text-gray-400">
            {Object.values(wm.reports).map((r) => (
              <li key={r.id}>
                <Bdi dir="ltr">{r.serverId}</Bdi>
                {" — "}
                {t(
                  "worldmap.reportLine",
                  "{p} players, {c} colonies, {a} abandoned. Odds, not promises.",
                  { p: r.playerCount, c: r.colonyCount, a: r.abandonedCount },
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Colony list = the v1 world map */}
      <div className="mb-2">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("worldmap.searchPlaceholder", "Search colonies by owner name…")}
          className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-white/30"
        />
      </div>
      {colonies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-black/20 p-6 text-center">
          <p className="text-sm text-gray-300">{t("worldmap.empty", "No colonies charted yet.")}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
            {t(
              "worldmap.emptyHint",
              "Research scout probes in the Lab, build probes, and launch them at distant worlds. Reports reveal colony counts; landing reveals the colonies themselves.",
            )}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {colonies.map((c) => {
            const key = colonyKey(c.serverId, c.id);
            const open = selectedKey === key;
            return (
              <div
                key={key}
                ref={(el) => {
                  colonyEntryRefs.current[key] = el;
                }}
              >
                <ColonyCard
                  colony={c}
                  expanded={open}
                  onSelect={() => setSelectedKey(toggleAccordion(selectedKey, key))}
                  hasMemorial={memorialSites.has(key)}
                />
                {/* WS4 (owner 2026-10-04): the raid/glean action box opens
                    inline directly beneath its own row — wizard philosophy,
                    no scrolling to the bottom of the page. */}
                {open && (
                  <div className="mt-1.5">
                    <ColonyDetail
                      colony={c}
                      colonyKeyStr={key}
                      now={now}
                      state={state}
                      onClose={() => setSelectedKey(null)}
                      onExplore={handleExplore}
                      onRaid={handleRaid}
                      onClaimHusk={onClaimHusk}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* v1: gleaning isn't wired yet — honest inline note, not a dead button. */}
      {exploreNote && (
        <p className="rounded-xl border border-white/10 bg-black/30 p-3 text-[12px] text-gray-400">
          {t("worldmap.exploreSoon", "Expedition noted. Gleaning runs aren't launchable yet — the colony stays on your map.")}
        </p>
      )}

      <p className="text-[10px] text-gray-600">
        {t("worldmap.staleNote", "Intel stales. A colony marked abandoned may already be gleaned, reclaimed, or razed — the map remembers what it last saw.")}
      </p>

      {/* Memorials — the game's history layer (owner 2026-09-30). */}
      <div className="mt-2">
        <MemorialsView state={state} onEpitaph={onEpitaph} />
      </div>

          </div>
        </div>
      </div>
      )}

      {/* SOLAR SYSTEM planet sheet (Hans, Oct 6 2026): probe-gated intel,
          send-a-probe, and Enter for the home world only. */}
      {selectedPlanet && (
        <PlanetSheet
          planet={selectedPlanet}
          homeWorldId={WORLD_CONFIG_PUBLIC.worldId}
          state={state}
          now={now}
          onClose={() => setSelectedPlanetId(null)}
          onLaunchProbe={onLaunchProbe}
          onCollectProbe={onCollectProbe}
          onEnterHome={() => {
            setEnterHomeNonce((n) => n + 1);
            setSelectedPlanetId(null);
          }}
        />
      )}
    </div>
  );
}
