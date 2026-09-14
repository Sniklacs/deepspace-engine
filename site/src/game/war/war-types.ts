// WAR TYPES — the real-time battle engine's entity shapes + every tunable
// constant (design/battle-side-rvr-spec.md §15, B1/B4 ratified 2026-09-12).
//
// The battle engine IS The Fall's engine: a persistent battle entity that
// resolves over real time from strength inputs, offline-safe and lazily
// resolved in advance()-style ticks — the foundation the prologue ("The Fall")
// and the later server-vs-server war both run on (opening-prologue-spec §5/§15).
//
// PLACEMENT NOTE (v1): battles live PER-COLONY on the GameState this slice
// (the prologue is a solo story — the player's colony IS the protagonist; the
// world-level war ledger, data/world-<id>.json with every colony watching every
// front, arrives with war Phase 1 proper). The engine itself is world-agnostic
// pure math, so it ports unchanged.
//
// STRENGTH-INPUT DISCIPLINE (§15 B4 — the ONLY inputs, ratified):
//   hero stats + squad skills + weapon family/tier + FOB-stage ceiling +
//   supply-weighted troop counts. Nothing else. In particular:
//     • The committed forces are SNAPSHOTS (hero stats/skills flattened at
//       commit time) — the engine receives hero data as VALUES, never by
//       importing the hero catalog, so no wallet/currency/storefront field
//       can ever be inside the formula by construction (asserted by tests).
//     • No purchase vocabulary exists in this module or battle-engine.ts —
//       the static no-purchasable-term assertion scans both sources.
//     • No Math.random anywhere: outcome, power, duration, casualties and
//       every live tick are pure functions of (entity, now). Deterministic.
//
// Pure module: imports only type-only references; zero runtime imports so the
// client can render the same live view the server resolves.
import type { WeaponTier, WeaponType } from "../armory";

// ============================================================================
// §0 CONFIG — ONE block for every tunable number (B1 constants not contracts —
// calibration may change the numbers, never the rules).
// ============================================================================
export const BATTLES_CONFIG = {
  // ---- B1 duration curve (owner-ratified 2026-09-12, exact form) ----
  //   durationMs = base(20 min) × (1 + log₂(1 + totalPower/k)) ÷ (1 + 3 × gap)
  //   clamped [5 min, 8 h]. Small or one-sided fights end in minutes; large,
  //   evenly-matched fights grind for hours. `k` (SIZE_SCALE_K) is the
  //   calibration knob: it sets which force scale reads as "large". With
  //   k = 400, a top-end prologue force (~10k power/side) grinds ~2.5 h; the
  //   8 h clamp is the hard safety ceiling for true slugfests.
  baseDurationMs: 20 * 60_000,
  sizeScaleK: 400,
  gapDivisor: 3,
  minDurationMs: 5 * 60_000,
  maxDurationMs: 8 * 60 * 60_000,
  // ---- Casualty model (calibration-pending; rules stable) ----
  // Winner/loser final casualty FRACTIONS of committed troops, by power gap
  // (gap = |Pa−Pd| / max(Pa,Pd) ∈ 0..1). A hopeless defense bleeds hard; the
  // stronger side pays scale-of-war attrition. A standoff (equal power) bleeds
  // both sides at the standoff fraction. Hero-skill adjustments (damage
  // reduction / enemy guard penalty) then multiply the fraction.
  casualtyWinBase: 0.12,
  casualtyWinGapDrop: 0.08, // winner fraction falls with the gap: 0.12 → 0.04
  casualtyLoseBase: 0.3,
  casualtyLoseGapRise: 0.45, // loser fraction rises with the gap: 0.30 → 0.75
  casualtyStandoff: 0.22,
  casualtyMaxFrac: 0.95,
  // ---- Live view (B2) ----
  /** Casualties tick on this cadence — the live view's "resolution interval". */
  resolutionIntervalMs: 60_000,
  /** State chip thresholds (pure function of the power gap): below → the
   *  battle reads Stalemate; below this → Pressing (one side grinding
   *  forward); at/above → Rout risk for the weaker side. */
  chipStalemateGap: 0.1,
  chipPressingGap: 0.4,
  // ---- Hero term (B4: hero stats + squad skills + L3 spec) ----
  /** +12% hero power per earned level above 1 (the proven curve, war-flavored). */
  heroLevelScale: 0.12,
  /** Attribute weights over the four war attributes (calibration). */
  heroAttrWeights: { power: 1, guard: 0.8, presence: 0.7, craft: 0.1 } as const,
  /** L3 specialization multipliers (brief §4 — Vanguard offensive, Hearthward
   *  defensive, Courser is speed/economy: no combat power of its own). */
  heroSpecMults: { vanguard: 1.15, hearthward: 1.1, courser: 1 } as const,
  // ---- Weapon term (B4: weapon family/tier, kits committed) ----
  /** Stat weights over the four published weapon stats (armory WEAPON_BASE_STATS
   *  × the published tier multiplier ×1.5/×2.2/×3.2). */
  weaponStatWeights: { power: 2, precision: 1.5, guard: 1.5, logistics: 1 } as const,
  // ---- Troop term (B4: supply-weighted troop counts) ----
  /** Power per supply-weight of troops (calibration — the mass layer). */
  troopPowerPerTroop: 0.4,
  /** FOB-stage CEILING tables (§12.4 — the FOB sets the ceiling on what can be
   *  fielded: stage 0 = no FOB/home garrison; 1 Landing Pad · 2 Garrison ·
   *  3 Foundry · 4 Arsenal/Citadel). fobMaxTier caps weapon hardware; the
   *  troop cap bounds how much of your supply-weight can be brought to bear
   *  (the rest queues behind the front — real supply, no combat power). */
  fobMaxTierByStage: [1, 1, 2, 3, 4] as const, // index = FOB stage 0..4
  fobTroopCapByStage: [100, 150, 250, 400, 600] as const,
} as const;

