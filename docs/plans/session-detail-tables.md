# Session-detail table tickets

Feature: extend the existing terminal tables to `session week <id> --full` and `--tokens`.
Keep this feature PR in draft until all four tickets are complete. It is based on the stop-summary branch while PR #45 remains open.
Each ticket targets about 200 changed lines and 5–10 minutes. Keep new and touched functions at 20 lines or fewer.
Implement, test and commit one ticket, then stop for review.

- [x] D1 — Declaration and outcome table. Reuse shared table geometry, intent labels and missing-data reasons. Show the full declared intent or captured prompt, source note and recorded times; keep plain output unchanged.
  - Tests: four outcomes, full multiline prompts, unknown/paste-only intent, running sessions, Unicode widths, safe ink, NO_COLOR and pipe compatibility.
- [x] D2 — Full scope and path tables. Retain every declared/proposed path and the existing inside/outside partition without the stop-summary path cap. Make unavailable scope comparison explicit.
  - Tests: each changed path appears once, no missing long paths, literal Unicode wrapping, missing scope, historical proposal and immutable records.
- [x] D3 — Usage, cost and attribution tables. Preserve token completeness, all four counters when requested, model and agent provenance, empty-turn evidence and one combined cost. Keep unknowns distinct from measured zero.
  - Tests: uncaptured/partial/unpriced records, mixed models, shared cost, measured zero, unknown empty turns, and unchanged plain output.
- [ ] D4 — Command integration and final verification. Verify ID/last selection, `--tokens`, terminal destination and 40-column width wiring; run relevant regressions, build, type and size checks plus real-PTY, NO_COLOR and pipe walkthroughs.
  - Record exact checks and test counts. Do not call a targeted run a full-suite run.

This is presentation work: preserve signed records, scope and outcome rules, pricing, command behavior and the brief view. Add no dependencies, prompts, mutations or new commands.

## D1 validation

- Node 24.19.0: 241 targeted tests passed across 10 files: session-declaration-table, terminal, show, intent-source, intent, stop-declaration, stop-cost-table, architecture, inline-architecture and unused.
- Build, type, size and whitespace checks passed. New and touched rendering functions are at most 17 lines.
- Full captured prompts, missing intent reasons, caller-resolved outcomes, recorded times, 40/60/80-column declaration geometry and ANSI/NO_COLOR parity are covered. The plain view retains its existing layout.
- Command-level narrow-terminal wiring is part of D4.

## D2 validation

- Node 24.19.0: 252 targeted tests passed across 11 files: session-path-table, session-declaration-table, terminal, show, intent-source, intent, stop-declaration, stop-cost-table, architecture, inline-architecture and unused. This was not a full-suite run.
- Build, type, size and whitespace checks passed. New and touched rendering functions are at most 12 lines.
- Full scope and historical proposal paths, exact changed/inside/outside counts, uncapped lists, literal Unicode wrapping, missing-scope comparisons, safe ink and record immutability are covered. Legacy pipe rows are unchanged.

## D3 validation

- Node 24.19.0: 285 targeted tests passed across 11 files: session-cost-table, session-path-table, session-declaration-table, terminal, turn-models, pricing, empty, agents, architecture, inline-architecture and unused. This was not a full-suite run.
- Build, type, size and whitespace checks passed. New and touched rendering functions are at most 13 lines.
- Unknown versus measured-zero usage/cost, complete token counters, adapter-aware call counts, combined mixed-model cost, both model provenance sources, capture selection, empty-turn evidence, attribution and price provenance are covered at 40/60/80 columns. Existing plain output remains covered.
- D4 remains pending: command destination/width wiring and final built-CLI walkthroughs.
