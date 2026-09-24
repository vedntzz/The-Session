// What one write check answered, as a record would hold it. Type only: not yet
// written to the chain. Schema and reasons in docs/decisions.md.

/**
 * The check's answer. Never `allow` (invariant 6). `silent`: the check completed
 * with no objection; `not-checked`: it hit its deadline or crashed.
 */
export type WriteCheckDecision = "ask" | "deny" | "silent" | "not-checked";

export interface WriteCheckEvent {
  readonly type: "write-check";
  /** This session's own counter, shared with tool-call records. */
  readonly n: number;
  readonly tool: string;
  /** Repo-relative. */
  readonly path: string;
  readonly decision: WriteCheckDecision;
  /** A static reason or violation code; never source text or an error message. */
  readonly reason: string;
  /** The coding tool that asked, by a stable name; no vendor format beyond it. */
  readonly agent: string;
}
