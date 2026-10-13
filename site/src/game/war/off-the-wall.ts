// OFF THE WALL — the War Room chalkboards (design/war-room-walls.md,
// owner decision Oct 12 2026; live build Oct 13 2026).
//
// "The War Room is a BIG HALLWAY of chalkboards. The walls carry HANDWRITTEN
// game tips — chalkboard style, not formal text blocks. The tips ARE the
// game's FAQ, written as riddles the way the Oracle would say them: cryptic
// one-liners, no explanation, no questions — just offhand comments scrawled
// on the wall, like someone wrote them and walked away."
//
// Three boards live here as DATA (this file holds no hooks, like tooltips.tsx):
//   · THE PLAYBOOK — the 24 battle doctrine maxims (Oct 4–5 2026). Each
//     maxim is a short chalk scrawl on the wall; tapping it magnifies to the
//     fuller doctrine text.
//   · FIELD MARKS — the Oct 11 2026 doctrine additions (rear entry, breach,
//     siege falloff, shields, the attrition governor), same shape.
//   · OFF THE WALL — the cryptic scrawls proper. NO body, NO explanation,
//     ever (spec rule). They click AFTER the player learns the hard way.
//     The first line is OWNER-LOCKED VERBATIM (Hans, Oct 12 2026) — do not
//     edit a single character of WALL_SCRAWLS[0].
//
// The LIVE layer (pure functions below) is what makes it a live wall and
// not a poster: the war board reads the player's real battle ledger, the
// "lesson" board pins the maxim the player's LAST battle just taught them,
// the fresh-chalk rotation turns over daily, the contextual strip surfaces
// the existing tooltip corpus by the player's actual meters, and the
// Oracle board speaks with the player's own race Oracle, a new riddle
// every day.

import type { Battle } from "./war-types";
import { METER_TIPS, EXPEDITION_TIPS, type TooltipBlock } from "../tooltips";
import { ORACLE_BY_ID } from "../oracles";

export type WallBoardId = "war" | "playbook" | "field-marks" | "scrawls" | "word";

export interface WallEntry {
  id: string;
  /** The chalk line as it sits small on the wall. */
  chalk: string;
  /** The magnified text. Absent on scrawls — they are never explained. */
  body?: string;
  /** Owner-locked verbatim — render exactly, never paraphrase. */
  locked?: boolean;
}

