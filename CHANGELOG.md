# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `session` with no arguments: a state screen, not a menu — one sentence on
  where the repo stands and at most two commands worth typing next.
- `session help all`, listing every command with its description, read off the
  command tree rather than a hand-kept list.
- `session week --md`, a Markdown table for meeting notes, Slack, Notion or
  Confluence, and `--copy` to put it on the clipboard instead of stdout.
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

- `session --help` now lists four entry points instead of fifteen. Nothing was
  removed from the parser; `session help all` lists the rest.
- `session show` is two sentences and three figures by default. The labelled
  layout moved behind `--full`, which `--tokens` now implies.
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

[Unreleased]: https://github.com/vedntzz/The-Session/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/vedntzz/The-Session/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/vedntzz/The-Session/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vedntzz/The-Session/releases/tag/v0.1.0
