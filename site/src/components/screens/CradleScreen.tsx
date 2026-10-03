// CradleScreen — the home surface (game-ui-shell-spec §2, the reference
// implementation the other screens follow).
//
// The colony lands on a BASE VIEW, not a dashboard: the plate of six building
// tiles, the advance bar, the status strip, the day's Devotion, the roster, the
// workshop shelf, the stores band, the Codex and the Chronicle. Nothing from
// the old Cradle tab is dropped (§3.5) — every number, button and modal that
// lived there lives here, re-shaped at 44/48px and token-only.
//
// PRESENTATION ONLY: the screen owns no state beyond which sheet is open. Every
// figure comes from `state`, every predicate from the shared helpers
// (engineHelpers.domainAffordable / suppliesPerMinute / leaderLevel / xpProgress),
// and no new field is invented anywhere — least of all the Act I clock line,
// which is a RESERVED, EMPTY element until the engine exposes accumulated
// active play time (§8.8).
import { useState } from "react";
import type { ReactNode } from "react";
import { Panel } from "../ui/Panel";
import { ActionButton } from "../ui/ActionButton";
import { StatTile } from "../ui/StatTile";
import { RosterCard, RosterEmpty } from "../ui/RosterCard";
import { HEROES, racePortrait } from "../HeroCard";
import { RowButton } from "../ui/RowButton";
import { Sheet, SheetHeader } from "../Sheet";
import { Icon } from "../icons";
import { Tooltip } from "../Tooltip";
import { JournalButton } from "../JournalButton";
import { engineHelpers } from "../../game/client-utils";
import { CRADLE_SLOTS, kitsHeld } from "../../game/cradle-slots";
import { canForgeAlloy, alloyRecipeRaces } from "../../game/engine";
import { RACES, getRace } from "../../game/races";
import { slotLabel } from "../../game/i18n";
// The ONE date formatter: it pins `nu-latn`, so a Persian device cannot turn a
// dated row into  ۱۴۰۵/۰۷/۰۶  — §11.4's "western digits only" promise.
import { formatDate } from "../../game/i18n/format";
// The render-time splitter: a translated VALUE whose numerals must each be their
// own isolated run. `joinValue` is the same split for a string-only sink (a
// `title=`), where there is no element to wrap.
import { joinValue } from "../../game/i18n/split";
import { ForgeDoor, ForgeRoom } from "../ForgeViews";
import CradleOverview, { type SpeedupKind } from "../CradleOverview";
import SlotSheet from "../SlotSheet";
import type { EarnedTimeTokenSizeId } from "../../game/time-tokens";
import { sound } from "../../game/sound";
import { useT } from "../i18n/I18n";
import { SplitValue } from "../i18n/SplitValue";
import { DAILY_ITEM_BY_ID, dailyItemLabelT } from "../../game/daily";
import { SPECIALTY_LABEL, specialtyLabel, leaderName } from "../../game/research";
import { DEED_BY_ID } from "../../game/heroes-data";
import { heroLevel, heroXpForLevel } from "../../game/hero-xp";
import {
  tipT, tipField, METER_TIPS, LAB_TIPS, RESOURCE_TIPS,
} from "../../game/tooltips";
import type { CradleSlotId } from "../../game/cradle-slots";
import type { GameState, DomainId } from "../../game/types";
import type { GameResult } from "../../game/api";
import { Bdi } from "../ui/Bdi";
import CradleAllianceSection from "../CradleAlliance";

const HERO_ROLE_WORD: Record<string, string> = {
  tank: "Tank",
  damage: "Damage",
  support: "Support",
  utility: "Utility",
  econwar: "Econ war",
};

/** The next advance the stores can actually pay for, and what it costs. */
function nextAdvance(state: GameState) {
  const domains = CRADLE_SLOTS.filter((s) => s.domain);
  const affordable = domains.find((s) => s.ready(state));
  const pick = affordable ?? domains.reduce((a, b) => {
    const ca = engineHelpers.deployCost(state, a.domain as DomainId);
    const cb = engineHelpers.deployCost(state, b.domain as DomainId);
    return ca.embers <= cb.embers ? a : b;
  });
  const domain = pick.domain as DomainId;
  const cost = engineHelpers.deployCost(state, domain);
  return { slot: pick, cost, affordable: !!affordable };
}

