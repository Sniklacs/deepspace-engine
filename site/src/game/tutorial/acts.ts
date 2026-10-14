// TUTORIAL ACTS — the whole game, taught in the order a new player lives it
// (owner, Oct 14 2026: "a tutorial about everything"; standard: PURPOSE
// BEFORE MECHANICS — "If it can't be explained, people aren't going to play
// it").
//
// Every lesson below states its PURPOSE first — what the thing IS and what
// it's FOR — in plain words drawn from the game's own doctrine (design
// docs, the 24 maxims, the help copy, the tips corpus). Nothing here
// invents a purpose the game doesn't implement; where the built game is
// thinner than the designed one, the copy teaches the built truth.
//
// Honesty labels (framework ActLevel): the battle act is FULLY guided —
// every mechanic step waits for the player's real action on the scene.
// Founding/cradle/globe/modules/exploration/war are GUIDED: their spines
// are real actions (open the page, found the colony) with concept reads
// between. The Oracle act is SCRIPTED for now — its systems arrive by
// mailbox and daily list, with no observation seam yet.
import type { TutAct } from "./framework";

export const BATTLE_ACT: TutAct = {
  id: "battle",
  title: "Act — Your First Battle",
  purpose:
    "A battle is where everything you built gets spent. This act puts your hands on a real fight — a forgiving training battle on the live engine, against a half-strength garrison that cannot ruin you — and teaches you to command it: who your squads are, how they enter, how you move them, cover them, aim them, and bring them home.",
  level: "full",
  lessons: [
    {
      id: "vectors",
      title: "Meet your five squads",
      purpose:
        "Your army doesn't arrive as a blob. It comes in five squads — five buses — each with a job. Knowing the jobs is the whole of command; the rest is timing.",
      steps: [
        {
          id: "five-jobs",
          body: "MAIN is your fist — the heavy line that meets the enemy head-on. FLANK LEFT and FLANK RIGHT are your claws — fast squads that swing around the sides. REAR is your thunder — siege guns and their escorts, arriving behind your line. RESERVE is your ace — held back, embarked, until the moment you throw it in.",
          done: { kind: "read" },
        },
        {
          id: "touch-a-squad",
          body: "Every squad answers to your tap. Select one and its panel opens — strength, stance, orders.",
          doLabel: "Tap any one of your squads — a chip at the edge of the field, or a row in the Squads list.",
          done: { kind: "event", event: "squad" },
        },
      ],
    },
    {
      id: "tap-move",
      title: "Tap and move",
      purpose:
        "Orders in a live battle are not menus. You touch the squad, you touch the ground, it moves. If you learn one gesture in this game, learn this one.",
      steps: [
        {
          id: "the-gesture",
          body: "Tap a squad to select it. Then tap the ground where you want it. The order is judged the instant you give it — accepted, it moves; refused, the game tells you why, out loud, in the orders log. No silent failures, ever.",
          done: { kind: "read" },
        },
        {
          id: "move-main",
          body: "Send your MAIN squad forward — toward the enemy line, but not into its teeth. Halfway is a fine first order.",
          doLabel: "Tap MAIN, then tap the ground ahead of it.",
          done: { kind: "event", event: "order", orderKind: "move", vector: "MAIN" },
        },
      ],
    },
    {
      id: "entries",
      title: "Pull your troops in when YOU want",
      purpose:
        "This is the commander's first right: your staged troops enter when you say, where you say — not on a timer you can't see. Each squad has a door. Learn the doors.",
      steps: [
        {
          id: "the-doors",
          body: "The FLANKS swing wide around the enemy's sides. The RESERVE hot-drops — an on-call squad falls straight onto the spot you tap. The REAR comes in behind the enemy's lines in a combat drop — the deep knife — when its escort makes it legal. A staged squad with an accepted order enters NOW; its old arrival time is forgotten.",
          done: { kind: "read" },
        },
        {
          id: "swing-a-flank",
          body: "Feel a door open. Order a flank squad wide — around the side of the enemy line, not through it.",
          doLabel: "Tap FLANK LEFT or FLANK RIGHT, then tap ground out wide, beside the enemy.",
          done: { kind: "event", event: "order", orderKind: "move", vector: ["FLANK_LEFT", "FLANK_RIGHT"] },
        },
        {
          id: "hot-drop",
          body: "Your RESERVE is on call — marked 🪂. It doesn't march in. It falls, on your tap, where the fight needs it most.",
          doLabel: "Tap the RESERVE squad (🪂), then tap the spot on the field where you want it to land.",
          done: { kind: "event", event: "order", orderKind: "hotdrop" },
        },
        {
          id: "rear-drop",
          body: "The rear drop is the deep play: your REAR squad combat-drops behind the enemy line and opens a second front in their back. Siege never flanks and a rear entry wants its escort — if the judge refuses, it will say why, and the refusal is a lesson, not a wall.",
          doLabel: "Order your REAR squad to drop behind the enemy line.",
          done: { kind: "event", event: "order", orderKind: "jumpdrop" },
        },
      ],
    },
    {
      id: "cover",
      title: "Cover — nobody fights naked",
      purpose:
        "A squad out in the open dies honest and fast. Cover ties one squad to another: the covered squad repositions on its cover's shoulder and fights from its lee. It is how a thin line holds.",
      steps: [
        {
          id: "how-cover-works",
          body: "In the quick pick — the command card that opens when you select a squad — the Cover verb asks one question: who covers whom? Pick the squad that needs shelter, tap Cover…, then pick the squad that shelters it. A siege squad holds its ground and can't be a roamer; a squad still in staging can't cover anyone yet — the picker tells you, with the reason, instead of hiding them.",
          done: { kind: "read" },
        },
        {
          id: "give-cover",
          body: "Give somebody cover. Your flankers thank you in advance.",
          doLabel: "Select a squad, tap Cover… in its quick pick, then choose who shelters it.",
          done: { kind: "event", event: "cover" },
        },
      ],
    },
    {
      id: "targeting",
      title: "Pick them apart",
      purpose:
        "Armies aren't beaten in bulk; they're beaten in pieces. The Enemy Forces list names every enemy troop — each Warden, each Bulwark — and a tap makes that one troop your whole army's focus.",
      steps: [
        {
          id: "the-list",
          body: "Once your scout has seen the enemy, Enemy Forces lists them one by one: class, health, how far they stand from your nearest squad. Tap a row and that troop wears the amber crosshair — your engaged squads pour their fire into it, inside their normal reach. No magic range, just aimed hate. Tap it again to let go.",
          done: { kind: "read" },
        },
        {
          id: "focus-one",
          body: "Focus one of them. Pick something with teeth — a gun that's been hurting you — and watch it melt.",
          doLabel: "Open Enemy Forces and tap one enemy troop's row to focus it.",
          done: { kind: "event", event: "focus" },
        },
        {
          id: "the-hero-trap",
          body: "One warning, commander to commander: the enemy's leader stands pinned at the top of that list, crowned 👑, and every instinct says kill him first. DON'T. A hero's health is an ocean — while your whole army pours itself into him, his field shoots yours to pieces for free. Pick the teeth out first. The crown can wait its turn.",
          done: { kind: "read" },
        },
      ],
    },
    {
      id: "modes",
      title: "AUTO and MANUAL — and walking away",
      purpose:
        "Two ways to command. MANUAL is the helm: your orders, your timing. AUTO is the fallback: the plan fights on without you. The mode is always on the battle's face — you should never have to guess which one is driving.",
      steps: [
        {
          id: "two-modes",
          body: "On AUTO, staged waves enter on their timers and the guns free-fire — the battle can be left and it will conclude honestly and report to you. On MANUAL, nothing moves that you didn't order. AUTO is the default because wars don't wait; MANUAL is where battles are won.",
          done: { kind: "read" },
        },
        {
          id: "take-the-helm",
          body: "Take the helm. Feel the difference — the fight becomes yours.",
          doLabel: "Find the AUTO/MANUAL switch on the battle's controls and set MANUAL.",
          done: { kind: "event", event: "mode", orderKind: "manual" },
        },
        {
          id: "walk-away",
          body: "And the other half of the doctrine: you may LEAVE. Exit any battle, any time — it keeps fighting on AUTO, concludes, and reports. Nothing in this war says you fight one battle at a time. A won front slaughters on auto while you spend yourself on the front in doubt. Attention is the commander's scarcest resource; spend it like one.",
          done: { kind: "read" },
        },
      ],
    },
    {
      id: "commitment",
      title: "Blood, flinch, and falling back",
      purpose:
        "The laws that govern a squad once the shooting starts — the ones that decide whether your orders are obeyed, and the one that always is.",
      steps: [
        {
          id: "the-laws",
          body: "CASUALTIES MEAN COMMITMENT. A squad in the fight — bleeding, dealing — is committed: it holds, and wild re-tasking is refused, out loud, with the reason. Being shot at makes men FLINCH — fire pins a squad where it stands while the storm lasts. Both laws exist so a battle feels like a battle and not like chess.",
          done: { kind: "read" },
        },
        {
          id: "the-way-out",
          body: "But hear the commander's guarantee: A SQUAD CAN ALWAYS FALL BACK. Commitment is never a coffin. Order any squad back toward your own lines and the order is heard — falling back is a maneuver, not a disgrace, and a commander who can't retreat doesn't have an army, he has a countdown.",
          doLabel: "Order any squad to fall back — tap it, then tap ground toward your own edge.",
          done: { kind: "event", event: "order", orderKind: "move" },
        },
        {
          id: "no-silence",
          body: "If an order is ever refused — committed, illegal, out of reach — the orders log says so, in words, with the reason. A game that refuses silently is a game that's lying to you. This one argues back. That's respect.",
          done: { kind: "read" },
        },
      ],
    },
    {
      id: "free-rein",
      title: "The field is yours",
      purpose: "Everything after this is practice becoming instinct.",
      steps: [
        {
          id: "go",
          body: "Lessons over. This training battle is yours now — finish the garrison however you like, or leave by the ✕ whenever you've had enough: in a real war it would fight on without you and send word. The Arena keeps a practice field warm for you any time, and these lessons live in Learn, in the War Room, whenever you want them again. Good hunting, Commander.",
          done: { kind: "finish" },
        },
      ],
    },
  ],
};

