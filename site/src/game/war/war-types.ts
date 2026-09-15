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
  // ---- Decision windows (B12 — windows, not APM; ratified 2026-09-12) ----
  // Decisions happen at resolution MILESTONES, not by reflex: over the battle's
  // duration each side may issue ONE consequential order per window (reinforce /
  // hold / steady withdrawal / retreat / call aid). Windows are stamped
  // deterministically at commit (milestones for both sides) + appended by
  // power-affecting decisions (edge windows for the side that just fell behind).
  /** The elapsed-fraction milestones that open a window for BOTH sides. */
  windowMilestoneFracs: [0.25, 0.5, 0.75] as const,
  /** A window stays open 12% of the battle (calibration), clamped. */
  windowDurationFrac: 0.12,
  windowMinMs: 2 * 60_000,
  windowMaxMs: 15 * 60_000,
  /** An EDGE window opens for a side when the power gap against it reads
   *  rout-risk (same threshold as chipPressingGap) — the "getting pummeled"
   *  teaching moment (opening-prologue §12.3), survivable first. */
  edgeWindowGap: 0.4,
  /** How long after the rout-risk state is reached the edge window opens. */
  edgeWindowDelayMs: 30_000,
  /** Retreat is never instant and never free (B10): allowed only after this
   *  fraction of the battle has elapsed, and it always bleeds a rearguard. */
  minRetreatElapsedFrac: 0.1,
  // ---- Reinforcement & aid-call real costs (the §6 server valves, mirrored —
  // the war-energy number below IS war-energy.ts ACTION_ENERGY_COSTS.march, the
  // same non-extendable pool; the engine mirrors it so it can validate purely) —
  reinforcementEnergyPerHero: 20, // §6 march action cost, per hero committed
  aidCallEnergy: 10, // §6 shield/haul floor — the caller pays to raise the beacon
  aidRespondEnergyPerHero: 20, // responders march their heroes (the same §6 cost)
  /** Aid arrivals ride travel time over the links (§13) — a single calibration
   *  delay now; the per-link table lands with war Phase 1. */
  aidTravelDelayMs: 10 * 60_000,
  /** One open aid call per side per battle (coordination, never a bypass). */
  maxAidPerSide: 1,
  // ---- Withdrawal & retreat casualty model (B10 — rearguard cost vs. army) ----
  /** Steady withdrawal: the covering force bleeds the moment the order lands —
   *  base toll at no pressure, rising with the enemy's advantage (gap). */
  withdrawalRearguardBase: 0.12,
  withdrawalRearguardGapRise: 0.2,
  withdrawalRearguardMaxFrac: 0.35,
  /** After the rearguard is bled, the main body is gone — the side fights on
   *  with the survivors (troop term drops; the battle still ends on schedule). */
  /** Retreat (B10): the army is saved — only this fraction is left behind as
   *  the covering force, no matter how bad the rout-risk was. */
  retreatCasualtyFrac: 0.08,
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
  /** FINAL casualties per side (troop-equivalents) — determined at commit and
   *  re-determined at every power step (decision effects); the live view ticks
   *  toward the current final per resolution interval. */
  casualties: { attacker: number; defender: number };
  /** B12 decision windows — stamped deterministically at commit (milestones
   *  for both sides + an edge window when the opening gap reads rout-risk)
   *  and appended by power-affecting decisions (the newly-losing side gets
   *  its edge window). */
  windows: BattleWindow[];
  /** The append-only decision ledger — one entry per window per side, never
   *  mutated, never double-issued (idempotent re-application is a no-op). */
  decisions: BattleDecision[];
  /** B11 aid beacons (≤ maxAidPerSide per side). */
  aidCalls: AidCall[];
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
  /** How the battle closed: "scheduled" = the B1 curve ran out; "retreat" =
   *  a side aborted (B10) — reduced losses, and that side lost the ground. */
  endedBy?: "scheduled" | "retreat";
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
  /** How the battle closed (see BattleResult.endedBy). */
  endedBy?: "scheduled" | "retreat";
  /** The append-only decision trail, in issue order — the §12 tutorial's raw
   *  material ("what happened at 32%") and the war recap's decision log. */
  decisions: { side: BattleSide; action: BattleDecisionAction; issuedAt: number }[];
  /** The side that conceded ground via steady withdrawal, if any. */
  withdrawnSide?: BattleSide;
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
  /** B12 decision windows at `now` — what each side may act on right now. */
  windows: BattleWindowView[];
  /** B11 aid calls at `now` — beacon state for both sides. */
  aidCalls: AidCallView[];
}

// ============================================================================
// §1b DECISION WINDOWS (B12) & AID CALLS (B11) — owned by battle-engine.ts
// ============================================================================

/** The one consequential order a side may issue per window (B12). */
export type BattleDecisionAction =
  | "reinforce" // commit reserve heroes/troops — real cost from the colony's reserve
  | "hold" // stay the course — outcome proceeds as simulated (taught first)
  | "withdrawal" // steady withdrawal (B10): concede ground, bleed a rearguard, save the army
  | "retreat" // abort (B10): reduced losses, battle ends as a loss, no ground gained
  | "callAid" // B11: raise the co-op beacon; arrivals ride travel time
  | "respondAid"; // B11: a teammate commits heroes — locked in for the battle

