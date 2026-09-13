// THE ARMORY — colony-side war hardware (weapons system, owner 2026-09-12).
//
// Spec: design/weapons-system.md (§1–§8) + design/weapons-catalogs-all-races.md
// (the data appendix — all six race catalogs, filled here as drop-in data).
// This module is the PURE data + math core: the five-type war-role frame, the
// per-race family catalogs (ALL six races filled from the data appendix; the
// beta world is Watchers-locked, the rest activate at their world launches via
// the same race-lock config — zero engine changes), the tier stat model
// (T1 base × 1.5/2.2/3.2), the §6 cost/time table, plasma refinement &
// deep-raid salvage constants, and the model-designation naming
// (`FamilyName — <TierLanguage> Mk <I|II|III|IV>`).
//
// ENGINE-RULE GUARDRAILS (asserted by tests):
//   • Earn-only: no currency vocabulary exists in this module or its surface —
//     plasma/weapons/builds are earned by play, never purchasable.
//   • The catalog is a data table keyed by raceId — family ids stay the 5
//     roles, so engine state keys, research unlocks, and the Armory UI are
//     race-independent.
//   • All §7-flagged numbers (bases, multipliers, costs, times, plasma ratio)
//     live in ARMORY_CONFIG — one config object, per the design.
import type { RaceId } from "./types";

// ---- the five war roles (uniform across every race) ----
export const WEAPON_TYPES = ["frontline", "assault", "precision", "siege", "engine"] as const;
export type WeaponType = (typeof WEAPON_TYPES)[number];

export type WeaponTier = 1 | 2 | 3 | 4;

export interface WeaponStats {
  power: number; // damage
  precision: number; // accuracy / counterplay
  guard: number; // defense / hold
  logistics: number; // march / supply efficiency
}

export interface WeaponCost {
  supplies: number;
  embers: number;
  fuel: number; // the colony's `gas` (vehicle fuel) resource
  plasma: number;
}

/** One row of the catalog — a race's named family for a war role. */
export interface WeaponFamily {
  /** The role id ("frontline" etc.) — stable across races; the armory key. */
  id: WeaponType;
  name: string;
  identity: string; // the in-fiction identity line («"..."»)
  icon: string;
  role: string; // short role label ("Frontline · hold the line")
}

// ======================================================================
// §7-flags — ONE config object (defaults set; owner confirmation pending).
// ======================================================================
export const ARMORY_CONFIG = {
  // §4 base stats by type (T1).
  tierMult: [1, 1.5, 2.2, 3.2] as const, // T2/T3/T4 multipliers over T1
  // §2 plasma: the lab refines 25 embers → 1 plasma (research-gated).
  plasmaRefineEmbers: 25,
  // §2 deep-raid salvage: chipset sites (deep zones) occasionally yield 2–5
  // plasma alongside chipsets — the risk-of-depth reward.
  plasmaSalvageChance: 0.3,
  plasmaSalvageMin: 2,
  plasmaSalvageMax: 5,
} as const;

/** §4 Tier-1 base stats by weapon type (defaults — §7-flag). */
export const WEAPON_BASE_STATS: Record<WeaponType, WeaponStats> = {
  frontline: { power: 12, precision: 4, guard: 20, logistics: 6 },
  assault: { power: 16, precision: 10, guard: 8, logistics: 10 },
  precision: { power: 20, precision: 18, guard: 4, logistics: 8 },
  siege: { power: 30, precision: 6, guard: 2, logistics: 4 },
  engine: { power: 8, precision: 6, guard: 16, logistics: 18 },
};

/** §6 costs & build/upgrade times by tier (same for every family; defaults). */
export const ARMORY_TIER_COSTS: Record<WeaponTier, WeaponCost & { timeMs: number }> = {
  1: { supplies: 40, embers: 20, fuel: 6, plasma: 0, timeMs: 45 * 60_000 },
  2: { supplies: 120, embers: 60, fuel: 18, plasma: 3, timeMs: 3 * 60 * 60_000 },
  3: { supplies: 320, embers: 160, fuel: 45, plasma: 12, timeMs: 12 * 60 * 60_000 },
  4: { supplies: 900, embers: 420, fuel: 120, plasma: 30, timeMs: 2 * 24 * 60 * 60_000 },
};

