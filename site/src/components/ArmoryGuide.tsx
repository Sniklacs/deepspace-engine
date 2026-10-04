// ArmoryGuide — the in-module turret field manual (owner 2026-10-04).
//
// Order 4: the six turret mounts in game/turrets.ts get the full
// field-manual treatment — what each weapon does, its special tasks and
// battle role (Aegis Grid = strikecraft/ordnance screen, Siege Cannon =
// capital cracking, War-Drum Array = fleet coordination, not guns).
//
// Game-manual prose, not stat dumps. Art reuses the turret `art` field
// via TurretThumb with the onError-fallback pattern — no broken images,
// nothing generated. game/turrets.ts is read, never edited.
import { useState } from "react";
import { shipName } from "../game/worldmap";
import { TURRETS } from "../game/turrets";
import { TurretThumb } from "./TurretThumb";
import { useT } from "./i18n/I18n";

/* ------------------------------------------------------------------ */
/* Armory Guide                                                        */
/* ------------------------------------------------------------------ */

interface TurretGuideEntry {
  task: string;
  body: string;
  doctrine: string[];
}

const TURRET_GUIDE: Record<string, TurretGuideEntry> = {
  "needle-battery": {
    task: "Close-in defense for a hull that should never be in a fight.",
    body: "A cluster of light defensive guns with one job: sting anything that gets close to a scout. The needle battery doesn't win engagements — it buys the three seconds a scout needs to break contact and jump. Short-ranged, fast-tracking, utterly uninterested in heroics.",
    doctrine: [
      "Fast traverse — tracks strikecraft and boarders at knife range",
      "Defensive only: no offensive fire solution worth naming",
      "If the needles are firing, the scout is already leaving",
    ],
  },
  "light-turret": {
    task: "General-purpose gunnery — the workhorse guns of the line.",
    body: "Twin light turrets, fore and aft, with a fire-control system a junior gunner can learn in a week. The light turret is the most-produced weapon mount in the fleet because it does the most common job: killing anything frigate-sized or smaller, reliably, at medium range, all day.",
    doctrine: [
      "Twin mounts — no blind arcs on the things it hunts",
      "Enough gun for escorts, raids, and patrol alike",
      "The mount you measure every other mount against",
    ],
  },
  "aegis-grid": {
    task: "Strikecraft and ordnance screen — the fleet's umbrella.",
    body: "Not one gun but a grid: interlocking point-defense mounts slaved to a single tracking picture, covering the bulwark and everything it stands over. Strikecraft, missiles, shells — the aegis grid swats them out of the sky before they arrive. It doesn't duel warships; it deletes everything smaller than one.",
    doctrine: [
      "Interlocking coverage — no gaps for ordnance to slip through",
      "Protects the ships it escorts, not just itself",
      "Park it over the fatcats and watch harassment die",
    ],
  },
  "siege-cannon": {
    task: "Capital cracking — one shot, one ruin.",
    body: "A single heavy siege cannon on a slow-traverse spinal mount. It takes an age to aim and it only needs one firing solution: when the siege cannon lands, fortifications stop being fortifications. This is the mount that makes the vanguard the vanguard — everything else on the hull is just delivery.",
    doctrine: [
      "The hardest single hit afloat — built for fortifications and capital hulls",
      "Wasted on soft targets; aim it at the problem",
      "Give it time to aim and the problem stops existing",
    ],
  },
  "chain-gun-battery": {
    task: "Close defense for a hauler that can't outrun trouble.",
    body: "Twin rotary chain-guns — a wall of lead for anything dumb enough to close with a hauler. The chain-gun battery exists for one nightmare: boarders and strikecraft swarming a fat, slow, priceless fatcat. It doesn't reach far and it doesn't need to; at knife range, nothing gets through.",
    doctrine: [
      "Rotary volume-of-fire — saturation beats precision up close",
      "Keeps boarders honest while the escorts arrive",
      "The fatcat's “not today” — never its plan A",
    ],
  },
  "war-drum-array": {
    task: "Fleet coordination — it conducts the fire instead of adding its own.",
    body: "The only mount in the fleet that isn't a weapon. The war-drum is a spinal command array: fleet targeting solutions, synchronized firing timing, vector coordination across every hull in the formation. It turns six ships shooting into one fleet firing. Commanders who've fought with a herald never go back — and commanders who've faced one never forget the drums.",
    doctrine: [
      "No guns — its weapon is everyone else's guns, fired together",
      "Synchronized fire control across the whole formation",
      "Protect the herald and your fleet fights above its weight",
    ],
  },
};

/** The Armory Guide — every turret mount, field-manual prose. */
export function ArmoryGuide({ raceId }: { raceId: string }) {
  const t = useT();
  const [sel, setSel] = useState(TURRETS[0].id);
  const def = TURRETS.find((x) => x.id === sel) ?? TURRETS[0];
  const entry = TURRET_GUIDE[def.id];

  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold text-text-1">
        {t("armoryGuide.title", "Armory Guide")}
      </h4>
      <p className="mb-3 text-xs text-text-2">
        {t(
          "armoryGuide.intro",
          "Every hull carries one signature mount, fixed at the factory and never traded — turrets are part of the ship, not inventory. Six mounts, six jobs. Know what each one is for and you'll know what each hull is for.",
        )}
      </p>

      {/* Mount selector */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {TURRETS.map((tr) => (
          <button
            key={tr.id}
            type="button"
            onClick={() => setSel(tr.id)}
            aria-pressed={sel === tr.id}
            className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs ${
              sel === tr.id
                ? "border-acc bg-acc/15 text-text-1"
                : "border-line bg-surf-1 text-text-2 hover:text-text-1"
            }`}
          >
            <TurretThumb shipClass={tr.shipClass} size={28} />
            <span>{tr.name}</span>
          </button>
        ))}
      </div>

      {/* Selected mount detail */}
      <article className="rounded-xl border border-line bg-surf-1 p-4">
        <div className="flex items-start gap-3">
          <TurretThumb shipClass={def.shipClass} size={72} />
          <div className="min-w-0">
            <h5 className="text-base font-semibold text-text-1">{def.name}</h5>
            <p className="text-sm italic text-acc">{t(`armoryGuide.${def.id}.task`, entry.task)}</p>
            <p className="mt-0.5 text-xs text-text-3">
              {t(`armoryGuide.${def.id}.mounted`, def.kind === "system"
                ? "Command system — carried by the {ship}"
                : "Weapon mount — carried by the {ship}", { ship: shipName(raceId, def.shipClass) })}
              {" · "}
              {t(`armoryGuide.${def.id}.armament`, def.armamentLine)}
            </p>
          </div>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-text-2">
          {t(`armoryGuide.${def.id}.body`, entry.body)}
        </p>
        <p className="mt-2 text-xs italic text-text-3">
          {t(`armoryGuide.${def.id}.flavor`, `“${def.flavor}”`)}
        </p>

        <h6 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-text-2">
          {t("armoryGuide.battleTask", "Battle task")}
        </h6>
        <ul className="list-disc space-y-0.5 ps-4 text-xs text-text-2">
          {entry.doctrine.map((d, i) => (
            <li key={i}>{t(`armoryGuide.${def.id}.doctrine${i + 1}`, d)}</li>
          ))}
        </ul>
      </article>
    </div>
  );
}
