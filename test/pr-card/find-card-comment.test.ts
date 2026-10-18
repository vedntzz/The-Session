// Which of a PR's comments the card owns: the first line is the marker, and the newest wins.
import { describe, expect, it } from "vitest";
import { findCardComment } from "../../src/pr-card/find-card-comment.js";
import { CARD_MARKER } from "../../src/pr-card/render-pr-card.js";

const card = `${CARD_MARKER}\n### Session\n\n| Asked for | add retries |`;

describe("findCardComment", () => {
  it("finds nothing among no comments", () => {
    expect(findCardComment([])).toBeNull();
  });

  it("finds the comment whose first line is the marker", () => {
    const comments = [
      { id: 1, body: "looks good", updated_at: "2026-10-18T10:00:00Z" },
      { id: 2, body: card, updated_at: "2026-10-18T09:00:00Z" },
    ];
    expect(findCardComment(comments)).toBe(2);
  });

  it("does not take a comment that quotes the marker below its first line", () => {
    const quoted = `Why does the bot write this?\n> ${CARD_MARKER}\n${CARD_MARKER}`;
    expect(findCardComment([{ id: 3, body: quoted, updated_at: "2026-10-18T10:00:00Z" }])).toBeNull();
  });

  it("does not take a first line that only contains the marker", () => {
    expect(findCardComment([{ id: 4, body: `see ${CARD_MARKER}`, updated_at: "2026-10-18T10:00:00Z" }])).toBeNull();
  });

  it("takes the most recently updated of two cards, whatever their order", () => {
    const older = { id: 5, body: card, updated_at: "2026-10-18T09:00:00Z" };
    const newer = { id: 6, body: card, updated_at: "2026-10-18T11:30:00Z" };
    expect(findCardComment([older, newer])).toBe(6);
    expect(findCardComment([newer, older])).toBe(6);
  });

  it("takes a card whose body was saved with CRLF line endings", () => {
    expect(findCardComment([{ id: 7, body: card.replaceAll("\n", "\r\n"), updated_at: "2026-10-18T10:00:00Z" }])).toBe(7);
  });

  it("skips comments with no body or an empty one", () => {
    const comments = [
      { id: 8, updated_at: "2026-10-18T12:00:00Z" },
      { id: 9, body: null, updated_at: "2026-10-18T12:00:00Z" },
      { id: 10, body: "", updated_at: "2026-10-18T12:00:00Z" },
      { id: 11, body: card, updated_at: "2026-10-18T08:00:00Z" },
    ];
    expect(findCardComment(comments)).toBe(11);
  });
});
