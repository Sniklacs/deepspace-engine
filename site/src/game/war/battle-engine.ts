// BATTLE ENGINE — the real-time battle engine (design/battle-side-rvr-spec.md
// §15, B1/B4 ratified 2026-09-12; the opening-prologue spec §5/§15 calls this
// "the real engine" — the thing The Fall and the later server-vs-server war
// both run on).
//
// A battle is a PERSISTENT ENTITY with a timeline, not an instant resolve:
// committed forces snapshot at commit → strength out (§15 B4) → a fixed
// duration along the B1 curve → casualties ticking per resolution interval →
// a deterministic winner when the time comes. It resolves LAZILY in
// advance()-style ticks (advanceBattles), so the world persists offline and
// the client's 4 s poll just reads the live view (battleMoment) — no
// websockets, no new deps; the server stays authoritative.
//
// STRENGTH FORMULA — the §15 B4 input set, and NOTHING else (ratified):
//
//     forcePower(force) = heroTerm + weaponTerm + troopTerm
//
//     heroTerm   = Σ over the committed hero squad of
//                    (power + 0.8·guard + 0.7·presence + 0.1·craft)
//                    × (1 + 0.12·(level − 1))            // the proven curve
//                    × (1 + Σ skill.strength)            // squad skills fire
//                    × specMult                          // L3 spec (Vanguard
//                                                         //  1.15 / Hearthward
//                                                         //  1.10 / Courser 1)
//     weaponTerm = Σ over committed kits of
//                    round((2·power + 1.5·precision + 1.5·guard + logistics)
//                          × tierMult[tier−1])           // armory statistics,
//                    × kit count                          // tier-CAPPED by the
//                                                         // FOB ceiling (§12.4)
//     troopTerm  = min(troops, FOB_TROOP_CAP_BY_STAGE[fobStage])
//                    × TROOP_POWER_PER_TROOP              // supply-weighted
//                                                         // count, staged
//
// INPUTS (the complete list): hero stats + squad skills (snapshot), weapon
// family/tier kits, FOB-stage ceiling, supply-weighted troop counts.
// OUTPUTS: forcePower, duration, win/loss, casualties. Nothing else enters —
// there is no purchase path, no wallet/currency field, and no randomness:
// the formula reads only the fields of `CommittedForce` (war-types.ts), which
// is itself just the B4 snapshot. The no-purchasable-term test asserts this
// statically (source scan) and behaviorally (identical outcomes under any
// wallet-shaped extra inputs).
//
// Pure module: type-only imports from types.ts; runtime imports only armory
// (published weapon statistics). No Math.random anywhere. Client-safe: the
// Battles tab imports the same pure functions the server resolves with, so
// its ticking live view is provably the server's math.
import { ARMORY_CONFIG, WEAPON_BASE_STATS } from "../armory";
import type { GameState } from "../types";
import {
  BATTLES_CONFIG,
  type AidCall,
  type AidResponsePayload,
  type Battle,
  type BattleDecision,
  type BattleDecisionAction,
  type BattleHeroSnapshot,
  type BattleMoment,
  type BattleOutcome,
  type BattleReport,
  type BattleReserves,
  type BattleSide,
  type BattleSideReport,
  type BattleWindow,
  type BattleWindowView,
  type CommittedForce,
  type FobStage,
  type ReinforcePayload,
  type WarReserve,
} from "./war-types";

// ============================================================================
// §1 STRENGTH OUT — the §15 B4 formula (see the header comment for the math)
// ============================================================================

/** The normalized power gap ∈ 0..1 (0 = even, 1 = perfectly one-sided). */
export function powerGap(powerA: number, powerB: number): number {
  const pa = Math.max(0, powerA);
  const pb = Math.max(0, powerB);
  const top = Math.max(pa, pb, 1);
  return Math.abs(pa - pb) / top;
}

/** Effective weapon tier after the FOB-stage CEILING (§12.4): a kit above its
 *  FOB's head fields at the ceiling tier's stats — the ceiling is the FOB's
 *  power on the battlefield, documented and visible in the battle detail. */
export function effectiveWeaponTier(tier: number, fobStage: FobStage): number {
  const maxTier = BATTLES_CONFIG.fobMaxTierByStage[Math.max(0, Math.min(4, fobStage))];
  return Math.max(1, Math.min(4, Math.min(Math.trunc(tier) || 1, maxTier)));
}

/** A committed weapon kit's unit power (published armory stats × tier mult). */
export function kitPower(family: keyof typeof WEAPON_BASE_STATS, tier: number): number {
  const w = BATTLES_CONFIG.weaponStatWeights;
  const stats = WEAPON_BASE_STATS[family] ?? WEAPON_BASE_STATS.assault;
  const effTier = Math.max(1, Math.min(4, Math.trunc(tier) || 1));
  const tierMult = ARMORY_CONFIG.tierMult[effTier - 1] ?? 1;
  return Math.round((stats.power * w.power + stats.precision * w.precision + stats.guard * w.guard + stats.logistics * w.logistics) * tierMult);
}

/** One hero's power share — stats + the level curve + squad skills + L3 spec.
 *  Skill `strength` values are additive on the hero's own share; `scoring`
 *  skills are contribution-only and carry no combat power in v1 (they fire on
 *  the decision windows arriving with B12). */
export function heroUnitPower(hero: BattleHeroSnapshot): number {
  const a = hero.attributes ?? { power: 0, guard: 0, craft: 0, presence: 0 };
  const weights = BATTLES_CONFIG.heroAttrWeights;
  const base = Math.max(0, a.power ?? 0) * weights.power
    + Math.max(0, a.guard ?? 0) * weights.guard
    + Math.max(0, a.presence ?? 0) * weights.presence
    + Math.max(0, a.craft ?? 0) * weights.craft;
  const level = Math.max(1, Math.trunc(hero.level) || 1);
  const levelScale = 1 + BATTLES_CONFIG.heroLevelScale * (level - 1);
  const skillStrength = (hero.skills ?? []).reduce((sum, s) => sum + (typeof s.strength === "number" ? s.strength : 0), 0);
  const specMult = hero.specialization ? BATTLES_CONFIG.heroSpecMults[hero.specialization] ?? 1 : 1;
  return base * levelScale * (1 + skillStrength) * specMult;
}