export default function CradleScreen({
  state,
  now,
  timeTokens,
  onPurify,
  onSpeedup,
  onOpenAlliance,
  onClaim,
  tokenGrant,
  supplyGrant,
  onDeploy,
  onOpenCodex,
  onForgeRoll,
  onForgeMelt,
  forgeBusy,
  onField,
  onLeaveHeight,
  canLeaveHeight,
  token,
  onAction,
}: {
  state: GameState;
  now: number;
  /** public time-token holdings (sizeId -> count) for the overview's speedups */
  timeTokens: Record<string, number>;
  onPurify: (n: number) => void;
  onSpeedup: (kind: SpeedupKind, id: string, sizeId: EarnedTimeTokenSizeId) => void;
  onOpenAlliance: () => void;
  onClaim: () => void;
  /** TIME TOKENS received by the claim that just landed (owner 2026-09-27). */
  tokenGrant?: Record<string, number> | null;
  /** SUPPLIES received by the claim that just landed (owner 2026-10-01) —
   *  the daily login boost. */
  supplyGrant?: number | null;
  onDeploy: (d: DomainId) => void;
  onOpenCodex: () => void;
  /** THE FORGE (owner 2026-09-26): the roll is a server operation — the room
   *  hands up a recipe id and a fresh request id and nothing else. */
  onForgeRoll: (recipeId: string, requestId: string) => void;
  onForgeMelt: (itemId: string) => void;
  forgeBusy: boolean;
  /** the Fall's front door (tab battles) */
  onField: () => void;
  onLeaveHeight: () => void;
  canLeaveHeight: boolean;
  /** auth token for alliance actions (help ticks, etc.) */
  token?: string;
  /** server-action poster (mirrors BattlesTab's onAction) */
  onAction: (fn: () => Promise<GameResult>, label: string) => void;
}) {
  const t = useT();
  const race = getRace(state.race!);
  const r = state.resources;
  const [sheet, setSheet] = useState<null | { kind: "slot" | "leader" | "hero" | "forge"; id: string }>(null);
  const close = () => setSheet(null);
  const adv = nextAdvance(state);
  const recipe = alloyRecipeRaces(state);
  const atHeight = state.prologue?.stage === "height";
  const squad = state.prologue?.squad ?? [];
  const heroes = (state.prologue?.heroes ?? []).filter((h) => squad.includes(h.id));

  return (
    <main className="mx-auto w-full max-w-6xl px-3 py-3 sm:px-4">
      <div className="home-columns space-y-3">
        <div className="space-y-3">
          {/* ---- B1 · the Act I plate (only at the height) ------------------ */}
          {atHeight ? (
            <Panel variant="tinted" testid="act1-banner" className="space-y-3">
              <div className="min-w-0">
                <p className="eyebrow">The Fall · The Height</p>
                <p className="mt-1 text-[13px] text-text-1">
                  The Last Academy holds the Ashline at full strength. Its front is live.
                </p>
              </div>
              {/* RESERVED: the accumulated active-play clock line (§8.8). The
                  engine exposes no such field yet, so this stays EMPTY — an
                  honest placeholder is not the same as an invented number. */}
              <p data-slot="height-clock" className="hidden" aria-hidden="true" />
              <div className="flex flex-wrap items-center gap-2">
                <ActionButton
                  label="Open the front"
                  sub="The Ashline is live — the war is where you are needed"
                  icon="sword"
                  size="md"
                  testid="act1-open-front"
                  dataAction="openFront"
                  onClick={onField}
                  className="flex-1"
                />
                {canLeaveHeight ? (
                  <ActionButton
                    label="Return to your colony"
                    variant="ghost"
                    size="sm"
                    testid="act1-leave"
                    dataAction="leaveHeight"
                    ariaLabel="Return to your colony"
                    onClick={onLeaveHeight}
                  />
                ) : null}
              </div>
            </Panel>
          ) : null}

          {/* ---- B2 · the Cradle overview (owner 2026-10-01: the name plate +
              its domain tiles moved to the Exploration page; the overview
              takes the top of the Cradle page) --------------------------- */}
          <CradleOverview
            state={state}
            now={now}
            timeTokens={timeTokens}
            onSpeedup={onSpeedup}
            onOpenAlliance={onOpenAlliance}
          />

          {/* ---- B2b · the war band (owner 2026-10-02): TEMPORARILY DISABLED
              due to crash — re-enable after fix ------------------- */}
          {false && (
          <CradleAllianceSection
            state={state}
            now={now}
            token={token}
            onAction={onAction}
          />
          )}

          {/* ---- B3 · the advance bar (the screen's middle action) ---------- */}
          <div data-testid="advance-bar">
            <ActionButton
              full
              size="md"
              icon="gear"
              label={
                adv.affordable
                  ? t("cradle.advanceTo", { slot: slotLabel(t, adv.slot), level: adv.slot.level(state) + 1 })
                  : t("cradle.advance")
              }
              sub={t("cradle.advanceSub", {
                embers: adv.cost.embers.toLocaleString(),
                insight: adv.cost.insight.toLocaleString(),
              })}
              locked={!adv.affordable}
              reason={t("cradle.advanceLocked", {
                embers: adv.cost.embers.toLocaleString(),
                insight: adv.cost.insight.toLocaleString(),
              })}
              onClick={() => setSheet({ kind: "slot", id: adv.slot.id })}
            />
          </div>

          {/* ---- B4 · the status strip ------------------------------------- */}
          <Panel testid="status-strip" className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <StatTile
                label={t("cradle.corruption")}
                icon="beacon"
                value={<Bdi dir="ltr" className="num">{`${Math.round(state.corruption)}%`}</Bdi>}
                meter={{ value: state.corruption, danger: state.corruption > 50 }}
              />
              <StatTile
                label={t("cradle.chorusAttention")}
                icon="shield"
                value={<Bdi dir="ltr" className="num">{`${Math.round(state.chorusAttention)}%`}</Bdi>}
                meter={{ value: state.chorusAttention, danger: state.chorusAttention > 50 }}
              />
            </div>
            <Tooltip className="w-full" content={tipT(t, "lab", "purify", LAB_TIPS.purify)}>
              <ActionButton
                full
                size="md"
                variant="secondary"
                icon="spark"
                label={t("cradle.purify")}
                sub={
                  r.supplies < 10
                    ? t("cradle.purifySubStores", { n: Math.floor(r.supplies) })
                    : t("cradle.purifySub")
                }
                locked={r.supplies < 10}
                reason={t("cradle.purifyLocked", { n: Math.floor(r.supplies) })}
                onClick={() => onPurify(1)}
              />
            </Tooltip>
            <p className="text-[11px] text-text-3">{tipField(t, "meter", "corruption", "what", METER_TIPS.corruption.what)}</p>
          </Panel>
        </div>

        <div className="space-y-3">
          {/* ---- B5 · Today's Devotion ------------------------------------- */}
          <DevotionSection state={state} onClaim={onClaim} tokenGrant={tokenGrant} supplyGrant={supplyGrant} />

          {/* ---- B6 · the roster strip ------------------------------------ */}
          <Panel testid="roster-strip" className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-text-1">{t("cradle.leadersHeroes")}</h3>
              <span className="chip border border-line text-text-2">
                {t("cradle.sworn", { n: state.leaders.length })}
              </span>
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {state.leaders.length === 0 ? (
                <RosterEmpty text={t('cradle.noLeader')} />
              ) : (
                state.leaders.map((l) => (
                  <RosterCard
                    key={l.id}
                    kind="leader"
                    name={l.name}
                    roleLine={l.title ?? SPECIALTY_LABEL[l.specialty]}
                    level={engineHelpers.leaderLevel(l)}
                    pct={engineHelpers.xpProgress(l) * 100}
                    accent={race.accent}
                    portrait={state.race ? racePortrait(state.race) : undefined}
                    onClick={() => setSheet({ kind: "leader", id: l.id })}
                  />
                ))
              )}
              {!atHeight || heroes.length === 0 ? (
                <RosterEmpty text={t('cradle.noHero')} icon="sword" />
              ) : (
                heroes.map((h) => (
                  <RosterCard
                    key={h.id}
                    kind="hero"
                    name={h.name}
                    roleLine={HERO_ROLE_WORD[h.role] ?? h.role}
                    level={heroLevel(h)}
                    pct={
                      heroXpForLevel(heroLevel(h) + 1) > heroXpForLevel(heroLevel(h))
                        ? ((h.xp - heroXpForLevel(heroLevel(h))) /
                            (heroXpForLevel(heroLevel(h) + 1) - heroXpForLevel(heroLevel(h)))) * 100
                        : 100
                    }
                    accent={race.accent}
                    badge={DEED_BY_ID[h.earnedBy]?.name}
                    portrait={state.race ? HEROES[state.race].file : undefined}
                    onClick={() => setSheet({ kind: "hero", id: h.id })}
                  />
                ))
              )}
            </div>
          </Panel>

          {/* ---- B7 · (moved to top 2026-10-01: the overview now sits where the
              name plate was) ------------------------------------------------ */}
          {/* the workshop shelf moved to the Exploration page (owner 2026-09-30):
              the kits are expedition gear, so they live where expeditions launch. */}

          {/* ---- B7b · the inventory stores --------------------------------- */}
          <Panel testid="inventory-stores" className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-text-1">{t("cradle.stores")}</h3>
              <span className="text-[11px] text-text-3">{t("cradle.storesSub")}</span>
            </div>
            {/* owner 2026-10-01: the shelf scrolls — rows stay put, the panel never grows */}
            <div className="max-h-56 space-y-2 overflow-y-auto pe-1">
            {/* THE HOLDINGS (owner 2026-09-27: "we're missing an embers inventory I
                don't see how many embers I have"): the colony's OWN stock, in the same
                Panel and the same shape as the alloy row, so the shelf reads as one
                inventory. Every figure is the engine's — `state.resources.embers` is the
                holding, `totalEmbersLooted` in the stores band below is the lifetime
                statistic, and the two must never be read as the same number. */}
            <Tooltip className="w-full" content={tipT(t, "resource", "embers", RESOURCE_TIPS.embers)}>
              <div className="flex min-h-tap w-full items-center gap-2 rounded-xl border border-line bg-surf-3/60 px-3 py-2">
                <Icon name="flame" size={16} className="shrink-0 text-ember-soft" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-[12px] text-text-2">{t("resource.embers")}</span>
                <b className="shrink-0 text-[12px] text-text-1">
                  <Bdi dir="ltr" className="num">{Math.floor(r.embers).toLocaleString()}</Bdi>
                </b>
              </div>
            </Tooltip>
            <div className="flex min-h-tap items-center gap-2 rounded-xl border border-line bg-surf-3/60 px-3 py-2">
              <Icon name="gear" size={16} className="shrink-0 text-ember-soft" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-[12px] text-text-2">{t("cradle.kitsHeld")}</span>
              <b className="shrink-0 text-[12px] text-text-1">
                <Bdi dir="ltr" className="num">{kitsHeld(state)}</Bdi>
              </b>
            </div>
            {/* the alloy row — the cross-race recipe at a glance */}
            <div className="flex min-h-tap items-center gap-2 rounded-xl border border-line bg-surf-3/60 px-3 py-2">
              <Icon name="crate" size={16} className="shrink-0 text-ember-soft" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-[12px] text-text-2">
                {t("cradle.alloyLead")} <b className="text-text-1">{t("cradle.alloyBold")}</b>
                {t("cradle.alloyTail")}
              </span>
              {/* `num` rides on the isolated run only: the other branch is a
                  TRANSLATED WORD, and dir="ltr" around Persian prose is the
                  mirror-image bug this sweep exists to avoid. */}
              <b className="shrink-0 text-[12px] text-text-1">
                {canForgeAlloy(state)
                  ? t("cradle.alloyComplete")
                  : <Bdi dir="ltr" className="num">{`${1 + recipe.filter((id) => id !== state.race).length}/5`}</Bdi>}
              </b>
            </div>
            {/* FORGED GEAR (owner 2026-09-30): the colony's legend shelf — forged
                pieces are earn-only, never sold. The row counts every forged
                piece in the stores and breaks out the prewar-grade legendaries.
                TRUE ARTIFACTS (exploration rare drops, Chorus raids) have no
                inventory model yet — when it lands, they get their own row
                here; until then nothing here is called an artifact. Tapping
                opens the Forge room where the pieces live. */}
            <button
              type="button"
              onClick={() => { setSheet({ kind: "forge", id: "forge" }); sound.tab(); }}
              className="flex min-h-tap w-full items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-start"
              aria-label={t("cradle.forgedGearAria", { n: (state.forgeItems ?? []).length })}
            >
              <Icon name="star" size={16} className="shrink-0 text-amber-300" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-[12px] text-text-2">
                {t("cradle.forgedGear")}
                {(state.forgeItems ?? []).some((it) => it.grade === "prewar") && (
                  <span className="ms-2 rounded-full border border-amber-300/40 px-1.5 py-0.5 text-[10px] text-amber-200">
                    {t("cradle.prewar", { n: (state.forgeItems ?? []).filter((it) => it.grade === "prewar").length })}
                  </span>
                )}
              </span>
              <b className="shrink-0 text-[12px] text-text-1">
                <Bdi dir="ltr" className="num">{(state.forgeItems ?? []).length}</Bdi>
              </b>
            </button>
            </div>
          </Panel>

          {/* ---- B8 · the stores band ------------------------------------- */}
          {/* LIFETIME STATISTICS, never a holding: these four are what the colony has
              EVER looted/distilled/sown, so every label says so out loud and the
              holding itself lives in the shelf above (`resource.embers`). Two numbers
              that both read "Embers" is exactly how the owner lost track of which one
              he owns. Every figure is its own isolated run. */}
          <div data-testid="stores-band" className="grid grid-cols-2 gap-2">
            <StatTile
              label={t("cradle.totalEmbers")}
              value={<Bdi dir="ltr" className="num">{state.totalEmbersLooted.toLocaleString()}</Bdi>}
              icon="flame"
            />
            <StatTile
              label={t("cradle.totalChipsets")}
              value={<Bdi dir="ltr" className="num">{state.totalChipsetsLooted.toLocaleString()}</Bdi>}
              icon="chip"
            />
            <StatTile
              label={t("cradle.insight")}
              value={<Bdi dir="ltr" className="num">{Math.round(state.insight).toLocaleString()}</Bdi>}
              icon="spark"
            />
            <StatTile
              label={t("cradle.founded")}
              value={<Bdi dir="ltr" className="num">{formatDate(t.lang ?? "en", state.createdAt)}</Bdi>}
              sub={t("cradle.expeditionsDone", { n: state.completedExpeditions })}
              icon="building"
            />
          </div>

          {/* ---- B9 · the Codex and the Chronicle -------------------------- */}
          <Panel className="space-y-2">
            <RowButton
              icon="scroll"
              title={t("cradle.codexTitle")}
              sub={t("cradle.codexSub")}
              chip={
                <span className="chip border border-line text-text-2">
                  {t("cradle.legends", { n: RACES.length + 1 })}
                </span>
              }
              onClick={onOpenCodex}
            />
          </Panel>
          <Panel>
            <ForgeDoor state={state} onOpen={() => { setSheet({ kind: "forge", id: "forge" }); sound.tab(); }} />
          </Panel>
          <JournalButton
            title={t("cradle.chronicle")}
            subtitle={t("cradle.chronicleSub")}
            log={state.log}
          />
        </div>
      </div>

      {/* ---------------- THE FORGE (owner 2026-09-26) ---------------- */}
      <Sheet
        open={sheet?.kind === "forge"}
        onClose={close}
        labelledBy="cradle-forge-title"
        title={t("forge.title")}
      >
        <SheetHeader
          id="cradle-forge-title"
          title={t("forge.title")}
          subtitle={t("forge.sub")}
          onClose={close}
        />
        <ForgeRoom state={state} now={Date.now()} onRoll={onForgeRoll} onMelt={onForgeMelt} busy={forgeBusy} />
      </Sheet>
      {/* ---------------- the slot sheets (B2/B3/B7) ---------------- */}
      <SlotSheet
        state={state}
        slot={sheet?.kind === "slot" ? (sheet.id as CradleSlotId) : null}
        onClose={close}
        onDeploy={(d) => { close(); onDeploy(d); }}
      />

      {/* ---------------- the Leader sheet ---------------- */}
      <Sheet open={sheet?.kind === "leader"} onClose={close} labelledBy="cradle-leader-title" title={t("cradle.sheet.leaderTitle", "Leader")}>
        {sheet?.kind === "leader"
          ? (() => {
              const leader = state.leaders.find((l) => l.id === sheet.id);
              if (!leader) return null;
              return (
                <>
                  <SheetHeader
                    id="cradle-leader-title"
                    title={leaderName(t, leader)}
                    subtitle={leader.title ?? specialtyLabel(t, leader.specialty, SPECIALTY_LABEL[leader.specialty])}
                    onClose={close}
                  />
                  <div className="sheet-body space-y-3 px-4 py-3 md:px-5">
                    <ul className="space-y-1.5">
                      <RecordRow label={t("cradle.sheet.level", "Level")} value={<Bdi dir="ltr" className="num">{engineHelpers.leaderLevel(leader)}</Bdi>} />
                      <RecordRow label={t("cradle.sheet.specialization", "Specialization")} value={leader.specialization ?? t("cradle.sheet.noPathYet", "no path yet")} />
                      <RecordRow label={t("cradle.sheet.breakthroughs", "Breakthroughs")} value={<Bdi dir="ltr" className="num">{leader.breakthroughs}</Bdi>} />
                      <RecordRow label={t("cradle.sheet.codicesEarned", "Codices earned")} value={<Bdi dir="ltr" className="num">{leader.codicesEarned}</Bdi>} />
                      {/* a STATUS WORD, not a figure: it passes no Bdi on purpose */}
                      <RecordRow label={t("cradle.sheet.status", "Status")} value={leader.status} />
                    </ul>
                    <div>
                      <p className="eyebrow">{t("cradle.sheet.attributes", "Attributes")}</p>
                      <ul className="mt-1.5 grid grid-cols-2 gap-2">
                        <RecordRow label={t("cradle.sheet.research", "Research")} value={<Bdi dir="ltr" className="num">{leader.attributes.research}</Bdi>} />
                        <RecordRow label={t("cradle.sheet.economy", "Economy")} value={<Bdi dir="ltr" className="num">{leader.attributes.economy}</Bdi>} />
                        <RecordRow label={t("cradle.sheet.combat", "Combat")} value={<Bdi dir="ltr" className="num">{leader.attributes.combat}</Bdi>} />
                        <RecordRow label={t("cradle.sheet.engineering", "Engineering")} value={<Bdi dir="ltr" className="num">{leader.attributes.engineering}</Bdi>} />
                      </ul>
                    </div>
                    <div>
                      <p className="eyebrow">{t("cradle.sheet.history", "History")}</p>
                      {leader.history.length === 0 ? (
                        <p className="mt-1 text-[12px] text-text-3">{t("cradle.sheet.nothingRecorded", "Nothing recorded yet.")}</p>
                      ) : (
                        <ul className="mt-1 space-y-1">
                          {leader.history.slice().reverse().map((h, i) => (
                            <li key={i} className="rounded-lg border border-line bg-surf-2/60 px-3 py-2 text-[12px] text-text-2">
                              {h}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </>
              );
            })()
          : null}
      </Sheet>

      {/* ---------------- the hero sheet (no price, no unlock, no timer) ---------------- */}
      <Sheet open={sheet?.kind === "hero"} onClose={close} labelledBy="cradle-hero-title" title={t("cradle.sheet.heroTitle", "Hero")}>
        {sheet?.kind === "hero"
          ? (() => {
              const hero = (state.prologue?.heroes ?? []).find((h) => h.id === sheet.id);
              if (!hero) return null;
              return (
                <>
                  <SheetHeader
                    id="cradle-hero-title"
                    title={hero.name}
                    subtitle={HERO_ROLE_WORD[hero.role] ?? hero.role}
                    onClose={close}
                  />
                  <div className="sheet-body space-y-3 px-4 py-3 md:px-5">
                    <ul className="space-y-1.5">
                      <RecordRow label={t("cradle.sheet.level", "Level")} value={<Bdi dir="ltr" className="num">{heroLevel(hero)}</Bdi>} />
                      <RecordRow label={t("cradle.sheet.specialization", "Specialization")} value={hero.specialization ?? t("cradle.sheet.noPathYet", "no path yet")} />
                      {/* provenance: a deed's NAME only — a raw id is never printed */}
                      {DEED_BY_ID[hero.earnedBy]?.name ? (
                        <RecordRow label={t("cradle.sheet.earnedBy", "Earned by")} value={DEED_BY_ID[hero.earnedBy].name} />
                      ) : null}
                    </ul>
                    <ul className="grid grid-cols-2 gap-2">
                      <RecordRow label={t("cradle.sheet.power", "Power")} value={<Bdi dir="ltr" className="num">{hero.attributes.power}</Bdi>} />
                      <RecordRow label={t("cradle.sheet.guard", "Guard")} value={<Bdi dir="ltr" className="num">{hero.attributes.guard}</Bdi>} />
                      <RecordRow label={t("cradle.sheet.craft", "Craft")} value={<Bdi dir="ltr" className="num">{hero.attributes.craft}</Bdi>} />
                      <RecordRow label={t("cradle.sheet.presence", "Presence")} value={<Bdi dir="ltr" className="num">{hero.attributes.presence}</Bdi>} />
                    </ul>
                  </div>
                </>
              );
            })()
          : null}
      </Sheet>
    </main>
  );
}

/**
 * A row's VALUE, whatever it is: a number, a status word, a deed's name or a
 * sentence. That is why this `<b>` is a FORWARDER and not a numeral run — the
 * audit put it plainly, "do not blanket-wrap RecordRow": `dir="ltr"` around
 * Persian prose is a NEW bug. So the `num` class is NOT here: every NUMERIC
 * caller passes `<Bdi dir="ltr" className="num">` (its own isolated run, keeping
 * the numerals' mono/tabular styling), and the prose rows — `Effect now`, a
 * leader's status, a hero's earned-by deed — pass none and render in the
 * surrounding direction, which is right for a sentence and for a Persian word.
 * This is also what makes §13's rule exemption-free: EVERY `.num` element in the
 * swept surfaces is inside a `<Bdi>`, with nothing to name or excuse.
 */
function RecordRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <li className="flex min-h-tap items-center justify-between gap-3 rounded-xl border border-line bg-surf-3/50 px-3 py-2">
      <span className="text-[12px] text-text-3">{label}</span>
      <b className="text-[13px] text-text-1">{value}</b>
    </li>
  );
}

/* ---------------- B5 · Today's Devotion (from the old Cradle tab) ---------
   Same list, same numbers, same single Claim button and the same copy; the
   chrome is the shell's Panel, and Claim is a full-width 48px action. */

/**
 * A TIME-TOKEN REFUSAL, in the player's own language (owner direction 2026-09-27).
 * A literal switch, exactly like the chat composer's `refusalText`: the engine
 * returns a catalogue key on `errorKey` and every refusal string has a real call
 * site here, so no key can go unused and nothing renders an English sentence at a
 * Persian player. The strings are EARNED-path refusals — the ladder refusal is the
 * one that matters: a time token may never shorten an exploration run.
 */
export function timeTokenRefusalText(t: ReturnType<typeof useT>, key: string): string {
  switch (key) {
    case "time.refusedExpedition":
      return t("time.refusedExpedition");
    case "time.refusedFloor":
      return t("time.refusedFloor");
    case "time.refusedNoTimer":
      return t("time.refusedNoTimer");
    case "time.refusedUnknownKind":
      return t("time.refusedUnknownKind");
    case "time.refusedNoTokens":
      return t("time.refusedNoTokens");
    case "time.refusedSize":
      return t("time.refusedSize");
    // THE SELL HALF'S ONE REFUSAL (owner ruling signed 2026-09-27): the two sizes
    // the Devotion pays are never for sale. Registered here so the key has a real
    // call site the moment a sale surface exists — the store rows land with the
    // switch flip, and this is the sentence they will read.
    case "time.earnedOnly":
      return t("time.earnedOnly");
    default:
      return t(key);
  }
}

function DevotionSection({ state, onClaim, tokenGrant, supplyGrant }: { state: GameState; onClaim: () => void; tokenGrant?: Record<string, number> | null; supplyGrant?: number | null }) {
  const t = useT();
  const daily = state.daily;
  const list = daily?.list ?? [];
  const completed = daily?.completed ?? [];
  const claimed = daily?.claimed ?? [];
  const devotion = typeof state.devotion === "number" ? state.devotion : 0;
  const streak = typeof state.devotionStreak === "number" ? state.devotionStreak : 0;
  const quiet = !list || list.length === 0;
  const pending = completed.filter((id) => !claimed.includes(id));
  const allDone = list.length >= 1 && completed.length >= list.length;
  const pendingScrip = pending.length * 30 + (allDone && !daily?.bonusClaimed ? 80 : 0);
  const pendingDevotion = pending.length * 1 + (allDone && !daily?.bonusClaimed ? 3 : 0);
  // SUPPLY BONUS (owner 2026-10-01): +250 per item claim, +1000 completion bonus.
  const pendingSupplies = pending.length * 250 + (allDone && !daily?.bonusClaimed ? 1000 : 0);
  return (
    <Panel testid="devotion-panel" className="space-y-3" labelledBy="cradle-devotion">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="cradle-devotion" className="text-[15px] font-semibold text-text-1">
          {t("cradle.devotion")}{" "}
          <Bdi dir="ltr" className="num text-[11px] font-normal text-text-3">
            {`(${completed.length}/${list.length})`}
          </Bdi>
        </h3>
        <span className="flex items-center gap-3 text-[11px] text-text-2">
          <span>
            {t("cradle.devotionShort")} <Bdi dir="ltr" className="num text-purity">{devotion}</Bdi>
          </span>
          {streak > 0 ? (
            // THE VALUE, NOT THE SENTENCE, IS THE RUN (2026-09-28): the streak
            // sentence owns where its numeral sits, so the numeral is isolated
            // where it lands — `<bdi dir="ltr">` per digit run. `title=` has no
            // element to wrap, so it takes the same split joined with LRI…PDI.
            <span title={joinValue(t.lang, "cradle.devotionTitle", { n: streak })}>
              <b className="text-purity">
                <SplitValue k="cradle.devotionStreak" params={{ n: streak }} />
              </b>
            </span>
          ) : null}
        </span>
      </header>
      {quiet ? (
        <p className="text-[13px] text-text-3">{t("cradle.devotionQuiet")}</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {list.map((id) => {
              const def = DAILY_ITEM_BY_ID[id as keyof typeof DAILY_ITEM_BY_ID];
              const done = completed.includes(id);
              const banked = claimed.includes(id);
              return (
                <li key={id} className="flex min-h-tap items-center gap-3 rounded-xl bg-surf-3/50 px-3 py-2">
                  <span
                    className={`w-4 text-center ${done ? "text-ember-soft" : "text-text-3"}`}
                    aria-hidden="true"
                  >
                    {done ? "\u2713" : "\u25cb"}
                  </span>
                  <span className={`text-[13px] ${done ? "text-text-1" : "text-text-2"}`}>
                    {def ? dailyItemLabelT(t, id) : id}
                    {done && banked ? (
                      <span className="ms-1.5 text-[11px] uppercase tracking-wide text-ember-soft/80">
                        {t("cradle.claimed")}
                      </span>
                    ) : null}
                  </span>
                  <Bdi dir="ltr" className="num ms-auto text-[11px] text-text-3">+30 · +1 · +250 📦</Bdi>
                </li>
              );
            })}
          </ul>
          {allDone ? <p className="text-[12px] text-purity">{t("cradle.devotionDone")}</p> : null}
          <ActionButton
            full
            size="md"
            variant="secondary"
            label={
              pendingScrip > 0
                ? t("cradle.claimWith", { scrip: pendingScrip, devotion: pendingDevotion, supplies: pendingSupplies.toLocaleString() })
                : t("cradle.claim")
            }
            sub={pendingScrip > 0 ? t("cradle.claimSub") : t("cradle.claimLocked")}
            locked={pendingScrip <= 0}
            reason={t("cradle.claimLocked")}
            onClick={onClaim}
          />
          {/* What the claim just paid in TIME TOKENS (owner direction 2026-09-27):
              one 1m + one 5m per reward claim. The count is the grant's own
              figure, read from the server reply — never derived by subtraction.
              The figures ride in their own <bdi dir="ltr"> runs so a right-to-left
              line cannot reorder a numeral against the words around it. */}
          {tokenGrant && (tokenGrant["1m"] > 0 || tokenGrant["5m"] > 0) ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-purity" data-testid="devotion-token-grant">
              <span>{t("time.claimGranted")}</span>
              {tokenGrant["1m"] > 0 ? (
                <Bdi dir="ltr" className="num">{`${tokenGrant["1m"]} ×`}</Bdi>
              ) : null}
              {tokenGrant["1m"] > 0 ? <span>{t("time.token1m")}</span> : null}
              {tokenGrant["5m"] > 0 ? (
                <Bdi dir="ltr" className="num">{`${tokenGrant["5m"]} ×`}</Bdi>
              ) : null}
              {tokenGrant["5m"] > 0 ? <span>{t("time.token5m")}</span> : null}
            </p>
          ) : null}
          {/* What the claim just paid in SUPPLIES (owner direction 2026-10-01):
              the daily login boost. The figure is the grant's own number, read
              from the server reply — never derived by subtraction. The numeral
              rides in its own <bdi dir="ltr"> so a right-to-left line cannot
              reorder it against the words around it. */}
          {supplyGrant != null && supplyGrant > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-purity" data-testid="devotion-supply-grant">
              <Bdi dir="ltr" className="num">+{supplyGrant.toLocaleString()}</Bdi>
              <span>{t("resource.supplies")}</span>
              <span>{t("cradle.supplyGrantWords", "claimed")}</span>
            </p>
          ) : null}
          <p className="text-[11px] text-text-3">
            {t("cradle.devotionNote")}
          </p>
        </>
      )}
    </Panel>
  );
}