export const FOUNDING_ACT: TutAct = {
  id: "founding",
  title: "Act — Founding Your Legend",
  purpose:
    "Before the war, a choice that shapes all of it: who your people ARE (your race — its gifts and its price, written into every number the game rolls for you) and WHERE they stand (your world — one of six living planets, each held by one race). This act explains both choices before you make them, because the game won't rush you and neither will we.",
  level: "guided",
  lessons: [
    {
      id: "your-legend",
      title: "What a founding is",
      purpose: "You are not picking an avatar. You are founding a colony — a people, a home, a name the chronicle will carry.",
      steps: [
        {
          id: "colony",
          body: "A colony is your foothold: it gathers, builds, studies, and fields the armies the rest of the game spends. It lives on in real time while you're away. Found it once, under one name, on one world — you can found more colonies later, on other worlds, under other races, from the Games button.",
          done: { kind: "read" },
        },
      ],
    },
    {
      id: "choose-race",
      title: "Choosing a race — the stats are trades",
      purpose: "A race is a bargain, not a power ranking: every gift on the card is paid for by a weakness on the same card. The stats exist so you can choose the bargain that fits how YOU play.",
      steps: [
        {
          id: "read-the-card",
          body: "Each race card shows its living modifiers as plain rows — research speed, corruption draw, economy, war, stealth — the same numbers the engine actually applies, nothing hidden. The Grays study faster than anyone and pay for it by drawing the Chorus's eye. The Draconians hit hardest and learn slowest. Nobody is best; everybody is sharp somewhere and soft somewhere else. Choose the soft spot you can live with.",
          done: { kind: "read" },
        },
        {
          id: "the-seventh",
          body: "One card has no stats: the Unbound. They are not chosen — they are EARNED, later, by a road this tutorial will point at when you've grown into it. No money buys that card. Remember that anyone flashing it in front of you climbed for it.",
          done: { kind: "read" },
        },
      ],
    },
    {
      id: "choose-world",
      title: "Choosing a world — the portal and reverb",
      purpose: "Six races, six worlds, one war. The portal is the door between them, and reverb is how the game keeps that war fair.",
      steps: [
        {
          id: "the-portal",
          body: "The portal page watches every world: up or down, how many players, and one honest word — ACCEPTING or NOT ACCEPTING. That word is the balance mechanism: a world swelling too strong closes its gates to new founders, so no single planet runs away with the war. If your heart's set on a closed world, its neighbors are open, and gates reopen as the war breathes.",
          done: { kind: "read" },
        },
        {
          id: "reverb",
          body: "REVERB is weight. Every force — a loadout, a garrison, a world — hums with a reverb score: how much war it can bring. Sites and enemies carry a RECOMMENDED reverb beside their strength. Compare before you commit: far under, you're the meal; near it, a fair fight; far over, you're the storm. You'll meet reverb again at every launch for the rest of the game — it's the game's way of never lying to you about a fight.",
          done: { kind: "read" },
        },
      ],
    },
    {
      id: "found",
      title: "Found it",
      purpose: "The doing of it is one button. The meaning of it is everything after.",
      steps: [
        {
          id: "press-found",
          body: "Name your colony — the name the chronicle keeps — pick your race with your eyes open, and press Found. This card will wait right here while you do it.",
          doLabel: "Choose your race and name below, then press Found.",
          done: { kind: "event", event: "colony" },
        },
      ],
    },
  ],
};