/** Summed casualty modifiers from squad skills: own damage-reduction (lowers
 *  this side's casualties) and enemy guard-penalty (raises this side's toll
 *  because the enemy exposed the flaw). Deterministic; part of "hero stats +
 *  squad skills" from the B4 set. */
function skillCasualtyMult(own: CommittedForce, enemy: CommittedForce): number {
  let dr = 0;
  let gp = 0;
  for (const h of own.heroSquad) for (const s of h.skills ?? []) {
    if (typeof s.damageReduction === "number") dr += s.damageReduction;
  }
  for (const h of enemy.heroSquad) for (const s of h.skills ?? []) {
    if (typeof s.guardPenalty === "number") gp += s.guardPenalty;
  }
  return (1 - Math.min(0.8, dr)) * (1 + Math.min(1.5, gp));
}

/** THE §15 B4 strength formula — see the header comment. Pure: same force →
 *  same number, forever. */
export function computeForcePower(force: CommittedForce): number {
  const heroTerm = force.heroSquad.reduce((sum, h) => sum + heroUnitPower(h), 0);
  let weaponTerm = 0;
  for (const kit of force.weapons ?? []) {
    const eff = effectiveWeaponTier(kit.tier, force.fobStage);
    weaponTerm += kitPower(kit.family, eff) * Math.max(0, Math.trunc(kit.count) || 0);
  }
  const cap = BATTLES_CONFIG.fobTroopCapByStage[Math.max(0, Math.min(4, force.fobStage))];
  const troops = Math.max(0, Math.trunc(force.troops) || 0);
  const troopTerm = Math.min(troops, cap) * BATTLES_CONFIG.troopPowerPerTroop;
  return Math.round(heroTerm + weaponTerm + troopTerm);
}

// ============================================================================
// §2 DURATION — the B1 curve (owner-ratified form, constants calibration-ok)
// ============================================================================

export function battleDurationMs(powerA: number, powerB: number): number {
  const pa = Math.max(0, powerA);
  const pb = Math.max(0, powerB);
  const total = pa + pb;
  const gap = powerGap(pa, pb);
  const sizeTerm = 1 + Math.log2(1 + total / BATTLES_CONFIG.sizeScaleK);
  const gapTerm = 1 + BATTLES_CONFIG.gapDivisor * gap;
  const raw = (BATTLES_CONFIG.baseDurationMs * sizeTerm) / gapTerm;
  return Math.max(BATTLES_CONFIG.minDurationMs, Math.min(BATTLES_CONFIG.maxDurationMs, Math.round(raw)));
}

// ============================================================================
// §3 OUTCOME + CASUALTIES — deterministic strength-out (no randomness)
// ============================================================================

/** The winner from strength alone: strictly stronger side wins; equal power is
 *  a standoff (mutual withdrawal — the §5 zone-state flip logic reads this
 *  later, B5). */
export function outcomeFor(powerA: number, powerB: number): BattleOutcome {
  if (powerA > powerB) return "attacker_victory";
  if (powerB > powerA) return "defender_victory";
  return "standoff";
}

/** Base final casualty fraction for ONE side — winner/standoff/loser class by
 *  the power comparison, shaped by the gap. Pure: no force fields beyond the
 *  power numbers; the squad-skill cross-terms live in the caller below. */
export function casualtyFraction(ownPower: number, enemyPower: number): number {
  const cfg = BATTLES_CONFIG;
  const gap = powerGap(ownPower, enemyPower);
  let frac: number;
  if (ownPower === enemyPower) {
    frac = cfg.casualtyStandoff;
  } else if (ownPower > enemyPower) {
    frac = Math.max(0.02, cfg.casualtyWinBase - cfg.casualtyWinGapDrop * gap);
  } else {
    frac = Math.min(0.95, cfg.casualtyLoseBase + cfg.casualtyLoseGapRise * gap);
  }
  return Math.min(cfg.casualtyMaxFrac, Math.max(0, frac));
}

/** Final casualty fraction including the squad-skill cross-terms: we fight
 *  smarter (own damage reduction) but the enemy's guard-penalty skills carve
 *  us open. Deterministic multipliers — still "hero stats + squad skills",
 *  squarely inside the §15 B4 input set. */
function finalCasCasualtyFraction(own: CommittedForce, enemy: CommittedForce, ownPower: number, enemyPower: number): number {
  const frac = casualtyFraction(ownPower, enemyPower);
  return Math.min(BATTLES_CONFIG.casualtyMaxFrac, Math.max(0, frac * skillCasualtyMult(own, enemy)));
}

/** Final casualties (troop-equivalents) for a committed force. Fully
 *  determined at commit — the live view just ticks toward it. */
export function finalCasualties(own: CommittedForce, enemy: CommittedForce, ownPower: number, enemyPower: number): number {
  const troops = Math.max(0, Math.trunc(own.troops) || 0);
  return Math.min(troops, Math.round(troops * finalCasCasualtyFraction(own, enemy, ownPower, enemyPower)));
}

// ============================================================================
// §4 ENTITY LIFECYCLE — commit → resolve (lazy, idempotent, offline-safe)
// ============================================================================

export interface CreateBattleInput {
  zoneId: string;
  zoneName: string;
  attacker: CommittedForce;
  defender: CommittedForce;
}

/** Build the battle entity purely: snapshot forces in, strength+duration+
 *  casualties out, and the B12 decision windows stamped (milestones for both
 *  sides + an edge window when the opening gap already reads rout-risk).
 *  The caller (war layer / prologue / tests) owns pushing it into state and
 *  advancing state first — this module never mutates state on commit
 *  (persistent-world discipline: resolution belongs to advance()). */
