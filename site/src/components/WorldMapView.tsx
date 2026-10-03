// WorldMapView — the world map (design/abandoned-colonies-world-map.md §2).
//
// Separate from the Circuit map (sites): the world map shows COLONIES, not
// sites. v1 is a scrollable list of colony cards — markers on a canvas come
// later. Each card: "<owner>'s Colony", status color, reverb if known.
// Tap a card → detail panel. Abandoned → the Explore Yes/No confirmation.
// Hans's rule: every button is always tappable; a tap that can't proceed
// shows the reason inline, right below the button.
import { useMemo, useState } from "react";
import type { GameState } from "../game/types";
import {
  abandonmentIn,
  colonyKey,
  colonyMarkerName,
  isAbandoned,
  lootTotal,
  type ColonyStatus,
  type KnownColony,
} from "../game/worldmap";
import {
  RAID_MAX_MEMBERS,
  raidJumpCharge,
  raidLaunchBlocker,
  raidLootCapacity,
  raidTroopCapacity,
  raidTroopCount,
  type RaidParty,
} from "../game/raids";
import type { TroopType } from "../game/war/troops";
import { useT } from "./i18n/I18n";
import { sound } from "../game/sound";
import { Bdi } from "./ui/Bdi";

// ---------------------------------------------------------------------------
// Pure helpers (tested in WorldMapView.test.ts)
// ---------------------------------------------------------------------------

/** Status dot color: green = active, amber = abandoned, gray = husk. */
export function statusColor(status: ColonyStatus): string {
  switch (status) {
    case "active":
      return "#34d399"; // emerald-400
    case "abandoned":
      return "#fbbf24"; // amber-400
    case "husk":
      return "#6b7280"; // gray-500
  }
}