export type BattleWindowKind = "milestone" | "edge";
/** The window index within a kind (milestone fracs 1..3, edge 1..N). */
export interface BattleWindow {
  id: string; // `w-milestone-<frac>-<side>` | `w-edge-<n>-<side>`
  kind: BattleWindowKind;
  side: BattleSide;
  opensAt: number;
  closesAt: number;
}

/** What a side commits when it reinforces — the §15 B4 snapshot shape again
 *  (heroes/weapons/troops as VALUES; the FOB ceiling applies as committed).
 *  The real cost (war energy + reserve troops) is validated against the
 *  colony's `BattleReserves` and recorded in the decision effects. */
export interface ReinforcePayload {
  heroes: BattleHeroSnapshot[];
  troops: number; // supply-weighted troop count added (subject to the FOB cap)
}

/** What a responding colony commits to an aid call (B11) — its own force,
 *  marched over the links, locked for the battle the moment it responds. */
export interface AidResponsePayload {
  colonyId: string;
  colonyName: string;
  heroes: BattleHeroSnapshot[];
  weapons: CommittedWeapon[];
  troops: number;
  fobStage: FobStage;
}

/** Deterministic effects of one decision — stamped at issue time, recorded
 *  append-only, and everything the live view + report derive about it. */
export type DecisionEffects =
  | { kind: "reinforce"; powerAdded: number; troopsAdded: number; heroNames: string[]; energySpent: number }
  | { kind: "hold" }
  | { kind: "withdrawal"; rearguardCasualties: number; troopsRemaining: number; powerAfter: number }
  | { kind: "retreat"; casualties: { attacker: number; defender: number }; endedAt: number }
  | { kind: "callAid"; aidCallId: string; arrivalAt: number; energySpent: number }
  | { kind: "respondAid"; aidCallId: string; powerAdded: number; arrivalAt: number; energySpent: number };

/** One append-only decision record — one per window per side, never mutated,
 *  never re-issued (idempotency: the window consumes it). */
export interface BattleDecision {
  id: string; // `d-<windowId>` — unique per window
  windowId: string;
  side: BattleSide;
  action: BattleDecisionAction;
  issuedAt: number;
  effects: DecisionEffects;
}

/** An aid beacon (B11): the caller raises it, responders lock in, the power
 *  lands at arrivalAt (travel time over the links). Never free — the caller
 *  pays aidCallEnergy; every responder pays the §6 march cost for locked
 *  heroes. `responder` + committed force are null until someone answers. */
export interface AidCall {
  id: string; // `aid-<battleId>-<side>`
  callerSide: BattleSide;
  issuedAt: number;
  arrivalAt: number; // issuedAt + aidTravelDelayMs (arrivals ride travel time)
  status: "awaiting" | "locked" | "arrived";
  responder: { colonyId: string; colonyName: string } | null;
  /** The committed aid force — set at respond time, locked for the battle. */
  heroes: BattleHeroSnapshot[];
  weapons: CommittedWeapon[];
  troops: number;
  fobStage: FobStage;
  power: number; // computeForcePower of the arriving force — contributes at arrival
}

/** The colony's deployable reserve, as the war layer sees it (the engine
 *  treats the numbers as given — same discipline as CommittedForce.troops).
 *  The caller (API handler / prologue / war layer) verifies these against the
 *  colony's own ledgers (hero roster + §6 weekly energy + supply ledger) and
 *  deducts the recorded costs; the engine only VALIDATES against the values
 *  and stamps the auditable cost into the decision. */
export interface BattleReserves {
  /** ids of colony heroes NOT already committed to this battle (caller-verified). */
  reserveHeroIds: string[];
  /** supply-weighted reserve troops the colony can still commit. */
  reserveTroops: number;
  /** war energy the colony can spend on orders this week (§6 pool, caller-verified). */
  energy: number;
}

export interface BattleWindowView {
  id: string;
  kind: BattleWindowKind;
  side: BattleSide;
  /** currently actionable: now ∈ [opensAt, closesAt) and not yet decided. */
  open: boolean;
  decided: boolean;
  action?: BattleDecisionAction;
  issuedAt?: number;
  opensAt: number;
  closesAt: number;
}

export interface AidCallView {
  id: string;
  callerSide: BattleSide;
  status: "awaiting" | "locked" | "arrived";
  arrivalAt: number;
  power: number;
  responderColonyName?: string;
  heroNames: string[];
}

/** The colony-level war reserve (B12/B11) — the server-verified numbers a
 *  colony can commit mid-battle: supply-weighted reserve troops, the §6
 *  weekly war-energy pool (colony-level view of the per-hero pool), the
 *  locked-hero commitment ledger (a hero committed to one battle cannot be
 *  re-fielsed until it ends), and the co-op recognition ledger (aid calls
 *  answered — recognition, never power). The engine validate/deducts through
 *  BattleReserves; the API/prologue own this store. Grows only from play. */
export interface WarReserve {
  troops: number;
  energy: number;
  cycleId: string | null; // the war week these numbers belong to
  aidCredits: number;
  lockedHeroes: Record<string, { battleId: string; until: number }>;
}