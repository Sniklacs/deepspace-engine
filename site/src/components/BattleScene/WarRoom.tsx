// WAR ROOM — the commander's formation library (owner 2026-10-06).
//
// "This is why the formation is so important and that's why we are going
// to be doing in our war room." Its own view with its own header:
//   DEPLOY — quick-pick: ONLY locked-down war room formations (+ the last
//     formation ran, one-tap). If it isn't locked down here, it isn't
//     selectable. Grade dial, then launch.
//   PLAYBOOK — plays by category (Offensive / Defensive / Mixed),
//     level-gated; "Build" opens the arena workbench pre-loaded.
//   FORMATIONS — every formation (playbook-built and custom): view,
//     one-tap load, edit, lock down, delete. The home shelf.
//   BUILDER — the arena workbench: start from any play or blank, customize
//     freely, test in battle right there, save in war room.
//
// Reachable from the Arena for now; structured to dock into a dedicated
// war room page later. (War-room art — chalkboards, X's and O's, doctrine
// on the walls — is queued after the functional build.)

import { useMemo, useState } from "react";
import {
  PLAYBOOK,
  autoloadSuggested,
  clampLoadsToRoster,
  deficitHeadline,
  entryLabel,
  formationCount,
  formationPicks,
  formationSlots,
  playById,
  playsForLevel,
  suggestedComposition,
  type AutoloadResult,
  type Play,
  type PlayCategory,
  type SavedFormation,
  type SlotLoads,
  type WarRoomState,
} from "../../game/war/playbook";
import {
  CHORUS_GRADES,
  DEFAULT_CHORUS_GRADE,
  picksCount,
  picksPower,
  picksReverb,
  previewGarrisonReverb,
  type ChorusGrade,
} from "../../game/war/deploy-loadout";
import { TROOP_TYPES, label as troopLabel, type TroopRoster } from "../../game/war/troops";
import { FormationDiagram } from "./FormationDiagram";
import { FormationBuilder, type BuilderSeed } from "./FormationBuilder";

const TABS = ["Deploy", "Playbook", "Formations", "Builder"] as const;
type Tab = (typeof TABS)[number];

const GRADES: ChorusGrade[] = [1, 2, 3, 4, 5];
const CATEGORIES: PlayCategory[] = ["Offensive", "Defensive", "Mixed"];

/** Last formation ran — one-tap re-deploy. Device-local, per game. */
export interface LastRun {
  name: string;
  playId: string;
  loads: SlotLoads;
  slotMeta?: SavedFormation["slotMeta"];
  grade: ChorusGrade;
  at: number;
}
const lastRunKey = (gameId: string) => `warroom.lastrun.${gameId}`;
export function readLastRun(gameId: string): LastRun | null {
  try {
    const raw = localStorage.getItem(lastRunKey(gameId));
    if (!raw) return null;
    const r = JSON.parse(raw) as LastRun;
    if (!r || typeof r.name !== "string" || !r.loads) return null;
    return r;
  } catch {
    return null;
  }
}
export function writeLastRun(gameId: string, r: LastRun): void {
  try {
    localStorage.setItem(lastRunKey(gameId), JSON.stringify(r));
  } catch {
    /* private mode — the run just won't persist */
  }
}

export interface WarRoomProps {
  roster: TroopRoster;
  warRoom: WarRoomState;
  leaderLevel: number;
  gameId: string;
  onSaveFormation: (draft: { id?: string; name: string; playId: string; loads: SlotLoads; slotMeta?: SavedFormation["slotMeta"]; locked: boolean }) => void;
  onDeleteFormation: (id: string) => void;
  onToggleLock: (id: string, locked: boolean) => void;
  onDeployFormation: (formation: SavedFormation, grade: ChorusGrade) => void;
  onClose: () => void;
}

function powerOf(f: SavedFormation): number {
  return picksPower(formationPicks(f));
}

