// TOGGLE SWITCH — the battle control panel's physical switch (Battle Scene P1).
//
// Hans: "I want toggle switches instead of buttons to push." A skeuomorphic
// switch that throws up/down with a chunky lever, a lit slot, and a clack.
// Pure CSS + a div — no canvas needed, works with keyboard/AT like a switch.

interface Props {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  /** Accent color of the lit slot when ON. */
  accent?: string;
  disabled?: boolean;
}

export function ToggleSwitch({ label, on, onChange, accent = "#f59e0b", disabled = false }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="group flex items-center gap-2.5 outline-none disabled:opacity-40"
    >
      <span
        className="relative h-11 w-7 shrink-0 rounded-md border border-black/60 shadow-[inset_0_2px_6px_rgba(0,0,0,0.85),0_1px_0_rgba(255,255,255,0.08)]"
        style={{
          background: "linear-gradient(180deg,#1b1d24 0%,#101218 60%,#1b1d24 100%)",
          boxShadow: on
            ? `inset 0 2px 8px rgba(0,0,0,0.9), 0 0 10px ${accent}55, 0 1px 0 rgba(255,255,255,0.08)`
            : "inset 0 2px 6px rgba(0,0,0,0.85), 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >
        {/* slot glow */}
        <span
          className="absolute left-1/2 top-1/2 h-8 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-150"
          style={{ background: accent, opacity: on ? 0.9 : 0.18, filter: on ? `blur(1px) drop-shadow(0 0 4px ${accent})` : "none" }}
        />
        {/* the lever */}
        <span
          className="absolute left-1/2 h-4 w-5 -translate-x-1/2 rounded-[4px] border border-black/70 transition-all duration-150 ease-out"
          style={{
            top: on ? "3px" : "calc(100% - 19px)",
            background: "linear-gradient(180deg,#4b5160 0%,#2a2e38 45%,#171a20 100%)",
            boxShadow: "0 2px 4px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22)",
          }}
        >
          <span className="absolute inset-x-1 top-1/2 h-[2px] -translate-y-1/2 rounded bg-black/50" />
          <span className="absolute inset-x-1 top-1/2 mt-[3px] h-[2px] -translate-y-1/2 rounded bg-black/50" />
        </span>
      </span>
      <span className="text-left">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-200">{label}</span>
        <span className="block text-[10px] uppercase tracking-wider" style={{ color: on ? accent : "#71717a" }}>
          {on ? "engaged" : "off"}
        </span>
      </span>
    </button>
  );
}
