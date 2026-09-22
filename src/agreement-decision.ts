// Policy over an attempted write, not evidence that a file changed.
import {
  AGREEMENT_ACTIONS, agreementPaths, parseAgreement,
  type Agreement, type AgreementAction,
} from "./agreement.js";
import { inScope } from "./scope.js";

/** The adapter resolves a tool call to a canonical repo-relative file first. */
export interface AgreementWrite {
  readonly path: string;
  readonly action: AgreementAction;
}

export type AgreementViolation = "outside-paths" | "action-not-accepted" | "sensitive-path";

export interface AgreementDecision {
  /** Defer never grants permission or overrides the editor's own checks. */
  readonly decision: "defer" | "ask" | "deny";
  readonly violations: readonly AgreementViolation[];
}

/**
 * Pure and tool-independent. No agreement adds no restriction. With one,
 * retain every mismatch even in record-only mode; a defer is not proof that
 * the attempted write complied, nor proof that it happened.
 */
export function decideAgreementWrite(
  agreement: Agreement | undefined,
  write: AgreementWrite,
): AgreementDecision {
  if (agreement === undefined) return { decision: "defer", violations: [] };
  const accepted = parseAgreement(agreement);
  assertResolvedWrite(write);
  const violations: AgreementViolation[] = [];
  if (!inScope(accepted.paths, write.path)) violations.push("outside-paths");
  if (!accepted.actions.includes(write.action)) violations.push("action-not-accepted");
  if (inScope(accepted.sensitivePaths, write.path)) violations.push("sensitive-path");
  return {
    decision: violations.length === 0 || accepted.policy === "record" ? "defer" : accepted.policy,
    violations,
  };
}

/** Reject ambiguous input; resolving it by guess could change which terms apply. */
function assertResolvedWrite(write: AgreementWrite): void {
  if (!AGREEMENT_ACTIONS.includes(write.action)) {
    throw new Error("Write action must be create, edit or delete. Resolve the tool operation before checking the agreement.");
  }
  const [normalized] = agreementPaths([write.path], "Write path");
  if (normalized !== write.path || normalized === ".") {
    throw new Error("Write path must name a canonical repo-relative file. Resolve the tool path before checking the agreement.");
  }
}
