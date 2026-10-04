// CradleAlliance — the alliance hub on the Cradle page (owner 2026-10-02).
//
// Hans: "join alliance button on the cradle page and then once you join
// alliance then on the cradle page it'll show what alliance you're in and
// who needs help ... what's building in the alliance ... and research as
// well ... where you have the open alliance button and you can open the
// alliance all of that information should be there."
//
// So: not in an alliance -> a Join Alliance button. In an alliance -> the
// war band's name, member count, who needs help (help ticks), what's
// building in the ship factory, and research — plus an "Open alliance"
// button that navigates to the dedicated ALLIANCE page (owner 2026-10-04:
// "don't be afraid to make pages"). No duplication: the full page is the
// same AlliancePanel sections, reused by AllianceTab.
import { useMemo, useState } from "react";
import type { GameState } from "../game/types";
import type { GameResult } from "../game/api";
import {
  ALLIANCE_CONFIG,
  allianceOf,
  helpRemaining,
  memberRole,
  type Alliance,
  type AllianceRole,
} from "../game/war/alliances";
import { helpTickFn } from "../game/api";
import { techText, leaderName } from "../game/research";
import { Panel } from "./ui/Panel";
import { ActionButton } from "./ui/ActionButton";
import { Icon } from "./icons";
import { useT } from "./i18n/I18n";
import { Bdi } from "./ui/Bdi";
import { AllianceShipyardSection } from "./AllianceShipyard";

type Act = (fn: () => Promise<GameResult>, label: string) => void;

const ROLE_LABEL: Record<AllianceRole, string> = { leader: "Leader", officer: "Officer", member: "Member" };

