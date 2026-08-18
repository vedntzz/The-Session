# Agile for AI

Five practices for working with coding agents. [`session`](Readme.md) is the argument for them, and you can adopt them without it — the tool only makes them cheap enough to keep doing on a Tuesday afternoon.

## 1. Declare before you generate

One sentence, before the agent runs. Not a ticket, not a spec — what you are trying to do.

It costs eight seconds, and it is the only part of the process that cannot be reconstructed afterwards. A declaration you write after seeing the result is a rationalisation: you already know what happened, and the sentence bends to fit it. That is why `session` writes `intent` once and never lets it be edited.

## 2. Scope is declared, drift is recorded — not blocked

Say which files you expect to change. Then let the agent change whatever it changes.

Agents wander for good reasons: the fix really was in the adjacent module, the test really did need a fixture. The failure is not the wandering, it is the wandering nobody noticed until review. A tool that blocked drift would be wrong most of the time and would train you to turn it off. A tool that records it gives you a list to read.

## 3. Count what produced nothing

A turn that changes no files still costs money, still took a minute of your attention, and still happened.

Averaged into a total it disappears, so it has to be its own number: how many prompts produced nothing, and what those prompts cost. That figure is the one that changes how you prompt. Waste is a first-class number or it is invisible.

## 4. The session is the unit of work

Not the ticket, not the sprint, not the line of code.

A ticket spans days and hides which hour did the damage. A line of code says nothing about what it was for. A session is one intent, one agent run, one set of files, one number — small enough to hold in your head and complete enough to be worth reasoning about.

## 5. The record outlives the session

Anything not written down at `stop` is gone.

What the working tree looked like, which model ran, what the turns cost, what the agent left where — none of it survives the terminal closing. Understanding is the artifact; the code is a side effect, and the code is the part your version control was already keeping.

---

These are practices, not features. If you try the first one for a week, [tell me whether it holds](https://github.com/vedntzz/The-Session/issues).
