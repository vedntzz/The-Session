# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Turns that produced nothing are settled against git, not against tool
  names.** The old rule called a turn productive when the transcript showed an
  `Edit`, `Write`, `MultiEdit` or `NotebookEdit` block in it. Agents write
  files through the shell constantly — `Bash` outnumbered `Edit` and `Write`
  together by nearly 3:1 across 27 real transcripts — so a session that changed
  seven files was recorded as two turns of two empty and twenty-eight calls of
  twenty-eight without edits: 100% waste for a session that did all of its
  work. `stop` now reconciles the captured cost against the diff it already
  computed, and records `emptySource: "git"`.
- What the diff settles is whether the *session* wrote anything, never which of
  its turns did. So a session that changed files reports **no** empty-turn
  figure rather than a nought: an em dash in `week`, `not measured` in `show
  --full`, one figure fewer in `show` and in the pull request body, and a note
  under the week table naming how many sessions could not be counted. A session
  that changed nothing reports every turn as empty and its whole spend as
  waste, which is a measurement.
- `callsWithoutEdits` is no longer written or displayed anywhere. It was the
  same guess at a grain git cannot help with. The field stays on the type so
  existing records still verify.
- Records written under the old rule keep their figures, since for a session
  that really used `Edit` they are right — except the one git refutes outright:
  a session that changed files cannot have had every turn produce nothing.
  Those now read as not measured.
- `session scan` no longer reports empty turns or what they cost. It reads
  transcripts and has no base commit to diff against; it says so rather than
  printing a figure, the same refusal that keeps `merged` out of that report.

### Fixed

- `session start --scope` with nothing in it — what a shell leaves behind when
  `--scope "$paths"` expands to an empty string — is refused instead of
  recording `scope: []`. That record says no scope was declared when one was,
  and it is append-only and signed, so it is the one mistake here that cannot
  be taken back: `show` would report nothing to drift from, and `debt` would
  start building a case against files the developer had declared.

### Changed

- `session pr --template` says *which* way a template failed to open: missing
  (naming the path, and that it is read from the working directory), a
  directory, or permission denied — anything else keeps the system's own
  message. One `Could not read` over all of them sent half the readers to the
  wrong fix: a typo'd path read as a permissions fault, and a real file read as
  a typo.

## [0.6.0] — 2026-08-31

### Added

- `session debt`: the files work keeps landing in that nobody ever declared.
  Per repository, a path that drifted in three or more sessions and has been
  declared in none since — a later declaration clears it, because that is the
  tool working. Docs, config and build files are never listed; they are touched
  by everything and owned by nobody. A repo with fewer than three recorded
  sessions is told its history is too short rather than shown an empty list,
  since "found nothing" and "could not look" are different statements.
- `session survival`: whether merged work is still there 14 and 30 days later,
  checked against the default branch per path and written into the log as a
  dated observation. `--check` runs the checks that have fallen due. The one
  figure in the tool that is not recomputed on every view, and cannot be — the
  branch says what it holds today, never what it held on day 14.
- `session cochange`: the files that keep changing together, per repository,
  and how reliably. A pair has to have moved together in three or more sessions
  and account for at least 70% of the commoner file's history, so a file that
  changes in everything is not reported as the partner of everything. Pairs
  whose files are no longer at the branch tip are marked `(gone)`, and
  `--current` lists only the pairs still there.
- `session pr [id]`: a pull request body written from the record — the intent,
  the declared scope, every changed path, what went outside the plan, and what
  it cost. Prints to stdout so it pipes into `gh pr create --body-file -`;
  `--copy` for the clipboard, `--out <path>` for a file, and `--template
  <path>` for a team's own format, filled from `{{intent}}`, `{{intent_full}}`,
  `{{scope}}`, `{{changed}}`, `{{drift}}` and `{{cost}}`. An unknown
  placeholder is refused by name rather than left in the output. No model
  writes any of it: the document is a transcription of the record, which is
  invariant 3 held at the point where breaking it would be most expensive.
- Automatic settling and due survival checks, once a day per repository, from
  the editor hook and opportunistically from `week`, `show` and the bare
  screen. Silent unless something was written, and both commands still work by
  hand.

### Changed

- `session week`, `session show` and `session` with no arguments now settle
  outcomes and run due survival checks on the way past, at most once a day per
  repo. They say so only when something was actually written, and never fail
  their host command.
