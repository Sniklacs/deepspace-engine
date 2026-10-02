// WindowLookNote — the player's window chrome: translucency + tint.
//
// Hans (2026-10-02): the EVE-style boxes should carry a translucent look he
// can change — opacity and colors, so he can customize his screen. One slider
// for how see-through the windows are, one row of tints, both live the moment
// they move. Persisted per device in window-appearance.ts.
import { useSyncExternalStore } from "react";
import { useT } from "../i18n/I18n";
import {
  DEFAULT_APPEARANCE,
  TINT_PRESETS,
  getWindowAppearance,
  resetWindowAppearance,
  setWindowAppearance,
  subscribeWindowAppearance,
} from "../../game/windows/window-appearance";

const BTN =
  "rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-text-2 active:bg-surf-4";

function useAppearance() {
  return useSyncExternalStore(
    subscribeWindowAppearance,
    getWindowAppearance,
    getWindowAppearance,
  );
}

export default function WindowLookNote() {
  const t = useT();
  const a = useAppearance();
  const pct = Math.round(a.opacity * 100);
  const isDefault =
    a.opacity === DEFAULT_APPEARANCE.opacity && a.tint === DEFAULT_APPEARANCE.tint;

  return (
    <div className="space-y-2.5" data-testid="window-look">
      {/* Opacity — how see-through the windows are */}
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="window-opacity" className="text-[13px] font-medium text-text-2">
            {t("windows.opacity", "Window opacity")}
          </label>
          <span className="text-[12px tabular-nums] text-text-3" aria-live="polite">
            {pct}%
          </span>
        </div>
        <input
          id="window-opacity"
          type="range"
          min={35}
          max={100}
          step={5}
          value={pct}
          data-testid="window-opacity"
          onChange={(e) => setWindowAppearance({ opacity: Number(e.target.value) / 100 })}
          className="mt-1 w-full accent-amber-400"
          aria-valuetext={`${pct} percent`}
        />
        <p className="mt-0.5 text-[11px] leading-snug text-text-3">
          {t(
            "windows.opacitySub",
            "Lower lets the game show through the windows. 100% is solid.",
          )}
        </p>
      </div>

      {/* Tint — the chrome's color */}
      <div>
        <p className="text-[13px] font-medium text-text-2">{t("windows.tint", "Window tint")}</p>
        <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label={t("windows.tint", "Window tint")}>
          {TINT_PRESETS.map((p) => {
            const active = a.tint.toLowerCase() === p.hex.toLowerCase();
            return (
              <button
                key={p.hex}
                type="button"
                role="radio"
                aria-checked={active}
                title={p.name}
                aria-label={p.name}
                data-testid={`window-tint-${p.name.toLowerCase()}`}
                onClick={() => setWindowAppearance({ tint: p.hex })}
                className={`h-11 w-11 rounded-xl border-2 ${
                  active ? "border-amber-300" : "border-line"
                }`}
                style={{ backgroundColor: p.hex }}
              />
            );
          })}
        </div>
      </div>

      {!isDefault && (
        <button
          type="button"
          className={BTN}
          data-testid="window-look-reset"
          onClick={() => resetWindowAppearance()}
        >
          {t("windows.reset", "Reset window look")}
        </button>
      )}
    </div>
  );
}
