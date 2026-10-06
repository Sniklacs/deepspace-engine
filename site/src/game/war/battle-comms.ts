/**
 * Battle comms — the field-report layer (owner 2026-10-06).
 *
 * Every battlefield report (Longeye movement alerts, scout results,
 * reinforcement inbound warnings, counterattack/spoiling alerts, clock
 * warnings, reserve status, phase changes) arrives as a persistent
 * conversation bubble: source tag + short message. A bubble stays up
 * until the commander taps it — the tap is the confirmed read, and the
 * bubble dismisses into the comms/orders log (which keeps full history).
 * Critical alerts pulse; routine ones don't.
 *
 * "If it's worth telling the commander, it's worth waiting for
 * confirmation." — Hans
 *
 * This module is pure (queue ops + event specs) so the rules are unit
 * tested; the React component owns the tap interaction and the sound.
 */

// ---------------------------------------------------------------------------
// Bubble + queue
// ---------------------------------------------------------------------------

export interface CommsBubble {
  id: number;
  source: string;
  message: string;
  critical: boolean;
  /** sim-seconds when posted */
  atS: number;
}

/** Cap on unread bubbles — old unread ones age out, nothing is unbounded. */
export const MAX_COMMS = 8;
/** How many bubbles the stack shows before the "+N more" overflow line. */
export const COMMS_SHOWN = 3;

/** Push a bubble onto the queue (pure — returns the new queue). */
export function pushBubble(queue: CommsBubble[], b: CommsBubble): CommsBubble[] {
  const next = [...queue, b];
  return next.length > MAX_COMMS ? next.slice(next.length - MAX_COMMS) : next;
}

/** Tap = confirmed read: remove the bubble by id (pure). */
export function dismissBubble(queue: CommsBubble[], id: number): CommsBubble[] {
  return queue.filter((b) => b.id !== id);
}

/** What the stack renders: the first COMMS_SHOWN bubbles + overflow count. */
export function commsView(queue: CommsBubble[]): {
  shown: CommsBubble[];
  overflow: number;
  unread: number;
} {
  return {
    shown: queue.slice(0, COMMS_SHOWN),
    overflow: Math.max(0, queue.length - COMMS_SHOWN),
    unread: queue.length,
  };
}

// ---------------------------------------------------------------------------
// Event specs — every comms event maps to source + message + criticality.
// The component posts these; the log entry is written at the same time,
// so no alert is ever lost (bubble AND log entry, always).
// ---------------------------------------------------------------------------

export type CommsEventKind =
  | "movement"
  | "scout-lost"
  | "scout-ok"
  | "wave"
  | "counter"
  | "spoiling"
  | "envelop"
  | "clock-3"
  | "clock-1"
  | "clock-end"
  | "phase"
  | "reserve";

export interface CommsSpec {
  source: string;
  message: string;
  critical: boolean;
}

/**
 * Build the bubble spec for a field event. `detail` carries the variable
 * part (sector label, flank side, phase name, …).
 */
export function commsFor(kind: CommsEventKind, detail: string): CommsSpec {
  switch (kind) {
    case "movement":
      return {
        source: `LONGEYES — ${detail}`,
        message: `Movement — enemy squad pushing toward ${detail}`,
        critical: true,
      };
    case "scout-lost":
      return { source: "SCOUT", message: "SCOUT LOST — deploying blind", critical: true };
    case "scout-ok":
      return {
        source: "SCOUT",
        message: "Scout complete — enemy disposition revealed",
        critical: false,
      };
    case "wave":
      return {
        source: "CHORUS",
        message: `Chorus reinforcements inbound — ${detail} vector`,
        critical: true,
      };
    case "counter":
      return {
        source: "CHORUS",
        message: "Chorus commits its reserve — they smell blood",
        critical: true,
      };
    case "spoiling":
      return {
        source: "CHORUS",
        message: "Bastion launches a spoiling attack — it's hunting",
        critical: true,
      };
    case "envelop":
      return {
        source: "CHORUS",
        message: `Bastion envelops your ${detail} flank`,
        critical: true,
      };
    case "clock-3":
      return {
        source: "CLOCK",
        message: "3:00 of timeline left — break them or the defense holds",
        critical: false,
      };
    case "clock-1":
      return { source: "CLOCK", message: "1:00 — the timeline is running out", critical: true };
    case "clock-end":
      return {
        source: "CLOCK",
        message: "Timeline expired — the defense held, raid failed",
        critical: true,
      };
    case "phase":
      return { source: "PHASE", message: detail, critical: false };
    case "reserve":
      return { source: "RESERVE", message: detail, critical: false };
  }
}

/** Every kind the engine can post — the "no alert is lost" test walks this. */
export const COMMS_EVENT_KINDS: readonly CommsEventKind[] = [
  "movement",
  "scout-lost",
  "scout-ok",
  "wave",
  "counter",
  "spoiling",
  "envelop",
  "clock-3",
  "clock-1",
  "clock-end",
  "phase",
  "reserve",
];

// ---------------------------------------------------------------------------
// Movement watches — the Longeye report rule, pure and testable.
// An enemy move is watched from step-off; at REPORT_PROGRESS of its
// progress the sector's Longeyes report it (the component checks
// hasLongeyeCover for the destination vector). The report shows the
// moving squad + a fixed-length direction vector — never a perfect
// destination readout.
// ---------------------------------------------------------------------------

export interface WatchUnit {
  x: number;
  y: number;
  state: string;
}

export interface MoveWatch {
  units: WatchUnit[];
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  destVector: string;
  startsAt: number;
  reported: boolean;
}

/** Report at ~50% of the move's progress. */
export const REPORT_PROGRESS = 0.5;

/** Fixed arrow length (world units) — direction, not destination. */
export const REPORT_ARROW_LEN = 0.18;

/** 0..1+ progress of a watched move, from the live units' centroid. */
export function watchProgress(w: MoveWatch): number {
  const live = w.units.filter((u) => u.state !== "dead");
  if (live.length === 0) return 1;
  const cx = live.reduce((s, u) => s + u.x, 0) / live.length;
  const cy = live.reduce((s, u) => s + u.y, 0) / live.length;
  const total = Math.hypot(w.toX - w.fromX, w.toY - w.fromY);
  if (total <= 0.01) return 1;
  return Math.hypot(cx - w.fromX, cy - w.fromY) / total;
}

/** True once the move has stepped off and reached report progress. */
export function watchShouldReport(w: MoveWatch, tS: number): boolean {
  return !w.reported && tS >= w.startsAt && watchProgress(w) >= REPORT_PROGRESS;
}
