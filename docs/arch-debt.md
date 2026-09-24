# Architecture debt

*24 September 2026.* This is a snapshot of `master` at `011f1f1` plus the uncommitted
`WriteCheckDecision` split. It measures the code against Google's TypeScript
style guide and engineering practices. It reports only what was measured and
changes nothing. The figures below come from `find`, `wc` and `grep` over `src/`.

## Base

- 136 source files, 18,755 lines. 67 test files. On 24 September 2026, 2,227 tests passed.
- The compiler runs with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch` and `verbatimModuleSyntax`.
- There are 2 runtime dependencies (`commander`, `picocolors`) and 3 dev dependencies.
- There are no `any` types, no `@ts-ignore`, no `eslint-disable`, no `var`, no
  namespaces, no default exports and no TODO or FIXME.
- `console.` appears 15 times, all in `cli.ts` and `program/*`, where output belongs.
- Architecture tests enforce import boundaries, for example the one around `src/jev/`.

Overall this is about a B+. The types and tests meet the standard. The debt is
structural, and none of it is a correctness problem.

## Debt, by cost

### 1. Files over the 200-line limit (large)

37 of 136 files are over the limit that `npm run check:size` enforces. The check
only covers files touched since master, so these stay as they are, and each one
needs a split before its next edit.

| Lines | File |
|---:|---|
| 523 | `src/pricing.ts` |
| 443 | `src/render/markdown.ts` |
| 442 | `src/render/terminal/week.ts` |
| 427 | `src/render/pr.ts` |
| 413 | `src/store/read.ts` |
| 403 | `src/store/record.ts` |
| 401 | `src/survival.ts` |
| 395 | `src/commands/verify.ts` |
| 379 | `src/verify.ts` |
| 376 | `src/capture/hook.ts` |
| 355 | `src/render/terminal/session.ts` |
| 335 | `src/commands/settle.ts` |
| 329 | `src/commands/scan.ts` |
| 327 | `src/render/terminal/survival.ts` |
| 323 | `src/render/terminal/text.ts` |
| 295 | `src/outcome.ts` |
| 294 | `src/sync/publish.ts` |
| 293 | `src/render/terminal/week/table.ts` |
| 293 | `src/render/terminal/scan.ts` |
| 291 | `src/store/append.ts` |
| 288 | `src/debt.ts` |
| 280 | `src/program/help.ts` |
| 273 | `src/render/terminal/brief.ts` |
| 261 | `src/keys.ts` |
| 258 | `src/git/blobs.ts` |
| 258 | `src/commands/hook.ts` |
| 256 | `src/render/terminal/debt.ts` |
| 252 | `src/render/html/detail.ts` |
| 252 | `src/commands/week.ts` |
| 234 | `src/scan.ts` |
| 233 | `src/capture/transcript.ts` |
| 232 | `src/commands/start.ts` |
| 228 | `src/render/html/style.ts` |
| 222 | `src/commands/stop.ts` |
| 219 | `src/program/week.ts` |
| 212 | `src/commands/sweep.ts` |
| 209 | `src/commands/survival.ts` |

### 2. No formatter or linter (small; the one-time diff touches every file)

The repo has no formatter or ESLint config. 350 lines are over 100 characters,
and 59 are over 140. Google formats automatically at 80. Some lines chain
several statements, for example `src/render/tui/screen.ts:151`.

### 3. `render/` depends on `commands/` (small)

CLAUDE.md keeps side effects in `commands/` and `store/`, and render code is
pure. These three type imports go the wrong way:

- `src/render/terminal/week.ts:3` imports `SessionFilter` from `commands/week.js`
- `src/render/html/page.ts:4` imports `SessionFilter` from `commands/week.js`
- `src/render/terminal/survival.ts:2` imports `Checked` and `CheckResult` from `commands/survival.js`

The fix is to move these types into a module that both layers import. An
architecture test would stop the problem from coming back.

### 4. Long functions (small to medium)

- `runUi` in `src/commands/ui.ts:27` is 96 lines, mostly an event-loop closure that is hard to test.
- The function at `src/commands/review.ts:60` is 76 lines.

No other top-level function is over 60 lines.

### 5. Non-null assertions (trivial)

- `src/render/tui/screen.ts:151`
- `src/tool-calls.ts:111`

The Google guide discourages `!`.

### Outside the code

`vedantzz-session-0.2.0.tgz` sits in the repo root. It is gitignored, so it
is local clutter only.

## Suggested order

1. Fix #3 and #5, which take an hour or less and carry no risk.
2. Add a formatter and linter (#2), in a commit of its own.
3. Split #1 file by file as each file is next touched, or as a dedicated milestone.
4. Leave #4 until those files are next edited.
