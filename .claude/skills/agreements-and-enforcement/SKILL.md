---
name: agreements-and-enforcement
description: Load when touching accepted terms or anything that checks a write against them — editing agreement.ts, agreement-decision.ts, write-session.ts, capture/write-request.ts, capture/adapters/claude-write.ts, commands/resolve-write.ts, commands/check-write.ts, commands/review.ts, or `session hook install --enforce`, which registers `session hook check`. Also load before adding an agreement field or action, emitting `allow` or the host's `defer`, letting a payload choose a repository or session, turning a parse or resolution failure into silence, logging an attempted write, or widening what the review screen accepts.
---

# Accepted terms, and the check against them

An agreement is what the developer accepted before work started. The check is
what an editor asks before a write. The contract, with every edge case, is
[docs/agreements.md](../../../docs/agreements.md) — this file is the rules a
change has to hold to. How the terms are signed and why they cannot be patched
is in the `sync-and-chain` skill; how the review screen reads is in
`terminal-output`.

## The terms

```ts
agreement: { paths, actions: ("create"|"edit"|"delete")[], sensitivePaths,
             policy: "record" | "ask" | "deny" }
```

- **Absent means none was recorded, never default terms.** A session without
  an agreement adds no restriction; nothing may read absence as acceptance of
  the review screen's starting draft.
- **Paths are scope prefixes, not globs.** They go through `normalizeEntry`,
  the same rule `scope.ts` applies at directory boundaries. `.` names the whole
  repo; `[]` accepts nothing. Don't build a pattern language here either.
- **Actions are file operations, not tool names.** `agreement.ts` knows nothing
  about Edit, Write or any editor — invariant 5. A new tool maps onto these
  three; it does not add a fourth.
- **`sensitivePaths` applies even inside accepted paths**, and even under `.`.
- **`agreement.paths` is `session.scope`.** One yardstick: drift and debt read
  scope, and on an agreed session the two are fixed together at creation. A
  caller supplying both must supply matching sets.
- **Every field is required** once an agreement is supplied. `parseAgreement`
  refuses unknown keys, so the original proposal cannot ride in beside it.

## Accepting them

Only the word `accept` writes an agreement. Enter, `yes` and anything unknown
change nothing; `cancel`, end of input and a signal write no record and create
no signing key. Terms are edited as JSON lists so a comma or space inside a
filename stays one path. An edit that fails validation keeps the last valid
draft. Intent is not editable here — invariant 1.

Start conditions are checked before the prompt **and again at acceptance**;
HEAD and the dirty baseline are taken after acceptance, so anything changed
while the screen was open counts as pre-existing work, not the session's.

A Prime review cannot accept an empty scope. External proposals are refused
by the review rather than shown under Prime's name: ingesting them needs its
own design, and a mislabelled proposer is a false record.

## Deciding one write

`decideAgreementWrite` is pure: an agreement and one resolved write in, a
decision and **every** violation out — `outside-paths`, `action-not-accepted`,
`sensitive-path`. No violations, or policy `record`, gives `defer`; otherwise
the policy. Record-only keeps the violation list. `defer` means "no decision",
never "complied", and never "it happened" — the diff at stop is what says what
happened.

It throws on an unresolved or non-canonical path rather than matching a guess,
because the spelling decides which terms apply.

## From a payload to a decision

1. **Parse** (`claude-write.ts`): Edit, Write and the legacy MultiEdit shape.
   Keep `cwd` and `filePath` and drop everything else — content, replacement
   strings and transcript paths are never held. `unsupported` (another tool)
   and `invalid` (a malformed supported one) are different answers and stay
   different. The payload is capped at 2 MiB, and stdin is bounded while it is
   read, not after.
2. **Resolve** (`resolve-write.ts`): read-only, against a trusted root the
   caller supplies. An existing regular file is `edit`, an absent one `create`;
   empty content never means `delete`. An in-repo symlink returns both the
   requested and the physical path. Outside the repo, `..`, dangling or cyclic
   links, directories, hard links and filesystem errors are `blocked` with a
   static reason — never an empty result, never a permission.
3. **Select** (`write-session.ts`): the single open session whose `checkout`
   is this canonical checkout. Two open here is `ambiguous`; an open agreement
   with no binding is `unbound`. Both deny. Sessions from another checkout
   sharing the remote are ignored. None open here means no restriction.
4. **Check** (`check-write.ts`): decide every resolved path and keep the
   strictest. Print one PreToolUse JSON response for `ask`/`deny`, or nothing.

## What the check may never do

- **Emit `allow`.** Silence already leaves the editor's permissions in charge;
  `allow` would override them, and a bug here would become a grant.
- **Emit the host's literal `defer`.** It pauses non-interactive runs. Internal
  `defer` is translated to silence.
- **Let the payload choose.** The process cwd picks the repository, checkout
  and session. The payload's `cwd` only anchors a relative path, and must
  itself resolve inside the trusted root.
- **Fail open.** Oversized or malformed input, an unreadable log, a missing
  checkout and a blocked path under `ask`/`deny` are denials. Only the
  no-agreement, record-only, compliant and unsupported-tool cases are silent.
- **Echo what it read.** Reasons are static strings and violation codes. No
  source text, no path, no exception message — invariant 2 applies to a hook
  response as much as to a network call.
- **Write.** No record, no attempt log, no settings, no files. Record-only
  measurement is the stop-time diff, as before.

## What it does not promise — keep saying so

- A snapshot, not a sandbox: the filesystem can change between the check and
  the write, and aliases beyond the two checked names are not enumerated.
- Shell writes and other tools are not intercepted.
- Binding is to a checkout path, not an editor process: two editors in one
  checkout share one agreement.
- The reader tolerates a truncated last line and does not verify signatures on
  each read. This is not an integrity guarantee.
- A process crash or host timeout cannot be made fail-closed from inside.

Outside a git repository a supported write is denied. That is why the check
is never registered as a global hook: `session hook install --enforce` writes
`CHECK_HOOK` into the repository's own `.claude/settings.local.json` and
nothing else. It is kept out of `HOOKS`, so the user-level install and
uninstall never add or remove it — don't fold it in. Its matcher is part of
being registered: an entry under a narrower group is moved, not left, since
it would let a supported tool through. The review screen and start line say
where policy is checked; change them in the same commit that changes where.