/** Sort colonies: abandoned first (opportunity), then active, then husks. */
export function sortColonies(colonies: KnownColony[]): KnownColony[] {
  const rank = (s: ColonyStatus) => (s === "abandoned" ? 0 : s === "active" ? 1 : 2);
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

// ---------------------------------------------------------------------------
// Raid panel — form, outfit, and launch a raiding party (game/raids.ts).
// Hans's rule: every button always tappable; a tap that can't proceed shows
// the reason inline, right below the button.
// ---------------------------------------------------------------------------

/** Ready ships the player can assign: personal + alliance fleet. */
function readyShips(state: GameState): { id: string; name: string; class: string }[] {
  const out: { id: string; name: string; class: string }[] = [];
  const seen = new Set<string>();
  const psy = state.worldMap?.shipyard;
  if (psy) {
    for (const s of psy.ships) {
      if (s.status === "ready" && !seen.has(s.id)) {
        seen.add(s.id);
        out.push({ id: s.id, name: s.name, class: s.class });
      }
    }
  }
  const alliances = (state as { alliances?: Record<string, { members?: { colonyId: string }[]; shipyard?: { ships: { id: string; name: string; class: string; status: string }[] } }> }).alliances;
  if (alliances) {
    for (const a of Object.values(alliances)) {
      for (const s of a.shipyard?.ships ?? []) {
        if (s.status === "ready" && !seen.has(s.id)) {
          seen.add(s.id);
          out.push({ id: s.id, name: s.name, class: s.class });
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
  onSetTarget,
  onAssignShips,
  onLoadTroops,
  onLaunch,
}: {
  state: GameState;
  raid: RaidParty | null;
  selectedColony: KnownColony | null;
  selectedKey: string | null;
  onFormRaid?: () => void;
  onSetTarget?: (raidId: string, key: string) => void;
  onAssignShips?: (raidId: string, shipIds: string[]) => void;
  onLoadTroops?: (raidId: string, type: TroopType, count: number) => void;
  onLaunch?: (raidId: string) => void;
}) {
  const t = useT();
  const [hint, setHint] = useState<string | null>(null);
  const [pickedShips, setPickedShips] = useState<string[]>([]);
  const [troopInputs, setTroopInputs] = useState<Partial<Record<TroopType, string>>>({});

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

      {/* Target */}
      <p className="mt-1 text-[11px] text-gray-400">
        {t("raid.target", "Target")}:{" "}
        {raid.targetColonyId ? (
          <span className="text-amber-200">{raid.targetOwnerName}'s colony <Bdi dir="ltr">({raid.targetServerId})</Bdi></span>
        ) : (
          <span className="text-gray-500">{t("raid.noTarget", "No target — pick a colony on the map.")}</span>
        )}
      </p>
      {raid.status === "preparing" && !raid.targetColonyId && selectedColony && selectedColony.status === "active" && selectedKey && (
        <button
          type="button"
          onClick={() => {
            sound.click();
            if (onSetTarget) {
              setHint(null);
              onSetTarget(raid.id, selectedKey);
            } else setHint("noHandler");
          }}
          className="mt-1 rounded-lg border border-amber-400/40 bg-amber-400/15 px-2 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-400/25"
        >
          🎯 {t("raid.targetThis", "Target this colony")}
        </button>
      )}

      {raid.status === "preparing" && (
        <>
          {/* Ships */}
          <div className="mt-2">
            <p className="text-[11px] font-semibold text-gray-300">
              {t("raid.ships", "Ships")} ({raid.shipIds.length} {t("raid.assigned", "assigned")})
            </p>
            {ships.length === 0 ? (
              <p className="mt-1 text-[11px] text-gray-500">{t("raid.noShips", "No jump ships ready. Build ships at the shipyard first.")}</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {ships.map((s) => {
                  const on = pickedShips.includes(s.id) || raid.shipIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        sound.click();
                        setPickedShips((prev) =>
                          prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                        );
                      }}
                      className={`rounded-lg border px-2 py-1 text-[11px] ${
                        on ? "border-amber-400/60 bg-amber-400/15 text-amber-100" : "border-white/10 bg-white/5 text-gray-300 hover:border-white/25"
                      }`}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
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
                      if (onLoadTroops && n > 0) {
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colony card (the "marker")
// ---------------------------------------------------------------------------

function ColonyCard({
  colony,
  selected,
  onSelect,
}: {
  colony: KnownColony;
  selected: boolean;
  onSelect: () => void;
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
      aria-pressed={selected}
      className={`w-full rounded-xl border p-3 text-start transition-colors ${
        selected ? "border-amber-400/60 bg-amber-400/10" : "border-white/10 bg-black/30 hover:border-white/25"
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
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide" style={{ color }}>
          {colony.status === "active"
            ? t("worldmap.statusActive", "Active")
            : colony.status === "abandoned"
              ? t("worldmap.statusAbandoned", "Abandoned")
              : t("worldmap.statusHusk", "Husk")}
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
// Detail panel
// ---------------------------------------------------------------------------

function ColonyDetail({
  colony,
  colonyKeyStr,
  now,
  onClose,
  onExplore,
  onRaid,
}: {
  colony: KnownColony;
  colonyKeyStr: string;
  now: number;
  onClose: () => void;
  onExplore: (colony: KnownColony) => void;
  onRaid?: (colony: KnownColony, key: string) => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [raidHint, setRaidHint] = useState<string | null>(null);
  const color = statusColor(colony.status);
  const loot = colony.lootObserved;
  const lootLeft = loot ? lootTotal(loot) : 0;
  const hasMercs = colony.mercenaries != null && colony.mercenaries !== undefined;
  const explorable = colony.status !== "active";

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
            {colony.status === "active"
              ? t("worldmap.statusActive", "Active")
              : colony.status === "abandoned"
                ? t("worldmap.statusAbandoned", "Abandoned")
                : t("worldmap.statusHusk", "Husk")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            sound.click();
            onClose();
          }}
          aria-label={t("worldmap.close", "Close")}
          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-gray-300 hover:bg-white/10"
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
      </div>

      {/* Raid — active colonies only. Always tappable; tap explains. */}
      {colony.status === "active" && (
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
            {t("raid.defenderWarned", "Loot-only v1. The defender is warned the moment you touch down.")}
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
  onFormRaid,
  onSetRaidTarget,
  onAssignRaidShips,
  onLoadRaidTroops,
  onLaunchRaid,
}: {
  state: GameState;
  now: number;
  /** Called when the player confirms exploring an abandoned colony. v1: the
   *  parent may not wire gleaning yet — then the detail shows a "soon" note. */
  onExplore?: (colony: KnownColony) => void;
  /** Raid wiring (optional — unwired buttons explain inline per Hans's rule). */
  onFormRaid?: () => void;
  onSetRaidTarget?: (raidId: string, key: string) => void;
  onAssignRaidShips?: (raidId: string, shipIds: string[]) => void;
  onLoadRaidTroops?: (raidId: string, type: TroopType, count: number) => void;
  onLaunchRaid?: (raidId: string) => void;
}) {
  const t = useT();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [exploreNote, setExploreNote] = useState<string | null>(null);
  const wm = state.worldMap;

  const colonies = useMemo(() => {
    if (!wm) return [];
    return sortColonies(Object.values(wm.known));
  }, [wm]);

  const selected = selectedKey ? (wm?.known[selectedKey] ?? null) : null;

  // Active raid (the one the panel manages): newest non-done, else newest.
  const activeRaid = useMemo(() => {
    const raids = wm?.raids ?? [];
    return raids.find((r) => r.status !== "done") ?? raids[raids.length - 1] ?? null;
  }, [wm]);

  // Unseen defender warnings.
  const warnings = useMemo(() => (wm?.raidWarnings ?? []).filter((w) => !w.seen), [wm]);

  // The player's own colony: "abandons in Xd" warning lives here too.
  const ownLastActive = wm?.lastActive ?? now;
  const ownAbandoned = isAbandoned(ownLastActive, now);
  const ownCountdown = abandonmentIn(ownLastActive, now);

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
      // The new party targets this colony on the next tap (party id unknown
      // until the server round-trips — the panel shows the "no target" hint).
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4 pb-24">
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
        onSetTarget={onSetRaidTarget}
        onAssignShips={onAssignRaidShips}
        onLoadTroops={onLoadRaidTroops}
        onLaunch={onLaunchRaid}
      />

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
            return (
              <ColonyCard
                key={key}
                colony={c}
                selected={selectedKey === key}
                onSelect={() => setSelectedKey(selectedKey === key ? null : key)}
              />
            );
          })}
        </div>
      )}

      {/* Detail panel for the tapped colony */}
      {selected && selectedKey && (
        <ColonyDetail
          colony={selected}
          colonyKeyStr={selectedKey}
          now={now}
          onClose={() => setSelectedKey(null)}
          onExplore={handleExplore}
          onRaid={handleRaid}
        />
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
    </div>
  );
}
