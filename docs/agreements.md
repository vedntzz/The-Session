# The agreement record

An agreement records accepted terms before work starts. It is optional on a
session and is signed inside the existing creating record. Its absence means
no agreement was recorded; it never implies acceptance of default terms.

## Review before starting

```sh
session start "fix parser" --scope src/parser.ts test/ --review
session prime "fix parser" --seed src/parser.ts --start --review
```

`--review` opens an interactive, line-oriented agreement screen. It shows the
intent, accepted paths, actions, sensitive paths and policy. Prime's evidence
appears first, and its original suggested scope remains visible alongside the
editable accepted paths. A replacement `--scope` seeds the accepted list without
changing the original proposal.

Type `paths`, `actions`, `sensitive` or `policy` to replace a field. Lists use
JSON, such as `["src/", "test/a file.ts"]`, so commas and spaces inside filenames
stay unambiguous. `[]` explicitly clears a list; a blank answer keeps it.
Policies are `record`, `ask` or `deny`. Invalid edits leave the draft unchanged.

The initial draft takes paths from `--scope` or Prime's suggestion, actions
`create` and `edit`, no sensitive paths, and policy `record`. These are visible
draft values, not terms silently accepted. Only typing `accept` writes them
into the signed record and starts the session. Enter, `yes`, or an unknown
choice never starts anything. `cancel`, end-of-input and interruption discard
the draft without creating a record or signing key.

A Prime review requires a nonempty accepted scope; when Prime abstains, supply
one using `paths` before accepting. A plain `start --review` can explicitly
accept empty paths or actions. Intent cannot be edited in this screen: cancel
and invoke the command with different words if needed.

Both input and output must be interactive terminals. `--review` is incompatible
with `--passive`, with `prime --debt`, or with `prime` without `--start`. Existing
starts without `--review` retain their noninteractive behavior and create no
agreement. Opening facts and the baseline are gathered after acceptance; a
session opened elsewhere while the review waits prevents a second start.

**Review only records policy; it does not activate enforcement.** The check
command below is available, but opt-in installation is still pending. External
proposal ingestion is not exposed, and this review refuses an external proposal
rather than labelling it as Prime's.

## Stored terms

The pure decision function in `src/agreement-decision.ts` checks an attempted
file write against accepted terms. It reports every mismatch: outside accepted
paths, unaccepted action, and sensitive path. No mismatch (or no agreement)
returns `defer`, leaving the editor's own permissions in charge. A mismatch
returns `ask` or `deny` according to policy; `record` returns `defer` while
retaining the mismatch list. It neither writes a record nor claims a file changed.

This function is wired to `session hook check`. Its adapter supplies a
resolved, canonical repo-relative file and a known operation. Ambiguous paths
and malformed terms throw; an adapter must handle those failures explicitly,
never treat them as permission.

### Tool requests and filesystem resolution

`parseClaudeWrite` handles PreToolUse payloads for `Edit`, `Write` and the legacy
`MultiEdit` shape (one `file_path`, a nonempty `edits` array). It validates input
types and returns only `cwd` and `filePath`: source content, replacement strings
and transcript paths are not retained. Unsupported tools are separate from
malformed requests. Payloads over 2 MiB are refused before JSON parsing; the
check command also bounds stdin while reading it.

