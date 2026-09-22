// Accepted terms, fixed before work starts. No tool names or enforcement here.
import { normalizeEntry } from "./scope.js";

export const AGREEMENT_ACTIONS = ["create", "edit", "delete"] as const;
export type AgreementAction = (typeof AGREEMENT_ACTIONS)[number];
export const AGREEMENT_POLICIES = ["record", "ask", "deny"] as const;
export type AgreementPolicy = (typeof AGREEMENT_POLICIES)[number];

/** A policy applies to out-of-scope, unaccepted-action or sensitive-path writes. */
export interface Agreement {
  readonly paths: readonly string[];
  readonly actions: readonly AgreementAction[];
  readonly sensitivePaths: readonly string[];
  readonly policy: AgreementPolicy;
}

export type ProposalProposer = "prime" | "external";

/** Older proposals could only come from Prime; never backfill the signed bytes. */
export function proposerOf(proposal: { proposer?: ProposalProposer }): ProposalProposer {
  return proposal.proposer ?? "prime";
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Prefixes use the existing scope rule, with repo-relative spelling enforced. */
export function agreementPaths(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${field} must be a list of repo-relative paths. Supply the accepted paths before starting.`);
  }
  const paths = (value as string[]).map((entry) => {
    const normalized = entry.trim() === "./" ? "." : normalizeEntry(entry);
    if (!normalized || /[\x00-\x1f\x7f\\]/.test(entry) || normalized.startsWith("/") ||
      /^[a-z]:/i.test(normalized) ||
      (normalized !== "." && normalized.split("/").some((part) => !part || part === "." || part === ".."))) {
      throw new Error(`${field} contains an invalid repo-relative path: ${JSON.stringify(entry)}. Use a path inside the repo.`);
    }
    return normalized;
  });
  return [...new Set(paths)];
}

/** Validate before signing, returning our own copy rather than the caller's arrays. */
export function parseAgreement(value: unknown): Agreement {
  if (!object(value)) {
    throw new Error("Agreement must be an object. Supply the accepted terms before starting.");
  }
  const fields = ["paths", "actions", "sensitivePaths", "policy"];
  if (Object.keys(value).some((key) => !fields.includes(key))) {
    throw new Error("Agreement accepts only paths, actions, sensitivePaths and policy. Keep the original proposal separate.");
  }
  if (!Array.isArray(value.actions) || value.actions.some((action) =>
    !AGREEMENT_ACTIONS.includes(action as AgreementAction))) {
    throw new Error(`Agreement actions must be a list of: ${AGREEMENT_ACTIONS.join(", ")}. Supply the accepted actions before starting.`);
  }
  if (!AGREEMENT_POLICIES.includes(value.policy as AgreementPolicy)) {
    throw new Error(`Agreement policy must be one of: ${AGREEMENT_POLICIES.join(", ")}. Choose a policy before starting.`);
  }
  return {
    paths: agreementPaths(value.paths, "Agreement paths"),
    actions: [...new Set(value.actions as AgreementAction[])],
    sensitivePaths: agreementPaths(value.sensitivePaths, "Agreement sensitivePaths"),
    policy: value.policy as AgreementPolicy,
  };
}

/** The existing scope remains the measurement's yardstick, equal to accepted paths. */
export function scopeForAgreement(agreement: Agreement, scope?: readonly string[]): string[] {
  if (scope !== undefined) {
    const normalized = agreementPaths(scope, "Scope");
    if (normalized.length !== agreement.paths.length ||
      normalized.some((entry) => !agreement.paths.includes(entry))) {
      throw new Error("Scope must match the agreement's accepted paths. Review both before starting.");
    }
  }
  return [...agreement.paths];
}
