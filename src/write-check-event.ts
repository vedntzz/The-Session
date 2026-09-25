// What one write check answered, as the record `set.writeCheck` holds it.
// Written by commands/record-write-check.ts. Schema and reasons in docs/decisions.md.

/**
 * The check's answer. Never `allow` (invariant 6). `silent`: the check completed
 * with no objection; `not-checked`: its deadline fired. A crash writes no event.
 */
export type WriteCheckDecision = "ask" | "deny" | "silent" | "not-checked";

export interface WriteCheckEvent {
  readonly type: "write-check";
  /** This session's own counter, shared with tool-call records. */
  readonly n: number;
  /** The editor's name for the call; `null` when the payload was never read. */
  readonly tool: string | null;
  /** Repo-relative; `null` when the check resolved no path. Never "". */
  readonly path: string | null;
  readonly decision: WriteCheckDecision;
  /** A static reason or violation code; never source text or an error message. */
  readonly reason: string;
  /** The coding tool that asked, by a stable name; no vendor format beyond it. */
  readonly agent: string;
}
