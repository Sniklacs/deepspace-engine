// Research Tree + Leaders Roster views for the Lab tab (knowledge track).
// Leaders now carry the earned XP/leveling layer (V3): square-root curve, one
// attribute point per level, and the one-time Level-3 specialization choice —
// Scholar / Marshal / Quartermaster. All progression is earned through events, never
// purchasable. Mobile-first: modals use the `fixed inset-0 … flex items-start
// justify-center overflow-y-auto` pattern so nothing clips on short screens,
// and the Tooltip long-press/double-tap fix is untouched.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DOMAINS, domainText } from "../game/zones";
import { engineHelpers } from "../game/client-utils";
import { generateAtlas, nodeById } from "../game/map";
import { WORLD_CONFIG_PUBLIC } from "../game/world-config";
import { coveredNodeIds, satelliteStage, satelliteIntelFor, satelliteTechId, satelliteTechFor } from "../game/satellites";
import { SATELLITE_COLORS } from "../game/circuit-tokens";
import { useT } from "./i18n/I18n";
import { fmtDuration } from "../game/i18n/format";
import { Bdi } from "./ui/Bdi";
import { sound } from "../game/sound";
import { Tooltip } from "./Tooltip";
import { tipT, LAB_TIPS } from "../game/tooltips";
import type { GameState, Leader } from "../game/types";
import { TECH_TREE, SPECIALTY_LABEL, SPECIALTY_DOMAIN, DOMAIN_SPECIALTY, REVELATION_TREE, techText, specialtyLabel, leaderName } from "../game/research";
import { specText } from "../game/hero-xp";

// NO local duration formatter here (2026-09-27). This file used to carry a
// SECOND one — minutes-only, unkeyed — while `play.tsx` carried another, and
// under the re-time a research or deployment timer runs for hours to days: the
// old one rendered a week as `10080m 0s`. Both are now the ONE shared
// day-scale keyed formatter, `fmtDuration(t, ms)` in `game/i18n/format.ts`,
// rendered inside `<Bdi dir="ltr">` at every call site.