export function createBattle(input: CreateBattleInput, now: number): Battle {
  // Defensive copy: a battle owns its committed forces — the caller's objects
  // are never borrowed or mutated, so reusable fixtures (and the API's colony
  // state) stay pristine across battles. JSON-shaped snapshots: safe to copy.
  const att = structuredClone(input.attacker);
  const def = structuredClone(input.defender);
  const pa = computeForcePower(att);
  const pd = computeForcePower(def);
  const durationMs = battleDurationMs(pa, pd);
  const id = `bat-${now}-${att.colonyId}-${def.colonyId}-${input.zoneId}`;
  return {
    id,
    zoneId: input.zoneId,
    zoneName: input.zoneName || input.zoneId,
    attacker: att,
    defender: def,
    forcePower: { attacker: pa, defender: pd },
    durationMs,
    startedAt: now,
    status: "active",
    result: null,
    casualties: {
      attacker: finalCasualties(input.attacker, input.defender, pa, pd),
      defender: finalCasualties(input.defender, input.attacker, pd, pa),
    },
    windows: buildWindows(pa, pd, now, durationMs),
    decisions: [],
    aidCalls: [],
    internal: { committedAt: now },
  };
}

/** Push a created battle onto the state (caller advances first). */
export function openBattle(state: GameState, battle: Battle): void {
  if (!Array.isArray(state.battles)) state.battles = [];
  state.battles.push(battle);
}

/** The fixed wall-clock end of the battle (startedAt + durationMs). */
export function battleEndAt(battle: Battle): number {
  return battle.startedAt + battle.durationMs;
}

/** V9 migration / defensive backfill — idempotent (the ensureX pattern):
 *  missing arrays become empty; resolved battles are guaranteed their ledger
 *  report exactly once (a crash between resolve and append cannot orphan a
 *  report); entity fields are sanitized to kill any NaN/negative drift that
 *  would break determinism. Decision-window state (B12) backfills the same
 *  way: an older save's battles gain their deterministic window schedule,
 *  empty decision/aid ledgers, and the colony-level reserve seam. */
export function ensureBattles(state: GameState): void {
  const s = state as unknown as Record<string, unknown>;
  if (!Array.isArray(s.battles)) s.battles = [];
  if (!Array.isArray(s.battleReports)) s.battleReports = [];
  if (!s.warReserve || typeof s.warReserve !== "object") s.warReserve = freshWarReserve();
  const battles = state.battles as Battle[];
  const reports = state.battleReports as BattleReport[];
  for (const b of battles) {
    if (!b || typeof b !== "object") continue;
    if (typeof b.id !== "string" || b.id.length === 0) continue;
    if (typeof b.durationMs !== "number" || !isFinite(b.durationMs) || b.durationMs <= 0) b.durationMs = BATTLES_CONFIG.baseDurationMs;
    if (typeof b.startedAt !== "number" || !isFinite(b.startedAt)) b.startedAt = Date.now();
    if (b.status !== "active" && b.status !== "resolved") b.status = "active";
    if (!b.result && b.status === "resolved") {
      b.result = { outcome: "standoff", endedAt: battleEndAt(b) };
    }
    if (b.casualties && typeof b.casualties === "object") {
      b.casualties.attacker = Math.max(0, Math.trunc(b.casualties.attacker) || 0);
      b.casualties.defender = Math.max(0, Math.trunc(b.casualties.defender) || 0);
    }
    if (!b.internal || typeof b.internal !== "object") b.internal = { committedAt: b.startedAt };
    // B12: deterministic window schedule + append-only ledgers (backfill).
    if (!Array.isArray(b.windows) || b.windows.length === 0) {
      b.windows = buildWindows(b.forcePower?.attacker ?? 0, b.forcePower?.defender ?? 0, b.startedAt, b.durationMs);
    }
    if (!Array.isArray(b.decisions)) b.decisions = [];
    if (!Array.isArray(b.aidCalls)) b.aidCalls = [];
    // An older save's beacons predate `callerName` — stamp it from the side
    // that raised it, so the aid row never has to say "an ally" (#13 slice).
    for (const c of b.aidCalls) {
      if (!c || typeof c !== "object") continue;
      if (typeof c.callerName !== "string" || c.callerName.length === 0) {
        c.callerName = c.callerSide === "attacker" ? b.attacker.colonyName : b.defender.colonyName;
      }
    }
    // Resolved battles must own their ledger report — exactly once.
    if (b.status === "resolved" && !reports.some((r) => r && r.battleId === b.id)) {
      reports.push(buildReport(b));
    }
  }
}

/** The colony-level war reserve seam — the server-verified numbers a colony
 *  can commit (supply-weighted troops + the §6 weekly energy pool + locked
 *  hero commitments + the co-op recognition ledger). Grows only from play;
 *  the prologue seeds the full-power state's numbers at Act I. */
export function freshWarReserve(cycleId: string | null = null): WarReserve {
  return {
    troops: 0,
    energy: 0,
    cycleId,
    aidCredits: 0,
    lockedHeroes: {},
  };
}

/** Build the append-only report entry for a resolved battle. */
export function buildReport(battle: Battle): BattleReport {
  const sideReport = (f: CommittedForce, power: number, cas: number): BattleSideReport => ({
    colonyId: f.colonyId,
    colonyName: f.colonyName,
    heroNames: f.heroSquad.map((h) => h.name),
    weapons: f.weapons ?? [],
    troops: Math.max(0, Math.trunc(f.troops) || 0),
    fobStage: f.fobStage,
    power,
    casualties: cas,
  });
  const winnerColonyId = battle.result?.winnerColonyId;
  const winnerColonyName =
    winnerColonyId === battle.attacker.colonyId ? battle.attacker.colonyName
      : winnerColonyId === battle.defender.colonyId ? battle.defender.colonyName
        : undefined;
  return {
    battleId: battle.id,
    zoneId: battle.zoneId,
    zoneName: battle.zoneName,
    startedAt: battle.startedAt,
    endedAt: battle.result?.endedAt ?? battleEndAt(battle),
    durationMs: battle.durationMs,
    outcome: battle.result?.outcome ?? "standoff",
    winnerColonyId,
    winnerColonyName,
    attacker: sideReport(battle.attacker, battle.forcePower.attacker, battle.casualties.attacker),
    defender: sideReport(battle.defender, battle.forcePower.defender, battle.casualties.defender),
    resolvedAt: battle.result?.endedAt ?? battleEndAt(battle),
    endedBy: battle.result?.endedBy,
    decisions: battle.decisions.map((d) => ({ side: d.side, action: d.action, issuedAt: d.issuedAt })),
    withdrawnSide: battle.decisions.find((d) => d.action === "withdrawal")?.side,
  };
}