/** THE PLAYBOOK — 24 maxims, Oct 4–5 2026 (memory/2026-10-05.md). */
export const WALL_MAXIMS: WallEntry[] = [
  { id: "approach", chalk: "Study the ground before you bleed on it.", body: "THE APPROACH — every battle opens with a 30-second approach phase: study the map and terrain, set your vectors. Placements must be legal." },
  { id: "command", chalk: "One hand on the wheel — or your own hand on yours.", body: "COMMAND — the raid leader drives all five players' troops if they hand over full control. Any player can take their own troops back and own their vector — and its consequences." },
  { id: "legality", chalk: "Siege never flanks.", body: "MANEUVER LEGALITY — troop types have hard constraints, enforced by the engine: siege can NEVER sweep or flank; rear entry needs an escort. Illegal orders are rejected outright." },
  { id: "timers", chalk: "Call it when you see it.", body: "TIMERS — a manual commander calls timed maneuvers ANYTIME. On auto, timers are locked in as pre-programmed before the fight." },
  { id: "delayed-entry", chalk: "Some guns arrive when the fight is already old.", body: "DELAYED ENTRY — siege can stage at the very rear on a 5–10 minute entry timer before it even appears on the field." },
  { id: "terrain", chalk: "The field is a weapon. Read it.", body: "TERRAIN — battlefields use local terrain. Fight the ground you're given." },
  { id: "touchdown", chalk: "Movers move. Holders hold.", body: "TOUCHDOWN — when the approach ends, movers move to their assigned positions and holders hold. Ships climb to a holding pattern; a ship stays grounded only as a turret platform." },
  { id: "clock-45", chalk: "45 seconds to get your shit straight.", body: "THE 45-SECOND CLOCK — 30 seconds of approach plus 15 to unload: FIRST CONTACT at T+45. That window is all you get." },
  { id: "logistics-auto", chalk: "The blanket never sleeps.", body: "LOGISTICS RUNS ON AUTOPILOT — jamming and target painting execute by doctrine, always, even in manual battles. Losing logistics mid-battle is the scariest moment of the fight: everything gets harder when the blanket comes off." },
  { id: "first-blood-60", chalk: "Weapons live at sixty.", body: "FIRST BLOOD AT T+60 — fifteen seconds after first contact, weapons go live and shit starts flying." },
  { id: "working-timer", chalk: "Everyone fights to the same clock.", body: "THE WORKING TIMER — a shared, visible battle clock keeps all five players in step with the same timeline." },
  { id: "leader-authority", chalk: "Change the plan — not the engaged.", body: "LEADER AUTHORITY MID-BATTLE — the leader can call withdrawals or extra troops ANYTIME, and change vectors — but only for units not yet engaged." },
  { id: "commitment", chalk: "Casualties means commitment.", body: "CASUALTIES MEANS COMMITMENT — engagement is a one-way door. Once a unit is engaged and casualties have started, there is no backing out and no vector change. Commitment is permanent." },
  { id: "field-control", chalk: "First blood holds the field.", body: "FIRST BLOOD = FIELD CONTROL — whoever shoots first and scores the first casualties effectively controls the field. Initiative is a real mechanic, not flavor." },
  { id: "relief", chalk: "Rescue is a maneuver, not a button.", body: "WITHDRAWAL REQUIRES RELIEF — an engaged unit under pressure cannot simply withdraw. An unengaged vector must pressure the assailant and break their momentum; only in that pause can withdrawal be called. And judgment cuts both ways: feeding more troops into a lost fight just adds casualties." },
  { id: "flinch", chalk: "Pressure buys the seconds.", body: "THE FLINCH WINDOW — relief makes the enemy flinch, and the withdrawal window lasts as long as the relieving vector keeps the pressure on. Better troops buy more time — and a covered withdrawal can turn into a tag-team reversal." },
  { id: "ace", chalk: "Never commit everything.", body: "THE ACE IN THE HOLE — always keep reserves embarked in dropships, ready to drop. If you're pressured all the way around, the reserve is what saves you." },
  { id: "thresholds", chalk: "One bullet can change a war.", body: "VICTORY THRESHOLDS — battles break on casualty and morale thresholds, not on the opening force snapshot. Upsets are real: the stronger force does not always win." },
  { id: "handicap", chalk: "The better commander is a weapon.", body: "THE COMMAND HANDICAP — decision quality (reaction time, legal orders, flinch exploitation, casualty efficiency, reserve timing) shifts effective strength and break thresholds live. A weaker force with a better commander can beat a stronger one. The judge is deterministic — no dice in the dark." },
  { id: "arena-calibrates", chalk: "Practice is where the judges are judged.", body: "THE ARENA CALIBRATES THE JUDGE — practice battles are where command scoring gets tuned. The team judges the judges by watching practice before it goes live." },
  { id: "tape", chalk: "The tape settles it.", body: "EVERY BATTLE IS RECORDED — all battles get replays, stored for a time; a player save persists for the account's lifetime. When the math says you lost but your gut says you were winning, the tape is the court of appeals." },
  { id: "film-ritual", chalk: "Watch the film. Together.", body: "REPLAYS ARE A TEAM RITUAL — teammates watch film together and stay honest with each other. \"Did I really lose that shit?\" Alliance film review is a social driver of the game." },
  { id: "auto-vs-manual", chalk: "Pros do infuriating things.", body: "AUTO VS MANUAL — auto is straightforward; against manual it's anybody's fight, though raw strength usually takes the field — except against pros, whose logistics and timing are a visible skill ceiling." },
  { id: "playbook-depth", chalk: "They don't know what you called.", body: "PLAYBOOK DEPTH — when we say playbooks we mean PLAYBOOKS: a deep library of offensive and defensive plays. The opponent does NOT know which play you've called. Hidden plans are the mind game." },
];

/** FIELD MARKS — doctrine additions, Oct 11 2026. */
export const WALL_FIELD_MARKS: WallEntry[] = [
  { id: "rear-entry", chalk: "The rear is a door only dropships open.", body: "REAR ENTRY — jump-ship combat drop ONLY, and it requires at least 20% Warden escort. Ground moves can never reach behind enemy lines. Period." },
  { id: "breach", chalk: "Grind the Wardens. Then send the Reavers.", body: "THE BREACH RULE — intact Warden lines block ALL ground movement, including Reavers. Once the enemy Wardens are ground down, Reavers — only Reavers — can push through the breach." },
  { id: "siege-falloff", chalk: "Shells don't ask whose side you're on.", body: "SIEGE — visible arcing shells, and friendly fire is real. AoE falloff: 2m 100% / 5m 70% / 10m 50% / 15m 30% / 20m 10% / beyond 20m, nothing." },
  { id: "shields", chalk: "Blue, then yellow, then red.", body: "SHIELDS — only Warden-bearing units have them: the blue shield bar goes first, then yellow armor, then red hull. The shield regenerates if the Wardens survive." },
  { id: "governor", chalk: "Nobody dies all at once.", body: "THE ATTRITION GOVERNOR — per-squad damage caps mean no burst wipes. A 3-to-1 losing squad grinds down over 30–60 seconds. You always get a reaction window." },
];

