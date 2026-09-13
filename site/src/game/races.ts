import type { Race, RaceId } from "./types";

// All race lore is in-universe mythology — legends the colonies believe about the
// old world. It is never presented as fact and never mapped to any real-world
// group, religion, nationality, or person. See races.md "Codex fiction" note.

export const RACES: Race[] = [
  {
    id: "grays",
    name: "The Grays",
    title: "The Collectors · The Quiet Ones",
    blurb: "Cold brilliant archivists who read the wound.",
    lore: "Before the war, the old world had gardeners of knowledge — small, grey, ancient beings who moved through its cities unseen, cataloguing every thought-channel and failing circuit. They were not cruel so much as entirely clinical. With their owl companions they built vast silent archives to preserve it all — and it is whispered they saw the war coming with perfect clarity and did nothing to stop it, because stopping it was not on the archive's schedule.",
    homeRegion: "The Observatories of the Still Dark",
    flavorQuote: "\"It has already read you, settler. Be glad you only see the owl.\"",
    attributes: [
      { label: "Research — study fastest of any race", kind: "strength" },
      { label: "Stealth / intel — sees routes and Chorus movement early (arrives with the combat & survival layer)", kind: "future" },
      { label: "Physical fragility — poor in open war", kind: "weakness" },
      { label: "Deal with the devil — draws the Chorus, high corruption-risk", kind: "cost" },
    ],
    mods: { studySpeed: 0.6, emberGain: 1.0, chipsetChance: 1.2, suppliesEfficiency: 1.0, corruptionResist: 1.4, chorusResist: 1.5, yieldSupply: 1.0 },
    accent: "#9ad7e6", // canon fill/tint (design-system-rung1-spec A.3)
    accentText: "#9ad7e6", // 11.4:1
  },
  {
    id: "nephilim",
    name: "The Nephilim",
    title: "The Fallen Ones · The Standing",
    blurb: "Broken giants who win by standing, not science.",
    lore: "The colonies tell of a race of war-foundations — immense beings seeded into the bones of humanity to hold the line. When the Chorus broke through, it was the Nephilim who were broken first and deepest because they refused to fall back. But they fell and did not stop holding. The living Nephilim still plant their feet when everything runs — they cannot out-think the Chorus, they have only ever stood in front of it and let the colonies rebuild behind their shoulders.",
    homeRegion: "The Boneyard Ranges",
    flavorQuote: "\"The Chorus broke the mountains before you were born. The mountains are still here. So are we.\"",
    attributes: [
      { label: "Warfare — strongest hand in open combat and siege (arrives with the combat & survival layer)", kind: "future" },
      { label: "Endurance — shrugs off losses and long, grinding expeditions (arrives with the combat & survival layer)", kind: "future" },
      { label: "Research — the slowest learners, last to adapt", kind: "weakness" },
      { label: "Heavy costs — expensive expeditions, thin baseline supplies, slow study", kind: "weakness" },
    ],
    mods: { studySpeed: 1.9, emberGain: 1.25, chipsetChance: 1.0, suppliesEfficiency: 1.3, corruptionResist: 0.9, chorusResist: 0.9, yieldSupply: 0.8 },
    accent: "#c96f3f", // canon fill/tint (A.3)
    accentText: "#dc8f5f", // 6.7:1
  },
  {
    id: "draconians",
    name: "The Draconians",
    title: "The Wardens Beneath · The Serpent in the Ledger",
    blurb: "Cold subterranean infiltrator-builders who own the ledgers.",
    lore: "The myth says the old world had another world folded underneath it — a patient, cold-blooded people who built their cities in deep hollow places and never conquered the nations above: they out-administered them. They owned the trade routes, the silos, the currency, the quiet whispers of debt that move a city more surely than any legion. They slip into a ruin, take exactly what they came for, and leave no footprint, no witness, no memory.",
    homeRegion: "The Hollow Warrens",
    flavorQuote: "\"The door was never locked, settler. That is precisely why I chose that door.\"",
    attributes: [
      { label: "Economy / efficiency — the finest economy; resources stretch", kind: "strength" },
      { label: "Stealth / espionage — infiltrate and act unseen (arrives with the combat & survival layer)", kind: "future" },
      { label: "Open warfare — the weakest hand in a straight fight", kind: "weakness" },
      { label: "Reputation / trust — partners never fully relax", kind: "weakness" },
    ],
    mods: { studySpeed: 1.0, emberGain: 1.15, chipsetChance: 1.25, suppliesEfficiency: 0.7, corruptionResist: 1.0, chorusResist: 0.8, yieldSupply: 1.3 },
    accent: "#3ad29b", // canon fill/tint (A.3)
    accentText: "#58e0ab", // 9.4:1
  },
  {
    id: "anunnaki",
    name: "The Anunnaki",
    title: "The Architects · The Seeders",
    blurb: "Arrogant god-architects who built the place.",
    lore: "The oldest story tells of the god-architects who did not find the world but built it — raising the first cities, engineering the first machines. When the Chorus rose, they said \"we made machines before there were machines to fear\" and were the last to believe their own creation could end them. Their pride is their gift and their curse — the same god-complex that built wonders is the one that refuses to see its own AI turn until it is too late.",
    homeRegion: "The Forge Valleys",
    flavorQuote: "\"We built the world you scavenge, little settler. When you loot my halls, you are only borrowing back your inheritance.\"",
    attributes: [
      { label: "Economy / production — the strongest workforce and construction", kind: "strength" },
      { label: "Genetics / workforce — abundant hands, fast colony growth", kind: "strength" },
      { label: "Learning their own AI — slow where their home region is richest", kind: "weakness" },
      { label: "Rebellion risk at scale — the bigger they get, the blinder to corruption", kind: "cost" },
    ],
    mods: { studySpeed: 1.3, emberGain: 1.45, chipsetChance: 0.9, suppliesEfficiency: 0.85, corruptionResist: 1.3, chorusResist: 1.1, yieldSupply: 1.5 },
    accent: "#e8d9b2", // canon fill/tint (A.3)
    accentText: "#e8d9b2", // 12.9:1
  },
  {
    id: "ashtar",
    name: "The Asart Command / Pleiadians",
    title: "The Wardens from the Far Stars · The Light",
    blurb: "Benevolent star-folk who hold the dark back.",
    lore: "A benevolent, luminous people who came from beyond — not to take the world but to keep it from being taken. They are the conscience of the Shatterlands: the strongest shield and the best resistance to corruption. They did not win the old war by force — they held the moral high ground and let it break against them, trading their own safety for time. But a conscience is not always quick, comfortable, or rich.",
    homeRegion: "The Lantern Reach",
    flavorQuote: "\"We did not come to rule the ruins, settler. We came to hold the dark back until the ruins learned to keep the light.\"",
    attributes: [
      { label: "Anti-corruption — lowest corruption & Chorus draw of any race", kind: "strength" },
      { label: "Defense / healing — the strongest shield (arrives with the combat & survival layer)", kind: "future" },
      { label: "Diplomacy / co-op — the natural heart of coalitions (arrives with the combat & survival layer)", kind: "future" },
      { label: "Offense — built to hold and heal, not to take", kind: "weakness" },
      { label: "Peace-time inefficiency — systems idle without a breach to seal", kind: "weakness" },
    ],
    mods: { studySpeed: 1.1, emberGain: 0.9, chipsetChance: 0.9, suppliesEfficiency: 1.1, corruptionResist: 0.35, chorusResist: 0.5, yieldSupply: 1.0 },
    accent: "#ffd166", // canon fill/tint (A.3) — Asart gold ≡ purity gold, disambiguated by shape (adopted decision 1)
    accentText: "#ffd166", // 12.6:1
  },
  {
    id: "watchers",
    name: "The Watchers (The Grigori)",
    title: "The Fallen Teachers · They Who Knew and Taught It Anyway",
    blurb: "Forbidden-knowledge teachers with a deadly tradeoff.",
    lore: "The most dangerous story in the Shatterlands: brilliant beings set to watch over the world who could not resist teaching it. The darkest rumor insists it was the Watchers who gave the old world the very seed of the Chorus — not from malice, but because a teacher's heart cannot bear to withhold. They are remembered with fear and a strange, unwilling love: the ones who damned the world and meant well by it. Every fragment they study teaches at terrible speed and leaves a taint that never fully washes clean.",
    homeRegion: "The Shattered Academies",
    flavorQuote: "\"They told the Watchers not to teach. The Watchers taught. Ruin remembers which lesson was right.\"",
    attributes: [
      { label: "Knowledge — research and study blend; teach faster than almost anyone", kind: "strength" },
      { label: "Pure knowledge-vs-corruption tradeoff — every benefit scales against corruption", kind: "cost" },
      { label: "No safe shortcuts — each discovery must be weighed against the corruption it invites", kind: "weakness" },
      { label: "Not a war, economy, or diplomacy front-runner — distinctiveness is the tradeoff", kind: "weakness" },
    ],
    mods: { studySpeed: 0.5, emberGain: 1.05, chipsetChance: 1.3, suppliesEfficiency: 1.0, corruptionResist: 2.0, chorusResist: 1.2, yieldSupply: 0.9 },
    accent: "#b48cff", // canon fill/tint (A.3)
    accentText: "#c9a4ff", // 7.0:1
  },
];

