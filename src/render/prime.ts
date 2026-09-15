import type { PrimeProposal } from "../prime.js";

export function formatPrime(proposal: PrimeProposal): string[] {
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
  lines.push("", "  No session started. Repeat with --start to accept; add --scope to replace the suggested scope.");
  return lines;
}
