// RESEARCH TREE + LEADERS data.
//
// Two-track model (owner decision 2026-09-01):
//   Embers & Chipsets = AI fragments (the TOOL track) → study → Deploy.
//   Codices           = human knowledge (the KNOWLEDGE track) → RESEARCH TREE.
// Research costs Codices (earned, never looted) + real time, run by appointed
// Leaders whose specialty boosts the matching domain line.
import type { DomainId, Leader, Specialty } from "./types";
import { freshLeaderXpState } from "./leader-xp";

export interface Tech {
  id: string;
  domain: DomainId;
  index: number; // 0..3 within its domain (prev must be researched first)
  name: string;
  icon: string;
  description: string;
  effect: string; // concrete, visible effect this tech unlocks
  codicesCost: number;
  durationMs: number; // base real-time duration (research attr / specialty scale it)
}

// Specialty → the domain line it boosts. A Leader's specialty is her only boost.
export const SPECIALTY_DOMAIN: Record<Specialty, DomainId> = {
  tactician: "weaponry",
  horticulturist: "agriculture",
  economist: "economy",
  engineer: "industry",
  logistician: "logistics",
};

export const SPECIALTY_LABEL: Record<Specialty, string> = {
  tactician: "Tactician",
  horticulturist: "Horticulturist",
  economist: "Economist",
  engineer: "Engineer",
  logistician: "Logistician",
};

export const DOMAIN_SPECIALTY: Record<DomainId, Specialty> = {
  weaponry: "tactician",
  agriculture: "horticulturist",
  economy: "economist",
  industry: "engineer",
  logistics: "logistician",
};

// ---- the 5-domain × 4-tech tree (≈20 nodes) ----
export const TECH_TREE: Tech[] = [
  // Weaponry — arms & anti-Chorus. Reduces wildcard / corruption / chorus.
  { id: "w1", domain: "weaponry", index: 0, name: "Chorus-Sig Jammers", icon: "📡", description: "Static-lines tuned to the hive's call.", effect: "Surprise wildcard encounters −25%", codicesCost: 4, durationMs: 40_000 },
  { id: "w2", domain: "weaponry", index: 1, name: "Traction Cannons", icon: "💥", description: "Shells that dig taint out of the ground.", effect: "Corruption gain on raids −25%", codicesCost: 8, durationMs: 70_000 },
  { id: "w3", domain: "weaponry", index: 2, name: "Ordnance Works", icon: "🏭", description: "A foundry that turns salvage into arms.", effect: "Weaponry Deploy cost −30%", codicesCost: 15, durationMs: 120_000 },
  { id: "w4", domain: "weaponry", index: 3, name: "Siege Shore Batteries", icon: "🧨", description: "Coastal guns that keep the hive back.", effect: "Chorus attention gain −25%", codicesCost: 25, durationMs: 180_000 },

  // Agriculture — food & life. Boosts supplies.
  { id: "a1", domain: "agriculture", index: 0, name: "Hydroponics Grid", icon: "💧", description: "Water-fed towers that never stop growing.", effect: "+2 supplies/min", codicesCost: 4, durationMs: 40_000 },
  { id: "a2", domain: "agriculture", index: 1, name: "Seed Vaults", icon: "🌱", description: "Locked stores of the old world's crops.", effect: "+60% supplies recovered from expeditions", codicesCost: 8, durationMs: 70_000 },
  { id: "a3", domain: "agriculture", index: 2, name: "Triage Gardens", icon: "🩹", description: "Healing grounds that mend the wounded.", effect: "Scientist loss on raids −40%", codicesCost: 15, durationMs: 120_000 },
  { id: "a4", domain: "agriculture", index: 3, name: "Terraced Farms", icon: "🌾", description: "Ridged fields carved into the slopes.", effect: "+2 supplies/min", codicesCost: 25, durationMs: 180_000 },

  // Economy — trade & currency. Boosts exchange / yield.
  { id: "e1", domain: "economy", index: 0, name: "Trade Ledgers", icon: "📒", description: "Honest books for an honest exchange.", effect: "Embers→supplies trade 2× better", codicesCost: 4, durationMs: 40_000 },
  { id: "e2", domain: "economy", index: 1, name: "Salvage Contracts", icon: "📜", description: "Buyers bid on what you drag home.", effect: "+8% ember yield", codicesCost: 8, durationMs: 70_000 },
  { id: "e3", domain: "economy", index: 2, name: "Price Index", icon: "🏷️", description: "The Cradle stops overpaying.", effect: "Expedition cost −10%", codicesCost: 15, durationMs: 120_000 },
  { id: "e4", domain: "economy", index: 3, name: "Market Hall", icon: "🏛️", description: "A covered square where goods move.", effect: "+1 supplies/min", codicesCost: 25, durationMs: 180_000 },

  // Industry — workshops & fabrication. Cuts crafting cost / needs.
  { id: "i1", domain: "industry", index: 0, name: "Auto-Forge", icon: "🔥", description: "A furnace that works the night shift.", effect: "Workshop crafting cost −15%", codicesCost: 4, durationMs: 40_000 },
  { id: "i2", domain: "industry", index: 1, name: "Machine Shop", icon: "🔧", description: "Jigs and lathes that teach hands to fix.", effect: "Skilled-mechanics need −50%", codicesCost: 8, durationMs: 70_000 },
  { id: "i3", domain: "industry", index: 2, name: "Battery Fabrication", icon: "🔋", description: "Stamp fresh packs instead of scavenging.", effect: "Battery need −50%", codicesCost: 15, durationMs: 120_000 },
  { id: "i4", domain: "industry", index: 3, name: "Foundry Lines", icon: "⚙️", description: "A real production line at last.", effect: "Expedition duration −10%", codicesCost: 25, durationMs: 180_000 },

  // Logistics — range / vehicles / people. Extends fuel & bays.
  { id: "l1", domain: "logistics", index: 0, name: "Long-Haul Chassis", icon: "🛻", description: "Rigs built for the far road.", effect: "Vehicle fuel (gas) need −50%", codicesCost: 4, durationMs: 40_000 },
  { id: "l2", domain: "logistics", index: 1, name: "Silent Drives", icon: "🤫", description: "Engines that run without a sound.", effect: "Quiet battery need −40%", codicesCost: 8, durationMs: 70_000 },
  { id: "l3", domain: "logistics", index: 2, name: "Fleet Yards", icon: "🏗️", description: "Bays for more vehicles — and more riders.", effect: "+1 Leader slot", codicesCost: 15, durationMs: 120_000 },
  { id: "l4", domain: "logistics", index: 3, name: "Relay Network", icon: "📶", description: "Repeaters that keep convoys in touch.", effect: "+1 field slot · +1 scientist capacity", codicesCost: 25, durationMs: 180_000 },
];

