// SegmentedControl — rung-1 §B primitive (44px tablist).
//
// Extracted from CircuitTab's Map|World tablist with zero behavior change,
// then hardened per §B: role=tablist / role=tab / aria-selected, roving
// tabindex (active tab = 0, others = −1), arrow-key + Home/End navigation,
// 44px hit target, ember active fill, reduced-motion-safe (transition-colors
// is zeroed by the global A.5 media query). A third segment (Battles) can be
// added later by passing a longer `options` array — nothing else changes.
import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface SegmentedOption {
  id: string;
  label: string;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel,
  className = "",
}: {
  options: SegmentedOption[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const moveFocus = (from: number, delta: number) => {
    const next = options[(from + delta + options.length) % options.length];
    refs.current[next.id]?.focus();
    // ARIA tabs pattern: moving focus selects the segment (same behavior as
    // the previous click-only version, plus keyboard parity).
    onChange(next.id);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(i, -1);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(i, 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      refs.current[options[0].id]?.focus();
      onChange(options[0].id);
    } else if (e.key === "End") {
      e.preventDefault();
      refs.current[options[options.length - 1].id]?.focus();
      onChange(options[options.length - 1].id);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex w-fit rounded-lg border border-white/15 bg-black/30 p-0.5 text-xs font-semibold ${className}`}
    >
      {options.map((o, i) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[o.id] = el;
            }}
            role="tab"
            id={`seg-tab-${o.id}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              active ? "bg-ember text-black" : "text-text-2 hover:text-white"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}