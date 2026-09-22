# The agreement record

An agreement records accepted terms before work starts. It is optional on a
session and is signed inside the existing creating record. Its absence means
no agreement was recorded; it never implies acceptance of default terms.

The current step supplies the data model and the `startSession` API. The CLI
review screen and the enforcement hook are subsequent steps. No policy is
enforced by this change.

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
