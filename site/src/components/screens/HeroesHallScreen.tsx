// HeroesHallScreen — the Heroes & Leaders Hall (owner 2026-10-12).
//
// One module, one page: the spot that shows the colony's heroes and leaders —
// their attributes, their tiers, and how they level with experience. The Hall
// DISPLAYS the systems that own the numbers (heroes-data / hero-xp /
// leader-xp / war playbook, joined by game/heroes-hall.ts); it invents no
// figure of its own, and it sells nothing — heroes are earned by deeds or an
// Oracle's vouch, leaders grow on what they survive, and the unwon stand in
// this Hall as silhouettes with the deed that wins them written underneath.
//
// Skin: the CradleSkin template (race skin behind, content above), at a
// lower opacity than the Cradle home — this is a roster/inspection page and
// the text has to stay readable on a phone.
import type { ReactNode } from "react";
import { Panel } from "../ui/Panel";
import { Icon } from "../icons";
import CradleSkin from "../CradleSkin";
import { useT } from "../i18n/I18n";
import { Bdi } from "../ui/Bdi";
import { engineHelpers } from "../../game/client-utils";
import { getRace } from "../../game/races";
import { SPECIALTY_LABEL } from "../../game/research";
import { DEED_BY_ID, deedText, heroText, skillText } from "../../game/heroes-data";
import {
  HERO_SPECIALIZATION_BY_ID,
  canChooseHeroSpec,
  heroLevel,
  heroXpForLevel,
  specText,
  type HeroUnit,
} from "../../game/hero-xp";
import type { HeroAttributes } from "../../game/heroes-data";
import { SPECIALIZATION_BY_ID, SPECIALIZATION_MILESTONE, MAX_LEVEL } from "../../game/leader-xp";
import {
  buildHeroRoster,
  deedTierLadder,
  levelLadder,
  HERO_XP_SOURCE_ROWS,
  LEADER_XP_SOURCE_ROWS,
  HALL_DAILY_XP_CAP,
  type HeroHallEntry,
} from "../../game/heroes-hall";
import type { GameState, Leader } from "../../game/types";
import type { PrologueFate } from "../../game/prologue/prologue-state";
import type { T } from "../../game/i18n/types";

const HERO_ATTRS = ["power", "guard", "craft", "presence"] as const;
const LEADER_ATTRS = ["research", "economy", "combat", "engineering"] as const;

function XpBar({ pct, accent }: { pct: number; accent?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surf-3" role="presentation">
      <div
        className="h-full rounded-full bg-ember"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, ...(accent ? { background: accent } : {}) }}
      />
    </div>
  );
}

function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="space-y-0.5">
      <h3 className="text-[15px] font-semibold text-text-1">{children}</h3>
      {sub ? <p className="text-[11px] leading-snug text-text-3">{sub}</p> : null}
    </div>
  );
}