export function getTech(id: string): Tech {
  return TECH_TREE.find((t) => t.id === id)!;
}

export function techsByDomain(domain: DomainId): Tech[] {
  return TECH_TREE.filter((t) => t.domain === domain).sort((a, b) => a.index - b.index);
}

export const CODX_PER_INDEX = [4, 8, 15, 25];

// ---- the hidden revelation chain (Unbound track; owner 2026-09-04) ----
// Standalone jobs (own ids, own costs, NO 6th domain, NO deployedDomains key).
// Cryptic names only — never "Unbound"/"Akashic" in plaintext. Descriptions and
// effects render ONLY after the node is visible; until then nothing exists.
export interface RevelationNode {
  id: string;
  codicesCost: number;
  durationMs: number;
  glyph: string;
  name: string;
  description: string;
  effect: string;
}
export const REVELATION_TREE: RevelationNode[] = [
  { id: "rv1", codicesCost: 30, durationMs: 300_000, glyph: "🌀", name: "The Unwritten Page", description: "A page that was written before the machines learned to write. It reads you back.", effect: "The Chorus notices the pure" },
  { id: "rv2", codicesCost: 45, durationMs: 600_000, glyph: "🕯️", name: "The Quiet Ledger", description: "The ledger balances without an engine to keep it.", effect: "Corruption drains slowly even in the field" },
  { id: "rv3", codicesCost: 60, durationMs: 900_000, glyph: "🌒", name: "The Witness Without a Machine", description: "A glimpse only. The path does not show itself twice.", effect: "Opens the Unbound glimpse decision" },
];

