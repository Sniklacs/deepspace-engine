// CommsBubbles — the field-report stack (owner 2026-10-06): persistent
// conversation bubbles — source tag + message — phone-thumb-tappable,
// stacked top-edge down so they never cover the fighting. A bubble stays up
// until tapped; the tap is the confirmed read and it dismisses into the
// full log. Critical alerts pulse. Shared by both scene variants: the
// embedded panel rides its canvas wrap, the fullscreen scene rides under
// the header overlay — the comms themselves are identical.

import type { CSSProperties } from "react";
import { commsView, type CommsBubble } from "../../game/war/battle-comms";

export function CommsBubbles({
  comms,
  onDismiss,
  className = "",
  style,
}: {
  comms: CommsBubble[];
  /** bubble id → confirmed read (dismiss into the log) */
  onDismiss: (id: number) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const v = commsView(comms);
  if (v.unread === 0) return null;
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center gap-1.5 px-3 ${className}`}
      style={style}
      aria-live="polite"
      aria-label="Battle comms"
    >
      <div className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/70 px-2.5 py-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Comms</span>
        <span
          className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold tabular-nums text-black"
          data-testid="comms-unread-badge"
        >
          {v.unread}
        </span>
      </div>
      {v.shown.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onDismiss(b.id)}
          data-testid={`comms-bubble-${b.id}`}
          aria-label={`${b.source}: ${b.message}. Tap to confirm read.`}
          className={`pointer-events-auto w-full max-w-[420px] rounded-xl border px-3 py-2.5 text-left shadow-lg backdrop-blur transition active:scale-[0.98] ${
            b.critical
              ? "animate-pulse border-amber-400/70 bg-amber-950/85"
              : "border-white/15 bg-black/70"
          }`}
        >
          <span
            className={`block text-[10px] font-bold uppercase tracking-[0.18em] ${
              b.critical ? "text-amber-300" : "text-cyan-300"
            }`}
          >
            {b.source}
          </span>
          <span className="block text-[13px] leading-snug text-zinc-100">{b.message}</span>
          <span className="mt-0.5 block text-[10px] text-zinc-500">tap to confirm ✓</span>
        </button>
      ))}
      {v.overflow > 0 && (
        <div className="rounded-full border border-white/15 bg-black/70 px-3 py-1 text-[11px] font-bold text-zinc-300">
          +{v.overflow} more
        </div>
      )}
    </div>
  );
}