// ============================================================================
// §1 TYPES
// ============================================================================

export type BattleSide = "attacker" | "defender";
/** Per-battle outcome — the deterministic result of the strength comparison. */
export type BattleOutcome = "attacker_victory" | "defender_victory" | "standoff";
export type BattleStatus = "active" | "resolved";
/** The war layer's 4-stage FOB + the none stage (0) for garrison/home ground. */
export type FobStage = 0 | 1 | 2 | 3 | 4;

/** One hero as COMMITTED — stat/skill snapshot flattened at commit time
 *  (persistent-world rule: the battle resolves against what was launched, even
 *  if the hero levels mid-fight). The engine reads ONLY these fields; it never
 *  imports the hero catalog (snapshot-by-value keeps the strength formula on
 *  the ratified §15 B4 inputs and structurally wallet-free). */
export interface BattleHeroSnapshot {
  id: string;
  name: string;
  role: "tank" | "damage" | "support" | "utility" | "econwar";
  level: number;
  attributes: { power: number; guard: number; craft: number; presence: number };
  specialization: "vanguard" | "hearthward" | "courser" | null;
  /** The squad skills that fire this battle (decision-window action mapping —
   *  B12 — arrives later; v1 commits every skill's published numbers). */
  skills: {
    id: string;
    name: string;
    /** Offensive/defensive strength (adds to this hero's power share). */
    strength?: number;
    /** Enemy effective guard penalty — raises the ENEMY side's casualties. */
    guardPenalty?: number;
    /** Friendly damage reduction — lowers THIS side's casualties. */
    damageReduction?: number;
    /** Scoring-only skills (capture/haul) — no combat power in v1. */
    scoring?: number;
  }[];
}

/** One committed weapon KIT: a war-role family at a tier, × how many fielded. */
export interface CommittedWeapon {
  family: WeaponType;
  tier: WeaponTier;
  count: number;
}

/** Everything one side brought to the fight — the §15 B4 input set, complete.
 *  `troops` is the supply-weighted troop count (the war layer computes it from
 *  the colony's war-supply ledger; the engine treats the number as given). */
export interface CommittedForce {
  side: BattleSide;
  colonyId: string;
  colonyName: string;
  heroSquad: BattleHeroSnapshot[];
  weapons: CommittedWeapon[];
  troops: number;
  /** FOB stage at commit — sets the hardware + staging ceilings (§12.4). */
  fobStage: FobStage;
}

/** The battle entity — a persistent timeline, resolved lazily like everything
 *  else in this game (offline-safe; `advanceBattles` in battle-engine.ts). */
export interface Battle {
  id: string;
  /** Battleground identity. v1 treats the zone as an opaque label pair — the
   *  contested-map linkage (zone-state transitions, §5/B5) arrives with war
   *  Phase 1. The prologue stamps its own fronts. */
  zoneId: string;
  zoneName: string;
  attacker: CommittedForce;
  defender: CommittedForce;
  /** §15 B4 strength out — computed purely at commit. */
  forcePower: { attacker: number; defender: number };
  /** B1 duration curve result (ms), clamped [5 min, 8 h]. */
  durationMs: number;
  startedAt: number; // epoch ms
  status: BattleStatus;
  result: BattleResult | null; // null while active
  /** FINAL casualties per side (troop-equivalents) — fully determined at
   *  commit; the live view ticks toward these per resolution interval. */
  casualties: { attacker: number; defender: number };
  /** Server-only internals — STRIPPED from every public payload
   *  (battlePublicView). Nothing about power/odds is hidden; this block is
   *  reserved for future server-private bookkeeping (reinforcement queues,
   *  B3/B11/B12) so this slice already owns the strip seam. */
  internal: { committedAt: number };
}

export interface BattleResult {
  outcome: BattleOutcome;
  /** Colony id of the winning side (absent on a standoff). */
  winnerColonyId?: string;
  endedAt: number;
}

/** The append-only battle-report ledger entry (the §7 History Book's raw
 *  material; reuses the ledger pattern — appended once per battle, idempotent,
 *  never mutated). */
export interface BattleSideReport {
  colonyId: string;
  colonyName: string;
  heroNames: string[];
  weapons: CommittedWeapon[];
  troops: number;
  fobStage: FobStage;
  power: number;
  casualties: number;
}
export interface BattleReport {
  battleId: string;
  zoneId: string;
  zoneName: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  outcome: BattleOutcome;
  winnerColonyId?: string;
  winnerColonyName?: string;
  attacker: BattleSideReport;
  defender: BattleSideReport;
  resolvedAt: number;
}

/** The live view — everything the Battles tab renders, derived purely. */
export interface BattleMoment {
  elapsedMs: number;
  remainingMs: number;
  elapsedFrac: number; // 0..1 of the fixed duration
  /** Live state chip (§15.4): "stalemate" | "pressing" | "rout-risk". */
  chip: "stalemate" | "pressing" | "rout-risk";
  /** The shifting line — deterministic attacker-win probability that moves
   *  from near-neutral toward the stronger side as the battle grinds (0..1,
   *  clamped 0.05–0.95). No randomness: it IS the strength edge, revealed. */
  attackerWinProb: number;
  /** Casualties ticked so far (per side) — advances each resolution interval. */
  casualties: { attacker: number; defender: number };
  /** Power gap 0..1 — the strength edge between the sides. */
  gap: number;
}