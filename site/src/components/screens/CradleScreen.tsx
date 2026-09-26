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
import { Panel } from "../ui/Panel";
import { BuildingTile } from "../ui/BuildingTile";
import { ActionButton } from "../ui/ActionButton";
import { StatTile } from "../ui/StatTile";
import { RosterCard, RosterEmpty } from "../ui/RosterCard";
import { RowButton } from "../ui/RowButton";
import { Sheet, SheetHeader } from "../Sheet";
import { Icon } from "../icons";
import { Tooltip } from "../Tooltip";
import { JournalButton } from "../JournalButton";
import { engineHelpers } from "../../game/client-utils";
import { CRADLE_SLOTS, CRADLE_SLOT_BY_ID, kitsHeld } from "../../game/cradle-slots";
import { CRAFT, CRAFT_RESOURCE_KEY, canForgeAlloy, alloyRecipeRaces } from "../../game/engine";
import { DOMAIN_BY_ID } from "../../game/zones";
import { RACES, getRace } from "../../game/races";
import { domainDescription, slotLabel } from "../../game/i18n";
import { useT } from "../i18n/I18n";
import { DAILY_ITEM_BY_ID } from "../../game/daily";
import { SPECIALTY_LABEL } from "../../game/research";
import { DEED_BY_ID } from "../../game/heroes-data";
import { heroLevel, heroXpForLevel } from "../../game/hero-xp";
import {
  tip, DOMAIN_TIPS, METER_TIPS, LAB_TIPS, RESOURCE_TIPS,
} from "../../game/tooltips";
import type { CraftKind } from "../../game/engine";
import type { CradleSlotId } from "../../game/cradle-slots";
import type { GameState, DomainId } from "../../game/types";
import type { IconName } from "../icons";

/** The kit glyph map — the CRAFT catalog's emoji never reach the chrome (§1.7). */
const KIT_ICON: Record<CraftKind, IconName> = {
  medkit: "aegis",
  mechkit: "gear",
  armorkit: "armor",
  skmech: "person",
  gas: "fuel",
  battery: "spark",
  hazmat: "shield",
  shots: "beacon",
  alloy: "crate",
};

