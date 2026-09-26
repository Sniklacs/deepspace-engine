// Bdi.tsx — a name, a handle or a number that must NOT be reordered by the
// sentence around it (chat-mail-spec §3.6 rule 4).
//
// The rule the owner set for this app: never let a value ride inside a translated
// sentence. A translated sentence is one language and one direction; a colony name
// typed in another script, a language endonym, or a signed rate are runs that a
// bidi algorithm will happily re-order into the wrong place — the shipped example
// is an income rate that reads "1.8+" instead of "+1.8".
//
// So the value is a SEPARATE element, and that element is a `<bdi>`: the browser's
// own isolation boundary, which fixes the run's base direction locally and leaves
// the sentence alone. Wrapping it here (rather than writing `<bdi>` at forty call
// sites) makes the rule greppable — grep `Bdi` and you have found every isolated
// value in the app.
//
// `dir` is only for the cases where the run's own direction is known and must be
// stated: a numeral is `dir="ltr"` in every language, because digits do not
// re-order in Persian and a time must not be mirrored.
import type { ReactNode } from "react";

export function Bdi({
  children,
  dir,
  className,
}: {
  children: ReactNode;
  /** "ltr" for numerals and clocks; omit to let the run decide for itself. */
  dir?: "ltr" | "rtl" | "auto";
  className?: string;
}) {
  return (
    <bdi dir={dir} className={className}>
      {children}
    </bdi>
  );
}
