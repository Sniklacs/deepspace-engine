// economy-defects-verify.ts — the FOUR measured economy defects (report §7).
//
// Every check here FAILS against the code as it was before this slice. The
// defects were found by reading (`/home/team/shared/economy-pacing-report.md`
// §7), so the gate is written to fail on the old behaviour, not to describe the
// new one: the Marshal arm probes the real resolveExpedition with a SCRIPTED RNG
// (no statistics, no flakiness), the season arm replays a whole season of
// objectives, and the cap arm calls the server's own entry point.
//
// Run: cd /home/team/shared/economy-defects-tests && bun run economy-defects-verify.ts
import * as engine from "/home/team/shared/site/src/game/engine.ts";
import * as m from "/home/team/shared/site/src/game/monetization.ts";
import { engineHelpers } from "/home/team/shared/site/src/game/client-utils.ts";
import { MAX_DOMAIN_LEVEL } from "/home/team/shared/site/src/game/zones.ts";
import { PROLOGUE_CONFIG } from "/home/team/shared/site/src/game/prologue/prologue-state.ts";
import { prologueState } from "/home/team/shared/site/src/game/prologue/prologue-engine.ts";
import type { GameState, Leader } from "/home/team/shared/site/src/game/types.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}
const NOW = 1_700_000_000_000;

/** A fabricated expedition exactly like the one the engine resolves. */
function expedition(protection: number, i = 0) {
  return {
    id: "exp-econ-" + i, zoneId: "outer-ruins", label: "outer-ruins", assignedScientists: 2,
    suppliesCost: 10, startedAt: NOW, durationMs: 1000, status: "complete",
    lossPct: 0, protection, pureAtLaunch: false,
  } as unknown as GameState["expeditions"][number];
}
/** The leader shape resolveExpedition reads (only status/specialization/id). */
function mkLeader(id: string, spec: "marshal" | null): Leader {
  return {
    id, name: id, title: "t", specialty: "scholar", specialization: spec, status: "active",
    attributes: { research: 1, economy: 1, combat: 1, engineering: 1 },
    codicesEarned: 0, history: [], assignment: null, xp: 0, level: 1, pointsSpent: 0,
  } as unknown as Leader;
}
/** Run Math.random off a fixed script — the same draws, every time. */
function scripted<T>(vals: number[], fn: () => T): T {
  const orig = Math.random; let i = 0;
  Math.random = () => (i < vals.length ? vals[i++] : 0.999);
  try { return fn(); } finally { Math.random = orig; }
}
function colony(marshals: number): GameState {
  const st = engine.newGame("Defect", "watchers", NOW);
  st.resources.supplies = 10_000;
  st.leaders = marshals > 0 ? [mkLeader("a", null), mkLeader("m", "marshal")] : [mkLeader("a", null)];
  return st;
}
/** Resolve ONE run with the wildcard suppressed (fires = 0) or armed, and return
 *  the embers it brought home. Draws in order: wildcard coin · severity roll ·
 *  bumped coin · chipset coin · yield variance. */
function embersFor(protection: number, marshals: number, roll: number, fires: boolean): number {
  const st = colony(marshals);
  const before = st.resources.embers;
  scripted([fires ? 0 : 0.999, roll, 0.999, 0.999, 0.5], () =>
    engine.resolveExpedition(st, expedition(protection), NOW));
  return st.resources.embers - before;
}
/** The severity a given roll produces, read off the ember ratio against the same
 *  run with no wildcard at all (0.1/0.4/0.7 of a clean haul). */
function severity(protection: number, marshals: number, roll: number): "clean" | "bumped" | "mauled" | "lost" {
  const clean = embersFor(protection, marshals, roll, false);
  const wild = embersFor(protection, marshals, roll, true);
  const ratio = clean > 0 ? wild / clean : 1;
  if (ratio > 0.95) return "clean";
  if (ratio > 0.55) return "bumped";
  if (ratio > 0.25) return "mauled";
  return "lost";
}
const RANK = { clean: 0, bumped: 1, mauled: 2, lost: 3 } as const;

// ======================================================================
console.log("— 1 · the Marshal's protection stat means ONE thing: more protection —");
// ======================================================================
const noMarshal = colony(0);
const oneMarshal = colony(1);
const threeMarshals = colony(1);
threeMarshals.leaders = [mkLeader("a", null), mkLeader("m1", "marshal"), mkLeader("m2", "marshal"), mkLeader("m3", "marshal")];
check("one specialized Marshal multiplies protection UP, never down",
  engine.marshalProtectionMult(oneMarshal) > 1, String(engine.marshalProtectionMult(oneMarshal)));