export function getRevelation(id: string): RevelationNode {
  return REVELATION_TREE.find((t) => t.id === id)!;
}

// ---- the Armory research line (weapons-system §6, V6) ----
// Standalone nodes (own ids, no domain, no deployedDomains key) on the same
// tech shape as the tree: hub "Armory" first, then the five per-family
// unlocks and Plasma Refinement (each requires the hub). Family forges show
// locked in the Armory tab until their research completes. Costs/durations
// are §7 defaults in the beta range (hub cheap; family unlocks like a w3/i3
// tier-3 node; refinement between).
export interface ArmoryTech {
  id: string;
  icon: string;
  name: string;
  description: string;
  effect: string;
  codicesCost: number;
  durationMs: number;
}
export const ARMORY_TREE: ArmoryTech[] = [
  { id: "armory_hub", icon: "🏛️", name: "Armory", description: "The Cradle's war-foundry: forges, rigs, and the mustered strength of the colony.", effect: "Opens the Armory — build or upgrade weapon families", codicesCost: 6, durationMs: 60_000 },
  { id: "armory_frontline", icon: "⚔️", name: "Frontline Forges", description: "Close-combat arms and guard-line weapons that hold the line.", effect: "Unlocks the Frontline family (The Unwritten Blade)", codicesCost: 12, durationMs: 120_000 },
  { id: "armory_assault", icon: "🔫", name: "Carbine Lines", description: "Mid-range plasma rifles that march with every column.", effect: "Unlocks the Assault family (The Attendance)", codicesCost: 12, durationMs: 120_000 },
  { id: "armory_precision", icon: "🎯", name: "Rail Sightworks", description: "Long-range marksmanship — the aimed word at any distance.", effect: "Unlocks the Precision family (Revelation Lens)", codicesCost: 12, durationMs: 120_000 },
  { id: "armory_siege", icon: "💥", name: "Siege Yard", description: "Extreme-range bombardment engines; the loudest curriculum.", effect: "Unlocks the Siege family (The Last Bell)", codicesCost: 12, durationMs: 120_000 },
  { id: "armory_engine", icon: "🛡️", name: "War-Frame Shed", description: "Walkers, shield-rigs and escort frames that draw the line real.", effect: "Unlocks the Engine family (Chalk-Mark Warden)", codicesCost: 12, durationMs: 120_000 },
  { id: "plasma_refinement", icon: "🔮", name: "Plasma Refinement", description: "The lab learns to condense embers into high-energy plasma.", effect: "Refine 25 embers → 1 plasma in the Lab", codicesCost: 10, durationMs: 90_000 },
];

export function getArmoryTech(id: string): ArmoryTech {
  return ARMORY_TREE.find((t) => t.id === id)!;
}

// ---- leaders (named colonists — earned, not gacha, never purchasable) ----
// Starter roster covers 3 of the 5 specialty lines (limited slots → a tradeoff
// about who to develop). More leaders join through deeds/rescue, not purchase.

export function starterLeaders(now: number): Leader[] {
  return [
    lead("vaera", "Vaera Sun", "economist", { research: 4, economy: 5, combat: 2, engineering: 2 }, now),
    lead("oric", "Oric Vey", "tactician", { research: 3, economy: 1, combat: 5, engineering: 2 }, now),
    lead("senna", "Senna Kade", "engineer", { research: 3, economy: 2, combat: 2, engineering: 5 }, now),
  ];
}

/** The leader a colony RESCUES by completing the deep clean-return deed. */
export function rescueLeader(now: number): Leader {
  return lead("aran", "Aran Holt", "logistician", { research: 3, economy: 2, combat: 3, engineering: 4 }, now);
}

function lead(
  id: string,
  name: string,
  specialty: Specialty,
  attributes: Leader["attributes"],
  now: number,
): Leader {
  const xp = freshLeaderXpState(now);
  return {
    id: `ld-${id}`,
    name,
    specialty,
    attributes,
    joinedAt: now,
    assignment: null, // techId currently researching, or null when free
    history: [],
    status: "active",
    breakthroughs: 0,
    codicesEarned: 0,
    xp: xp.xp,
    unspentPoints: 0,
    xpPointsGranted: 0,
    specialization: null,
    day: xp.day,
    dayXp: xp.dayXp,
  };
}