/**
 * THE lazy resolve: every active battle whose wall-clock end has passed is
 * finalized (status, result, Chronicle line, ledger report) — called from
 * engine.advance() so offline worlds resolve on the next read. Idempotent:
 * resolved battles are skipped, so repeated ticks (and repeated saves) can
 * never double-report. Locked aid arrivals land FIRST (a late arrival can
 * flip the outcome), then due battles resolve. Returns how many resolved.
 */
export function advanceBattles(state: GameState, now: number): number {
  if (!Array.isArray(state.battles)) return 0;
  let resolved = 0;
  for (const b of state.battles) {
    if (b.status !== "active") continue;
    advanceAidArrivals(b, now);
    if (now < battleEndAt(b)) continue;
    resolveScheduled(b);
    appendReportOnce(state, b);
    logBattle(state, b);
    resolved += 1;
  }
  return resolved;
}

/** Chronicle line for a resolved battle (battle-engine owns its own log slice —
 *  same shape as engine.ts's private log helper). Retreats log the same line. */
export function logBattleResolved(state: GameState, b: Battle) {
  logBattle(state, b);
}

/** Chronicle line for a resolved battle (battle-engine owns its own log slice —
 *  same shape as engine.ts's private log helper). */
function logBattle(state: GameState, b: Battle) {
  const out = b.result?.outcome ?? "standoff";
  const verb = out === "attacker_victory" ? `${b.attacker.colonyName} breaks the line` : out === "defender_victory" ? `${b.defender.colonyName} holds the ground` : "both sides break off";
  const line = `⚔️ The battle at ${b.zoneName} is decided — ${verb}. ${b.casualties.attacker + b.casualties.defender} casualties between them.`;
  state.log.unshift(line);
  state.log = state.log.slice(0, 60);
}

// ============================================================================
// §5 DECISION WINDOWS (B12) & AID CALLS (B11) — windows, not APM
// ============================================================================
//
// Decisions happen in WINDOWS (B12, ratified): at each resolution milestone a
// side may issue ONE consequential order — reinforce / hold / steady
// withdrawal / retreat / call aid — and the live view reflects it on the next
// poll. Everything below is PURE + DETERMINISTIC + IDEMPOTENT under the same
// rules as the rest of the engine:
//   • windows are STAMPED at commit (milestones for both sides + an edge
//     window when the opening gap reads rout-risk) and APPENDED by power-
//     affecting decisions (the side that just fell behind gets its edge);
//   • one decision per window per side — re-application is a no-op that
//     returns the existing record (idempotent);
//   • effects are computed from (entity, payload, now) alone — no randomness;
//   • real costs: reinforcements/aid pay from the colony's BattleReserves
//     (`energy` = the §6 weekly pool, `reserveTroops` = supply) — the engine
//     VALIDATES against the values and stamps the auditable cost into the
//     decision; the caller (API / prologue / war layer) verifies and deducts
//     the same numbers from its own ledgers. There is no free lunch and no
//     purchasable path: the reserves themselves grow only from play.

function other(side: BattleSide): BattleSide {
  return side === "attacker" ? "defender" : "attacker";
}
/** How long a decision window stays open — 12% of the battle, clamped. */
export function windowDurationMs(durationMs: number): number {
  const raw = durationMs * BATTLES_CONFIG.windowDurationFrac;
  return Math.max(BATTLES_CONFIG.windowMinMs, Math.min(BATTLES_CONFIG.windowMaxMs, Math.round(raw)));
}

/** The deterministic window schedule for a battle: milestones for BOTH sides
 *  plus one edge window for the side that starts behind enough to read
 *  rout-risk (the "getting pummeled" teaching moment, §12.3).
 *
 *  PACING LEVER (The Fall Act I): each side's EARLIEST opening is held open for
 *  at least `windowFirstOpeningFloorMs` — the opening decision of the Act I
 *  fight otherwise closes 4:47 after it opens, at +0:30 into the battle, while
 *  the narrator is still speaking. Later openings keep the plain 12% window;
 *  the floor is capped by the next opening's opensAt and by the battle's end,
 *  so a longer first window can never overlap the next or outlive the fight. */
export function buildWindows(pa: number, pd: number, startedAt: number, durationMs: number): BattleWindow[] {
  const out: BattleWindow[] = [];
  const dur = windowDurationMs(durationMs);
  for (const side of ["attacker", "defender"] as const) {
    for (const frac of BATTLES_CONFIG.windowMilestoneFracs) {
      const opens = startedAt + Math.round(durationMs * frac);
      out.push({
        id: `w-milestone-${frac}-${side}`,
        kind: "milestone",
        side,
        opensAt: opens,
        closesAt: opens + dur,
      });
    }
  }
  if (powerGap(pa, pd) >= BATTLES_CONFIG.edgeWindowGap) {
    const loser: BattleSide = pa >= pd ? "defender" : "attacker";
    out.push(edgeWindowFor(loser, 1, startedAt, dur));
  }
  return applyFirstOpeningFloor(out, startedAt, durationMs);
}

/** Hold each side's earliest opening open for at least the first-opening floor
 *  (a floor, never a ceiling: a window already longer than it is untouched). */
