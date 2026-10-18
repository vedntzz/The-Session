// Which of a PR's comments is the card, so it is updated in place rather than posted twice. Pure.
import { CARD_MARKER } from "./render-pr-card.js";

/** The fields of a PR comment the match reads; who wrote it is deliberately not one of them. */
export interface PrComment {
  id: number;
  body?: string | null;
  updated_at: string;
}

/**
 * The id of the card comment: its first line is the marker, exactly. A comment
 * that quotes the marker further down is someone talking about the card, not
 * the card. With more than one, the most recently updated wins.
 */
export function findCardComment(comments: readonly PrComment[]): number | null {
  let found: PrComment | null = null;
  for (const comment of comments) {
    if (!isCard(comment.body)) continue;
    if (found === null || Date.parse(comment.updated_at) > Date.parse(found.updated_at)) found = comment;
  }
  return found === null ? null : found.id;
}

/** A body edited on GitHub comes back with CRLF; the marker line is the same line either way. */
function isCard(body: string | null | undefined): boolean {
  if (!body) return false;
  return body.split("\n", 1)[0]?.replace(/\r$/, "") === CARD_MARKER;
}
