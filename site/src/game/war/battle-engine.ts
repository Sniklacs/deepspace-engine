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
  type Battle,
  type BattleHeroSnapshot,
  type BattleMoment,
  type BattleOutcome,
  type BattleReport,
  type BattleSide,
  type BattleSideReport,
  type CommittedForce,
  type FobStage,
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
 *  casualties out. The caller (war layer / prologue / tests) owns pushing it
 *  into state and advancing state first — this module never mutates state on
 *  commit (persistent-world discipline: resolution belongs to advance()). */
export function createBattle(input: CreateBattleInput, now: number): Battle {
  const pa = computeForcePower(input.attacker);
  const pd = computeForcePower(input.defender);
  const durationMs = battleDurationMs(pa, pd);
  const id = `bat-${now}-${input.attacker.colonyId}-${input.defender.colonyId}-${input.zoneId}`;
  return {
    id,
    zoneId: input.zoneId,
    zoneName: input.zoneName || input.zoneId,
    attacker: input.attacker,
    defender: input.defender,
    forcePower: { attacker: pa, defender: pd },
    durationMs,
    startedAt: now,
    status: "active",
    result: null,
    casualties: {
      attacker: finalCasualties(input.attacker, input.defender, pa, pd),
      defender: finalCasualties(input.defender, input.attacker, pd, pa),
    },
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
 *  would break determinism. */
export function ensureBattles(state: GameState): void {
  const s = state as unknown as Record<string, unknown>;
  if (!Array.isArray(s.battles)) s.battles = [];
  if (!Array.isArray(s.battleReports)) s.battleReports = [];
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
    // Resolved battles must own their ledger report — exactly once.
    if (b.status === "resolved" && !reports.some((r) => r && r.battleId === b.id)) {
      reports.push(buildReport(b));
    }
  }
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
  };
}

/**
 * THE lazy resolve: every active battle whose wall-clock end has passed is
 * finalized (status, result, Chronicle line, ledger report) — called from
 * engine.advance() so offline worlds resolve on the next read. Idempotent:
 * resolved battles are skipped, so repeated ticks (and repeated saves) can
 * never double-report. Returns how many battles resolved this tick.
 */
export function advanceBattles(state: GameState, now: number): number {
  if (!Array.isArray(state.battles)) return 0;
  let resolved = 0;
  for (const b of state.battles) {
    if (b.status !== "active") continue;
    if (now < battleEndAt(b)) continue;
    b.status = "resolved";
    b.result = { outcome: outcomeFor(b.forcePower.attacker, b.forcePower.defender), endedAt: battleEndAt(b) };
    if (b.result.outcome === "attacker_victory") b.result.winnerColonyId = b.attacker.colonyId;
    else if (b.result.outcome === "defender_victory") b.result.winnerColonyId = b.defender.colonyId;
    if (!Array.isArray(state.battleReports)) state.battleReports = [];
    state.battleReports.push(buildReport(b));
    logBattle(state, b);
    resolved += 1;
  }
  return resolved;
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
// §5 THE LIVE VIEW — everything the Battles tab renders, purely derived
// ============================================================================

/** Casualties ticked so far: advances one resolution interval at a time toward
 *  the (commit-determined) final toll. Resolved battles read their final. */
export function liveCasualties(battle: Battle, side: BattleSide, now: number): number {
  const final = battle.casualties[side];
  if (battle.status !== "active" || now >= battleEndAt(battle)) return final;
  const elapsed = Math.max(0, now - battle.startedAt);
  const totalIntervals = Math.max(1, Math.ceil(battle.durationMs / BATTLES_CONFIG.resolutionIntervalMs));
  const done = Math.max(0, Math.min(totalIntervals - 1, Math.floor(elapsed / BATTLES_CONFIG.resolutionIntervalMs)));
  return Math.round(final * ((done + 1) / totalIntervals));
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