export function applyFirstOpeningFloor(windows: BattleWindow[], startedAt: number, durationMs: number): BattleWindow[] {
  const floor = BATTLES_CONFIG.windowFirstOpeningFloorMs;
  if (!(floor > 0)) return windows;
  const endAt = startedAt + durationMs;
  const bySide = new Map<BattleSide, BattleWindow[]>();
  for (const w of windows) {
    const list = bySide.get(w.side) ?? [];
    list.push(w);
    bySide.set(w.side, list);
  }
  for (const list of bySide.values()) {
    const ordered = [...list].sort((a, b) => a.opensAt - b.opensAt || a.closesAt - b.closesAt);
    const first = ordered[0];
    if (!first) continue;
    const nextOpens = ordered[1]?.opensAt ?? endAt;
    const capped = Math.min(nextOpens, endAt);
    const target = Math.min(first.opensAt + floor, capped);
    if (target > first.closesAt) first.closesAt = target;
  }
  return windows;
}

function edgeWindowFor(side: BattleSide, index: number, anchoredAt: number, dur: number): BattleWindow {
  const opens = anchoredAt + BATTLES_CONFIG.edgeWindowDelayMs;
  return { id: `w-edge-${index}-${side}`, kind: "edge", side, opensAt: opens, closesAt: opens + dur };
}

/** The complete window view — what each side may act on right now, what was
 *  already decided, and the exact open/close times (derived purely). */
export function windowsForView(battle: Battle, now: number): BattleWindowView[] {
  return battle.windows
    .slice()
    .sort((a, z) => a.opensAt - z.opensAt)
    .map((w) => {
      const d = battle.decisions.find((dd) => dd.windowId === w.id);
      const open = !d && now >= w.opensAt && now < w.closesAt;
      return {
        id: w.id,
        kind: w.kind,
        side: w.side,
        opensAt: w.opensAt,
        closesAt: w.closesAt,
        decided: !!d,
        action: d?.action,
        issuedAt: d?.issuedAt,
        open,
      };
    });
}

/** Append an edge window for `side` if it is currently losing badly enough to
 *  read rout-risk and has no edge window open for this episode. Pure: the
 *  decision sequence determines when this fires. */
function ensureEdgeWindow(battle: Battle, side: BattleSide, now: number): void {
  const gapAgainst = powerGap(battle.forcePower[side], battle.forcePower[other(side)]);
  if (gapAgainst < BATTLES_CONFIG.edgeWindowGap) return;
  const already = battle.windows.some((w) => w.kind === "edge" && w.side === side);
  if (already) return;
  const index = battle.windows.filter((w) => w.kind === "edge" && w.side === side).length + 1;
  // opens after the delay, from the moment the rout-risk was reached
  const opens = Math.max(now, battle.startedAt + BATTLES_CONFIG.edgeWindowDelayMs) + BATTLES_CONFIG.edgeWindowDelayMs;
  const dur = windowDurationMs(battle.durationMs);
  battle.windows.push({ id: `w-edge-${index}-${side}`, kind: "edge", side, opensAt: opens, closesAt: opens + dur });
}

/** The pure cost of one reinforcement order (the §6 march valve mirrored). */
export function reinforceCost(heroes: BattleHeroSnapshot[], troops: number): { energy: number; troops: number } {
  return {
    energy: heroes.length * BATTLES_CONFIG.reinforcementEnergyPerHero,
    troops: Math.max(0, Math.trunc(troops) || 0),
  };
}

/** Which actions are reachable for a side in a window right now — the UI's
 *  enabled/disabled set, derived purely. Eligibility is also enforced by
 *  issueDecision (this is for display; the server is the authority). */
export function reachableActions(
  battle: Battle,
  side: BattleSide,
  window: BattleWindowView,
  now: number,
  reserves: BattleReserves,
): { action: BattleDecisionAction; eligible: boolean; reason?: string }[] {
  if (!window.open) return [];
  const out: { action: BattleDecisionAction; eligible: boolean; reason?: string }[] = [
    { action: "hold", eligible: true },
    { action: "reinforce", eligible: reserves.energy > 0 || reserves.reserveTroops > 0, reason: reserves.energy <= 0 && reserves.reserveTroops <= 0 ? "No reserve troops or energy left." : undefined },
    { action: "withdrawal", eligible: !battle.decisions.some((d) => d.side === side && d.action === "withdrawal"), reason: "Already withdrawing." },
  ];
  const elapsedFrac = battle.durationMs > 0 ? (now - battle.startedAt) / battle.durationMs : 1;
  out.push({ action: "retreat", eligible: elapsedFrac >= BATTLES_CONFIG.minRetreatElapsedFrac, reason: "Too soon to break off." });
  const openAid = battle.aidCalls.filter((c) => c.callerSide === side && (c.status === "awaiting" || c.status === "locked")).length;
  out.push({ action: "callAid", eligible: openAid < BATTLES_CONFIG.maxAidPerSide && reserves.energy >= BATTLES_CONFIG.aidCallEnergy, reason: openAid >= BATTLES_CONFIG.maxAidPerSide ? "An aid call is already open." : "Not enough energy to raise the beacon." });
  return out;
}

/** Append a decision record (one per window per side — the window consumes it). */
function recordDecision(battle: Battle, win: BattleWindow, side: BattleSide, action: BattleDecisionAction, now: number, effects: BattleDecision["effects"]): BattleDecision {
  const decision: BattleDecision = { id: `d-${win.id}`, windowId: win.id, side, action, issuedAt: now, effects };
  battle.decisions.push(decision);
  return decision;
}

/** Recompute both sides' power from their committed forces (deterministic). */
function recomputePowers(battle: Battle): void {
  battle.forcePower.attacker = computeForcePower(battle.attacker);
  battle.forcePower.defender = computeForcePower(battle.defender);
}
/** Recompute both sides' FINAL casualties after a power step (deterministic). */
function recomputeCasualties(battle: Battle): void {
  battle.casualties.attacker = finalCasualties(battle.attacker, battle.defender, battle.forcePower.attacker, battle.forcePower.defender);
  battle.casualties.defender = finalCasualties(battle.defender, battle.attacker, battle.forcePower.defender, battle.forcePower.attacker);
}

