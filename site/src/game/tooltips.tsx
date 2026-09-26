import type { ReactNode } from "react";

// Central registry of tooltip copy for the Deepspace Engine MVP.
// Every string is grounded in the REAL mechanics in engine.ts / types.ts /
// zones.ts — vocabulary (Embers, Chipsets, Supplies, The Cradle, The Shatterlands,
// The Chorus) matches the code exactly, and in-fiction framing is respected.

export interface TooltipBlock {
  what: string;
  does: string;
  how: string;
}

// Format a block as a compact "what / does / how" tooltip body with amber headers.
export function tip(b: TooltipBlock): ReactNode {
  const Line = ({
    h,
    c,
    color,
  }: {
    h?: string;
    c?: string;
    color?: string;
  }) =>
    c ? (
      <span className="block">
        {h && <span className={"me-1 font-semibold " + (color || "text-amber-400")}>{h}</span>}
        {c}
      </span>
    ) : null;

  return (
    <span className="block space-y-1">
      <Line h="What" c={b.what} color="text-amber-400" />
      <Line h="Does" c={b.does} color="text-amber-400" />
      <Line h="Get/Use" c={b.how} color="text-amber-400" />
    </span>
  );
}

export const RESOURCE_TIPS: Record<string, TooltipBlock> = {
  embers: {
    what: "Embers — common AI fragments salvaged throughout the Shatterlands.",
    does: "The bread-and-butter resource. Given to the Lab to study for insight, or spent to Deploy recovered AI and advance the colony.",
    how: "Looted from Expeditions into the Shatterlands (deeper ruins yield more). Study 2 in the Lab, or spend them on Deploy.",
  },
  chipsets: {
    what: "Chipsets — rare, complete, advanced AI sets.",
    does: "A leap forward. Studying a Chipset yields far more insight than Embers (~70 vs ~18).",
    how: "Found only in deep scientific sites — Quantum Research Facility, Super-Collider Ruins, Dark-Matter Observatory — as a chance result of expeditions.",
  },
  supplies: {
    what: "Supplies (📦) — the colony's stores: food, fuel, parts.",
    does: "Funds Expeditions into the Shatterlands, can be burned to Purify the Cradle, and forges radiation gear in the Workshop.",
    how: "Accrues over real time (boosted by Agriculture & Economy domains) and from scrapped salvage on expedition returns. Spent on expedition Cost, Purify, and Workshop crafting.",
  },
  hazmat: {
    what: "Hazmat suits (🧥) — radiation protection that lets a team EXPLORE deep zones.",
    does: "Suited teams can enter deep radiation zones and reconnoiter. Without enough suits the run risks heavy attrition.",
    how: "Forged in the Workshop (8 📦 each). Also occasionally salvaged from mild (rad 20–40) zones. Needed: 1 + floor((rad-35)/20) per scientist.",
  },
  shots: {
    what: "Radiation shots (💉) — support injectors that buffer attrition in the deep.",
    does: "Alongside suits they raise clean-return odds; under-supplied teams suffer projected loss.",
    how: "Forged in the Workshop (6 📦 each). Also occasionally salvaged from mild (rad 20–40) zones. Needed: 1 + floor((rad-35)/20) per scientist.",
  },
  alloy: {
    what: "Alloy-armed diggers (⚙️) — forged machines that can EXTRACT loot from the deep.",
    does: "Suits let you explore, but only alloy-armed digging machines bring anything back. The alloy is the deep-zone key.",
    how: "Forged in the Workshop (20 📦) from 5 unique race materials — your own territory + 4 other races'. Raid their home regions to gather them. Needed: 1 + floor((rad-35)/25) per run.",
  },
  mats: {
    what: "Territory materials — each race's home region yields a unique supply.",
    does: "The radiation-resistant alloy needs your OWN race's material + 4 OTHER races' = 5 distinct materials. No race can forge it alone.",
    how: "Run expeditions to each race's home region (Observatories, Boneyard, Warrens, Forge Valleys, Lantern Reach, Academies) to loot their material. Consumed 1-of-each when you forge the alloy.",
  },
  medkit: {
    what: "Medical kit (🩺) — bandages and basic shots against sickness.",
    does: "A colony must hold a medical kit to field ANY expedition — the first thing a team needs before stepping out.",
    how: "Forged in the Workshop (5 📦). Kept in the colony's stores; a held kit lets your teams step out. Also part of the protection that absorbs surprise encounters.",
  },
  mechkit: {
    what: "Mechanics kit (🔧) — patch-up and basic vehicle repair.",
    does: "One of the three stepping-out kits. Without it no team can field an expedition; it also keeps light vehicles running out in the field.",
    how: "Forged in the Workshop (6 📦). Held kit; also counts toward the protection that absorbs surprise encounters.",
  },
  armorkit: {
    what: "Armor/armature kit (🛡️) — armature for crew and light vehicles.",
    does: "One of the three stepping-out kits. Armor is the biggest single guard against surprise encounters — it protects the team when things go sideways.",
    how: "Forged in the Workshop (7 📦). Held kit; contributes heavily to protection against the unforeseeable.",
  },
  skmech: {
    what: "Skilled mechanics (👷) — a crew that repairs heavier machinery.",
    does: "The farther, higher-risk sites use machinery that outranks basic mechanics. Bring skilled mechanics or the heavier sites stay out of reach.",
    how: "Forged in the Workshop (14 📦). Required by higher-risk sites; also adds protection against surprise encounters.",
  },
  gas: {
    what: "Vehicle fuel (⛽) — for the long-haul convoy.",
    does: "Burned on the way out and back. Some sites are simply too far to reach without enough fuel in the depot.",
    how: "Forged in the Workshop (4 📦). Consumed each expedition you launch. Refuel before the long runs.",
  },
  battery: {
    what: "Battery packs (🔋) — quiet electric running at the site.",
    does: "Discharged running the engines silent while the team works. Necessary at sites too close to the Chorus to risk loud operation.",
    how: "Forged in the Workshop (5 📦). Consumed each expedition you launch. Recharge before you go.",
  },
  insight: {
    what: "Insight — the research currency distilled by scientists in the Lab.",
    does: "Funds Deploying recovered AI to advance the colony's five domains.",
    how: "Earned by studying Embers and Chipsets in the Lab over real time.",
  },
  codices: {
    what: "Codices (📜) — human knowledge: pre-war texts, journals, records, lost science.",
    does: "Fuel the RESEARCH TREE — a separate, scarce track from AI fragments. Embers you salvage, chipsets you raid for, Codices you EARN.",
    how: "Earned through meaningful outcomes — recovering a surviving archive on a clean return, protecting a site, deeds & awards of merit. Never looted with salvage.",
  },
};