// ---- Leaders ---------------------------------------------------------------
function LeaderCard({ leader, t, accent }: { leader: Leader; t: T; accent?: string }) {
  const level = engineHelpers.leaderLevel(leader);
  const toNext = engineHelpers.xpToNext(leader);
  const spec = leader.specialization ? SPECIALIZATION_BY_ID[leader.specialization] : null;
  return (
    <Panel variant="raised" className="space-y-2 p-3" testid={`hall-leader-${leader.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-text-1">{leader.name}</p>
          <p className="text-[11px] text-text-3">{leader.title ?? SPECIALTY_LABEL[leader.specialty]}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="chip border border-line text-text-2">{t("hall.level", { n: level })}</span>
          <span className="text-[10px] uppercase tracking-wide text-text-3">{t(`hall.status.${leader.status}`, leader.status)}</span>
        </div>
      </div>
      <XpBar pct={engineHelpers.xpProgress(leader) * 100} accent={accent} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-3">
        <span>{toNext === null ? t("hall.xpMaxed") : t("hall.xpToNext", { n: toNext, level: level + 1 })}</span>
        <span>{t("hall.todayXp", { x: engineHelpers.todayXp(leader), cap: HALL_DAILY_XP_CAP })}</span>
        {(leader.unspentPoints ?? 0) > 0 ? (
          <span className="text-ember-soft">{t("hall.unspentPoints", { n: leader.unspentPoints })}</span>
        ) : null}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {LEADER_ATTRS.map((attr) => (
          <div key={attr} className="rounded-lg border border-line bg-surf-3/60 px-1.5 py-1 text-center">
            <div className="text-[12px] font-semibold text-text-1">
              <Bdi dir="ltr" className="num">{leader.attributes[attr]}</Bdi>
            </div>
            <div className="truncate text-[9px] uppercase tracking-wide text-text-3">{t(`rviews.attrLabel.${attr}`, attr)}</div>
          </div>
        ))}
      </div>
      {spec ? (
        <p className="text-[11px] text-text-2">
          {spec.icon} <b>{specText(t, spec.id, "mandate", spec.mandate)}</b>
        </p>
      ) : (
        <p className="text-[11px] text-text-3">
          {level >= SPECIALIZATION_MILESTONE
            ? t("hall.specPending", { n: SPECIALIZATION_MILESTONE })
            : t("hall.specAtLevel", { n: SPECIALIZATION_MILESTONE })}
        </p>
      )}
    </Panel>
  );
}

// ---- Heroes ----------------------------------------------------------------
function HeroAttrs({ attrs, t, base }: { attrs: HeroAttributes; t: T; base?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-text-3">{base ? t("hall.startAttrs") : t("hall.attrs")}</p>
      <div className="grid grid-cols-4 gap-1.5">
        {HERO_ATTRS.map((attr) => (
          <div key={attr} className="rounded-lg border border-line bg-surf-3/60 px-1.5 py-1 text-center">
            <div className="text-[12px] font-semibold text-text-1">
              <Bdi dir="ltr" className="num">{attrs[attr] ?? 0}</Bdi>
            </div>
            <div className="truncate text-[9px] uppercase tracking-wide text-text-3">{t(`hall.attr.${attr}`, attr)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeroSkills({ entry, t }: { entry: HeroHallEntry; t: T }) {
  const { def } = entry;
  if (def.skills.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-text-3">{t("hall.skills")}</p>
      {def.skills.map((skill) => (
        <p key={skill.id} className="text-[11px] leading-snug text-text-2">
          <b className="text-text-1">{skillText(t, skill, "name", skill.name)}</b>
          {" — "}
          {skillText(t, skill, "effect", skill.effect)}
        </p>
      ))}
    </div>
  );
}

function EarnedHeroCard({ entry, fate, t, accent }: { entry: HeroHallEntry; fate: PrologueFate | null; t: T; accent?: string }) {
  const { def } = entry;
  const unit = entry.unit as HeroUnit;
  const level = heroLevel(unit);
  const atCap = level >= MAX_LEVEL;
  const curFloor = heroXpForLevel(level);
  const nextFloor = heroXpForLevel(level + 1);
  const pct = atCap || nextFloor <= curFloor ? 100 : ((unit.xp - curFloor) / (nextFloor - curFloor)) * 100;
  const earnedDeed = DEED_BY_ID[unit.earnedBy];
  const spec = unit.specialization ? HERO_SPECIALIZATION_BY_ID[unit.specialization] : null;
  return (
    <Panel variant="raised" className="space-y-2 p-3" testid={`hall-hero-${def.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-text-1">{heroText(t, def, "name", def.name)}</p>
          <p className="text-[11px] italic leading-snug text-text-3">{heroText(t, def, "identity", def.identity)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="chip border border-line text-text-2">{t("hall.level", { n: level })}</span>
          <span className="text-[10px] uppercase tracking-wide text-text-3">
            {t(`hall.role.${def.role}`, def.role)} · {t(`hall.tier.${entry.tier}`, entry.tier)}
          </span>
        </div>
      </div>
      <XpBar pct={pct} accent={accent} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-3">
        <span>{atCap ? t("hall.xpMaxed") : t("hall.xpToNext", { n: nextFloor - unit.xp, level: level + 1 })}</span>
        {(unit.unspentPoints ?? 0) > 0 ? (
          <span className="text-ember-soft">{t("hall.unspentPoints", { n: unit.unspentPoints })}</span>
        ) : null}
      </div>
      <HeroAttrs attrs={unit.attributes} t={t} />
      <HeroSkills entry={entry} t={t} />
      {spec ? (
        <p className="text-[11px] text-text-2">
          {spec.icon} <b>{specText(t, spec.id, "mandate", spec.mandate)}</b>
        </p>
      ) : canChooseHeroSpec(unit) ? (
        <p className="text-[11px] text-text-3">{t("hall.specPending", { n: SPECIALIZATION_MILESTONE })}</p>
      ) : null}
      {earnedDeed ? (
        <p className="text-[11px] text-text-3">{t("hall.earnedBy", { deed: deedText(t, earnedDeed, "name", earnedDeed.name) })}</p>
      ) : null}
      {fate ? (
        <p className="border-t border-line pt-1.5 text-[11px] italic text-amber-200/80">
          {fate === "fallen" ? t("hall.fate.fallen") : t("hall.fate.unfound")}
        </p>
      ) : null}
    </Panel>
  );
}

function LockedHeroCard({ entry, t }: { entry: HeroHallEntry; t: T }) {
  const { def, paths } = entry;
  return (
    <Panel variant="inset" className="space-y-2 p-3 opacity-80" testid={`hall-hero-locked-${def.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-text-2">
            <Icon name="lock" size={12} className="shrink-0 text-text-3" aria-hidden="true" />
            {heroText(t, def, "name", def.name)}
          </p>
          <p className="text-[11px] italic leading-snug text-text-3">{heroText(t, def, "identity", def.identity)}</p>
        </div>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-3">
          {t(`hall.role.${def.role}`, def.role)} · {t(`hall.tier.${entry.tier}`, entry.tier)}
        </span>
      </div>
      <HeroAttrs attrs={def.baseAttributes} t={t} base />
      <HeroSkills entry={entry} t={t} />
      <div className="space-y-1 border-t border-line pt-1.5">
        <p className="text-[10px] uppercase tracking-wide text-text-3">{t("hall.deedPath")}</p>
        {paths.deeds.map((deed, i) => (
          <p key={deed.id} className="text-[11px] leading-snug text-text-2">
            <b className="text-text-1">
              {i === 0
                ? deedText(t, deed, "name", deed.name)
                : t("hall.alsoVia", { deed: deedText(t, deed, "name", deed.name) })}
            </b>
            {": "}
            {deedText(t, deed, "condition", deed.condition)}
          </p>
        ))}
        <p className="text-[11px] leading-snug text-text-3">{t("hall.vouchPath")}</p>
      </div>
    </Panel>
  );
}

// ---- The screen --------------------------------------------------------------
export default function HeroesHallScreen({ state }: { state: GameState; now: number }) {
  const t = useT();
  const race = state.race ? getRace(state.race) : null;
  const accent = race?.accent;
  const leaders = state.leaders ?? [];
  const prologueHeroes = state.prologue?.heroes ?? [];
  const fateById = new Map(prologueHeroes.map((h) => [h.id, h.fate]));
  const roster = buildHeroRoster(prologueHeroes);
  const earned = roster.filter((e) => e.earned);
  const locked = roster.filter((e) => !e.earned);
  const tiers = deedTierLadder();
  const ladder = levelLadder();
  const bestLeaderLevel = leaders.reduce((m, l) => Math.max(m, engineHelpers.leaderLevel(l)), 0);

  return (
    <CradleSkin raceId={state.race} opacity={0.55}>
      <main className="mx-auto w-full max-w-6xl space-y-3 px-3 py-3 sm:px-4" data-testid="heroes-hall">
        <header className="space-y-1 pt-1">
          <h2 className="text-lg font-bold text-text-1">{t("hall.title", "Heroes & Leaders")}</h2>
          <p className="text-[12px] text-text-2">{t("hall.sub")}</p>
          <p className="text-[11px] leading-snug text-text-3">{t("hall.doctrine")}</p>
        </header>

        {/* ---- Leaders ---------------------------------------------------- */}
        <section className="space-y-2" aria-label={t("hall.leadersTitle")}>
          <SectionTitle>{t("hall.leadersTitle")}</SectionTitle>
          {leaders.length === 0 ? (
            <Panel variant="inset" className="p-3">
              <p className="text-[12px] text-text-3">{t("hall.leadersEmpty")}</p>
            </Panel>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {leaders.map((l) => (
                <LeaderCard key={l.id} leader={l} t={t} accent={accent} />
              ))}
            </div>
          )}
        </section>

        {/* ---- Heroes ------------------------------------------------------ */}
        <section className="space-y-2" aria-label={t("hall.heroesTitle")}>
          <SectionTitle sub={t("hall.waveNote")}>{t("hall.heroesTitle")}</SectionTitle>
          {earned.length > 0 ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-2">{t("hall.earnedTitle")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {earned.map((e) => (
                  <EarnedHeroCard key={e.def.id} entry={e} fate={fateById.get(e.def.id) ?? null} t={t} accent={accent} />
                ))}
              </div>
            </>
          ) : null}
          {locked.length > 0 ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-2">{t("hall.lockedTitle")}</p>
              <p className="text-[11px] text-text-3">{t("hall.lockedNote")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {locked.map((e) => (
                  <LockedHeroCard key={e.def.id} entry={e} t={t} />
                ))}
              </div>
            </>
          ) : null}
        </section>

        {/* ---- Deed tiers --------------------------------------------------- */}
        <section className="space-y-2" aria-label={t("hall.tierTitle")}>
          <SectionTitle sub={t("hall.tierSub")}>{t("hall.tierTitle")}</SectionTitle>
          <Panel className="divide-y divide-line p-0" testid="hall-deed-tiers">
            {tiers.map((row) => (
              <div key={row.tier} className="space-y-1 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[12px] font-semibold text-text-1">{t(`hall.tier.${row.tier}`, row.tier)}</p>
                  <span className="text-[10px] text-text-3">
                    {row.weeks !== null ? t("hall.tierWeeks", { n: row.weeks }) : t("hall.tierVouchWeeks")}
                  </span>
                </div>
                <p className="text-[11px] leading-snug text-text-2">
                  {row.deeds.map((d) => deedText(t, d, "name", d.name)).join(" · ")}
                </p>
                {row.heroIds.length > 0 ? (
                  <p className="text-[11px] text-text-3">
                    {t("hall.tierHeroes", {
                      names: row.heroIds
                        .map((id) => {
                          const def = roster.find((e) => e.def.id === id)?.def;
                          return def ? heroText(t, def, "name", def.name) : id;
                        })
                        .join(", "),
                    })}
                  </p>
                ) : null}
              </div>
            ))}
          </Panel>
        </section>

        {/* ---- Level ladder -------------------------------------------------- */}
        <section className="space-y-2" aria-label={t("hall.ladderTitle")}>
          <SectionTitle sub={t("hall.ladderSub", { n: SPECIALIZATION_MILESTONE })}>{t("hall.ladderTitle")}</SectionTitle>
          <Panel className="divide-y divide-line p-0" testid="hall-level-ladder">
            {ladder.map((row) => (
              <div
                key={row.level}
                className={`space-y-0.5 px-3 py-2 ${row.level === bestLeaderLevel ? "bg-ember/5" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[12px] font-semibold text-text-1">
                    {t("hall.level", { n: row.level })}
                    {row.level === bestLeaderLevel ? (
                      <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-ember-soft">
                        {t("hall.ladderYouHere")}
                      </span>
                    ) : null}
                  </p>
                  <span className="text-[10px] text-text-3">{t("hall.ladderXp", { n: row.xpRequired })}</span>
                </div>
                {row.isMilestone ? (
                  <p className="text-[11px] leading-snug text-amber-200/90">{t("hall.ladderMilestone")}</p>
                ) : null}
                <p className="text-[11px] leading-snug text-text-3">
                  {row.newPlays.length > 0
                    ? t("hall.ladderPlays", { names: row.newPlays.map((p) => p.name).join(", ") })
                    : t("hall.ladderPlaysNone")}
                </p>
              </div>
            ))}
          </Panel>
        </section>

        {/* ---- How XP is earned ---------------------------------------------- */}
        <section className="space-y-2" aria-label={t("hall.xpTitle")}>
          <SectionTitle sub={t("hall.xpCapNote", { cap: HALL_DAILY_XP_CAP })}>{t("hall.xpTitle")}</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            <Panel className="space-y-1.5 p-3" testid="hall-xp-leaders">
              <p className="text-[12px] font-semibold text-text-1">{t("hall.xpLeaderTitle")}</p>
              {LEADER_XP_SOURCE_ROWS.map((row) => (
                <div key={row.id} className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="text-text-2">{t(`hall.xpSrc.${row.id}`)}</span>
                  <b className="shrink-0 text-text-1">
                    <Bdi dir="ltr" className="num">{t("hall.xpAmount", { n: row.xp })}</Bdi>
                  </b>
                </div>
              ))}
            </Panel>
            <Panel className="space-y-1.5 p-3" testid="hall-xp-heroes">
              <p className="text-[12px] font-semibold text-text-1">{t("hall.xpHeroTitle")}</p>
              {HERO_XP_SOURCE_ROWS.map((row) => (
                <div key={row.id} className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="text-text-2">{t(`hall.xpSrc.${row.id}`)}</span>
                  <b className="shrink-0 text-text-1">
                    <Bdi dir="ltr" className="num">{t("hall.xpAmount", { n: row.xp })}</Bdi>
                  </b>
                </div>
              ))}
            </Panel>
          </div>
        </section>
      </main>
    </CradleSkin>
  );
}