export type DecisionResult =
  | { ok: true; decision: BattleDecision; duplicate?: boolean }
  | { ok: false; error: string };

/**
 * THE single entry point for a mid-battle order (B12). Deterministic +
 * idempotent: one decision per window per side; re-issuing the same window is
 * a no-op that returns the existing record. All effects follow from
 * (entity, payload, now) — no randomness, no wallet, no free lunch.
 */
export function issueDecision(
  battle: Battle,
  side: BattleSide,
  windowId: string,
  action: BattleDecisionAction,
  now: number,
  reserves: BattleReserves,
  payload?: ReinforcePayload,
): DecisionResult {
  // RETREAT stays idempotent even after the battle is over: the one recorded
  // retreat per side is returned (the UI never double-orders an abort).
  if (action === "retreat") {
    const existingRetreat = battle.decisions.find((d) => d.side === side && d.action === "retreat");
    if (existingRetreat) return { ok: true, decision: existingRetreat, duplicate: true };
  }
  if (battle.status !== "active") return { ok: false, error: "This battle is already decided." };
  // RETREAT is the emergency abort — once the minimum elapsed time has passed
  // its beacon is always lit, window or no window (the UI shows it as a live
  // button, not a window choice). Append-only + idempotent: one retreat per
  // side, forever; re-issuing returns the recorded decision.
  if (action === "retreat") {
    const elapsedFrac = battle.durationMs > 0 ? (now - battle.startedAt) / battle.durationMs : 1;
    if (elapsedFrac < BATTLES_CONFIG.minRetreatElapsedFrac) return { ok: false, error: "Too soon to break off — hold the line." };
    const troops = Math.max(0, Math.trunc(battle[side].troops) || 0);
    // B10: the army is saved — the covering force (a fixed fraction, no matter
    // how bad the rout-risk) is left behind; the enemy carries its ticked toll
    // so far (they mostly held their ground). Battle ends as THIS side's loss.
    const ownCas = Math.min(troops, Math.max(1, Math.round(troops * BATTLES_CONFIG.retreatCasualtyFrac)));
    const enemyCas = liveCasualties(battle, other(side), now);
    const winSide = other(side);
    battle.casualties[side] = ownCas;
    battle.casualties[winSide] = Math.min(Math.max(0, Math.trunc(battle[winSide].troops) || 0), enemyCas);
    battle.status = "resolved";
    battle.result = {
      outcome: winSide === "attacker" ? "attacker_victory" : "defender_victory",
      winnerColonyId: battle[winSide].colonyId,
      endedAt: now,
      endedBy: "retreat",
    };
    const decision: BattleDecision = {
      id: `d-retreat-${side}`,
      windowId: "",
      side,
      action: "retreat",
      issuedAt: now,
      effects: { kind: "retreat", casualties: { attacker: battle.casualties.attacker, defender: battle.casualties.defender }, endedAt: now },
    };
    battle.decisions.push(decision);
    return { ok: true, decision };
  }

  const existing = battle.decisions.find((d) => d.windowId === windowId);
  if (existing) {
    return existing.side === side
      ? { ok: true, decision: existing, duplicate: true }
      : { ok: false, error: "That decision window belongs to the other side." };
  }
  const win = battle.windows.find((w) => w.id === windowId);
  if (!win) return { ok: false, error: "Unknown decision window." };
  if (win.side !== side) return { ok: false, error: "That decision window belongs to the other side." };
  const closesAt = win.closesAt > win.opensAt ? win.closesAt : win.opensAt + windowDurationMs(battle.durationMs);
  if (now < win.opensAt || now >= closesAt) return { ok: false, error: "That decision window is closed." };

  switch (action) {
    case "hold":
      return { ok: true, decision: recordDecision(battle, win, side, "hold", now, { kind: "hold" }) };

    case "reinforce": {
      const heroes = payload?.heroes ?? [];
      const troops = Math.max(0, Math.trunc(payload?.troops ?? 0) || 0);
      if (heroes.length === 0 && troops === 0) return { ok: false, error: "Send something — a squad, troops, or both." };
      const cost = reinforceCost(heroes, troops);
      if (cost.troops > reserves.reserveTroops) return { ok: false, error: "Not enough reserve troops." };
      if (cost.energy > reserves.energy) return { ok: false, error: "Not enough war energy this week." };
      // A hero already in EITHER committed squad — or locked by an aid beacon
      // (the responder's march commitment) — cannot be re-fieldsed here.
      const committed = new Set<string>([
        ...battle.attacker.heroSquad.map((h) => h.id),
        ...battle.defender.heroSquad.map((h) => h.id),
        ...battle.aidCalls.flatMap((c) => c.heroes.map((h) => h.id)),
      ]);
      const seen = new Set<string>();
      for (const h of heroes) {
        if (committed.has(h.id) || seen.has(h.id) || !reserves.reserveHeroIds.includes(h.id)) {
          return { ok: false, error: "A hero in that order is already committed, locked, or not in your reserve." };
        }
        seen.add(h.id);
      }
      battle[side].heroSquad.push(...heroes);
      battle[side].troops += troops;
      const powerBefore = battle.forcePower[side];
      recomputePowers(battle);
      recomputeCasualties(battle);
      const powerAdded = battle.forcePower[side] - powerBefore;
      const decision = recordDecision(battle, win, side, "reinforce", now, {
        kind: "reinforce",
        powerAdded,
        troopsAdded: troops,
        heroNames: heroes.map((h) => h.name),
        energySpent: cost.energy,
      });
      ensureEdgeWindow(battle, other(side), now);
      return { ok: true, decision };
    }

    case "withdrawal": {
      if (battle.decisions.some((d) => d.side === side && d.action === "withdrawal")) {
        return { ok: false, error: "Your main body is already withdrawing." };
      }
      const force = battle[side];
      const troops = Math.max(0, Math.trunc(force.troops) || 0);
      // B10: the covering force bleeds the moment the order lands — heavier the
      // more pressure the enemy is applying (gap), capped so it can't wipe us.
      const gap = powerGap(battle.forcePower[side], battle.forcePower[other(side)]);
      const frac = Math.min(
        BATTLES_CONFIG.withdrawalRearguardMaxFrac,
        BATTLES_CONFIG.withdrawalRearguardBase + BATTLES_CONFIG.withdrawalRearguardGapRise * gap,
      );
      const rearguard = Math.min(troops, Math.round(troops * frac));
      const troopsRemaining = troops - rearguard;
      force.troops = troopsRemaining;
      recomputePowers(battle);
      // The rearguard is charged NOW; the fight goes on with the survivors.
      const remainingFight = finalCasualties(force, battle[other(side)], battle.forcePower[side], battle.forcePower[other(side)]);
      battle.casualties[side] = Math.min(troops, rearguard + remainingFight);
      recomputeCasualties(battle); // stay consistent with the other side
      const decision = recordDecision(battle, win, side, "withdrawal", now, {
        kind: "withdrawal",
        rearguardCasualties: rearguard,
        troopsRemaining: Math.max(0, troopsRemaining),
        powerAfter: battle.forcePower[side],
      });
      return { ok: true, decision };
    }

    case "callAid": {
      const open = battle.aidCalls.filter((c) => c.callerSide === side && (c.status === "awaiting" || c.status === "locked")).length;
      if (open >= BATTLES_CONFIG.maxAidPerSide) return { ok: false, error: "An aid call is already open for your side." };
      if (BATTLES_CONFIG.aidCallEnergy > reserves.energy) return { ok: false, error: "Not enough war energy to raise the beacon." };
      const arrivalAt = now + BATTLES_CONFIG.aidTravelDelayMs;
      const call: AidCall = {
        id: `aid-${battle.id}-${side}`,
        callerSide: side,
        // The colony that raised the beacon, by name — the aid row names it.
        callerName: battle[side].colonyName,
        issuedAt: now,
        arrivalAt,
        status: "awaiting",
        responder: null,
        heroes: [],
        weapons: [],
        troops: 0,
        fobStage: 0,
        power: 0,
      };
      battle.aidCalls.push(call);
      const decision = recordDecision(battle, win, side, "callAid", now, { kind: "callAid", aidCallId: call.id, arrivalAt, energySpent: BATTLES_CONFIG.aidCallEnergy });
      return { ok: true, decision };
    }
  }
  return { ok: false, error: "That order is not available here." };
}

