// FormationDiagram — the playbook's visual language (owner 2026-10-06).
//
// Every play renders top-down: the formation's shape (wedge, line, wall),
// its slots as tappable positions, what's loaded in each slot, and
// entry-timing badges. South (the player's edge) at the bottom — the same
// orientation as the battlefield. Phone-readable: big tap targets.

import {
  entryLabel,
  formationSlots,
  type Play,
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
  const W = 300;
  const H = compact ? 200 : 300;
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
      className="w-full rounded-lg border border-white/10 bg-[#0b0e14]"
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
      {slots.map((s) => {
        const cx = s.dx * W;
        const cy = 24 + s.dy * (H - 48);
        const selected = s.id === selectedSlotId;
        const summary = slotSummary(loads, s.id);
        const empty = summary === "empty";
        return (
          <g key={s.id} data-testid={`diagram-slot-${s.id}`}>
            {onSlotTap ? (
              <g
                onClick={() => onSlotTap(s.id)}
                style={{ cursor: "pointer" }}
                role="button"
                aria-label={`${s.name} slot — ${summary}`}
              >
                <rect
                  x={cx - 52}
                  y={cy - 26}
                  width={104}
                  height={52}
                  rx={8}
                  fill={selected ? "rgba(245,158,11,0.22)" : empty ? "rgba(39,39,42,0.7)" : "rgba(24,24,27,0.9)"}
                  stroke={selected ? "#f59e0b" : "#52525b"}
                  strokeWidth={selected ? 2.5 : 1.2}
                />
              </g>
            ) : (
              <rect
                x={cx - 52}
                y={cy - 26}
                width={104}
                height={52}
                rx={8}
                fill={empty ? "rgba(39,39,42,0.7)" : "rgba(24,24,27,0.9)"}
                stroke="#52525b"
                strokeWidth={1.2}
              />
            )}
            <text x={cx} y={cy - 10} textAnchor="middle" fontSize={10} fill="#e4e4e7" fontWeight={700}>
              {s.name}
            </text>
            <text x={cx} y={cy + 6} textAnchor="middle" fontSize={11} fill={empty ? "#71717a" : "#fbbf24"}>
              {summary}
            </text>
            <text x={cx} y={cy + 20} textAnchor="middle" fontSize={8.5} fill={s.entry.kind === "oncall" ? "#67e8f9" : "#a1a1aa"}>
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