/** §4 tier-line languages per race (T1→T4): model designation reads
 *  `FamilyName — <TierLanguage> Mk <I|II|III|IV>`. */
export const TIER_LANGUAGES: Record<RaceId, [string, string, string, string]> = {
  watchers: ["Primer", "Regulated", "Catechism", "Apocrypha"],
  grays: ["Index", "Catalog", "Folio", "Archive"],
  nephilim: ["Stone", "Column", "Mountain", "Firmament"],
  draconians: ["Coin", "Conspiracy", "Debt", "Ownership"],
  anunnaki: ["Plan", "Foundation", "Work", "Testament"],
  ashtar: ["Candle", "Lantern", "Beacon", "Dawn"],
};

export const MK_ROMAN: Record<WeaponTier, string> = { 1: "I", 2: "II", 3: "III", 4: "IV" };

/** §5 race catalogs — keyed by raceId, ALL SIX filled from
 *  design/weapons-catalogs-all-races.md (data appendix). Every race shares the
 *  same five war roles — the same souls, different names. The beta world is
 *  Watchers-locked; the other worlds activate via world-config race lock with
 *  zero engine changes (family ids stay the 5 roles). */
export const ARMORY_CATALOG: Record<RaceId, WeaponFamily[]> = {
  watchers: [
    {
      id: "frontline",
      name: "The Unwritten Blade",
      identity: "Forged from a lesson never meant to be taught; it cuts what the Chorus believes about itself.",
      icon: "⚔️",
      role: "Frontline · hold the line",
    },
    {
      id: "assault",
      name: "The Attendance",
      identity: "Every bolt is a syllabus; the target attends whether it likes it or not.",
      icon: "🔫",
      role: "Assault · march offense",
    },
    {
      id: "precision",
      name: "Revelation Lens",
      identity: "Shows the flaw; the flaw does the rest.",
      icon: "🎯",
      role: "Precision · zone denial",
    },
    {
      id: "siege",
      name: "The Last Bell",
      identity: "When the bell rings, the lesson ends. Loudly.",
      icon: "💥",
      role: "Siege · bombardment",
    },
    {
      id: "engine",
      name: "Chalk-Mark Warden",
      identity: "Draws the line the colony says is there; enemies find the line real.",
      icon: "🛡️",
      role: "Engine · escorts & shields",
    },
  ],
  grays: [
    {
      id: "frontline",
      name: "The Foyer",
      identity: "The quiet room between the enemy and the archive: it does not stop you, it catalogs you, and nothing returns the way it entered.",
      icon: "⚔️",
      role: "Frontline · hold the line",
    },
    {
      id: "assault",
      name: "Catalogue-9 Pattern",
      identity: "A carbine that cross-references you: the bolt has already read the target, and where the file disagrees, the target ceases to be in the record.",
      icon: "🔫",
      role: "Assault · march offense",
    },
    {
      id: "precision",
      name: "The Interviewer",
      identity: "Obtains the exact answer at range; the question was settled before the shot — the shot is only the citation.",
      icon: "🎯",
      role: "Precision · zone denial",
    },
    {
      id: "siege",
      name: "Archive Purge",
      identity: "Burns the site flat and files the remains; the Grays keep the catalog, and the catalog is the only part that survives.",
      icon: "💥",
      role: "Siege · bombardment",
    },
    {
      id: "engine",
      name: "The Circulation",
      identity: "A frame that goes everywhere and remembers everything; the supply lanes are its memory, the owl riding it was never assigned, and no one has filed a complaint.",
      icon: "🛡️",
      role: "Engine · escorts & shields",
    },
  ],
  nephilim: [
    {
      id: "frontline",
      name: "Last-Standing",
      identity: "A great-sword that is definitionally still standing: it has never once been the thing that fell, and it intends to keep the record.",
      icon: "⚔️",
      role: "Frontline · hold the line",
    },
    {
      id: "assault",
      name: "Stonehold Launcher",
      identity: "Slow, absolute; the bolt does not chase the Chorus, it files a claim on the space the Chorus is going to need.",
      icon: "🔫",
      role: "Assault · march offense",
    },
    {
      id: "precision",
      name: "The Slow Drop",
      identity: "A rail shot with the authority of geology: it does not miss so much as it happens — the ground decides where it lands.",
      icon: "🎯",
      role: "Precision · zone denial",
    },
    {
      id: "siege",
      name: "Mountain-Answer",
      identity: "A trebuchet that throws geography back at whatever forgot the mountains are still here. The Chorus broke the mountains before you were born; the mountains answered.",
      icon: "💥",
      role: "Siege · bombardment",
    },
    {
      id: "engine",
      name: "The Keel",
      identity: "An armored ram-walker; the road itself. Where the Keel has crossed, the supply line is not a route — it is a done thing, and done things do not come undone.",
      icon: "🛡️",
      role: "Engine · escorts & shields",
    },
  ],
  draconians: [
    {
      id: "frontline",
      name: "Quiet Ledger",
      identity: "A concealed blade that writes final entries; if you can see it, you are already in the books.",
      icon: "⚔️",
      role: "Frontline · hold the line",
    },
    {
      id: "assault",
      name: "The Rent Collector",
      identity: "Silenced plasma; interest compounds. The second bolt is never the point — the debt is, and the debt arrives regardless of witnesses.",
      icon: "🔫",
      role: "Assault · march offense",
    },
    {
      id: "precision",
      name: "No Witness",
      identity: "The shot nobody saw, filed in a record that disproves it; the Warrens are not shy about their work, merely extremely picky about the paperwork.",
      icon: "🎯",
      role: "Precision · zone denial",
    },
    {
      id: "siege",
      name: "The Accountant",
      identity: "Indirect fire that balances the books from three maps away; the invoice arrives before the smoke, and it is always itemized.",
      icon: "💥",
      role: "Siege · bombardment",
    },
    {
      id: "engine",
      name: "The Warren-Rig",
      identity: "A tunnel-drill frame; arrives from underneath. The supply lane is not on your map — it is under it, and the map was never the point.",
      icon: "🛡️",
      role: "Engine · escorts & shields",
    },
  ],
  anunnaki: [
    {
      id: "frontline",
      name: "Pylon-Gate",
      identity: "A halberd that is also a load-bearing structure: it does not merely hold the line, it is the reason the line stands.",
      icon: "⚔️",
      role: "Frontline · hold the line",
    },
    {
      id: "assault",
      name: "Founder's Beam",
      identity: "The straight line civilization was built along, refinished through whatever is in the way; the old world was ruled with rulers, and the ruler wins.",
      icon: "🔫",
      role: "Assault · march offense",
    },
    {
      id: "precision",
      name: "The Architect's Eye",
      identity: "Sees the load-bearing flaw at any distance; the shot is only the inspection, and the inspection, for a structure, is final.",
      icon: "🎯",
      role: "Precision · zone denial",
    },
    {
      id: "siege",
      name: "Cathedral-Fall",
      identity: "A plasma trebuchet that topples what they built, and grieves later; the grief is honest, the toppling is structural, and the Chorus finds the combination deeply unsettling.",
      icon: "💥",
      role: "Siege · bombardment",
    },
    {
      id: "engine",
      name: "The Ziggurat-Walker",
      identity: "A mega-frame that literally outgrows the battlefield; by the time the column arrives, the walker is taller than the war it was sent to win.",
      icon: "🛡️",
      role: "Engine · escorts & shields",
    },
  ],
  ashtar: [
    {
      id: "frontline",
      name: "Unbent Warden",
      identity: "The holder's arm, made into a weapon: it has never once bent, and it is not about to start for the Chorus.",
      icon: "⚔️",
      role: "Frontline · hold the line",
    },
    {
      id: "assault",
      name: "Lantern-Carbine",
      identity: "Bolts that also cleanse taint; every shot is a small lantern, and the dark finds it hard to keep a grip on anything that is lit.",
      icon: "🔫",
      role: "Assault · march offense",
    },
    {
      id: "precision",
      name: "The Bright Consensus",
      identity: "One clean shot the whole council agrees on; the Wardens do not argue their way to violence often, but when they do, the agreement is unanimous and the shot is single.",
      icon: "🎯",
      role: "Precision · zone denial",
    },
    {
      id: "siege",
      name: "The Last Light",
      identity: "A dawn-cannon that defends rather than destroys: it does not end what it strikes — it ends the dark in the area, which is, for the dark, worse.",
      icon: "💥",
      role: "Siege · bombardment",
    },
    {
      id: "engine",
      name: "Ward-Rig",
      identity: "An aegis frame; the taint slides off like weather off glass, and the convoy beneath it walks the Chorus's hunting-ground as if it were a well-lit street.",
      icon: "🛡️",
      role: "Engine · escorts & shields",
    },
  ],
};