/**
 * A teammate answers an aid call (B11): their force locks in IMMEDIATELY
 * (heroes committed, can't be withdrawn or re-fieldsed) and its power lands
 * at the call's arrivalAt (travel time over the links). Deterministic +
 * first-come: a locked call is answered. The responder's real cost (the §6
 * march energy per hero) is validated against `reserves` and stamped.
 */
export function respondToAid(battle: Battle, aidCallId: string, payload: AidResponsePayload, now: number, reserves: BattleReserves): DecisionResult {
  if (battle.status !== "active") return { ok: false, error: "This battle is already decided." };
  const call = battle.aidCalls.find((c) => c.id === aidCallId);
  if (!call) return { ok: false, error: "Unknown aid call." };
  if (call.status === "arrived") return { ok: false, error: "The aid has already arrived." };
  if (call.status === "locked") return { ok: false, error: "Another colony already answered this call." };
  const heroes = payload.heroes ?? [];
  const energyCost = heroes.length * BATTLES_CONFIG.aidRespondEnergyPerHero;
  if (energyCost > reserves.energy) return { ok: false, error: "Not enough war energy to march those heroes." };
  for (const h of heroes) {
    if (battle.attacker.heroSquad.some((x) => x.id === h.id) || battle.defender.heroSquad.some((x) => x.id === h.id) || !reserves.reserveHeroIds.includes(h.id)) {
      return { ok: false, error: "A hero from that force is already committed to this battle." };
    }
  }
  const aidForce = forceLike(call.callerSide, payload);
  call.responder = { colonyId: payload.colonyId, colonyName: payload.colonyName };
  call.heroes = heroes;
  call.weapons = payload.weapons ?? [];
  call.troops = Math.max(0, Math.trunc(payload.troops) || 0);
  call.fobStage = payload.fobStage;
  call.power = computeForcePower({ ...aidForce, side: call.callerSide });
  call.status = "locked";
  battle.decisions.push({
    id: `d-aid-${call.id}`,
    windowId: `aid-${call.id}`,
    side: call.callerSide,
    action: "respondAid",
    issuedAt: now,
    effects: { kind: "respondAid", aidCallId: call.id, powerAdded: call.power, arrivalAt: call.arrivalAt, energySpent: energyCost },
  });
  return { ok: true, decision: battle.decisions[battle.decisions.length - 1] };
}

function forceLike(side: BattleSide, p: AidResponsePayload): CommittedForce {
  return {
    side,
    colonyId: p.colonyId,
    colonyName: p.colonyName,
    heroSquad: p.heroes ?? [],
    weapons: p.weapons ?? [],
    troops: Math.max(0, Math.trunc(p.troops) || 0),
    fobStage: p.fobStage,
  };
}

/**
 * Lazy aid arrivals: a locked aid force joins the caller's side the moment
 * its travel time is up (offline-safe — called from advanceBattles before the
 * resolve check, so a late arrival can still flip the outcome). The power
 * step then recomputes powers + casualties and opens the OTHER side's edge
 * window if the arrival pushed them into rout-risk. Returns arrivals landed.
 */
