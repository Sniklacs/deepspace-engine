// ShipyardGuides — the in-module field manual (owner 2026-10-04).
//
// Order 3: the shipyard gets a full "Ship Guide" describing every ship
// class — what it does, its battlefield role, strengths, what it's for.
// (The turret "Armory Guide" lives in ArmoryGuide.tsx.)
//
// Game-manual prose, not stat dumps — written like a field manual a
// commander would actually read. Stats shown are the live tuning values
// (game/raids.ts, game/shipyard.ts), so the manual never drifts from
// the game. Art reuses shipArtUrl / TurretThumb with the onError-fallback
// pattern — no broken images, nothing generated.
import { useState } from "react";
import { SHIP_BUILD_MS, SHIP_CLASSES, shipName, type ShipClass } from "../game/worldmap";
import { SHIP_COST } from "../game/shipyard";
import { SHIP_FIREPOWER, SHIP_HULL, SHIP_LOOT_CAP, SHIP_TROOP_CAP } from "../game/raids";
import { classTurret } from "../game/turrets";
import { ShipArt } from "./StackedShips";
import { TurretThumb } from "./TurretThumb";
import { useT } from "./i18n/I18n";

function fmtBuild(ms: number): string {
  const h = Math.round(ms / 3600_000);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function costLine(cls: ShipClass): string {
  const c = SHIP_COST[cls];
  const parts = [`${c.supplies.toLocaleString()} supplies`];
  if (c.raceMaterial > 0) parts.push(`${c.raceMaterial} race mat`);
  if (c.alloys > 0) parts.push(`${c.alloys} alloys`);
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ */
/* Ship Guide                                                          */
/* ------------------------------------------------------------------ */

interface ShipGuideEntry {
  tagline: string;
  role: string;
  body: string[];
  strengths: string[];
  watchOut: string[];
  call: string;
}

const SHIP_GUIDE: Record<ShipClass, ShipGuideEntry> = {
  scout: {
    tagline: "Eyes, not guns.",
    role: "Reconnaissance and fast courier work.",
    body: [
      "The scout is the cheapest hull that can still make a jump — two hours on the printer, five hundred supplies, no alloys, no alliance required. It is the only warship a lone commander can build, and that is exactly what it is for: getting one person, one probe, one message somewhere fast.",
      "It carries two hundred troops and a thousand units of loot — a raiding skiff, not an invasion. Its needle battery is defensive: it stings anything that gets close and never starts a fight. If your scout is shooting, the mission has already failed. Its job was to see, and to leave.",
    ],
    strengths: [
      "Fastest hull off the line — about two hours, built solo",
      "No alliance required — the lone commander's jump ship",
      "Cheap enough to lose: 500 supplies, zero alloys",
    ],
    watchOut: [
      "Paper hull — ground fire will shred it",
      "20 firepower is a rounding error in a real fight",
    ],
    call: "Build scouts when you need eyes on a target, a fast courier, or your first taste of another world. Never send one to a fight.",
  },
  frigate: {
    tagline: "The backbone of the line.",
    role: "General-purpose line warship — raids, escort, fleet core.",
    body: [
      "If you only learn one hull, learn this one. The frigate is the balanced workhorse of every fleet: eighty firepower from twin light turrets, eight hundred troops in the bays, five thousand units of cargo space, and a hull thick enough to survive a landing that goes loud. Nothing about it is extreme; everything about it is enough.",
      "Every fleet plan starts with frigates. They carry the raid, they hold the line while the vanguard aims, and they come home with the loot. A commander with a stack of frigates has an answer for almost any problem the Chorus — or a rival — can pose.",
    ],
    strengths: [
      "Best all-rounder: guns, troops, and loot in one hull",
      "Twin light turrets — the workhorse guns of the line",
      "Four-hour build keeps fleets replacing losses fast",
    ],
    watchOut: [
      "Master of none — a vanguard outshoots it, a bulwark outlasts it",
      "Needs an alliance factory to build",
    ],
    call: "Build frigates first, build them often, and never apologize for it. They are the fleet.",
  },
  bulwark: {
    tagline: "A wall with teeth.",
    role: "Heavy escort and beachhead anchor — defense is its weapon.",
    body: [
      "Four hundred hull. Read that again: the bulwark carries twice the armor of anything else that flies, and it uses it the way a shield wall uses shields — by standing where the fire is thickest and refusing to move. Ground fire that shreds scouts and bloodies frigates washes off a bulwark, which makes field repairs cheap and loud landings survivable.",
      "Its aegis grid isn't for dueling warships — it's an interlocking point-defense screen that swats strikecraft and incoming ordnance out of the sky. Park a bulwark over your fatcats and your landers and the enemy's harassment dies before it arrives. It carries two thousand troops besides, so the wall brings its own garrison.",
    ],
    strengths: [
      "400 hull — shrugs off ground fire, cheap to repair",
      "Aegis grid: strikecraft and ordnance never reach what it guards",
      "2,000 troops — the wall brings its own army",
    ],
    watchOut: [
      "60 firepower — it holds ground, it doesn't take it",
      "Eight-hour build, the slowest warship to replace",
    ],
    call: "Build bulwarks when your fatcats start coming home light, or when a beachhead needs to survive the night. They are the escort your loot deserves.",
  },
  vanguard: {
    tagline: "The can-opener.",
    role: "Heavy strike — capital cracking and breaking fortified sites.",
    body: [
      "One hundred and forty firepower from a single heavy siege cannon. In ground terms: a vanguard hits like a hundred and forty Reavers, delivered from orbit, in one firing solution. It is slow to aim and ruinous when it lands — the weapon you bring when the target is fortified, dug in, and laughing at frigates.",
      "The vanguard doesn't skirmish and it doesn't chase. It arrives, it aims, and the problem stops existing. Twelve hundred troops ride along to hold whatever the cannon opens. Treat it like artillery with a jump drive: decisive, deliberate, and wasted on soft targets.",
    ],
    strengths: [
      "140 firepower — the hardest-hitting hull in the fleet",
      "Siege cannon cracks fortifications frigates can't touch",
      "1,200 troops to hold what the cannon opens",
    ],
    watchOut: [
      "Slow to aim — needs the fleet to buy it firing time",
      "220 hull is respectable, not invincible — screen it",
    ],
    call: "Build vanguards when the target is hard: fortified sites, enemy beachheads, anything with walls. Point it at the problem and give it time.",
  },
  fatcat: {
    tagline: "The loot truck.",
    role: "Heavy hauler — it carries the war home.",
    body: [
      "Twenty-five thousand units of loot capacity. Nothing else in the fleet comes close, and that number is the entire reason the fatcat exists: raids are only worth what you can carry home. It is big, slow, and expensive — ten hours on the printer, the priciest hull you can order — and completely, gloriously worth it when it lumbers home full.",
      "Do not mistake it for a warship. Ten firepower is a peashooter; its twin chain-gun battery is a wall of lead meant to make boarders think twice, not to win duels. The fatcat survives by never being alone — bulwarks overhead, frigates on the flanks, and a commander who planned the extraction before the insertion.",
    ],
    strengths: [
      "25,000 loot capacity — five times the next-best hull",
      "Thick-skinned hauler (200 hull) built to take a hit and keep flying",
      "Chain-guns punish anything dumb enough to close with it",
    ],
    watchOut: [
      "10 firepower — it cannot fight its way out of anything",
      "Slowest, priciest build: 10 hours, 3,000 supplies, 8 alloys",
    ],
    call: "Build fatcats when your raids are succeeding and your cargo bays are the bottleneck. Then guard them like the treasury they are.",
  },
  herald: {
    tagline: "The conductor, not the orchestra.",
    role: "Fleet command — coordination, not guns.",
    body: [
      "The herald carries no guns. None. What it carries is a spinal war-drum command array — the most complex system bolted to any hull — and that array doesn't add firepower, it multiplies everyone else's. Targeting solutions, firing timing, vector coordination: the herald conducts the fleet's fire instead of adding its own, and a fleet with a herald fights like a larger fleet.",
      "Three hundred troops, two thousand units of cargo, a hull that won't survive being the center of attention — the herald is not a combatant, it's a headquarters that jumps. Keep it screened, keep it alive, and watch your frigates shoot like vanguards.",
    ],
    strengths: [
      "War-drum array coordinates the whole fleet's fire",
      "Force multiplier — every gun in the fleet benefits",
      "Five-hour build, modest cost for what it does to a battle",
    ],
    watchOut: [
      "No guns — if it's shooting, something went wrong",
      "Thin hull (120): screen it or lose your conductor mid-symphony",
    ],
    call: "Build a herald when your fleets are big enough that coordination is the bottleneck. One per fleet is doctrine; two is showing off.",
  },
};

/** The Ship Guide — every class, field-manual prose, live stats. */
export function ShipGuide({ raceId }: { raceId: string }) {
  const t = useT();
  const [sel, setSel] = useState<ShipClass>("frigate");
  const entry = SHIP_GUIDE[sel];
  const turret = classTurret(sel);
  const name = shipName(raceId, sel);

  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold text-text-1">
        {t("shipGuide.title", "Ship Guide")}
      </h4>
      <p className="mb-3 text-xs text-text-2">
        {t(
          "shipGuide.intro",
          "Ships are the engine's chassis. Troops win ground; ships decide whether your troops arrive, how much they carry home, and whether anything shoots back from orbit. Six classes, six jobs — learn them like your own hands.",
        )}
      </p>

      {/* Class selector */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {SHIP_CLASSES.map((cls) => (
          <button
            key={cls}
            type="button"
            onClick={() => setSel(cls)}
            aria-pressed={sel === cls}
            className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs ${
              sel === cls
                ? "border-acc bg-acc/15 text-text-1"
                : "border-line bg-surf-1 text-text-2 hover:text-text-1"
            }`}
          >
            <ShipArt raceId={raceId} shipClass={cls} size={28} />
            <span>{shipName(raceId, cls)}</span>
          </button>
        ))}
      </div>

      {/* Selected class detail */}
      <article className="rounded-xl border border-line bg-surf-1 p-4">
        <div className="flex items-start gap-3">
          <ShipArt raceId={raceId} shipClass={sel} size={72} className="shrink-0 rounded-lg border border-line object-cover" />
          <div className="min-w-0">
            <h5 className="text-base font-semibold text-text-1">{name}</h5>
            <p className="text-sm italic text-acc">{t(`shipGuide.${sel}.tagline`, entry.tagline)}</p>
            <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-text-3">
              {t(`shipGuide.${sel}.role`, entry.role)}
            </p>
          </div>
        </div>

        <div className="mt-3 space-y-2 text-sm leading-relaxed text-text-2">
          {entry.body.map((p, i) => (
            <p key={i}>{t(`shipGuide.${sel}.body${i + 1}`, p)}</p>
          ))}
        </div>

        {/* Live stat strip */}
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-2">
          <span>⚔ {SHIP_FIREPOWER[sel]}</span>
          <span>🛡 {SHIP_HULL[sel]}</span>
          <span>{t("shipGuide.troops", "{n} troops", { n: SHIP_TROOP_CAP[sel].toLocaleString() })}</span>
          <span>{t("shipGuide.loot", "{n} loot", { n: SHIP_LOOT_CAP[sel].toLocaleString() })}</span>
          <span>{t("shipGuide.build", "Build: {cost} · ~{time}", { cost: costLine(sel), time: fmtBuild(SHIP_BUILD_MS[sel]) })}</span>
        </div>

        {/* Armament */}
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surf-2 px-3 py-2">
          <TurretThumb shipClass={sel} size={32} />
          <div className="text-xs">
            <p className="font-semibold text-text-1">{turret.name}</p>
            <p className="text-text-3">{t(`shipGuide.${sel}.armament`, turret.armamentLine)}</p>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <h6 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
              {t("shipGuide.strengths", "Strengths")}
            </h6>
            <ul className="list-disc space-y-0.5 ps-4 text-xs text-text-2">
              {entry.strengths.map((s, i) => (
                <li key={i}>{t(`shipGuide.${sel}.strength${i + 1}`, s)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h6 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-300">
              {t("shipGuide.watchOut", "Watch out")}
            </h6>
            <ul className="list-disc space-y-0.5 ps-4 text-xs text-text-2">
              {entry.watchOut.map((s, i) => (
                <li key={i}>{t(`shipGuide.${sel}.watch${i + 1}`, s)}</li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-3 border-s-2 border-acc/60 ps-3 text-xs italic text-text-2">
          <span className="font-semibold not-italic text-text-1">{t("shipGuide.call", "Commander's call:")} </span>
          {t(`shipGuide.${sel}.call`, entry.call)}
        </p>
      </article>
    </div>
  );
}
