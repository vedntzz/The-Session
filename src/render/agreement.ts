import type { Agreement } from "../agreement.js";
import type { PrimeProposal } from "../prime.js";
import { plainPalette, type Palette } from "./palette.js";
import { note } from "./terminal/text.js";
import { safeText } from "./tui/text.js";

export const POLICY_DESCRIPTION: Record<Agreement["policy"], string> = {
  record: "record writes without blocking",
  ask: "ask before writes outside these terms",
  deny: "deny writes outside these terms",
};

/** Every term stays visible, and record data cannot issue terminal commands. */
export function formatAgreement(
  intent: string,
  agreement: Agreement,
  proposal?: PrimeProposal,
  palette: Palette = plainPalette,
  width?: number,
): string[] {
  const lines = ["", ...note(`Review agreement: ${JSON.stringify(safeText(intent))}`, palette.intent, width)];
  if (proposal) {
    lines.push("  proposed   Prime's original scope");
    lines.push(...paths(proposal.scope, "no suggestion", palette));
  }
  lines.push("  accepted   paths", ...paths(agreement.paths, "none", palette));
  lines.push(`  actions    ${agreement.actions.join(", ") || "none"}`);
  lines.push("  sensitive  paths", ...paths(agreement.sensitivePaths, "none", palette));
  lines.push(...note(`policy     ${agreement.policy} — ${POLICY_DESCRIPTION[agreement.policy]}`, palette.meta, width));
  lines.push("", ...note("Outside these terms means an unaccepted path or action, or any sensitive path.", palette.meta, width));
  lines.push(...note("Policy is recorded only in this version; enforcement is not installed by this screen.", palette.meta, width));
  lines.push(...note("Accept writes these terms once and starts the session. No session has started yet.", palette.meta, width));
  return lines;
}

function paths(values: readonly string[], empty: string, palette: Palette): string[] {
  return values.length
    ? values.map((value) => `             ${palette.path(JSON.stringify(safeText(value)))}`)
    : [`             ${empty}`];
}