export function advanceAidArrivals(battle: Battle, now: number): number {
  let landed = 0;
  for (const call of battle.aidCalls) {
    if (call.status !== "locked") continue;
    if (now < call.arrivalAt) continue;
    call.status = "arrived";
    const side = call.callerSide;
    const force = battle[side];
    force.heroSquad.push(...call.heroes);
    for (const kit of call.weapons ?? []) {
      const hit = force.weapons.find((w) => w.family === kit.family && w.tier === kit.tier);
      if (hit) hit.count += kit.count;
      else force.weapons.push({ ...kit });
    }
    force.troops += call.troops;
    force.fobStage = Math.max(force.fobStage, call.fobStage); // the FOB grows with the aid
    recomputePowers(battle);
    recomputeCasualties(battle);
    ensureEdgeWindow(battle, other(side), now);
    landed += 1;
  }
  return landed;
}

/** Resolve a battle when its wall-clock end arrives (deterministic; called by
 *  advanceBattles; a retreat already sets the same fields via issueDecision). */
function resolveScheduled(battle: Battle): void {
  battle.status = "resolved";
  battle.result = {
    outcome: outcomeFor(battle.forcePower.attacker, battle.forcePower.defender),
    endedAt: battleEndAt(battle),
    endedBy: "scheduled",
  };
  const out = battle.result.outcome;
  if (out === "attacker_victory") battle.result.winnerColonyId = battle.attacker.colonyId;
  else if (out === "defender_victory") battle.result.winnerColonyId = battle.defender.colonyId;
}

/** Append a battle's ledger report exactly once (idempotent — a crash between
 *  resolve and append cannot orphan a report; repeated ticks never double it). */
export function appendReportOnce(state: GameState, battle: Battle): void {
  if (!Array.isArray(state.battleReports)) state.battleReports = [];
  if (state.battleReports.some((r) => r && r.battleId === battle.id)) return;
  state.battleReports.push(buildReport(battle));
}

// ============================================================================
// §6 THE LIVE VIEW — everything the Battles tab renders, purely derived
// ============================================================================

/** Summed casualty tolls already CHARGED by decisions (withdrawal rearguard,
 *  retreat) at or before `now` — the live ticker floors at these, so a
 *  rearguard that bleeds mid-battle shows up immediately, deterministically. */
export function immediateToll(battle: Battle, side: BattleSide, now: number): number {
  let total = 0;
  for (const d of battle.decisions) {
    if (d.side !== side || d.issuedAt > now) continue;
    const e = d.effects;
    if (e.kind === "withdrawal") total += e.rearguardCasualties;
    else if (e.kind === "retreat") total += e.casualties[side];
  }
  return total;
}

/** Casualties ticked so far: advances one resolution interval at a time toward
 *  the current final toll (re-determined at every power step), and never below
 *  what decisions have already charged. Resolved battles read their final. */
export function liveCasualties(battle: Battle, side: BattleSide, now: number): number {
  const final = battle.casualties[side];
  if (battle.status !== "active" || now >= battleEndAt(battle)) return final;
  const elapsed = Math.max(0, now - battle.startedAt);
  const totalIntervals = Math.max(1, Math.ceil(battle.durationMs / BATTLES_CONFIG.resolutionIntervalMs));
  const done = Math.max(0, Math.min(totalIntervals - 1, Math.floor(elapsed / BATTLES_CONFIG.resolutionIntervalMs)));
  const ticked = Math.round(final * ((done + 1) / totalIntervals));
  return Math.min(final, Math.max(ticked, immediateToll(battle, side, now)));
}

/** The live state chip — a pure function of the power gap (§15.4). */
export function stateChip(gap: number): "stalemate" | "pressing" | "rout-risk" {
  if (gap < BATTLES_CONFIG.chipStalemateGap) return "stalemate";
  if (gap < BATTLES_CONFIG.chipPressingGap) return "pressing";
  return "rout-risk";
}

/** The shifting line: attacker win-probability, deterministic, starting
 *  near-neutral and moving toward the stronger side as the grind unfolds. */
export function attackerWinProb(pa: number, pd: number, elapsedFrac: number): number {
  const total = Math.max(1, pa + pd);
  const margin = (pa - pd) / total; // −1..1
  const reveal = 0.6 + 0.4 * Math.max(0, Math.min(1, elapsedFrac));
  return Math.max(0.05, Math.min(0.95, 0.5 + 0.5 * margin * reveal));
}

/** One pure snapshot of a battle at `now` — the single shape the Battles tab
 *  (list + detail) renders. Client and server call the SAME function, so the
 *  ticking view is provably the server's resolution math. */
export function battleMoment(battle: Battle, now: number): BattleMoment {
  const end = battleEndAt(battle);
  const elapsedMs = battle.status === "active" ? Math.max(0, Math.min(now - battle.startedAt, battle.durationMs)) : battle.durationMs;
  const remainingMs = Math.max(0, end - now);
  const elapsedFrac = battle.durationMs > 0 ? Math.max(0, Math.min(1, elapsedMs / battle.durationMs)) : 1;
  const gap = powerGap(battle.forcePower.attacker, battle.forcePower.defender);
  return {
    elapsedMs,
    remainingMs,
    elapsedFrac,
    chip: stateChip(gap),
    attackerWinProb: attackerWinProb(battle.forcePower.attacker, battle.forcePower.defender, elapsedFrac),
    casualties: {
      attacker: liveCasualties(battle, "attacker", now),
      defender: liveCasualties(battle, "defender", now),
    },
    gap,
    windows: windowsForView(battle, now),
    aidCalls: battle.aidCalls.map((c) => ({
      id: c.id,
      callerSide: c.callerSide,
      callerName: c.callerName ?? (c.callerSide === "attacker" ? battle.attacker.colonyName : battle.defender.colonyName),
      status: c.status,
      arrivalAt: c.arrivalAt,
      power: c.power,
      responderColonyName: c.responder?.colonyName,
      heroNames: c.heroes.map((h) => h.name),
    })),
  };
}

/** Public payload mapper — strips every server-only internal (publicState
 *  calls this per battle). The observable composition, power, odds and ticks
 *  are public by design (§15.4 — the strategic tool); `internal` is reserved
 *  for server-private bookkeeping and NEVER leaves the server. */
export function battlePublicView(battle: Battle): Battle {
  const { internal: _internal, ...pub } = battle;
  void _internal;
  return pub as Battle;
}