function GradeDial({ grade, setGrade, myReverb, foeReverb }: { grade: ChorusGrade; setGrade: (g: ChorusGrade) => void; myReverb: number; foeReverb: number }) {
  const spec = CHORUS_GRADES[grade];
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Chorus defense</span>
        <span className="text-[11px] text-zinc-500">
          You <b className="text-amber-200">{myReverb.toLocaleString()}</b> vs <b className="text-rose-300">{foeReverb.toLocaleString()}</b> reverb
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Chorus defense grade">
        {GRADES.map((g) => {
          const s = CHORUS_GRADES[g];
          const active = g === grade;
          return (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setGrade(g)}
              data-testid={`warroom-grade-${g}`}
              className={`rounded-md border px-1 py-1.5 text-center ${active ? (g >= 4 ? "border-rose-400/70 bg-rose-500/15" : "border-amber-400/70 bg-amber-500/15") : "border-zinc-800 bg-zinc-900/60"}`}
            >
              <div className={`text-[11px] font-bold ${active ? "text-white" : "text-zinc-400"}`}>G{g}</div>
              <div className={`text-[10px] ${active ? "text-zinc-200" : "text-zinc-500"}`}>{s.name}</div>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-zinc-400">{spec.blurb}</p>
      {spec.hint && <p className="mt-0.5 text-[11px] font-semibold text-rose-300">{spec.hint}</p>}
    </div>
  );
}

export function WarRoom({ roster, warRoom, leaderLevel, gameId, onSaveFormation, onDeleteFormation, onToggleLock, onDeployFormation, onClose }: WarRoomProps) {
  const [tab, setTab] = useState<Tab>("Deploy");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [suggestedPickId, setSuggestedPickId] = useState<string | null>(null);
  const [lastRunPick, setLastRunPick] = useState(false);
  const [grade, setGrade] = useState<ChorusGrade>(DEFAULT_CHORUS_GRADE);
  const [lastRun, setLastRun] = useState<LastRun | null>(() => readLastRun(gameId));
  const [viewId, setViewId] = useState<string | null>(null);
  const [builderSeed, setBuilderSeed] = useState<BuilderSeed>({ playId: "mixed-wedge" });
  const [builderKey, setBuilderKey] = useState(0);

  const locked = useMemo(() => warRoom.formations.filter((f) => f.locked), [warRoom]);
  const selected = locked.find((f) => f.id === selectedId) ?? null;

  // Suggested loads, auto-filled from the live roster (recomputed when the
  // roster changes). Unlocked plays only — a locked play's suggestion stays
  // locked with it.
  const suggestedAutos = useMemo(() => {
    const m = new Map<string, AutoloadResult>();
    for (const p of PLAYBOOK) m.set(p.id, autoloadSuggested(p, roster));
    return m;
  }, [roster]);
  const suggestedPlays = useMemo(() => playsForLevel(leaderLevel).filter((a) => !a.locked), [leaderLevel]);
  const suggestedSelPlay: Play | null =
    suggestedPickId && suggestedPlays.some((a) => a.play.id === suggestedPickId)
      ? playById(suggestedPickId) ?? null
      : null;
  const suggestedAuto: AutoloadResult | null = suggestedSelPlay ? suggestedAutos.get(suggestedSelPlay.id) ?? null : null;

  const deployFormation: SavedFormation | null = lastRunPick && lastRun
    ? { id: "lastrun", name: lastRun.name, playId: lastRun.playId, locked: false, loads: lastRun.loads, slotMeta: lastRun.slotMeta, createdAt: lastRun.at, updatedAt: lastRun.at }
    : suggestedSelPlay
      ? { id: `suggested-${suggestedSelPlay.id}`, name: `${suggestedSelPlay.name} — Suggested`, playId: suggestedSelPlay.id, locked: false, loads: suggestedAuto?.loads ?? {}, createdAt: 0, updatedAt: 0 }
      : selected;

  const deployPicks = deployFormation ? formationPicks(deployFormation) : [];
  const myReverb = picksReverb(deployPicks);
  const foeReverb = deployPicks.length > 0 ? previewGarrisonReverb(deployPicks, grade) : 0;

  const openBuilder = (seed: BuilderSeed) => {
    setBuilderSeed(seed);
    setBuilderKey((k) => k + 1);
    setTab("Builder");
  };

  const deploy = () => {
    if (!deployFormation) return;
    const clamped: SavedFormation = { ...deployFormation, loads: clampLoadsToRoster(deployFormation.loads, roster) };
    if (formationCount(clamped) === 0) return;
    onDeployFormation(clamped, grade);
    const lr: LastRun = { name: clamped.name, playId: clamped.playId, loads: clamped.loads, slotMeta: clamped.slotMeta, grade, at: Date.now() };
    writeLastRun(gameId, lr);
    setLastRun(lr);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#0b0e14]/98 backdrop-blur"
      role="dialog"
      aria-label="War room"
      data-testid="war-room"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* header — its own room, its own header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <h2 className="text-base font-extrabold tracking-wide text-amber-200">🛡️ WAR ROOM</h2>
          <p className="text-[11px] text-zinc-500">Formations are built here. Battles are won out there.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close war room"
          data-testid="warroom-close"
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
        >
          ✕
        </button>
      </div>

      {/* tabs */}
      <div className="flex gap-1 border-b border-white/10 px-3 pt-2" role="tablist" aria-label="War room sections">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            data-testid={`warroom-tab-${t}`}
            className={`rounded-t-lg px-3 py-2 text-xs font-bold uppercase tracking-wider ${tab === t ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            {t}
            {t === "Formations" && warRoom.formations.length > 0 && (
              <span className="ml-1 rounded-full bg-zinc-700 px-1.5 text-[10px]">{warRoom.formations.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tab === "Deploy" && (
          <div className="space-y-3" data-testid="warroom-deploy">
            <p className="text-[11px] text-zinc-500">
              Run a <b className="text-zinc-300">suggested load</b> in one tap, or a formation you've <b className="text-zinc-300">locked down</b>. <b className="text-zinc-300">Last run</b> is always one tap away.
            </p>
            {lastRun && (
              <button
                type="button"
                onClick={() => { setLastRunPick(true); setSelectedId(null); setSuggestedPickId(null); }}
                data-testid="warroom-lastrun"
                className={`w-full rounded-xl border p-3 text-left ${lastRunPick ? "border-cyan-400/70 bg-cyan-500/10" : "border-zinc-800 bg-zinc-900/50"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">🕘 Last run — {lastRun.name}</span>
                  <span className="text-[11px] text-zinc-500">G{lastRun.grade}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {playById(lastRun.playId)?.name ?? "Custom"} · {picksCount(Object.values(lastRun.loads).flat())} troops
                </p>
              </button>
            )}
            {/* Suggested — the playbook's ready-made loads, one tap. */}
            <div data-testid="warroom-suggested-group">
              <h3 className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.2em] text-zinc-400">📋 Suggested — from the playbook</h3>
              <p className="mb-2 text-[11px] text-zinc-500">Ready-made loads filled from your roster. Run them as-is — build your own in the Builder when you're ready.</p>
              <div className="space-y-2">
                {suggestedPlays.map(({ play: p }) => {
                  const auto = suggestedAutos.get(p.id);
                  const active = suggestedSelPlay?.id === p.id && !lastRunPick;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setSuggestedPickId(p.id); setSelectedId(null); setLastRunPick(false); }}
                      data-testid={`warroom-suggested-${p.id}`}
                      aria-pressed={active}
                      className={`w-full rounded-xl border p-3 text-left ${active ? "border-emerald-400/70 bg-emerald-500/10" : "border-zinc-800 bg-zinc-900/50"}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">▶ {p.name} — Suggested</span>
                        <span className="text-[11px] text-zinc-500">
                          {auto ? `${auto.loadedTotal}${auto.scaled ? `/${auto.suggestedTotal}` : ""} troops` : ""}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {p.category} · {playById(p.id)?.slots.length ?? 0} slots
                        {auto?.scaled ? " · scaled to your roster" : ""}
                      </p>
                    </button>
                  );
                })}
              </div>
              {suggestedSelPlay && suggestedAuto && (
                <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
                  <p className="text-[11px] text-zinc-400">
                    <b className="text-zinc-200">{suggestedSelPlay.name} — Suggested</b> fields{" "}
                    <b className="text-zinc-200">{suggestedAuto.loadedTotal}</b> of {suggestedAuto.suggestedTotal} suggested troops from your roster.
                  </p>
                  {suggestedAuto.scaled ? (
                    <div className="mt-1 space-y-0.5">
                      <p className="text-[11px] font-semibold text-amber-200">
                        Scaled to your roster — {deficitHeadline(suggestedAuto.deficits)} for the full play.
                      </p>
                      {suggestedAuto.deficits.slice(0, 4).map((d) => (
                        <p key={`${d.slotId}-${d.type}`} className="text-[11px] text-zinc-500">
                          {d.slotName}: need +{d.missing} {troopLabel(d.type)}{d.missing === 1 ? "" : "s"}
                        </p>
                      ))}
                      {suggestedAuto.deficits.length > 4 && (
                        <p className="text-[11px] text-zinc-600">+{suggestedAuto.deficits.length - 4} more shortfalls — muster to fill the play.</p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-emerald-200">Your roster fields the full play. ⚔️</p>
                  )}
                </div>
              )}
            </div>
            {/* Your locked formations — the locked-only quick-pick rule. */}
            <div>
              <h3 className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-zinc-400">🔒 Your locked formations</h3>
              {locked.length === 0 && (
                <div className="rounded-xl border border-dashed border-zinc-700 p-4 text-center">
                  <p className="text-xs text-zinc-400">No locked-down formations yet — suggested loads deploy right now. Save your own from a run, or build one.</p>
                  <button
                    type="button"
                    onClick={() => openBuilder({ playId: "mixed-wedge" })}
                    className="mt-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black"
                  >
                    Build your first
                  </button>
                </div>
              )}
              <div className="space-y-2">
                {locked.map((f) => {
                  const active = selectedId === f.id && !lastRunPick && !suggestedSelPlay;
                  const n = formationCount(f);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => { setSelectedId(f.id); setLastRunPick(false); setSuggestedPickId(null); }}
                      data-testid={`warroom-deploy-${f.id}`}
                      aria-pressed={active}
                      className={`w-full rounded-xl border p-3 text-left ${active ? "border-amber-400/70 bg-amber-500/10" : "border-zinc-800 bg-zinc-900/50"}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">🔒 {f.name}</span>
                        <span className="text-[11px] text-zinc-500">{n} troops · ⚡{Math.round(powerOf(f)).toLocaleString()}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-zinc-500">{playById(f.playId)?.name ?? "Custom formation"}</p>
                    </button>
                  );
                })}
              </div>
            </div>
            {deployFormation && (
              <GradeDial grade={grade} setGrade={setGrade} myReverb={myReverb} foeReverb={foeReverb} />
            )}
            <button
              type="button"
              onClick={deploy}
              disabled={!deployFormation}
              data-testid="warroom-deploy-confirm"
              className="w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold uppercase tracking-wider text-black disabled:opacity-40"
            >
              Deploy {deployFormation ? `— ${deployFormation.name}` : ""}
            </button>
            <p className="text-center text-[11px] text-zinc-600">🕊️ Practice deployment — no troops lost, your roster is untouched.</p>
          </div>
        )}

        {tab === "Playbook" && (
          <div className="space-y-4" data-testid="warroom-playbook">
            <p className="text-[11px] text-zinc-500">
              Your leader is level <b className="text-amber-200">{leaderLevel}</b>. Locked plays show what they need.
            </p>
            {CATEGORIES.map((cat) => (
              <div key={cat}>
                <h3 className="mb-2 text-xs font-extrabold uppercase tracking-[0.2em] text-zinc-300">{cat}</h3>
                <div className="space-y-2">
                  {PLAYBOOK.filter((p) => p.category === cat).map((p) => {
                    const lockedPlay = leaderLevel < p.minLeaderLevel;
                    const comp = suggestedComposition(p);
                    return (
                      <div key={p.id} className={`rounded-xl border p-3 ${lockedPlay ? "border-zinc-800 bg-zinc-900/40 opacity-80" : "border-zinc-800 bg-zinc-900/60"}`} data-testid={`playbook-play-${p.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold text-white">
                              {lockedPlay ? `🔒 ${p.name}` : p.name}
                              <span className="ml-2 text-[10px] font-normal text-zinc-500">L{p.minLeaderLevel}+</span>
                            </p>
                            <p className="mt-0.5 text-[11px] text-zinc-400">{p.blurb}</p>
                            <p className="mt-1 text-[10px] text-zinc-500">
                              {p.slots.length} slots · {p.slots.filter((s) => s.entry.kind === "oncall").length} on-call
                            </p>
                            <p className="mt-1 text-[10px] text-zinc-500" data-testid={`playbook-suggested-comp-${p.id}`}>
                              Suggested load: <b className="text-zinc-300">{comp.total} troops</b> —{" "}
                              {TROOP_TYPES.filter((t) => comp.byType[t] > 0)
                                .map((t) => `${comp.byType[t]} ${troopLabel(t)}`)
                                .join(" · ")}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={lockedPlay}
                            title={lockedPlay ? `Requires leader level ${p.minLeaderLevel}` : `Build from ${p.name}`}
                            onClick={() => openBuilder({ playId: p.id })}
                            data-testid={`playbook-build-${p.id}`}
                            className="shrink-0 rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-200 disabled:opacity-40"
                          >
                            {lockedPlay ? `L${p.minLeaderLevel}` : "Build"}
                          </button>
                        </div>
                        <div className="mt-2">
                          <FormationDiagram play={p} loads={{}} compact />
                        </div>
                        <button
                          type="button"
                          disabled={lockedPlay}
                          title={lockedPlay ? `Requires leader level ${p.minLeaderLevel}` : `Deploy ${p.name} with the suggested load`}
                          onClick={() => { setSuggestedPickId(p.id); setSelectedId(null); setLastRunPick(false); setTab("Deploy"); }}
                          data-testid={`playbook-suggested-${p.id}`}
                          className="mt-2 w-full rounded-lg bg-emerald-500 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-black disabled:opacity-40"
                        >
                          {lockedPlay ? `🔒 Suggested load — L${p.minLeaderLevel}` : "▶ Use suggested load"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "Formations" && (
          <div className="space-y-2" data-testid="warroom-formations">
            <p className="text-[11px] text-zinc-500">The home shelf — every formation, playbook-built or custom. Only 🔒 locked ones deploy.</p>
            {warRoom.formations.length === 0 && (
              <p className="rounded-xl border border-dashed border-zinc-700 p-4 text-center text-xs text-zinc-400">
                Empty shelf. Build in the Builder tab, then lock it down.
              </p>
            )}
            {warRoom.formations.map((f) => (
              <div key={f.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3" data-testid={`formation-row-${f.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-white">
                      {f.locked ? "🔒 " : "✏️ "}{f.name}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      {playById(f.playId)?.name ?? "Custom"} · {formationCount(f)} troops · ⚡{Math.round(powerOf(f)).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => setViewId(viewId === f.id ? null : f.id)} aria-label={`View ${f.name}`} title="View" className="rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300">👁</button>
                    <button
                      type="button"
                      onClick={() => { setSelectedId(f.locked ? f.id : null); setLastRunPick(false); setSuggestedPickId(null); if (f.locked) setTab("Deploy"); else openBuilder({ playId: f.playId, loads: f.loads, slotMeta: f.slotMeta, name: f.name, editingId: f.id }); }}
                      aria-label={f.locked ? `Load ${f.name} for deploy` : `Edit ${f.name}`}
                      title={f.locked ? "One-tap load for deploy" : "Edit in builder"}
                      className="rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300"
                    >
                      {f.locked ? "⚡" : "✏️"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleLock(f.id, !f.locked)}
                      aria-label={f.locked ? `Unlock ${f.name}` : `Lock down ${f.name}`}
                      title={f.locked ? "Unlock" : "Lock down"}
                      data-testid={`formation-lock-${f.id}`}
                      className="rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300"
                    >
                      {f.locked ? "🔓" : "🔒"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { if (window.confirm(`Delete "${f.name}"?`)) onDeleteFormation(f.id); }}
                      aria-label={`Delete ${f.name}`}
                      title="Delete"
                      className="rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 hover:border-rose-500/60 hover:text-rose-300"
                    >
                      🗑
                    </button>
                  </div>
                </div>
                {viewId === f.id && (
                  <div className="mt-2">
                    <FormationDiagram play={playById(f.playId) ?? null} formation={f} loads={f.loads} compact />
                    <div className="mt-1.5 space-y-0.5">
                      {formationSlots(f).map((s) => {
                        const picks = f.loads[s.id] ?? [];
                        if (picks.length === 0) return null;
                        return (
                          <p key={s.id} className="text-[11px] text-zinc-400">
                            <b className="text-zinc-200">{s.name}</b> · {picks.map((p) => `${p.count}× ${p.type} T${p.tier}`).join(", ")} · {entryLabel(s.entry)}
                          </p>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "Builder" && (
          <div data-testid="warroom-builder">
            <FormationBuilder
              key={builderKey}
              roster={roster}
              leaderLevel={leaderLevel}
              seed={builderSeed}
              onTest={(formation, g) => onDeployFormation(formation, g)}
              onSave={(draft) => {
                onSaveFormation(draft);
                setTab("Formations");
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
