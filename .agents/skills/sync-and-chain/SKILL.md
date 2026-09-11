---
name: sync-and-chain
description: Load when touching the on-disk log format, the hash chain, signing keys, `session verify`, or moving records between machines — editing chain.ts, keys.ts, verify.ts, sync.ts, store.ts appends, or anything that reads or writes refs/session/*. Also load before changing what a record hashes over, adding a field to LogRecord, collapsing an empty log into a passing verify, summing peers into one verdict, or making push/pull reach anything other than a git remote.
---

# The log on disk, and how it travels

How a session becomes lines in a file, what makes those lines tamper-evident,
and how they reach a teammate. The rationale, with worked examples, is in
[The log is tamper-evident](../../../docs/decisions.md#the-log-is-tamper-evident)
and [Sharing them with the team](../../../docs/decisions.md#sharing-them-with-the-team)
— this file is the rules a change has to hold to.

Both halves serve **invariant 2**: data lives in JSONL on the user's disk, and
records travel over a git remote the team already has, by git talking to git.
Nothing here may reach a service of ours, because there isn't one.

That invariant used to read "if a change requires network access, it's wrong",
and the flat ban held until records had to reach a teammate. What replaced it
is narrower, not looser: bytes move only when somebody types `push` or `pull`,
and only by git talking to git. No service of ours is involved, which is what
the ban was protecting. Anything that would need one is still wrong — don't
read `sync.ts` as a precedent for a client, a daemon or an endpoint.

## The line on disk

A session is folded from patch records. Each record is one line, and every line
carries its own tamper-evidence:

```ts
type LogRecord = {
  v: number
  id: string
  at: string
  set: Partial<Session>
  prev: string            // SHA-256 of the whole previous line, GENESIS for the first
  key: string             // fingerprint of the signing key — which key to ask for
  hash: string            // SHA-256 of canonical({v,id,at,set,prev,key})
  sig: string             // base64 Ed25519 over the bytes of hash
}
```

Records written before this existed carry none of these. They are hashed into
the chain by the first signed record after them, counted as `unsigned`, and
never reported as damage. Records signed before `key` was added omit it, and
`canonicalJson` drops undefined, so they still hash exactly as they did — do
not "fix" that by defaulting `key` to a string.

`key` is a claim, not a proof: it says which key the log wants to be checked
against, which is what a holder of the log alone needs. It catches a log that
disagrees with itself about its key, and a log that disagrees with a key the
verifier already had. It cannot catch a wholesale rewrite under a new key —
see [What it does not do](../../../docs/decisions.md#what-it-does-not-do).

`prev` makes the append a read-then-write, so appends take a lock file
(`<log>.lock`, created `wx`, stale after 10s). Reading is untouched:
`readSessions` folds records exactly as before and checks nothing — `session
verify` is the only thing that walks the chain.

`session verify --log <path> --key <pubkey>` must keep working on a machine
with no `~/.session` at all: with `--log`, nothing derives a store path, and
this machine's own key is never reached for. Checking a stranger's log against
your own key would report a mismatch that means nothing. See
[Checking a log you were sent](../../../docs/decisions.md#checking-a-log-you-were-sent).

A log with no records in it reports `no records` and exits non-zero. Nothing
about it contradicts itself, so `isIntact` is true and stays true — that is
what it means — but `verify` is an evidence tool, and answering "verified" to
a file it read nothing out of is a vacuous pass, which is a defect. `isEmpty`
is kept separate from `isIntact` for exactly this reason; don't collapse them,
and don't make an empty log a chain break either, since nothing is broken.
The same rule covers `--peers`: a chain with no records fails, and so does
finding no chains at all.

`session verify --peers` walks every chain under `refs/session/*` and reports
each key on its own row. Not summed: each chain is one key's statement about
its own work, so "4 of 5 keys check out" is not a fact about anything, and a
break in one says nothing about the others. A key is only ever used on the
chain that claims it — this machine's key on this machine's ref, a `--key` on
the ref whose fingerprint matches — for the same reason a foreign log is never
checked against the local key. Everything else gets hashes only, and the row
says so rather than implying its signatures were checked. A plain `verify`
walks one log, so where other chains are present it says they went unchecked;
one log verifying is not everything here verifying.

## One repo, two logs

A log is filed under `keyOf(repoIdentity(cwd))`, and the identity is the origin
remote where there is one, the repository root where there is not. So a repo
that gains an origin **changes key**, and `session start` opens a second log —
everything recorded before it stays in the first, under `path:<root>`.

**Writing stays single-file.** `resolveStoreFile` still resolves one path and
every append goes there. Two logs are two hash chains, signed at different
times; appending to the older one would fork it, and splicing them into one
file would rewrite lines `verify` is entitled to walk. Don't "fix" the split by
moving, merging or rewriting files on disk.

**Reading merges them.** `sameRepoLogs` asks the checkout for its origin, and
where there is one also reads the log keyed on `path:<root>` for the same
checkout. `readSessions` folds both and relabels the older sessions to the
current identity, so every view — `show`, `week`, `estimate`, `settle`, `home`
— sees one history. `readLog` is untouched and single-file, which is what
`verify` and `sync` read: one chain is one key's statement about one file, and
neither may be handed two.

`foldLogs` folds **across** logs into one map, oldest first, rather than
folding each and concatenating. A session can span both files — a `settle`
after the remote was added patches a session created before it — and folded
apart that patch anchors to nothing and is dropped as dangling, so the outcome
would be on disk and in no view. Don't reintroduce a per-file fold.

Only path → remote resolves. A checkout with a remote can be asked what it used
to be called; a remote-keyed log names no directory to go and ask. The origin is
looked up at read time, never remembered on the record: `session.repo` says what
the repo was called when the record was written, and that is a fact about the
past which is never rewritten on disk.

`debt` applies the same rule machine-wide, where it has no cwd to start from:
it resolves each path-keyed log's own directory and merges only into a remote
some other log is already keyed on — the resolution is the evidence that two
logs are one repo, and with nothing to merge into it says nothing worth acting
on. A directory that is gone, is no longer a repo, or still has no remote
answers nothing, and its log stays where it is.

## Sync

Rationale: [Sharing them with the team](../../../docs/decisions.md#sharing-them-with-the-team)
and [Checking what the team published](../../../docs/decisions.md#checking-what-the-team-published).

Records travel on `refs/session/<fingerprint>`, one ref per signing key. That is
the whole conflict story: only the machine holding a key writes that key's ref,
so two developers cannot write the same one and there is nothing to merge.

The log is a blob in a tree under a commit whose parent is the previous push, so
the ref carries the history of what was published and when. A rewrite is a tip
that does not descend from the old one — visible in `git log <ref>`, not silent.
A push whose log is byte-identical to the tip makes no commit; an empty commit
per push would fill that history with pushes that published nothing.

`pull` fetches every key's ref and stops. It never merges them into the local
log and never writes to it: a chain is one key's statement about its own work,
and folding two together would produce a file no key could stand behind. Peers
are read-only, and this machine appends to exactly one log — its own.

`push` verifies before it publishes and refuses a broken chain. Publishing a log
that does not add up would put this machine's name on it. `peers` checks each
peer's hashes on the way past — their signatures cannot be checked, since their
key is not here — and names any log that contradicts itself.

`(this machine)` is decided against the keypair in `~/.session/keys` and
nothing else: a ref name is a claim by whoever pushed it, and records that look
like ours are still not ours. The key is read, never generated — being asked
who else is out there is not a reason to start signing on a machine that never
has — so where there is no key here, nothing is labelled ours, which is true:
nothing on that machine could have written a chain.

Nothing lands under `refs/heads`, `refs/remotes` or `refs/tags`, so `git log`,
`git status` and `git branch -a` are untouched. `git log --all` does show these
refs, the same way it shows `refs/notes` and `refs/stash`: it means every ref,
and nothing can be both pushable and invisible to that.

All git plumbing sits below one line in `sync.ts` — hash-object, mktree,
commit-tree, update-ref, push, fetch, for-each-ref, cat-file — and everything
above it is pure. No porcelain, no index, no work tree.
