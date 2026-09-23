# Sprint handoff

Updated: 22 September 2026. Implement one milestone, test, stop for Vedant
to review/commit/push. Never stage or commit automatically.

## Current milestone: Sprint 1 review and parking lot

Complete; waiting for Vedant's review and commit. Docs only.

The sprint plan is `~/Downloads/the-session-sprint-plan (1).pdf`: three
one-week sprints, 19 September to 9 October, to a pilot-ready drift guard.
Every build item in Sprint 1 landed on 22 September; the handoffs so far were
all Sprint 1. Earlier "MVP percentage" answers in chat did not know this plan.

### Previously completed

- `d7346f4` [agreement record](01-agreement-record.md), `0b9ffda`
  [review screen](02-agreement-review.md), `36d7f13`
  [decision logic](03-agreement-decisions.md), `da8c993`
  [parser/resolver](04-write-parser-resolution.md), `ff917f7`
  [check command](05-write-check-command.md), `5f51900`
  [checkout binding](06-checkout-binding.md).
- `2c870ec` [enforce install](07-enforce-install.md), `52474c7` docs refresh,
  `64f3c40` [enforce uninstall](08-enforce-uninstall.md), `2b29d61`
  [failure behaviour](09-failure-behaviour.md), `e2c178a`
  [end-to-end run](10-end-to-end.md), `1260e16`
  [hook research restored](11-hook-research.md), `949ede1`
  [UI resize](12-ui-resize.md).

### Done

- `docs/sprint-1-review.md`: exit condition (met, with how to reproduce it),
  plan against actual by day with commits, measurements, what was not done and
  why, and facts for the retrospective. The retrospective itself is left for
  Vedant.
- `docs/parking-lot.md`: the plan's parking lot did not exist. Created with
  six ideas raised during Sprint 1, each with the step it came from.
- Both files are under `docs/`, which `package.json` publishes to npm.

## Next

1. Vedant: the retrospective section, the three-screen prototype (the
   storyboard PDF may be it), and the two-minute interactive `ask` check.
2. Sprint 2, "the hard edges" (26 September to 2 October), in plan order:
   package-manager recognition (Claude, Sat 26) first — npm, pnpm and yarn
   installs mapped to the manifest and lockfile.

Codex owns screens, snapshots and cleanup in worktree B; Claude owns hooks,
gating and logging in worktree A. Never both in the same files.
