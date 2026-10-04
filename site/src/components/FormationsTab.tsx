// Formations — the dedicated loadout page (owner 2026-10-04: "don't be afraid
// to make pages"). A formation is a pre-built battle group ready to roll:
// raid loadouts, exploration loadouts, response teams.
//
// A formation holds: a NAME, a TYPE, a HERO LEADER (required — a formation
// doesn't march without one), reserved jump SHIPS each loaded with TROOPS
// (capacity-respecting), and staged SUPPLIES.
//
// Deploy consumes the formation into a raid party: the raid is created
// pre-loaded, and the player picks a target on the World map and launches.
// The formation retires when the raid comes home.

import { useMemo, useState } from "react";
import type { GameState } from "../game/types";
import { useT } from "./i18n/I18n";
import {
  assignFormationShipFn,
  createFormationFn,
  deleteFormationFn,
  deployFormationFn,
  loadFormationTroopsFn,
  removeFormationShipFn,
  stageFormationSuppliesFn,
  unloadFormationTroopsFn,
  unstageFormationSuppliesFn,
} from "../game/api";
import {
  type Formation,
  type FormationType,
  formationTroopCount,
  formationDeployBlocker,
  formationReverb,
  formationSiteReadiness,
} from "../game/formations";
import { SHIP_TROOP_CAP } from "../game/raids";
import { type ShipClass } from "../game/worldmap";
import { TROOP_TYPES, TROOP_JOBS, type TroopType } from "../game/war/troops";
import { allianceOf } from "../game/war/alliances";
import { ensureShipyard } from "../game/shipyard";

interface Props {
  state: GameState;
  busy: boolean;
  token: string | null;
  onAction: (fn: () => Promise<unknown>, label: string) => Promise<void>;
  /** Jump to the World map after a deploy so the player can pick a target. */
  onGoToWorld?: () => void;
}

const FORMATION_TYPES: FormationType[] = ["raid", "exploration", "response"];

function typeBlurb(t: (k: string, f: string) => string, type: FormationType): string {
  switch (type) {
    case "raid":
      return t("formations.type.raidBlurb", "An attack formation — deploys as a raid party.");
    case "exploration":
      return t("formations.type.explorationBlurb", "A survey formation — ships, troops, and supplies staged for the deep.");
    case "response":
      return t("formations.type.responseBlurb", "A defense formation — on standby for incoming raids.");
  }
}

function typeLabel(t: (k: string, f: string) => string, type: FormationType): string {
  switch (type) {
    case "raid":
      return t("formations.type.raid", "Raid loadout");
    case "exploration":
      return t("formations.type.exploration", "Exploration loadout");
    case "response":
      return t("formations.type.response", "Response team");
  }
}

/** Player's mustered-at-home troops by type (heads). */
function homeTroopsByType(state: GameState): Record<TroopType, number> {
  const out = {} as Record<TroopType, number>;
  for (const ty of TROOP_TYPES) out[ty] = 0;
  for (const c of state.troops?.home.roster.cohorts ?? []) {
    out[c.type] = (out[c.type] ?? 0) + c.count;
  }
  return out;
}

/** Hero/leader roster available to lead formations. */
function leaderRoster(state: GameState): { id: string; name: string; kind: string }[] {
  const out: { id: string; name: string; kind: string }[] = [];
  for (const h of state.prologue?.heroes ?? []) out.push({ id: h.id, name: h.name, kind: "hero" });
  for (const l of state.leaders ?? []) out.push({ id: l.id, name: l.name, kind: "leader" });
  return out;
}

/** All ships the player can reserve: personal + alliance fleet. */
export interface ReserveShip {
  id: string;
  class: ShipClass;
  raceId: string;
  name: string;
  status: string;
  owner: "personal" | "alliance";
}

