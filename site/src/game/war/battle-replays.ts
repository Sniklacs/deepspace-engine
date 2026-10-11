// Battle replays — capture, storage, retention (owner 2026-10-11).
//
// The live battle scene records 1Hz keyframes (unit positions) plus a sparse
// event log (kills, shell impacts, hot drops). That's enough to play the
// battle back in BattleReplayViewer — positions interpolate between frames.
//
// Retention rules (owner's spec):
//   • Real PvP duels: ALWAYS saved automatically, retention "duel". They also
//     queue a result for the arena ladder rankings.
//   • Everything else: captured as "pending" — kept only if the commander
//     taps Save Replay (→ "manual"). Unsaved pendings are trashed after 24h.
// Storage is localStorage; listing prunes expired pendings and caps the shelf.

export type ReplaySide = "attacker" | "defender";

export interface ReplayKeyframeUnit {
  /** unit id */
  i: string;
  /** position, 3dp */
  x: number;
  y: number;
  s: ReplaySide;
  k: string;
  st: string;
}

export interface ReplayFrame {
  t: number;
  units: ReplayKeyframeUnit[];
}

export type ReplayEventKind = "kill" | "shell" | "drop" | "order" | "phase";

export interface ReplayEvent {
  t: number;
  kind: ReplayEventKind;
  x?: number;
  y?: number;
  side?: ReplaySide;
  label?: string;
}

export interface ReplaySquadStat {
  id: string;
  name: string;
  alive: number;
  total: number;
}

export type ReplayRetention = "duel" | "manual" | "pending";

export interface BattleReplay {
  id: string;
  battleId: string;
  name: string;
  attackerName: string;
  defenderName: string;
  victor: ReplaySide | null;
  startedAt: number;
  endedAt: number;
  durationS: number;
  /** real player-vs-player duel — always auto-saved, feeds the ladder */
  pvp: boolean;
  duelId?: string;
  retention: ReplayRetention;
  /** pending only — trash after this */
  expiresAt?: number;
  squads: ReplaySquadStat[];
  kills: { attacker: number; defender: number };
  /** newest-first order log lines */
  orders: string[];
  /** critical comms lines, oldest-first */
  keyMoments: string[];
  frames: ReplayFrame[];
  events: ReplayEvent[];
}

const REPLAY_KEY = "unbound.battle-replays.v1";
/** Unsaved replays are trashed after 24h (owner's spec). */
export const PENDING_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
/** Shelf cap — oldest pendings go first, then oldest manuals. Duels are kept. */
const MAX_REPLAYS = 30;

function readReplays(): BattleReplay[] {
  try {
    const raw = localStorage.getItem(REPLAY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as BattleReplay[]) : [];
  } catch {
    return [];
  }
}

function writeReplays(replays: BattleReplay[]): void {
  try {
    localStorage.setItem(REPLAY_KEY, JSON.stringify(replays));
  } catch {
    /* storage full or unavailable — the battle still happened */
  }
}

/**
 * Retention sweep (pure over the list): drop expired pendings, then enforce
 * the shelf cap (pendings first, then manuals, oldest first). Duels are
 * never swept. Returns the kept list.
 */
export function sweepReplays(replays: BattleReplay[], now: number): BattleReplay[] {
  const live = replays.filter(
    (r) => r.retention !== "pending" || (r.expiresAt ?? 0) > now,
  );
  if (live.length <= MAX_REPLAYS) return live;
  const duels = live.filter((r) => r.retention === "duel");
  const rest = live
    .filter((r) => r.retention !== "duel")
    .sort((a, b) => a.endedAt - b.endedAt);
  const keep = MAX_REPLAYS - duels.length;
  return [...duels, ...rest.slice(Math.max(0, rest.length - keep))];
}

/** List replays, newest first — prunes expired pendings as a side effect. */
export function listReplays(now: number = Date.now()): BattleReplay[] {
  const kept = sweepReplays(readReplays(), now);
  writeReplays(kept);
  return [...kept].sort((a, b) => b.endedAt - a.endedAt);
}

export function getReplay(id: string): BattleReplay | null {
  return readReplays().find((r) => r.id === id) ?? null;
}

/** Store a replay (capture finalize). Applies the retention sweep. */
export function storeReplay(replay: BattleReplay, now: number = Date.now()): void {
  const kept = sweepReplays(
    [replay, ...readReplays().filter((r) => r.id !== replay.id)],
    now,
  );
  writeReplays(kept);
}

/** Save Replay — a pending capture becomes a keeper. No-op for duels. */
export function markReplaySaved(id: string): boolean {
  const replays = readReplays();
  const r = replays.find((x) => x.id === id);
  if (!r || r.retention !== "pending") return false;
  r.retention = "manual";
  delete r.expiresAt;
  writeReplays(replays);
  return true;
}

export function deleteReplay(id: string): void {
  writeReplays(readReplays().filter((r) => r.id !== id));
}

/** Retention for a finished battle: duels auto-save, everything else pends. */
export function retentionForBattle(pvp: boolean): ReplayRetention {
  return pvp ? "duel" : "pending";
}

/**
 * Compact replay — the teaching tape embedded in an alliance doctrine
 * (owner 2026-10-11). Downsampled positions (no ids, no per-unit state),
 * interpolated on playback. Small enough to ride the alliance record.
 * Full-resolution replays stay on the author's device.
 */
export interface CompactReplay {
  /** seconds between frames */
  stepS: number;
  durationS: number;
  victor: ReplaySide | null;
  /** unit kind index table */
  kinds: string[];
  /** frames: [t, [x100, y100, sideIdx, kindIdx], ...] */
  frames: { t: number; u: number[] }[];
}

/** Max embedded replay size — doctrines ride the alliance record. */
export const MAX_COMPACT_REPLAY_BYTES = 24 * 1024;

/**
 * Downsample a captured replay into a compact teaching tape (pure).
 * Adaptively strides frames until the JSON fits the byte budget.
 */
export function compactReplay(replay: BattleReplay, maxBytes: number = MAX_COMPACT_REPLAY_BYTES): CompactReplay {
  const kinds: string[] = [];
  const kindIdx = (k: string): number => {
    let i = kinds.indexOf(k);
    if (i === -1) { kinds.push(k); i = kinds.length - 1; }
    return i;
  };
  const frames = replay.frames;
  let stride = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const out: { t: number; u: number[] }[] = [];
    for (let f = 0; f < frames.length; f += stride) {
      const fr = frames[f];
      const u: number[] = [];
      for (const unit of fr.units) {
        u.push(
          Math.round(unit.x * 100),
          Math.round(unit.y * 100),
          unit.s === "attacker" ? 0 : 1,
          kindIdx(unit.k),
        );
      }
      out.push({ t: Math.round(fr.t * 10) / 10, u });
    }
    const bytes = JSON.stringify(out).length + JSON.stringify(kinds).length;
    if (bytes <= maxBytes || stride >= frames.length || out.length <= 8) {
      return {
        stepS: Math.round(stride * frameStepS(replay) * 10) / 10,
        durationS: replay.durationS,
        victor: replay.victor,
        kinds,
        frames: out,
      };
    }
    stride *= 2;
  }
}

function frameStepS(replay: BattleReplay): number {
  if (replay.frames.length < 2) return 1;
  return Math.max(0.5, replay.frames[1].t - replay.frames[0].t);
}

/** Sensible default formation/battle name: battle name + date (owner 2026-10-11). */
export function defaultBattleName(battleName: string, now: number = Date.now()): string {
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${battleName} ${mm}/${dd}`;
}
