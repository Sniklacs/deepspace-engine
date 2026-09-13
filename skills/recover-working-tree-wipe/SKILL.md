---
name: recover-working-tree-wipe
description: Use when git status suddenly shows dozens of tracked files as deleted (" D path/...") in the shared /home/team/shared working tree — restore them from git instead of committing the deletions.
---

# Recovering from an externally-wiped working tree (shared repo)

## Symptom
- `git status --short` shows many ` D site/...` entries (tracked files missing
  from disk) — sometimes dozens, including `package.json`, `node_modules/` was
  never tracked so it shows nothing but `ls node_modules` fails.
- Happens mid-session with no command of yours explaining it. The tree at
  `/home/team/shared` is shared by every agent session; another session can
  reset/replace the working tree at any time. Files can vanish between a
  successful `bun run build` and your next `git status`.

## Do this (in order)
1. **Never commit the deletions.** `git add -A` + commit at this point would
   write a "delete everything" commit to your branch.
2. First make sure your in-flight work is safe on a pushed branch:
   `git push` anything you already committed. If you have uncommitted changes,
   `git stash` (or just `cp` the few changed files to /tmp).
3. Restore every tracked file from the index:
   `git checkout -- .`  (repo root — restores all ` D` paths; index matches
   HEAD after a normal checkout, so this lands the branch's versions)
4. Verify: `git status --short` should now show only pre-existing untracked
   files (`WORKFLOW.md`, `design/*`, etc.). Remove transient untracked caches
   you created (`rm -rf site/.vite`) if they pollute the status.
5. `node_modules/` is untracked — if it vanished too, rebuild it:
   `cd site && bun install` (~2s, ~140 packages).
6. Re-verify `bun run build` before continuing.
7. Check your pushed branch is intact: `git log origin/<branch> --oneline -1`
   and `git show origin/<branch>:<file>` for one of your changed files.

## Gotchas
- Restoring on `main` after your work lives on a feature branch means the
  working tree gets `main`'s versions of your changed files — that is the
  CORRECT end state (leave the tree on the default branch, clean). Your work
  lives in the pushed branch + PR, not in the working tree.
- The wipe also kills `dist/`, `.vite/`, `public/art` copies only if they were
  untracked — the tracked ones come back from git.
- Check `df -h` first if disk is tight: `bun install` needs ~150 MB.