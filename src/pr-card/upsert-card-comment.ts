// One card comment on the PR with the given body: found and updated, or posted when there is none.
import { findCardComment, isCard } from "./find-card-comment.js";
import { CommentGoneError, createComment, listComments, updateComment, type FetchFn, type PrTarget } from "./github-comments.js";
import { CARD_MARKER } from "./render-pr-card.js";

/** What the call did to the PR, and the card comment's id after it. */
export interface UpsertResult {
  action: "created" | "updated" | "unchanged";
  id: number;
}

/** Leaves exactly one card on the PR; a body whose first line is not the marker is refused before any request. */
export async function upsertCardComment(target: PrTarget, body: string, token: string, fetchFn: FetchFn = fetch): Promise<UpsertResult> {
  if (!isCard(body)) throw new Error(`The comment body does not start with the card marker ${CARD_MARKER} on its own line. Render it with renderPrCard or renderNoRecordCard.`);
  const comments = await listComments(target, token, fetchFn);
  const id = findCardComment(comments);
  if (id === null) return { action: "created", id: await createComment(target, body, token, fetchFn) };
  if (comments.find((c) => c.id === id)?.body === body) return { action: "unchanged", id };
  return replace(target, id, body, token, fetchFn);
}

/** Updates the card; one deleted since it was listed is posted afresh, and any other failure stands. */
async function replace(target: PrTarget, id: number, body: string, token: string, fetchFn: FetchFn): Promise<UpsertResult> {
  try {
    return { action: "updated", id: await updateComment(target, id, body, token, fetchFn) };
  } catch (error) {
    if (!(error instanceof CommentGoneError)) throw error;
    return { action: "created", id: await createComment(target, body, token, fetchFn) };
  }
}