export const DOMAIN_TIPS: Record<string, TooltipBlock> = {
  weaponry: {
    what: "Weaponry ⚔️ — arms and siege-works.",
    does: "Shields the colony: each level reduces expedition danger — cutting corruption & Chorus gains from risky salvage.",
    how: "Advance by Deploying recovered AI in the Lab (Embers + insight).",
  },
  agriculture: {
    what: "Agriculture 🌾 — farms and forges of food.",
    does: "Each level earns +3 supplies per minute passively, so the Cradle grows while you're away.",
    how: "Advance by Deploying recovered AI in the Lab.",
  },
  economy: {
    what: "Economy 💰 — trade and currency.",
    does: "Each level boosts ember yields from expeditions by +6% and adds +2 supplies/min.",
    how: "Advance by Deploying recovered AI in the Lab.",
  },
  industry: {
    what: "Industry ⚙️ — refineries and workshops.",
    does: "Each level makes expeditions ~6% faster and cheaper to fund (cuts Cost).",
    how: "Advance by Deploying recovered AI in the Lab.",
  },
  logistics: {
    what: "Logistics 🚚 — routes, depots, signals.",
    does: "Each level adds a field slot (+1 concurrent expedition team); every 2 levels raises scientist capacity by 1.",
    how: "Advance by Deploying recovered AI in the Lab.",
  },
};

export const METER_TIPS: Record<string, TooltipBlock> = {
  corruption: {
    what: "Corruption (☣️ taint) — the stain left by salvaging AI.",
    does: "Heavy taint dulls salvage: at high corruption, expedition ember yields are sharply reduced. Asart colonies and Weaponry resist it.",
    how: "Raised by risky expeditions. Lower it by Purify-ing (burn supplies in the Colony tab) or slowly over time. Weaponry levels reduce how much expeditions add.",
  },
  chorus: {
    what: "Chorus attention (🔺) — how close the hostile AI hives are circling.",
    does: "High attention means the Chorus stirs at your disturbances — the risk you take for deep, rich salvage. Asart colonies build it slower.",
    how: "Raised by deep/risky expeditions (special scientific sites draw the hive hardest). Falls slowly over time. Weaponry levels reduce how much expeditions add.",
  },
};