export function ResearchTreeView({ state, now, onBeginResearch, onBuildProbe, onLaunchProbe, onCollectProbe }: { state: GameState; now: number; onBeginResearch: (techId: string, leaderId: string) => void; onBuildProbe: () => void; onLaunchProbe: (serverId: string) => void; onCollectProbe: (probeId: string) => void }) {
  const t = useT();
  const freeLeaders = state.leaders.filter((l) => l.status === "active" && !l.assignment);
  return (
    <>
      <div className="mt-5 rounded-2xl border border-white/10 bg-black/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tooltip content={tipT(t, "lab", "research", LAB_TIPS.research)}>
            <h3 className="font-semibold text-white">{t("rviews.treeTitle", "🌳 The Research Tree")} <span className="text-xs font-normal text-gray-400">{t("rviews.treeSub", "— human knowledge, 5 domains × 4 named techs")}</span></h3>
          </Tooltip>
          <span className="text-xs text-purple-200">{t("rviews.codicesEarned", "📜 Codices: {n} earned", { n: state.codices })}</span>
        </div>
        <p className="mt-1 text-xs text-gray-400">{t("rviews.introA", "Research costs 📜 Codices + real time, run by an appointed Leader. A Leader whose ")}<b className="text-purple-300">{t("rviews.introSpecialty", "specialty")}</b>{t("rviews.introB", " matches the line works faster and can trigger a ")}<b className="text-amber-300">{t("rviews.introBreakthrough", "surprise breakthrough")}</b>{t("rviews.introC", " at completion. A ")}<b className="text-purple-300">{t("rviews.introScholar", "Scholar")}</b>{t("rviews.introD", " runs their projects 15% faster and breaks through 5% more often.")}</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          {DOMAINS.map((d) => {
            const techs = TECH_TREE.filter((t) => t.domain === d.id).sort((a, b) => a.index - b.index);
            return (
              <div key={d.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-lg">{d.icon}</span>
                  <span className="font-semibold text-white">{domainText(t, d.id, "name", d.name)}</span>
                  <span className="ms-auto text-[11px] text-purple-300">{specialtyLabel(t, DOMAIN_SPECIALTY[d.id], DOMAIN_SPECIALTY[d.id])}</span>
                </div>
                <div className="space-y-2">
                  {techs.map((t) => {
                    const done = engineHelpers.hasTech(state, t.id);
                    const inProg = engineHelpers.techInProgress(state, t.id);
                    const available = engineHelpers.techAvailable(state, t.id);
                    const job = inProg ? state.researchJobs.find((j) => j.techId === t.id && j.status === "researching") ?? null : null;
                    const leaderOnIt = job ? state.leaders.find((l) => l.id === job.leaderId) ?? null : null;
                    return <TechNode key={t.id} tech={t} done={done} inProg={inProg} available={available} now={now} job={job} leader={leaderOnIt} codices={state.codices} freeLeaders={freeLeaders} onBeginResearch={onBeginResearch} />;
                  })}
                </div>
              </div>
            );
          })}
        </div>
{engineHelpers.armoryTree.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-amber-200">{t("rviews.armoryTitle", "🏛️ The Armory")} <span className="text-xs font-normal text-gray-400">{t("rviews.armorySub", "— war hardware, built at the Cradle")}</span></h4>
              <span className="text-[11px] text-text-3">{t("rviews.armoryNote", "Unlocks weapon families · every family needs the 🏛️ Armory hub first")}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {engineHelpers.armoryTree.map((node) => {
                const done = engineHelpers.hasTech(state, node.id);
                const inProg = engineHelpers.armoryInProgress(state, node.id);
                const available = engineHelpers.armoryAvailable(state, node.id);
                const job = inProg ? state.researchJobs.find((j) => j.techId === node.id && j.status === "researching") ?? null : null;
                const leaderOnIt = job ? state.leaders.find((l) => l.id === job.leaderId) ?? null : null;
                return (
                  <div key={node.id} className={`w-56 rounded-lg border p-2.5 ${done ? "border-amber-400/50 bg-amber-400/10" : inProg ? "border-purple-400/40 bg-purple-400/10" : available ? "border-amber-400/40 bg-amber-400/5" : "border-white/10 bg-black/30 opacity-80"}`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-sm font-semibold ${done ? "text-amber-300" : "text-white"}`}>{node.icon} {techText(t, node.id, "name", node.name)}</span>
                      {done ? <span className="text-xs text-amber-300">✓</span> : <span className="text-xs text-purple-300">{t("rviews.codicesCost", "{n} 📜", { n: node.codicesCost })}</span>}
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400">{techText(t, node.id, "description", node.description)}</p>
                    <p className="mt-1 text-[11px] font-medium text-amber-200">{t("rviews.effectLine", "Effect: {v}", { v: techText(t, node.id, "effect", node.effect) })}</p>
                    {inProg && leaderOnIt && job && (
                      <>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-gray-300">
                          <span>🫂 {leaderName(t, leaderOnIt)}</span>
                          <span><Bdi dir="ltr">{fmtDuration(t, Math.max(0, job.startedAt + job.durationMs - now))}</Bdi> {t("rviews.timeLeft", "left")}</span>
                        </div>
                        <div className="mt-1 h-1 rounded bg-white/10"><div className="h-1 rounded bg-purple-400" style={{ width: `${Math.min(100, ((now - job.startedAt) / job.durationMs) * 100)}%` }} /></div>
                      </>
                    )}
                    {done && <p className="mt-1 text-xs text-amber-400/80">{t("rviews.researched", "Researched")}</p>}
                    {!done && !inProg && available && (
                      <div className="mt-2">
                        {state.codices < node.codicesCost ? (
                          <div className="text-[11px] text-text-3">{t("rviews.needCodices", "Need {n} 📜", { n: node.codicesCost })}</div>
                        ) : freeLeaders.length === 0 ? (
                          <div className="text-[11px] text-text-3">{t("rviews.noFreeLeader", "No free Leader")}</div>
                        ) : (
                          <button onClick={() => { sound.click(); onBeginResearch(node.id, freeLeaders[0].id); }} className="w-full rounded bg-white/10 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-white/20">
                            {t("rviews.appointLeader", "Appoint {name}", { name: freeLeaders[0].name })}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* ORBITAL WATCH (design/satellites.md) — the restoration line. Satellites
            wake ONE BY ONE through the same research-job shape as the tree, but
            the climbs are NEVER accelerable and never count toward research
            completions. */}
        <SatelliteSection state={state} now={now} freeLeaders={freeLeaders} onBeginResearch={onBeginResearch} />
        {/* SCOUT PROBES (design/abandoned-colonies-world-map.md §8) — one-time
            eyes on distant worlds. Research once, build probes, launch at planets. */}
        <div className="mt-4">
          <h3 className="font-semibold text-white">
            {t("rviews.scoutProbeTitle", "🔭 Scout Probes")}
            <span className="text-xs font-normal text-gray-400">{t("rviews.scoutProbeSub", " — eyes on distant worlds")}</span>
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
            {t("rviews.scoutProbeIntro", "Research once to unlock. Then build probes (500 supplies each, one-time use) and launch them at planets. After 6 hours they return with a report: player count vs colony count — odds, not guarantees.")}
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            <ScoutProbeCard state={state} now={now} freeLeaders={freeLeaders} onBeginResearch={onBeginResearch} onBuildProbe={onBuildProbe} onLaunchProbe={onLaunchProbe} onCollectProbe={onCollectProbe} />
          </div>
        </div>
        {state.revelations.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {REVELATION_TREE.filter((n) => state.revelations.includes(n.id)).map((n) => {
              const done = engineHelpers.hasRevelation(state, n.id);
              const inProg = engineHelpers.revelationInProgress(state, n.id);
              const available = engineHelpers.revelationAvailable(state, n.id);
              const job = inProg ? state.researchJobs.find((j) => j.techId === n.id && j.status === "researching") ?? null : null;
              const leaderOnIt = job ? state.leaders.find((l) => l.id === job.leaderId) ?? null : null;
              return <RevelationNode key={n.id} node={n} done={done} inProg={inProg} available={available} now={now} job={job} leader={leaderOnIt} codices={state.codices} freeLeaders={freeLeaders} onBeginResearch={onBeginResearch} />;
            })}
          </div>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-5">
        <h3 className="font-semibold text-white">{t("rviews.codicesHowTitle", "📜 How Codices are earned")}</h3>
        <ul className="mt-2 space-y-1 text-xs text-gray-400 list-disc list-inside">
          <li>{t("rviews.codicesHowA1", "A ")}<b className="text-gray-200">{t("rviews.codicesHowB1", "clean recovery")}</b>{t("rviews.codicesHowC1", " — an exploration returns with no radiation loss and no surprise encounter — recovers a surviving archive whole (deeper sites hide more).")}</li>
          <li><b className="text-gray-200">{t("rviews.codicesHowB2", "Deeds & merit")}</b>{t("rviews.codicesHowC2", " — first clean return, first Deploy, fifth exploration, and a deep clean recovery all award Codices.")}</li>
          <li>{t("rviews.codicesHowA3", "Rare ")}<b className="text-gray-200">{t("rviews.codicesHowB3", "discovery")}</b>{t("rviews.codicesHowC3", " on exploration as a bonus. Embers you salvage, chipsets you raid for, Codices you ")}<b className="text-purple-300">{t("rviews.codicesHowD3", "earn.")}</b></li>
        </ul>
      </div>
    </>
  );
}

/* ============================================================================
   ORBITAL WATCH — the Lab's satellite restoration line (design/satellites.md).
   One card per covered node (rim + Chorus heart — geography, never authored):
   dish status, what the sky over that ground reveals today, and the next
   climb. Climbs flow through onBeginResearch with the satellite tech id; the
   engine routes them to the no-acceleration, no-count research path.
   ========================================================================== */
function SatelliteSection({ state, now, freeLeaders, onBeginResearch }: {
  state: GameState; now: number; freeLeaders: Leader[]; onBeginResearch: (techId: string, leaderId: string) => void;
}) {
  const t = useT();
  const circuit = useMemo(
    () => generateAtlas({ worldId: WORLD_CONFIG_PUBLIC.worldId, raceId: WORLD_CONFIG_PUBLIC.raceLock }),
    [],
  );
  const ids = useMemo(() => coveredNodeIds(WORLD_CONFIG_PUBLIC.worldId), []);
  const awake = ids.filter((id) => satelliteStage(state, id) > 0).length;
  return (
    <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-cyan-200">
          {t("rviews.satTitle", "🛰️ Orbital Watch")}{" "}
          <span className="text-xs font-normal text-gray-400">{t("rviews.satSub", "— restore the sky, one satellite at a time")}</span>
        </h4>
        <span className="text-[11px] text-cyan-200/70">{t("rviews.satAwake", "{n}/{total} awake", { n: awake, total: ids.length })}</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
        {t("rviews.satIntro", "Every season the constellation resets to ~50% functional. Bring a satellite online, then climb it through stages 1–3: Online sounds the alarm on arrivals · Tracking names who and roughly how many · Full picture reveals amounts and troop types. A climb costs 📜 Codices + research time — no time token can hasten the sky.")}
      </p>
      <div className="mt-2 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {ids.map((id) => {
          const node = nodeById(circuit, id);
          return (
            <SatelliteResearchCard
              key={id}
              state={state}
              now={now}
              nodeId={id}
              nodeName={node?.name ?? id}
              freeLeaders={freeLeaders}
              onBeginResearch={onBeginResearch}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================================
   SATELLITE RESEARCH CARD — one satellite's full research surface, exported
   for the window framework (owner 2026-10-01: tap a satellite on the circuit
   map → research window opens right there). The SAME card the Lab's
   SatelliteSection renders — one component, two homes, zero drift.
   ========================================================================== */
export function SatelliteResearchCard({ state, now, nodeId, nodeName, freeLeaders, onBeginResearch }: {
  state: GameState; now: number; nodeId: string; nodeName: string;
  freeLeaders: Leader[]; onBeginResearch: (techId: string, leaderId: string) => void;
}) {
  const t = useT();
  const [hint, setHint] = useState<"codices" | "leaders" | null>(null);
  const stage = satelliteStage(state, nodeId);
  const intel = satelliteIntelFor(state, nodeId);
  const nextStage = stage < 3 ? ((stage + 1) as 1 | 2 | 3) : null;
  const techId = nextStage ? satelliteTechId(nodeId, nextStage) : null;
  const next = nextStage ? satelliteTechFor(nodeId, nextStage) : null;
  const job = techId ? state.researchJobs.find((j) => j.techId === techId && j.status === "researching") ?? null : null;
  const leaderOnIt = job ? state.leaders.find((l) => l.id === job.leaderId) ?? null : null;
  const revealFor = (i: "none" | "presence" | "identity" | "full") =>
    i === "none"
      ? t("circuit.satRevealNone", "Nothing — arrivals are fully invisible: no alarm, no ping.")
      : i === "presence"
        ? t("circuit.satRevealPresence", "An alarm when someone arrives here — but not who.")
        : i === "identity"
          ? t("circuit.satRevealIdentity", "An alarm that names who arrived, and roughly how many — but not what they bring.")
          : t("circuit.satRevealFull", "The full picture: amounts and troop types on every arrival.");
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-2.5">
      <div className="flex items-center justify-between gap-1">
        <span className="text-sm font-semibold text-white">
          <span
            className="me-1.5 inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: stage > 0 ? SATELLITE_COLORS.activeFill : SATELLITE_COLORS.dormantFill }}
          />
          {nodeName}
        </span>
        <span className="flex gap-0.5" role="img" aria-label={t("rviews.satStageAria", "Stage {stage} of 3", { stage })}>
          {[1, 2, 3].map((s) => (
            <span
              key={s}
              className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
              style={s <= stage
                ? { background: SATELLITE_COLORS.activeFill, color: SATELLITE_COLORS.activeInk }
                : { background: "rgba(255,255,255,0.08)", color: "#9ca3af" }}
            >
              {s}
            </span>
          ))}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
        <b className="text-gray-200">{t("rviews.satReveals", "Reveals:")}</b> {revealFor(intel)}
      </p>
      {job && leaderOnIt && (
        <>
          <div className="mt-1 flex items-center justify-between text-[11px] text-gray-300">
            <span>🫂 {leaderName(t, leaderOnIt)}</span>
            <span><Bdi dir="ltr">{fmtDuration(t, Math.max(0, job.startedAt + job.durationMs - now))}</Bdi> {t("rviews.timeLeft", "left")}</span>
          </div>
          <div className="mt-1 h-1 rounded bg-white/10"><div className="h-1 rounded bg-cyan-400" style={{ width: `${Math.min(100, ((now - job.startedAt) / job.durationMs) * 100)}%` }} /></div>
          <p className="mt-1 text-[10px] text-cyan-200/60">{t("rviews.satNoHasten", "The sky opens on research time alone — no token hastens it.")}</p>
        </>
      )}
      {next && !job && (
        <div className="mt-2">
          <button
            onClick={() => {
              sound.click();
              if (state.codices < next.codicesCost) {
                setHint("codices");
              } else if (freeLeaders.length === 0) {
                setHint("leaders");
              } else {
                setHint(null);
                onBeginResearch(techId!, freeLeaders[0].id);
              }
            }}
            className="w-full rounded border border-cyan-400/30 bg-cyan-400/15 px-2 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-400/25"
          >
            {stage === 0
              ? t("rviews.satAppoint", "Appoint {name} — bring it online ({cost} 📜)", { name: freeLeaders[0]?.name ?? t("rviews.satALeader", "a Leader"), cost: next.codicesCost })
              : t("rviews.satAppointStage", "Appoint {name} — climb to stage {stage} ({cost} 📜)", { name: freeLeaders[0]?.name ?? t("rviews.satALeader", "a Leader"), stage: nextStage ?? 3, cost: next.codicesCost })}
          </button>
          {hint === "codices" && (
            <p className="mt-1 text-[11px] text-amber-200">
              {t("rviews.hintCodices", "Out of Codices — you need {cost} 📜 but have {have}. Earn more through clean recoveries and deeds.", { cost: next.codicesCost, have: state.codices })}
            </p>
          )}
          {hint === "leaders" && (
            <p className="mt-1 text-[11px] text-amber-200">
              {t("rviews.hintLeaders", "No free Leader right now — free one up in the Lab, then appoint them here.")}
            </p>
          )}
        </div>
      )}
      {stage === 3 && <p className="mt-1 text-[11px] text-cyan-200/80">{t("rviews.satComplete", "Full picture — this sky is yours.")}</p>}
    </div>
  );
}

function TechNode({ tech, done, inProg, available, now, job, leader, codices, freeLeaders, onBeginResearch }: {
  tech: (typeof TECH_TREE)[number]; done: boolean; inProg: boolean; available: boolean; now: number;
  job: GameState["researchJobs"][number] | null; leader: Leader | null; codices: number;
  freeLeaders: Leader[]; onBeginResearch: (techId: string, leaderId: string) => void;
}) {
  const t = useT();
  const [hint, setHint] = useState<"codices" | "leaders" | null>(null);
  const canAfford = codices >= tech.codicesCost;
  const hasLeader = freeLeaders.length > 0;
  const prv = TECH_TREE.filter((t) => t.domain === tech.domain).find((n) => n.index === tech.index - 1);
  const pct = inProg && job && now ? Math.min(100, ((now - job.startedAt) / job.durationMs) * 100) : 0;
  const alignedFree = freeLeaders.find((l) => engineHelpers.aligns(l, tech.id));
  return (
    <div className={`rounded-lg border p-2.5 ${done ? "border-ember/40 bg-ember/10" : inProg ? "border-purple-400/40 bg-purple-400/10" : available ? "border-amber-400/40 bg-amber-400/5" : "border-white/10 bg-black/30 opacity-80"}`}>
      <div className="flex items-center justify-between gap-1">
        <span className={`text-sm font-semibold ${done ? "text-ember-soft" : "text-white"}`}>{tech.icon} {techText(t, tech.id, "name", tech.name)}</span>
        {done ? <span className="text-xs text-ember-soft">✓</span> : <span className="text-xs text-purple-300">{t("rviews.codicesCost", "{n} 📜", { n: tech.codicesCost })}</span>}
      </div>
      <p className="mt-1 text-[11px] text-gray-400">{techText(t, tech.id, "description", tech.description)}</p>
      <p className="mt-1 text-[11px] font-medium text-amber-200">{t("rviews.effectLine", "Effect: {v}", { v: techText(t, tech.id, "effect", tech.effect) })}</p>
      {inProg && leader && job && (
        <>
          <div className="mt-1 flex items-center justify-between text-[11px] text-gray-300">
            <span>🫂 {leaderName(t, leader)} <span className="text-purple-300">({specialtyLabel(t, leader.specialty, engineHelpers.specialtyLabel(leader))})</span></span>
            <span><Bdi dir="ltr">{fmtDuration(t, Math.max(0, job.startedAt + job.durationMs - now))}</Bdi> {t("rviews.timeLeft", "left")}</span>
          </div>
          <div className="mt-1 h-1 rounded bg-white/10"><div className="h-1 rounded bg-purple-400" style={{ width: `${pct}%` }} /></div>
        </>
      )}
      {done && <p className="mt-1 text-xs text-ember-soft/80">{t("rviews.researched", "Researched")}</p>}
      {!done && !inProg && available && (
        <div className="mt-2">
          <button
            onClick={() => {
              sound.click();
              if (!canAfford) {
                setHint("codices");
              } else if (!hasLeader) {
                setHint("leaders");
              } else {
                setHint(null);
                onBeginResearch(tech.id, (alignedFree ?? freeLeaders[0]).id);
              }
            }}
            className="w-full rounded bg-purple-400 px-2 py-1 text-[11px] font-semibold text-black hover:bg-purple-300"
          >
            {t("rviews.appointLeader", "Appoint {name}", { name: alignedFree ? `✨ ${alignedFree.name}` : (freeLeaders[0]?.name ?? t("rviews.satALeader", "a Leader")) })}
          </button>
          {hint === "codices" && (
            <p className="mt-1 text-[11px] text-amber-200">
              {t("rviews.hintCodices", "Out of Codices — you need {cost} 📜 but have {have}. Earn more through clean recoveries and deeds.", { cost: tech.codicesCost, have: codices })}
            </p>
          )}
          {hint === "leaders" && (
            <p className="mt-1 text-[11px] text-amber-200">
              {t("rviews.hintLeaders", "No free Leader right now — free one up in the Lab, then appoint them here.")}
            </p>
          )}
          {alignedFree && <p className="mt-1 text-xs text-purple-300">{t("rviews.alignedMatch", "✨ {name} matches — faster + breakthrough", { name: alignedFree.name })}</p>}
        </div>
      )}
      {!done && !inProg && !available && (
        <p className="mt-1 text-xs text-text-3">{tech.index === 0 ? t("rviews.earnToBegin", "Earn 📜 Codices to begin") : t("rviews.unlockFirst", "Unlock {name} first", { name: prv ? prv.name : t("rviews.prevTech", "the previous tech") })}</p>
      )}
    </div>
  );
}

/* ---------------- the hidden glyph row (no header, no tooltip, no hint) ---------------- */
// A revelation node renders ONLY once the server made it visible. Before that
// moment nothing exists here — no grayed node, no lock, no copy. In progress
// it shows the glyph + a quiet "… ✍️" with the standard progress bar, still
// nameless. No Tooltip anywhere on this branch, by design.
function RevelationNode({ node, done, inProg, available, now, job, leader, codices, freeLeaders, onBeginResearch }: {
  node: (typeof REVELATION_TREE)[number]; done: boolean; inProg: boolean; available: boolean; now: number;
  job: GameState["researchJobs"][number] | null; leader: Leader | null; codices: number;
  freeLeaders: Leader[]; onBeginResearch: (techId: string, leaderId: string) => void;
}) {
  const t = useT();
  const [hint, setHint] = useState<"codices" | "leaders" | null>(null);
  const canAfford = codices >= node.codicesCost;
  const hasLeader = freeLeaders.length > 0;
  const pct = inProg && job && now ? Math.min(100, ((now - job.startedAt) / job.durationMs) * 100) : 0;
  return (
    <div className={`rounded-lg border p-2.5 ${done ? "border-white/10 bg-white/5" : inProg ? "border-white/15 bg-white/5" : "border-white/10 bg-black/30"}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-sm font-semibold text-white">{node.glyph}{inProg ? " … ✍️" : done ? ` ${techText(t, node.id, "name", node.name)}` : available ? ` ${techText(t, node.id, "name", node.name)}` : ""}</span>
        {done ? <span className="text-xs text-text-3">✓</span> : <span className="text-xs text-text-3">{t("rviews.codicesCost", "{n} 📜", { n: node.codicesCost })}</span>}
      </div>
      {(done || available || inProg) && <p className="mt-1 text-[11px] text-gray-400">{techText(t, node.id, "description", node.description)}</p>}
      {inProg && leader && job && (
        <>
          <div className="mt-1 flex items-center justify-between text-[11px] text-gray-300">
            <span>🫂 {leaderName(t, leader)}</span>
            <span><Bdi dir="ltr">{fmtDuration(t, Math.max(0, job.startedAt + job.durationMs - now))}</Bdi> {t("rviews.timeLeft", "left")}</span>
          </div>
          <div className="mt-1 h-1 rounded bg-white/10"><div className="h-1 rounded bg-white/40" style={{ width: `${pct}%` }} /></div>
        </>
      )}
      {!done && !inProg && available && (
        <div className="mt-2">
          <button
            onClick={() => {
              sound.click();
              if (!canAfford) {
                setHint("codices");
              } else if (!hasLeader) {
                setHint("leaders");
              } else {
                setHint(null);
                onBeginResearch(node.id, freeLeaders[0].id);
              }
            }}
            className="w-full rounded bg-white/10 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-white/20"
          >
            {t("rviews.appointLeader", "Appoint {name}", { name: freeLeaders[0]?.name ?? t("rviews.satALeader", "a Leader") })}
          </button>
          {hint === "codices" && (
            <p className="mt-1 text-[11px] text-amber-200">
              {t("rviews.hintCodices", "Out of Codices — you need {cost} 📜 but have {have}. Earn more through clean recoveries and deeds.", { cost: node.codicesCost, have: codices })}
            </p>
          )}
          {hint === "leaders" && (
            <p className="mt-1 text-[11px] text-amber-200">
              {t("rviews.hintLeaders", "No free Leader right now — free one up in the Lab, then appoint them here.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Leaders roster (XP / leveling / specialization) ---------------- */

// Per-session record of L3-specialization modals the player has dismissed, so
// the milestone modal "appears once" (and the card button re-opens it). Lives
// at module scope so switching Lab sub-views doesn't re-pop a dismissed offer.
const dismissedSpecModals = new Set<string>();

const ATTRS: { id: "research" | "economy" | "combat" | "engineering"; label: string; icon: string; does: string }[] = [
  { id: "research", label: "research", icon: "🔬", does: "Speeds this Leader's research projects (4% per point)." },
  { id: "economy", label: "economy", icon: "💰", does: "Tends the colony's yield — embers and supplies (1% per point, colony-wide)." },
  { id: "combat", label: "combat", icon: "⚔️", does: "Sharper field leadership — survivors fight harder (1% per point, colony-wide)." },
  { id: "engineering", label: "engineering", icon: "🔧", does: "Makes the Workshop's work go further (crafting −0.5% per point, colony-wide)." },
];

export function LeadersView({ state, now, onAllocatePoint, onChooseSpec }: {
  state: GameState; now: number;
  onAllocatePoint: (leaderId: string, attr: "research" | "economy" | "combat" | "engineering") => void;
  onChooseSpec: (leaderId: string, path: "scholar" | "marshal" | "quartermaster") => void;
}) {
  const t = useT();
  const slots = engineHelpers.leaderSlots(state);
  const active = state.leaders.filter((l) => l.status !== "lost");
  // ---- Level-3 specialization modal state ----
  const [specId, setSpecId] = useState<string | null>(null);
  const [allocFor, setAllocFor] = useState<Leader | null>(null);

  // Auto-open the ONE-TIME specialization modal the first time any Leader hits
  // Level 3 with the choice still pending. Dismissing it once keeps it closed
  // this session; the card's Specialization button re-opens it.
  useEffect(() => {
    if (specId) {
      const l = state.leaders.find((x) => x.id === specId);
      if (!l) setSpecId(null);
      return;
    }
    const eligible = state.leaders.find(
      (l) => engineHelpers.leaderLevel(l) >= engineHelpers.milestone && !l.specialization && !dismissedSpecModals.has(l.id) && l.status !== "lost",
    );
    if (eligible) setSpecId(eligible.id);
  }, [state, specId]);

  const specLeader = specId ? state.leaders.find((l) => l.id === specId) ?? null : null;

  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-black/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tooltip content={tipT(t, "lab", "leaders", LAB_TIPS.leaders)}>
          <h3 className="font-semibold text-white">{t("rviews.councilTitle", "🫂 The Council")} <span className="text-xs font-normal text-gray-400">{t("rviews.councilSub", "— your named Leaders")}</span></h3>
        </Tooltip>
        <span className="text-xs text-gray-400">{t("rviews.slotsLabel", "Slots:")} <b className="text-white">{active.length}/{slots}</b></span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <Tooltip content={tipT(t, "lab", "leaderXp", LAB_TIPS.leaderXp)}>
          <span className="rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-gray-300">{t("rviews.xpChip", "⭐ XP")} <b className="text-amber-200">{t("rviews.xpDaily", "{n}/day", { n: engineHelpers.dailyCap })}</b> {t("rviews.xpSharedCap", "shared cap")}</span>
        </Tooltip>
        {engineHelpers.leaderSlots(state) > 0 && (
          <span className="text-[11px] text-text-3">{t("rviews.leadersEarnNote", "Leaders earn XP from research, breakthroughs, surviving surprises & deep runs — then choose a path at Level 3.")}</span>
        )}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {state.leaders.map((l) => {
          const job = l.assignment ? state.researchJobs.find((j) => j.techId === l.assignment && j.status === "researching") : null;
          return (
            <LeaderCard key={l.id} leader={l} job={job} now={now} onAllocate={() => setAllocFor(l)} onOpenSpec={() => setSpecId(l.id)} />
          );
        })}
        {active.length < slots && (
          <div className="rounded-xl border border-dashed border-white/15 p-4 text-center text-xs text-text-3">
            <div className="text-2xl">🕊️</div>
            {t("rviews.emptySeatA", "An empty seat. ")}<span className="text-purple-300">{t("rviews.emptySeatB", "Earn it")}</span>{t("rviews.emptySeatC", " — a deep clean recovery rescues a scholar into the Council.")}
          </div>
        )}
      </div>

      {specLeader && (
        <SpecializationModal
          leader={specLeader}
          onPick={(path) => { onChooseSpec(specLeader.id, path); }}
          onClose={() => { dismissedSpecModals.add(specLeader.id); setSpecId(null); sound.click(); }}
        />
      )}
      {allocFor && (
        <AllocateModal leader={allocFor} onPick={(attr) => { onAllocatePoint(allocFor.id, attr); setAllocFor(null); }} onClose={() => { setAllocFor(null); sound.click(); }} />
      )}
    </div>
  );
}

/* ---------------- one Leader card ---------------- */

function LeaderCard({ leader, job, now, onAllocate, onOpenSpec }: {
  leader: Leader; job: GameState["researchJobs"][number] | null; now: number;
  onAllocate: () => void; onOpenSpec: () => void;
}) {
  const t = useT();
  const level = engineHelpers.leaderLevel(leader);
  const xpToNext = engineHelpers.xpToNext(leader);
  const progress = engineHelpers.xpProgress(leader);
  const todayXp = engineHelpers.todayXp(leader);
  const pendingSpec = level >= engineHelpers.milestone && !leader.specialization;
  const spec = leader.specialization ? engineHelpers.specs.find((s) => s.id === leader.specialization) : null;
  const lost = leader.status === "lost";
  return (
    <div className={`rounded-xl border p-4 ${lost ? "border-red-400/40 bg-red-400/5 opacity-60" : "border-white/10 bg-white/5"}`}>
      <div className="flex items-center justify-between gap-2">
        <Tooltip content={tipT(t, "lab", "leaderLevel", LAB_TIPS.leaderLevel)}>
          <span className="font-semibold text-white">{leaderName(t, leader)}</span>
        </Tooltip>
        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${leader.status === "active" ? "bg-ember/15 text-ember-soft" : leader.status === "wounded" ? "bg-amber-400/15 text-amber-300" : "bg-red-400/15 text-red-300"}`}>{t(`rviews.status.${leader.status}`, leader.status)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
        <span className="text-purple-300">{SPECIALTY_LABEL[leader.specialty]} <span className="text-text-3">{t("rviews.specialtyDomainLine", "→ {domain} line", { domain: SPECIALTY_DOMAIN[leader.specialty] })}</span></span>
        <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-bold text-amber-200">{t("rviews.levelShort", "Lv {n}", { n: level })}</span>
      </div>

      {/* XP bar */}
      <Tooltip content={tipT(t, "lab", "leaderXp", LAB_TIPS.leaderXp)}>
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{t("rviews.xpTotal", "⭐ {n} XP", { n: Math.round(leader.xp) })}{leader.specialization ? t("rviews.xpBound", " · bound") : ""}</span>
            <span>{level >= 10 ? t("rviews.maxLevel", "MAX Lv 10") : xpToNext !== null ? t("rviews.xpToNext", "{n} XP → Lv {lvl}", { n: xpToNext, lvl: level + 1 }) : ""}</span>
          </div>
          <div className="mt-0.5 h-1.5 rounded bg-white/10">
            <div className="h-1.5 rounded bg-ember" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="mt-0.5 text-end text-xs text-text-3">{t("rviews.todayXp", "today {a}/{b} XP", { a: todayXp, b: engineHelpers.dailyCap })}</div>
        </div>
      </Tooltip>

      {/* Specialization badge / pending button */}
      {spec ? (
        <Tooltip content={tipT(t, "lab", "specialization", LAB_TIPS.specialization)}>
          <div className={`mt-2 rounded-lg border px-2 py-1 text-[11px] font-semibold ${spec.accent}`}>
            {spec.icon} {spec.mandate} <span className="text-xs font-normal opacity-80">{t("rviews.boundPermanent", "— bound, permanent")}</span>
          </div>
        </Tooltip>
      ) : pendingSpec ? (
        <button onClick={() => { sound.click(); onOpenSpec(); }} className="mt-2 w-full rounded-lg border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-400/20">
          {t("rviews.choosePath", "🧭 Level 3 — choose a path (Scholar · Marshal · Quartermaster)")}
        </button>
      ) : null}

      {/* Attributes + allocate */}
      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-gray-400">
        <span>{t("rviews.attrResearch", "🔬 research {n}", { n: leader.attributes.research })}</span>
        <span>{t("rviews.attrEconomy", "💰 economy {n}", { n: leader.attributes.economy })}</span>
        <span>{t("rviews.attrCombat", "⚔️ combat {n}", { n: leader.attributes.combat })}</span>
        <span>{t("rviews.attrEngineering", "🔧 engineering {n}", { n: leader.attributes.engineering })}</span>
      </div>
      {leader.unspentPoints > 0 && (
        <button onClick={() => { sound.click(); onAllocate(); }} className="mt-2 w-full rounded-lg bg-ember px-2 py-1.5 text-[11px] font-bold text-black hover:brightness-110">
          {t("rviews.allocatePoints", "● +{n} {unit} to allocate", { n: leader.unspentPoints, unit: leader.unspentPoints > 1 ? t("rviews.points", "points") : t("rviews.point", "point") })}
        </button>
      )}

      <div className="mt-2 text-[11px]">
        {job && leader.assignment ? (
          <span className="text-purple-200">{t("rviews.researching", "📚 Researching:")} {engineHelpers.techName(leader.assignment)} · <Bdi dir="ltr">{fmtDuration(t, Math.max(0, job.startedAt + job.durationMs - now))}</Bdi> {t("rviews.timeLeft", "left")}</span>
        ) : (
          <span className="text-text-3">{t("rviews.freeToAppoint", "Free to appoint")}</span>
        )}
      </div>
      <div className="mt-1 text-[11px] text-text-3">{t("rviews.leaderStats", "✨ {a} breakthroughs · 📜 {b} codices", { a: leader.breakthroughs, b: leader.codicesEarned })}</div>
      {leader.history.length > 0 && (
        <div className="mt-2 max-h-20 overflow-y-auto space-y-0.5 border-t border-white/10 pt-1.5 text-xs text-text-3">
          {leader.history.slice(-4).map((h, i) => <div key={i}>• {h}</div>)}
        </div>
      )}
    </div>
  );
}

/* ---------------- Level-3 specialization modal (one-time choice) ---------------- */

function SpecializationModal({ leader, onPick, onClose }: {
  leader: Leader; onPick: (path: "scholar" | "marshal" | "quartermaster") => void; onClose: () => void;
}) {
  const t = useT();
  const chosen = leader.specialization ? engineHelpers.specs.find((s) => s.id === leader.specialization) : null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={onClose}>
      <div className="my-auto max-w-lg rounded-2xl border border-amber-400/30 bg-[#0b0e16] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{t("rviews.specTitle", "🧭 {name} — Level {lvl}", { name: leaderName(t, leader), lvl: engineHelpers.leaderLevel(leader) })}</h3>
          <button onClick={onClose} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-400 hover:bg-white/10">{t("rviews.close", "Close")}</button>
        </div>
        {chosen ? (
          <div className="mt-3">
            <p className="text-sm text-gray-300">{t("rviews.alreadyWalksA", "This Leader already walks the ")}<b className={chosen.accent.split(" ")[2] || "text-amber-200"}>{chosen.icon} {specText(t, chosen.id, "mandate", chosen.mandate)}</b>{t("rviews.alreadyWalksB", ".")}</p>
            <div className={`mt-2 rounded-xl border p-3 ${chosen.accent}`}>
              <p className="text-xs">{specText(t, chosen.id, "blurb", chosen.blurb)}</p>
              <ul className="mt-2 space-y-1 text-xs">{chosen.effects.map((e, i) => <li key={e}>• {specText(t, chosen.id, `effect${i + 1}`, e)}</li>)}</ul>
            </div>
            <p className="mt-3 text-xs text-text-3">{t("rviews.oneTimeChoice", "A one-time choice — permanent, and the other two paths are closed for this Leader.")}</p>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-gray-300">{t("rviews.pickMandate", "One choice, made permanent. Pick the mandate this Leader will carry — the other two close forever.")}</p>
            <div className="mt-3 space-y-2">
              {engineHelpers.specs.map((s) => (
                <button key={s.id} onClick={() => { sound.click(); onPick(s.id); }} className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-start hover:border-amber-400/50 hover:bg-white/10">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{s.icon}</span>
                    <span className="font-semibold text-white">{specText(t, s.id, "mandate", s.mandate)}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">{specText(t, s.id, "blurb", s.blurb)}</p>
                  <ul className="mt-1.5 space-y-0.5 text-xs">{s.effects.map((e, i) => <li key={e} className="text-amber-200/90">• {specText(t, s.id, `effect${i + 1}`, e)}</li>)}</ul>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-text-3">{t("rviews.earnedByPlay", "Earned entirely by play — XP, then the choice. This is progression, never something to buy.")}</p>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- attribute allocation modal ---------------- */

function AllocateModal({ leader, onPick, onClose }: {
  leader: Leader; onPick: (attr: "research" | "economy" | "combat" | "engineering") => void; onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={onClose}>
      <div className="my-auto max-w-md rounded-2xl border border-amber-400/30 bg-[#0b0e16] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{t("rviews.allocateTitle", "🎖️ Allocate {name}'s point", { name: leader.name })}</h3>
          <button onClick={onClose} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-400 hover:bg-white/10">{t("rviews.close", "Close")}</button>
        </div>
        <p className="mt-2 text-sm text-gray-300">{t("rviews.allocYouHave", "You have ")}<b className="text-amber-200">{leader.unspentPoints}</b>{t("rviews.allocUnspent", " unspent ")}{leader.unspentPoints > 1 ? t("rviews.points", "points") : t("rviews.point", "point")}{t("rviews.allocRest", " from leveling. Put one into the craft YOU want to grow.")}</p>
        <div className="mt-3 space-y-2">
          {ATTRS.map((a) => (
            <button key={a.id} onClick={() => { sound.click(); onPick(a.id); }} className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-start hover:border-amber-400/50 hover:bg-white/10">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">{a.icon} {t(`rviews.attrLabel.${a.id}`, a.label)}</span>
                <span className="text-sm text-amber-200">{leader.attributes[a.id]} <span className="text-text-3">→ {leader.attributes[a.id] + 1}</span></span>
              </div>
              <p className="mt-1 text-xs text-gray-400">{t(`rviews.attrDoes.${a.id}`, a.does)}</p>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-text-3">{t("rviews.allocFooter", "Every level grants exactly 1 point. No purchase, no shortcut — growth is earned through play.")}</p>
      </div>
    </div>
  );
}

export type { ReactNode };
/** Scout probe research + building + launch UI (owner 2026-10-02).
 *  Follows the tap-to-explain pattern: every button always tappable, tap shows
 *  inline hint naming the missing requirement. */
export function ScoutProbeCard({ state, now, freeLeaders, onBeginResearch, onBuildProbe, onLaunchProbe, onCollectProbe }: {
  state: GameState; now: number;
  freeLeaders: Leader[]; onBeginResearch: (techId: string, leaderId: string) => void;
  onBuildProbe: () => void; onLaunchProbe: (serverId: string) => void; onCollectProbe: (probeId: string) => void;
}) {
  const t = useT();
  const [hint, setHint] = useState<string | null>(null);
  const [serverId, setServerId] = useState("");
  const wm = state.worldMap;
  const researched = wm?.scoutTechResearched ?? false;
  const techId = "scout-probes";
  const job = state.researchJobs.find((j) => j.techId === techId && j.status === "researching") ?? null;
  const leaderOnIt = job ? state.leaders.find((l) => l.id === job.leaderId) ?? null : null;

  if (!researched && !job) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/30 p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">🔭 {t("rviews.scoutProbe", "Scout Probes")}</span>
          <span className="text-[10px] text-gray-400">10 📜</span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
          {t("rviews.scoutProbeDesc", "One-time eyes on distant worlds. Research once, then build probes (500 supplies each) to scan planets for colony counts.")}
        </p>
        <div className="mt-2">
          <button
            onClick={() => {
              sound.click();
              if (state.codices < 10) {
                setHint("codices");
              } else if (freeLeaders.length === 0) {
                setHint("leaders");
              } else {
                setHint(null);
                onBeginResearch(techId, freeLeaders[0].id);
              }
            }}
            className="w-full rounded border border-cyan-400/30 bg-cyan-400/15 px-2 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-400/25"
          >
            {t("rviews.appointLeader", "Appoint Leader")}
          </button>
          {hint === "codices" && (
            <p className="mt-1 text-[10px] text-amber-200">
              {t("rviews.needCodices", "Needs 10 📜 Codices. You have {n} — earn more through clean recoveries and deeds.", { n: state.codices })}
            </p>
          )}
          {hint === "leaders" && (
            <p className="mt-1 text-[10px] text-amber-200">
              {t("rviews.needLeader", "Needs a free Leader. All your Leaders are busy or recovering.")}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (job && leaderOnIt) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/30 p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">🔭 {t("rviews.scoutProbe", "Scout Probes")}</span>
          <span className="text-[10px] text-cyan-200">{t("rviews.researching", "Researching")}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-gray-300">
          <span>🫂 {leaderName(t, leaderOnIt)}</span>
          <span><Bdi dir="ltr">{fmtDuration(t, Math.max(0, job.startedAt + job.durationMs - now))}</Bdi> {t("rviews.timeLeft", "left")}</span>
        </div>
        <div className="mt-1 h-1 rounded bg-white/10"><div className="h-1 rounded bg-cyan-400" style={{ width: `${Math.min(100, ((now - job.startedAt) / job.durationMs) * 100)}%` }} /></div>
      </div>
    );
  }

  // Researched — full probe management: build, launch, in-flight, reports
  const probes = wm?.probes ?? 0;
  const inflight = wm?.inflight ?? [];
  const reports = wm ? Object.values(wm.reports) : [];
  const canBuild = state.resources.supplies >= 500;
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-white">🔭 {t("rviews.scoutProbe", "Scout Probes")}</span>
        <span className="text-[10px] text-emerald-200">{t("rviews.researched", "Researched")}</span>
      </div>

      {/* Inventory + build */}
      <div className="mt-2 flex items-center justify-between">
        <p className="text-[11px] text-gray-400">
          {t("rviews.probesHave", "Probes ready:")} <b className="text-white">{probes}</b>
        </p>
        <button
          onClick={() => {
            sound.click();
            if (!canBuild) {
              setHint("supplies");
            } else {
              setHint(null);
              onBuildProbe();
            }
          }}
          className="rounded border border-cyan-400/30 bg-cyan-400/15 px-2 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-400/25"
        >
          {t("rviews.buildProbe", "Build probe (500 supplies)")}
        </button>
      </div>
      {hint === "supplies" && (
        <p className="mt-1 text-[10px] text-amber-200">
          {t("rviews.needSupplies", "Needs 500 supplies. You have {n}.", { n: Math.floor(state.resources.supplies) })}
        </p>
      )}

      {/* Launch */}
      <div className="mt-2">
        <p className="text-[11px] font-semibold text-gray-300">{t("rviews.launchProbe", "Launch probe")}</p>
        <div className="mt-1 flex gap-1">
          <input
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            placeholder={t("rviews.serverIdPlaceholder", "Target planet / server")}
            className="min-w-0 flex-1 rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white placeholder:text-gray-500"
          />
          <button
            onClick={() => {
              sound.click();
              if (probes < 1) {
                setHint("noprobe");
              } else if (!serverId.trim()) {
                setHint("noserver");
              } else {
                setHint(null);
                onLaunchProbe(serverId.trim());
                setServerId("");
              }
            }}
            className="shrink-0 rounded border border-cyan-400/30 bg-cyan-400/15 px-2 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-400/25"
          >
            {t("rviews.launch", "Launch")}
          </button>
        </div>
        {hint === "noprobe" && (
          <p className="mt-1 text-[10px] text-amber-200">{t("rviews.needProbe", "Build a probe first.")}</p>
        )}
        {hint === "noserver" && (
          <p className="mt-1 text-[10px] text-amber-200">{t("rviews.needServer", "Name the target planet first.")}</p>
        )}
      </div>

      {/* In-flight */}
      {inflight.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-gray-300">{t("rviews.inflight", "In flight ({n})", { n: inflight.length })}</p>
          <div className="mt-1 space-y-1">
            {inflight.map((p) => {
              const ready = p.status === "returned" || now >= p.returnsAt;
              const msLeft = Math.max(0, p.returnsAt - now);
              return (
                <div key={p.id} className="flex items-center justify-between rounded bg-white/5 px-2 py-1">
                  <span className="text-[11px] text-gray-300">
                    {p.targetServerId} · {ready ? (
                      <span className="text-emerald-300">{t("rviews.probeReady", "Ready")}</span>
                    ) : (
                      <Bdi dir="ltr">{fmtDuration(t, msLeft)}</Bdi>
                    )}
                  </span>
                  {ready && p.status === "inflight" && (
                    <button
                      onClick={() => { sound.click(); onCollectProbe(p.id); }}
                      className="rounded border border-emerald-400/30 bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-400/25"
                    >
                      {t("rviews.collect", "Collect")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Reports */}
      {reports.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-gray-300">{t("rviews.reports", "Reports ({n})", { n: reports.length })}</p>
          <div className="mt-1 space-y-1">
            {reports.map((r) => (
              <div key={r.id} className="rounded bg-white/5 px-2 py-1 text-[11px] text-gray-300">
                <b className="text-white">{r.serverId}</b>
                {": "}
                {t("rviews.reportLine", "{players} players, {colonies} colonies ({abandoned} abandoned)", {
                  players: r.playerCount, colonies: r.colonyCount, abandoned: r.abandonedCount,
                })}
              </div>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-gray-500">{t("rviews.reportDisclaimer", "Odds, not guarantees — a probe never says whether loot remains.")}</p>
        </div>
      )}
    </div>
  );
}