const KIT_TIERS: { note: string; kinds: CraftKind[] }[] = [
  { note: "Tier 0 · Step Out — gates fielding ANY exploration", kinds: ["medkit", "mechkit", "armorkit"] },
  { note: "Tier 1 · Outer & mild zones — radiation shots, skilled mechanics, fuel & battery", kinds: ["skmech", "gas", "battery", "shots"] },
  { note: "Tier 2 · Deep zones — suits let you EXPLORE, alloys let you EXTRACT", kinds: ["hazmat", "alloy"] },
];

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
  onPurify,
  onCraft,
  onClaim,
  onDeploy,
  onOpenCodex,
  onField,
  onLeaveHeight,
  canLeaveHeight,
}: {
  state: GameState;
  onPurify: (n: number) => void;
  onCraft: (k: CraftKind) => void;
  onClaim: () => void;
  onDeploy: (d: DomainId) => void;
  onOpenCodex: () => void;
  /** the Fall's front door (tab battles) */
  onField: () => void;
  onLeaveHeight: () => void;
  canLeaveHeight: boolean;
}) {
  const t = useT();
  const race = getRace(state.race!);
  const r = state.resources;
  const spm = engineHelpers.suppliesPerMinute(state);
  const [sheet, setSheet] = useState<null | { kind: "slot" | "leader" | "hero"; id: string }>(null);
  const close = () => setSheet(null);
  const adv = nextAdvance(state);
  const recipe = alloyRecipeRaces(state);
  const ownMat = state.race ? r.mats[state.race] : 0;
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

          {/* ---- B2 · the Cradle plate (the base view) ---------------------- */}
          <Panel
            variant="hero"
            className="plate-ground"
            accent={race.accent}
            labelledBy="cradle-plate-title"
            testid="cradle-plate"
          >
            <header className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="eyebrow">{t("cradle.plate")}</p>
                <h1 id="cradle-plate-title" className="truncate text-lg font-bold text-text-1">
                  {state.playerName}
                </h1>
                <p className="mt-0.5 truncate text-[11px] text-text-3">
                  {t("cradle.plateMeta", {
                    race: race.name,
                    region: race.homeRegion,
                    date: new Date(state.createdAt).toLocaleDateString(),
                  })}
                </p>
              </div>
              <Tooltip className="flex-none" content={tip(LAB_TIPS.fieldSlots)}>
                <span className="pill border border-line bg-surf-2 text-text-2">
                  <b className="num text-ember-soft">+{spm.toFixed(1)}</b>
                  <span className="text-[11px]">{t("cradle.perMin")}</span>
                </span>
              </Tooltip>
            </header>
            <div className="relative mt-3 grid grid-cols-3 gap-2 plate-map">
              {CRADLE_SLOTS.map((s) => (
                <BuildingTile key={s.id} slot={s} state={state} onOpen={(id) => setSheet({ kind: "slot", id })} />
              ))}
            </div>
          </Panel>

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
                value={`${Math.round(state.corruption)}%`}
                meter={{ value: state.corruption, danger: state.corruption > 50 }}
              />
              <StatTile
                label={t("cradle.chorusAttention")}
                icon="shield"
                value={`${Math.round(state.chorusAttention)}%`}
                meter={{ value: state.chorusAttention, danger: state.chorusAttention > 50 }}
              />
            </div>
            <Tooltip className="w-full" content={tip(LAB_TIPS.purify)}>
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
            <p className="text-[11px] text-text-3">{METER_TIPS.corruption.what}</p>
          </Panel>
        </div>

        <div className="space-y-3">
          {/* ---- B5 · Today's Devotion ------------------------------------- */}
          <DevotionSection state={state} onClaim={onClaim} />

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
                    onClick={() => setSheet({ kind: "hero", id: h.id })}
                  />
                ))
              )}
            </div>
          </Panel>

          {/* ---- B7 · the workshop shelf ---------------------------------- */}
          <Panel testid="workshop-shelf" className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-text-1">{t("cradle.workshop")}</h3>
              <span className="text-[11px] text-text-3">{t("cradle.workshopSub")}</span>
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {(Object.keys(CRAFT) as CraftKind[]).map((k) => {
                const def = CRAFT[k];
                const held = r[CRAFT_RESOURCE_KEY[k]] ?? 0;
                const can = r.supplies >= def.supplies && (k !== "alloy" || canForgeAlloy(state));
                return (
                  <button
                    key={k}
                    type="button"
                    data-testid={`kit-${k}`}
                    aria-haspopup="dialog"
                    aria-label={t("cradle.kitAria", { label: def.label, held, supplies: def.supplies })}
                    onClick={() => setSheet({ kind: "slot", id: "workshop" })}
                    className="relative flex min-h-[84px] w-[92px] flex-none flex-col items-center justify-center gap-1 rounded-tile border border-line bg-surf-3/85 px-1 py-2 text-center"
                  >
                    <Icon name={KIT_ICON[k]} size={20} className="text-text-2" aria-hidden="true" />
                    <span className="text-[11px] font-medium leading-tight text-text-1">{def.label}</span>
                    <span className="num text-[11px] text-ember-soft">
                      {t("cradle.held", { n: held })}
                    </span>
                    <span className="num text-[11px] text-text-3">
                      {t("cradle.sup", { n: def.supplies })}
                    </span>
                    {can ? (
                      <span
                        role="img"
                        aria-label={t("cradle.kitReady", { label: def.label })}
                        data-ready="true"
                        className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full bg-ember"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
            {/* the alloy row — the cross-race recipe at a glance */}
            <div className="flex min-h-tap items-center gap-2 rounded-xl border border-line bg-surf-3/60 px-3 py-2">
              <Icon name="crate" size={16} className="shrink-0 text-ember-soft" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-[12px] text-text-2">
                {t("cradle.alloyLead")} <b className="text-text-1">{t("cradle.alloyBold")}</b>
                {t("cradle.alloyTail")}
              </span>
              <b className="num shrink-0 text-[12px] text-text-1">
                {canForgeAlloy(state) ? t("cradle.alloyComplete") : `${1 + recipe.filter((id) => id !== state.race).length}/5`}
              </b>
            </div>
          </Panel>

          {/* ---- B8 · the stores band ------------------------------------- */}
          <div data-testid="stores-band" className="grid grid-cols-2 gap-2">
            <StatTile label={t("cradle.totalEmbers")} value={state.totalEmbersLooted.toLocaleString()} icon="flame" />
            <StatTile label={t("cradle.totalChipsets")} value={state.totalChipsetsLooted.toLocaleString()} icon="chip" />
            <StatTile label={t("cradle.insight")} value={Math.round(state.insight).toLocaleString()} icon="spark" />
            <StatTile
              label={t("cradle.founded")}
              value={new Date(state.createdAt).toLocaleDateString()}
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
          <JournalButton
            title={t("cradle.chronicle")}
            subtitle={t("cradle.chronicleSub")}
            log={state.log}
          />
        </div>
      </div>

      {/* ---------------- the slot sheets (B2/B3/B7) ---------------- */}
      <SlotSheet
        state={state}
        slot={sheet?.kind === "slot" ? (sheet.id as CradleSlotId) : null}
        onClose={close}
        onDeploy={(d) => { close(); onDeploy(d); }}
        onCraft={(k) => { close(); onCraft(k); }}
        recipe={recipe}
        ownMat={ownMat}
      />

      {/* ---------------- the Leader sheet ---------------- */}
      <Sheet open={sheet?.kind === "leader"} onClose={close} labelledBy="cradle-leader-title" title="Leader">
        {sheet?.kind === "leader"
          ? (() => {
              const leader = state.leaders.find((l) => l.id === sheet.id);
              if (!leader) return null;
              return (
                <>
                  <SheetHeader
                    id="cradle-leader-title"
                    title={leader.name}
                    subtitle={leader.title ?? SPECIALTY_LABEL[leader.specialty]}
                    onClose={close}
                  />
                  <div className="sheet-body space-y-3 px-4 py-3 md:px-5">
                    <ul className="space-y-1.5">
                      <RecordRow label="Level" value={`${engineHelpers.leaderLevel(leader)}`} />
                      <RecordRow label="Specialization" value={leader.specialization ?? "no path yet"} />
                      <RecordRow label="Breakthroughs" value={`${leader.breakthroughs}`} />
                      <RecordRow label="Codices earned" value={`${leader.codicesEarned}`} />
                      <RecordRow label="Status" value={leader.status} />
                    </ul>
                    <div>
                      <p className="eyebrow">Attributes</p>
                      <ul className="mt-1.5 grid grid-cols-2 gap-2">
                        <RecordRow label="Research" value={`${leader.attributes.research}`} />
                        <RecordRow label="Economy" value={`${leader.attributes.economy}`} />
                        <RecordRow label="Combat" value={`${leader.attributes.combat}`} />
                        <RecordRow label="Engineering" value={`${leader.attributes.engineering}`} />
                      </ul>
                    </div>
                    <div>
                      <p className="eyebrow">History</p>
                      {leader.history.length === 0 ? (
                        <p className="mt-1 text-[12px] text-text-3">Nothing recorded yet.</p>
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
      <Sheet open={sheet?.kind === "hero"} onClose={close} labelledBy="cradle-hero-title" title="Hero">
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
                      <RecordRow label="Level" value={`${heroLevel(hero)}`} />
                      <RecordRow label="Specialization" value={hero.specialization ?? "no path yet"} />
                      {/* provenance: a deed's NAME only — a raw id is never printed */}
                      {DEED_BY_ID[hero.earnedBy]?.name ? (
                        <RecordRow label="Earned by" value={DEED_BY_ID[hero.earnedBy].name} />
                      ) : null}
                    </ul>
                    <ul className="grid grid-cols-2 gap-2">
                      <RecordRow label="Power" value={`${hero.attributes.power}`} />
                      <RecordRow label="Guard" value={`${hero.attributes.guard}`} />
                      <RecordRow label="Craft" value={`${hero.attributes.craft}`} />
                      <RecordRow label="Presence" value={`${hero.attributes.presence}`} />
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

function RecordRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex min-h-tap items-center justify-between gap-3 rounded-xl border border-line bg-surf-3/50 px-3 py-2">
      <span className="text-[12px] text-text-3">{label}</span>
      <b className="num text-[13px] text-text-1">{value}</b>
    </li>
  );
}

/* ---------------- B5 · Today's Devotion (from the old Cradle tab) ---------
   Same list, same numbers, same single Claim button and the same copy; the
   chrome is the shell's Panel, and Claim is a full-width 48px action. */

function DevotionSection({ state, onClaim }: { state: GameState; onClaim: () => void }) {
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
  return (
    <Panel testid="devotion-panel" className="space-y-3" labelledBy="cradle-devotion">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="cradle-devotion" className="text-[15px] font-semibold text-text-1">
          {t("cradle.devotion")}{" "}
          <span className="num text-[11px] font-normal text-text-3">
            ({completed.length}/{list.length})
          </span>
        </h3>
        <span className="flex items-center gap-3 text-[11px] text-text-2">
          <span>
            {t("cradle.devotionShort")} <b className="num text-purity">{devotion}</b>
          </span>
          {streak > 0 ? (
            <span title={t("cradle.devotionTitle", { n: streak })}>
              <b className="num text-purity">{t("cradle.devotionStreak", { n: streak })}</b>
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
                    {def?.label ?? id}
                    {done && banked ? (
                      <span className="ms-1.5 text-[11px] uppercase tracking-wide text-ember-soft/80">
                        {t("cradle.claimed")}
                      </span>
                    ) : null}
                  </span>
                  <span className="num ms-auto text-[11px] text-text-3">+30 · +1</span>
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
                ? t("cradle.claimWith", { scrip: pendingScrip, devotion: pendingDevotion })
                : t("cradle.claim")
            }
            sub={pendingScrip > 0 ? t("cradle.claimSub") : t("cradle.claimLocked")}
            locked={pendingScrip <= 0}
            reason={t("cradle.claimLocked")}
            onClick={onClaim}
          />
          <p className="text-[11px] text-text-3">
            {t("cradle.devotionNote")}
          </p>
        </>
      )}
    </Panel>
  );
}

/* ---------------- the slot sheets ---------------------------------------- */

function SlotSheet({
  state,
  slot,
  onClose,
  onDeploy,
  onCraft,
  recipe,
  ownMat,
}: {
  state: GameState;
  slot: CradleSlotId | null;
  onClose: () => void;
  onDeploy: (d: DomainId) => void;
  onCraft: (k: CraftKind) => void;
  recipe: string[];
  ownMat: number;
}) {
  const t = useT();
  if (!slot) return null;
  const def = CRADLE_SLOT_BY_ID[slot];
  const isWorkshop = slot === "workshop";
  return (
    <Sheet
      open
      onClose={onClose}
      labelledBy="cradle-slot-title"
      title={isWorkshop ? t("cradle.workshop") : slotLabel(t, def)}
    >
      <SheetHeader
        id="cradle-slot-title"
        title={isWorkshop ? t("cradle.workshop") : slotLabel(t, def)}
        subtitle={
          isWorkshop ? t("cradle.workshopSub") : t("cradle.levelN", { n: def.level(state) })
        }
        onClose={onClose}
      />
      <div className="sheet-body space-y-3 px-4 py-3 md:px-5">
        {isWorkshop ? (
          <>
            <p className="text-[12px] text-text-3">
              Kits held: <b className="num text-text-1">{kitsHeld(state)}</b> of {Object.keys(CRAFT).length}.
            </p>
            {KIT_TIERS.map((tier, ti) => (
              <section key={ti} className="space-y-2">
                <h3 className="eyebrow">{tier.note}</h3>
                {tier.kinds.map((k) => {
                  const kit = CRAFT[k];
                  const can = state.resources.supplies >= kit.supplies && (k !== "alloy" || canForgeAlloy(state));
                  const desc =
                    k === "alloy" && !canForgeAlloy(state)
                      ? `Missing the recipe — need ${ownMat >= 1 ? "your own material ✓" : "your own material"} plus ${4 - (recipe.length ? recipe.filter((rid) => rid !== state.race).length : 0)} more race material${4 - (recipe.length ? recipe.filter((rid) => rid !== state.race).length : 0) === 1 ? "" : "s"}.`
                      : kit.description;
                  return (
                    <div key={k} className="rounded-xl border border-line bg-surf-3/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon name={KIT_ICON[k]} size={16} className="shrink-0 text-ember-soft" aria-hidden="true" />
                          <span className="truncate text-[13px] font-semibold text-text-1">{kit.label}</span>
                        </span>
                        <span className="num shrink-0 text-[11px] text-text-3">
                          {state.resources[CRAFT_RESOURCE_KEY[k]] ?? 0} held
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-tight text-text-3">{desc}</p>
                      <ActionButton
                        className="mt-2"
                        full
                        size="md"
                        label={`Forge ${kit.label}`}
                        sub={`${kit.supplies} Supplies`}
                        locked={!can}
                        reason={
                          k === "alloy" && !canForgeAlloy(state)
                            ? "Recipe incomplete — forge nothing until five races' materials are held."
                            : `Need ${kit.supplies} Supplies — the stores hold ${Math.floor(state.resources.supplies)}.`
                        }
                        onClick={() => onCraft(k)}
                      />
                    </div>
                  );
                })}
              </section>
            ))}
            {/* the alloy recipe strip — cross-race territory materials */}
            <section>
              <h3 className="eyebrow">Alloy recipe — 5 unique race materials</h3>
              <p className="mt-1 text-[11px] text-text-3">your own + any 4 other races.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {RACES.map((race) => {
                  const count = state.resources.mats[race.id] ?? 0;
                  const isOwn = state.race === race.id;
                  const inRecipe = recipe.includes(race.id);
                  return (
                    <span
                      key={race.id}
                      className={`chip border ${
                        inRecipe
                          ? "border-ember/50 bg-ember/10 text-ember-soft"
                          : count > 0
                            ? "border-line-strong bg-surf-3 text-text-1"
                            : "border-line bg-surf-2 text-text-3"
                      }`}
                    >
                      {race.name.replace("The ", "")}
                      {isOwn ? " (own)" : ""} <b className="num">&times;{count}</b>
                    </span>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-text-3">{RESOURCE_TIPS.mats.what}</p>
            </section>
          </>
        ) : (
          (() => {
            const domain = slot as DomainId;
            const info = DOMAIN_BY_ID[domain];
            const level = state.deployedDomains[domain];
            const cost = engineHelpers.deployCost(state, domain);
            const affordable = engineHelpers.domainAffordable(state, domain);
            const domainTip = DOMAIN_TIPS[domain];
            return (
              <>
                <p className="text-[13px] text-text-2">{domainDescription(t, domain, info.description)}</p>
                <ul className="space-y-1.5">
                  <RecordRow label={t("cradle.level")} value={`${level}`} />
                  <RecordRow label="Effect now" value={engineHelpers.domainEffect(state, domain)} />
                  <RecordRow label="Next advance costs" value={`${cost.embers.toLocaleString()} Embers · ${cost.insight.toLocaleString()} insight`} />
                </ul>
                <p className="text-[11px] leading-tight text-text-3">{domainTip.what}</p>
                <ActionButton
                  full
                  size="md"
                  icon="gear"
                  label={t("cradle.slotDeploy", { n: level + 1 })}
                  sub={t("cradle.advanceSub", {
                    embers: cost.embers.toLocaleString(),
                    insight: cost.insight.toLocaleString(),
                  })}
                  locked={!affordable}
                  reason={t("cradle.slotDeployLocked", {
                    embers: cost.embers.toLocaleString(),
                    insight: cost.insight.toLocaleString(),
                  })}
                  onClick={() => onDeploy(domain)}
                />
              </>
            );
          })()
        )}
      </div>
    </Sheet>
  );
}
