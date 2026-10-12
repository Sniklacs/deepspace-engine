// ARENA PANEL — the arena surface (design/arena-market.md Part I §§1–3).
// Bloodless mock battles on the real engine, consensual stakes bouts, the
// public ladder. Phone-first.
//
// OWNER RULES (unmistakable):
//   • The bout mode is NEVER subtle: PRACTICE (green/calm) vs STAKES (red,
//     troops die) is labeled in huge text everywhere it matters.
//   • Stakes apply ONLY when both sides toggle on — the UI shows the
//     DERIVED effective mode before anyone commits.
//   • Artifacts and heroes are never at risk in the arena, either mode.
import { useEffect, useMemo, useState } from "react";
import type { GameState } from "../game/types";
import type { GameResult } from "../game/api";
import {
  arenaAcceptFn,
  arenaCancelFn,
  arenaChallengeFn,
  arenaDeclineFn,
  arenaDirectoryFn,
  arenaLadderFn,
} from "../game/api";
import type { ArenaChallenge, ArenaLadderEntry, ArenaMode } from "../game/war/arena";
import { arenaModeLabel, arenaTitle } from "../game/war/arena";
import type { BattlePlan, PlannedManeuver } from "../game/war/maneuvers";
import { availableWeight } from "../game/war/troops";
import { snapshotHero } from "../game/prologue/act1-battle";
import { useT } from "./i18n/I18n";
import { Icon } from "./icons";
import { BattleSceneFullscreen } from "./BattleScene/BattleSceneFullscreen";
import { WarRoom, writeLastRun } from "./BattleScene/WarRoom";
import { buildDemoScene, type SceneBattle } from "../game/war/battle-scene-model";
import { crewFromHeroes } from "../game/war/battle-scene-ui-store";
import { buildFormationScene, clampLoadsToRoster, emptyWarRoomState, formationCount, type SavedFormation } from "../game/war/playbook";
import { warRoomDeleteFormationFn, warRoomSaveFormationFn, warRoomSetLockFn, allianceSaveDoctrineFn } from "../game/api";
import { allianceOf } from "../game/war/alliances";
import { leaderLevel } from "../game/leader-xp";
import { rosterCount } from "../game/war/troops";
import { battleSfx } from "../game/war/battle-sfx";

type Act = (fn: () => Promise<unknown>, label: string) => void;

type PresetId = "none" | "thrust" | "pincer" | "hammer";

function presetPlan(preset: Exclude<PresetId, "none">, pool: number): BattlePlan {
  const at = (pct: number) => Math.max(1, Math.round((pool * pct) / 100));
  const maneuvers: PlannedManeuver[] = [];
  if (preset === "thrust") {
    maneuvers.push({ id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: pool } });
  } else if (preset === "pincer") {
    maneuvers.push({ id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: at(60) } });
    maneuvers.push({ id: "m-fl", vector: "FLANK_LEFT", enterAtMin: 10, composition: { bulwark: at(20) } });
    maneuvers.push({ id: "m-fr", vector: "FLANK_RIGHT", enterAtMin: 10, composition: { bulwark: at(20) } });
  } else {
    maneuvers.push({ id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: at(50) } });
    maneuvers.push({ id: "m-rear", vector: "REAR", enterAtMin: 20, composition: { warden: at(50) } });
  }
  return { id: `arena-plan-${Date.now()}`, maneuvers };
}

/** The unmistakable mode banner — huge, color-coded, impossible to miss. */
export function ArenaModeBanner({ mode, compact = false }: { mode: ArenaMode; compact?: boolean }) {
  const t = useT();
  const stakes = mode === "stakes";
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={stakes ? "arena-mode-stakes" : "arena-mode-practice"}
      className={`flex items-center gap-3 rounded-xl border-2 px-4 ${compact ? "py-2" : "py-3"} ${
        stakes
          ? "border-red-500/80 bg-red-950/60"
          : "border-emerald-500/60 bg-emerald-950/40"
      }`}
    >
      <span className={compact ? "text-2xl" : "text-3xl"} aria-hidden="true">{stakes ? "⚔️" : "🕊️"}</span>
      <div>
        <p className={`${compact ? "text-sm" : "text-base"} font-black uppercase tracking-wide ${stakes ? "text-red-300" : "text-emerald-300"}`}>
          {stakes ? t("arena.stakesTitle", "STAKES — troops at risk") : t("arena.practiceTitle", "PRACTICE — no troop loss")}
        </p>
        <p className="text-xs text-zinc-300">
          {stakes
            ? t("arena.stakesBlurb", "Both sides agreed: troops die in this bout. Artifacts & heroes are still never at risk.")
            : t("arena.practiceBlurb", "Nobody dies. Everyone walks home. Test maneuvers and forge rolls freely.")}
        </p>
      </div>
    </div>
  );
}

