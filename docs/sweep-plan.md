# Sweep plan: 14 tickets from the October 2026 review

A full read of the code on 3 October 2026 found the tickets below. Each is cut
into two or three parts, and a part is done only when its own test passes. The
tickets are ordered so that nothing depends on a part that comes later.

Branch: `fix/sweep-tickets`. Vedant reviews, stages and commits.

## Practice for this sweep

Dev and QA work as one loop: QA writes the failing case, dev makes it pass,
and QA then tries to break the fix before it is called done.

1. **Reproduce first.** Every ticket opens with a test that fails on master
   and names the ticket (`SES-n`). The fix may not edit that test to fit;
   `test/capture-bugs.test.ts` is the spec for SES-2, SES-5 and SES-6 and is
   read, never changed.
2. **Strict over permissive.** Where the code cannot tell, the answer is
   `unknown` or `ask`, never silence and never a nought. An extra path makes
   the write check stricter; a missing one lets a write through unseen.
3. **The invariants are a checklist, not background.** For each part, ask:
   is anything fixed at creation now patchable (1)? Does anything leave the
   machine (2)? Is a model judging anything (3)? Is an unknown shown as a
   nought (4)? Is a tool named in the core (5)? Can the check now emit `allow`
   or fail open (6)?
4. **Old records are never backfilled.** A new field is optional. What its
   absence means is written down where the field is defined, and every reader
   goes through one function that says it.
5. **Small modules.** No file over 200 lines may grow (`npm run check:size`).
   New logic goes in a new pure module, and side effects stay in `commands/`
   and `store/`.
6. **Docs move with behaviour.** README, `docs/agreements.md` and
   `docs/decisions.md` change in the same change as the code they describe.
7. **Done means run.** Typecheck, `check:size` and the full suite pass, and
   the handoff reports the exact counts. A targeted run is not a full run.

## Tickets

### SES-3 · A rename hides the source path (P1)
- **3a** Test: a staged rename puts both paths in `changedFilesSince`.
- **3b** Pass `--no-renames` to the diff.

### SES-10 · NotebookEdit escapes the write check (P3)
- **10a** The parser reads `NotebookEdit` and its `notebook_path`, and the
  resolver treats it as an edit, or a create where the file is absent.
- **10b** Add it to the matcher. An existing install then reads as needing
  repair, which a reinstall fixes. Update the review screen, README and
  agreements doc.

### SES-4 · Package-manager writes checked at the wrong path (P1)
- **4a** Test: `npm install x` run from `src/` answers ask, not silence.
- **4b** A package-manager command is known only when it runs at the checkout
  root and `package.json` is a regular file there. Anything else is `unknown`.

### SES-11 · PnP and root lifecycle scripts (P3)
- **11a** yarn with `.pnp.cjs` or `.yarnrc.yml` at the root is `unknown`
  (metadata only, no file is read).
- **11b** Document that the root package's own `prepare`/`postinstall`
  scripts are outside the answer, as dependency scripts already are.

### SES-5 · A mixed-model Claude session is priced at one model (P2)
- **5a** The Claude adapter records tokens per model (`cost.modelTokens`),
  leaving out models with no tokens (for example `<synthetic>`).
- **5b** `priceSession` prices each model at its own rate, and
  `mergeCosts` carries the field.
- **5c** Records without the field keep the dominant-model rule. That rule is
  what wrote them.

### SES-6 · A Codex turn crossing the window is all-or-nothing (P2)
- **6a** The rollout keeps each `token_count` with its own timestamp.
- **6b** A turn counts when it started in the window or spent inside it, and
  only its in-window spend is added. The first prompt is still taken only from
  a turn that started inside the window.

### SES-7 · One torn write fails `verify` for good (P2)
- **7a** Test: a cut-short append followed by a good one.
- **7b** `verify` reads a line that does not parse as **torn** when the next
  record is signed and its `prev` names that line exactly. The walk goes on,
  and the line is counted and printed. Unacknowledged garbage is still
  `corrupt`.
- **7c** The reader skips a torn line instead of throwing, so the views keep
  working.

### SES-8 · Stale-lock takeover can fork the chain (P2)
- **8a** The lock file holds its owner's pid, host and a random token.
- **8b** A lock is stale when its owner pid is dead on this host. A lock with
  no owner (from an older version, or another host) falls back to the age
  rule.