export const EXPEDITION_TIPS: Record<string, TooltipBlock> = {
  risk: {
    what: "Risk — this destination's base danger (0–100).",
    does: "Higher risk means heavier corruption & Chorus gains from the run — and usually richer salvage.",
    how: "Fixed per destination; outer ruins are safe, deep scientific sites are the most dangerous. Weaponry levels reduce the danger actually applied.",
  },
  embers: {
    what: "~Embers — the expected yield of this run.",
    does: "Rough embers you can expect back, before variance, taint, and race/domain bonuses.",
    how: "Scales with destination, scientists assigned, Economy domain, and race (e.g. Nephilim loot more).",
  },
  chipset: {
    what: "Chipset chance — the odds this run returns a rare Chipset.",
    does: "Only deep scientific sites carry a meaningful chipset chance (up to ~45% at the Dark-Matter Observatory).",
    how: "Rolled on expedition return. Draconians & Grays have a higher chance.",
  },
  cost: {
    what: "Cost (📦) — supplies needed to fund this expedition.",
    does: "Deducted from your Supplies when you Commit. Based on destination risk; cheaper with Industry.",
    how: "Spend Supplies. Industry levels make it cheaper.",
  },
  radiation: {
    what: "Radiation (☢️) — this destination's radiation level (0–100).",
    does: "Deep zones (35+) need hazmat/shots/alloy gear. Under-geared runs trigger the pre-launch risk pop-up and can lose scientists and loot.",
    how: "Mild zones only warn inline; deep zones show a risk pop-up before launch showing clean-return %, has-vs-need gear, and projected loss. You always choose to go.",
  },
  alloyShort: {
    what: "The alloy is the extraction key.",
    does: "Suits let you EXPLORE deep zones, but without alloy-armed diggers you cannot bring much back — find isn't retrieve.",
    how: "Forge the alloy in the Workshop: your own race material + 4 other races' = 5 unique materials. Raid their home regions.",
  },
};

export const ARMORY_TIPS: Record<string, TooltipBlock> = {
  plasma: {
    what: "Plasma (🔮) — condensed high-energy matter, the lifeblood of high-tier weapons.",
    does: "Tier-2+ weapon builds eat plasma (3 / 12 / 30). Rare and never cheap.",
    how: "Refine 25 Embers → 1 plasma in the Lab (research Plasma Refinement first), or salvage 2–5 from deep chipset sites when a raid bites deep.",
  },
  plasmaRefine: {
    what: "Plasma Refinement — the lab condenses embers into plasma.",
    does: "Exchanges exactly 25 🧯 Embers for 1 🔮 plasma. Deterministic, earn-only.",
    how: "Research Plasma Refinement in the Lab first. The forges will not drink cheap.",
  },
};

