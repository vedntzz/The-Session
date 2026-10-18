# Stop-summary table tickets

Feature: carry the existing bordered-table language into interactive `session stop` output.
All four stop-summary tickets are complete; this PR is ready for review. Session-detail tables are a separate feature.

Each coding ticket targets about 200 changed lines and 5–10 minutes of implementation.
Keep new functions at 20 lines or fewer. Split a ticket if it grows beyond that budget.
Implement, test and commit one ticket at a time, then stop for review.

## Tickets

- [x] S1 — Outcome and declaration table. Reuse `fieldTable`, `sessionIntentFields` and the existing outcome ink. Show the caller-resolved outcome and complete declared intent; retain captured-prompt boundaries and reasons for unknown intent. Leave remaining stop sections in their current layout.
  - Tests: 40/60/80-column geometry, ANSI/plain parity, unknown outcome, full and captured intent, missing intent, signed-record immutability, and unchanged pipe/hook behavior.
- [x] S2 — Scope and changed-path tables. Reuse the existing scope comparison and path-summary rules. Keep exact changed/outside counts, explicit missing scope and literal path wrapping; retain the record ID.
  - Tests: scoped/unscoped/captured records, zero and nonzero drift, capped named paths with exact totals, long Unicode paths, and baseline changes recorded by Git.
- [x] S3 — Usage and cost table. Reuse the current measurement and pricing functions. Retain all four token counters, one combined cost and rate provenance. Missing or incomplete evidence stays unknown.
  - Tests: measured zero, uncaptured/partial capture, unpriced models, mixed-model pricing and no shared-cost allocation.
- [x] S4 — Stop-feature verification. Run the relevant command and rendering regressions, build, type and size checks; walk through normal stop in narrow/wide terminals, NO_COLOR, pipes and the editor hook.
  - Evidence: record the exact checks and counts; do not describe a targeted run as a full-suite run.

## Boundaries

This is a presentation change. Preserve command behavior, append-only records, scope/outcome rules and pricing. Add no prompts, mutation actions, dependencies, colours or terminal control sequences. Leave pipe and hook output stable.

## S1 validation

- Node 24.19.0: 241 targeted tests passed across 9 test files, including normal stop, pipe and hook output, baseline-aware diffs, and signed-record integrity checks.
- Build, type, file-size and whitespace checks passed.
- New declaration renderer: 12 lines; stop formatter: 18 lines.

## S2 validation

- Node 24.19.0: 269 targeted tests passed across 12 test files, including exact path counts, full scope, missing comparisons, Unicode wrapping, baseline-aware changes and unchanged pipe/hook behavior.
- Build, type, file-size and whitespace checks passed.
- Drift markers stay attached to long filenames; new and touched rendering functions are at most 15 lines.

## S3 validation

- Node 24.19.0: 279 targeted tests passed across 13 test files, including measured zero, incomplete capture, missing rates, mixed-model totals, 40/60/80-column geometry and unchanged pipe/hook behavior.
- Build, type, file-size and whitespace checks passed.
- Evidence fields reuse existing measurement and pricing functions; the shared fact builder is 11 lines and its renderer is 7 lines.

## S4 validation

- Node 24.19.0: 388 targeted tests passed across 20 files in 80.19 seconds. This was not a full-suite run.
- Exact regression command:
  ```sh
  node node_modules/vitest/vitest.mjs run test/stop.test.ts test/stop-calls.test.ts test/codex-stop.test.ts test/hook-e2e.test.ts test/stop-cost-table.test.ts test/stop-path-table.test.ts test/stop-declaration.test.ts test/stop-confirmation.test.ts test/stop-inline.test.ts test/stop-scope.test.ts test/stop-evidence.test.ts test/home-table.test.ts test/terminal.test.ts test/terminal-text.test.ts test/palette.test.ts test/inline-architecture.test.ts test/architecture.test.ts test/unused.test.ts test/start-form.test.ts test/week-grid.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism --cache=false
  ```
- Built CLI walkthrough: six isolated repositories passed. Real PTYs at 40, 80 and 120 columns retained complete intent, recorded Unicode filenames, exact changed/outside counts and three bounded tables. The 120-column terminal correctly kept the shared 80-column frame cap.
- An 80-column PTY with `NO_COLOR=1` kept its tables without ANSI escapes. Colour-enabled PTYs used styling escapes only, with no cursor movement or screen clearing.
- Piped stop output kept its plain labels and unknown usage/cost; a second normal stop returned the expected error. `stop --if-open` kept exact legacy output and was silent when called again after closure.
- `session verify` passed after each walkthrough. Verification left every log byte unchanged. Rendered paths were compared with the signed record, preserving Git's Unicode spelling.
- `npm run build`, `npm run typecheck`, `npm run check:size` and `git diff --check` passed. All 16 rendering functions in the six feature modules are at most 20 lines. No production-code fixes were required.
