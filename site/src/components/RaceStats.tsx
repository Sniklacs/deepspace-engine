import type { Race } from "../game/types";
import { raceStatRows } from "../game/races";
import { useT } from "./i18n/I18n";

// Uniform race stats block for the race-choice surfaces (owner 2026-10-13:
// the stats belong on the race descriptions because "that's how they choose").
// Renders ALL SEVEN rows from raceStatRows() — same order, same format for
// every race, baseline values included — so cards compare side by side.
// Values come from the race's live engine mods; this is display only.
// Inline styles on purpose: the founding screen is Tailwind, ServerSelect is
// inline-styled, and the block must read identically in both.

const GOOD = "#4ade80";
const BAD = "#f87171";
const NEUTRAL = "rgba(255,255,255,0.5)";

const LABEL_FALLBACKS: Record<string, string> = {
  studySpeed: "Study speed",
  emberLoot: "Ember loot",
  chipsetChance: "Chipset chance",
  explorationCost: "Exploration cost",
  corruptionGain: "Corruption gain",
  chorusGain: "Chorus gain",
  baseSupplies: "Base supplies",
};

export default function RaceStats({ race, compact = false }: { race: Race; compact?: boolean }) {
  const t = useT();
  const rows = raceStatRows(race);
  return (
    <div style={{ marginTop: compact ? 8 : 12, marginBottom: compact ? 0 : 14 }}>
      {!compact && (
        <p
          style={{
            margin: "0 0 6px",
            paddingTop: 10,
            borderTop: `1px solid ${race.accent}59`,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            opacity: 0.6,
          }}
        >
          {t("cfg.raceStats.title", "Race stats")}
        </p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          rowGap: compact ? 2 : 3,
          columnGap: 12,
          fontSize: compact ? 11 : 13,
        }}
      >
        {rows.map((row) => (
          <div key={row.key} style={{ display: "contents" }}>
            <span style={{ opacity: 0.75 }}>{t(`cfg.raceStats.${row.key}`, LABEL_FALLBACKS[row.key])}</span>
            <span
              style={{
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                color: row.good === null ? NEUTRAL : row.good ? GOOD : BAD,
              }}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
