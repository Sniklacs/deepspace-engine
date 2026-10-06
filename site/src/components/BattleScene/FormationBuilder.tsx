// FormationBuilder — the arena workbench (owner 2026-10-06).
//
// Build a formation: start from any playbook play OR from blank, then
// customize freely — move troops between slots, adjust slot entry timings,
// rename slots, re-vector slots. Test it in battle right there, then
// "Save in war room" locks it down under a name. No back-and-forth between
// rooms to get a formation made.

import { useMemo, useState } from "react";
import {
  autoloadSuggested,
  blankSlots,
  deficitHeadline,
  entryLabel,
  formationSlots,
  playById,
  playsForLevel,
  suggestedFormationName,
  validateLoads,
  type AutoloadResult,
  type PlaySlot,
  type SavedFormation,
  type SlotEntry,
  type SlotLoads,
} from "../../game/war/playbook";
import {
  DEFAULT_CHORUS_GRADE,
  DEPLOY_CAP,
  escortWarning,
  type ChorusGrade,
} from "../../game/war/deploy-loadout";
import {
  TROOP_TIERS,
  TROOP_TYPES,
  rosterByTier,
  tierPowerMult,
  type TroopRoster,
  type TroopTier,
  type TroopType,
} from "../../game/war/troops";
import type { ManeuverVector } from "../../game/war/war-types";
import { FormationDiagram } from "./FormationDiagram";

const VECTORS: ManeuverVector[] = ["MAIN", "FLANK_LEFT", "FLANK_RIGHT", "REAR", "RESERVE"];
const VEC_NAME: Record<ManeuverVector, string> = {
  MAIN: "Main",
  FLANK_LEFT: "Flank L",
  FLANK_RIGHT: "Flank R",
  REAR: "Rear",
  RESERVE: "Reserve",
};
const TYPE_NAME: Record<TroopType, string> = {
  bulwark: "Bulwark",
  reaver: "Reaver",
  longeye: "Longeye",
  thunder: "Thunder",
  warden: "Warden",
};
const GRADES: ChorusGrade[] = [1, 2, 3, 4, 5];

export interface BuilderSeed {
  playId: string; // play id or "custom"
  loads?: SlotLoads;
  slotMeta?: SavedFormation["slotMeta"];
  name?: string;
  editingId?: string;
}

