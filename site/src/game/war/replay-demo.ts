// Canned battles for the battle-replay prototype.
//
// Built from the same plan shapes the rally presets use (AlliancePanel), with
// a scripted mid-battle state so every key moment — entries, surprise
// windows, screens, a withdrawal — sits on the timeline. Nothing here touches
// the engine; the replay renderer only reads the battle shape.
import type { BattlePlan, PlannedManeuver } from "./maneuvers";
import type {
  Battle,
  BattleDecision,
  BattlePlanState,
  ManeuverEntryState,
  ManeuverIntel,
  ManeuverVector,
} from "./war-types";

export type ReplayPreset = "thrust" | "pincer" | "hammer";

export const REPLAY_PRESETS: { id: ReplayPreset; label: string; blurb: string }[] = [
  { id: "thrust", label: "Main thrust", blurb: "Everything through the MAIN at T+0." },
  { id: "pincer", label: "Pincer", blurb: "MAIN holds, both flanks close at T+10. Left flank gets screened." },
  { id: "hammer", label: "Hammer & anvil", blurb: "MAIN pins, the REAR drops at T+20 — unscreened." },
];

const MIN = 60_000;
const POOL = 1200;

function planFor(preset: ReplayPreset): BattlePlan {
  const at = (pct: number) => Math.max(1, Math.round((POOL * pct) / 100));
  const maneuvers: PlannedManeuver[] = [];
  if (preset === "thrust") {
    maneuvers.push({ id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: POOL } });
  } else if (preset === "pincer") {
    maneuvers.push({ id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: at(60) } });
    maneuvers.push({ id: "m-fl", vector: "FLANK_LEFT", enterAtMin: 10, composition: { reaver: at(20) } });
    maneuvers.push({ id: "m-fr", vector: "FLANK_RIGHT", enterAtMin: 10, composition: { reaver: at(20) } });
  } else {
    maneuvers.push({ id: "m-main", vector: "MAIN", enterAtMin: 0, composition: { bulwark: at(50) } });
    maneuvers.push({ id: "m-rear", vector: "REAR", enterAtMin: 20, composition: { warden: at(30), reaver: at(20) } });
  }
  return { id: `demo-plan-${preset}`, maneuvers };
}

function weightOf(m: PlannedManeuver): number {
  return Object.values(m.composition ?? {}).reduce((s, n) => s + Math.max(0, Math.trunc(n ?? 0) || 0), 0);
}

/** Scripted defender screens per preset (epoch-ms absolute, computed by caller). */
function screensFor(preset: ReplayPreset, startedAt: number): BattlePlanState["screens"] {
  if (preset === "pincer") return { FLANK_LEFT: { at: startedAt + 6 * MIN } };
  return {};
}

/** A defender withdrawal to show "troops coming out" (pincer only). */
function decisionsFor(preset: ReplayPreset, startedAt: number): BattleDecision[] {
  if (preset !== "pincer") return [];
  return [
    {
      id: "d-demo-w1",
      windowId: "demo-w1",
      side: "defender",
      action: "withdrawal",
      issuedAt: startedAt + 95 * MIN,
      effects: { kind: "withdrawal", rearguardCasualties: 40, troopsRemaining: 500, powerAfter: 620 },
    },
  ];
}

/**
 * Build a demo battle. `staging=true` puts launch 10 minutes in the future so
 * the replay shows the pre-loaded plan view (Hans's "already have-loaded"
 * animation); otherwise the battle is 25 minutes in — mid-fight, LIVE works.
 */
export function buildDemoBattle(preset: ReplayPreset, now: number, staging = false): Battle {
  const plan = planFor(preset);
  const startedAt = staging ? now + 10 * MIN : now - 25 * MIN;
  const durationMs = 3 * 60 * MIN;
  const elapsedMin = Math.max(0, (now - startedAt) / MIN);
  const screens = screensFor(preset, startedAt);

  const entries: ManeuverEntryState[] = plan.maneuvers.map((m) => {
    const entered = !staging && elapsedMin >= m.enterAtMin;
    const enteredAt = entered ? startedAt + m.enterAtMin * MIN : undefined;
    const screened = !!screens[m.vector] && !!entered;
    const e: ManeuverEntryState = {
      maneuverId: m.id,
      vector: m.vector,
      enterAtMin: m.enterAtMin,
      entered,
      weight: weightOf(m),
    };
    if (enteredAt !== undefined) e.enteredAt = enteredAt;
    if ((m.vector === "FLANK_LEFT" || m.vector === "FLANK_RIGHT" || m.vector === "REAR") && enteredAt !== undefined) {
      e.surpriseUntil = enteredAt + 5 * MIN;
      e.screenedAtEntry = screened;
    }
    return e;
  });

  const planState: BattlePlanState = {
    side: "attacker",
    planId: plan.id,
    attachedAt: startedAt - 5 * MIN,
    entries,
    screens,
  };

  const composition: Record<string, number> = {};
  for (const m of plan.maneuvers) {
    for (const [t, n] of Object.entries(m.composition ?? {})) {
      composition[t] = (composition[t] ?? 0) + (n ?? 0);
    }
  }
  const intel: ManeuverIntel = {
    side: "attacker",
    composition,
    entered: entries
      .filter((e) => e.entered)
      .map((e) => ({
        id: e.maneuverId,
        vector: e.vector as ManeuverVector,
        troops: e.weight ?? 0,
        enteredAt: e.enteredAt ?? startedAt,
      })),
    unentered: entries.filter((e) => !e.entered).length,
  };

  const attackerTroops = plan.maneuvers.reduce((s, m) => s + weightOf(m), 0);
  const battle = {
    id: `demo-${preset}`,
    zoneId: "demo-beachhead",
    zoneName: "The Shatterfields — demo ground",
    attacker: {
      side: "attacker",
      colonyId: "demo-us",
      colonyName: "The Unbound (demo)",
      heroSquad: [],
      weapons: [],
      troops: attackerTroops,
      fobStage: 0,
    },
    defender: {
      side: "defender",
      colonyId: "demo-chorus",
      colonyName: "Chorus Hive (demo)",
      heroSquad: [],
      weapons: [],
      troops: 900,
      fobStage: 0,
    },
    forcePower: { attacker: 1050, defender: 880 },
    durationMs,
    startedAt,
    status: "active",
    result: null,
    casualties: { attacker: 150, defender: 190 },
    windows: [],
    decisions: decisionsFor(preset, startedAt),
    aidCalls: [],
    allianceId: "demo-war-band",
    maneuverIntel: intel,
    internal: {
      committedAt: startedAt,
      planState,
      rallyId: "demo-rally",
      allianceName: "The Ashen Compact (demo)",
    },
  };
  return battle as Battle;
}