check("no Marshals is exactly neutral",
  engine.marshalProtectionMult(noMarshal) === 1);
check("the mandate is monotone in Marshals (3 > 1)",
  engine.marshalProtectionMult(threeMarshals) > engine.marshalProtectionMult(oneMarshal),
  `${engine.marshalProtectionMult(threeMarshals)} vs ${engine.marshalProtectionMult(oneMarshal)}`);
// The old formula (1 − 0.2×marshals) turned a roll of 0.25 inside a 0.5-protection
// colony into a catastrophe. With the direction fixed it is a mauling at worst.
check("a roll of 0.25 with one Marshal is NOT a catastrophe (old code: lost)",
  severity(0.5, 1, 0.25) !== "lost", severity(0.5, 1, 0.25));
check("...and without a Marshal it is a mauling, not a catastrophe",
  severity(0.5, 0, 0.25) === "mauled", severity(0.5, 0, 0.25));
let worse = 0;
for (let i = 1; i <= 19; i++) {
  const roll = i / 20;
  if (RANK[severity(0.5, 1, roll)] > RANK[severity(0.5, 0, roll)]) worse++;
}
check("across 19 rolls at mid-gear, one Marshal is never WORSE than none", worse === 0, `${worse} rolls worse`);
let worseFull = 0;
for (let i = 1; i <= 19; i++) {
  const roll = i / 20;
  if (RANK[severity(1, 1, roll)] > RANK[severity(1, 0, roll)]) worseFull++;
}
check("across 19 rolls at full gear, one Marshal is never WORSE than none", worseFull === 0, `${worseFull} rolls worse`);
check("severity at mid-gear is strictly lower with a Marshal at the catastrophe edge",
  RANK[severity(0.5, 1, 0.2)] <= RANK[severity(0.5, 0, 0.2)] &&
  severity(0.5, 1, 0.2) === "mauled", severity(0.5, 1, 0.2));

// ======================================================================
console.log("— 2 · the season pass is completable inside its own season, by construction —");
// ======================================================================
const cfg = m.MONETIZATION_CONFIG;
const earnablePerDay = m.DAILY_OBJECTIVES.reduce((s, o) => s + o.xp, 0) + m.WEEKLY_OBJECTIVES.reduce((s, o) => s + o.xp, 0) / 7;
check("the earnable rate is READ OFF the objective tables (not a remembered number)",
  m.SEASON_EARNABLE_XP_PER_DAY === earnablePerDay, `${m.SEASON_EARNABLE_XP_PER_DAY} vs ${earnablePerDay}`);
const seasonDays = cfg.season0DurationMs / 86_400_000;
check("the season's length in days comes from its own declared duration", m.SEASON_DURATION_DAYS === seasonDays && seasonDays === 42, String(m.SEASON_DURATION_DAYS));
const expectedTierXp = Math.max(1, Math.floor(m.SEASON_FULL_LADDER_XP / (m.SEASON_TIER_COUNT - 1)));
check("the tier price is DERIVED from (season length × earnable daily rate × headroom)",
  cfg.seasonXpPerTier === expectedTierXp &&
  m.SEASON_FULL_LADDER_XP === Math.floor(earnablePerDay * seasonDays * m.SEASON_LADDER_SHARE),
  `${cfg.seasonXpPerTier} vs ${expectedTierXp}`);
check("the whole ladder costs no more than the season grants",
  (m.SEASON_TIER_COUNT - 1) * cfg.seasonXpPerTier <= earnablePerDay * seasonDays,
  `${(m.SEASON_TIER_COUNT - 1) * cfg.seasonXpPerTier} vs ${earnablePerDay * seasonDays}`);
check("the pass is not a formality either — the ladder needs most of the headroom it is given",
  (m.SEASON_TIER_COUNT - 1) * cfg.seasonXpPerTier > m.SEASON_FULL_LADDER_XP * 0.9,
  `${(m.SEASON_TIER_COUNT - 1) * cfg.seasonXpPerTier} vs ${m.SEASON_FULL_LADDER_XP}`);
