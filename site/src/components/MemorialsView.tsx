// MEMORIALS VIEW — browse the permanent battle plaques (owner 2026-09-30).
//
// The game's history layer: every major battle (1,000+ casualties) earns a
// plaque that stands forever, across all seasons. Newest first. Tapping a
// plaque shows full details; the victor may add one epitaph line (locked
// forever once set).
import { useState } from "react";
import type { GameState } from "../game/types";
import {
  allMemorials,
  type MemorialPlaque,
} from "../game/memorials";

function fmtDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function PlaqueCard({
  plaque,
  playerName,
  onEpitaph,
}: {
  plaque: MemorialPlaque;
  playerName: string;
  onEpitaph: (plaqueId: string, epitaph: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const total = plaque.attackerLosses + plaque.defenderLosses;
  const victorName =
    plaque.victor === "attacker"
      ? plaque.attackerName
      : plaque.victor === "defender"
        ? plaque.defenderName
        : "No victor";
  const canWrite =
    plaque.epitaph === null &&
    plaque.victor !== "draw" &&
    (victorName.includes(playerName) || playerName === victorName);

  return (
    <div
      className="rounded-lg border border-amber-900/60 bg-gradient-to-b from-stone-900 to-stone-950 p-4 shadow-lg"
      style={{ borderLeft: "4px solid #b45309" }}
    >
      <button
        className="w-full text-left"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">🕯️</span>
          <div className="flex-1">
            <div className="font-serif text-amber-100 font-semibold">
              {plaque.siteName}
            </div>
            <div className="text-xs text-stone-400">
              {fmtDate(plaque.at)} · {plaque.season} · {total.toLocaleString()} fallen
            </div>
          </div>
          <span className="text-stone-500 text-sm">{expanded ? "▾" : "▸"}</span>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2 text-stone-300">
            <div>
              <div className="text-xs text-stone-500 uppercase">Attacker</div>
              <div className="font-medium">{plaque.attackerName}</div>
              <div className="text-red-400">{plaque.attackerLosses.toLocaleString()} lost</div>
            </div>
            <div>
              <div className="text-xs text-stone-500 uppercase">Defender</div>
              <div className="font-medium">{plaque.defenderName}</div>
              <div className="text-red-400">{plaque.defenderLosses.toLocaleString()} lost</div>
            </div>
          </div>
          <div className="text-stone-400 text-xs">
            Victor: <span className="text-amber-200 font-medium">{victorName}</span>
          </div>
          {plaque.fallenHeroes.length > 0 && (
            <div className="text-stone-300 text-xs">
              <span className="text-stone-500 uppercase">Fallen heroes: </span>
              {plaque.fallenHeroes.join(", ")}
            </div>
          )}
          {plaque.epitaph !== null ? (
            <blockquote className="border-l-2 border-amber-700 pl-3 italic text-amber-100/90 font-serif">
              “{plaque.epitaph}”
              {plaque.epitaphBy && (
                <footer className="text-xs text-stone-500 not-italic mt-1">
                  — {plaque.epitaphBy}
                </footer>
              )}
            </blockquote>
          ) : canWrite ? (
            editing ? (
              <div className="space-y-2">
                <input
                  className="w-full rounded bg-stone-800 border border-stone-700 px-2 py-1 text-sm text-stone-100"
                  placeholder="Write the epitaph — one line, forever…"
                  maxLength={140}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    className="rounded bg-amber-800 px-3 py-1 text-sm text-amber-100 hover:bg-amber-700"
                    onClick={() => {
                      onEpitaph(plaque.id, draft);
                      setEditing(false);
                      setDraft("");
                    }}
                  >
                    Carve it in stone
                  </button>
                  <button
                    className="rounded px-3 py-1 text-sm text-stone-400 hover:text-stone-200"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-xs text-stone-500">
                  Once carved, the epitaph can never be changed.
                </p>
              </div>
            ) : (
              <button
                className="rounded border border-amber-800 px-3 py-1 text-sm text-amber-200 hover:bg-amber-900/40"
                onClick={() => setEditing(true)}
              >
                ✒️ Add epitaph (victor only, one line, permanent)
              </button>
            )
          ) : (
            <p className="text-xs text-stone-600 italic">
              No epitaph carved.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function MemorialsView({
  state,
  onEpitaph,
}: {
  state: GameState;
  onEpitaph?: (plaqueId: string, epitaph: string) => void;
}) {
  const plaques = allMemorials((state as any).memorials ?? []);
  const playerName = state.playerName || "";

  if (plaques.length === 0) {
    return (
      <div className="rounded-lg border border-stone-800 bg-stone-900/50 p-6 text-center">
        <div className="text-3xl mb-2">🕯️</div>
        <p className="text-stone-300 font-medium">No memorials yet.</p>
        <p className="text-sm text-stone-500 mt-1">
          When a battle claims 1,000 or more lives, a plaque will rise here —
          and stand forever, across every season.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-lg">🕯️</span>
        <h3 className="font-serif text-amber-100 font-semibold">
          Memorials — {plaques.length} plaque{plaques.length === 1 ? "" : "s"}
        </h3>
      </div>
      <p className="text-xs text-stone-500 px-1">
        The game's history layer. These plaques survive every season wipe.
      </p>
      {plaques.map((p) => (
        <PlaqueCard
          key={p.id}
          plaque={p}
          playerName={playerName}
          onEpitaph={(plaqueId, epitaph) => onEpitaph?.(plaqueId, epitaph)}
        />
      ))}
    </div>
  );
}