export function FormationBuilder({
  roster,
  leaderLevel,
  seed,
  onTest,
  onSave,
}: {
  roster: TroopRoster;
  leaderLevel: number;
  seed: BuilderSeed;
  onTest: (formation: SavedFormation, grade: ChorusGrade) => void;
  onSave: (draft: { id?: string; name: string; playId: string; loads: SlotLoads; slotMeta?: SavedFormation["slotMeta"]; locked: boolean }) => void;
}) {
  const [playId, setPlayId] = useState(seed.playId);
  const [loads, setLoads] = useState<SlotLoads>(seed.loads ?? {});
  const [slotMeta, setSlotMeta] = useState<SavedFormation["slotMeta"]>(seed.slotMeta);
  const [customSlots, setCustomSlots] = useState<PlaySlot[] | null>(
    seed.playId === "custom" ? (seed.slotMeta?.__slots as PlaySlot[] | undefined) ?? blankSlots() : null,
  );
  const [name, setName] = useState(seed.name ?? "");
  const [editingId] = useState(seed.editingId);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [grade, setGrade] = useState<ChorusGrade>(DEFAULT_CHORUS_GRADE);
  const [autofillInfo, setAutofillInfo] = useState<AutoloadResult | null>(null);

  const owned = useMemo(() => rosterByTier(roster), [roster]);

  // Effective slots: custom list, or the play's slots with overrides.
  const slots: PlaySlot[] = useMemo(() => {
    if (playId === "custom" && customSlots) return customSlots;
    const f = { id: "", name: "", playId, locked: false, loads, slotMeta, createdAt: 0, updatedAt: 0 } as SavedFormation;
    return formationSlots(f);
  }, [playId, customSlots, loads, slotMeta]);

  const play = playId === "custom" ? null : playById(playId);
  const access = useMemo(() => playsForLevel(leaderLevel), [leaderLevel]);

  const usedByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const picks of Object.values(loads))
      for (const p of picks) {
        const k = `${p.type}:${p.tier}`;
        m.set(k, (m.get(k) ?? 0) + Math.max(0, Math.trunc(p.count)));
      }
    return m;
  }, [loads]);
  const total = [...usedByKey.values()].reduce((a, b) => a + b, 0);

  const slotTotal = (slotId: string) =>
    (loads[slotId] ?? []).reduce((n, p) => n + Math.max(0, Math.trunc(p.count)), 0);

  const bump = (slotId: string, type: TroopType, tier: TroopTier, d: number) => {
    setAutofillInfo(null);
    setLoads((prev) => {
      const cur = (prev[slotId] ?? []).find((p) => p.type === type && p.tier === tier)?.count ?? 0;
      const key = `${type}:${tier}`;
      const usedElsewhere = (usedByKey.get(key) ?? 0) - cur;
      const room = Math.max(0, owned[type][tier] - usedElsewhere);
      let next = Math.max(0, Math.min(room, cur + d));
      // field cap on increases
      if (d > 0 && total >= DEPLOY_CAP) return prev;
      if (d > 0 && total + (next - cur) > DEPLOY_CAP) {
        next = cur + (DEPLOY_CAP - total);
        if (next <= cur) return prev;
      }
      if (next === cur) return prev;
      const rest = (prev[slotId] ?? []).filter((p) => !(p.type === type && p.tier === tier));
      const nextPicks = next > 0 ? [...rest, { type, tier, count: next }] : rest;
      const nextLoads = { ...prev };
      if (nextPicks.length === 0) delete nextLoads[slotId];
      else nextLoads[slotId] = nextPicks;
      return nextLoads;
    });
  };

  const setEntry = (slotId: string, entry: SlotEntry) => {
    if (playId === "custom" && customSlots) {
      setCustomSlots(customSlots.map((s) => (s.id === slotId ? { ...s, entry } : s)));
      return;
    }
    setSlotMeta((prev) => ({ ...prev, [slotId]: { ...prev?.[slotId], entry } }));
  };
  const setSlotName = (slotId: string, nm: string) => {
    if (playId === "custom" && customSlots) {
      setCustomSlots(customSlots.map((s) => (s.id === slotId ? { ...s, name: nm } : s)));
      return;
    }
    setSlotMeta((prev) => ({ ...prev, [slotId]: { ...prev?.[slotId], name: nm } }));
  };
  const setSlotVector = (slotId: string, vector: ManeuverVector) => {
    if (playId === "custom" && customSlots) {
      setCustomSlots(customSlots.map((s) => (s.id === slotId ? { ...s, vector } : s)));
      return;
    }
    setSlotMeta((prev) => ({ ...prev, [slotId]: { ...prev?.[slotId], vector } }));
  };

  const switchPlay = (pid: string) => {
    setPlayId(pid);
    setLoads({});
    setSlotMeta(undefined);
    setCustomSlots(pid === "custom" ? blankSlots() : null);
    setSelectedSlotId(null);
    setAutofillInfo(null);
  };

  const playLocked = play ? (access.find((a) => a.play.id === play.id)?.locked ?? false) : false;
  const autofill = () => {
    if (!play || playLocked) return;
    const res = autoloadSuggested(play, roster);
    setLoads(res.loads);
    setAutofillInfo(res);
  };

  const errors = validateLoads(loads, roster);
  const flatPicks = Object.values(loads).flat();
  const warning = escortWarning(flatPicks);
  const selectedSlot = slots.find((s) => s.id === selectedSlotId) ?? null;

  const draft = (): SavedFormation => ({
    id: editingId ?? `draft-${Date.now()}`,
    name: name.trim() || suggestedFormationName(playId, Date.now()),
    playId,
    locked: false,
    loads,
    slotMeta: (playId === "custom" ? { __slots: customSlots ?? blankSlots() } : slotMeta) as SavedFormation["slotMeta"],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const canSave = total > 0 && errors.length === 0;

  return (
    <div data-testid="formation-builder" className="space-y-3">
      {/* source: play or blank */}
      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Start from</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => switchPlay("custom")}
            data-testid="builder-source-custom"
            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${playId === "custom" ? "border-amber-400/70 bg-amber-500/15 text-white" : "border-zinc-800 bg-zinc-900/60 text-zinc-300"}`}
          >
            ✏️ Blank — custom
          </button>
          {access.map(({ play: p, locked }) => (
            <button
              key={p.id}
              type="button"
              disabled={locked}
              title={locked ? `Requires leader level ${p.minLeaderLevel}` : p.blurb}
              onClick={() => switchPlay(p.id)}
              data-testid={`builder-source-${p.id}`}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40 ${playId === p.id ? "border-amber-400/70 bg-amber-500/15 text-white" : "border-zinc-800 bg-zinc-900/60 text-zinc-300"}`}
            >
              {locked ? `🔒 ${p.name} (L${p.minLeaderLevel})` : p.name}
            </button>
          ))}
        </div>
        {play && <p className="mt-1.5 text-[11px] text-zinc-500">{play.blurb}</p>}
      </div>

      {/* suggested load — the commander's recommendation, one tap */}
      {play && !playLocked && (
        <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/5 p-2.5" data-testid="builder-suggested">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-zinc-400">
              <b className="text-cyan-200">Suggested load</b> — the commander's recommendation for {play.name}, filled from your roster. Tweak anything after.
            </p>
            <button
              type="button"
              onClick={autofill}
              data-testid="builder-autofill"
              className="shrink-0 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-bold text-black"
            >
              ✨ Autofill suggested
            </button>
          </div>
          {autofillInfo && (
            <div className="mt-1.5 space-y-0.5" data-testid="builder-autofill-info">
              {autofillInfo.scaled ? (
                <>
                  <p className="text-[11px] font-semibold text-amber-200">
                    Scaled to your roster — {autofillInfo.loadedTotal} of {autofillInfo.suggestedTotal} troops. {deficitHeadline(autofillInfo.deficits)} for the full play.
                  </p>
                  {autofillInfo.deficits.slice(0, 4).map((d) => (
                    <p key={`${d.slotId}-${d.type}`} className="text-[11px] text-zinc-500">
                      {d.slotName}: need +{d.missing} {TYPE_NAME[d.type]}{d.missing === 1 ? "" : "s"}
                    </p>
                  ))}
                  {autofillInfo.deficits.length > 4 && (
                    <p className="text-[11px] text-zinc-600">+{autofillInfo.deficits.length - 4} more shortfalls</p>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-emerald-200">Fielded in full — {autofillInfo.loadedTotal} troops, as suggested. ⚔️</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* diagram — tap a slot to load it */}
      <FormationDiagram
        play={play ?? null}
        formation={playId === "custom" ? ({ playId, loads, slotMeta: { __slots: customSlots ?? blankSlots() } } as unknown as SavedFormation) : null}
        loads={loads}
        selectedSlotId={selectedSlotId}
        onSlotTap={(id) => setSelectedSlotId((s) => (s === id ? null : id))}
      />
      {!selectedSlot && (
        <p className="text-[11px] text-zinc-500">Tap a slot on the diagram to load troops into it.</p>
      )}

      {/* slot inspector */}
      {selectedSlot && (
        <div className="rounded-xl border border-amber-400/30 bg-black/60 p-3" data-testid="slot-inspector">
          <div className="flex items-center gap-2">
            <input
              value={selectedSlot.name}
              onChange={(e) => setSlotName(selectedSlot.id, e.target.value.slice(0, 40))}
              aria-label="Slot name"
              className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-bold text-white"
            />
            <select
              value={selectedSlot.vector}
              onChange={(e) => setSlotVector(selectedSlot.id, e.target.value as ManeuverVector)}
              aria-label="Slot vector"
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
            >
              {VECTORS.map((v) => (
                <option key={v} value={v}>{VEC_NAME[v]}</option>
              ))}
            </select>
            <span className="shrink-0 text-[11px] font-bold text-amber-200">{slotTotal(selectedSlot.id)} troops</span>
          </div>

          {/* entry timing */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Slot entry timing">
            {(
              [
                { kind: "start", label: "Touchdown" },
                { kind: "delayed", label: "Delayed" },
                { kind: "oncall", label: "On-call 🪂" },
              ] as const
            ).map((o) => {
              const active = selectedSlot.entry.kind === o.kind;
              return (
                <button
                  key={o.kind}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() =>
                    setEntry(
                      selectedSlot.id,
                      o.kind === "start" ? { kind: "start" } : { kind: o.kind, atS: selectedSlot.entry.kind === o.kind ? selectedSlot.entry.atS : o.kind === "delayed" ? 300 : 240 },
                    )
                  }
                  className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold ${active ? "border-cyan-400/70 bg-cyan-500/15 text-white" : "border-zinc-800 bg-zinc-900/60 text-zinc-400"}`}
                >
                  {o.label}
                </button>
              );
            })}
            {selectedSlot.entry.kind !== "start" && (
              <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                T+
                <input
                  type="number"
                  min={0}
                  max={3600}
                  value={selectedSlot.entry.atS}
                  onChange={(e) => {
                    const atS = Math.max(0, Math.min(3600, Math.trunc(Number(e.target.value) || 0)));
                    setEntry(selectedSlot.id, { kind: selectedSlot.entry.kind, atS } as SlotEntry);
                  }}
                  aria-label="Entry time in seconds"
                  className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[11px] text-white"
                />
                s{selectedSlot.entry.kind === "oncall" ? " (auto)" : ""}
              </label>
            )}
          </div>
          <p className="mt-1 text-[10px] text-zinc-500">
            {selectedSlot.entry.kind === "oncall"
              ? "On-call reserve: you commit it by hand when driving (tap squad → tap map: hot drop). On auto it enters at the preset time."
              : selectedSlot.entry.kind === "delayed"
                ? "Timed wave — enters at the mark, loud."
                : "Enters with the touchdown wave."}{" "}
            {entryLabel(selectedSlot.entry)}
          </p>

          {/* troop steppers */}
          <div className="mt-2 space-y-2">
            {TROOP_TYPES.map((type) => {
              const ownedTotal = TROOP_TIERS.reduce((n, tr) => n + owned[type][tr], 0);
              if (ownedTotal === 0) return null;
              return (
                <div key={type}>
                  <div className="mb-1 text-[11px] font-bold text-zinc-300">{TYPE_NAME[type]}</div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {TROOP_TIERS.map((tr) => {
                      const have = owned[type][tr];
                      if (have === 0) return null;
                      const cur = (loads[selectedSlot.id] ?? []).find((p) => p.type === type && p.tier === tr)?.count ?? 0;
                      const usedElse = (usedByKey.get(`${type}:${tr}`) ?? 0) - cur;
                      return (
                        <div key={tr} className={`rounded-md border px-1.5 py-1 text-center ${cur > 0 ? "border-amber-400/60 bg-amber-500/10" : "border-zinc-800 bg-zinc-900/60"}`}>
                          <div className="text-[10px] font-bold text-zinc-300">
                            T{tr} <span className="font-normal text-zinc-500">×{tierPowerMult(tr)}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-center gap-1">
                            <button type="button" onClick={() => bump(selectedSlot.id, type, tr, -1)} disabled={cur === 0} aria-label={`Remove ${TYPE_NAME[type]} T${tr} from ${selectedSlot.name}`} className="h-6 w-6 rounded-md border border-zinc-700 text-sm text-zinc-300 disabled:opacity-30">−</button>
                            <span className="w-7 text-center text-xs font-bold text-white">{cur}</span>
                            <button type="button" onClick={() => bump(selectedSlot.id, type, tr, 1)} disabled={usedElse + cur >= have || total >= DEPLOY_CAP} aria-label={`Add ${TYPE_NAME[type]} T${tr} to ${selectedSlot.name}`} className="h-6 w-6 rounded-md border border-zinc-700 text-sm text-zinc-300 disabled:opacity-30">+</button>
                          </div>
                          <div className="mt-0.5 text-[10px] text-zinc-500">own {have}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* totals + warnings */}
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <span>Loaded <b className="text-white">{total}</b> / {DEPLOY_CAP}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${Math.min(100, (total / DEPLOY_CAP) * 100)}%` }} />
        </div>
      </div>
      {errors.map((e) => (
        <p key={e} className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-2 text-[11px] text-rose-200">⚠️ {e}</p>
      ))}
      {warning && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">⚠️ {warning}</p>
      )}

      {/* name + actions */}
      <div>
        <label htmlFor="builder-formation-name" className="mb-1 block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
          Formation name
        </label>
        <input
          id="builder-formation-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          placeholder={suggestedFormationName(playId, Date.now())}
          maxLength={40}
          data-testid="builder-formation-name"
          className="w-full rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onTest(draft(), grade)}
          disabled={!canSave}
          data-testid="builder-test"
          className="rounded-lg border border-cyan-400/50 bg-cyan-500/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-cyan-200 disabled:opacity-40"
        >
          ⚔️ Test in battle
        </button>
        <button
          type="button"
          onClick={() =>
            onSave({ id: editingId, name: name.trim() || suggestedFormationName(playId, Date.now()), playId, loads, slotMeta: (playId === "custom" ? { __slots: customSlots ?? blankSlots() } : slotMeta) as SavedFormation["slotMeta"], locked: true })
          }
          disabled={!canSave}
          data-testid="builder-save"
          className="rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-black disabled:opacity-40"
        >
          📚 Save in war room
        </button>
        <div className="ml-auto flex items-center gap-1.5" role="radiogroup" aria-label="Chorus defense grade">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">vs</span>
          {GRADES.map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={g === grade}
              onClick={() => setGrade(g)}
              className={`rounded-md border px-2 py-1.5 text-[11px] font-bold ${g === grade ? "border-amber-400/70 bg-amber-500/15 text-white" : "border-zinc-800 bg-zinc-900/60 text-zinc-500"}`}
            >
              G{g}
            </button>
          ))}
        </div>
      </div>
      {!canSave && total === 0 && (
        <p className="text-[11px] text-zinc-500">Load troops into the slots to test or save.</p>
      )}
    </div>
  );
}
