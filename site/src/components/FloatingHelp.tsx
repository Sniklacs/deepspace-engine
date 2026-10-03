// FloatingHelp — the global 🤝 button (owner 2026-10-02).
//
// Always visible on EVERY tab when there's something actionable:
//  - help ticks remaining + alliance mates (one-tap "Lend a hand")
//  - distress beacons (stranded ships; rescue plugs in when the mechanic lands)
//
// Badge = number of open opportunities. Tapping opens the quick-help panel.
// Dismisses (unmounts) when nothing needs help. Mounted in AppShell so it
// outlives tab switches.
import { useMemo, useState } from "react";
import type { GameState } from "../game/types";
import type { GameResult } from "../game/api";
import { allianceOf, helpRemaining } from "../game/war/alliances";
import { ensureShipyard } from "../game/shipyard";
import { helpTickFn } from "../game/api";
import { useT } from "./i18n/I18n";
import { Bdi } from "./ui/Bdi";

type Act = (fn: () => Promise<GameResult>, label: string) => void;

interface Beacon {
  id: string;
  name: string;
}

export default function FloatingHelpButton({
  state,
  token,
  onAction,
}: {
  state: GameState;
  token?: string;
  onAction: Act;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [hintFor, setHintFor] = useState<string | null>(null);
  const me = state.gameId ?? "";
  const now = Date.now();

  const { mates, beacons, remaining } = useMemo(() => {
    const alliance = me ? allianceOf(state, me) : null;
    const rem = helpRemaining(state, now);
    const m = alliance && rem > 0 ? alliance.members.filter((x) => x.colonyId !== me) : [];
    const b: Beacon[] = [];
    const seen = new Set<string>();
    const collect = (ships: { id: string; name: string; status: string }[] | undefined, where: string) => {
      for (const s of ships ?? []) {
        if (s.status === "stranded" && !seen.has(s.id)) {
          seen.add(s.id);
          b.push({ id: s.id, name: `${s.name} (${where})` });
        }
      }
    };
    collect(state.worldMap?.shipyard?.ships, t("helpFab.yours", "yours"));
    if (alliance) collect(ensureShipyard(alliance).ships, alliance.name);
    return { mates: m, beacons: b, remaining: rem };
  }, [state, me, now, t]);

  const count = mates.length + beacons.length;
  if (!me || count === 0) return null;

  const lendHand = (colonyId: string, colonyName: string) => {
    if (!token || remaining <= 0) {
      setHintFor(colonyId);
      return;
    }
    setHintFor(null);
    onAction(
      () => helpTickFn({ data: { token, targetId: colonyId, targetName: colonyName } }),
      "help",
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("helpFab.open", "Help — {n} need a hand", { n: count })}
        className="help-fab-pulse fixed z-40 flex h-14 w-14 items-center justify-center rounded-full border border-amber-300/50 bg-amber-400/90 text-2xl shadow-lg"
        style={{
          bottom: "calc(var(--spacing-nav) + env(safe-area-inset-bottom, 0px) + 16px)",
          insetInlineEnd: "16px",
        }}
      >
        <span aria-hidden="true">🤝</span>
        <span className="absolute -top-1 -end-1 flex h-6 min-w-6 items-center justify-center rounded-full border border-amber-200 bg-red-600 px-1 text-[11px] font-bold text-white">
          <Bdi dir="ltr" className="num">{count}</Bdi>
        </span>
      </button>

      {open && (
        <div
          className="fixed z-40 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surf-1 p-3 shadow-2xl"
          style={{
            bottom: "calc(var(--spacing-nav) + env(safe-area-inset-bottom, 0px) + 80px)",
            insetInlineEnd: "16px",
          }}
          role="dialog"
          aria-label={t("helpFab.title", "Who needs a hand")}
        >
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-[13px] font-semibold text-text-1">
              {t("helpFab.title", "Who needs a hand")}
            </h4>
            <button
              type="button"
              className="rounded px-2 py-0.5 text-[11px] text-text-3"
              onClick={() => setOpen(false)}
              aria-label={t("helpFab.close", "Close")}
            >
              ✕
            </button>
          </div>

          {mates.length > 0 && (
            <>
              <p className="mb-1.5 text-[11px] text-text-3">
                {t("helpFab.ticksLeft", "{n}/5 help ticks left", { n: remaining })}
              </p>
              <ul className="mb-2 space-y-1">
                {mates.map((m) => (
                  <li key={m.colonyId} className="rounded-lg border border-line bg-surf-2 px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[13px] text-text-1">{m.colonyName}</span>
                      <button
                        type="button"
                        className="shrink-0 rounded bg-acc px-2.5 py-1 text-[11px] font-semibold text-white"
                        onClick={() => lendHand(m.colonyId, m.colonyName)}
                      >
                        {t("cradleAlliance.lendHand", "Lend a hand")}
                      </button>
                    </div>
                    {hintFor === m.colonyId && (
                      <p className="mt-1 text-[11px] text-amber-200">
                        {!token
                          ? t("cradleAlliance.noToken", "Log in to lend a hand.")
                          : t("cradleAlliance.noTicks", "No help ticks left today — they refresh with the new day.")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {beacons.length > 0 && (
            <>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-300">
                {t("helpFab.beacons", "Distress beacons")}
              </p>
              <ul className="space-y-1">
                {beacons.map((b) => (
                  <li key={b.id} className="rounded-lg border border-red-900/50 bg-surf-2 px-2.5 py-1.5">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 text-start"
                      onClick={() => setHintFor(hintFor === b.id ? null : b.id)}
                    >
                      <span className="min-w-0 truncate text-[13px] text-text-1">🚨 {b.name}</span>
                    </button>
                    {hintFor === b.id && (
                      <p className="mt-1 text-[11px] text-amber-200">
                        {t("helpFab.rescueSoon", "Ship rescue isn't built yet — the beacon is logged.")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}
