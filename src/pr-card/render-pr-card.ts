// The PR card as Markdown, assembled from the card formatters. Pure.
import type { CardData } from "./card-data.js";
import { formatChainStatus } from "./format-chain-status.js";
import { formatCost } from "./format-cost.js";
import { formatFileList } from "./format-file-list.js";
import { formatOutcome } from "./format-outcome.js";

/** The hidden first line that marks a comment as this card. */
export const CARD_MARKER = "<!-- session-card -->";

/** The card: marker, heading, the record as a table, then the files. */
export function renderPrCard(card: CardData): string {
  return [CARD_MARKER, "## Session record", "", ...table(card), "", filesBlock(card)].join("\n");
}

/** The two-column table, one row per fact. */
function table(card: CardData): string[] {
  return ["| | |", "|---|---|",
    tableRow("Asked for", card.askedFor ?? "not recorded"),
    tableRow("Agents", card.agents.length > 0 ? card.agents.join(", ") : "none recorded"),
    tableRow("Outcome", formatOutcome(card.outcome, card.reverted)),
    tableRow("Cost", formatCost(card.cost)),
    tableRow("Signed log", formatChainStatus(card.chain))];
}

/** One row; the value escaped so it stays in its cell. */
function tableRow(label: string, value: string): string {
  return `| ${label} | ${escapeCell(value)} |`;
}

/** Flattened, since a newline ends a row, and with pipes escaped, since one splits it. */
function escapeCell(text: string): string {
  return text.replace(/\s+/gu, " ").trim().replace(/\|/gu, "\\|");
}

/** The count line, then each file as a list item; out-of-scope ones in bold. */
function filesBlock(card: CardData): string {
  const [head = "", ...rest] = formatFileList(card.files);
  const outside = card.files.filter((file) => !file.inScope).length;
  const items = rest.map((line, i) => `- ${i < outside ? `**${escapeInline(line)}**` : escapeInline(line)}`);
  return items.length > 0 ? `${head}\n\n${items.join("\n")}` : head;
}

/** A line with Markdown's own characters escaped, so a path reads as typed. */
function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<>#~|]/gu, "\\$&");
}
