// FormationDiagram — the playbook's visual language (owner 2026-10-06).
//
// Every play renders top-down: the formation's shape (wedge, line, wall),
// its slots as tappable positions, what's loaded in each slot, and
// entry-timing badges. South (the player's edge) at the bottom — the same
// orientation as the battlefield. Phone-readable: big tap targets.
//
// 2026-10-06 sizing fix: slot boxes used to overlap (a six-slot column
// cannot physically fit 52-unit boxes into ~250 usable units), later
// boxes covered earlier boxes' click targets, and clicks on the labels
// were dead because only the rect carried the handler. layoutDiagramSlots
// now resolves box collisions in 2D and grows the viewBox so nothing
// overlaps or clips; the whole slot group (box + labels) is the button.

import {
  entryLabel,
  formationSlots,
  type Play,
  type PlaySlot,
  type SavedFormation,
  type SlotLoads,
} from "../../game/war/playbook";
import { TROOP_TYPES, type TroopType } from "../../game/war/troops";

const TYPE_GLYPH: Record<TroopType, string> = {
  bulwark: "🛡",
  reaver: "⚔",
  longeye: "👁",
  thunder: "💥",
  warden: "🔧",
};

const TYPE_SHORT: Record<TroopType, string> = {
  bulwark: "BLW",
  reaver: "RVR",
  longeye: "LNE",
  thunder: "THD",
  warden: "WRD",
};

function slotSummary(loads: SlotLoads, slotId: string): string {
  const picks = loads[slotId] ?? [];
  const total = picks.reduce((n, p) => n + Math.max(0, Math.trunc(p.count)), 0);
  if (total === 0) return "empty";
  const kinds = [...new Set(picks.map((p) => p.type))];
  return `${kinds.map((k) => TYPE_GLYPH[k]).join("")} ${total}`;
}

export const DIAGRAM_W = 300;
export const SLOT_BOX_W = 104;
export const SLOT_BOX_H = 52;

export interface SlotLayout {
  /** per-slot center x, in viewBox units */
  cx: number[];
  /** per-slot center y, in viewBox units (collision-resolved) */
  cy: number[];
  /** final viewBox height — grown when slots need more room */
  viewH: number;
}

/** Collision-free slot layout for the formation diagram (pure).
 *
 * Slot positions come from hand-authored dx/dy (0..1) per play, plus
 * player-customized overrides — neither is guaranteed collision-free.
 * This resolves overlaps top-to-bottom: a slot drops below every
 * previously placed slot whose box it would horizontally touch, and the
 * viewBox grows so the lowest box never clips the legend strip. Works for
 * every playbook play AND arbitrary custom slot sets. */
export function layoutDiagramSlots(
  slots: PlaySlot[],
  baseH: number,
): SlotLayout {
  const TOP_PAD = 30; // ▲ N marker
  const LEGEND_PAD = 28; // legend strip
  const GAP_X = 8;
  const GAP_Y = 10;

  const safe01 = (v: number) =>
    Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;

  const cx = slots.map((s) => {
    const raw = safe01(s.dx) * DIAGRAM_W;
    return Math.min(
      Math.max(raw, SLOT_BOX_W / 2 + 4),
      DIAGRAM_W - SLOT_BOX_W / 2 - 4,
    );
  });
  const baseCy = slots.map(
    (s) => TOP_PAD + safe01(s.dy) * (baseH - TOP_PAD - LEGEND_PAD),
  );

  // Top-to-bottom: each slot must clear every earlier slot it would
  // horizontally touch. Earlier slots already hold final positions, so one
  // pass leaves the whole set pairwise collision-free.
  const order = slots
    .map((_, i) => i)
    .sort((a, b) => baseCy[a] - baseCy[b]);
  const cy = [...baseCy];
  for (const idx of order) {
    let need = cy[idx];
    for (const prev of order) {
      if (prev === idx) break;
      if (Math.abs(cx[prev] - cx[idx]) < SLOT_BOX_W + GAP_X) {
        need = Math.max(need, cy[prev] + SLOT_BOX_H + GAP_Y);
      }
    }
    cy[idx] = need;
  }

  let viewH = baseH;
  if (slots.length > 0) {
    const lowest = Math.max(...cy.map((y) => y + SLOT_BOX_H / 2));
    viewH = Math.max(baseH, Math.ceil(lowest + LEGEND_PAD));
  }
  return { cx, cy, viewH };
}