/**
 * OFF THE WALL — the cryptic scrawls. No bodies. No explanations.
 * The FIRST line is Hans's, verbatim, locked Oct 12 2026 — it foreshadows
 * fallen-hero extraction without ever explaining it. Do not edit it.
 */
export const WALL_SCRAWLS: WallEntry[] = [
  {
    id: "extraction",
    chalk: "I hope you have that elite squad at home waiting, ready to roll if shit hits the fan and your ass needs carrying out of there.",
    locked: true,
  },
  { id: "blanket", chalk: "When the blanket comes off, everybody finds out who was naked." },
  { id: "tape-alone", chalk: "The tape never lies. That's why nobody watches it alone." },
  { id: "chorus-dig", chalk: "The Chorus sings loudest to the ones who dig deepest." },
  { id: "running", chalk: "Running is just dying tired — unless somebody's shooting over your shoulder." },
  { id: "oracle-writes", chalk: "She writes on the wall when she feels like it. Read it anyway." },
  { id: "veteran", chalk: "A veteran is a rookie who got read the wall in time." },
  { id: "empty-ship", chalk: "An empty dropship is a coffin with better PR." },
];

export const WALL_MAXIM_BY_ID: Record<string, WallEntry> = Object.fromEntries(
  [...WALL_MAXIMS, ...WALL_FIELD_MARKS].map((e) => [e.id, e]),
);

// ---------------------------------------------------------------------------
// The LIVE layer — pure functions over the player's real state.
// ---------------------------------------------------------------------------

/** Minimal structural slice of a battle the wall reads (Battle satisfies it). */
export interface WallBattleSlice {
  id: string;
  zoneName: string;
  status: Battle["status"];
  startedAt: number;
  attacker: { colonyId: string; colonyName: string; troops: number };
  defender: { colonyId: string; colonyName: string; troops: number };
  casualties: { attacker: number; defender: number };
  result: Battle["result"];
}

export interface WallContext {
  /** The player's own colony id (state.gameId). */
  me: string;
  battles: WallBattleSlice[];
  /** 0–100 — how close the Chorus is circling (state.chorusAttention). */
  chorusAttention: number;
  /** 0–100 (state.corruption). */
  corruption: number;
  now: number;
}

export interface WallFront {
  battleId: string;
  zoneName: string;
  foeName: string;
  /** True when the player is the attacking side. */
  attacking: boolean;
}

export interface WallLastBattle {
  battleId: string;
  zoneName: string;
  foeName: string;
  /** true = the player won, false = lost, null = standoff / not theirs. */
  won: boolean | null;
  myCasualties: number;
  theirCasualties: number;
  endedByRetreat: boolean;
  endedAt: number;
}

export interface WallLiveFeed {
  /** Fronts the player is fighting on, right now. */
  fronts: WallFront[];
  /** The player's most recent finished battle, if any. */
  lastBattle: WallLastBattle | null;
  /** Total resolved battles the player has fought. */
  battlesFought: number;
  /** The maxim id the last battle just taught (the lesson board pins it). */
  lessonMaximId: string;
}

function mySide(b: WallBattleSlice, me: string): "attacker" | "defender" | null {
  if (b.attacker.colonyId === me) return "attacker";
  if (b.defender.colonyId === me) return "defender";
  return null;
}

/**
 * The lesson the last battle taught, as a maxim id. Deterministic — the
 * same ledger always chalks the same lesson.
 */
export function lessonMaximFor(last: WallLastBattle | null, battlesFought: number): string {
  if (!last) return battlesFought === 0 ? "approach" : "tape";
  if (last.endedByRetreat) return "relief";
  if (last.won === false) return "commitment";
  if (last.won === null) return "thresholds";
  // A win that cost more of ours than theirs: the reserve lesson.
  if (last.myCasualties >= last.theirCasualties && last.myCasualties > 0) return "ace";
  return "field-control";
}