/** The big stakes switch — labeled in plain words, not a subtle toggle. */
function StakesSwitch({ value, onChange, disabled = false }: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      data-testid="arena-stakes-switch"
      className={`flex w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left transition ${
        value
          ? "border-red-500 bg-red-950/50"
          : "border-zinc-600 bg-zinc-900/60 hover:border-zinc-500"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <span>
        <span className={`block text-sm font-black uppercase tracking-wide ${value ? "text-red-300" : "text-zinc-200"}`}>
          {value
            ? t("arena.stakesOn", "⚔️ STAKES ON — my troops are at risk")
            : t("arena.stakesOff", "🕊️ Practice — my troops are safe")}
        </span>
        <span className="block text-xs text-zinc-400">
          {value
            ? t("arena.stakesOnHint", "Troops die ONLY if the other side also flips this on.")
            : t("arena.stakesOffHint", "Flip this on to offer a real-stakes bout. Both sides must agree.")}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${value ? "bg-red-500" : "bg-zinc-600"}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${value ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}

function useArenaDirectory(token?: string) {
  const [colonies, setColonies] = useState<{ id: string; name: string; race: string }[]>([]);
  useEffect(() => {
    if (!token) return;
    let live = true;
    arenaDirectoryFn({ data: { token } }).then((res) => {
      if (live && res.ok && res.colonies) setColonies(res.colonies);
    }).catch(() => {});
    return () => { live = false; };
  }, [token]);
  return colonies;
}

function useArenaLadder(token?: string, refreshKey: number = 0) {
  const [ladder, setLadder] = useState<{ entries: ArenaLadderEntry[]; season: string; serverName: string } | null>(null);
  useEffect(() => {
    let live = true;
    arenaLadderFn({ data: { token } }).then((res) => {
      if (live && res.ok && res.entries) {
        setLadder({ entries: res.entries, season: res.season ?? "s1", serverName: res.serverName ?? "" });
      }
    }).catch(() => {});
    return () => { live = false; };
  }, [token, refreshKey]);
  return ladder;
}

function ChallengeForm({ state, token, directory, onDone }: {
  state: GameState;
  token?: string;
  directory: { id: string; name: string; race: string }[];
  onDone: () => void;
}) {
  const t = useT();
  const me = state.gameId ?? "";
  const spare = state.troops ? availableWeight(state.troops.home.roster) : 0;
  const heroes = useMemo(() => (state.prologue?.heroes ?? []).map((h) => ({
    id: h.id, name: h.name,
    snap: snapshotHero(h),
  })), [state]);
  const [oppId, setOppId] = useState("");
  const [troops, setTroops] = useState("");
  const [heroIds, setHeroIds] = useState<string[]>([]);
  const [preset, setPreset] = useState<PresetId>("thrust");
  const [stakes, setStakes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const opp = directory.find((c) => c.id === oppId) ?? null;
  const troopsN = Math.max(0, Math.trunc(Number(troops) || 0));

  async function submit() {
    if (!token || !opp || busy) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = heroes.filter((h) => heroIds.includes(h.id)).map((h) => h.snap);
      const plan = preset === "none" ? null : presetPlan(preset, Math.max(1, troopsN));
      const res = await arenaChallengeFn({
        data: {
          token,
          challengedId: opp.id,
          challengedName: opp.name,
          force: { troops: troopsN, heroes: chosen, weapons: [] },
          stakes,
          plan: plan ? {
            id: plan.id,
            maneuvers: plan.maneuvers.map((m) => ({
              id: m.id, vector: m.vector, enterAtMin: m.enterAtMin, composition: m.composition,
            })),
          } : null,
        },
      }) as GameResult;
      if (!res.ok) {
        setError(res.error || t("arena.challengeFailed", "The challenge didn't go out."));
      } else {
        onDone();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surf-2/40 p-4">
      <h4 className="text-sm font-semibold text-text-1">{t("arena.newChallenge", "Issue a challenge")}</h4>
      <label className="block text-xs text-text-2">
        {t("arena.opponent", "Opponent")}
        <select
          value={oppId}
          onChange={(e) => setOppId(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-surf-1 px-2 py-2 text-sm text-text-1"
          data-testid="arena-opponent"
        >
          <option value="">{t("arena.pickOpponent", "Pick a colony…")}</option>
          {directory.filter((c) => c.id !== me).map((c) => (
            <option key={c.id} value={c.id}>{c.name} · {c.race}</option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-text-2">
          {t("arena.troops", "Troops (weight)")} — {t("arena.spare", "{n} spare", { n: spare })}
          <input
            type="number" min={0} max={spare} value={troops}
            onChange={(e) => setTroops(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-surf-1 px-2 py-2 text-sm text-text-1"
            data-testid="arena-troops"
          />
        </label>
        <label className="block text-xs text-text-2">
          {t("arena.plan", "Battle plan")}
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as PresetId)}
            className="mt-1 w-full rounded-md border border-line bg-surf-1 px-2 py-2 text-sm text-text-1"
          >
            <option value="thrust">{t("arena.planThrust", "Main thrust")}</option>
            <option value="pincer">{t("arena.planPincer", "Pincer")}</option>
            <option value="hammer">{t("arena.planHammer", "Hammer & anvil")}</option>
            <option value="none">{t("arena.planNone", "No plan — straight fight")}</option>
          </select>
        </label>
      </div>
      {heroes.length > 0 && (
        <fieldset>
          <legend className="text-xs text-text-2">{t("arena.heroes", "Heroes (max 5 — proving ground: their artifacts ride along, zero risk)")}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {heroes.map((h) => (
              <label key={h.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${heroIds.includes(h.id) ? "border-ember text-ember-soft" : "border-line text-text-2"}`}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={heroIds.includes(h.id)}
                  onChange={() => setHeroIds((p) => p.includes(h.id) ? p.filter((x) => x !== h.id) : p.length < 5 ? [...p, h.id] : p)}
                />
                {h.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <StakesSwitch value={stakes} onChange={setStakes} />
      {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
      <button
        type="button"
        onClick={() => {
          if (busy) return;
          if (!opp) {
            setHint(t("arena.hintNoOpponent", "Pick an opponent first — choose who you're challenging."));
            return;
          }
          if (!troopsN && heroIds.length === 0) {
            setHint(t("arena.hintNoForce", "Bring troops or heroes — a challenge needs a force to fight with."));
            return;
          }
          setHint(null);
          submit();
        }}
        data-testid="arena-issue"
        className="w-full rounded-lg bg-ember px-4 py-2.5 text-sm font-bold text-black hover:brightness-110"
      >
        {busy ? t("arena.issuing", "Sending…") : t("arena.issue", "Issue the challenge")}
      </button>
      {hint && <p className="text-xs text-amber-200">{hint}</p>}
      <p className="text-[11px] text-text-3">
        {t("arena.lockNote", "Your troops lock the moment you challenge — they can't be spent while the proposal stands. Decline or expiry frees them.")}
      </p>
    </div>
  );
}

function IncomingCard({ c, state, token, onAction }: {
  c: ArenaChallenge; state: GameState; token?: string; onAction: Act;
}) {
  const t = useT();
  const spare = state.troops ? availableWeight(state.troops.home.roster) : 0;
  const heroes = useMemo(() => (state.prologue?.heroes ?? []).map((h) => ({
    id: h.id, name: h.name, snap: snapshotHero(h),
  })), [state]);
  const [open, setOpen] = useState(false);
  const [troops, setTroops] = useState("");
  const [heroIds, setHeroIds] = useState<string[]>([]);
  const [stakes, setStakes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const troopsN = Math.max(0, Math.trunc(Number(troops) || 0));
  const effective: ArenaMode = c.challengerStakes && stakes ? "stakes" : "bloodless";

  async function accept() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = heroes.filter((h) => heroIds.includes(h.id)).map((h) => h.snap);
      const res = await arenaAcceptFn({
        data: { token, challengeId: c.id, force: { troops: troopsN, heroes: chosen, weapons: [] }, stakes },
      }) as GameResult;
      if (!res.ok) setError(res.error || t("arena.acceptFailed", "Couldn't accept."));
      else setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-500/40 bg-surf-2/40 p-4" data-testid="arena-incoming">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-text-1">
            {t("arena.challengedBy", "{name} challenges you", { name: c.challengerName })}
          </p>
          <p className="text-xs text-text-2">
            {t("arena.brings", "Brings {t} troop weight{heroes}", {
              t: c.challengerForce.troops,
              heroes: c.challengerForce.heroSquad.length > 0 ? t("arena.withHeroes", " + {n} heroes", { n: c.challengerForce.heroSquad.length }) : "",
            })}
            {" · "}{new Date(c.expiresAt).toLocaleDateString()}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase ${c.challengerStakes ? "border-red-500 text-red-300" : "border-emerald-600 text-emerald-300"}`}>
          {c.challengerStakes ? t("arena.wantsStakes", "Wants stakes") : t("arena.wantsPractice", "Practice")}
        </span>
      </div>
      {!open ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button" onClick={() => setOpen(true)}
            className="flex-1 rounded-lg bg-ember px-3 py-2 text-sm font-bold text-black hover:brightness-110"
            data-testid="arena-accept-open"
          >
            {t("arena.answer", "Answer")}
          </button>
          <button
            type="button"
            onClick={() => token && onAction(() => arenaDeclineFn({ data: { token, challengeId: c.id } }), "decline")}
            className="rounded-lg border border-line px-3 py-2 text-sm text-text-2 hover:text-text-1"
            data-testid="arena-decline"
          >
            {t("arena.decline", "Decline")}
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <ArenaModeBanner mode={effective} compact />
          <p className="text-xs text-text-2">
            {t("arena.effectiveMode", "Effective mode: {mode}. {detail}", {
              mode: arenaModeLabel(effective),
              detail: effective === "stakes"
                ? t("arena.effectiveStakes", "You both flipped it on — troops die.")
                : t("arena.effectivePractice", "At least one side stays bloodless — nobody dies."),
            })}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-text-2">
              {t("arena.troops", "Troops (weight)")} — {spare} {t("arena.spareShort", "spare")}
              <input
                type="number" min={0} max={spare} value={troops}
                onChange={(e) => setTroops(e.target.value)}
                className="mt-1 w-full rounded-md border border-line bg-surf-1 px-2 py-2 text-sm text-text-1"
              />
            </label>
            <div className="text-xs text-text-2">
              <span className="mb-1 block">{t("arena.heroesShort", "Heroes (max 5)")}</span>
              <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
                {heroes.map((h) => (
                  <label key={h.id} className={`flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${heroIds.includes(h.id) ? "border-ember text-ember-soft" : "border-line text-text-3"}`}>
                    <input
                      type="checkbox" className="sr-only" checked={heroIds.includes(h.id)}
                      onChange={() => setHeroIds((p) => p.includes(h.id) ? p.filter((x) => x !== h.id) : p.length < 5 ? [...p, h.id] : p)}
                    />
                    {h.name}
                  </label>
                ))}
                {heroes.length === 0 && <span className="text-text-3">{t("arena.noHeroes", "No heroes yet.")}</span>}
              </div>
            </div>
          </div>
          <StakesSwitch value={stakes} onChange={setStakes} />
          {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (busy) return;
                if (!troopsN && heroIds.length === 0) {
                  setHint(t("arena.hintNoForce", "Bring troops or heroes — a challenge needs a force to fight with."));
                  return;
                }
                setHint(null);
                accept();
              }}
              data-testid="arena-accept-confirm"
              className="flex-1 rounded-lg bg-ember px-3 py-2 text-sm font-bold text-black hover:brightness-110"
            >
              {busy ? t("arena.accepting", "Marching…") : effective === "stakes"
                ? t("arena.acceptStakes", "Accept — TO BATTLE, troops at risk")
                : t("arena.acceptPractice", "Accept — practice bout")}
            </button>
            <button
              type="button" onClick={() => setOpen(false)}
              className="rounded-lg border border-line px-3 py-2 text-sm text-text-2"
            >
              {t("arena.back", "Back")}
            </button>
          </div>
          {hint && <p className="text-xs text-amber-200">{hint}</p>}
        </div>
      )}
    </div>
  );
}

export default function ArenaPanel({ state, token, onAction }: {
  state: GameState;
  token?: string;
  onAction: Act;
}) {
  const t = useT();
  const me = state.gameId ?? "";
  const directory = useArenaDirectory(token);
  const [ladderTick, setLadderTick] = useState(0);
  const ladder = useArenaLadder(token, ladderTick);
  const [showForm, setShowForm] = useState(false);
  const [showScene, setShowScene] = useState(false);
  // WAR ROOM (owner 2026-10-06): the formation library + arena workbench.
  // Deploy-my-loadout now launches from the war room's Deploy tab —
  // quick-pick of locked-down formations (+ last run). Bloodless: deploying
  // never musters, moves, or loses troops.
  const [showWarRoom, setShowWarRoom] = useState(false);
  const [deployScene, setDeployScene] = useState<SceneBattle | null>(null);
  const roster = state.troops?.home.roster ?? null;
  const rosterSize = roster ? rosterCount(roster) : 0;
  const warRoom = state.warRoom ?? emptyWarRoomState();
  const myLeaderLevel = Math.max(
    1,
    ...state.leaders.filter((l) => l.status === "active").map((l) => leaderLevel(l)),
  );

  /** Launch a formation onto the field (bloodless practice). */
  const launchFormation = (formation: SavedFormation, grade: Parameters<typeof buildFormationScene>[2]) => {
    if (!roster) return;
    const clamped: SavedFormation = { ...formation, loads: clampLoadsToRoster(formation.loads, roster) };
    if (formationCount(clamped) === 0) return;
    battleSfx.attach(); // user gesture — wake the war
    setDeployScene(
      buildFormationScene(clamped, { attackerName: me || "Warlord", nowMs: Date.now() }, grade),
    );
    writeLastRun(state.gameId ?? me, {
      name: clamped.name,
      playId: clamped.playId,
      loads: clamped.loads,
      slotMeta: clamped.slotMeta,
      grade: grade ?? 3,
      at: Date.now(),
    });
    setShowWarRoom(false);
  };
  const challenges = useMemo(() => state.arenaChallenges ?? [], [state]);
  const bouts = useMemo(() => state.arenaBouts ?? [], [state]);

  const incoming = challenges.filter((c) => c.challengedId === me && c.state === "proposed");
  const outgoing = challenges.filter((c) => c.challengerId === me && (c.state === "proposed" || c.state === "accepted" || c.state === "active"));
  const recent = [...bouts].sort((a, b) => b.at - a.at).slice(0, 8);

  return (
    <section aria-label={t("arena.title", "The Arena")} className="space-y-4 rounded-xl border border-line bg-surf-1/60 p-4" data-testid="arena-panel">
      <div className="relative overflow-hidden rounded-xl border border-line">
        <img src="/art/battles/battle-siege.webp" alt="" aria-hidden="true" loading="lazy"
          className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07070c] via-[#07070c]/60 to-[#07070c]/20" />
        <div className="relative p-4">
          <h3 className="flex items-center gap-2 text-lg font-bold text-white">
            <Icon name="sword" size={20} /> {t("arena.title", "The Arena")}
          </h3>
          <p className="mt-1 max-w-xl text-xs text-zinc-300">
            {t("arena.intro", "Bloodless mock battles on the real engine — practice maneuvers, test forge rolls, climb the ladder. Flip the stakes switch for real troop loss, but only ever by mutual agreement.")}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ArenaModeBanner mode="bloodless" compact />
        <ArenaModeBanner mode="stakes" compact />
      </div>

      {/* PROVING GROUND (owner 2026-10-05): the 2D battle scene lives on the
          Arena tab — the arena is bloodless mock battles on the real engine,
          so the practice scene belongs here, one tap away, not behind the
          war-gated Battles tab. Observe-only in P1. */}
      <div className="rounded-xl border border-line bg-surf-1/60 p-4" data-testid="arena-proving-ground">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-text-1">
              {t("arena.provingGround", "🎬 Proving ground")}
            </h4>
            <p className="mt-0.5 text-xs text-text-3">
              {t(
                "arena.provingGroundBlurb",
                "Watch a practice battle play out on the real engine — approach, touchdown, first contact, weapons free. Observe only.",
              )}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              battleSfx.attach(); // user gesture — wake the war so the approach stinger lands
              setDeployScene(null);
              setShowScene((s) => !s);
            }}
            data-testid="arena-watch-scene"
            className="shrink-0 rounded-lg border border-amber-400/40 bg-black/60 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-amber-200 hover:bg-black/80"
          >
            {showScene
              ? t("arena.hideScene", "Hide scene")
              : t("arena.watchScene", "Watch practice battle")}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowScene(false);
              setDeployScene(null);
              setShowWarRoom((s) => !s);
            }}
            disabled={!roster || rosterSize === 0}
            title={!roster || rosterSize === 0 ? "Muster troops in the Barracks first" : undefined}
            data-testid="arena-war-room"
            className="shrink-0 rounded-lg border border-amber-400/40 bg-black/60 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-amber-200 hover:bg-black/80 disabled:opacity-40"
          >
            🛡️ War Room
          </button>
          </div>
        </div>
        {showWarRoom && roster && (
          <WarRoom
            roster={roster}
            warRoom={warRoom}
            leaderLevel={myLeaderLevel}
            gameId={state.gameId ?? me}
            raceId={state.race}
            onClose={() => setShowWarRoom(false)}
            onSaveFormation={(draft) =>
              onAction(
                () =>
                  warRoomSaveFormationFn({
                    data: {
                      token: token!,
                      id: draft.id,
                      name: draft.name,
                      playId: draft.playId,
                      loads: draft.loads as Record<string, { type: string; tier: number; count: number }[]>,
                      slotMeta: draft.slotMeta as Record<string, { name?: string }> | undefined,
                      replayId: draft.replayId,
                      locked: draft.locked,
                    },
                  }),
                "war room",
              )
            }
            onDeleteFormation={(id) =>
              onAction(() => warRoomDeleteFormationFn({ data: { token: token!, id } }), "war room")
            }
            onToggleLock={(id, locked) =>
              onAction(() => warRoomSetLockFn({ data: { token: token!, id, locked } }), "war room")
            }
            onDeployFormation={(formation, grade) => launchFormation(formation, grade)}
          />
        )}
        {deployScene && (() => {
          const alliance = me ? allianceOf(state, me) : null;
          return (
          <BattleSceneFullscreen
            scene={deployScene}
            crew={crewFromHeroes(state.prologue?.heroes)}
            onClose={() => { setDeployScene(null); }}
            onSaveFormation={(draft) =>
              onAction(
                () =>
                  warRoomSaveFormationFn({
                    data: {
                      token: token!,
                      name: draft.name,
                      playId: draft.playId,
                      loads: draft.loads as Record<string, { type: string; tier: number; count: number }[]>,
                      slotMeta: draft.slotMeta as Record<string, { name?: string }> | undefined,
                      replayId: draft.replayId,
                      locked: true,
                    },
                  }),
                "war room",
              )
            }
            onSaveDoctrine={(draft) =>
              onAction(
                () =>
                  allianceSaveDoctrineFn({
                    data: {
                      token: token!,
                      allianceId: alliance?.id ?? "",
                      name: draft.name,
                      playId: draft.playId,
                      loads: draft.loads as Record<string, { type: string; tier: number; count: number }[]>,
                      slotMeta: draft.slotMeta as Record<string, { name?: string }> | undefined,
                      replay: draft.replay,
                      battleName: draft.battleName,
                      victor: draft.victor,
                      durationS: draft.durationS,
                      killsAttacker: draft.killsAttacker,
                      killsDefender: draft.killsDefender,
                    },
                  }),
                "doctrine",
              )
            }
          />
          );
        })()}
        {showScene && (
          <BattleSceneFullscreen scene={buildDemoScene(Date.now())} onClose={() => setShowScene(false)} crew={crewFromHeroes(state.prologue?.heroes)} />
        )}
      </div>

      {incoming.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-text-1">{t("arena.incoming", "Incoming challenges ({n})", { n: incoming.length })}</h4>
          {incoming.map((c) => (
            <IncomingCard key={c.id} c={c} state={state} token={token} onAction={onAction} />
          ))}
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-text-1">{t("arena.outgoing", "Your open challenges")}</h4>
          {outgoing.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surf-2/40 px-3 py-2">
              <div className="text-xs text-text-2">
                <span className="font-semibold text-text-1">{c.challengedName}</span>
                {" · "}{c.state === "active" ? t("arena.fighting", "fighting now") : c.state === "accepted" ? t("arena.mustering", "mustering…") : t("arena.waiting", "waiting")}
                {" · "}{c.challengerStakes ? t("arena.youStakes", "you offered stakes") : t("arena.youPractice", "you offered practice")}
              </div>
              {c.state === "proposed" && (
                <button
                  type="button"
                  onClick={() => token && onAction(() => arenaCancelFn({ data: { token, challengeId: c.id } }), "cancel")}
                  className="rounded-md border border-line px-2 py-1 text-xs text-text-2 hover:text-text-1"
                >
                  {t("arena.cancel", "Cancel")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!showForm ? (
        <button
          type="button" onClick={() => setShowForm(true)}
          className="w-full rounded-lg border-2 border-dashed border-line px-4 py-3 text-sm font-semibold text-text-2 hover:border-ember hover:text-text-1"
          data-testid="arena-new"
        >
          {t("arena.newChallengeCta", "+ Issue a challenge")}
        </button>
      ) : (
        <ChallengeForm
          state={state} token={token} directory={directory}
          onDone={() => { setShowForm(false); }}
        />
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-text-1">
            {t("arena.ladder", "Ladder{season}", { season: ladder ? ` — ${ladder.season}` : "" })}
          </h4>
          <button
            type="button" onClick={() => setLadderTick((x) => x + 1)}
            className="rounded-md border border-line px-2 py-1 text-xs text-text-2 hover:text-text-1"
          >
            {t("arena.refresh", "Refresh")}
          </button>
        </div>
        {!ladder ? (
          <p className="text-xs text-text-3">{t("arena.ladderLoading", "Reading the standings…")}</p>
        ) : ladder.entries.length === 0 ? (
          <p className="text-xs text-text-3">
            {t("arena.ladderEmpty", "No bouts yet this season. The first legend of the ladder is still unwritten — issue a challenge.")}
          </p>
        ) : (
          <ol className="space-y-1.5">
            {ladder.entries.slice(0, 25).map((e, i) => {
              const title = arenaTitle(i + 1, ladder.serverName);
              const isMe = e.colonyId === me;
              return (
                <li
                  key={e.colonyId}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${isMe ? "border-ember/60 bg-ember/5" : "border-line bg-surf-2/40"}`}
                >
                  <span className="w-7 shrink-0 text-center text-sm font-black text-text-2">#{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-1">
                      {e.colonyName}
                      {title && <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-300">{title}</span>}
                    </p>
                    <p className="text-[11px] text-text-3">
                      {t("arena.record", "{w}W–{l}L{draws}", { w: e.wins, l: e.losses, draws: e.draws > 0 ? `–${e.draws}D` : "" })}
                      {e.stakesWins + e.stakesLosses > 0 && (
                        <span className="text-red-300/90">
                          {" · "}{t("arena.stakesRecord", "{w}W–{l}L hardcore", { w: e.stakesWins, l: e.stakesLosses })}
                        </span>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-2 text-[11px] text-text-3">
          {t("arena.ladderNote", "Seasonal titles are cosmetic — bragging rights only. The ladder resets each season.")}
        </p>
      </div>

      {recent.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-text-1">{t("arena.recent", "Your recent bouts")}</h4>
          <ul className="space-y-1.5">
            {recent.map((b) => {
              const won = b.winnerId === me;
              const lost = b.winnerId !== null && b.winnerId !== me;
              const foe = b.aId === me ? b.bName : b.aName;
              return (
                <li key={b.boutId} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surf-2/40 px-3 py-2 text-xs">
                  <span className="text-text-2">
                    {t("arena.vs", "vs {name}", { name: foe })}
                    {" · "}<span className={b.mode === "stakes" ? "font-bold text-red-300" : "text-emerald-300"}>
                      {b.mode === "stakes" ? t("arena.modeStakesShort", "STAKES") : t("arena.modePracticeShort", "practice")}
                    </span>
                  </span>
                  <span className={`font-bold uppercase ${won ? "text-emerald-300" : lost ? "text-red-300" : "text-text-3"}`}>
                    {won ? t("arena.won", "Won") : lost ? t("arena.lost", "Lost") : t("arena.drew", "Draw")}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
