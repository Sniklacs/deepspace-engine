// CradleOverview — the Cradle page's "what's going on" board (owner 2026-09-30).
//
// Replaces the old workshop shelf: scientists (studying/idle), leaders and
// their research, exploration parties out, armory builds, the domain deploy —
// each with a progress bar and a live countdown. Research, armory and domain
// timers can be sped up with held time tokens right from the board.
// Expeditions can NEVER be sped up (owner ruling) — the control is simply
// absent there. The alliance section shows today's help ticks left, who helped
// you this week, and a door into the alliance tab where help is given.
//
// PRESENTATION ONLY: every figure comes from `state`, every refusal from the
// server. The component never invents a timer.
import type { GameState } from "../game/types";
import { engineHelpers } from "../game/client-utils";
import { fmtDuration } from "../game/i18n/format";
import { helpRemaining, allianceOf } from "../game/war/alliances";
import { raceFamilies } from "../game/armory";
import { EARNED_TIME_TOKEN_SIZES } from "../game/time-tokens";
import type { EarnedTimeTokenSizeId } from "../game/time-tokens";
import { useT } from "./i18n/I18n";
import { Panel } from "./ui/Panel";
import CradleBanner from "./CradleBanner";

export type SpeedupKind = "research" | "armory_build" | "domain_deploy";

