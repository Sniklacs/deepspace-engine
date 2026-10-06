// DeployLoadoutPicker — the muster picker for "Deploy my loadout".
//
// Hans picks HIS force from his real tiered barracks roster: type × tier
// cells with owned counts and steppers, capped by what he owns and the
// 100-unit field cap. Bloodless: the picker only READS the roster —
// deploying changes nothing about his troops.

import { useMemo, useState } from "react";
import {
  TROOP_TIERS,
  TROOP_TYPES,
  rosterByTier,
  tierPowerMult,
  type TroopRoster,
  type TroopTier,
  type TroopType,
} from "../../game/war/troops";
import {
  CHORUS_GRADES,
  DEFAULT_CHORUS_GRADE,
  DEPLOY_CAP,
  escortWarning,
  picksCount,
  picksPower,
  picksReverb,
  previewGarrisonReverb,
  type ChorusGrade,
  type DeploymentPick,
} from "../../game/war/deploy-loadout";

const GRADES: ChorusGrade[] = [1, 2, 3, 4, 5];

const TROOP_ART: Record<TroopType, string> = {
  bulwark: "/art/troops/bulwark.webp",
  reaver: "/art/troops/reaver.webp",
  longeye: "/art/troops/longeye.webp",
  thunder: "/art/troops/thunder.webp",
  warden: "/art/troops/warden.webp",
};

const TYPE_NAME: Record<TroopType, string> = {
  bulwark: "Bulwark",
  reaver: "Reaver",
  longeye: "Longeye",
  thunder: "Thunder",
  warden: "Warden",
};

type PickState = Record<TroopType, Record<TroopTier, number>>;
const emptyPicks = (): PickState => ({
  bulwark: { 1: 0, 2: 0, 3: 0, 4: 0 },
  reaver: { 1: 0, 2: 0, 3: 0, 4: 0 },
  longeye: { 1: 0, 2: 0, 3: 0, 4: 0 },
  thunder: { 1: 0, 2: 0, 3: 0, 4: 0 },
  warden: { 1: 0, 2: 0, 3: 0, 4: 0 },
});