export function wallLiveFeed(ctx: WallContext): WallLiveFeed {
  const fronts: WallFront[] = [];
  let lastBattle: WallLastBattle | null = null;
  let battlesFought = 0;
  for (const b of ctx.battles) {
    const side = mySide(b, ctx.me);
    if (!side) continue;
    const foe = side === "attacker" ? b.defender : b.attacker;
    if (b.status === "active") {
      fronts.push({ battleId: b.id, zoneName: b.zoneName, foeName: foe.colonyName, attacking: side === "attacker" });
    } else {
      battlesFought += 1;
      const endedAt = b.result?.endedAt ?? b.startedAt;
      if (!lastBattle || endedAt > lastBattle.endedAt) {
        const mine = side === "attacker" ? b.casualties.attacker : b.casualties.defender;
        const theirs = side === "attacker" ? b.casualties.defender : b.casualties.attacker;
        lastBattle = {
          battleId: b.id,
          zoneName: b.zoneName,
          foeName: foe.colonyName,
          won: b.result?.winnerColonyId ? b.result.winnerColonyId === ctx.me : null,
          myCasualties: Math.trunc(mine),
          theirCasualties: Math.trunc(theirs),
          endedByRetreat: b.result?.endedBy === "retreat",
          endedAt,
        };
      }
    }
  }
  fronts.sort((a, b) => a.zoneName.localeCompare(b.zoneName));
  return { fronts, lastBattle, battlesFought, lessonMaximId: lessonMaximFor(lastBattle, battlesFought) };
}

// ---------------------------------------------------------------------------
// Daily rotation — the fresh chalk. Deterministic per UTC day: the same
// wall all day, a new wall tomorrow. No storage, no randomness at render.
// ---------------------------------------------------------------------------

export function wallDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function dayHash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** `count` entries starting at a day-seeded offset, wrapping. Stable all day. */
export function rotateDaily<T>(items: readonly T[], now: number, count: number): T[] {
  if (items.length === 0 || count <= 0) return [];
  const start = dayHash(wallDayKey(now)) % items.length;
  const out: T[] = [];
  for (let i = 0; i < Math.min(count, items.length); i++) out.push(items[(start + i) % items.length]);
  return out;
}

/** The scrawls in today's fresh chalk (the full set still lives on its board). */
export function freshScrawls(now: number, count = 3): WallEntry[] {
  return rotateDaily(WALL_SCRAWLS, now, count);
}

// ---------------------------------------------------------------------------
// Contextual strip — the existing tooltip corpus, surfaced by what the
// player's meters and fronts actually look like right now.
// ---------------------------------------------------------------------------

export interface WallTipRef {
  block: "meter" | "expedition";
  id: string;
  tip: TooltipBlock;
  /** Why it's on the wall today, in plain words ("" = part of the rotation). */
  because: string;
}

const TIP_POOL: WallTipRef[] = [
  { block: "meter", id: "chorus", tip: METER_TIPS.chorus, because: "" },
  { block: "meter", id: "corruption", tip: METER_TIPS.corruption, because: "" },
  { block: "expedition", id: "risk", tip: EXPEDITION_TIPS.risk, because: "" },
  { block: "expedition", id: "alloyShort", tip: EXPEDITION_TIPS.alloyShort, because: "" },
];

export function wallContextualTips(ctx: WallContext, feed: WallLiveFeed): WallTipRef[] {
  const out: WallTipRef[] = [];
  const push = (ref: WallTipRef) => {
    if (!out.some((r) => r.block === ref.block && r.id === ref.id)) out.push(ref);
  };
  if (ctx.chorusAttention >= 60) {
    push({ block: "meter", id: "chorus", tip: METER_TIPS.chorus, because: "Your Chorus attention is high" });
  }
  if (ctx.corruption >= 50) {
    push({ block: "meter", id: "corruption", tip: METER_TIPS.corruption, because: "Your corruption is heavy" });
  }
  if (feed.fronts.length > 0) {
    push({ block: "expedition", id: "risk", tip: EXPEDITION_TIPS.risk, because: "You're fighting on a live front" });
  }
  for (const ref of rotateDaily(TIP_POOL, ctx.now, TIP_POOL.length)) {
    if (out.length >= 3) break;
    push(ref);
  }
  return out.slice(0, 3);
}

// ---------------------------------------------------------------------------
// The Oracle's word — the player's own race Oracle, a new riddle daily.
// ---------------------------------------------------------------------------

export interface WallOracleWord {
  oracleName: string;
  epithet: string;
  line: string;
}

export function wallOracleWord(raceId: string | null | undefined, now: number): WallOracleWord | null {
  if (!raceId) return null;
  const def = ORACLE_BY_ID[raceId.trim().toLowerCase() as keyof typeof ORACLE_BY_ID];
  if (!def || def.riddles.length === 0) return null;
  const line = def.riddles[dayHash(`${wallDayKey(now)}:${def.id}`) % def.riddles.length];
  return { oracleName: def.name, epithet: def.epithet, line };
}