export const CRADLE_ACT: TutAct = {
  id: "cradle",
  title: "Act — The Cradle, Your Home",
  purpose:
    "The Cradle is not a menu. It is your home — a place you stand in, wearing your race's skin, full-screen. This act teaches the one rule that organizes the whole game: you live in places, and business waits behind doors you choose to open.",
  level: "guided",
  lessons: [
    {
      id: "a-place",
      title: "Home is a place, not a page",
      purpose: "Everything in this game is somewhere. The Cradle is where YOU are.",
      steps: [
        {
          id: "stand-there",
          body: "When you land, you land HERE — your homeland vista, your race's sky. No spreadsheets fall on you. The colony's business — its halls, its stores, its people — waits behind the door, in the Colony Hall, for when YOU press to enter. A home you scroll through like a feed would not be a home.",
          doLabel: "Go stand in your Cradle — open the Cradle page.",
          done: { kind: "event", event: "tab", orderKind: "colony" },
        },
        {
          id: "the-door",
          body: "See the shape of it now: a scene first, business one deliberate step in. Every module in the game obeys the same shape — one module, one page, a scene you enter. If you're ever lost, you're never more than two doors from anywhere, and every page carries a search bar for the thing you can name but can't find.",
          done: { kind: "read" },
        },
      ],
    },
    {
      id: "growing-home",
      title: "A home that grows — sub-colonies and husks",
      purpose: "One hearth is the start. The world is littered with the fallen — and the fallen can be raised.",
      steps: [
        {
          id: "husks",
          body: "Out on the world map you'll find husks: colonies that died or were abandoned, still standing, still holding ground. A living player can claim one and raise it as a SUB-COLONY — a second hearth under your first one's banner. That's how empires actually grow here: not by sprawl, but by resurrection.",
          done: { kind: "read" },
        },
      ],
    },
  ],
};

