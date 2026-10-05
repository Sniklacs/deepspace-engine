// SCENE HEADER — the game-wide scene header (Hans, Oct 5 2026).
//
// Every scene/page carries this: WHERE the player is standing (location
// name), the tier, and a live server clock. Server time is UTC — the EVE
// standard: matches the day/night solar cycle, no DST ambiguity, one clock
// for cross-server play. Nobody should ever be confused about where they are.

import { useEffect, useState } from "react";

function utcClock(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function SceneHeader({
  name,
  tier,
  sub,
  clock = true,
}: {
  /** Where the player is standing — battle name, colony name, hall name… */
  name: string;
  /** Tier badge when the scene has one (colony tier, site tier…). Omit when n/a. */
  tier?: string;
  /** Optional second line, e.g. "Ashen Vanguard vs Chorus Garrison". */
  sub?: React.ReactNode;
  /** Show the live UTC server clock. Default on. */
  clock?: boolean;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!clock) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [clock]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-100">
          <span className="truncate">{name}</span>
          {tier && (
            <span className="shrink-0 rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
              {tier}
            </span>
          )}
        </p>
        {sub && <div className="mt-0.5 text-[11px] text-zinc-400">{sub}</div>}
      </div>
      {clock && (
        <div className="flex shrink-0 items-baseline gap-2" aria-label="Server clock (UTC)">
          <span className="font-mono text-lg font-bold tabular-nums text-zinc-50" style={{ textShadow: "0 0 14px rgba(56,189,248,0.4)" }}>
            {utcClock()}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">UTC</span>
        </div>
      )}
    </div>
  );
}
