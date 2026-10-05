// BATTLE LEGEND — the on-canvas icon key (owner 2026-10-05).
//
// Hans: "name the damn icons." A small collapsible chip in the corner of
// the scene: tap to open a glass panel mapping icon → unit name for the
// five troop types, plus the friend/foe side colors. Collapsed by default
// so the clean screen stays clean.

import { useState } from "react";
import { TROOP_KINDS, UNIT_KIND_LABEL } from "../../game/war/battle-scene-model";

const ART = "/art/battle/units";

export function BattleLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute bottom-4 left-3 z-10" data-testid="battle-legend">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="rounded-full border border-white/20 bg-black/55 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-200 backdrop-blur-md hover:bg-black/80"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
        >
          ◈ Legend
        </button>
      ) : (
        <div className="w-44 rounded-xl border border-white/15 bg-black/70 p-2.5 backdrop-blur-md">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Legend</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close legend"
              className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {TROOP_KINDS.map((kind) => (
              <div key={kind} className="flex items-center gap-2">
                <img
                  src={`${ART}/${kind}.webp`}
                  alt=""
                  className="h-5 w-5 shrink-0 object-contain"
                  loading="lazy"
                />
                <span className="text-[11px] font-medium text-zinc-200">{UNIT_KIND_LABEL[kind]}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 border-t border-white/10 pt-1.5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#34d399", boxShadow: "0 0 6px #34d399" }} />
              <span className="text-[10px] text-zinc-300">Friendly</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#ef4444", boxShadow: "0 0 6px #ef4444" }} />
              <span className="text-[10px] text-zinc-300">Enemy</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
