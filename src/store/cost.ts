// What a session spent: four token counters, never one sum. Pure.
/**
 * The four token counters, kept separate because the four kinds bill at
 * different rates. Collapsing them to one number throws away the information a
 * price calculation needs, so nothing in the record ever does.
 */
export interface TokenCounts {
  /** Fresh input, billed at the full input rate. */
  inputTokens: number;
  /** Input served from cache, billed at a discount. */
  cacheReadTokens: number;
  /** Input written into cache, billed at a premium. */
  cacheCreationTokens: number;
  outputTokens: number;
}

/** What the session spent to get where it got. */
export interface SessionCost extends TokenCounts {
  /** Developer turns: one per prompt, covering everything it set off. */
  turns: number;
  /**
   * Turns that wrote no files — a whole prompt that produced nothing.
   *
   * **Absent where nothing can say.** Under the `git` rule that is every
   * session that changed files: git settles whether the session wrote
   * anything, never which turn wrote it, and a nought here would claim no turn
   * was wasted. Nought is what this field means when it means nought.
   */
  emptyTurns?: number;
  /** API calls observed, after streaming fragments are collapsed. */
  apiCalls: number;
  /**
   * Calls that wrote no files.
   *
   * **Frozen.** Retained so records already on disk still hash and verify;
   * written by nothing and displayed nowhere, and nothing new should read it.
   *
   * **Never written again, and never displayed.** A transcript reports which
   * tool a call used, not what the tool did to the disk, so a call that wrote
   * a file through a shell command is indistinguishable from one that ran
   * `git status` — see `emptySource`. Kept on the type because records already
   * hold it, and a field dropped from the type is a field `verify` can no
   * longer hash back.
   */
  callsWithoutEdits?: number;
  model: string;
  /**
   * The same four counters, restricted to the turns that wrote no files.
   *
   * A measurement, never an apportionment: under the `git` rule it is present
   * only when *every* turn was empty, where it is the session's own total.
   * Taking the total times the share of turns that were empty would be a
   * number nobody observed — empty turns are not average turns, and the
   * expensive one is the whole point.
   *
   * Absent where `emptyTurns` is absent, and on sessions captured before this
   * existed. Nothing infers it.
   */
  emptyTurnTokens?: TokenCounts;
  /**
   * Which rule decided `emptyTurns`, so a reader can tell a measurement from
   * a guess that has already been made.
   *
   * `git` — reconciled against the diff the session actually left. Absent
   * reads as `tools`: the record was written when a turn was called empty
   * because no `Edit`, `Write`, `MultiEdit` or `NotebookEdit` block appeared
   * in it. That test cannot see a file written through the shell, which is how
   * most files are written, so those records report sessions that changed
   * seven files as seven files' worth of nothing. `emptyTurnsOf` is where the
   * two are told apart; no view reads this field directly.
   */
  emptySource?: EmptySource;
  /** Turns an adapter counted but could not tokenise; any makes the money unknown. */
  untokenedTurns?: number;
  /** Each turn's model, in order, from adapters that record one per turn; null where none was named. */
  turnModels?: (string | null)[];
  /** Each turn's four counters, aligned with `turnModels`; null where the turn recorded none. */
  turnTokens?: (TokenCounts | null)[];
  /** History a tool imported into a thread, seen in the window: not a turn, never priced. */
  importedTurnsSkipped?: number;
}

/**
 * What decided a session's empty turns.
 *
 * `git` is the diff. `tools` is the tool names in the transcript, which is
 * what records written before this carry — absent reads as `tools`, the same
 * shape `intentSource` uses, and for the same reason: nothing else could have
 * written those records, so it is a fact about them rather than a guess.
 */
export type EmptySource = "git" | "tools";

/** Every token the session moved. For display only — never for pricing. */
export function totalTokens(tokens: TokenCounts): number {
  return (
    tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheCreationTokens + tokens.outputTokens
  );
}

/** Four counters at nothing. */
export function zeroTokens(): TokenCounts {
  return { inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 };
}

/** A cost record with nothing counted yet. */
export function zeroCost(): SessionCost {
  // Only the counters a transcript can answer on its own. Empty turns are not
  // among them — they are reconciled against git once there is a diff to
  // reconcile against, and until then their absence is the honest reading.
  return { ...zeroTokens(), turns: 0, apiCalls: 0, model: "" };
}