- **8c** Takeover renames the stale lock aside and checks that the token
  matches before deleting it. A mismatch puts the lock back and keeps waiting.

### SES-9 · "merged" without a merge (P2)
- **9a** A deletion lands only where the path existed somewhere in the
  default branch's history.
- **9b** A blob lands only when it appears in a default-branch commit that is
  not an ancestor of the session's `startCommit`, so a revert to old content
  is not a landing.
- **9c** Decided, no change: one landed file with the rest lost stays
  `merged`. The verdict already lists `lost`, and a person can `mark` it.

### SES-14 · `--agent` is dead plumbing (found during the sweep)
- **14a** Installers pass `--agent claude-code` or `--agent codex`, one per
  hook file.
- **14b** `start` and `stop` accept `--agent`, and a hook payload on stdin is
  read only when stdin is not a terminal.

### SES-1 · `/clear` closes a declared session and drops its agreement (P1)
Decided 3 October 2026: hooks never close a declared session, and a passive
session is closed only by its own agent.
- **1a** A pure rule `hookMayClose(session, ending)`: declared or primed
  sessions are never closed; `reason: clear` never closes; a passive session
  closes once no attached agent that reports its end is still live. A legacy
  session with no agent ids keeps the old rule.
- **1b** `stop --if-open` records the end of that agent session and applies
  the rule. `session stop` typed by hand is unchanged.
- **1c** README and help: a declared session stays open until `session stop`.

### SES-2 · Concurrent agents are each charged for both (P1)
Decided 3 October 2026: record agent session ids.
- **2a** A passive session's creating record names the agent session that
  opened it (`openedBy`). Each agent start while a session is open appends a
  signed `agentSession` event, and the fold builds `agentSessions` from them.
  Nothing patches the creating record.
- **2b** The capture window takes `agentSessionId`. Claude reads only
  `<id>.jsonl`; Codex reads only `rollout-*-<id>.jsonl`. At `stop`, capture
  runs once per attached id and the results are merged.
- **2c** `cost.capturedBy` is `agent-session` or `window`. Absent means
  `window`, which is how every older record was captured. `week <id> --full`
  says which.

### SES-12 · The suite is red while the bug tests are untracked (P3)
- **12a** Once SES-2, SES-5 and SES-6 land, `capture-bugs.test.ts` passes
  unchanged and can be committed with them.

### SES-13 · Window capture reads every transcript on the machine (P3)
- **13a** A bound capture opens only that session's files, which closes this
  for every session opened under the hooks.
- **13b** The window fallback is unchanged and stays measured-not-assumed: no
  claim about its speed is made here.

## Out of scope, noted

- `sync`, `scan`, `survival`, `debt`, `knowledge`, the HTML and TUI views and
  `keys.ts` were not reviewed in this sweep.

## Status, 3 October 2026

Every part above is done except 13b, which is a note and not a change. The
sweep lands as one commit per ticket, in the order of this plan's
dependencies: SES-3, 10, 4, 11, 5, 6, 7, 8, 9, 14, 2 (with 13), 1, then 12.
Each commit carries its own tests and docs. Typecheck, `check:size` and the
full suite were run at every one of them.

Each fix has a failing case first, and the new tests live in
`test/sweep-*.test.ts`. A fix was seen failing on the old code for SES-3,
SES-4, SES-7 (by the CLI reproduction), SES-14 (by the CLI), and SES-2, SES-5
and SES-6 (`capture-bugs.test.ts`, unchanged). SES-9's tests were written
against the fix and not run against master.

Existing tests changed because they pinned the old behaviour on purpose:
`resolve-shell` (npm from `src/` now asks), `claude-write` (NotebookEdit is no
longer unsupported), `hook` (the matcher, and `--agent` in the start hook),
`outcome` (a landed deletion needs the branch to have had the file) and `stop`
(cost carries `capturedBy`).

Not verified on a live editor: that Claude Code's `/clear` sends `SessionEnd`
with `reason: clear` and a fresh `session_id` on the next `SessionStart`, and
that Codex's hook payload carries `session_id` equal to the rollout's thread
id. Both are handled either way, since a missing or unknown id falls back to
the old rule, but each needs one real run.