function allShips(state: GameState): ReserveShip[] {
  const out: ReserveShip[] = [];
  for (const s of state.worldMap?.shipyard?.ships ?? []) {
    out.push({ id: s.id, class: s.class, raceId: s.raceId, name: s.name, status: s.status, owner: "personal" });
  }
  const alliance = allianceOf(state, state.gameId ?? "");
  if (alliance) {
    for (const s of ensureShipyard(alliance).ships ?? []) {
      out.push({ id: s.id, class: s.class, raceId: s.raceId, name: s.name, status: s.status, owner: "alliance" });
    }
  }
  return out;
}

/** Summed battle power of forge pieces equipped by one hero/leader —
 *  the "equipment" term of the formation's reverb. */
function heroEquipmentPower(state: GameState, heroId: string): number {
  let n = 0;
  for (const it of state.forgeItems ?? []) {
    if (it.equippedBy?.id === heroId) n += Math.max(0, it.power ?? 0);
  }
  return n;
}

/** A formation's reverb, with its hero's equipped gear folded in. */
function formationReverbTotal(state: GameState, f: Formation): number {
  return formationReverb(f, heroEquipmentPower(state, f.heroId));
}

export default function FormationsTab({ state, busy, token, onAction, onGoToWorld }: Props) {
  const t = useT();
  const formations = useMemo(() => state.formations?.formations ?? [], [state.formations]);
  const [view, setView] = useState<{ kind: "list" } | { kind: "create" } | { kind: "detail"; formationId: string }>({
    kind: "list",
  });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const leaders = useMemo(() => leaderRoster(state), [state.prologue, state.leaders]);
  const ships = useMemo(() => allShips(state), [state.worldMap, state.gameId, state.alliances]);
  const homeTroops = useMemo(() => homeTroopsByType(state), [state.troops]);
  const homeSupplies = Math.floor(state.resources?.supplies ?? 0);

  const selected = view.kind === "detail" ? formations.find((f) => f.id === view.formationId) : undefined;

  const doAction = (fn: () => Promise<unknown>, label: string) => {
    return onAction(fn, label);
  };

  if (!token) {
    return (
      <div className="panel p-4">
        <p className="text-sm text-text-2">{t("shipyard.hintSignIn", "Sign in to muster formations.")}</p>
      </div>
    );
  }

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">{t("formations.title", "Formations")}</h2>
          <p className="text-xs text-text-2">{t("formations.sub", "Pre-built battle groups — ships reserved and loaded, a hero in command. Grab one and roll.")}</p>
        </div>
        {view.kind === "list" && (
          <button
            type="button"
            className="btn-primary shrink-0"
            disabled={busy}
            onClick={() => setView({ kind: "create" })}
          >
            {t("formations.new", "New Formation")}
          </button>
        )}
        {view.kind !== "list" && (
          <button
            type="button"
            className="btn shrink-0"
            disabled={busy}
            onClick={() => {
              setConfirmDelete(null);
              setView({ kind: "list" });
            }}
          >
            ← {t("formations.back", "Back to formations")}
          </button>
        )}
      </div>

      {view.kind === "list" && (
        <FormationList
          formations={formations}
          leaders={leaders}
          busy={busy}
          reverbOf={(f) => formationReverbTotal(state, f)}
          onNew={() => setView({ kind: "create" })}
          onOpen={(id) => setView({ kind: "detail", formationId: id })}
          onDeploy={(f) =>
            doAction(
              () => deployFormationFn({ data: { token: token!, formationId: f.id } }),
              "deployFormation",
            )
          }
          onGoToWorld={onGoToWorld}
        />
      )}

      {view.kind === "create" && (
        <CreateFormation
          token={token!}
          busy={busy}
          leaders={leaders}
          formations={formations}
          onAction={doAction}
          onCreated={(id) => setView({ kind: "detail", formationId: id })}
        />
      )}

      {view.kind === "detail" && selected && (
        <FormationDetail
          token={token!}
          busy={busy}
          formation={selected}
          ships={ships}
          leaders={leaders}
          homeTroops={homeTroops}
          homeSupplies={homeSupplies}
          reverb={formationReverbTotal(state, selected)}
          equipmentPower={heroEquipmentPower(state, selected.heroId)}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
          onAction={doAction}
          onGoToWorld={onGoToWorld}
          onDeleted={() => {
            setConfirmDelete(null);
            setView({ kind: "list" });
          }}
        />
      )}

      {view.kind === "detail" && !selected && (
        <p className="text-sm text-text-2">Formation not found — it may have deployed or been disbanded.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

function FormationList({
  formations,
  leaders,
  busy,
  reverbOf,
  onNew,
  onOpen,
  onDeploy,
  onGoToWorld,
}: {
  formations: Formation[];
  leaders: { id: string; name: string }[];
  busy: boolean;
  reverbOf: (f: Formation) => number;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDeploy: (f: Formation) => void;
  onGoToWorld?: () => void;
}) {
  const t = useT();
  const leaderName = (id: string) => leaders.find((l) => l.id === id)?.name ?? "—";
  const standby = formations.filter((f) => f.status === "standby");
  const deployed = formations.filter((f) => f.status === "deployed");

  return (
    <div>
      {formations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/20 p-6 text-center">
          <p className="text-sm text-text-2">
            {t("formations.empty", "No formations yet. Muster your first battle group — name it, give it a hero, reserve ships, load troops.")}
          </p>
          <button type="button" className="btn-primary mt-3" disabled={busy} onClick={onNew}>
            {t("formations.new", "New Formation")}
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {standby.map((f) => (
            <FormationCard
              key={f.id}
              formation={f}
              heroName={leaderName(f.heroId)}
              reverb={reverbOf(f)}
              busy={busy}
              onOpen={() => onOpen(f.id)}
              onDeploy={() => onDeploy(f)}
              onGoToWorld={onGoToWorld}
            />
          ))}
          {deployed.map((f) => (
            <FormationCard key={f.id} formation={f} heroName={leaderName(f.heroId)} reverb={reverbOf(f)} busy={busy} onOpen={() => onOpen(f.id)} />
          ))}
        </div>
      )}

      <div className="mt-6 rounded-lg bg-white/5 p-4">
        <h3 className="text-sm font-semibold">{t("formations.howItWorks", "How formations work")}</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-text-2">
          <li>{t("formations.how1", "Muster a formation: name it, pick its type, assign a hero leader.")}</li>
          <li>{t("formations.how2", "Reserve ready jump ships — they're held on standby, off the raid board.")}</li>
          <li>{t("formations.how3", "Load troops onto each ship. What the formation carries is committed.")}</li>
          <li>{t("formations.how4", "Deploy as a raid when you're ready — pick a target on the world map, then launch.")}</li>
        </ol>
      </div>
    </div>
  );
}

function FormationCard({
  formation: f,
  heroName,
  reverb,
  busy,
  onOpen,
  onDeploy,
  onGoToWorld,
}: {
  formation: Formation;
  heroName: string;
  reverb: number;
  busy: boolean;
  onOpen: () => void;
  onDeploy?: () => void;
  onGoToWorld?: () => void;
}) {
  const t = useT();
  const troops = formationTroopCount(f);
  const blocker = formationDeployBlocker(f);
  const isDeployed = f.status === "deployed";
  const readiness = formationSiteReadiness(reverb);

  return (
    <div className={`rounded-lg border p-4 ${isDeployed ? "border-white/10 opacity-70" : "border-white/15 bg-white/[0.03]"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold">{f.name}</h3>
            <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[11px] text-indigo-200">{typeLabel(t, f.type)}</span>
            {isDeployed ? (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-200">
                {t("formations.deployed", "Deployed")}
              </span>
            ) : (
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-200">
                {t("formations.standby", "Standby")}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-text-2">
            {t("formations.ledBy", "Led by {name}").replace("{name}", f.heroName || heroName)}
            {" · "}
            {t("formations.shipsCount", "{n} ship{s}").replace("{n}", String(f.ships.length)).replace("{s}", f.ships.length === 1 ? "" : "s")}
            {" · "}
            {t("formations.troopsCount", "{n} troops").replace("{n}", String(troops))}
            {f.supplies > 0 && ` · 📦 ${f.supplies.toLocaleString()}`}
          </p>
          {/* REVERB (owner 2026-10-04): the loadout's force-power rating — same
              scale as a Chorus site's recommended reverb. */}
          <p className="mt-1.5 text-xs">
            <span className="rounded bg-violet-500/20 px-2 py-0.5 font-semibold text-violet-200">
              ⚡ {t("formations.reverb", "Reverb")} {reverb.toLocaleString()}
            </span>{" "}
            <span className="text-text-2">
              {readiness
                ? t(
                    "formations.reverbReady",
                    "enough for {site} (Grade {grade})",
                  )
                    .replace("{site}", readiness.siteName)
                    .replace("{grade}", readiness.gradeLabel)
                : t("formations.reverbNotReady", "not yet enough for even a Grade I Chorus site")}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn" disabled={busy} onClick={onOpen}>
            {t("formations.view", "View")}
          </button>
          {onDeploy && !isDeployed && (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => {
                onDeploy();
                onGoToWorld?.();
              }}
              title={blocker ?? undefined}
            >
              {t("formations.deploy", "Deploy as Raid")}
            </button>
          )}
        </div>
      </div>
      {onDeploy && !isDeployed && blocker && (
        <p className="mt-2 text-xs text-amber-300/90">⚠ {blocker}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create view
// ---------------------------------------------------------------------------

function CreateFormation({
  token,
  busy,
  leaders,
  formations,
  onAction,
  onCreated,
}: {
  token: string;
  busy: boolean;
  leaders: { id: string; name: string; kind: string }[];
  formations: Formation[];
  onAction: (fn: () => Promise<unknown>, label: string) => void;
  onCreated: (id: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [type, setType] = useState<FormationType>("raid");
  const [heroId, setHeroId] = useState("");

  const heroBusy = (id: string) => formations.find((f) => f.heroId === id && f.status === "standby");
  const canMuster = name.trim().length > 0 && heroId !== "" && !heroBusy(heroId);

  const muster = () => {
    if (!canMuster) return;
    onAction(
      () =>
        createFormationFn({ data: { token, name: name.trim(), type, heroId } }).then((res) => {
          // The server returns the new state; find the new formation by name.
          if (res?.ok) {
            const fresh = (res as unknown as { state?: GameState })?.state?.formations?.formations ?? [];
            const created = fresh.find(
              (f: Formation) => f.name === name.trim() && f.heroId === heroId && f.status === "standby",
            );
            if (created) onCreated(created.id);
          }
          return res;
        }),
      "createFormation",
    );
  };

  return (
    <div className="max-w-2xl">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="formation-name">
            {t("formations.name", "Formation name")}
          </label>
          <input
            id="formation-name"
            type="text"
            className="input w-full"
            placeholder={t("formations.namePh", "Dawn Hammer, Gate Watch…")}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium">{t("formations.type", "Type")}</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {FORMATION_TYPES.map((ft) => (
              <button
                key={ft}
                type="button"
                className={`rounded-lg border p-3 text-left transition ${
                  type === ft ? "border-indigo-400 bg-indigo-500/15" : "border-white/15 bg-white/[0.03] hover:border-white/30"
                }`}
                onClick={() => setType(ft)}
              >
                <div className="text-sm font-semibold">{typeLabel(t, ft)}</div>
                <div className="mt-1 text-xs text-text-2">{typeBlurb(t, ft)}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium">
            {t("formations.leader", "Hero leader")} <span className="text-red-400">*</span>
          </span>
          <p className="mb-2 text-xs text-amber-200/90">
            ⚔ {t("formations.leaderRequired", "A formation needs a hero to lead it — no hero, no formation. Pick a leader to muster.")}
          </p>
          {leaders.length === 0 ? (
            <p className="text-sm text-text-2">
              {t("formations.noHeroes", "No heroes or leaders yet — the story hasn't given you anyone to command.")}
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {leaders.map((l) => {
                const busy2 = heroBusy(l.id);
                const selected2 = heroId === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    disabled={!!busy2}
                    className={`rounded-lg border p-3 text-left transition ${
                      selected2
                        ? "border-amber-400 bg-amber-500/15"
                        : busy2
                          ? "cursor-not-allowed border-white/10 opacity-50"
                          : "border-white/15 bg-white/[0.03] hover:border-white/30"
                    }`}
                    onClick={() => setHeroId(l.id)}
                  >
                    <div className="text-sm font-semibold">{l.name}</div>
                    <div className="text-[11px] capitalize text-text-2">{l.kind}</div>
                    {busy2 && (
                      <div className="mt-1 text-[11px] text-amber-300/90">
                        {t("formations.leaderBusy", "{name} already leads \"{formation}\" — one hero, one formation.")
                          .replace("{name}", l.name)
                          .replace("{formation}", busy2.name)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!heroId && leaders.length > 0 && (
          <p className="text-xs text-text-2">{t("formations.pickLeader", "Pick a leader")} ↑</p>
        )}

        <div>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !canMuster}
            onClick={muster}
            title={!heroId ? t("formations.blocker.noHero", "Assign a hero leader first — a formation doesn't march without one.") : undefined}
          >
            {t("formations.muster", "Muster Formation")}
          </button>
          {!canMuster && (
            <p className="mt-2 text-xs text-amber-300/90">
              {!name.trim()
                ? t("formations.name", "Formation name") + " — give it a name."
                : !heroId
                  ? t("formations.blocker.noHero", "Assign a hero leader first — a formation doesn't march without one.")
                  : heroBusy(heroId)
                    ? t("formations.leaderBusy", "{name} already leads \"{formation}\" — one hero, one formation.")
                        .replace("{name}", leaders.find((l) => l.id === heroId)?.name ?? "")
                        .replace("{formation}", heroBusy(heroId)!.name)
                    : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function FormationDetail({
  token,
  busy,
  formation: f,
  ships,
  leaders,
  homeTroops,
  homeSupplies,
  reverb,
  equipmentPower,
  confirmDelete,
  setConfirmDelete,
  onAction,
  onGoToWorld,
  onDeleted,
}: {
  token: string;
  busy: boolean;
  formation: Formation;
  ships: ReserveShip[];
  leaders: { id: string; name: string }[];
  homeTroops: Record<TroopType, number>;
  homeSupplies: number;
  reverb: number;
  equipmentPower: number;
  confirmDelete: string | null;
  setConfirmDelete: (id: string | null) => void;
  onAction: (fn: () => Promise<unknown>, label: string) => Promise<void>;
  onGoToWorld?: () => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const heroName = leaders.find((l) => l.id === f.heroId)?.name ?? f.heroName;
  const blocker = formationDeployBlocker(f);
  const isDeployed = f.status === "deployed";
  const readiness = formationSiteReadiness(reverb);
  const available = ships.filter((s) => s.status === "ready");
  const reservedElsewhere = useMemo(() => {
    // Ships marked reserved but not in this formation — show where they are.
    return ships.filter((s) => s.status === "reserved" && !f.ships.some((fs) => fs.shipId === s.id));
  }, [ships, f.ships]);

  const [supplyAmt, setSupplyAmt] = useState(500);

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold">{f.name}</h3>
        <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[11px] text-indigo-200">{typeLabel(t, f.type)}</span>
        {isDeployed ? (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-200">
            {t("formations.deployed", "Deployed")}
          </span>
        ) : (
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-200">
            {t("formations.standby", "Standby")}
          </span>
        )}
      </div>
      <p className="text-sm text-text-2">{t("formations.ledBy", "Led by {name}").replace("{name}", heroName)}</p>

      {/* REVERB (owner 2026-10-04): the running force-power total — troops,
          ships, and the hero's equipped gear, on the same scale as a Chorus
          site's recommended reverb. */}
      <div className="rounded-lg border border-violet-400/30 bg-violet-500/10 p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold text-violet-200">⚡ {reverb.toLocaleString()}</span>
          <span className="text-sm font-semibold text-violet-200/90">{t("formations.reverb", "Reverb")}</span>
        </div>
        <p className="mt-1 text-xs text-text-2">
          {t(
            "formations.reverbScale",
            "Troops, ships, and {hero}'s equipped gear — same scale as a Chorus site's recommended reverb.",
          ).replace("{hero}", heroName)}
          {equipmentPower > 0 && (
            <> {t("formations.reverbGear", "Gear contributes {n}.").replace("{n}", String(Math.round(equipmentPower)))} </>
          )}
        </p>
        <p className="mt-2 text-sm">
          {readiness ? (
            <span className="text-emerald-300">
              ✓{" "}
              {t("formations.reverbReadyLong", "Reverb {r} — enough for {site} (Grade {grade}).")
                .replace("{r}", reverb.toLocaleString())
                .replace("{site}", readiness.siteName)
                .replace("{grade}", readiness.gradeLabel)}
            </span>
          ) : (
            <span className="text-amber-300">
              ⚠{" "}
              {t(
                "formations.reverbNotReadyLong",
                "Reverb {r} — not yet enough for even a Grade I Chorus site (needs 21). Add troops, ships, or gear.",
              ).replace("{r}", reverb.toLocaleString())}
            </span>
          )}
        </p>
      </div>
      {isDeployed && (
        <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">
          {t("formations.deployedNote", "This formation deployed with its raid — it's with its raid now.")}
        </p>
      )}

      {/* Ships */}
      <section>
        <h4 className="mb-2 text-sm font-semibold">{t("formations.ships", "Ships")} ({f.ships.length})</h4>
        {f.ships.length === 0 ? (
          <p className="text-sm text-text-2">{t("formations.noShips", "No ships reserved yet.")}</p>
        ) : (
          <div className="space-y-3">
            {f.ships.map((s) => {
              const cap = SHIP_TROOP_CAP[s.class] ?? 100;
              const troops = s.troops as Record<string, number>;
              const used = Object.values(troops).reduce((a, b) => a + (b ?? 0), 0);
              const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
              const shipInfo = ships.find((x) => x.id === s.shipId);
              return (
                <div key={s.shipId} className="rounded-lg border border-white/15 bg-white/[0.03] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">
                        {shipInfo?.name ?? s.class} <span className="text-xs font-normal text-text-2">({s.class})</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-2 w-40 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={`h-full rounded-full ${pct >= 100 ? "bg-red-400" : pct >= 75 ? "bg-amber-400" : "bg-emerald-400"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="num text-xs text-text-2">
                          {t("formations.capacity", "{used} / {cap} troops").replace("{used}", String(used)).replace("{cap}", String(cap))}
                        </span>
                      </div>
                      {Object.entries(troops).some(([, c]) => (c ?? 0) > 0) && (
                        <div className="mt-1 text-xs text-text-2">
                          {Object.entries(troops)
                            .filter(([, c]) => (c ?? 0) > 0)
                            .map(([ty, c]) => `${c!.toLocaleString()} ${ty}`)
                            .join(" · ")}
                        </div>
                      )}
                    </div>
                    {!isDeployed && (
                      <button
                        type="button"
                        className="btn shrink-0"
                        disabled={busy}
                        onClick={() =>
                          onAction(() => removeFormationShipFn({ data: { token, formationId: f.id, shipId: s.shipId } }), "removeFormationShip")
                        }
                      >
                        {t("formations.releaseShip", "Release")}
                      </button>
                    )}
                  </div>
                  {!isDeployed && (
                    <TroopLoader
                      token={token}
                      busy={busy}
                      formationId={f.id}
                      shipId={s.shipId}
                      cap={cap}
                      used={used}
                      homeTroops={homeTroops}
                      shipTroops={troops}
                      onAction={onAction}
                    />
                  )}
                  {shipInfo && shipInfo.status !== "reserved" && (
                    <p className="mt-1 text-[11px] text-red-300/90">
                      ⚠ Ship status: {shipInfo.status} — expected "reserved".
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Reserve more ships */}
        {!isDeployed && (
          <div className="mt-3">
            <h5 className="mb-1 text-xs font-semibold text-text-2">{t("formations.availableShips", "Available ships")}</h5>
            {available.length === 0 ? (
              <p className="text-xs text-text-2">
                {t("formations.noAvailableShips", "No ready ships — build more at the shipyard.")}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {available.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 p-2">
                    <span className="text-xs">
                      {s.name}{" "}
                      <span className="text-text-2">({s.owner === "alliance" ? "alliance" : "personal"})</span>
                    </span>
                    <button
                      type="button"
                      className="btn shrink-0"
                      disabled={busy}
                      onClick={() =>
                        onAction(() => assignFormationShipFn({ data: { token, formationId: f.id, shipId: s.id } }), "assignFormationShip")
                      }
                    >
                      {t("formations.reserveShip", "Reserve")}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {reservedElsewhere.length > 0 && (
              <p className="mt-2 text-[11px] text-text-2">
                {reservedElsewhere.map((s) => t("formations.reservedBy", "Reserved — {name}").replace("{name}", s.name)).join(" · ")}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Supplies */}
      <section>
        <h4 className="mb-2 text-sm font-semibold">
          {t("formations.supplies", "Supplies staged")} — <span className="num">{f.supplies.toLocaleString()}</span>
        </h4>
        {!isDeployed && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              className="input w-28"
              value={supplyAmt}
              onChange={(e) => setSupplyAmt(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
            />
            <button
              type="button"
              className="btn"
              disabled={busy || homeSupplies <= 0}
              title={homeSupplies <= 0 ? `Home stockpile empty — you have ${homeSupplies}.` : `Home: ${homeSupplies.toLocaleString()}`}
              onClick={() =>
                onAction(() => stageFormationSuppliesFn({ data: { token, formationId: f.id, amount: supplyAmt } }), "stageFormationSupplies")
              }
            >
              {t("formations.stage", "Stage")}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || f.supplies <= 0}
              onClick={() =>
                onAction(() => unstageFormationSuppliesFn({ data: { token, formationId: f.id, amount: supplyAmt } }), "unstageFormationSupplies")
              }
            >
              {t("formations.returnSupplies", "Return")}
            </button>
            <span className="text-xs text-text-2">Home: {homeSupplies.toLocaleString()}</span>
          </div>
        )}
      </section>

      {/* Deploy / delete */}
      <section className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
        {!isDeployed && (
          <>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => {
                onAction(() => deployFormationFn({ data: { token, formationId: f.id } }), "deployFormation");
                onGoToWorld?.();
              }}
              title={blocker ?? undefined}
            >
              {t("formations.deploy", "Deploy as Raid")}
            </button>
            {blocker && <p className="text-xs text-amber-300/90">⚠ {blocker}</p>}
          </>
        )}
        {!isDeployed && (
          confirmDelete === f.id ? (
            <span className="flex items-center gap-2">
              <span className="text-xs text-text-2">
                {t("formations.deleteConfirm", "Disband \"{name}\"? Ships go ready, troops and supplies come home.").replace("{name}", f.name)}
              </span>
              <button
                type="button"
                className="btn-danger"
                disabled={busy}
                onClick={() =>
                  onAction(() => deleteFormationFn({ data: { token, formationId: f.id } }), "deleteFormation").then(() => onDeleted())
                }
              >
                {t("formations.confirm", "Confirm")}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => setConfirmDelete(null)}>
                {t("formations.cancel", "Cancel")}
              </button>
            </span>
          ) : (
            <button type="button" className="btn-danger" disabled={busy} onClick={() => setConfirmDelete(f.id)}>
              {t("formations.delete", "Disband")}
            </button>
          )
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-ship troop loader with capacity bar
// ---------------------------------------------------------------------------

function TroopLoader({
  token,
  busy,
  formationId,
  shipId,
  cap,
  used,
  homeTroops,
  shipTroops,
  onAction,
}: {
  token: string;
  busy: boolean;
  formationId: string;
  shipId: string;
  cap: number;
  used: number;
  homeTroops: Record<TroopType, number>;
  shipTroops: Record<string, number>;
  onAction: (fn: () => Promise<unknown>, label: string) => void;
}) {
  const t = useT();
  const [loadType, setLoadType] = useState<TroopType>("reaver");
  const [loadCount, setLoadCount] = useState(50);
  const [expanded, setExpanded] = useState(false);
  const free = Math.max(0, cap - used);

  if (!expanded) {
    return (
      <button type="button" className="btn mt-2" disabled={busy} onClick={() => setExpanded(true)}>
        {t("formations.loadTroops", "Load troops")}
      </button>
    );
  }

  const load = () => {
    const n = Math.trunc(loadCount);
    if (n <= 0) return;
    onAction(
      () => loadFormationTroopsFn({ data: { token, formationId, shipId, type: loadType, count: n } }),
      "loadFormationTroops",
    );
  };
  const unload = (type: TroopType, n: number) => {
    onAction(
      () => unloadFormationTroopsFn({ data: { token, formationId, shipId, type, count: n } }),
      "unloadFormationTroops",
    );
  };

  return (
    <div className="mt-2 rounded-lg bg-black/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input" value={loadType} onChange={(e) => setLoadType(e.target.value as TroopType)}>
          {TROOP_TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {ty} — {TROOP_JOBS[ty] ?? ""} ({(homeTroops[ty] ?? 0).toLocaleString()} home, {free} {t("formations.seatsFree", "{free} seats free").replace("{free}", "")}free)
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={Math.min(free, homeTroops[loadType] ?? 0)}
          className="input w-24"
          value={loadCount}
          onChange={(e) => setLoadCount(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
        />
        <button
          type="button"
          className="btn"
          disabled={busy || free <= 0 || (homeTroops[loadType] ?? 0) <= 0}
          title={
            free <= 0
              ? t("formations.seatsFull", "Full")
              : (homeTroops[loadType] ?? 0) <= 0
                ? `No ${loadType} mustered at home — build them at the Barracks first.`
                : undefined
          }
          onClick={load}
        >
          {t("formations.stage", "Stage")} →
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => setExpanded(false)}>
          ✕
        </button>
      </div>
      <p className="mt-1 text-[11px] text-text-2">
        {t("formations.seatsFree", "{free} seats free").replace("{free}", String(free))} ·{" "}
        {(homeTroops[loadType] ?? 0).toLocaleString()} {loadType} at home
      </p>
      {Object.entries(shipTroops).some(([, c]) => (c ?? 0) > 0) && (
        <div className="mt-2 space-y-1">
          {Object.entries(shipTroops)
            .filter(([, c]) => (c ?? 0) > 0)
            .map(([ty, c]) => (
              <div key={ty} className="flex items-center justify-between gap-2 text-xs">
                <span>
                  {c!.toLocaleString()} {ty}
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => unload(ty as TroopType, c!)}
                  title={t("formations.unload", "Stand down")}
                >
                  ← {t("formations.unload", "Stand down")}
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