- A captured intent in `session pr` is shortened to its first sentence or its
  first line, whichever ends sooner, with the whole prompt folded into a
  collapsed block beneath it. Nothing is dropped and nothing is summarised by a
  model. A declared intent is never shortened — it is the promise the diff is
  held to, in full.

### Fixed

- A repository that gained an origin remote changed identity and began a second
  log under the new key, leaving every report reading only one of the two
  halves. `week`, `estimate`, `show`, `settle` and `debt` now fold both into one
  history at read time. Nothing on disk is moved: the two hash chains stay
  intact and `session verify` can still walk each line by line. Left unfixed,
  months of history could sit split across two files with each half below the
  threshold at which any report will speak.

## [0.5.0] — 2026-08-25

**Tagged, never published.** This version exists as a local commit and a
`v0.5.0` tag, and it never reached the registry: npm goes 0.4.1 (23 Aug) →
0.6.0 (30 Aug), so `npm install @vedantzz/session@0.5.0` has never resolved and
no user has ever run this version under this number.

Nothing below is being backfilled and 0.5.0 will not be published now — a
version number that was skipped is a fact about what happened, and quietly
filling the hole four releases later would make the registry agree with a story
rather than with events. The changes themselves are real and did ship: they
reached users inside 0.6.0. The section stays here, under its own number, so
that a reader following the tags is not left wondering what became of it.

### Changed

- Every view reordered around what it is for. Where the work went and how far
  it went outside the plan now come first; what it cost is one dim line at the
  bottom and nowhere else. The agents meter their own spend, so a view that
  opened on a dollar figure was answering a question its reader had already had
  answered. `session show` leads with a sentence about where the work landed,
  `week` and `scan` with counts, and the totals row leaves its cost cell empty.
- `session week --md` follows the same order: the headline carries no money at
  all, and what the week cost is the closing line. The terminal view and the
  document now share one `spentFigure`, so the two cannot come to disagree
  about what a week cost.
- `session week`'s table geometry moved to `render/terminal/week/table.ts`,
  apart from the arithmetic and the notes under the table, with no change in
  behaviour.

## [0.4.1] — 2026-08-23

### Changed

- Readme documents `session scan`. No code changed in this release.

## [0.4.0] — 2026-08-23

### Added

- `session scan`: what the agent sessions already on this machine have cost,
  with no setup and nothing recorded beforehand. Reads Claude Code's
  transcripts, groups by repository, and reports the spend, the share of it
  that went to turns which changed no files, and the three dearest sessions.
  `--days`, `--repo` and `--open`. Read-only — it writes no record, touches
  nothing under `~/.session`, and modifies no repo.
- Bundled prices for the current Claude and OpenAI models, beside the older
  ones already in `rates.json`. The file now records the date its prices were
  checked and where to check them again.
- A model no rate covers now prints a complete `~/.session/rates.json` — the
  whole file with that model in it and every field present, ready to paste and
  fill in — in `week` and in `estimate`, in place of the bare pointer at a
  filename.

### Changed

- `session stop` names the model on its cost line when no rate covers it, in
  the same words `week` and `scan` use.
- `session week` says `all of it shipped` where no spend went to unmerged work,
  rather than printing `$0.00` for a category with nothing in it. Money on
  sessions that changed no files is reported apart, so a week of those is never
  read as a clean sweep.
- `session stop` caps its `changed` and `outside` lines the way `session show`
  caps its sentence: three or fewer paths are named, and past that the line
  gives the count and the two directories most of them are in. Both views go
  through one summariser, so the rule cannot come to differ between them.
- Every function in `src/` refactored below 20 lines of code, with no change in
  behaviour and no test modified.
- What a Claude Code transcript line means moved to `capture/transcript.ts`,
  shared by the adapter and `scan` so the two cannot come to disagree about
  what a turn is or what a call cost.
- The sentence under `session --help` naming the commands it leaves out is now
  read off the command tree. Written by hand it had already gone stale by
  three commands.

### Fixed

- `session --version` reported `0.3.0` on a `0.3.1` package. The version is now
  read from `package.json` at runtime, resolved against the module rather than
  the working directory, so a global install run inside another repo still
  reports its own version and a release cannot bump one without the other.

## [0.3.1] — 2026-08-21

### Added

- `session` with no arguments: a state screen, not a menu — one sentence on
  where the repo stands and at most two commands worth typing next.
- `session help all`, listing every command with its description, read off the
  command tree rather than a hand-kept list.
- `session week --md`, a Markdown table for meeting notes, Slack, Notion or
  Confluence, and `--copy` to put it on the clipboard instead of stdout.