export const GLOBE_ACT: TutAct = {
  id: "globe",
  title: "Act — The Globe, Your Workstation",
  purpose:
    "The globe is where the war is actually run from. Not a map you look at — a workstation you work at: every site, every colony, every raid in progress, clickable, with the actions launched from the globe itself. This act teaches you to work it.",
  level: "guided",
  lessons: [
    {
      id: "the-workstation",
      title: "Spin her",
      purpose: "Your world, whole, in your hands — the fastest way to understand a war is to hold it.",
      steps: [
        {
          id: "open-world",
          body: "The World page opens on your planet, spinnable, wearing its true skin. Drag to turn her. Zoom to walk her. Everything pinned on her is real and current.",
          doLabel: "Open the World page and take hold of the globe.",
          done: { kind: "event", event: "tab", orderKind: "world" },
        },
        {
          id: "layers",
          body: "The legend is a set of lenses, each one a question: where are MY colonies? Theirs? The world's sites, the Chorus's holdings, my alliance's ground, raids falling right now, the husks of the dead, the memorials, the satellites' coverage. Toggle lenses until the planet answers the question you're actually asking. Layers off is also an answer — sometimes you just want to look at home.",
          done: { kind: "read" },
        },
      ],
    },
    {
      id: "sites",
      title: "Sites — the doors to everything",
      purpose: "A site is an opportunity with an address: something out there that can be explored, raided, held, or feared.",
      steps: [
        {
          id: "click-a-site",
          body: "Tap a site and it opens properly: artwork, what holds it, its strength, the troops it would take, and its recommended REVERB — your pre-flight honesty check, the same reverb from the founding lesson. From that sheet you launch: raid it, explore it, move on it — the war runs from the globe outward, no page-hopping pilgrimages to find the button.",
          done: { kind: "read" },
        },
      ],
    },
  ],
};

