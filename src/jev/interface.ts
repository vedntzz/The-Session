// Jev's contract: what an optional advisor is asked, and the shape of its answer.
// Types only. Every answer is advisory: shown to the developer, never measured
// against, and never setting scope, drift, an outcome, a class or a check's answer.
// Paths are repo-relative, spelled as scope entries are. Confidence is in [0, 1].

/** Scope suggestions for a declared intent, drawn from paths the caller supplies. */
export interface SuggestScopeInput {
  readonly intent: string;
  /** Repo-relative paths Jev may suggest from; it names no path outside these. */
  readonly candidatePaths: readonly string[];
}

/** One suggested path. `reason` is a short static label, not source text. */
export interface ScopeSuggestion {
  readonly path: string;
  /** In [0, 1]. */
  readonly confidence: number;
  readonly reason: string;
}

/** Empty when Jev has nothing to suggest. */
export type SuggestScopeOutput = readonly ScopeSuggestion[];

/** One attempted write, held against the paths the developer agreed to. */
export interface FlagWriteInput {
  readonly intent: string;
  readonly agreedPaths: readonly string[];
  readonly attemptedPath: string;
}

/** A label for the developer to read, not a decision. `null`: no opinion. */
export type FlagWriteOutput = {
  readonly label: "related" | "unrelated" | "unsure";
  /** In [0, 1]. */
  readonly confidence: number;
} | null;

/** A suggested tag for a session; never its class, which classify.ts decides. */
export type TaskType = "feature" | "fix" | "refactor" | "test" | "docs" | "chore";

/** What a tag suggestion is given: the intent and the paths that changed. */
export interface TagTaskInput {
  readonly intent: string;
  readonly changedPaths: readonly string[];
}

/** One past session to backtest against. Declared sessions only. */
export interface BacktestSession {
  readonly intent: string;
  readonly candidatePaths: readonly string[];
  readonly changedPaths: readonly string[];
}
