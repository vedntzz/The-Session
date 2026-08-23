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

`session show` is two sentences and a line of three figures: what was asked
for, what went outside what was declared, and cost / turns / turns that
produced nothing. The labelled layout is `--full`, and `--tokens` implies it
rather than being quietly ignored.

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
- The four cases of the second sentence are ordered by which fact the reader
  most needs: something went outside, here it is; nothing changed at all;
  nothing was declared, so the question cannot be asked; everything stayed
  inside. Note "changed nothing" comes before "declared nothing" — a session
  that changed nothing had nothing to go outside a scope, and sending that
  reader to `--scope` answers a question they do not have.

The brief views add **no colour roles**. The intent is `intent`, the drift
paths are `drift`, the framing is `meta`, and the money is left in the
terminal's own colour — the same roles doing the same jobs as in the labelled
layout. A view that needed a new role would be a view saying something the tool
does not otherwise say. The same goes for `scan`: paths are `path`, prompts are
`intent`, framing is `meta`.

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

## Markdown

Rationale and a worked example:
[Handing the week to someone else](../../../docs/decisions.md#handing-the-week-to-someone-else).

`session week --md` writes the week for somebody who was not there — meeting
notes, a Slack post, a Notion or Confluence page. `--copy` puts it on the
clipboard instead of stdout, and implies `--md`, since a terminal table is not
what anybody pastes into a page.

A different document from the terminal table, not the same one with the escape
codes taken out. It leads with the two figures that survive being read cold —
what the week cost and what shipped — and the table comes after them.

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

The same rule covers a model with no rate. The cost cell says `unpriced`, the
totals are over the rest, and a line below says how much of the table the money
covers and which models were left out. Note a session with no turns and no api
calls is `$0.00` rather than `unpriced`: nothing was captured for it, so it
moved no tokens and there is no rate it is missing. That has to agree with
`spendOf`, which makes the same call — a cell reading `unpriced` under a note
counting no unpriced sessions is a hole the reader can see and the report will
not admit to.
