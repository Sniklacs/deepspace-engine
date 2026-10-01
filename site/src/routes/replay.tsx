// /replay — the battle-replay prototype sandbox.
//
// Canned battles built from the rally plan presets, so the 2.5D viewer can
// be judged without fighting a real battle first. Pick a plan, watch the
// vectors enter, the surprise land, the pickets go up. The "staging" toggle
// shows the pre-loaded view: the locked plan before launch, counting down.
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import BattleReplay from "../components/BattleReplay";
import { REPLAY_PRESETS, buildDemoBattle, type ReplayPreset } from "../game/war/replay-demo";

export const Route = createFileRoute("/replay")({
  component: ReplaySandbox,
});

function ReplaySandbox() {
  const [preset, setPreset] = useState<ReplayPreset>("pincer");
  const [staging, setStaging] = useState(false);
  // Anchor once per preset/staging so the demo battle (and its timeline)
  // stays stable while the viewer plays, pauses, and scrubs.
  const battle = useMemo(() => buildDemoBattle(preset, Date.now(), staging), [preset, staging]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="relative mb-4 overflow-hidden rounded-xl border border-line">
        <img
          src="/art/battles/battle-chorus.webp"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07070c] via-[#07070c]/60 to-[#07070c]/20" />
        <div className="relative flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h1 className="text-xl font-bold text-white">Battle replay — prototype</h1>
            <p className="text-sm text-zinc-300">
              Plan-driven 2.5D viewer. The plan is locked in; the attributes decide the outcome — this shows the key parts while the fight is on.
            </p>
          </div>
          <Link to="/play" className="rounded-md border border-white/20 bg-black/40 px-3 py-1.5 text-sm text-zinc-200 hover:text-white">
            ← Back to the game
          </Link>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {REPLAY_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            title={p.blurb}
            className={`rounded-lg border px-3 py-1.5 text-start ${preset === p.id ? "border-ember bg-ember/10" : "border-surf-3"}`}
          >
            <span className={`block text-sm font-semibold ${preset === p.id ? "text-ember-soft" : "text-text-1"}`}>{p.label}</span>
            <span className="block text-[11px] text-text-3">{p.blurb}</span>
          </button>
        ))}
        <button
          onClick={() => setStaging(!staging)}
          className={`ms-auto rounded-lg border px-3 py-1.5 text-sm ${staging ? "border-amber-400/60 text-amber-200" : "border-surf-3 text-text-3"}`}
          title="Show the pre-loaded plan view: the locked plan counting down to launch"
        >
          {staging ? "● Staging view" : "○ Staging view"}
        </button>
      </div>

      <BattleReplay battle={battle} />

      <p className="mt-3 text-xs text-text-3">
        Prototype notes: canvas-drawn formations over parallax layers (real WebP backdrops slot into the same layer
        stack later). Timelines, surprise windows, screens, and the withdrawal are read straight off the battle object —
        the same shape a live rally battle carries. Scrub to the ⚡ chapters for the good parts.
      </p>
    </div>
  );
}
