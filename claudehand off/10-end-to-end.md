# Sprint handoff

Updated: 22 September 2026. Implement one milestone, test, stop for Vedant
to review/commit/push. Never stage or commit automatically.

## Current milestone: end-to-end editor run and latency

Complete; waiting for Vedant's review and commit. No product code changed.

### Previously completed

- `d7346f4` [agreement record](01-agreement-record.md), `0b9ffda`
  [review screen](02-agreement-review.md), `36d7f13`
  [decision logic](03-agreement-decisions.md), `da8c993`
  [parser/resolver](04-write-parser-resolution.md), `ff917f7`
  [check command](05-write-check-command.md), `5f51900`
  [checkout binding](06-checkout-binding.md).
- `2c870ec` [enforce install](07-enforce-install.md), `52474c7` docs refresh,
  `64f3c40` [enforce uninstall](08-enforce-uninstall.md), `2b29d61`
  [failure behaviour](09-failure-behaviour.md).

### Done

- Real Claude Code 2.1.280 run (`claude -p`, Haiku, acceptEdits, only
  Read/Edit/Write) in a temporary repo with its own `SESSION_HOME`. The
  agreement was made through the real `--review` screen (actions `["edit"]`,
  sensitive `[".env"]`, policy deny, accept). Result: Edit to `src/a.ts`
  allowed; Write of `notes.txt` blocked with the check's reason; file never
  created. The agent reported the block and did not work around it.
- Whole loop: the user-level `SessionEnd` hook closed the session (1 turn,
  $0.02, all changes inside scope); the passive `SessionStart` hook deferred to
  the declared session; `session verify`: 2 records, intact.
- Latency, 30 fresh processes each: check p50 187 ms, p95 191 ms, allowed and
  denied alike. Bare Node 29 ms, CLI load ~74 ms, the rest git calls and log
  read. 4% of the 5-second deadline.
- `evidence/enforce-e2e.mjs` reproduces all of it (`--no-agent` skips the paid
  step); run once more to confirm: same outcome, same latency.
  `docs/agreements.md` gains a "Measured" section and drops "pending".
- Cost on Vedant's account: about $0.06 across the two agent runs.

### Not covered

`ask` was not exercised: `claude -p` has no one to answer the prompt, so it
needs an interactive session by hand. Shell writes remain unchecked by design.
The `session` on PATH here is `npm link`ed to this checkout; a user with the
published package gets whatever version that is.

## Next milestones — stop and commit after each

1. Interactive `ask` check by hand in a Claude Code session (two minutes).
2. Sprint review and retrospective.

Other outstanding sprint items remain unverified: three-screen prototype,
Claude resize/changelog work in `/Users/vedant/dev-session-ui`, merging hook
research `2a06865` into `docs/decisions.md` (read and applied, not merged),
and external-proposal ingestion scope. No overall completion percentage.
