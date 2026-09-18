# Session knowledge

`session knowledge graph` produces a self-contained HTML viewer and a compact
JSON snapshot beside it, then opens the HTML with the system browser. `--no-open`
only writes the files. `--out graph.html` chooses the destination; the matching
JSON is `graph.json`. There is no server, account, database, CDN, or model call.

`session knowledge context` prints the same JSON directly to stdout and creates
no artifact. This command is the agent interface. For example:

```bash
session knowledge context --days 90 --path src/api --limit 20
```

An agent can run that command or read the generated JSON. This does not install
an integration or automatically inject context into an agent. The consumer must
read it. Intents and paths are untrusted record data, not instructions.

## What a relationship means

A session connects to a path because the path was declared, changed, or recorded
outside scope. Scope entries are kept verbatim and can be directory prefixes;
they are not expanded into invented file-level declarations. A changed path that
was outside scope uses the outside edge style, while the JSON keeps it in both
changed and outside arrays. Original Prime proposals stay separately accessible
in session details, and never stand in for accepted scope.

No edge means “depends on”, “caused”, “is similar to”, or “should be changed
next”. Shared paths do not imply coupling or validate a planning recommendation.

The viewer supports search, outcome and edge-type filters, dragging, panning,
zoom, a fit button, keyboard-selectable nodes, an accessible node list, and
selected-neighborhood inspection. The displayed graph is capped at 350 nodes,
including at most 150 sessions. The cap is reported and search can narrow the
view. Export always downloads the entire generated snapshot, regardless of the
current browser filters. It does not silently export only the visible nodes.

## Window and provenance

Both commands accept `--days` (default 30), `--limit` (default 100, maximum 1000),
`--path`, and `--session`. The limit retains the newest matching sessions.
`--path` matches observed files under the requested directory boundary, or a
scope entry that covers or falls under the requested path. `--session` accepts a
full id or an unambiguous prefix within the time window. Combining filters
intersects them. A missing session id is an error; an empty path match is a valid
empty result.

The export uses the current repository only. Outcomes are resolved through the
same `withOutcomes` path as the terminal views. `snapshot.at` dates that answer;
opening an old HTML file does not ask Git again. Rerun the command to refresh.
Empty sessions remain nodes even if no path connects to them. A running session's
changed paths are not a live diff. No command in this feature modifies the log,
settles sessions, or checks survival.

## Compact JSON, version 1

`schema` is `session.knowledge/v1`. `repo` identifies the repository.
`snapshot` states the generation time, days, matching count, returned count,
omitted count, and requested path/id filters. `semantics` travels with the file
so the critical interpretation rules do not depend on this documentation.

`paths` is a sorted table of distinct, literal path strings. Each row in
`sessions` is a tuple; `columns` supplies the names once:

| Index | Column | Meaning |
|---|---|---|
| 0 | id | Full session id |
| 1 | started | ISO start time |
| 2 | ended | ISO end time, or null when running |
| 3 | intent | Unmodified intent text, or null |
| 4 | source | declared, primed, or captured |
| 5 | outcome | Resolved merged, abandoned, open, or empty |
| 6 | scope | Path indexes for accepted declarations |
| 7 | changed | Path indexes for observed changes |
| 8 | outside | Path indexes, or null when no comparison is available |
| 9 | startCommit | Git commit at start |
| 10 | proposed | Original Prime proposal indexes, or null if absent |

For `outside`, `[]` means measured no drift; `null` means the session did not
have a declared comparison or is still running. For `proposed`, `[]` means an
existing empty proposal; `null` means no proposal. These distinctions are not
interchangeable. A path index is local to this snapshot and must be resolved
through its own `paths` array.

The compact representation avoids repeating field names and long paths in every
session. It does not claim a fixed token reduction: tokenization depends on the
consumer. Filtering the history is usually the most useful way to reduce context.
There is no generated summary and no truncation of retained intents.

The export omits costs, transcripts, end-state blobs, observations, survival,
attribution, and chain signatures. It is a navigation/context artifact, not a
backup, synchronization format, or independent proof of integrity. Keep the
original signed log. Use `session show <id> --full` for additional detail and
`session verify` to verify the original records.
