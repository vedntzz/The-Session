import { MIN_DRIFTS, MIN_HISTORY, type RepoDebt } from "../debt.js";
import type { PrimeProposal } from "../prime.js";

/** How many owed files the preview names. Past this, `--debt` has the rest. */
export const DEBT_SHOWN = 5;

export function formatPrime(proposal: PrimeProposal, debt?: RepoDebt): string[] {
  const lines = [
    "",
    `  prime    ${JSON.stringify(proposal.intent)}`,
    `  history  ${proposal.comparable} comparable declarations of ${proposal.history} eligible`,
  ];
  if (proposal.reason) lines.push(`  scope    ${proposal.reason}`);
  for (const candidate of proposal.candidates) {
    const why = candidate.reason === "named" ? "named with --seed" :
      `outside scope in ${candidate.sessions.length}/${proposal.comparable} comparable declarations`;
    lines.push(`  file     ${JSON.stringify(candidate.path)} — ${why}`);
    if (candidate.sessions.length) lines.push(`           sessions: ${candidate.sessions.join(", ")}`);
  }
  lines.push(`  covers   ${proposal.scope.length}/${proposal.tracked} tracked files; exact paths only`);
  if (proposal.omitted) lines.push(`  omitted  ${proposal.omitted} further candidates`);
  if (debt) lines.push(...debtLines(debt));
  lines.push("", "  No session started. Repeat with --start to accept; add --scope to replace the suggested scope.");
  return lines;
}

/**
 * The files this repo owes, under the suggestion and apart from it.
 *
 * Not part of the proposal and never recorded with it: the suggestion is
 * Prime's rule, and debt is a different rule over the same log. Printed so the
 * developer choosing a scope can see which paths keep drifting here — the
 * choice of whether to declare them stays theirs. Too little history says so
 * rather than printing nothing, since "owes nothing" and "could not look" are
 * different statements.
 */
function debtLines(debt: RepoDebt): string[] {
  if (debt.files === undefined) {
    const recorded = debt.history === 1 ? "1 session" : `${debt.history} sessions`;
    return [`  debt     not enough history: ${recorded} recorded here, needs ${MIN_HISTORY}`];
  }
  if (debt.files.length === 0) {
    return [`  debt     none — no file has drifted outside scope ${MIN_DRIFTS} times without being declared since`];
  }
  const count = debt.files.length === 1
    ? "1 file keeps drifting outside scope here and was never declared since"
    : `${debt.files.length} files keep drifting outside scope here and were never declared since`;
  const lines = [`  debt     ${count}`];
  for (const file of debt.files.slice(0, DEBT_SHOWN)) {
    lines.push(`           ${JSON.stringify(file.path)} — outside scope in ${file.sessions} sessions`);
  }
  const rest = debt.files.length - DEBT_SHOWN;
  if (rest > 0) lines.push(`           ${rest} more: session prime --debt`);
  return lines;
}