Edit and Write fields were checked against the [Claude hook reference](https://code.claude.com/docs/en/hooks#pretooluse)
and [SDK tool reference](https://code.claude.com/docs/en/agent-sdk/python#edit).
Current references no longer list MultiEdit, so that branch is compatibility
for its explicit legacy shape, not a claim that current Claude emits it.
Per-edit paths and unknown fields within `edits` are refused rather than
silently overlooking another potential target.

`resolveFileWrite` is read-only and receives a trusted repository root from its
caller. It never derives that authority from the tool's payload. Relative file
paths resolve from the payload's cwd, which must resolve inside that root.
Absolute paths and root aliases (such as `/tmp` and `/private/tmp`) are supported.
`..`, control characters, directory targets and path spellings the agreement
matcher cannot represent faithfully are refused.

Existing regular files produce an attempted `edit`; absent files, including
those beneath missing parent directories, produce an attempted `create`.
This applies to all three tools and says nothing about whether their write
will succeed. Empty content or replacement text never means file deletion.

For an in-repo symlink, resolution returns both the requested name and the
resolved target, deduplicated. **The hook must check every returned path** and
honour the most restrictive result. Both a sensitive alias and a sensitive
target matter. Links that resolve outside the repository, dangling/cyclic
links, hard-linked files and unreadable paths return a blocked resolution;
no error becomes an empty scope or a permission grant. Existing file contents
are never opened, and missing files/directories are never created.

This is a filesystem snapshot, not an atomic sandbox. Concurrent changes can
race the later write, aliases beyond the checked names are not enumerated, and
shell or other tools are unsupported. This module alone intercepts nothing.

### PreToolUse check command

`session hook check` reads one payload from stdin. The process working directory
selects the trusted repository and its latest open session, using the existing
repository-level session lookup; the payload cannot select another repository.
It checks every requested and resolved path, retaining the strictest decision.
The command does not install itself, change settings, append attempt records,
or modify files. Existing hook installation remains unchanged.

- No agreement, a closed session, record-only policy, a compliant write or an
  unsupported tool produces no output: normal editor permissions still apply.
- An agreement mismatch emits one PreToolUse JSON response with `ask` or `deny`.
- An unresolved target under ask/deny policy is denied, not guessed or approved.
- Invalid/oversized input, failed reads, unreadable logs and an unavailable Git
  checkout produce a static denial. No source content, paths or raw errors are
  echoed. Run this command from the intended repository, not as a global hook
  for arbitrary non-repository directories.

Internal `defer` is translated to silence, **not** the host's literal `defer`,
which pauses noninteractive runs. See the official
[PreToolUse response contract](https://code.claude.com/docs/en/hooks#pretooluse-decision-control).
Responses never grant `allow` or replace tool input. Record-only does not log
attempts; ordinary stop-time diff measurement remains separate.

The existing reader chooses the latest open session across checkouts sharing
a repository identity, tolerates a truncated final log line, and does not
cryptographically verify on every read. This command inherits those semantics;
it is not an integrity or per-editor-session binding guarantee. Opt-in
installation, real editor tests, timeout behavior and latency remain pending.

```ts
agreement: {
  paths: ["src/parser.ts", "test/"],
  actions: ["create", "edit"],
  sensitivePaths: [".env", "credentials/"],
  policy: "ask"
}
```

- `paths` are accepted repository-relative path prefixes. They follow the
  existing scope rule at directory boundaries, not globs. `.` explicitly names
  the whole repository. An empty list accepts no paths.
- `actions` names file operations: `create`, `edit`, `delete`. These are not
  editor tool names. An empty list accepts no write operations.
- `sensitivePaths` uses the same prefix rule and may include paths outside the
  accepted scope. It remains meaningful even when `paths` includes `.`.
- `policy` specifies the requested response when a write is outside accepted
  paths, uses an unaccepted action, or touches a sensitive path: `record`
  (observe without blocking), `ask` (request developer permission), or `deny`
  (refuse). The later hook implements those responses for the tools it supports;
  the agreement alone makes no claim to sandbox all writes.

Every field is required when an agreement is supplied. Paths are trimmed,
leading `./` and trailing slashes removed, and duplicates dropped. Absolute
paths, parent traversal, backslashes, control characters and ambiguous internal
segments are refused. No filesystem access or inference is needed to validate
these terms. Existence, symlinks and tool-specific resolution belong to the
future hook, at the time a write is attempted.

The accepted paths also populate `session.scope`, so existing drift and debt
readers keep one yardstick. A caller supplying both must supply matching sets.
On an agreed session both agreement and scope are fixed at creation: the
writer refuses patches and the reader ignores later attempts to replace them.
Later patches cannot add an agreement to a session that began without one.
Legacy sessions retain their existing scope-patch behavior.

The original `session.proposal` stays separate and immutable. Its `proposer`
is `prime` or `external`; new Prime suggestions explicitly write `prime`.
`proposerOf` reads an absent field as `prime`, without backfilling stored bytes.
The existing proposal structure still describes Prime's scope suggestions;
this step does not expose external-proposal ingestion or richer proposal terms.
Those need their own review workflow and accurate user-facing labels.

The record version and signing algorithm are unchanged: the hash already
covers every field in `set`, including the agreement and proposer. Older
records need no migration. Cryptographic verification detects edited bytes;
the fold's immutability rule separately prevents a later appended patch from
revising what was accepted.
