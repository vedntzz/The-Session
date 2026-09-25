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

**Review does not activate enforcement by itself.** A policy is checked only
in a repository where `session hook install --repo` has registered the check
command below, and only for Edit, Write and MultiEdit. External
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
selects the trusted repository and canonical checkout; the payload cannot select
another repository. The check selects the single open session bound to that
checkout, never the newest session from another checkout sharing the same remote.
It checks every requested and resolved path, retaining the strictest decision.
The command does not install itself, change settings or modify files. It
appends one signed write-check event per path it checked to the selected
session's log — the answer, a static reason code, the tool and the adapter's
name, never content — within its own 3-second budget after the check. No
session open here, an unsupported tool, or a session it cannot choose writes
none. Schema and codes: [decisions](decisions.md#every-check-recorded).

`session hook install --repo` registers it for the current repository only,
in `<root>/.claude/settings.local.json`, under the matcher
`Edit|Write|MultiEdit` with a 10-second timeout. The file is created if absent;
other settings and hooks in it are kept, and a second install changes nothing.
An entry filed under a narrower matcher is moved, not duplicated. User-level
settings are never read or written, because outside a repository the check
denies every supported write. `--repo` refuses the passive flags by name.

`session hook install --repo --uninstall` takes the check back out of the
same file, including an entry filed under another matcher, and leaves every
other setting and hook. A file emptied by the removal stays as `{}`; a
repository without the file, or without the check, is left untouched and no
file is created. The user-level `session hook install --uninstall` never
removes the check, and this never removes the user-level hooks.

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

#### Shell commands

`session hook check` also reads Claude Code's `Bash` payloads, and the check's
matcher is `Edit|Write|MultiEdit|Bash`. `parseClaudeBash` keeps only `cwd` and
the command, in memory; neither is stored, logged or echoed. The command goes
through `resolveShellCommand` (below), and:

- a recognized command's writes are decided exactly as an Edit or Write's —
  silence when accepted, the policy's `ask` or `deny` when not;
- a known reader, or a command that writes no tracked file, is silent;
- a command nothing recognizes is **`ask`, "Can't tell what this writes."**,
  under both `ask` and `deny` policy: nothing says it breaks the terms, only
  that nothing can say it keeps them. Under `claude -p` there is no one to
  answer, and the command does not run;
- a recognized command whose path cannot be checked is denied;
- `record` stays silent, as for file tools.

An install made before `Bash` was in the matcher reads as not registered; run
`session hook install --repo` again to repair it. Every Bash call now
starts the check, about 190 ms each. Measured in a real Claude Code run on
23 September 2026 under a deny agreement for edits under `src/`: `echo b >
src/a.txt` ran, `echo hello > notes.txt` was denied, `touch src/new.txt` was
asked about and did not run.

The pieces, each pure or metadata-only: `packageManagerWrites` in `src/shell/package-manager.ts`
says which tracked files an npm, pnpm or yarn command writes — the manifest
and lockfile — or that it cannot tell.

It recognises one simple command only, through `simpleWords`: no chains,
pipes, redirects, substitutions, globs or environment prefixes. A global
install, another directory (`--prefix`, `-C`, `--dir`, `--cwd`), a workspace
or recursive flag, or any flag outside a fixed list is unknown. `npm run`,
`npm test` and `npx` are unknown: they run arbitrary code. Frozen installs
(`npm ci`, `--frozen-lockfile`, `--immutable`, `npm --no-save`) write neither
file. Where versions differ — whether `update` rewrites the manifest — the
answer includes the file.

What it cannot see, and says so: `node_modules`, package caches, and anything
a dependency's install script writes. `npm-shrinkwrap.json` and yarn's Plug'n'Play
files are not listed.

`sedWrites` in `src/shell/sed.ts` is also pure.
The caller must explicitly identify `gnu` or `macos` sed; omitted or unknown
dialects return unknown. Do not infer the executable's dialect from the OS.
It accepts in-place editing with a simple slash-delimited substitution, optional
`-n`/`-E`, and separate `-e` expressions. GNU `-i`/`--in-place` and macOS
`-i ''` are distinct. Simple backup extensions add every backup path to the
answer, alongside each operand. Paths remain unresolved for the later resolver.

Unknown flags, script files, addresses, bracket expressions, escaped script
characters, alternate delimiters, `e`/`w` commands or flags, and complex backup
templates remain unknown. No command is run; scripts are discarded from the
result. Only persistent operand/backup names are listed, not sed's temporary
files. This is not a sandbox or a claim that a write succeeded.
Argument and backup behavior were checked against the
[GNU sed manual](https://www.gnu.org/software/sed/manual/html_node/Command_002dLine-Options.html)
and [FreeBSD sed reference](https://man.freebsd.org/cgi/man.cgi?query=sed&sektion=1&manpath=FreeBSD+14.0-RELEASE+and+Ports).

`redirectWrites` in `src/shell/redirect.ts` recognizes one trailing stdout `>`
with a literal target, for a bare redirect, `echo`, or `:` only. Quoted `>`
characters remain literal; adjacent syntax such as `echo text>file` is supported.
The shared `simpleWords` tokenizer remains unchanged and still refuses redirects.
An arbitrary program with a redirect stays unknown: its output target is not a
complete account of what the program might write. This assumes ordinary shell
builtins, not aliases or replacement functions; executable identity and shell
environment remain an integration obligation.

Append/clobber operators, descriptors, multiple redirects, input redirects,
expansions, chains, pipes, malformed quotes and `/dev` targets are unknown.
Paths remain unresolved; the parser neither creates/truncates files nor decides
create versus edit. Only the output path is returned, never the output content.
Syntax grounding:
[Bash redirections](https://www.gnu.org/s/bash/manual/html_node/Redirections.html).

`teeWrites` in `src/shell/tee.ts` recognizes a standalone `tee` with one or more
literal file operands. It includes every named output for overwrite or append,
deduplicating exact names. Supported options before operands are `-a`, `-i`,
their short combinations, `--append` and `--ignore-interrupts`; `--` before
operands allows names beginning with a dash. Options after operands are unknown
because option permutation varies between implementations. Long options may
not be available on every implementation; recognizing targets does not promise
successful execution.

Bare `tee`, empty operands, the version-dependent `-` operand, `/dev` targets,
unknown flags, expansions, redirections and entire pipelines stay unknown.
In particular, a pipeline ending in `tee` is not reduced to tee's outputs:
earlier commands can write other files. The inherited stdout destination,
executable identity, aliases/functions, and path resolution are not established
by this parser. Nothing is executed or wired to the hook. Source:
[GNU tee invocation](https://www.gnu.org/s/coreutils/manual/html_node/tee-invocation.html).

`parseMove` in `src/shell/move.ts` parses a move request, **not a write set**.
It accepts one `mv` with exactly two literal operands, optionally one of `-f`,
`-i` or `-n`, and an optional `--` before operands. It preserves the source,
destination and overwrite mode. Combined/repeated flags, backup options,
target-directory overrides, multiple sources and compound shell syntax are
unknown. Nothing is executed, deleted or moved.

The result deliberately has no `paths` or resolved action list: `mv a b`
can write `b/a` when `b` is a directory, and a directory source can affect an
entire subtree. The request alone must not be accepted as a complete write set.
Ordinary executable identity
is assumed; aliases/functions and filesystem races remain limitations. Source:
[GNU mv invocation](https://www.gnu.org/s/coreutils/manual/html_node/mv-invocation.html).

`resolveMove` in `src/commands/resolve-move.ts` provides a read-only snapshot
for regular-file-to-file moves only. It reuses the trusted-root checks and
returns source `delete` operations plus destination `create`/`edit` operations.
Parent-directory symlink aliases retain both requested and physical paths.
Every operation must be checked; accepting the destination does not permit
deleting an out-of-scope or sensitive source.

Directory operands, leaf symlinks, hard-linked files, missing sources or
destination parents, same-file aliases, escapes and invalid paths are blocked.
Directory moves are deliberately unsupported, not partially enumerated.
Interactive/no-clobber flags keep the potential effects: a possible skip is
not a guaranteed no-op. No moves or content reads occur. This is still not
wired into the hook, and filesystem changes after resolution can race a move.

`parseCopy` in `src/shell/copy.ts` accepts a two-operand `cp`, optionally with
one `-i` or `-n` and an optional `--` before operands. Recursive, backup, link,
metadata-preservation, target-directory and force options remain unknown.
In particular, `-f` can remove an existing destination and is not silently
treated as an ordinary edit. See [GNU cp invocation](https://www.gnu.org/s/coreutils/manual/html_node/cp-invocation.html).

`resolveCopy` resolves only regular-file-to-file copies. Shared metadata-only
checks in `resolve-file-pair.ts` keep its path safety aligned with `resolveMove`:
both operands must be in the trusted repository, the source must exist, and
the destination parent must exist. Directory operands, leaf links, hard links,
same-file aliases and unsafe/unresolved paths are blocked. This deliberately
also refuses outside-repository read sources rather than widening the boundary.

Only destination create/edit operations are emitted, including requested and
physical parent aliases. Source reads are not labelled as writes or deletions.
Interactive/no-clobber keep the potential write rather than imply a guaranteed
skip. No file content is read or copied by resolution. Metadata side effects
across platform/filesystem variants are not established by this subset; this
is not a sandbox.

`parseRemove` in `src/shell/remove.ts` accepts one `rm` with one or more
literal operands, optionally one `-f` or `-i`, and an optional `--` before
operands. Recursive and directory removal (`-r`, `-R`, `--recursive`, `-d`),
combined or long options, and every other flag are unknown: a directory's
contents cannot be told from the command.

`resolveRemove` in `src/commands/resolve-remove.ts` emits a `delete` for every
operand, keeping parent-directory aliases. A missing operand is still a
`delete`: it may exist by the time the command runs, and `-f` only silences
rm's error. A leaf symlink is blocked, because rm removes the link rather than
the file it names. Directories, hard-linked files (whose other names survive),
escapes and unresolved paths are blocked, and one blocked operand blocks the
whole command rather than yielding a partial answer. No file is removed or
read.

The shared tokenizer assumes the command may run in zsh, not only POSIX sh:
Claude Code's Bash tool ran `/bin/zsh` 5.9 when checked on 23 September 2026
on macOS. So besides everything above, an unquoted `^` (a glob operator under
zsh's `extendedglob`) and an unquoted `=` at the start of a word (zsh expands
`=cmd` to that command's path) are refused. Quoted, both stay literal.

Aliases, shell functions and `PATH` are outside what any of this can see: a
listed name runs whatever the editor's shell resolves it to.

`readOnlyWrites` in `src/shell/read-only.ts` is the read-only allowlist: one
simple command known to write no file answers `writes` with no paths, and
anything else is unknown. Once the shell check is wired in, a listed command
passes without a question, so a program is listed only when none of its
options can write a file, run another program or name an output: `cat`,
`head`, `tail`, `wc`, `ls`, `pwd`, `echo`, `true`, `false`, `grep` (and
`egrep`, `fgrep`), `diff`, `cmp`, `stat`, `du`, `df`, `which`, `basename`,
`dirname`, `realpath`, `readlink`, `whoami` and `uname`.

Two programs are listed with conditions. `find` is read-only unless it has
`-delete`, `-exec`, `-execdir`, `-ok`, `-okdir` or `-fprint`, `-fprint0`,
`-fprintf`, `-fls`. `git` is read-only for `status`, `log`, `diff`, `show`,
`blame`, `ls-files`, `rev-parse`, `describe` and `shortlog`, and for `branch`
and `remote` in their listing forms only; no global option may precede the
subcommand (`-C`, `-c`, `--git-dir`), and `--output` or `--ext-diff` anywhere
makes it unknown. The index refresh `git status` may do is under `.git`, which
no agreement path or diff covers.

Deliberately not listed, because an option writes or runs something: `sort`
(`-o`, `-T`, `--compress-program`), `uniq` (a second operand is an output),
`tree` (`-o`), `file` (`-C`), `rg` (`--pre`), `env` and `xargs` (they run a
command), and `date` (`-s`). A `~` anywhere in a word is refused by the shared
tokenizer, so `git diff HEAD~1` is unknown too.

`resolveShellCommand` in `src/commands/resolve-shell.ts` joins the pieces: it
asks every recognizer above and requires **exactly one** to claim the command.
None is unknown ("can't tell what this writes"); two would be two readings of
one command, so that is unknown too rather than a guess. Paths a recognizer
names are resolved from the command's own directory through the same
`resolveFileWrite` the Edit/Write check uses; moves, copies and removals go
through their resolvers. The answer is the list of writes (empty for a known
reader or a frozen install), unknown, or blocked — and blocked is never read
as "writes nothing". Which `sed` runs cannot be told from the platform (GNU sed
is often first on `PATH` on macOS), so `sedEitherDialect` reads a command in
both dialects: it is known only when both recognize it, and every path either
names is checked. `sed -i -e 's/a/b/' f` therefore checks `f` and `f-e`, the
backup macOS would create; `sed -i ''` and a GNU-only `sed -i` are unknown.
Metadata only: no command runs and no file content is read.

#### When the check cannot answer

Claude Code lets a PreToolUse write through when the hook times out, exits
non-zero without JSON, or cannot start; only exit 2 or a JSON `deny` blocks.
Checked against the [hooks reference](https://code.claude.com/docs/en/hooks)
on 22 September 2026; re-check before relying on it. The check closes the
cases it can reach:

| Failure | What happens |
|---|---|
| A step is slow or stdin never closes | Denied at the 5-second internal deadline (`CHECK_DEADLINE_MS`), inside the registered 10-second timeout; a `not-checked` event, reason `deadline`, is recorded within 3 more seconds if it can be; the process exits without waiting on stdin or abandoned work |
| A caught error in the check | A static JSON denial, exit 0 |
| An error escaping the check (e.g. stdout fails) | A static stderr reason, exit 2, which blocks |
| `session` is not on the editor's `PATH`, Node cannot start, or the process is killed | **The write goes through, and no event is recorded.** Nothing inside the check can answer for a process that never ran ([why no event](decisions.md#a-crash-leaves-no-event)) |

Enforcement is therefore only as reliable as the `session` command being
installed where the editor can run it. When several PreToolUse hooks match,
the host runs them in parallel; its documentation does not say how
conflicting decisions from different hooks are combined.

#### Measured

`node evidence/enforce-e2e.mjs` reproduces this in a temporary repository with
its own `SESSION_HOME`. Run on 25 September 2026 with Claude Code 2.1.282 and
Haiku, under a deny agreement accepting only edits under `src/`: the agent's
Edit to `src/a.ts` went through and was recorded as `n=1 Edit src/a.ts silent
compliant`; its Write of `notes.txt` was blocked with the check's reason, the
file was never created, and it was recorded as `n=2 Write notes.txt deny
outside-paths,action-not-accepted`. `session verify` found the chain intact.
The script exits non-zero if no `deny` event was recorded or verify fails.
`--no-agent` skips the paid step.

One check, with its event recorded, takes 184 ms at p50 and 190–194 ms at p95
on an Apple-silicon Mac, allowed or denied — against about 190 ms at p95 before
checks were recorded. All 60 timed checks wrote their events, so the figures
include the lock, signing and append. Of the rest, roughly 30 ms is Node
starting, 45 ms loading the CLI, and the remainder the git calls and log read
that pick the checkout and session. That is under 4% of the 5-second deadline.

An `ask` policy is not exercised end to end: `claude -p` has no one to ask, so
it needs an interactive session.

New records capture optional immutable `checkout` metadata from Git's root and
filesystem realpath at creation, independent of caller-supplied record fields.
Root aliases and subdirectories resolve to the same binding. If Git cannot
identify a checkout, the binding stays absent rather than being guessed.
Older records are never backfilled or re-signed; patches cannot add or replace
their binding. Reports keep their existing repository-level history.

Multiple open sessions in this checkout are denied, including a mix of agreed
and non-agreed sessions. An open legacy agreement without a binding is also
denied: close it and start a new session in the intended checkout. Legacy
sessions without agreements add no restriction. Known other-checkout sessions
are ignored; if none is open here, normal editor permissions remain in charge.

This binds a session to a checkout path, not to an editor process. Two editors
in one checkout share its one agreement. Moving/reusing checkout paths requires
closing old sessions and starting new ones; the path is not a machine identity.
Existing start/stop lifecycle selection is unchanged and remains repository-wide.
The reader still tolerates a truncated final log line and does not verify
signatures on every read, so this is not an integrity guarantee.

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
