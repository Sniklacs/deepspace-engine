// Research Tree + Leaders Roster views for the Lab tab (knowledge track).
// Leaders now carry the earned XP/leveling layer (V3): square-root curve, one
// attribute point per level, and the one-time Level-3 specialization choice —
// Scholar / Marshal / Quartermaster. All progression is earned through events, never
// purchasable. Mobile-first: modals use the `fixed inset-0 … flex items-start
// justify-center overflow-y-auto` pattern so nothing clips on short screens,
// and the Tooltip long-press/double-tap fix is untouched.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { DOMAINS } from "../game/zones";
import { engineHelpers } from "../game/client-utils";
import { sound } from "../game/sound";
import { Tooltip } from "./Tooltip";
import { tip, LAB_TIPS } from "../game/tooltips";
import type { GameState, Leader } from "../game/types";
import { TECH_TREE, SPECIALTY_LABEL, SPECIALTY_DOMAIN, DOMAIN_SPECIALTY, REVELATION_TREE } from "../game/research";

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function ResearchTreeView({ state, now, onBeginResearch }: { state: GameState; now: number; onBeginResearch: (techId: string, leaderId: string) => void }) {
  const freeLeaders = state.leaders.filter((l) => l.status === "active" && !l.assignment);
  return (
    <>
      <div className="mt-5 rounded-2xl border border-white/10 bg-black/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tooltip content={tip(LAB_TIPS.research)}>
            <h3 className="font-semibold text-white">🌳 The Research Tree <span className="text-xs font-normal text-gray-400">— human knowledge, 5 domains × 4 named techs</span></h3>
          </Tooltip>
          <span className="text-xs text-purple-200">📜 Codices: {state.codices} earned</span>
        </div>
        <p className="mt-1 text-xs text-gray-400">Research costs 📜 Codices + real time, run by an appointed Leader. A Leader whose <b className="text-purple-300">specialty</b> matches the line works faster and can trigger a <b className="text-amber-300">surprise breakthrough</b> at completion. A <b className="text-purple-300">Scholar</b> runs their projects 15% faster and breaks through 5% more often.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          {DOMAINS.map((d) => {
            const techs = TECH_TREE.filter((t) => t.domain === d.id).sort((a, b) => a.index - b.index);
            return (
              <div key={d.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-lg">{d.icon}</span>
                  <span className="font-semibold text-white">{d.name}</span>
                  <span className="ms-auto text-[11px] text-purple-300">{DOMAIN_SPECIALTY[d.id]}</span>
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
              <h4 className="text-sm font-semibold text-amber-200">🏛️ The Armory <span className="text-xs font-normal text-gray-400">— war hardware, built at the Cradle</span></h4>
              <span className="text-[11px] text-text-3">Unlocks weapon families · every family needs the 🏛️ Armory hub first</span>
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
                      <span className={`text-sm font-semibold ${done ? "text-amber-300" : "text-white"}`}>{node.icon} {node.name}</span>
                      {done ? <span className="text-xs text-amber-300">✓</span> : <span className="text-xs text-purple-300">{node.codicesCost} 📜</span>}
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400">{node.description}</p>
                    <p className="mt-1 text-[11px] font-medium text-amber-200">Effect: {node.effect}</p>
                    {inProg && leaderOnIt && job && (
                      <>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-gray-300">
                          <span>🫂 {leaderOnIt.name}</span>
                          <span>{fmtDur(Math.max(0, job.startedAt + job.durationMs - now))} left</span>
                        </div>
                        <div className="mt-1 h-1 rounded bg-white/10"><div className="h-1 rounded bg-purple-400" style={{ width: `${Math.min(100, ((now - job.startedAt) / job.durationMs) * 100)}%` }} /></div>
                      </>
                    )}
                    {done && <p className="mt-1 text-xs text-amber-400/80">Researched</p>}
                    {!done && !inProg && available && (
                      <div className="mt-2">
                        {state.codices < node.codicesCost ? (
                          <div className="text-[11px] text-text-3">Need {node.codicesCost} 📜</div>
                        ) : freeLeaders.length === 0 ? (
                          <div className="text-[11px] text-text-3">No free Leader</div>
                        ) : (
                          <button onClick={() => { sound.click(); onBeginResearch(node.id, freeLeaders[0].id); }} className="w-full rounded bg-white/10 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-white/20">
                            Appoint {freeLeaders[0].name}
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
        <h3 className="font-semibold text-white">📜 How Codices are earned</h3>
        <ul className="mt-2 space-y-1 text-xs text-gray-400 list-disc list-inside">
          <li>A <b className="text-gray-200">clean recovery</b> — an exploration returns with no radiation loss and no surprise encounter — recovers a surviving archive whole (deeper sites hide more).</li>
          <li><b className="text-gray-200">Deeds & merit</b> — first clean return, first Deploy, fifth exploration, and a deep clean recovery all award Codices.</li>
          <li>Rare <b className="text-gray-200">discovery</b> on exploration as a bonus. Embers you salvage, chipsets you raid for, Codices you <b className="text-purple-300">earn</b>.</li>
        </ul>
      </div>
    </>
  );
}

function TechNode({ tech, done, inProg, available, now, job, leader, codices, freeLeaders, onBeginResearch }: {
  tech: (typeof TECH_TREE)[number]; done: boolean; inProg: boolean; available: boolean; now: number;
  job: GameState["researchJobs"][number] | null; leader: Leader | null; codices: number;
  freeLeaders: Leader[]; onBeginResearch: (techId: string, leaderId: string) => void;
}) {
  const canAfford = codices >= tech.codicesCost;
  const hasLeader = freeLeaders.length > 0;
  const prv = TECH_TREE.filter((t) => t.domain === tech.domain).find((n) => n.index === tech.index - 1);
  const pct = inProg && job && now ? Math.min(100, ((now - job.startedAt) / job.durationMs) * 100) : 0;
  const alignedFree = freeLeaders.find((l) => engineHelpers.aligns(l, tech.id));
  return (
    <div className={`rounded-lg border p-2.5 ${done ? "border-ember/40 bg-ember/10" : inProg ? "border-purple-400/40 bg-purple-400/10" : available ? "border-amber-400/40 bg-amber-400/5" : "border-white/10 bg-black/30 opacity-80"}`}>
      <div className="flex items-center justify-between gap-1">
        <span className={`text-sm font-semibold ${done ? "text-ember-soft" : "text-white"}`}>{tech.icon} {tech.name}</span>
        {done ? <span className="text-xs text-ember-soft">✓</span> : <span className="text-xs text-purple-300">{tech.codicesCost} 📜</span>}
      </div>
      <p className="mt-1 text-[11px] text-gray-400">{tech.description}</p>
      <p className="mt-1 text-[11px] font-medium text-amber-200">Effect: {tech.effect}</p>
      {inProg && leader && job && (
        <>
          <div className="mt-1 flex items-center justify-between text-[11px] text-gray-300">
            <span>🫂 {leader.name} <span className="text-purple-300">({engineHelpers.specialtyLabel(leader)})</span></span>
            <span>{fmtDur(Math.max(0, job.startedAt + job.durationMs - now))} left</span>
          </div>
          <div className="mt-1 h-1 rounded bg-white/10"><div className="h-1 rounded bg-purple-400" style={{ width: `${pct}%` }} /></div>
        </>
      )}
      {done && <p className="mt-1 text-xs text-ember-soft/80">Researched</p>}
      {!done && !inProg && available && (
        <div className="mt-2">
          {!canAfford ? (
            <div className="text-[11px] text-red-300">Need {tech.codicesCost} 📜</div>
          ) : !hasLeader ? (
            <div className="text-[11px] text-amber-300">No free Leader</div>
          ) : (
            <button onClick={() => { sound.click(); onBeginResearch(tech.id, (alignedFree ?? freeLeaders[0]).id); }} className="w-full rounded bg-purple-400 px-2 py-1 text-[11px] font-semibold text-black hover:bg-purple-300">
              Appoint {alignedFree ? `✨ ${alignedFree.name}` : freeLeaders[0].name}
            </button>
          )}
          {alignedFree && <p className="mt-1 text-xs text-purple-300">✨ {alignedFree.name} matches — faster + breakthrough</p>}
        </div>
      )}
      {!done && !inProg && !available && (
        <p className="mt-1 text-xs text-text-3">{tech.index === 0 ? "Earn 📜 Codices to begin" : `Unlock ${prv ? prv.name : "the previous tech"} first`}</p>
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
  const canAfford = codices >= node.codicesCost;
  const hasLeader = freeLeaders.length > 0;
  const pct = inProg && job && now ? Math.min(100, ((now - job.startedAt) / job.durationMs) * 100) : 0;
  return (
    <div className={`rounded-lg border p-2.5 ${done ? "border-white/10 bg-white/5" : inProg ? "border-white/15 bg-white/5" : "border-white/10 bg-black/30"}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-sm font-semibold text-white">{node.glyph}{inProg ? " … ✍️" : done ? ` ${node.name}` : available ? ` ${node.name}` : ""}</span>
        {done ? <span className="text-xs text-text-3">✓</span> : <span className="text-xs text-text-3">{node.codicesCost} 📜</span>}
      </div>
      {(done || available || inProg) && <p className="mt-1 text-[11px] text-gray-400">{node.description}</p>}
      {inProg && leader && job && (
        <>
          <div className="mt-1 flex items-center justify-between text-[11px] text-gray-300">
            <span>🫂 {leader.name}</span>
            <span>{fmtDur(Math.max(0, job.startedAt + job.durationMs - now))} left</span>
          </div>
          <div className="mt-1 h-1 rounded bg-white/10"><div className="h-1 rounded bg-white/40" style={{ width: `${pct}%` }} /></div>
        </>
      )}
      {!done && !inProg && available && (
        <div className="mt-2">
          {!canAfford ? (
            <div className="text-[11px] text-text-3">Need {node.codicesCost} 📜</div>
          ) : !hasLeader ? (
            <div className="text-[11px] text-text-3">No free Leader</div>
          ) : (
            <button onClick={() => { sound.click(); onBeginResearch(node.id, freeLeaders[0].id); }} className="w-full rounded bg-white/10 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-white/20">
              Appoint {freeLeaders[0].name}
            </button>
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
        <Tooltip content={tip(LAB_TIPS.leaders)}>
          <h3 className="font-semibold text-white">🫂 The Council <span className="text-xs font-normal text-gray-400">— your named Leaders</span></h3>
        </Tooltip>
        <span className="text-xs text-gray-400">Slots: <b className="text-white">{active.length}/{slots}</b></span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <Tooltip content={tip(LAB_TIPS.leaderXp)}>
          <span className="rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-gray-300">⭐ XP <b className="text-amber-200">{engineHelpers.dailyCap}/day</b> shared cap</span>
        </Tooltip>
        {engineHelpers.leaderSlots(state) > 0 && (
          <span className="text-[11px] text-text-3">Leaders earn XP from research, breakthroughs, surviving surprises & deep runs — then choose a path at Level 3.</span>
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
            An empty seat. <span className="text-purple-300">Earn it</span> — a deep clean recovery rescues a scholar into the Council.
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
        <Tooltip content={tip(LAB_TIPS.leaderLevel)}>
          <span className="font-semibold text-white">{leader.name}</span>
        </Tooltip>
        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${leader.status === "active" ? "bg-ember/15 text-ember-soft" : leader.status === "wounded" ? "bg-amber-400/15 text-amber-300" : "bg-red-400/15 text-red-300"}`}>{leader.status}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
        <span className="text-purple-300">{SPECIALTY_LABEL[leader.specialty]} <span className="text-text-3">→ {SPECIALTY_DOMAIN[leader.specialty]} line</span></span>
        <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-bold text-amber-200">Lv {level}</span>
      </div>

      {/* XP bar */}
      <Tooltip content={tip(LAB_TIPS.leaderXp)}>
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>⭐ {Math.round(leader.xp)} XP{leader.specialization ? " · bound" : ""}</span>
            <span>{level >= 10 ? "MAX Lv 10" : xpToNext !== null ? `${xpToNext} XP → Lv ${level + 1}` : ""}</span>
          </div>
          <div className="mt-0.5 h-1.5 rounded bg-white/10">
            <div className="h-1.5 rounded bg-ember" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="mt-0.5 text-end text-xs text-text-3">today {todayXp}/{engineHelpers.dailyCap} XP</div>
        </div>
      </Tooltip>

      {/* Specialization badge / pending button */}
      {spec ? (
        <Tooltip content={tip(LAB_TIPS.specialization)}>
          <div className={`mt-2 rounded-lg border px-2 py-1 text-[11px] font-semibold ${spec.accent}`}>
            {spec.icon} {spec.mandate} <span className="text-xs font-normal opacity-80">— bound, permanent</span>
          </div>
        </Tooltip>
      ) : pendingSpec ? (
        <button onClick={() => { sound.click(); onOpenSpec(); }} className="mt-2 w-full rounded-lg border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-400/20">
          🧭 Level 3 — choose a path (Scholar · Marshal · Quartermaster)
        </button>
      ) : null}

      {/* Attributes + allocate */}
      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-gray-400">
        <span>🔬 research {leader.attributes.research}</span>
        <span>💰 economy {leader.attributes.economy}</span>
        <span>⚔️ combat {leader.attributes.combat}</span>
        <span>🔧 engineering {leader.attributes.engineering}</span>
      </div>
      {leader.unspentPoints > 0 && (
        <button onClick={() => { sound.click(); onAllocate(); }} className="mt-2 w-full rounded-lg bg-ember px-2 py-1.5 text-[11px] font-bold text-black hover:brightness-110">
          ● +{leader.unspentPoints} point{leader.unspentPoints > 1 ? "s" : ""} to allocate
        </button>
      )}

      <div className="mt-2 text-[11px]">
        {job && leader.assignment ? (
          <span className="text-purple-200">📚 Researching: {engineHelpers.techName(leader.assignment)} · {fmtDur(Math.max(0, job.startedAt + job.durationMs - now))} left</span>
        ) : (
          <span className="text-text-3">Free to appoint</span>
        )}
      </div>
      <div className="mt-1 text-[11px] text-text-3">✨ {leader.breakthroughs} breakthroughs · 📜 {leader.codicesEarned} codices</div>
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
  const chosen = leader.specialization ? engineHelpers.specs.find((s) => s.id === leader.specialization) : null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={onClose}>
      <div className="my-auto max-w-lg rounded-2xl border border-amber-400/30 bg-[#0b0e16] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">🧭 {leader.name} — Level {engineHelpers.leaderLevel(leader)}</h3>
          <button onClick={onClose} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-400 hover:bg-white/10">Close</button>
        </div>
        {chosen ? (
          <div className="mt-3">
            <p className="text-sm text-gray-300">This Leader already walks the <b className={chosen.accent.split(" ")[2] || "text-amber-200"}>{chosen.icon} {chosen.mandate}</b>.</p>
            <div className={`mt-2 rounded-xl border p-3 ${chosen.accent}`}>
              <p className="text-xs">{chosen.blurb}</p>
              <ul className="mt-2 space-y-1 text-xs">{chosen.effects.map((e) => <li key={e}>• {e}</li>)}</ul>
            </div>
            <p className="mt-3 text-xs text-text-3">A one-time choice — permanent, and the other two paths are closed for this Leader.</p>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-gray-300">One choice, made permanent. Pick the mandate this Leader will carry — the other two close forever.</p>
            <div className="mt-3 space-y-2">
              {engineHelpers.specs.map((s) => (
                <button key={s.id} onClick={() => { sound.click(); onPick(s.id); }} className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-start hover:border-amber-400/50 hover:bg-white/10">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{s.icon}</span>
                    <span className="font-semibold text-white">{s.mandate}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">{s.blurb}</p>
                  <ul className="mt-1.5 space-y-0.5 text-xs">{s.effects.map((e) => <li key={e} className="text-amber-200/90">• {e}</li>)}</ul>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-text-3">Earned entirely by play — XP, then the choice. This is progression, never something to buy.</p>
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
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={onClose}>
      <div className="my-auto max-w-md rounded-2xl border border-amber-400/30 bg-[#0b0e16] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">🎖️ Allocate {leader.name}'s point</h3>
          <button onClick={onClose} className="rounded border border-white/15 px-3 py-2 text-xs text-gray-400 hover:bg-white/10">Close</button>
        </div>
        <p className="mt-2 text-sm text-gray-300">You have <b className="text-amber-200">{leader.unspentPoints}</b> unspent point{leader.unspentPoints > 1 ? "s" : ""} from leveling. Put one into the craft YOU want to grow.</p>
        <div className="mt-3 space-y-2">
          {ATTRS.map((a) => (
            <button key={a.id} onClick={() => { sound.click(); onPick(a.id); }} className="w-full rounded-xl border border-white/15 bg-white/5 p-3 text-start hover:border-amber-400/50 hover:bg-white/10">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">{a.icon} {a.label}</span>
                <span className="text-sm text-amber-200">{leader.attributes[a.id]} <span className="text-text-3">→ {leader.attributes[a.id] + 1}</span></span>
              </div>
              <p className="mt-1 text-xs text-gray-400">{a.does}</p>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-text-3">Every level grants exactly 1 point. No purchase, no shortcut — growth is earned through play.</p>
      </div>
    </div>
  );
}

export type { ReactNode };