# Sprint handoff

Updated: 22 September 2026. One small feature at a time: implement, test, stop
for Vedant to review and commit. Codex must not commit or start the next
feature until Vedant asks.

## Current step: pure agreement decisions

**Complete, committed and pushed by Vedant as `36d7f13`.**

The agreement record is committed as `d7346f4`; the review screen is committed
as `0b9ffda`. Their full handoffs are preserved:

- [Agreement record](01-agreement-record.md)
- [Agreement review screen](02-agreement-review.md)

### Solved

- Added a pure, tool-independent decision function for an attempted file write.
- No agreement, or a write within accepted terms: `defer`, retaining the
  editor's own permissions. It never grants permission or overrides them.
- Outside accepted paths, unaccepted action, or sensitive path: return the
  agreed `ask` or `deny` response. Under `record`, defer while retaining
  all mismatches.
- Sensitive paths still apply within an accepted scope, including whole-repo
  scope. Both accepted and sensitive paths use the existing directory-boundary
  matching rule.
- Preserve every mismatch in stable order. No claim that a write happened,
  no log append, and no changed measurement.
- Reject malformed terms, unknown actions, and unresolved or ambiguous paths
  when evaluating an agreement. No guessing about filesystem paths.

### Files in this step

- `src/agreement-decision.ts`: types and pure decision logic.
- `test/agreement-decision.test.ts`: 33 new focused tests.
- `docs/agreements.md`: decision behavior, adapter contract and current limits.
- This handoff and the archived review-step handoff.

### Tests and failures

- `npm run build`: passed.
- `npm run typecheck`: passed for source and tests.
- Focused verification: **88 passed across 3 files**:
  33 decision tests, 47 agreement/storage tests, 8 generated-context checks.
- `git diff --check`: passed.
- No implementation or test failures encountered in this step.
- The full suite was not rerun for this isolated, unwired pure module. The
  preceding review step passed 1,505 tests; that is a prior result, not a
  full-suite result for this working tree.

### Current limits

Nothing intercepts an editor tool call yet. The decision function accepts
resolved repository-relative file paths; it does not query files, resolve
symlinks, identify a tool's action, print hook JSON or install a hook.
Invalid-input errors still require explicit handling in the adapter.
The review screen correctly continues to say policy is recorded only.

Codex left this step uncommitted; Vedant reviewed, committed and pushed it as
`36d7f13`, then requested the parser/resolver step. This file preserves that
step's handoff; see [README.md](README.md) for current status.

## Remaining sprint work

The enforcement milestone is split into small steps:

1. **Next:** adapt tool requests and resolve target paths for Edit, Write and
   MultiEdit, including create-versus-edit, symlinks, outside-repo targets and
   malformed inputs. Keep this separately testable.
2. Wire decisions into a PreToolUse command and opt-in hook installation.
   Respect the editor's permission model, handle errors explicitly, verify
   timeout behavior, and update recorded-only wording when enforcement exists.
3. End-to-end flow, actual hook latency checks, final review and retrospective.

Other outstanding items:

- Locate/confirm the Saturday three-screen prototype, or build it if missing.
- Review/integrate Claude's resize fix and changelog work in
  `/Users/vedant/dev-session-ui`.
- Review/integrate hook research from `docs/hook-capabilities` (`2a06865`,
  `/Users/vedant/dev-session-hook`).
- External proposal ingestion remains unexposed pending its own input/review
  design; metadata already exists, and the review refuses to mislabel it.
- Vedant owns commits. PRs and stale worktree/branch cleanup are separate.
  Existing worktrees are preserved.

Monday's command consolidation and v1 boundary were merged at `224fd81`.
The prototype remains unverified; no overall completion percentage is claimed.
