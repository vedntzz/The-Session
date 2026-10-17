// The PR card as Markdown: a marker, a heading, a two-column table, then the files.
import { describe, expect, it } from "vitest";
import { renderPrCard } from "../../src/pr-card/render-pr-card.js";
import { cardDataWith } from "./fixtures.js";

const EMOJI = /\p{Extended_Pictographic}/u;
const row = (markdown: string, label: string) => markdown.split("\n").find((line) => line.startsWith(`| ${label} |`));
const cells = (line: string | undefined) => line?.split(/(?<!\\)\|/u).length;

describe("renderPrCard", () => {
  it("opens with the hidden marker, then the heading", () => {
    const lines = renderPrCard(cardDataWith()).split("\n");
    expect(lines[0]).toBe("<!-- session-card -->");
    expect(lines[1]).toBe("## Session record");
  });

  it("says when nothing was recorded as asked for, or no agent", () => {
    const card = renderPrCard(cardDataWith({ askedFor: null, agents: [] }));
    expect(row(card, "Asked for")).toBe("| Asked for | not recorded |");
    expect(row(card, "Agents")).toBe("| Agents | none recorded |");
  });

  it("keeps a pipe or a newline in the ask inside its cell", () => {
    const line = row(renderPrCard(cardDataWith({ askedFor: "split a|b\non two lines" })), "Asked for");
    expect(line).toBe("| Asked for | split a\\|b on two lines |");
    expect(cells(line)).toBe(4);
  });

  it("uses no emoji", () => {
    const card = cardDataWith({ files: [{ path: "x.ts", inScope: false }], cost: { priced: false, reason: "r" } });
    expect(renderPrCard(card)).not.toMatch(EMOJI);
  });

  it("renders a priced, merged, verified card", () => {
    expect(renderPrCard(cardDataWith())).toMatchInlineSnapshot(`
      "<!-- session-card -->
      ## Session record

      | | |
      |---|---|
      | Asked for | add a retry to the fetch client |
      | Agents | claude-code |
      | Outcome | merged |
      | Files | 1 file |
      | Cost | $0.42 |
      | Signed log | signed log verified |

      1 file

      - src/fetch.ts"
    `);
  });

  it("renders an unpriced card with its reason", () => {
    const card = cardDataWith({ cost: { priced: false, reason: "no rate for claude-x" }, outcome: "open" });
    expect(renderPrCard(card)).toMatchInlineSnapshot(`
      "<!-- session-card -->
      ## Session record

      | | |
      |---|---|
      | Asked for | add a retry to the fetch client |
      | Agents | claude-code |
      | Outcome | still open |
      | Files | 1 file |
      | Cost | unpriced (no rate for claude-x) |
      | Signed log | signed log verified |

      1 file

      - src/fetch.ts"
    `);
  });

  it("bolds the files outside scope and escapes Markdown in paths", () => {
    const files = [{ path: "src/__init__.py", inScope: true }, { path: "db/*.sql", inScope: false }];
    expect(renderPrCard(cardDataWith({ files, agents: ["claude-code", "codex"] }))).toMatchInlineSnapshot(`
      "<!-- session-card -->
      ## Session record

      | | |
      |---|---|
      | Asked for | add a retry to the fetch client |
      | Agents | claude-code, codex |
      | Outcome | merged |
      | Files | 2 files · 1 outside scope |
      | Cost | $0.42 |
      | Signed log | signed log verified |

      2 files · 1 outside scope

      - **db/\\*.sql (outside agreed scope)**
      - src/\\_\\_init\\_\\_.py"
    `);
  });
});