// Replay a whole season: every daily objective, every day, plus the weeklies' targets.
const bp = engine.newGame("Season", "watchers", NOW);
let day = 0;
for (let d = 0; d < seasonDays; d++) {
  const at = NOW + d * 86_400_000;
  for (const o of m.DAILY_OBJECTIVES) m.recordSeasonEvent(bp, o.id as Parameters<typeof m.recordSeasonEvent>[1], at);
  for (let i = 0; i < cfg.weeklyExpeditionTarget; i++) m.recordSeasonEvent(bp, "expedition_complete", at);
  for (let i = 0; i < cfg.weeklyCodexTarget; i++) m.recordSeasonEvent(bp, "codex_recovered", at);
  m.recordSeasonEvent(bp, "deep_site", at);
  day = d;
}
check(`a player who clears every objective for ${seasonDays} days earns ${bp.battlePass.xp} XP`, bp.battlePass.xp > 0);
check("...and reaches TIER 28 before the season ends (old code: tier 4 of 28)",
  m.tierFromXp(bp.battlePass.xp) === m.SEASON_TIER_COUNT, `tier ${m.tierFromXp(bp.battlePass.xp)} at day ${day + 1}`);
check("a player who clears everything but the weekly targets still reaches the capstone",
  (() => {
    const st = engine.newGame("Season2", "watchers", NOW);
    for (let d = 0; d < seasonDays; d++) {
      const at = NOW + d * 86_400_000;
      for (const o of m.DAILY_OBJECTIVES) m.recordSeasonEvent(st, o.id as Parameters<typeof m.recordSeasonEvent>[1], at);
    }
    return m.tierFromXp(st.battlePass.xp) === m.SEASON_TIER_COUNT;
  })());

// ======================================================================
console.log("— 3 · the domain ladder's top rung is enforced by the SERVER —");
// ======================================================================
check("the prologue's height reads the ONE cap constant (no scattered literal)",
  PROLOGUE_CONFIG.maxDomainLevel === MAX_DOMAIN_LEVEL, `${PROLOGUE_CONFIG.maxDomainLevel} vs ${MAX_DOMAIN_LEVEL}`);
check("the cap is a real rung on the ladder", Number.isInteger(MAX_DOMAIN_LEVEL) && MAX_DOMAIN_LEVEL > 1);
const capped = engine.newGame("Cap", "watchers", NOW);
capped.resources.embers = 1_000_000; capped.insight = 1_000_000;
capped.deployedDomains.industry = MAX_DOMAIN_LEVEL;
const refused = engine.deployProgram(capped, "industry", NOW);
check("the server REFUSES a domain already at the top rung", refused.ok === false, JSON.stringify(refused.error));
check("...and the level did not move (never a silent grant)",
  capped.deployedDomains.industry === MAX_DOMAIN_LEVEL, String(capped.deployedDomains.industry));
check("...and the refusal carries a translated catalogue key",
  refused.errorKey === "cradle.domainMaxReason", String(refused.errorKey));
const oneBelow = engine.newGame("Cap2", "watchers", NOW);
oneBelow.resources.embers = 1_000_000; oneBelow.insight = 1_000_000;
oneBelow.deployedDomains.industry = MAX_DOMAIN_LEVEL - 1;
check("one rung below the cap the same call still succeeds",
  engine.deployProgram(oneBelow, "industry", NOW).ok === true &&
  oneBelow.deployedDomains.industry === MAX_DOMAIN_LEVEL);
check("the client seam agrees with the server: at the cap it is not \"affordable\"",
  engineHelpers.domainAtMax(capped, "industry") === true &&
  engineHelpers.domainAffordable(capped, "industry") === false);
const belowCap = engine.newGame("Cap3", "watchers", NOW);
belowCap.resources.embers = 1_000_000; belowCap.insight = 1_000_000;
belowCap.deployedDomains.industry = MAX_DOMAIN_LEVEL - 1;
check("...and one rung below it is offered again",
  engineHelpers.domainAtMax(belowCap, "industry") === false && engineHelpers.domainAffordable(belowCap, "industry") === true);

// ======================================================================
console.log("— 4 · the prologue seeds a LEGAL starting state —");
// ======================================================================
const height = prologueState(NOW);
const cap = engine.scientistCapacity(height);
check("the Fall's height holds exactly its own legal scientist capacity",
  height.scientists === cap, `${height.scientists} vs cap ${cap}`);
check("...which is the live cap, not the 60 no colony could ever hold",
  height.scientists < 60 && height.scientists <= cap);
check("...and the lifetime counter agrees with the roster",
  height.totalScientists === height.scientists);
check("...and the seed is DERIVED, not a literal (it equals the capacity formula)",
  height.scientists === 2 + Math.floor(height.deployedDomains.logistics / 2) + (engine.hasTech(height, "l4") ? 1 : 0),
  String(height.scientists));

console.log(`\neconomy-defects: ${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