/** The families a race can build (empty before that race's catalog ships). */
export function raceFamilies(raceId: RaceId): WeaponFamily[] {
  return ARMORY_CATALOG[raceId] ?? [];
}

/** Family lookup by role id (or undefined — e.g. another race whose rows are
 *  still schema-only, or an unknown id). */
export function familyFor(raceId: RaceId, familyId: string): WeaponFamily | undefined {
  return raceFamilies(raceId).find((f) => f.id === familyId);
}

// ------- stats & cost math (pure; used by engine + UI + tests) -------

/** A weapon family's stats at a tier — base × multiplier, rounded per stat.
 *  T1 is the base; T2/T3/T4 = ×1.5 / ×2.2 / ×3.2 (rounded, so every stat is
 *  STRICTLY increasing across tiers). */
export function weaponStats(type: WeaponType, tier: WeaponTier): WeaponStats {
  const base = WEAPON_BASE_STATS[type];
  const mult = ARMORY_CONFIG.tierMult[tier - 1];
  const round = (v: number) => Math.round(v * mult);
  return { power: round(base.power), precision: round(base.precision), guard: round(base.guard), logistics: round(base.logistics) };
}

/** Cost/time of building a family AT this tier (T1 build; T2–4 upgrade). */
export function weaponCost(tier: WeaponTier): WeaponCost {
  const c = ARMORY_TIER_COSTS[tier];
  return { supplies: c.supplies, embers: c.embers, fuel: c.fuel, plasma: c.plasma };
}

export function weaponTimeMs(tier: WeaponTier): number {
  return ARMORY_TIER_COSTS[tier].timeMs;
}

/** §4 model designation: `FamilyName — <TierLanguage> Mk <I|II|III|IV>`. */
export function modelName(raceId: RaceId, family: WeaponFamily, tier: WeaponTier): string {
  const lang = (TIER_LANGUAGES[raceId] ?? TIER_LANGUAGES.watchers)[tier - 1];
  return `${family.name} — ${lang} Mk ${MK_ROMAN[tier]}`;
}

/** Human label for a stat key. */
export const STAT_LABELS: Record<keyof WeaponStats, { label: string; icon: string }> = {
  power: { label: "Power", icon: "💥" },
  precision: { label: "Precision", icon: "🎯" },
  guard: { label: "Guard", icon: "🛡️" },
  logistics: { label: "Logistics", icon: "🚚" },
};

/** The research tech id that unlocks a family's forge (engine/lab naming). */
export const ARMORY_FAMILY_TECH: Record<WeaponType, string> = {
  frontline: "armory_frontline",
  assault: "armory_assault",
  precision: "armory_precision",
  siege: "armory_siege",
  engine: "armory_engine",
};