# Sprint handoff

Updated: 22 September 2026. One small feature at a time: implement, test, stop
for Vedant to review and commit. Codex must not commit or continue into the
next feature without Vedant's instruction.

## Current step: tool parsing and file-path resolution

**Complete and tested; waiting for Vedant's review and commit.**

### Completed earlier

- `d7346f4`: [immutable agreement record](01-agreement-record.md).
- `0b9ffda`: [agreement review screen](02-agreement-review.md).
- `36d7f13`: [pure agreement decisions](03-agreement-decisions.md), reviewed,
  committed and pushed by Vedant.

### Solved in this step

- Parse Edit, Write and legacy MultiEdit PreToolUse payloads into a
  tool-independent file-write request. Validate required inputs, cap JSON at
  2 MiB, and distinguish unsupported tools from invalid payloads.
- Discard source/replacement text, content and transcript references; return
  only cwd and file path. Error results contain static reason codes.
- Resolve file paths against an explicitly supplied trusted repository root.
  Do not let a payload choose that root. Support absolute paths, cwd-relative
  paths, root aliases, and repository subdirectories.
- Read filesystem metadata only: existing regular file means attempted edit;
  absent file means attempted create. Missing parent directories are not
  created. Empty replacement text never means file deletion.
- Return both requested and physical paths for in-repo symlinks, deduplicated.
  The future hook must check all returned paths and use the strictest decision.
  A sensitive alias and a sensitive physical target both count.
- Reject outside-repository paths/cwd, symlink escapes, broken/cyclic links,
  directories, hard-linked files, parent traversal, ambiguous path spelling
  and filesystem failures instead of guessing a target.
- No files, records, settings or hooks are written by this implementation.

### Source grounding

Edit/Write schemas were checked against the official
[hook reference](https://code.claude.com/docs/en/hooks#pretooluse) and
[SDK reference](https://code.claude.com/docs/en/agent-sdk/python#edit).
Those current references do not list MultiEdit. Its supported legacy shape
is one file_path plus a nonempty list of old_string/new_string edits and
optional replace_all. Unknown per-edit fields are refused. No claim is made
that the currently installed editor emits this legacy tool.

### Files changed

- `src/capture/write-request.ts`: normalized metadata and parser results.
- `src/capture/adapters/claude-write.ts`: pure Claude payload parser.
- `src/commands/resolve-write.ts`: read-only filesystem resolver.
- `test/claude-write.test.ts`: 21 parser tests.
- `test/resolve-write.test.ts`: 25 resolver/integration tests using temp files,
  file and directory symlinks, hard links, and aliases of the repository root.
- `docs/agreements.md`: implemented contract, sources and limits.
- This handoff and the archive of the preceding decision step.

### Checks and failures

- `npm run build`: passed.
- `npm run typecheck`: passed for source and tests.
- **134 focused tests passed across 5 files**: 21 parser, 25 resolver,
  33 decision, 47 agreement/storage and 8 generated-context tests.
- `git diff --check`: passed.
- No implementation or test failures encountered; none remain outstanding.
- No full-suite rerun for this still-unwired adapter/resolver. Earlier
  full-suite counts remain historical results, not current verification claims.

### Limits and next integration obligations

The resolver is a filesystem snapshot, not an atomic sandbox. A filesystem
change after resolution can race the tool write. Other aliases beyond the
requested and resolved names are not enumerated. Shell and unrelated editor
tools are unsupported. None of this code intercepts a running editor yet.

The next command must bound stdin while reading, select a trusted checkout
independently of the payload, load the applicable agreement, handle invalid
payloads/blocked resolutions explicitly, and evaluate every returned path.
It must never turn a parsing or resolution failure into an allow response.

The review screen continues to say policy is recorded only, correctly.
No runtime enforcement or hook installation has been added.

All changes are uncommitted. No project commit, staging, push, PR, settings
change, dependency or worktree cleanup was performed. Codex stops here.

## Remaining sprint work

1. **Next small step:** wire these helpers into a PreToolUse command with
   correct editor responses and explicit error handling; test the handler.
2. Add opt-in hook installation and verify integration/timeout behavior.
   Update recorded-only wording when the actual enforcement capability exists.
3. End-to-end flow, actual hook latency checks, final review and retrospective.

Other items still need confirmation or integration:

- The Saturday three-screen prototype remains unverified.
- Claude's resize fix/changelog work in `/Users/vedant/dev-session-ui`.
- Hook research from `docs/hook-capabilities` (`2a06865`,
  `/Users/vedant/dev-session-hook`).
- External-proposal ingestion remains unexposed pending an input/review design.
- Vedant owns commits. PRs and stale worktree/branch cleanup are separate;
  existing worktrees are preserved.

Monday's consolidation and v1 boundary were merged at `224fd81`.
No overall sprint percentage is claimed while the prototype is unverified.