export function DeployLoadoutPicker({
  roster,
  onDeploy,
  onCancel,
}: {
  roster: TroopRoster;
  onDeploy: (picks: DeploymentPick[], grade: ChorusGrade) => void;
  onCancel: () => void;
}) {
  const owned = useMemo(() => rosterByTier(roster), [roster]);
  const [sel, setSel] = useState<PickState>(emptyPicks);
  const [grade, setGrade] = useState<ChorusGrade>(DEFAULT_CHORUS_GRADE);

  const toPicks = (s: PickState): DeploymentPick[] => {
    const out: DeploymentPick[] = [];
    for (const t of TROOP_TYPES)
      for (const tr of TROOP_TIERS) {
        const count = s[t][tr];
        if (count > 0) out.push({ type: t, tier: tr, count });
      }
    return out;
  };
  const picks = toPicks(sel);
  const total = picksCount(picks);
  const power = picksPower(picks);
  const warning = escortWarning(picks);
  // The grade dial: how hard a fight Hans wants. The enemy reverb is
  // computed from the actual garrison the deploy will build — the number
  // he sees is the number he fights.
  const myReverb = picksReverb(picks);
  const foeReverb = previewGarrisonReverb(picks, grade);
  const spec = CHORUS_GRADES[grade];

  const bump = (type: TroopType, tier: TroopTier, d: number) => {
    setSel((s) => {
      const cur = s[type][tier];
      const next = Math.max(0, Math.min(owned[type][tier], cur + d));
      // Field cap: only allow increases while under it.
      const totalNow = picksCount(toPicks(s));
      if (d > 0 && totalNow >= DEPLOY_CAP) return s;
      if (d > 0 && totalNow + (next - cur) > DEPLOY_CAP) {
        const allowed = DEPLOY_CAP - totalNow;
        if (allowed <= 0) return s;
        return { ...s, [type]: { ...s[type], [tier]: cur + allowed } };
      }
      if (next === cur) return s;
      return { ...s, [type]: { ...s[type], [tier]: next } };
    });
  };

  const maxAll = () => {
    const s = emptyPicks();
    let room = DEPLOY_CAP;
    for (const t of TROOP_TYPES)
      for (const tr of TROOP_TIERS) {
        const take = Math.min(owned[t][tr], room);
        s[t][tr] = take;
        room -= take;
      }
    setSel(s);
  };

  return (
    <div
      className="rounded-xl border border-amber-400/30 bg-black/70 p-4"
      data-testid="deploy-picker"
      role="dialog"
      aria-label="Deploy my loadout — muster picker"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-amber-200">⚔️ Deploy my loadout</h4>
          <p className="mt-0.5 text-xs text-zinc-400">
            Your real troops march onto the field — types, tiers, counts, straight from your barracks.
          </p>
          <p className="mt-1 text-[11px] font-semibold text-emerald-300">
            🕊️ Practice deployment — no troops lost, your roster is untouched.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close muster picker"
          className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-white"
        >
          ✕
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
        <span>
          Fielded <b className="text-white">{total}</b> / {DEPLOY_CAP}
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-amber-400 transition-all"
            style={{ width: `${Math.min(100, (total / DEPLOY_CAP) * 100)}%` }}
          />
        </div>
        <span>
          Power <b className="text-amber-200">{Math.round(power).toLocaleString()}</b>
        </span>
      </div>

      {/* grade dial — how hard a fight do you want? */}
      <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
            Chorus defense
          </span>
          <span className="text-[11px] text-zinc-500">
            You <b className="text-amber-200">{myReverb.toLocaleString()}</b>
            {" vs "}
            <b className="text-rose-300">{foeReverb.toLocaleString()}</b> reverb
          </span>
        </div>
        <div className="mt-1.5 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Chorus defense grade">
          {GRADES.map((g) => {
            const s = CHORUS_GRADES[g];
            const active = g === grade;
            return (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setGrade(g)}
                data-testid={`deploy-grade-${g}`}
                className={`rounded-md border px-1 py-1.5 text-center ${
                  active
                    ? g >= 4
                      ? "border-rose-400/70 bg-rose-500/15"
                      : "border-amber-400/70 bg-amber-500/15"
                    : "border-zinc-800 bg-zinc-900/60"
                }`}
              >
                <div className={`text-[11px] font-bold ${active ? "text-white" : "text-zinc-400"}`}>
                  G{g}
                </div>
                <div className={`text-[10px] ${active ? "text-zinc-200" : "text-zinc-500"}`}>{s.name}</div>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-400">{spec.blurb}</p>
        {spec.hint && <p className="mt-0.5 text-[11px] font-semibold text-rose-300">{spec.hint}</p>}
      </div>

      <div className="mt-3 space-y-2">
        {TROOP_TYPES.map((type) => {
          const ownedTotal = TROOP_TIERS.reduce((n, tr) => n + owned[type][tr], 0);
          if (ownedTotal === 0) return null;
          return (
            <div key={type} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
              <div className="flex items-center gap-2">
                <img
                  src={TROOP_ART[type]}
                  alt=""
                  aria-hidden="true"
                  className="h-9 w-9 rounded-md border border-zinc-700 object-cover"
                />
                <span className="text-xs font-bold text-white">{TYPE_NAME[type]}</span>
                <span className="ml-auto text-[11px] text-zinc-500">own {ownedTotal}</span>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {TROOP_TIERS.map((tr) => {
                  const have = owned[type][tr];
                  if (have === 0) return null;
                  const cur = sel[type][tr];
                  return (
                    <div
                      key={tr}
                      className={`rounded-md border px-1.5 py-1 text-center ${
                        cur > 0 ? "border-amber-400/60 bg-amber-500/10" : "border-zinc-800 bg-zinc-900/60"
                      }`}
                      data-testid={`deploy-cell-${type}-${tr}`}
                    >
                      <div className="text-[10px] font-bold text-zinc-300">
                        T{tr} <span className="font-normal text-zinc-500">×{tierPowerMult(tr)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => bump(type, tr, -1)}
                          disabled={cur === 0}
                          aria-label={`Remove one ${TYPE_NAME[type]} T${tr}`}
                          className="h-6 w-6 rounded-md border border-zinc-700 text-sm text-zinc-300 disabled:opacity-30"
                        >
                          −
                        </button>
                        <span className="w-7 text-center text-xs font-bold text-white">{cur}</span>
                        <button
                          type="button"
                          onClick={() => bump(type, tr, 1)}
                          disabled={cur >= have || total >= DEPLOY_CAP}
                          aria-label={`Add one ${TYPE_NAME[type]} T${tr}`}
                          className="h-6 w-6 rounded-md border border-zinc-700 text-sm text-zinc-300 disabled:opacity-30"
                        >
                          +
                        </button>
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

      {warning && (
        <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
          ⚠️ {warning}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={maxAll}
          className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-zinc-500"
        >
          Max all
        </button>
        <button
          type="button"
          onClick={() => setSel(emptyPicks())}
          className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:border-zinc-500"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => onDeploy(picks, grade)}
          disabled={total === 0}
          data-testid="deploy-confirm"
          className="ml-auto rounded-lg bg-amber-500 px-5 py-2 text-xs font-bold uppercase tracking-wider text-black disabled:opacity-40"
        >
          Deploy {total > 0 ? `(${total})` : ""}
        </button>
      </div>
    </div>
  );
}