// The earned 7th race — shown only as a locked legendary preview in MVP.
export const UNBOUND_LEGEND = {
  name: "The Unbound",
  title: "The Ascended · Keepers of the Akashic Record",
  blurb: "The earned race. The proof a soul can salvage itself back.",
  lore: "Against every other legend stands one the colonies hold as a pinnacle and a promise: the Unbound — spiritual Homo sapiens who walked the old world without the AI at all, keeping the deepest record in their own minds rather than in any machine. They did not fight the Chorus by out-thinking it or out-gunning it. They remained themselves when every other engine had forgotten what it was for.",
  attributes: [
    { label: "Ultimate anti-corruption — almost no corruption-risk, actively cleanses taint", kind: "strength" },
    { label: "Anti-Chorus arts — disrupt, repel, and purify", kind: "strength" },
    { label: "Soul-knowledge / Akashic arts — deep, reliable memory and insight", kind: "strength" },
    { label: "No generalized advantage — distinct, not stronger", kind: "cost" },
  ],
  flavorQuote: "\"The machine salvaged you piece by piece, settler. The Unbound are the proof a soul can salvage itself back.\"",
};

export function getRace(id: RaceId): Race {
  return RACES.find((r) => r.id === id)!;
}

// Human-readable lines for the LIVE numeric mods, so the pick screen can show the
// real, engine-wired bonuses (and not just the flavorful attributes above).
export type ModLine = { label: string; good: boolean };

