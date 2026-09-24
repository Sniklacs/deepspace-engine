# Code Workflow

<!-- managed:linked-repos -->
## Linked Repositories
- Sniklacs/deepspace-engine
<!-- /managed:linked-repos -->

## Default Process
1. Members push code to feature branches and create pull requests
2. The team lead reviews and merges PRs
3. Before starting new work, members should pull the latest default branch so they branch from up-to-date code
4. **Commit as you go.** Long runs get killed mid-session; work that is only in the working tree is work that is lost. Commit early, push often.
5. **End every session on `main` with a clean tree** (`git status` empty). The next member starts from whatever you left.

## The two working trees (read this before copying files)

| | path | what it is |
|---|---|---|
| **Clone** | `/home/engine/dse` | the git repo root. The app lives in the **`site/`** subdirectory (`site/src/…`, `site/package.json`). The repo root also holds `design/`, `research/`, `skills/` and the `*-tests/` suites. |
| **Served tree** | `/home/team/shared/site` | **NOT a git repo.** A flattened union: the app's files sit at its *top level* (`src/`, `package.json`, `vite.config.ts`, `dist/`, `node_modules/`, `routeTree.gen.ts`) **plus** copies of the repo's extras (`design/`, `*-tests/`, `WORKFLOW.md`). Every test suite and the browser pass read absolute paths under here. |

The dev server (port 3000) and the full battery both run against the **served tree**.

### Syncing clone → served (the only safe direction)

```bash
# app files (the usual sync):
rsync -a --exclude node_modules --exclude dist /home/engine/dse/site/ /home/team/shared/site/
# docs, if you changed them:
rsync -a /home/engine/dse/design/ /home/team/shared/site/design/
```

**Never rsync the repo root onto the served tree, and never use `--delete` against
`/home/team/shared/site`.** The repo root has no top-level `src/` or `package.json`, so
`rsync -a --delete /home/engine/dse/ /home/team/shared/site/` deletes the app's own files
and leaves the served tree unbuildable. (Happened once, 2026-09-24; the recovery is to
re-run the app sync above and then re-run the battery — no git history was harmed, because
the served tree is not tracked by git.)

Verify a sync before you test or trust it:

```bash
cd /home/engine/dse && while read -r f; do rel="${f#site/}"; \
  cmp -s "$f" "/home/team/shared/site/$rel" || echo "DIFFERS: $rel"; done < <(git ls-files site)
# no output = served tree matches the clone exactly
```

### Working-tree wipe

If `git status` in the clone suddenly shows dozens of ` D site/…` entries, the filesystem
dropped the tree out from under git. Run **`git restore .`** and carry on — never commit
those deletions.

## Tests

Run from the suite's own directory, with the database var unset so the filesystem backend is used:

```bash
cd /home/team/shared/prologue-tests && env -u DATABASE_URL bun run voice-verify.ts
```

Suites: `prologue-tests` (voice 274 · tutorial 141 · act1-entry 109 · prologue 47 · decision-panel 116),
`shell-tests` 113 · `wcag-tests` 127 · `atlas-tests` 727 · `battle-tests` 153 · `armory-tests` 72 ·
`heroes-tests` 103 · `daily-tests` 113 · `leader-xp-tests` 44 · `monetization-tests` 161 ·
`race-lock-tests` 32 · `revelation-tests` 107 · `contribution-tests` 31. Build gate: `bun run build` in
the served tree, exit 0.

## Notes
- The team lead can update this file to reflect the owner's preferences (outside the managed block above, which is overwritten when the owner changes the allow-listed repositories)
- If the owner provides specific instructions about code review, branch strategy, or merge policies, update this document accordingly
- Every repository member reads `CLAUDE.md`/`AGENTS.md` in the repo before working (see those files for stack and conventions)