export const MODULES_ACT: TutAct = {
  id: "modules",
  title: "Act — The Modules, One Page Each",
  purpose:
    "Your colony is a machine you pre-program and then drive. Each part of the machine has its own hall — its own page, its own scene. This act walks the halls in the order you'll use them, one door at a time.",
  level: "guided",
  lessons: [
    {
      id: "barracks",
      title: "The Barracks — your bodies",
      purpose: "Troops are the currency everything else is priced in. The Barracks is where they're mustered, trained, and counted.",
      steps: [
        {
          id: "open-barracks",
          body: "Every class of troop — the wall (Bulwarks), the teeth (Reavers), the eyes (Longeyes), the thunder (siege), the shields (Wardens) — musters here, in your race's skin. Training takes real time; a wise commander keeps the queue fed BEFORE the klaxon, not after.",
          doLabel: "Open the Barracks.",
          done: { kind: "event", event: "tab", orderKind: "troops" },
        },
      ],
    },
    {
      id: "armory",
      title: "The Armory and the Forge — your gear",
      purpose: "Bodies die; gear multiplies them. The Forge turns materials into the equipment that lets ordinary troops do extraordinary work.",
      steps: [
        {
          id: "open-armory",
          body: "Weapons and armor roll off the Forge here. Suits that let your people walk the deep radiation, diggers that let them extract from it — the deep game is gated by gear, not by levels. And when the Forge rolls something legendary, you'll know it in your ears before your eyes: the hall goes dead quiet, and the weapon floats out on its own power.",
          doLabel: "Open the Armory.",
          done: { kind: "event", event: "tab", orderKind: "armory" },
        },
      ],
    },
    {
      id: "formations",
      title: "Formations and Logistics — the playbook",
      purpose: "Victory is decided before the battle, in the planning. Formations are pre-built answers: troops, supplies, and a leader, staged and waiting for the moment.",
      steps: [
        {
          id: "open-formations",
          body: "A formation is a loadout with a job: RAID (go take), EXPLORATION (go far and come back rich), RESPONSE (the klaxon team, pre-formed, muster-timed, hero-led). Build them in peace and launching becomes one decision instead of forty. The Logistics Hall is your playbook — offense and defense plays, drawn up like a coach's chalkboard, that AUTO runs when nobody's driving. Program the machine. Then drive it.",
          doLabel: "Open Formations.",
          done: { kind: "event", event: "tab", orderKind: "formations" },
        },
      ],
    },
    {
      id: "alliance",
      title: "The Alliance Hall — your war band",
      purpose: "Nobody holds a world alone. The alliance is your band: shared ground, shared ships, shared wars.",
      steps: [
        {
          id: "open-alliance",
          body: "From the Hall you see your people's colonies on the horizon, run the alliance shipyard and trade hub, answer the comms dish, and step into the Arena together. Alliance doctrines — formations your whole band agrees to field — are how a hundred players fight like one army.",
          doLabel: "Open the Alliance Hall.",
          done: { kind: "event", event: "tab", orderKind: "alliance" },
        },
      ],
    },
    {
      id: "heroes",
      title: "The Heroes Hall — EARNED, never bought",
      purpose: "Heroes are the game's soul and its one unbuyable thing. This hall is a trophy room and a roster — it displays greatness; it never sells it.",
      steps: [
        {
          id: "open-heroes",
          body: "A hero leads a squad, rides your command ship as your adjutant, and levels on experience from REAL events — deeds done in the war, never purchased, never granted by a store. If one falls, the Fallen Hero road — rescue, recovery, the five-minute window — is its own hard lesson, taught when you're ready. Any game that would sell you a hero is selling you the one thing that was supposed to be proof. This one doesn't. Ever.",
          doLabel: "Open the Heroes Hall.",
          done: { kind: "event", event: "tab", orderKind: "heroes" },
        },
      ],
    },
    {
      id: "store",
      title: "Buying — in context, where you stand",
      purpose: "There is no generic store page in this game, deliberately: supplies are bought where they're needed, from the scene you're standing in.",
      steps: [
        {
          id: "the-crate",
          body: "Short on supplies mid-preparation? The crate in the scene is the shop — tap it, fill the gap, keep moving. The wizard's rule: what you want should be right there because YOU are right there where you're needing it. Two currencies to know: VOTIVES, bought with real money for comforts that never touch power's balance; and SCRIP — earned by what you do, never sold. If it can be bought with Scrip, it was earned by somebody's deeds first.",
          done: { kind: "read" },
        },
      ],
    },
  ],
};