export default function CradleOverview({
  state,
  now,
  timeTokens,
  onSpeedup,
  onOpenAlliance,
}: {
  state: GameState;
  now: number;
  /** public holdings view: sizeId -> count */
  timeTokens: Record<string, number>;
  onSpeedup: (kind: SpeedupKind, id: string, sizeId: EarnedTimeTokenSizeId) => void;
  onOpenAlliance: () => void;
}) {
  const t = useT();

  // ---- scientists ---------------------------------------------------------
  const studying = state.studies.filter((s) => s.status === "studying");
  const onExpedition = state.expeditions
    .filter((e) => e.status === "out")
    .reduce((n, e) => n + e.assignedScientists, 0);
  const idleScientists = Math.max(0, state.scientists - studying.length - onExpedition);

  // ---- research -----------------------------------------------------------
  const research = state.researchJobs.filter((j) => j.status === "researching");

  // ---- exploration ---------------------------------------------------------
  const expeditions = state.expeditions.filter((e) => e.status === "out");

  // ---- armory --------------------------------------------------------------
  const armory = Object.entries(state.armoryBuilds ?? {});
  const families = raceFamilies(state.race ?? "watchers");

  // ---- domain --------------------------------------------------------------
  const deploy = state.programDeploy ?? null;

  // ---- alliance -------------------------------------------------------------
  const alliance = allianceOf(state, state.gameId ?? "");
  const helpLeft = helpRemaining(state, now);
  const helpedBy = (state.helpReceived ?? []).slice(-5).reverse();

  // Earned sizes only: the server validator rejects sellable sizes, so the
  // overview never offers them even if a holding ever contains them.
  const heldSizes = EARNED_TIME_TOKEN_SIZES.filter((s) => (timeTokens[s] ?? 0) > 0);

  const anyTimer =
    studying.length > 0 ||
    research.length > 0 ||
    expeditions.length > 0 ||
    armory.length > 0 ||
    !!deploy;

  return (
    <Panel testid="cradle-overview" className="space-y-4">
      {/* the cradle painting behind the overview header (owner 2026-10-01):
          race-keyed, falling back to the default dome when the race has no
          art file yet. The scrim keeps the header readable on the art. */}
      <CradleBanner
        raceId={state.race}
        title={t("overview.title")}
        sub={
          <>
            {t("overview.scientists")}:{" "}
            <Bdi dir="ltr">
              {idleScientists}/{state.scientists}
            </Bdi>{" "}
            {t("overview.idle")}
          </>
        }
      />

      {!anyTimer && (
        <p className="text-xs text-text-3">{t("overview.noTimers")}</p>
      )}

      {studying.length > 0 && (
        <Section title={`${t("overview.scientists")} · ${t("overview.studying")}`}>
          {studying.map((s) => (
            <TimerRow
              key={s.id}
              t={t}
              now={now}
              label={s.kind === "ember" ? t("lab.studyEmbers") : t("lab.studyChipset")}
              startedAt={s.startedAt}
              baseMs={s.durationMs}
              tokenMs={0}
            />
          ))}
        </Section>
      )}

      {research.length > 0 && (
        <Section title={t("overview.research")}>
          {research.map((j) => {
            const leader = state.leaders.find((l) => l.id === j.leaderId);
            return (
              <TimerRow
                key={j.id}
                t={t}
                now={now}
                label={engineHelpers.techName(j.techId)}
                sub={leader ? `${leader.title ? leader.title + " " : ""}${leader.name}` : undefined}
                startedAt={j.startedAt}
                baseMs={j.durationMs}
                tokenMs={j.timeTokenMs ?? 0}
                speedup={{ kind: "research", id: j.id, heldSizes }}
                onSpeedup={onSpeedup}
              />
            );
          })}
        </Section>
      )}

      {expeditions.length > 0 && (
        <Section title={t("overview.exploration")}>
          {expeditions.map((e) => (
            <TimerRow
              key={e.id}
              t={t}
              now={now}
              label={e.label}
              sub={t("overview.crew", { n: String(e.assignedScientists) })}
              startedAt={e.startedAt}
              baseMs={e.durationMs}
              tokenMs={0}
            />
          ))}
        </Section>
      )}

      {armory.length > 0 && (
        <Section title={t("overview.armory")}>
          {armory.map(([familyId, b]) => {
            const f = families.find((x) => x.id === familyId);
            return (
              <TimerRow
                key={familyId}
                t={t}
                now={now}
                label={f ? `${f.icon} ${f.name}` : familyId}
                sub={t("overview.tierTarget", { tier: String(b.targetTier) })}
                startedAt={b.startedAt}
                baseMs={b.doneAt - b.startedAt}
                tokenMs={b.timeTokenMs ?? 0}
                speedup={{ kind: "armory_build", id: familyId, heldSizes }}
                onSpeedup={onSpeedup}
              />
            );
          })}
        </Section>
      )}

      {deploy && (
        <Section title={t("overview.domain")}>
          <TimerRow
            t={t}
            now={now}
            label={t(`domain.${deploy.domain}.name`, deploy.domain)}
            startedAt={deploy.startedAt}
            baseMs={deploy.durationMs}
            tokenMs={deploy.timeTokenMs ?? 0}
            speedup={{ kind: "domain_deploy", id: deploy.domain, heldSizes }}
            onSpeedup={onSpeedup}
          />
        </Section>
      )}

      {/* ---- alliance ------------------------------------------------------ */}
      <Section title={t("overview.alliance")}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-2">
          <span>
            🤝 {t("overview.helpLeft", { n: String(helpLeft) })}
          </span>
          {alliance ? (
            <span className="text-text-3">{alliance.name}</span>
          ) : (
            <span className="text-text-3">{t("overview.noAlliance")}</span>
          )}
        </div>
        {helpedBy.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="text-[11px] text-text-3">{t("overview.helpedBy")}</div>
            {helpedBy.map((h, i) => (
              <div key={i} className="text-xs text-text-2">
                💛 <Bdi dir="ltr">{h.fromColonyName}</Bdi> · <Bdi dir="ltr">+{h.minutes}m</Bdi>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-text-3">{t("overview.allianceSoon")}</p>
        <button
          onClick={onOpenAlliance}
          className="mt-2 rounded-lg bg-sky-400/15 border border-sky-400/40 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-400/25"
        >
          {t("overview.openAlliance")}
        </button>
      </Section>
    </Panel>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function TimerRow({
  t,
  now,
  label,
  sub,
  startedAt,
  baseMs,
  tokenMs,
  speedup,
  onSpeedup,
}: {
  t: ReturnType<typeof useT>;
  now: number;
  label: string;
  sub?: string;
  startedAt: number;
  baseMs: number;
  tokenMs: number;
  speedup?: { kind: SpeedupKind; id: string; heldSizes: readonly EarnedTimeTokenSizeId[] };
  onSpeedup?: (kind: SpeedupKind, id: string, sizeId: EarnedTimeTokenSizeId) => void;
}) {
  // EFFECTIVE finish: tokens already applied pull it forward; doneAt/base
  // records never move, so the floor math stays honest (time-tokens.ts).
  const finish = startedAt + baseMs - tokenMs;
  const left = Math.max(0, finish - now);
  const pct = baseMs > 0 ? Math.min(100, Math.max(0, ((baseMs - left) / baseMs) * 100)) : 100;
  return (
    <div className="rounded-lg bg-white/[0.03] p-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 text-xs text-text-1">
          <span className="font-medium">{label}</span>
          {sub && <span className="ms-2 text-text-3">{sub}</span>}
        </div>
        <div className="shrink-0 text-[11px] text-amber-200/90">
          <Bdi dir="ltr">{fmtDuration(t, left)}</Bdi>
        </div>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-amber-400/80" style={{ width: `${pct}%` }} />
      </div>
      {speedup && onSpeedup && speedup.heldSizes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-text-3">{t("overview.speedup")}:</span>
          {speedup.heldSizes.map((s) => (
            <button
              key={s}
              onClick={() => onSpeedup(speedup.kind, speedup.id, s)}
              className="rounded-md bg-cyan-400/10 border border-cyan-400/30 px-2 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-400/20"
              title={t("overview.speedupTitle", { size: s })}
            >
              ⏩ <Bdi dir="ltr">{s}</Bdi>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// bidi-isolated run for latin numerals inside RTL text (§11.4).
function Bdi({ dir, children }: { dir?: "ltr" | "rtl"; children: React.ReactNode }) {
  return <bdi dir={dir}>{children}</bdi>;
}
