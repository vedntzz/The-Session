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

`session show` is three sentences and a line of three figures: where the work
ended up, what was asked for, what went outside what was declared, and then
cost / turns / turns that produced nothing. The labelled layout is `--full`,
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

Columns, left to right: `started`, `intent`, `class` (`--class` only),
`outcome`, `drift files`, `turns`, `tokens` (`--tokens` only), `empty`, `cost`.
Outcome sits in the left block with the text; the figures are right-aligned so
a column can be scanned. `drift files` carries its unit because a bare `drift`
over a column of small integers reads as a score.

Two consequences of outcome no longer being the last column. A row is trimmed
rather than padded, so an abandoned row's strikethrough stops at the last
figure instead of running out over trailing spaces — which is what the old
last-column rule existed to prevent, and it is now handled once in `tableRow`.
And the totals row can leave its cost cell empty without a ragged edge.

The geometry lives in `render/terminal/week/table.ts`, the arithmetic and the
notes under the table in `week.ts`. The split is what keeps either under 400
lines; a reader chasing a misaligned column wants the first file and nothing
in the second.

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
  summarises anything: `summarize` is the only place this is decided. The block
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
it. `{{drift}}` has a sentence for the empty case, unlike the default document
which drops the section, because a template's heading is not ours to drop.

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

A model with no rate is handled per row and per document. The cost cell says
`unpriced`, the closing figure is over the rest, and the note above it says how
much of the table the money covers and which models were left out — "below",
since the figure it points at is the closing line. Note a session with no turns
and no api calls is `$0.00` rather than `unpriced`: nothing was captured for
it, so it moved no tokens and there is no rate it is missing. That has to agree
with `spendOf`, which makes the same call — a cell reading `unpriced` under a
note counting no unpriced sessions is a hole the reader can see and the report
will not admit to.