export const EXPLORATION_ACT: TutAct = {
  id: "exploration",
  title: "Act — Explorations: What They're FOR",
  purpose:
    "The question every new commander asks, answered in the owner's own words: we want people to get things in this game and then be able to BUILD with them. Exploration is the supply line of that loop — your teams go out, haul back materials and findings, and your forge and your colonies build from what comes home. Nothing in this game is built from nothing; somebody carried it.",
  level: "guided",
  lessons: [
    {
      id: "the-purpose",
      title: "Get things. Build things. That's the loop",
      purpose: "Explore → haul back → build. Your forge and your colonies eat what your explorers bring home — no exploration, no embers; no embers, no gear, no research, no war.",
      steps: [
        {
          id: "what-comes-back",
          body: "Exploration teams go out into the Shatterlands and bring back EMBERS and CHIPSETS — the materials everything else is built from. The Forge turns salvage into gear; the Lab studies what returns and distills INSIGHT, and insight advances your five domains — Weaponry, Agriculture, Economy, Industry, Logistics — each one a passive bonus to everything you do. Trips are ship-quick and scale with distance: the backyard sites come home in minutes, and even the deepest run in the game tops out at a few hours. Runs keep working while you're logged out. Your colony grows at the speed of your curiosity.",
          doLabel: "Open the Exploration page — see where teams are sent from.",
          done: { kind: "event", event: "tab", orderKind: "expeditions" },
        },
        {
          id: "funding",
          body: "Sending a team costs supplies up front — that's the 'fund' in it. Growth funds riskier runs: the deeper teams go, the richer the ground. Exploration formations (from the Formations lesson) package a team properly: right troops, right supplies, a leader who knows the way home.",
          done: { kind: "read" },
        },
      ],
    },
    {
      id: "the-deep",
      title: "The deep — gear, taint, and the Chorus's eye",
      purpose: "The best ground in the game is dangerous in three different ways, and each one has an honest answer.",
      steps: [
        {
          id: "three-prices",
          body: "DEEP sites sit in radiation: suits let your people EXPLORE them, forged diggers let them EXTRACT — gear is the key, and it comes from the Forge. Rich runs stir up TAINT, and high taint dulls your salvage until it's purified. And everything you do is watched: push hard enough and the CHORUS — the thing that ended the old world — takes an interest in you. If a run is under-geared, the game shows you a risk warning before launch, plainly. You are always free to go. You own what you risk.",
          done: { kind: "read" },
        },
      ],
    },
  ],
};