### Changed

- `session --help` now lists four entry points instead of fifteen. Nothing was
  removed from the parser; `session help all` lists the rest.
- `session show` is two sentences and three figures by default. The labelled
  layout moved behind `--full`, which `--tokens` now implies.

### Fixed

- A total nothing could be priced rendered as `$0.00`, which reads as a week
  that cost nothing rather than one nobody knows the cost of. Every view that
  prints a total now tests both halves — nought only where nothing was spent,
  an em dash where no rate covered the models — through one `unpricedThroughout`
  rather than the two-clause test spelled out in each renderer.

## [0.3.0] — 2026-08-19

### Added

- `session push`, `session pull` and `session peers`: records travel to a team
  over `refs/session/<fingerprint>` on a git remote you already have. One ref
  per signing key, so two developers can never write the same one.
- `session verify --peers`, walking every chain pulled into the repo and
  reporting each key on its own row rather than summing them.
- Passive capture: `session hook install` can open a session nobody declared
  and take its intent from the first prompt, recorded as `captured` rather than
  `declared` so the two are never mistaken for each other.
- `session week --intent declared|captured`, and an `empty` outcome for
  sessions that changed no files.
- Colour, through a single palette module: roles named for what a thing is,
  only the 16 basic ANSI colours, and `!` still marks drift where colour cannot.

### Changed

- `session estimate` reports declared and captured sessions as two blocks and
  never a total, with the five-session floor applied to each block on its own.
- Empty sessions are named and counted in `week` and `estimate` rather than
  dropped, and left out of every figure about work.

### Fixed

- Sessions that changed no files were counted in the unmerged spend, inflating
  a figure about work that never landed with work that was never attempted.
  Their cost stays in the total, because it was spent.

## [0.2.0] — 2026-08-18

### Added

- Prices in dollars everywhere tokens used to be, from a bundled `rates.json`
  you can override entry by entry at `~/.session/rates.json`.
- Outcome detection: merged, abandoned, open or empty, decided on the content
  a session left rather than on commit shas, so squash merges and rebases do
  not read as abandoned.
- `session settle` to write that answer down as a signed observation, and
  `session mark <id> merged|abandoned` for what the repository cannot know.
- A tamper-evident log — per-line hash chain, embedded key fingerprint and
  Ed25519 signatures — with `session verify`, `session verify --log <path>
  --key <pubkey>` for a log someone sent you, and `session key show`.
- `session estimate "<intent>"`: what sessions of the same class have cost,
  their median, p90, first-time merge rate and the paths they kept drifting into.
- Session classes (`schema`, `api`, `ui`, `test`, `config`, `docs`, `build`,
  `other`), from an ordered table of path rules, plus `session week --class`.
- Attribution in a checked-in `.session.json` via `session config set`, copied
  onto each session at start, and `session week --client` / `--project`.

### Changed

- A model with no rate is reported unpriced, with its tokens and its name,
  rather than priced at the nearest model's rate.
- An unpriceable window prints an em dash, never `$0.00` — nought and unknown
  are not the same figure.

## [0.1.0] — 2026-08-15

### Added

- `session start "<intent>"` and `session stop`: an append-only JSONL record per
  repo under `~/.session/`, with intent written once and never editable.
- Drift detection — `scope` declared, `reality` observed from the git diff, and
  `drift` as the difference — recorded rather than blocked.
- A `baseline` of what was already dirty at start, subtracted from reality, so a
  session is not billed for work that was sitting there before it.
- The Claude Code transcript adapter, behind an interface, reporting four token
  counters kept apart because they bill at four different rates.
- Turns and API calls counted separately, including those that changed no files.
- `session show`, `session week`, and `session week --open` for the same window
  as a self-contained HTML page.
- `session hook install`, registering the Claude Code hook that closes a session
  when the agent stops.

### Fixed

- Field reconciliation, so a patch record folds onto the session it belongs to
  instead of clobbering fields the creating record set.
- The hook now fires reliably on `SessionEnd`, under a 10-second timeout.
- `week --open` no longer paints the waste hue over a figure of zero.

[Unreleased]: https://github.com/vedntzz/The-Session/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/vedntzz/The-Session/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/vedntzz/The-Session/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/vedntzz/The-Session/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/vedntzz/The-Session/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/vedntzz/The-Session/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/vedntzz/The-Session/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/vedntzz/The-Session/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vedntzz/The-Session/releases/tag/v0.1.0
