# Sprint handoff

Updated: 22 September 2026. Implement one milestone, test, stop for Vedant
to review/commit/push. Never stage or commit automatically.

## Current milestone: timeout and failure behaviour

Complete and tested; waiting for Vedant's review and commit.

### Previously completed

- `d7346f4` [agreement record](01-agreement-record.md), `0b9ffda`
  [review screen](02-agreement-review.md), `36d7f13`
  [decision logic](03-agreement-decisions.md), `da8c993`
  [parser/resolver](04-write-parser-resolution.md), `ff917f7`
  [check command](05-write-check-command.md), `5f51900`
  [checkout binding](06-checkout-binding.md).
- `2c870ec` [enforce install](07-enforce-install.md), `52474c7` docs refresh,
  `64f3c40` [enforce uninstall](08-enforce-uninstall.md).

### Host facts (hooks reference, fetched 22 September 2026)

Exit 2 or a JSON `deny` blocks. A timeout, a non-zero exit without JSON, and
a command that cannot start (e.g. exit 127) all let the write through. JSON on
stdout is read on every exit code. Matching hooks run in parallel; how
conflicting decisions combine is not documented. Consistent with the research
in `2a06865` (`/Users/vedant/dev-session-hook`), which this milestone used.

### Solved

- `CHECK_DEADLINE_MS` (5 s) in `src/commands/check-write.ts`: the check races
  its own work against a deadline and denies with a static reason if the work
  has not finished. Half of `CHECK_HOOK.timeout` (10 s); a test pins the ratio.
- `session hook check` exits 2 with a static stderr reason if anything escapes
  `checkWrite` (previously the top-level handler exited 1, which the host lets
  through). It destroys stdin afterwards so a deadline answer does not wait on
  an open pipe.
- `docs/agreements.md` "When the check cannot answer": a table of each failure
  and what happens, including the one the check cannot close — `session` not
  on the editor's PATH, Node failing to start, or the process being killed.
  CHANGELOG, `CHECK_HOOK` comment and both skill copies updated.

### Verification and failures

- Build and source/test type checks passed.
- Full suite: **1,649 tests passed across 51 files** (1,645 before, +4).
- Real process with stdin held open: denied and exited in 5.1 s, code 0.
  A first shell-pipeline measurement read 30 s because the shell waited for
  the `sleep` feeding the pipe, not for the check; re-measured with a held pipe.
- One trailing blank line in the test file, caught by `git diff --check`, fixed.

### Boundaries

The PATH/startup gap is documented, not closed. Not yet exercised in a running
editor, so real latency is unmeasured; the earlier smoke put one check at about
190 ms, most of it Node starting.

## Next milestones — stop and commit after each

1. End-to-end editor flow, latency checks, sprint review and retrospective.

Other outstanding sprint items remain unverified: three-screen prototype,
Claude resize/changelog work in `/Users/vedant/dev-session-ui`, merging hook
research `2a06865` into `docs/decisions.md` (read and applied, not merged),
and external-proposal ingestion scope. No overall completion percentage.