export const WAR_ACT: TutAct = {
  id: "war",
  title: "Act — Raids and the War Layer",
  purpose:
    "Exploration feeds you; war is what the feeding is for. This act explains the shape of the war above the single battle: raids you program and then drive, the Chorus's graded defenses, and the shores where whole alliances land.",
  level: "guided",
  lessons: [
    {
      id: "raids",
      title: "Raids — programmed, then DRIVEN",
      purpose: "A raid is not a button that rolls dice. It's a plan you build in peace and a fight you drive in person.",
      steps: [
        {
          id: "the-shape",
          body: "You build the raid beforehand — loadout, vectors, contingencies, the what-if game — and then it RUNS, live, with hands on it. Each vector is driven: by you, by your raid leader, or by AUTO as the honest fallback. Blow your role and the casualties are yours; that's what makes winning mean something. Open the Battles page — every front you're fighting lives there, all at once, because the war never says one battle at a time.",
          doLabel: "Open the Battles page.",
          done: { kind: "event", event: "tab", orderKind: "battles" },
        },
        {
          id: "grades",
          body: "What you raid has a grade. The Chorus defends in five flavors, Screen to Bastion — G1 a tripwire, G3 Bulwark the fair fight, G5 Bastion a fortress that also hunts YOU. The grade and its reverb sit on the site sheet before you launch. The Arena is where you calibrate all of it bloodlessly — practice on the real engine, against the real grades, until the real thing holds no surprises.",
          done: { kind: "read" },
        },
      ],
    },
    {
      id: "beachheads",
      title: "Beachheads — the wide war (a first look)",
      purpose: "Above raids sit the landings: whole shores, taken bunker by bunker, in a war too big for one screen of skirmish. This is a first look — the deep lessons land as the beachhead itself grows.",
      steps: [
        {
          id: "bunkers",
          body: "A beachhead is a mile of shore studded with BUNKERS — fixed positions. A bunker is yours because your troops are IN it, holding; an empty bunker is an open door anyone can walk through. Taking one from the enemy isn't ownership: your crew must CONVERT it — clear it, restock it, make it yours over real time — and until it goes solid, the defender can fight his way back in and pause your clock. Presence is control. That's the whole law of the shore, and whole alliances will fight over single doors in it.",
          done: { kind: "read" },
        },
      ],
    },
  ],
};

