// The PR card as Markdown, assembled from the card formatters. Pure.
import type { CardData } from "./card-data.js";
import { formatChainStatus } from "./format-chain-status.js";
import { formatCost } from "./format-cost.js";
import { formatFileList } from "./format-file-list.js";
import { formatOutcome } from "./format-outcome.js";

/** The hidden first line that marks a comment as this card. */
export const CARD_MARKER = "<!-- session-card -->";

/** The card's heading, the same whether or not a session was recorded. */
export const CARD_HEADING = "## Session record";

/** What the intent reads as when it was recorded but is left off a posted card. */
export const INTENT_HIDDEN = "recorded, not shown (post with --show-intent to include it)";

/** Whether the recorded intent goes on the card; `session pr --post` leaves it off unless asked. */
export interface CardRenderOptions {
  showIntent: boolean;
}

/** The card: marker, heading, the record as a table, then the files. */
export function renderPrCard(card: CardData, options: CardRenderOptions = { showIntent: true }): string {
  const [count = "", ...files] = formatFileList(card.files);
  return [CARD_MARKER, CARD_HEADING, "", ...table(card, count, options), "", filesBlock(card, count, files)].join("\n");
}

/** The two-column table, one row per fact; `count` is the file list's count line. */
function table(card: CardData, count: string, options: CardRenderOptions): string[] {
  return ["| | |", "|---|---|",
    tableRow("Asked for", askedFor(card.askedFor, options)),
    tableRow("Agents", card.agents.length > 0 ? card.agents.join(", ") : "none recorded"),
    tableRow("Outcome", formatOutcome(card.outcome, card.reverted)),
    tableRow("Files", count),
    tableRow("Cost", formatCost(card.cost)),
    tableRow("Signed log", formatChainStatus(card.chain))];
}

/** The intent, "not recorded" when there is none, and a hidden one said to be hidden rather than absent. */
function askedFor(intent: CardData["askedFor"], options: CardRenderOptions): string {
  if (intent === null) return "not recorded";
  return options.showIntent ? intent : INTENT_HIDDEN;
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
function filesBlock(card: CardData, head: string, rest: readonly string[]): string {
  const outside = card.files.filter((file) => !file.inScope).length;
  const items = rest.map((line, i) => `- ${i < outside ? `**${escapeInline(line)}**` : escapeInline(line)}`);
  return items.length > 0 ? `${head}\n\n${items.join("\n")}` : head;
}

/** A line with Markdown's own characters escaped, so a path reads as typed. */
function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<>#~|]/gu, "\\$&");
}
