---
name: terminal-output
description: Load when changing anything a person reads — terminal views, colour, the help surface, or the Markdown and HTML reports. Editing render/palette.ts, render/terminal.ts, render/markdown.ts, render/html.ts, the help text in program.ts, or adding output to a command. Also load before introducing a colour role, hard-coding a hue, adding an emoji or spinner, putting a command in the short `--help` list, or interpolating an intent into a Markdown table.
---

# What a person reads

The terminal views, the help surface, colour, and the documents `week` writes
for somebody who was not there. The rationale is in
[Colour](../../../docs/decisions.md#colour) and
[Finding your way around](../../../docs/decisions.md#finding-your-way-around)
— this file is the rules a change has to hold to.

Any total printed here obeys the unpriced rule: **nought is not the same as
unknown**. That rule lives with the arithmetic, in the `measurement-rules`
skill under "A total nobody can work out" — load it before touching a figure.

## The order every view is in

Three rules, and they hold in `show`, `week`, `scan` and the Markdown document
alike. They are what the views are *for*, not a house style:

1. **The first line says where the work went.** How many sessions, how many
   landed on the default branch, how many did not. `show` says it as a
   sentence about one session; `week` and `scan` say it as counts.
2. **Drift comes before cost.** What went outside what was declared is the
   thing this tool measures that nothing else does. Every column, row and
   sentence about it precedes every one about money.
3. **A total in money is one dim line at the bottom, and nowhere else.** Never
   a heading, never the first figure, never bright, and never in a totals row
   as well — `week`'s and the Markdown table's cost cells in the totals row are
   deliberately empty, and the line under the table is the only total. Per
   session, cost stays in the detail views: `show`'s figure line, `show
   --full`'s rows, the cost column of a table.

The reason is that the agents meter their own spend now, so a view that opened
on a dollar figure would be answering a question its reader has already had
answered. Money is still printed — a week nobody can put a figure on is a week
nobody can bill — but it closes a view rather than leading it.

`spentFigure` in `render/terminal/week.ts` is the one function that decides
whether a window's money reads `$0.00`, a figure, or an em dash. `week` and
`render/markdown.ts` both call it. Two copies of that two-clause test are two
chances for the terminal and the page somebody pastes into Notion to disagree
about what one week cost.

## How wide a view may be

`terminalWidth` in `render/terminal/text.ts` is the one place this is decided,
and it has the same shape and the same contract as `colorEnabled`: **what a
terminal gets adapts to that terminal, and what a pipe gets is fixed.** Fixed
here means *unconstrained* — it returns `undefined` off a pipe, a file or a CI
log, and every view then lays out exactly as it did before any of this existed.
That is what keeps the colourless render pinnable: a width read off whoever
happened to run the command would make the bytes in a bug report a fact about
their terminal.

It is measured once per run, at the command, beside the palette — neither
changes between two lines of the same run — and travels to the views as
`View.width`, absent in every test that only cares about layout.

Two rules for what a view does with it:

- **Prose wraps; tables do not.** A sentence has no column to be measured
  against, so `note` and `wrapSegments` fold it at the width and carry the same
  indent onto every continuation line. A table has columns, and the only one
  that may give is the one carrying text — `week`'s intent, down to
  `MIN_INTENT`. Every other column is a fixed shape or a figure whose digits
  cannot be dropped.
- **There is a floor, and past it a view overflows on purpose.** `MIN_WIDTH`
  for prose, `MIN_INTENT` for the intent column. A table whose rows cannot be
  told apart from each other is not an improvement on a table that wrapped, so
  below the floor the layout stops shrinking and runs past the edge. `week`
  fits exactly at 80 columns and up. Getting it there cost the unit off the
  `drift` heading — see below — and there is **no budget left**: the only
  remaining six columns are the time in `started`, which is how a developer
  recognises a session. Anything added to this table takes width from the
  intent, and the intent has a floor.

Ink goes on **after** the wrap, never before. `wrapSegments` takes the runs of
a sentence with their inks, wraps the plain text, and inks each line's share of
each run — so an escape code never counts toward a width and no line ends
inside one. `test/terminal.test.ts` pins this the way `palette.test.ts` does:
stripping the tags out of the inked render gives back the plain render exactly.

## Naming a repository

`repoName` in `store/paths.ts` is the one place that knows `remote:` and
`path:` are prefixes, beside the `repoIdentity` that puts them on. They are how
the store tells two kinds of key apart and they are not how anybody refers to a
repository, so **no view prints them** — `debt` used to, and a reader met
`path:/private/tmp/…/scratchpad/demo` as a heading.

A remote key loses the prefix and nothing else; it is already the name everyone
uses. A path key keeps its whole path, with the home directory shortened to
`~`: two checkouts of one project share a last segment, and a report calling
them both `tool` would be pooling two answers under one name.

`debt` reads every log on the machine, and prints the repo the reader is
standing in **first**, marked `HERE`. Only that one moves. Sorting the rest by
how much each owes would be a league table across repositories, which `debtOf`
refuses to build — arriving at it by way of a sort in the view is the same
claim made quietly.

## The CLI surface

Written for somebody who has just watched an agent run for forty minutes. That
reader can hold about three facts, and every extra one pushes out a fact they
needed.

`session --help` lists four entry points: the bare screen, `start`, `week`, and
`help all`. The other commands are not hidden from the parser — they all run,
and `session help all` lists every one of them with its description. The short
list is a decision about what a first reader can use, not a claim about what
exists. `BRIEF_COMMANDS` in `program.ts` is the whole of it, and the list is
filtered out of the real command tree rather than written beside it, so a
command renamed cannot silently fall off.

The `help all` term is the **root command's own**. Commander gives every
command with subcommands an implicit `help` of its own, and the override that
renames ours is guarded on the parent rather than on the name — matched by name
it renamed those too, and `session hook --help` went out advertising a `session
hook help all` that does not exist.

`session help all` is built by walking `program.commands`, parents and
children. So is the sentence under the short help naming what it left out.
A hand-kept list would be one release away from being wrong, and that sentence
was: written out by hand it had already gone stale by three commands. The
command it points at — `session help all` — is kept whole when the sentence
wraps, since it is the one thing there the reader is meant to type.

`session` with no arguments is a **state screen, not a menu**: one sentence
about where the repo stands, then at most two commands. Which two depends on
the state, because in each state there is one obvious next move and at most one
other worth knowing. Commander would print the help here — the right answer to
"what is this" and the wrong one to "where am I".

Because the root has an action of its own, a name matching no subcommand would
arrive as a stray argument to it, and commander's answer was `error: too many
arguments. Expected 0 arguments but got 1` — true of the parse and no help to
somebody who did not think they were passing an argument. So the root declares
`[command]` and `unknownCommand` answers instead: what is wrong, what was
probably meant, and where the whole list is, in that order. The argument is
hidden from the root's own help through `visibleArguments`, and `usage` is set
by hand, or commander prints `[command] [command]` — once for the argument and
once for the subcommands it already knew about.

`didYouMean` offers a guess only when there is one. A prefix first — somebody
typing `sur` for `survival` has not made a typo, they have stopped early, and
no edit distance describes that — then the nearest name within one edit. The
distance is **Damerau**-Levenshtein: transposing two letters is the commonest
thing fingers do at a prompt, and plain Levenshtein scores it 2, which is the
difference between `session weke` being answered and being shrugged at. Two
edits is where a suggestion starts being wrong as often as it is right, and the
reader tries it before they read the rest of the line.

`session show` is three sentences and a bottom line: where the work ended
up, what was asked for, what went outside what was declared, and then the
session's id, the cost, the turns, and turns that produced nothing — that last one only where the diff can
say, which is a session that changed nothing. Every view reads it through
`emptyTurnsOf`, never off `cost.emptyTurns`; see the `measurement-rules` skill
under "Which turns produced nothing". The brief line simply stops at two
figures where the third is unknown, while `show --full` spells the absence out
as `not measured`: a dash in a line read at a glance is a puzzle about the
tool, and the labelled view is where an absence belongs. `week`'s column and
its totals take the dash, with a note under the table naming how many sessions
could not be counted. No view prints a count of calls that changed no files —
that figure is gone. The labelled layout is `--full`,
and `--tokens` implies it rather than being quietly ignored.

The outcome sentence is read off `outcome`, which by the time a view runs holds
what the repository says now rather than what the record was written with — see
`withOutcomes`. Four ends, four sentences, each saying only what its evidence
supports: a session still open has not landed and has not failed to, and one
that changed no files never had anything to land. `WHERE_IT_WENT` in
`render/terminal/brief.ts` is the whole of the wording. "Landed on the default
branch", never "shipped" — it is the plainest description of what `outcome.ts`
actually checked.

`--full` puts the same fact in its first labelled row. The intent stays above
it as the heading, because it is the title of the view rather than a row in it,
and cost and attribution close the view under the paths.

Nothing in the brief views is computed differently. They read the same
`intent`, `scope`, `drift` and `cost` the full view reads; what changed is how
much is said at once. Two consequences worth keeping:

- The **count** is always exact; the **paths** are what gets dropped. Three or
  fewer are named; past that the line gives the count and the two directories
  most of them are in. A sentence naming twelve paths is one nobody finishes,
  and the number in front of it is what decides whether to run `--full`.
- That rule is `summarizePaths` in `render/terminal/paths.ts`, and both views
  that name files go through it — `show`'s sentence and `stop`'s `changed` and
  `outside` lines. Each supplies its own separator, a comma for prose and two
  spaces for a column; neither owns the threshold. Two copies of it would be
  two chances for a reader to learn the rule in one view and meet a different
  answer in the other. Note `--full` deliberately does not cap: it is the view
  somebody opens *because* they want every path.
- Where the paths are not named, one directory holding all of them reads `all
  in db/` rather than `mostly in db/`. "Mostly" would understate a fact the
  paths have already settled, and this line is all the reader gets.
- **A declaration is never shortened; a captured prompt is.** The same rule and
  the same code as the pull request body — `headOf` in
  `render/terminal/intent.ts`, first sentence or first line, whichever ends
  sooner — because two copies of it are two chances for the two views to
  disagree about where somebody's first sentence ended. A declaration is the
  promise the diff is held to, and a brief view showing half of it would be
  hiding the yardstick; it wraps instead, over as many lines as it needs.
  `MAX_INTENT` is 500, so before this a captured prompt reached `show` as one
  sentence 568 columns wide, and the three sentences this view promises
  arrived as a wall.
- Where something **was** left out, the brief view says so and says where the
  rest is: the frame reads `Your first prompt began "…"` rather than `was`, and
  `REST_OF_IT` points at `session show --full`, which holds every word. A
  captured prompt that is already whole keeps `was` and gets no pointer —
  "began" in front of all of it claims there is more, which is the same lie in
  the other direction, and a pointer under a view that left nothing out
  teaches the reader to ignore the pointer. The bare screen shortens the same
  way, with an ellipsis and no pointer: the session has not finished, so there
  is no `--full` to send anybody to.
- **`--full` is where a whole prompt lives.** It is where the brief views send
  a reader who wanted the rest of one, so nothing in it is ever shortened —
  the heading holds every character up to `MAX_INTENT`. It is flattened and
  wrapped instead, and the times move from its gutter to under it once it
  takes more than one line.
- A gutter note — the `←` hints — stays beside its row only while the whole
  row fits the width; past that it goes under the row, in the value column.
  `declared`'s `SCOPE_HINT` is the long one, and it put that row 32 columns
  past the edge while every other row in the view fitted.
- `--full`'s path rows wrap into the value column, blank where the label was,
  and the gutter note moves underneath once they do — there is no gutter left
  to put it in when the paths are using it. Wrapping is not capping: every path
  still prints, because `--full` is the view somebody opens *because* they want
  every path. A path longer than the room takes a line to itself and overflows,
  since a path cut in half is one the reader cannot copy.
- The four cases of the drift sentence — the third — are ordered by which fact
  the reader most needs: something went outside, here it is; nothing changed at
  all; nothing was declared, so the question cannot be asked; everything stayed
  inside. Note "changed nothing" comes before "declared nothing" — a session
  that changed nothing had nothing to go outside a scope, and sending that
  reader to `--scope` answers a question they do not have.

The brief views add **no colour roles**. The intent is `intent`, the drift
paths are `drift`, the framing is `meta`, and the money is left in the
terminal's own colour — the same roles doing the same jobs as in the labelled
layout. A view that needed a new role would be a view saying something the tool
does not otherwise say. The same goes for `scan`: paths are `path`, prompts are
`intent`, framing is `meta`.

The outcome line each view now leads with takes **no ink at all**. It is the
one line that is always there, and colouring what is always there says nothing
— the same argument that leaves the cost figure uncoloured. `merged` and
`abandoned` stay where they mark one row out of a table of them.

## The week table

Columns, left to right: `id`, `started`, `intent`, `class` (`--class` only),
`outcome`, `drift`, `turns`, `tokens` (`--tokens` only), `empty`, `cost`.
Outcome sits in the left block with the text; the figures are right-aligned so
a column can be scanned.

`drift` **used to read `drift files`**, on the rule that a bare `drift` over a
column of small integers reads as a score. The unit cost six columns for a
column of single digits, and six was exactly what stood between this table and
an eighty-column terminal — and a table that wraps has no columns left to
misread. So the unit went, and the risk it guarded against is **real and
accepted**: nothing in this view names what the number counts. `week --md`
spells it `Unplanned` for a reader who was not there, and `show --full` lists
the paths under `outside`. A reader of this table who wants to know what
drifted opens one of those. If somebody reads the column as a score, that is
this decision surfacing, not a bug — and putting the unit back means finding
six columns somewhere else first.

Two consequences of outcome no longer being the last column. A row is trimmed
rather than padded, so an abandoned row's strikethrough stops at the last
figure instead of running out over trailing spaces — which is what the old
last-column rule existed to prevent, and it is now handled once in `tableRow`.
And the totals row can leave its cost cell empty without a ragged edge.

The intent column is the only one that flexes — see "How wide a view may be".
`INTENT_WIDTH` is its natural width, not the width every render uses: `measure`
gives it whatever the other columns leave, down to `MIN_INTENT`, and
`fixedWidth` counts the rest off the same `Widths` the row is laid out from, so
a column added to `tableRow` cannot leave that arithmetic behind and silently
push the table back over the edge. The cell is truncated twice on purpose —
once in `cellsFor` to the natural width, once at render to whatever the column
actually got.

The notes under the table sit in **two blocks with a blank line between them**:
what the table does not say, then the money and the two things that qualify it.
They had run to five dim sentences in a stack under a four-row table, which
reads as one paragraph nobody finishes. Every one of them is owed to the
reader, so none is dropped or folded into another — what they get instead is
the line that says they answer two different questions. It also leaves the
total where rule 3 wants it, with nothing between it and the end. `footnotes`
in `week.ts` is the whole of it, and it adds no blank line where either block
is empty.

The geometry lives in `render/terminal/week/table.ts`, the arithmetic and the
notes under the table in `week.ts`. The split is what keeps either under 400
lines; a reader chasing a misaligned column wants the first file and nothing
in the second.

Nothing in these views may be found by counting lines from either end. The
notes a week earns depend on what is in it, so a test reaching for `at(-2)` is
pinning how many notes one fixture happened to earn; find the note by what it
says.

## The id

`pr [id]`, `show [id]` and `mark <id>` all take one, and every view that prints
one prints the same eight characters, through `shortId` — `week`'s first
column, `show`'s bottom line and its `id` row, `settle`, `mark`, `survival
--check` and `verify`. One width is the whole point: a prefix read off a week
row has to be a prefix those commands answer to, and until the column existed
the only way to write a pull request body for anything but the last session was
to open the JSONL. It is not a flag — a session nobody can name is missing
information, not a preference.

## How old the prices are

Every money figure is quoted at a rate somebody wrote down on a day.
`pricesChecked` is the one line that says which day: dim, under the figure it
dates, in `week`'s footer and at the foot of `show --tokens`. It states the
date the bundled `rates.json` carries and where to override it, and stops
there — no threshold, no "these may be stale", no colour. Whether a fortnight
is stale depends on whether a vendor moved a price, which this tool cannot
know, and the reader holding the invoice can.

Printed only where there is a figure to date: a week nothing could be priced in
and a session whose model no rate covers both print no money, and a date under
either would read as an explanation of why the money is missing. `week --md`
carries none of it — the date belongs beside a figure being quoted, not in a
document about a week.

## Colour

Rationale: [Colour](../../../docs/decisions.md#colour).

`render/palette.ts` is the only file that knows an escape code, and the only
one that imports picocolors. Roles are named for what a thing *is* — `intent`,
`drift`, `waste`, `path`, `meta`, `merged`, `abandoned` — never for the ink
they get, so what the tool emphasises can be read off one file. `path` and
`meta` are both dim and are still two roles: the day one of them stops being
dim is a line here, not an audit of the layout code.

Only the 16 basic ANSI colours, and mostly attributes (bold, dim,
strikethrough). No 256-colour, no truecolor, no hex. The hues belong to
whoever configured the terminal — their red is legible on their background
because they picked it, and a hard-coded one is a guess about a background
this tool cannot see.

Red means *there is something here*: drift paths, and the waste figure only
when it is not zero. `$0.00` in red would teach the reader to ignore red, and
then the session that wasted $40 would go unread too. The cost figure itself
is never coloured — it is always there, and colouring what is always there
says nothing.

The `waste` ink survives in exactly one place: the `no edits` row of `session
show --full`, per session, where the reader asked for the detail. The aggregate
views dropped it when their money became a footnote — red inside a footnote
would make the footnote the loudest thing on the page, which is the arrangement
the ordering above exists to undo.

`colorEnabled` decides: `FORCE_COLOR` outranks everything either way, then
`NO_COLOR` (non-empty), then whether stdout is a TTY. Note this deliberately
differs from picocolors' own rule, which turns colour *on* under `CI` and on
Windows regardless of the stream — a CI log is a file somebody reads later.

The colourless render is the contract. It is what goes into pipes, files, CI
logs and bug reports, and `test/palette.test.ts` pins it byte for byte against
literals, plus asserts that stripping the codes out of the coloured render
gives back exactly the same bytes. Colour is an addition to a terminal, never
a change to the output. `plainPalette` is the same construction as
`ansiPalette` with the ink switched off, not a second hand-written table —
built the other way the two could come to disagree about what a role wraps.

## The pull request body

Rationale and a worked example:
[The pull request writes itself](../../../docs/decisions.md#the-pull-request-writes-itself).

`render/pr.ts` is pure — one session and the rates in, one Markdown string out,
no trailing newline, like `render/markdown.ts`. **No model writes any of it**,
and nothing here may ever call one: the document's whole claim is that it is a
transcription of the record, and its only sentences are the developer's own
intent and a few file lists.

It is the one view that does **not** lead with where the work went. There is
nowhere for it to have gone yet — the document exists to open the pull request
that would land it — so the summary line is the intent. Everything after that is
the usual order: what was declared, what changed, what went outside it, and the
money last, unemphasised, on one line.

- A **captured** intent is labelled in the summary line itself, not in a note
  under it, so it survives into a `--template` that asked only for
  `{{intent}}`. `CAPTURED_INTENT` is the wording, shared with `show`.
- A **captured** intent is also shortened to its first sentence or first line,
  whichever ends sooner, with the whole text folded into a `<details>` block
  under it. **A declaration is never shortened and never gets the block** — it
  is the promise the diff is held to, in full. Nothing is dropped and no model
  summarises anything: `headOf` in `render/terminal/intent.ts` is the only
  place where the head of a prompt is decided, shared with `show` and the bare
  screen, and `summarize` is the only place this document spends it. The block
  is fenced, with the fence longer than any run of backticks in the prompt, so
  a `</details>` or a code block somebody pasted cannot break out of it — the
  same class of failure as an unescaped `|` in the week table. Templates get
  the short line as `{{intent}}` and the whole text as `{{intent_full}}`, and
  no block: the author places it.
- The drift section is **omitted entirely** when nothing went outside, and also
  when no scope was declared — whatever `drift` holds. Same rule `driftOf` and
  `show` follow: without a declaration there is no distance to measure.
- File lists are **not** capped and must not go through `summarizePaths`: every
  path prints, one per line, grouped by directory and sorted inside each group.
  That cap is for a terminal line, and there is no line here — the file list is
  what a reviewer is reviewing. Sorting alone does not group, so the grouping is
  its own step. Paths stay whole; never a directory heading with bare filenames
  under it, which cannot be copied into a search.
- The cost line obeys the unpriced rule through `unpricedTokens`, the same
  function `week`, `scan` and `stop` name an unpriced model with. A session
  nothing was captured for says so rather than printing `$0.00 · 0 turns`.

**Stdout carries the document and nothing else** — no sweep notice, no
confirmation — because `session pr | gh pr create --body-file -` is what the
command is for. `--copy` and `--out` print what they did *instead of* the
document, since neither leaves anything to pipe.

`--template` fills `{{intent}}`, `{{scope}}`, `{{changed}}`, `{{drift}}` and
`{{cost}}`. Values arrive plain — no headings, no emphasis — since the author
supplied their own. An unknown placeholder is **refused by name**, every
unknown one at once, never left in the output: `{{autor}}` reaching a pull
request is found by a reviewer rather than by the person who could have fixed
it. `{{drift}}` always says something, unlike the default document which drops the
section, because a template's heading is not ours to drop — and it has
**three** states where the body has two: the paths, `Nothing went outside the
declared scope.`, and `NO_SCOPE` for a session that declared none. That last is
the one an implementation gets wrong, and it is the same string `{{scope}}` and
`## Declared scope` use.

A `--template` that will not open says **which** way it failed: missing (with
the note that the path is read from the working directory), a directory, or
permission denied, and anything else keeps the errno's own message. One
sentence over all of them sends half the readers to the wrong fix — a typo'd
path looks like a permissions fault, and a real file looks like a typo.

## Markdown

Rationale and a worked example:
[Handing the week to someone else](../../../docs/decisions.md#handing-the-week-to-someone-else).

`session week --md` writes the week for somebody who was not there — meeting
notes, a Slack post, a Notion or Confluence page. `--copy` puts it on the
clipboard instead of stdout, and implies `--md`, since a terminal table is not
what anybody pastes into a page.

A different document from the terminal table, not the same one with the escape
codes taken out. It leads with the figures that survive being read cold — what
shipped, what did not, what is still open, and how many files went outside the
plan — and the table comes after them.

It obeys the ordering rules above like every other view. The headline carries
no money at all; the columns are `Date`, `Work`, `Outcome`, `Unplanned`,
`Cost`, in `week`'s order with cost last; and what the week cost is the closing
line, through `spentFigure`. Every count in the headline is a count of
something observed, and nought of something observed is a fact — which is why
none of them can go absent the way the closing figure can.

`render/markdown.ts` is pure: sessions, rates and a clock in, one string out,
with no trailing newline. The clock is injected so the heading is a function of
its arguments. Plain Markdown throughout — no colour, no escape codes, no box
drawing, and `test/markdown.test.ts` asserts all three.

**The tick is the one place emoji are allowed.** The ban in Style is about a
terminal, where a glyph may not render and so cannot be relied on to carry
meaning. A Notion page is not that place, and a column of ticks is what
somebody skimming for "did anything ship" is looking for. Nothing else in the
document carries one, and nothing in a terminal view ever should.

Three things the table cannot survive, all handled in `workCell` in this order:
a newline ends a row wherever it falls; the width is measured before escaping,
so the limit counts characters a reader sees; and an unescaped `|` silently
splits a row into two cells and shifts everything right of it. That last one is
why nothing here interpolates an intent raw, and there is a test that a pipe in
an intent leaves the row with exactly five cells.

Every figure in the document is over the sessions the table lists, so the total
row is a total of the rows above it. That is a departure from `week`, where an
empty session's spend stays in the total: here the empty sessions are not rows,
and a total larger than the column under it is a table that visibly does not
add up. What they cost is stated in its own line below instead — disclosed, not
folded in.

The one cell that totals nothing is `Cost`, left empty on purpose, the same as
`week`'s. The closing line is the only total, so there is no second copy of it
sitting in the middle of the columns the table is read for.

A session with no figure is handled per row and per document, and there are two
kinds. A model with no rate reads `unpriced`; a session with **no turns on the
record** reads `not captured` — nothing was found to price it with, and no rate
would fill that. Never `$0.00` for the second: `start` and `stop` see the diff
whether or not an adapter saw anything, so that session may well have changed
files and been billed for them.

The closing figure is over the rest, and `coverageNote` above it says how much
of the table the money covers and what it leaves out, naming the two apart —
"below", since the figure it points at is the closing line. Both come off
`spendOf`'s counters, and they have to: a cell whose word no note underneath
counts is a hole the reader can see and the report will not admit to.
