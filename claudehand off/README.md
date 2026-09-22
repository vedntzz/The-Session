# Sprint handoff

Updated: 22 September 2026. Work happens one small feature at a time, followed
by tests and a stop for Vedant to review and commit. Codex must not commit.

## Current step: immutable agreement record

**Complete and tested; waiting for Vedant to review and commit.**

Added accepted paths, actions (`create`, `edit`, `delete`), sensitive
paths and policy (`record`, `ask`, `deny`) to the session's creating record.
Reuse the existing signature and hash chain. Preserve the original proposal
apart from accepted terms; label new Prime proposals with their proposer and
read older proposals as `prime` without changing their bytes.

Agreement paths supply the existing measurement scope. Reject mismatches and
later agreement/scope changes. Legacy sessions retain their existing behavior.
No CLI screen, enforcement hook or external-proposal import in this step.

### Changes in this step

- `src/agreement.ts`: pure accepted-term types and validation, scope consistency,
  and the legacy proposer fallback. See `docs/agreements.md` for field semantics.
- `src/store/record.ts`: optional agreement and exclusion from session patches.
- `src/store/read.ts`: copy validated terms into the creating record; preserve
  agreement and its scope when folding subsequent records, including forged
  attempts to insert an agreement into an older session.
- `src/store/append.ts`: refuse agreement patches and scope patches on agreed
  sessions. Ordinary closing/outcome updates still work.
- `src/commands/start.ts`: accept explicit agreement terms through the API;
  populate measurement scope from accepted paths and reject disagreement.
- `src/prime.ts`: label newly generated proposals `prime`. Existing proposals
  without the field retain their original signed representation.
- `test/agreement.test.ts`: validation, signed round-trip, immutability,
  compatibility, original-versus-accepted scope and tamper-detection coverage.
- `test/start.test.ts`: start API integration and scope mismatch coverage.
- `docs/context.md`: regenerated from the current source using the repository
  generator; includes the new session field and actual test results.

No dependency added, record-version bump, data migration, signing-algorithm
change, user settings change, commit, push, PR or worktree cleanup.

### Completed validation

- Accepted terms round-trip through the signed log.
- Invalid inputs write no record.
- Later patches cannot add, replace or remove an agreement or change its scope.
- Existing records and signatures still work without an agreement/proposer.
- Tampering with accepted terms or proposer breaks verification.
- Build, typecheck and automated regression tests.

### Results and failures

Build and typecheck passed. All 47 agreement tests pass. The first focused
run had 226 passing tests and one normalization failure:
`./` was rejected instead of accepting the explicitly named repository root.
Fixed by preserving `./` as `.` before validation, then reran the agreement
tests successfully. The other six focused suites (start, store, Prime workflow,
Prime rule, chain, verification) passed on their first run.

The first full run finished with **1,483 passed / 1 failed** (45 test files).
The sole failure was the generated `docs/context.md` still carrying the old
`Session` interface. Fixed with `node evidence/gen-context.mjs`, the project's
required generator.

Final verification:

- `npm run build`: passed.
- `npm run typecheck`: passed (source and test TypeScript).
- `npx vitest run test/agreement.test.ts`: 47 passed.
- Generator's non-context suite: 1,476 passed across 44 files.
- Generator's post-write context check: 8 passed.
- **Final total: 1,484 tests passed across 45 files** (the generator checks
  the behavioral and context suites separately). This step adds 49 tests.
- `git diff --check`: passed.

Both failures encountered are resolved. No outstanding failure in this step.
Everything is uncommitted on the existing `master` checkout. Codex stops here;
Vedant reviews and commits, then explicitly asks to begin the next step.

## Remaining sprint work

The agreement record is the first of the four remaining build milestones
completed. **Three build milestones remain**, plus the prototype and earlier
integration/housekeeping items below. No completion percentage is claimed for
the whole sprint because the prototype has not been located.

1. Agreement review screen in `session start`, including accepting/replacing
   Prime's suggestion. Decide the external-proposal input and truthful labels
   before exposing external suggestions through a user workflow.
2. Opt-in PreToolUse enforcement for Edit, Write and MultiEdit; map tool input
   to the tool-independent accepted actions and paths. Test policy decisions,
   malformed input, path resolution and timeout behavior.
3. End-to-end flow, hook latency measurement, final review and retrospective.
4. Locate the Saturday three-screen prototype or build it if still missing.
5. Review/integrate Claude's resize fix and changelog changes from
   `/Users/vedant/dev-session-ui` (uncommitted at the initial check).
6. Review/integrate Claude's hook research from `docs/hook-capabilities`
   (`2a06865`, separate worktree `/Users/vedant/dev-session-hook`).

Monday's command consolidation and v1 boundary are already on master at
`224fd81` (PR #3). Prototype completion is unverified. Existing worktrees and
branches are preserved. Commits are Vedant's responsibility; PRs and cleanup
are not performed as part of this record step.