export const LAB_TIPS: Record<string, TooltipBlock> = {
  scientists: {
    what: "Scientists — your colony's researchers and field specialists.",
    does: "Study fragments in the Lab, and are assigned to expeditions to raise yields. You can study as many fragments at once as you have scientists.",
    how: "Start with 2. Deploy Logistics AI to raise capacity (+1 per 2 levels). Assign to studies (Lab) and expeditions (Expeditions tab).",
  },
  fieldSlots: {
    what: "Field slots — how many expedition teams you can keep in the Shatterlands at once.",
    does: "You can only have this many expeditions running concurrently.",
    how: "Start with 1. Deploy Logistics AI to add +1 slot per level.",
  },
  studyEmbers: {
    what: "Study Embers — set scientists to learn from 2 Embers.",
    does: "Yields ~18 insight over real time, advancing your research toward Deploying AI.",
    how: "Consumes 2 Embers and one free scientist. Begin Study in the Lab.",
  },
  studyChipset: {
    what: "Study a Chipset — learn from a rare, complete AI set.",
    does: "Yields ~70 insight over real time — a real leap forward.",
    how: "Consumes 1 Chipset and one free scientist. Chipsets come from deep scientific sites.",
  },
  deploy: {
    what: "Deploy recovered AI — install studied intelligence into the colony.",
    does: "Advances that domain's level (Weaponry / Agriculture / Economy / Industry / Logistics), unlocking its passive bonuses.",
    how: "Spend Embers + insight (all earned from expeditions and the Lab). Higher levels cost more.",
  },
  deployButton: {
    what: "Deploy — spend Embers + insight to level up this domain.",
    does: "Raises the chosen domain by one level, applying its passive bonus to your colony.",
    how: "Requires the listed Embers and insight. Earn both via Expeditions and the Lab.",
  },
  purify: {
    what: "Purify the Cradle — a cleansing rite.",
    does: "Removes 5 corruption per 10 supplies spent, keeping your salvage sharp.",
    how: "Click it in the Colony tab when your corruption (☣️ taint) climbs too high. Each click spends 10 Supplies.",
  },
  research: {
    what: "The Research Tree — human knowledge made into technology.",
    does: "5 domains × 4 named techs. Each tech costs Codices + real time and unlocks a concrete, visible effect (better supplies, cheaper craft, longer range, fewer surprises…).",
    how: "Runs on CODICES (earned, not looted), NOT embers/chipsets. Appoint a Leader to each project — their specialty speeds it and enables surprise breakthroughs.",
  },
  leaders: {
    what: "Leaders — your named Councillors, the human heart of research.",
    does: "Each has a SPECIALTY that boosts one domain line (economist→economy, horticulturist→agriculture…). Appoint a free Leader to a research project; only a Leader can research.",
    how: "Earned & rescued through deeds/recovery — never purchased. Limited slots (3 start, +1 from the Fleet Yards tech). A specialty-matched Leader works faster and can trigger a breakthrough at completion.",
  },
  leaderXp: {
    what: "Leader XP — earned only from real events, never bought.",
    does: "Completing a research project grants +10 XP (+25 more on a breakthrough); surviving a surprise encounter grants +12 XP; deep Shatterlands runs grant +8 XP. Soft-capped at 40 XP/day across the colony, so spamming research can't farm it.",
    how: "Levels follow a square-root curve (L2=200, L3=450, L4=800…). Every level grants exactly 1 attribute point to allocate. Reaching Level 3 opens the one-time specialization choice.",
  },
  leaderLevel: {
    what: "Level — derived from the Leader's total XP (square-root curve).",
    does: "Each level grants exactly 1 unspent attribute point; allocating it into research/economy/combat/engineering raises that attribute's numeric effect. Level 3 unlocks the one-time specialization choice.",
    how: "Earn XP from research, breakthroughs, surviving surprises, and deep runs. The soft daily cap (40 XP/day colony-wide) keeps grinding honest.",
  },
  leaderAttr: {
    what: "Attributes — a Leader's four practiced crafts.",
    does: "Research speeds their projects (4% per point), economy boosts parts of the colony's yield, combat sharpens survival, engineering eases workshop work.",
    how: "Base values come with the Leader; every level-up grants 1 point to allocate into whatever YOU want. No two Leaders need to grow alike.",
  },
  specialization: {
    what: "Specialization — a ONE-TIME choice at Level 3.",
    does: "Scholar (+15% research speed, +5% breakthrough chance) · Marshal (+10% combat effectiveness, −20% surprise-survival damage) · Quartermaster (+10% economy effectiveness, −10% crafting cost). Picking one locks the other two FOREVER for that Leader.",
    how: "Earned entirely through play — XP, then the choice. Nothing about this path can be bought.",
  },
};

export const OWNER_TIPS: Record<string, TooltipBlock> = {
  shared: {
    what: "No race's home — neutral ruined ground near the colony rim.",
    does: "Safe and quick, but thin: good for steady Embers, no chipsets.",
    how: "Open to any colony from the start.",
  },
  special: {
    what: "Deep scientific site — the only ruins where complete Chipsets live.",
    does: "Very dangerous and rich: high yarn ember yields and the best chipset chances, but heavy corruption & Chorus risk.",
    how: "Reach it by venturing deep into the Shatterlands. Quantum, Collider, and Dark-Matter sites.",
  },
};

export const HELP_COPY = {
  coreLoop:
    "Expeditions into the Shatterlands bring back Embers & rare Chipsets. Scientists study them in the Lab to distill Insight, and you Deploy the recovered AI to advance five domains — Weaponry, Agriculture, Economy, Industry, Logistics. Growth funds riskier, deeper expeditions. The world persists in real time, even while logged out.",
};
