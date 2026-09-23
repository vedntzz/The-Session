# Sprint handoff

Updated: 22 September 2026. Implement one milestone, test, stop for Vedant
to review/commit/push. Never stage or commit automatically.

## Current milestone: Sprint 2, Sat 26 — package-manager recognition

Complete and tested; waiting for Vedant's review and commit. Pure code, not
wired to the hook: `Bash` is not in the matcher yet.

Sprint plan: `~/Downloads/the-session-sprint-plan (1).pdf`. Sprint 1 is
reviewed in `docs/sprint-1-review.md` (`50a4fa4`); earlier handoffs are
archived as `01`–`13` beside this file.

### Solved

- `src/shell/words.ts` — `simpleWords(command)`: the words of one simple
  command, or undefined. Single quotes literal; double quotes only when nothing
  inside can expand. Refuses chains, pipes, redirects, `$`/backtick
  substitution, globs, braces, `~`, `!`, `#`, backslashes, newlines and a
  leading `NAME=value`. Reused by Sunday's parseable writers.
- `src/shell/package-manager.ts` — `packageManagerWrites(command)`:
  `{ kind: "writes", paths }` relative to the command's directory, or
  `{ kind: "unknown" }`.
  - npm → `package.json`, `package-lock.json`; pnpm → `pnpm-lock.yaml`;
    yarn → `yarn.lock` (bare `yarn` is install).
  - add/remove with packages → manifest + lock; install without packages →
    lock; update → manifest + lock (versions differ, so the extra file is
    listed); `npm ci`, `--frozen-lockfile`, `--immutable`, `npm --no-save` →
    no tracked files.
  - Unknown: any flag outside each manager's list, `-g`/`--global`,
    `--prefix`/`-C`/`--dir`/`--cwd`, workspace/recursive flags, `npm run`,
    `npm test`, `npx`, add/remove with no package, pnpm/yarn install with
    packages, other programs (bun), and prototype names such as `constructor`.
- Stated limits: `node_modules`, caches and dependency install scripts are not
  covered; `npm-shrinkwrap.json` and yarn Plug'n'Play files are not listed.
- Docs: `docs/agreements.md` "Shell commands (not yet checked)", a "Shell
  commands" rules section in the skill (both copies, description extended),
  layout lines in `Claude.md`/`AGENTS.md`, `docs/context.md` regenerated.
  No CHANGELOG entry until it is user-visible.

### Verification

- 58 new tests (`test/package-manager.test.ts`), all passing on first run.
- Build and source/test type checks passed.
- Full suite via the context generator: **1,700 passed across 52 files**, plus
  8 context tests (1,708 total; 1,650 before).

## Next

Sprint 2 in plan order, each a separate step:

1. Sun 27 — parseable writers (`sed -i`, `>`, `tee`, `mv`, `cp`, `rm`) and a
   read-only allowlist, pure, on `simpleWords` (redirects need a small extension).
2. Mon 28 — wire `Bash` into the check: unknown and not allowlisted means
   `ask` with "Can't tell what this writes."; grants scoped to one operation.
3. Tue 29 / Wed 30 (Codex) — starting-tree snapshot; PostToolUse diff per call.

Still owed from Sprint 1 (Vedant): retrospective, three-screen prototype,
interactive `ask` check.
