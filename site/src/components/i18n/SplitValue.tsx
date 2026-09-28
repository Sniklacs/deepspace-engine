// SplitValue — a translated value rendered with its numerals isolated.
//
// THE ONE-LINE CALL SITE for the splitter (`game/i18n/split.ts`). A sink that
// renders a translated sentence through `t(...)` hands the numeral inside that
// sentence to the sentence's own direction — on a Persian line `{n}-day streak`
// re-orders. This component renders the SAME value, cut at its numerals:
//
//   <SplitValue k="cradle.devotionStreak" params={{ n: streak }} />
//
// Every `num` segment becomes `<Bdi dir="ltr" className="num">` (Bdi.tsx, the
// app's own isolation boundary) and every other segment stays plain text, so the
// sentence keeps its own base direction and only the numeral is pinned. It does
// NOT wrap the sentence: `<Bdi dir="ltr">` around a whole translated value forces
// an RTL sentence to LTR, which is the defect §13d-2(b) of i18n-verify names.
//
// `k` and not `key`: `key` is React's own prop and would never reach the
// component.
//
// Language comes from `useLang()`, exactly like `useT()`, so a language change
// re-renders this with the new sentence (and the pre-paint resolve still holds:
// until hydration it renders SOURCE_LANG, matching the server's English HTML).
import { Fragment } from "react";
import { splitValue } from "../../game/i18n/split";
import type { TParams } from "../../game/i18n/types";
import { Bdi } from "../ui/Bdi";
import { useLang } from "./I18n";

export function SplitValue({ k, params }: { k: string; params?: TParams }) {
  const lang = useLang();
  return (
    <>
      {splitValue(lang, k, params).map((s, i) =>
        s.num ? (
          <Bdi key={i} dir="ltr" className="num">
            {s.text}
          </Bdi>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  );
}
