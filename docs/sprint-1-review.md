# Sprint 1 review: prove the core

Saturday 19 to Friday 25 September 2026, against
`the-session-sprint-plan.pdf`. Written Tuesday 22 September, when every build
item in the sprint had landed; Friday's review and retrospective are this file.

**Exit condition: met.** "An edit outside the agreement is stopped in a real
session, shown with real terminal output." In a real Claude Code 2.1.280 run
under a deny agreement accepting only edits under `src/`, the agent's Write of
`notes.txt` was blocked with the check's reason and the file was never
created; its Edit inside `src/` went through. Reproduce it with
`node evidence/enforce-e2e.mjs` — the output is the terminal record.

## Plan against what happened

| Day | Planned | Owner | What happened |
|---|---|---|---|
| Sat 19 | Clickable prototype of the three screens | You | **Not in the repository.** `The Session - Storyboard.pdf` (19 Sep) may be it; unconfirmed |
| Sat 19 | What a Claude Code hook can show | Claude | `2a06865` on `docs/hook-capabilities`; the section was lost from master in `5e89e03` and restored in `1260e16` |
| Sun 20 | Commit the dirty tree, `ui`/`knowledge` changelogs, resize bug | Codex | Changelogs and resize fix left uncommitted in `dev-session-ui`; brought to master in `949ede1` (Tue 22) |
| Mon 21 | Cut commands; CLAUDE.md and decisions.md amended | Codex, You | `5e89e03`, merged as `224fd81` (PR #3) |
| Tue 22 | Agreement record in the signed chain | Claude | `d7346f4` |
| Wed 23 | Agreement screen in `session start`, with Prime | Codex | `0b9ffda` (Tue 22) |
| Thu 24 | PreToolUse hook for Edit, Write, MultiEdit | Claude | `36d7f13` decisions, `da8c993` parser/resolver, `ff917f7` check command, `5f51900` checkout binding, `2c870ec` / `64f3c40` per-repo install and removal, `2b29d61` deadline and exit 2 (all Tue 22) |
| Fri 25 | Real session end to end, latency, review, retro | You | `e2c178a` end to end and latency (Tue 22); this review |

Also landed: `52474c7`, CLAUDE.md, AGENTS.md and the skills brought up to date
with the agreement work, including a new `agreements-and-enforcement` skill.

## Measured

- Tests: 1,497 at the first handoff, **1,650** at `949ede1`, all passing.
- Check latency: p50 187 ms, p95 191 ms per write, allowed or denied — 4% of
  the 5-second deadline. About 30 ms is Node starting and 45 ms loading the
  CLI; the rest is git calls and the log read.
- Agent spend on the end-to-end runs: about $0.06.

## Not done, and why

- **The three-screen prototype.** Owned by you; nothing in git. Confirm
  whether the storyboard is it, or carry it into Sprint 2.
- **An interactive `ask`.** `claude -p` has no one to answer a prompt; a
  two-minute manual run in an interactive session is still owed.
- **Daily close.** The plan asks for one line per day in a build log; none was
  kept. The commit history above is the only record.
- **`docs/parking-lot.md`** did not exist; it does now, with the ideas this
  sprint raised.

## What the week showed (facts, for the retro)

- Four days of planned work landed in one. The one-milestone-then-stop
  handoff (`claudehand off/`) held: every step was reviewed and committed
  separately, 13 commits on 22 September.
- Two pieces of work were lost between branches and only found by reading
  history: the hook research section (removed by a rewrite in PR #3) and the
  Sunday UI fix (never committed). Both came from work done outside master.
- Handoffs once reported a targeted run as if it were a full suite. The
  repo's working rules now require saying which.
- The enforcement design changed under test: a global hook would have denied
  every write outside a repository, so installation became per-repository.
  The host lets a timed-out or crashed hook through, so the check now denies
  on its own clock and exits 2.

## Retrospective

For you to write: what to keep, what to change for Sprint 2, and whether the
prototype moves or is dropped.

## Into Sprint 2

Sprint 2 ("the hard edges", 26 September to 2 October) starts with shell
commands, which Sprint 1 deliberately leaves unchecked. Everything the check
covers today is Edit, Write and MultiEdit.
