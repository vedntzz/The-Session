# Title options

1. Show HN: The Session – a local signed log of AI coding work
2. Show HN: Record what coding agents changed, cost, and merged

# First comment

I'm Vedant, the developer of The Session, an open-source CLI for Claude Code
and Codex. It records what you asked for, which files changed outside your
declared scope, captured token costs, and whether the work reached the
default branch. The record lives in a signed, append-only log on your machine.

The 3.1 release adds a PR card and a GitHub Action that updates one comment
on a pull request. Intent text is hidden in posted cards unless you opt in.
Records reach CI through your existing git remote; source code and
transcripts aren't included in those records.

One CI bug made the signed chain's guarantees concrete. Linux can reuse a
freed inode. Our stale-lock check compared inodes, so a replacement lock could
look like the abandoned one. Two writers believing they held the lock could
have appended records with the same predecessor, forking the chain. The fix
checks the lock's bytes too.

This doesn't judge code quality or decide whether a task met its intent.
Missing capture stays unknown; unpriced usage isn't reported as free.
Deletion-only sessions don't match PRs, and the card doesn't detect later
reverts. A narrow lock takeover race remains.

I'd like feedback on the evidence you'd need to trust a PR card, and where
content-based merge matching falls short in your workflow.