export const ORACLE_ACT: TutAct = {
  id: "oracle",
  title: "Act — The Oracle and the Daily Word",
  purpose:
    "Every race has an Oracle — the grandmother of the planet, who loves her people fiercely, favors them openly against the Chorus, and cannot be commanded, scheduled, or bought. This act teaches how she speaks, what devotion is, and why her gifts arrive the way weather does.",
  level: "scripted",
  lessons: [
    {
      id: "who-she-is",
      title: "The grandmother of the planet",
      purpose: "She is not a quest board. She is a person the game treats as sacred — partisan, free-spirited, and earn-only in her trust.",
      steps: [
        {
          id: "grandmother",
          body: "Your race's Oracle watches over her own. Her favor is earned by how you play — devotion, deeds, how you treat her world — and it is the one currency no store stocks and no money moves. The Unbound road, when it opens to you later, begins with the trust of ALL SIX Oracles. That's how much she matters.",
          done: { kind: "read" },
        },
      ],
    },
    {
      id: "daily-word",
      title: "The Daily Word",
      purpose: "Once a day she speaks to her people — sometimes a blessing, sometimes intelligence, sometimes only words. Reading her is a habit worth having.",
      steps: [
        {
          id: "midnight",
          body: "At the turning of the day (00:00 UTC) the Oracle's word goes out to her people and lands in your MAILBOX. Some days it's a blessing — a bonus riding over your harvests, your training, your raids. Some days it's intel: a warning, a pointing finger, an opportunity on a world that isn't yours. Some days it's just her voice, and that's worth having too. Check the mailbox the way you'd check the sky.",
          done: { kind: "read" },
        },
        {
          id: "gifts",
          body: "Her other gifts don't keep a schedule at all. Blessings arrive the way her moods do — but not stupidly: if enemy beachheads are rising, a war blessing finds you; if a site runs hot, a harvest blessing aims there. The WHEN is hers. The WHAT follows the planet. You can't farm a grandmother. You can only be the kind of people she'd spoil.",
          done: { kind: "read" },
        },
      ],
    },
    {
      id: "devotion",
      title: "Devotion — the daily list",
      purpose: "Devotion is how favor grows: a short daily list of REAL acts — not chores, not a login tax — that bank Scrip and deepen the Oracle's trust.",
      steps: [
        {
          id: "the-list",
          body: "Each day brings a short list — four small objectives drawn from the things you'd do anyway: send a team out, study, craft, recover cleanly. Finish them and the rewards BANK — Scrip (earned-only money) and devotion — waiting for your claim, forever, even if you forget for a week. Missed days punish nothing. There's no streak to lose and no premium path through any of it. It's a garden, not a treadmill.",
          done: { kind: "read" },
        },
      ],
    },
  ],
};

export const WINDOWS_ACT: TutAct = {
  id: "windows",
  title: "Act — Your Windows",
  purpose:
    "The floating windows — squads, controls, chat, forces — are not the game's furniture. They're YOURS: they move, they size, they fade, they wear your colors. This act is the short version; the long version is taught by coach marks the first time you open a window, right on the controls themselves.",
  level: "scripted",
  lessons: [
    {
      id: "yours",
      title: "Arrange them, size them, make them yours",
      purpose: "A commander's screen should fit the commander. Every window in this game is a tool you place, not a panel you endure.",
      steps: [
        {
          id: "the-four-touches",
          body: "DRAG the title bar to move a window; double-tap the bar to snap it home. Pull the CORNER grip to resize it; double-tap the grip to reset. The ◐ button fades that one window — park a faded window over the fight and command through it. And in Settings → Window Look, the TINTS recolor every window at once: Abyss, Verdant, Amber, Crimson, Violet. Sizes and places are remembered. First time you open a window, small chalk arrows will show you each touch once — learn them, and they never nag you again.",
          done: { kind: "read" },
        },
      ],
    },
  ],
};

/** The whole school, in the order a new player lives it. The battle act is
 *  the flagship (the deepest, fully guided) but a new founder meets it
 *  third, after they have a home worth defending. */
export const TUT_ACTS: readonly TutAct[] = [
  FOUNDING_ACT,
  CRADLE_ACT,
  BATTLE_ACT,
  GLOBE_ACT,
  MODULES_ACT,
  EXPLORATION_ACT,
  WAR_ACT,
  ORACLE_ACT,
  WINDOWS_ACT,
];