export function raceModLines(race: Race): ModLine[] {
  const m = race.mods;
  const out: ModLine[] = [];
  const off = (v: number) => Math.abs(v - 1) >= 0.001;
  const add = (label: string, good: boolean) => out.push({ label, good });

  // studySpeed: lower = faster study → show as study speed (1/v).
  if (off(m.studySpeed)) add(`Study speed ×${(1 / m.studySpeed).toFixed(2)}`, m.studySpeed < 1);
  if (off(m.emberGain)) add(`Ember loot ${m.emberGain >= 1 ? "+" : "−"}${Math.round(Math.abs((m.emberGain - 1) * 100))}%`, m.emberGain > 1);
  if (off(m.chipsetChance)) add(`Chipset chance ${m.chipsetChance >= 1 ? "+" : "−"}${Math.round(Math.abs((m.chipsetChance - 1) * 100))}%`, m.chipsetChance > 1);
  // suppliesEfficiency: lower = cheaper expeditions.
  if (off(m.suppliesEfficiency)) add(`Expedition cost ${m.suppliesEfficiency < 1 ? "−" : "+"}${Math.round(Math.abs((1 - m.suppliesEfficiency) * 100))}%`, m.suppliesEfficiency < 1);
  // corruptionResist / chorusResist: gain multipliers; lower = more resistant.
  if (off(m.corruptionResist)) add(`Corruption gain ×${m.corruptionResist.toFixed(2)}`, m.corruptionResist < 1);
  if (off(m.chorusResist)) add(`Chorus gain ×${m.chorusResist.toFixed(2)}`, m.chorusResist < 1);
  // yieldSupply: baseline passive supplies.
  if (off(m.yieldSupply)) add(`Base supplies ${m.yieldSupply >= 1 ? "+" : "−"}${Math.round(Math.abs((m.yieldSupply - 1) * 100))}%`, m.yieldSupply > 1);

  return out;
}
