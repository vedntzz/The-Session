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

**Policy is only recorded in this version.** The enforcement hook is the next
step; this screen does not install hooks or enforce the policy. External
proposal ingestion is not exposed, and this review refuses an external proposal
rather than labelling it as Prime's.

## Stored terms

The pure decision function in `src/agreement-decision.ts` checks an attempted
file write against accepted terms. It reports every mismatch: outside accepted
paths, unaccepted action, and sensitive path. No mismatch (or no agreement)
returns `defer`, leaving the editor's own permissions in charge. A mismatch
returns `ask` or `deny` according to policy; `record` returns `defer` while
retaining the mismatch list. It neither writes a record nor claims a file changed.

This function is not wired to an editor hook yet. Its adapter must supply a
resolved, canonical repo-relative file and a known operation. Ambiguous paths
and malformed terms throw; an adapter must handle those failures explicitly,
never treat them as permission. Filesystem resolution, symlinks, outside-repo
targets, tool parsing and hook responses remain the next integration step.

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
