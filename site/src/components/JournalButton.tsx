// JOURNAL BUTTON — owner 2026-09-13: "The journals can be buttons too that
// just open up — they don't have to be at the bottom scrolling. Just give us a
// button for a journal." One full-width bar per tab that opens the Cradle's
// chronicle (state.log, newest first) in the shared Sheet primitive — the
// bottom-scroll EventLog sections are gone.
import { useState, useId } from "react";
import { Sheet, SheetHeader } from "./Sheet";
import { Icon } from "./icons";

export function JournalButton({
  title,
  subtitle,
  log,
}: {
  title: string;
  subtitle?: string;
  /** The server chronicle (state.log), newest first. */
  log: string[];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="mt-6 flex w-full items-center gap-3 rounded-xl border border-line bg-surf-2/60 px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-surf-4/70"
      >
        <Icon name="scroll" size={18} className="shrink-0 text-ember-soft" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text-1">{title}</span>
          {subtitle ? <span className="block text-xs text-text-3">{subtitle}</span> : null}
        </span>
        <span className="chip shrink-0 border border-line text-text-2">
          <b className="num">{log.length}</b> {log.length === 1 ? "entry" : "entries"}
        </span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} labelledBy={id} title={title}>
        <SheetHeader id={id} title={title} subtitle={subtitle} onClose={() => setOpen(false)} />
        <div className="sheet-body px-4 py-3 md:px-5">
          {log.length === 0 ? (
            <p className="text-sm text-text-3">The chronicle is quiet — the Cradle has not stirred yet.</p>
          ) : (
            <ul className="space-y-2">
              {log.map((l, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-line-faint bg-surf-2/50 px-3 py-2 text-xs leading-relaxed text-text-2"
                >
                  {l}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>
    </>
  );
}