export function FormationDiagram({
  play,
  formation = null,
  loads,
  selectedSlotId = null,
  onSlotTap = null,
  compact = false,
}: {
  play: Play | null;
  /** when set, slot renames/re-vectors apply (formations view) */
  formation?: SavedFormation | null;
  loads: SlotLoads;
  selectedSlotId?: string | null;
  onSlotTap?: ((slotId: string) => void) | null;
  compact?: boolean;
}) {
  const slots = formation
    ? formationSlots(formation)
    : (play?.slots ?? []);
  const W = DIAGRAM_W;
  const baseH = compact ? 200 : 300;
  const { cx, cy, viewH: H } = layoutDiagramSlots(slots, baseH);
  // Shape underlay — the formation's silhouette.
  const shapePath =
    play?.shape === "wedge"
      ? `M ${W / 2} 18 L ${W - 30} ${H - 30} L 30 ${H - 30} Z`
      : play?.shape === "wall"
        ? `M 30 40 H ${W - 30} M 30 90 H ${W - 30}`
        : `M 30 60 H ${W - 30}`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="mx-auto h-auto w-full max-w-[440px] rounded-lg border border-white/10 bg-[#0b0e14]"
      style={{ height: "auto" }}
      role="img"
      aria-label={play ? `${play.name} formation diagram` : "Custom formation diagram"}
      data-testid="formation-diagram"
    >
      {play?.shape === "wedge" ? (
        <path d={shapePath} fill="none" stroke="#3f3f46" strokeWidth={2} strokeDasharray="6 4" />
      ) : (
        <path d={shapePath} fill="none" stroke="#3f3f46" strokeWidth={10} strokeLinecap="round" opacity={0.5} />
      )}
      {/* north edge marker — the enemy is that way */}
      <text x={W / 2} y={14} textAnchor="middle" fontSize={9} fill="#71717a" fontWeight={700}>
        ▲ N — ENEMY
      </text>
      {slots.map((s, i) => {
        const sx = cx[i];
        const sy = cy[i];
        const selected = s.id === selectedSlotId;
        const summary = slotSummary(loads, s.id);
        const empty = summary === "empty";
        return (
          <g
            key={s.id}
            data-testid={`diagram-slot-${s.id}`}
            {...(onSlotTap
              ? {
                  onClick: () => onSlotTap(s.id),
                  style: { cursor: "pointer" },
                  role: "button",
                  "aria-label": `${s.name} slot — ${summary}`,
                }
              : {})}
          >
            <rect
              x={sx - SLOT_BOX_W / 2}
              y={sy - SLOT_BOX_H / 2}
              width={SLOT_BOX_W}
              height={SLOT_BOX_H}
              rx={8}
              fill={selected ? "rgba(245,158,11,0.22)" : empty ? "rgba(39,39,42,0.7)" : "rgba(24,24,27,0.9)"}
              stroke={selected ? "#f59e0b" : "#52525b"}
              strokeWidth={selected ? 2.5 : 1.2}
            />
            <text x={sx} y={sy - 10} textAnchor="middle" fontSize={10} fill="#e4e4e7" fontWeight={700}>
              {s.name}
            </text>
            <text x={sx} y={sy + 6} textAnchor="middle" fontSize={11} fill={empty ? "#71717a" : "#fbbf24"}>
              {summary}
            </text>
            <text x={sx} y={sy + 20} textAnchor="middle" fontSize={8.5} fill={s.entry.kind === "oncall" ? "#67e8f9" : "#a1a1aa"}>
              {entryLabel(s.entry)}
            </text>
          </g>
        );
      })}
      {/* legend strip */}
      <text x={12} y={H - 8} fontSize={8.5} fill="#71717a">
        {TROOP_TYPES.map((t) => `${TYPE_GLYPH[t]}${TYPE_SHORT[t]}`).join("  ")}
      </text>
    </svg>
  );
}
