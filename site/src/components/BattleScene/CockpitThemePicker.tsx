// CockpitThemePicker — player-changeable cockpit/UI color (owner 2026-10-12).
//
// Default: Halo-style green glow. Race presets: Draconian red, Palladian
// blue, Watcher gold, Gray silver, Annunaki obsidian, Nephilim ember,
// Unbound radiant. The choice drives every command window's accent/glow
// via cockpitAccentStyle() and will drive the cockpit lighting later.

import { useSyncExternalStore } from "react";
import {
  COCKPIT_THEMES,
  cockpitThemeById,
} from "../../game/war/cockpit-theme";
import {
  subscribeSceneUI,
  sceneUISnapshot,
  sceneUIServerSnapshot,
  setCockpitThemeId,
} from "../../game/war/battle-scene-ui-store";
import { battleSfx } from "../../game/war/battle-sfx";

export function CockpitThemePicker() {
  const ui = useSyncExternalStore(subscribeSceneUI, sceneUISnapshot, sceneUIServerSnapshot);
  const active = cockpitThemeById(ui.cockpitThemeId);

  return (
    <section aria-label="Cockpit theme">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
        Cockpit theme
      </p>
      <div className="grid grid-cols-2 gap-1">
        {COCKPIT_THEMES.map((t) => {
          const on = t.id === active.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => { battleSfx.uiClick(); setCockpitThemeId(t.id); }}
              className={`flex min-h-[30px] touch-manipulation items-center gap-1.5 rounded border px-2 py-1 text-[9px] font-semibold transition active:scale-[0.97] ${
                on
                  ? "border-white/60 bg-white/10 text-white"
                  : "border-black/60 bg-black/40 text-zinc-300"
              }`}
              data-testid={`cockpit-theme-${t.id}`}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  background: t.accent,
                  boxShadow: `0 0 8px ${t.glow}`,
                }}
              />
              {t.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[9px] leading-snug text-zinc-500">
        Default Halo green. Pick a race preset or your own glow — every
        command window and the cockpit lighting follow.
      </p>
    </section>
  );
}