function fmtLeft(ms: number): string {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export default function CradleAllianceSection({
  state,
  now,
  token,
  onAction,
  onOpenAlliance,
}: {
  state: GameState;
  now: number;
  token?: string;
  onAction: Act;
  onOpenAlliance?: () => void;
}) {
  const t = useT();
  const me = state.gameId ?? "";
  const alliance = useMemo(() => (me ? allianceOf(state, me) : null), [state, me]);
  if (!me) return null;
  // The war band has its own page now (owner 2026-10-04) — this hub is the
  // summary; "Open alliance" takes you to the full Alliance tab.
  const openAlliance = onOpenAlliance ?? (() => {});

  return (
    <Panel testid="cradle-alliance" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-text-1">
          <Icon name="shield" size={15} aria-hidden="true" />
          {t("cradleAlliance.title", "War band")}
        </h3>
        {alliance && (
          <span className="chip border border-line text-text-2">
            <Bdi dir="ltr" className="num">{alliance.members.length}/{ALLIANCE_CONFIG.sizeCap}</Bdi>{" "}
            {t("cradleAlliance.sworn", "sworn")}
          </span>
        )}
      </div>

      {!alliance ? (
        <>
          <p className="text-[13px] text-text-2">
            {t(
              "cradleAlliance.joinBlurb",
              "No colony stands alone — join a war band for rallies, reinforcements, help ticks, and the ship factory.",
            )}
          </p>
          <ActionButton
            full
            size="md"
            icon="shield"
            label={t("cradleAlliance.join", "Join Alliance")}
            sub={t("cradleAlliance.joinSub", "Browse war bands, answer invites, or found your own.")}
            onClick={openAlliance}
            testid="cradle-alliance-join"
          />
        </>
      ) : (
        <>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-text-1">
              <span aria-hidden="true">{alliance.banner || "⚔️"}</span> {alliance.name}
            </p>
            {alliance.motto ? <p className="text-[12px] italic text-text-3">“{alliance.motto}”</p> : null}
            <p className="mt-1 text-[11px] text-text-2">
              {t("cradleAlliance.youAre", "You are {role}", { role: ROLE_LABEL[memberRole(alliance, me) ?? "member"] })}
            </p>
          </div>

          <HelpBlock state={state} now={now} me={me} alliance={alliance} token={token} onAction={onAction} />

          <AllianceShipyardSection alliance={alliance} now={now} me={me} state={state} token={token} onAction={onAction} />

          <ResearchBlock state={state} now={now} />

          <ActionButton
            full
            size="md"
            variant="secondary"
            icon="shield"
            label={t("cradleAlliance.open", "Open alliance")}
            sub={t("cradleAlliance.openSub", "Reverb feed, members, rallies, reinforcements, the ship factory — the full war band page.")}
            onClick={openAlliance}
            testid="cradle-alliance-open"
          />
        </>
      )}

    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Help ticks: who needs a hand. Hans's rule — the button is ALWAYS rendered
// and tappable; with no ticks left (or no login) the tap explains why,
// inline, directly under the button.
// ---------------------------------------------------------------------------
function HelpBlock({
  state,
  now,
  me,
  alliance,
  token,
  onAction,
}: {
  state: GameState;
  now: number;
  me: string;
  alliance: Alliance;
  token?: string;
  onAction: Act;
}) {
  const t = useT();
  const [hintFor, setHintFor] = useState<string | null>(null);
  const remaining = helpRemaining(state, now);
  const mates = alliance.members.filter((m) => m.colonyId !== me);
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2">
        {t("cradleAlliance.helpTitle", "Help ticks")}{" "}
        <span className="font-normal normal-case">
          {t("cradleAlliance.helpLeft", "{n}/5 today — buildings & research only, never troops", { n: remaining })}
        </span>
      </h4>
      {mates.length === 0 ? (
        <p className="text-xs text-text-2">{t("cradleAlliance.noMates", "Just you so far — invite colonies to grow the war band.")}</p>
      ) : (
        <ul className="space-y-1">
          {mates.map((m) => (
            <li key={m.colonyId} className="rounded-lg border border-line bg-surf-1 px-3 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-text-1">
                  {m.colonyName}
                  <span className="ms-2 rounded-full border border-line px-2 py-0.5 text-[10px] text-text-2">
                    {ROLE_LABEL[m.role] ?? m.role}
                  </span>
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] text-text-2"
                  onClick={() => {
                    if (!token || remaining <= 0) {
                      setHintFor(m.colonyId);
                      return;
                    }
                    setHintFor(null);
                    onAction(
                      () => helpTickFn({ data: { token, targetId: m.colonyId, targetName: m.colonyName } }),
                      "help",
                    );
                  }}
                >
                  {t("cradleAlliance.lendHand", "Lend a hand")}
                </button>
              </div>
              {hintFor === m.colonyId && (
                <p className="mt-1 text-xs text-amber-200">
                  {!token
                    ? t("cradleAlliance.noToken", "Log in to lend a hand.")
                    : t("cradleAlliance.noTicks", "No help ticks left today — they refresh with the new day.")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Research: the colony's own running research — this is what alliance help
// ticks shave time off. (There is no alliance-level research entity; the
// help lands on each colony's build/research timers.)
// ---------------------------------------------------------------------------
function ResearchBlock({ state, now }: { state: GameState; now: number }) {
  const t = useT();
  const researching = (state.researchJobs ?? []).filter((j) => j.status === "researching");
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2">
        {t("cradleAlliance.researchTitle", "Research")}
      </h4>
      {researching.length === 0 ? (
        <p className="text-xs text-text-2">
          {t("cradleAlliance.noResearch", "No research running — the Lab is where it starts.")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {researching.map((j) => {
            const total = Math.max(1, j.durationMs);
            const pct = Math.max(0, Math.min(100, Math.round(((now - j.startedAt) / total) * 100)));
            const leader = (state.leaders ?? []).find((l) => l.id === j.leaderId);
            return (
              <li key={j.id} className="rounded-lg border border-line bg-surf-1 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-text-1">
                    {techText(t, j.techId, "name", j.techId)}
                  </span>
                  <span className="shrink-0 text-[11px] text-text-2">
                    <Bdi dir="ltr" className="num">{pct}%</Bdi> · {fmtLeft(j.startedAt + j.durationMs - now)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surf-3">
                  <div className="h-full rounded-full bg-acc" style={{ width: `${pct}%` }} />
                </div>
                {leader ? (
                  <p className="mt-1 text-[11px] text-text-2">{leaderName(t, leader)}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-1.5 text-[11px] text-text-3">
        {t("cradleAlliance.researchNote", "Alliance help ticks shave these timers.")}
      </p>
    </div>
  );
}
