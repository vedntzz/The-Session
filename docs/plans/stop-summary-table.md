# Stop-summary table tickets

Feature: carry the existing bordered-table language into interactive `session stop` output.
Keep this PR in draft until all four tickets are complete. Session-detail tables are a separate feature.

Each coding ticket targets about 200 changed lines and 5–10 minutes of implementation.
Keep new functions at 20 lines or fewer. Split a ticket if it grows beyond that budget.
Implement, test and commit one ticket at a time, then stop for review.

## Tickets

- [ ] S1 — Outcome and declaration table. Reuse `fieldTable`, `sessionIntentFields` and the existing outcome ink. Show the caller-resolved outcome and complete declared intent; retain captured-prompt boundaries and reasons for unknown intent. Leave remaining stop sections in their current layout.
  - Tests: 40/60/80-column geometry, ANSI/plain parity, unknown outcome, full and captured intent, missing intent, signed-record immutability, and unchanged pipe/hook behavior.
- [ ] S2 — Scope and changed-path tables. Reuse the existing scope comparison and path-summary rules. Keep exact changed/outside counts, explicit missing scope and literal path wrapping; retain the record ID.
  - Tests: scoped/unscoped/captured records, zero and nonzero drift, capped named paths with exact totals, long Unicode paths, and baseline changes recorded by Git.
- [ ] S3 — Usage and cost table. Reuse the current measurement and pricing functions. Retain all four token counters, one combined cost and rate provenance. Missing or incomplete evidence stays unknown.
  - Tests: measured zero, uncaptured/partial capture, unpriced models, mixed-model pricing and no shared-cost allocation.
- [ ] S4 — Stop-feature verification. Run the relevant command and rendering regressions, build, type and size checks; walk through normal stop in narrow/wide terminals, NO_COLOR, pipes and the editor hook.
  - Evidence: record the exact checks and counts; do not describe a targeted run as a full-suite run.

## Boundaries

This is a presentation change. Preserve command behavior, append-only records, scope/outcome rules and pricing. Add no prompts, mutation actions, dependencies, colours or terminal control sequences. Leave pipe and hook output stable.
