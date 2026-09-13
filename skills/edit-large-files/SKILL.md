---
name: edit-large-files
description: Use when EditFile fails on a large source file with "exec command is N bytes, over the 128000-byte guest argv limit" — replace via a python3 heredoc script instead.
---

# Editing large files when EditFile hits the argv limit

## When this happens
The `EditFile` tool wraps its edit in a single `sh -c` argument. Files above
roughly 60–80 KB (e.g. `/home/team/shared/site/src/routes/play.tsx` is ~78 KB)
blow the 128 KB `MAX_ARG_STRLEN` limit with:

```
Error editing file: exec command is 187373 bytes, over the 128000-byte guest argv limit
```

Small files edit fine — only big files need the workaround.

## Workaround — python3 exact-substring replacement
1. Write a heredoc python script (avoids argv limits entirely) that:
   - reads the file as UTF-8,
   - performs exact-string replacements,
   - **requires each pattern to match exactly once** (count == 1) so a typo
     fails loudly instead of silently no-op'ing or double-replacing,
   - writes back.
2. Run it, then re-grep for the old string to prove zero remain.

## Gotchas
- Emoji (🗺️ has a U+FE0F variation selector) can mangle in shell heredocs —
  use `\U0001F5FA\uFE0F`-style escapes in the python source instead of raw
  emoji.
- Some patterns legitimately appear N times (`nodeById(atlas, ` appeared
  twice). Handle those with a separate `src.count + replace-all` pass and
  print how many were replaced.
- After editing, re-verify with `grep -n` so you know exactly what remains,
  and note intentional leftovers (module/API identifiers that must not
  change).

## Example
```bash
cat > /tmp/rename.py <<'PYEOF'
import io
p = "src/routes/play.tsx"
src = io.open(p, encoding="utf-8").read()
repls = [("old exact", "new exact"), ...]
missed = []
for old, new in repls:
    n = src.count(old)
    if n != 1: missed.append((old[:60], n)); continue
    src = src.replace(old, new)
io.open(p, "w", encoding="utf-8").write(src)
print("applied", len(repls) - len(missed), "of", len(repls))
for m, n in missed: print("MISSED(count=%d): %r" % (n, m))
PYEOF
python3 /tmp/rename.py
```