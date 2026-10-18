// The PR card when no session was recorded: the gap stated, never filled in.
import { describe, expect, it } from "vitest";
import { renderNoRecordCard } from "../../src/pr-card/render-no-record-card.js";

const EMOJI = /\p{Extended_Pictographic}/u;

describe("renderNoRecordCard", () => {
  it("opens with the same hidden marker, then the same heading", () => {
    const lines = renderNoRecordCard().split("\n");
    expect(lines[0]).toBe("<!-- session-card -->");
    expect(lines[1]).toBe("## Session record");
  });

  it("says no session was recorded, and how to record one", () => {
    const lines = renderNoRecordCard().split("\n");
    expect(lines).toContain("No session recorded for this PR.");
    expect(lines).toContain("Install hooks with `session hook install` to record future work.");
  });

  it("has no table, no cost and no verdict", () => {
    const card = renderNoRecordCard();
    expect(card).not.toMatch(/^\|/mu);
    expect(card).not.toContain("$");
    expect(card.toLowerCase()).not.toContain("cost");
    expect(card.toLowerCase()).not.toContain("failed");
    expect(card.toLowerCase()).not.toContain("waste");
  });

  it("uses no emoji", () => {
    expect(renderNoRecordCard()).not.toMatch(EMOJI);
  });

  it("renders the no-record card", () => {
    expect(renderNoRecordCard()).toMatchInlineSnapshot(`
      "<!-- session-card -->
      ## Session record

      No session recorded for this PR.

      Install hooks with \`session hook install\` to record future work."
    `);
  });
});
