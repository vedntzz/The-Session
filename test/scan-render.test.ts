import { describe, expect, it } from "vitest";
import { formatUsd } from "../src/pricing.js";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { NO_PRICE, RATES_HINT } from "../src/render/terminal/cost.js";
import { formatScan } from "../src/render/terminal/scan.js";
import { MIN_WIDTH, width } from "../src/render/terminal/text.js";
import { UNKNOWN_REPO, type ScanReport, type ScannedSession } from "../src/scan.js";
import { zeroCost } from "../src/store.js";

/**
 * What `session scan` prints, from a report built by hand.
 *
 * The arithmetic that produces a `ScanReport` is `scan.test.ts`; reading the
 * transcripts is `scan-read.test.ts`. This is the last step: the words, the
 * order, and the places an unknown must read as unknown rather than as nought.
 */

function scanned(label: string): ScannedSession {
  return {
    id: "aaaa",
    repo: "/dev/one",
    label,
    startedAt: "2026-08-20T14:00:00.000Z",
    endedAt: "2026-08-20T14:40:00.000Z",
    cost: zeroCost(),
  };
}

function report(over: Partial<ScanReport> = {}): ScanReport {
  return {
    days: 7,
    sessions: 5,
    spend: { usd: 12.5, unpriced: 0, unpricedModels: [] },
    turns: 40,
    repos: [
      { repo: "/dev/one", sessions: 3, turns: 30, spend: { usd: 10, unpriced: 0, unpricedModels: [] } },
      { repo: "/dev/two", sessions: 2, turns: 10, spend: { usd: 2.5, unpriced: 0, unpricedModels: [] } },
    ],
    top: [
      { session: scanned("add rate limiting to /orders"), usd: 6 },
      { session: scanned("fix the flaky login test"), usd: 4 },
    ],
    landed: 2,
    landingUnknown: 0,
    unrankable: 0,
    ...over,
  };
}

const plain = (over: Partial<ScanReport> = {}, limit?: number): string[] =>
  formatScan(report(over), plainPalette, limit);

describe("formatScan", () => {
  it("says there was nothing, and over how long, when no session ran", () => {
    expect(plain({ sessions: 0 })).toEqual(["", "  No agent sessions in the last 7 days"]);
    expect(plain({ sessions: 0, days: 1 })).toEqual(["", "  No agent sessions in the last 1 day"]);
  });

  it("reads headline, window, turns, table, dearest and spend, in that order", () => {
    const text = plain().join("\n");
    const order = [
      "5 sessions · 2 ran while something landed on the default branch · 3 did not",
      "the last 7 days · 2 repos",
      "40 turns · which of them changed no files is not something a transcript can say",
      "repository",
      "2 dearest sessions",
      `${formatUsd(12.5)} spent`,
    ].map((needle) => text.indexOf(needle));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("never calls a landing merged, and never prices the turns that changed no files", () => {
    const text = plain().join("\n");
    expect(text).not.toMatch(/merged|shipped/);
    expect(text).not.toMatch(/wasted|of it on/);
  });

  it("separates each block from the last with one blank line", () => {
    const lines = plain();
    expect(lines[0]).toBe("");
    expect(lines.some((line, index) => line === "" && lines[index + 1] === "")).toBe(false);
  });

  describe("the headline", () => {
    it("counts checkouts git could not be asked about apart from the ones that said no", () => {
      const lines = plain({ sessions: 5, landed: 1, landingUnknown: 2 });
      expect(lines).toContain(
        "  5 sessions · 1 ran while something landed on the default branch · 2 did not",
      );
      expect(lines).toContain("  2 in checkouts git could not be asked about");
    });

    it("says a checkout, singular, for one", () => {
      expect(plain({ landingUnknown: 1 })).toContain("  1 in a checkout git could not be asked about");
    });

    it("leads with the count alone when no session could be asked", () => {
      const lines = plain({ sessions: 3, landed: 0, landingUnknown: 3 });
      expect(lines[1]).toBe("  3 sessions");
      expect(lines.join("\n")).not.toMatch(/did not/);
      expect(lines).toContain("  3 in checkouts git could not be asked about");
    });

    it("prints no unknown line when every checkout answered", () => {
      expect(plain().join("\n")).not.toMatch(/could not be asked/);
    });
  });

  describe("the turns note", () => {
    it("says rather than omits that a transcript cannot tell which turns were empty", () => {
      expect(plain().join("\n")).toContain("run session start to have a diff to measure against");
    });

    it("is left out when no turn was read", () => {
      expect(plain({ turns: 0 }).join("\n")).not.toMatch(/changed no files/);
    });
  });

  describe("the repository table", () => {
    it("aligns every column, the path left and the figures right", () => {
      const lines = plain();
      const head = lines.findIndex((line) => line.includes("repository"));
      const rows = lines.slice(head, head + 3);
      expect(rows[0]).toMatch(/^ {2}repository\s+sessions\s+turns\s+cost$/);
      expect(new Set(rows.map(width)).size).toBe(1);
      expect(rows[1]).toMatch(/^ {2}\/dev\/one\s+3\s+30\s+\$10\.00$/);
      expect(rows[2]).toMatch(/^ {2}\/dev\/two\s+2\s+10\s+\$2\.50$/);
    });

    it("names a session with no directory rather than printing an empty path", () => {
      const lines = plain({
        repos: [{ repo: UNKNOWN_REPO, sessions: 1, turns: 4, spend: { usd: 1, unpriced: 0, unpricedModels: [] } }],
      });
      expect(lines.some((line) => line.startsWith("  (no directory recorded)"))).toBe(true);
    });

    it("prints unpriced, not $0.00, for a repository nothing in could be priced", () => {
      const lines = plain({
        repos: [
          { repo: "/dev/one", sessions: 1, turns: 4, spend: { usd: 0, unpriced: 1, unpricedModels: ["gpt-9"] } },
        ],
      });
      const row = lines.find((line) => line.includes("/dev/one"));
      expect(row).toMatch(/unpriced$/);
      expect(row).not.toContain("$0.00");
    });

    it("puts thousands separators in the figures", () => {
      const lines = plain({
        repos: [{ repo: "/dev/one", sessions: 1200, turns: 34_000, spend: { usd: 1, unpriced: 0, unpricedModels: [] } }],
      });
      expect(lines.find((line) => line.includes("/dev/one"))).toMatch(/1,200\s+34,000/);
    });

    it("inks a known path as a path and the unknown one as framing", () => {
      const lines = formatScan(
        report({
          repos: [
            { repo: "/dev/one", sessions: 1, turns: 1, spend: { usd: 1, unpriced: 0, unpricedModels: [] } },
            { repo: UNKNOWN_REPO, sessions: 1, turns: 1, spend: { usd: 1, unpriced: 0, unpricedModels: [] } },
          ],
        }),
        ansiPalette,
      );
      // The ink goes round the padded cell, so the column pads inside it.
      const cell = (text: string): string => text.padEnd("(no directory recorded)".length);
      expect(lines.find((line) => line.includes("/dev/one"))).toContain(ansiPalette.path(cell("/dev/one")));
      expect(lines.find((line) => line.includes("(no directory recorded)"))).toContain(
        ansiPalette.meta(cell("(no directory recorded)")),
      );
    });
  });

  describe("the dearest sessions", () => {
    it("lines the money up on the right and the prompt on the left", () => {
      const lines = plain();
      expect(lines).toContain(`  ${formatUsd(6).padStart(9)}  add rate limiting to /orders`);
      expect(lines).toContain(`  ${formatUsd(4).padStart(9)}  fix the flaky login test`);
    });

    it("says one dearest session, singular", () => {
      expect(plain({ top: [{ session: scanned("one prompt"), usd: 1 }] })).toContain("  1 dearest session");
    });

    it("closes a multi-line prompt up into one line", () => {
      const lines = plain({ top: [{ session: scanned("first line\n\n  second   line\t"), usd: 1 }] });
      expect(lines.some((line) => line.endsWith("  first line second line"))).toBe(true);
    });

    it("cuts a long prompt to 56 columns with an ellipsis", () => {
      const long = "x".repeat(80);
      const lines = plain({ top: [{ session: scanned(long), usd: 1 }] });
      const row = lines.find((line) => line.includes("xxx"));
      expect(row?.endsWith(`${"x".repeat(55)}…`)).toBe(true);
    });

    it("keeps a prompt of exactly 56 columns whole", () => {
      const exact = "y".repeat(56);
      expect(plain({ top: [{ session: scanned(exact), usd: 1 }] }).some((line) => line.endsWith(exact))).toBe(true);
    });

    it("says none can be called dearest when none could be priced", () => {
      expect(plain({ top: [] })).toContain("  No session could be priced, so none can be called the dearest.");
    });

    it("says how many could not be ranked rather than calling the rest the dearest", () => {
      expect(plain({ unrankable: 4 })).toContain(
        "  4 sessions could not be ranked, having no rate to be dear by",
      );
      expect(plain().join("\n")).not.toMatch(/could not be ranked/);
    });
  });

  describe("what the window cost", () => {
    it("never totals a window nothing could be priced in to nought", () => {
      const lines = plain({ spend: { usd: 0, unpriced: 3, unpricedModels: ["gpt-9", "local-7b"] } });
      const text = lines.join("\n");
      expect(lines).toContain(`  ${NO_PRICE} spent: nothing here could be priced`);
      expect(text).not.toContain("$0.00 spent");
      expect(text).toContain(`3 sessions unpriced: gpt-9, local-7b — save this as ${RATES_HINT}`);
      expect(text).toContain('"gpt-9"');
      expect(text).toContain('"local-7b"');
    });

    it("gives the total and the gap when only some of it could be priced", () => {
      const text = plain({ spend: { usd: 3, unpriced: 1, unpricedModels: ["gpt-9"] } }).join("\n");
      expect(text).toContain(`${formatUsd(3)} spent`);
      expect(text).toContain("1 session unpriced: gpt-9");
    });

    it("prints no unpriced note when everything was priced", () => {
      expect(plain().join("\n")).not.toMatch(/unpriced/);
    });

    it("does not break the JSON stub across lines, however narrow the terminal", () => {
      const lines = plain({ spend: { usd: 0, unpriced: 1, unpricedModels: ["a-model-with-a-long-name"] } }, 30);
      expect(lines.some((line) => line.includes('"a-model-with-a-long-name"'))).toBe(true);
    });
  });

  describe("a width to fit", () => {
    it("wraps the prose to the terminal", () => {
      const lines = plain({ landingUnknown: 1 }, 70);
      const prose = lines.filter(
        (line) => line.includes("landed") || line.includes("transcript") || line.includes("checkout"),
      );
      expect(prose.length).toBeGreaterThan(0);
      for (const line of prose) {
        expect(width(line)).toBeLessThanOrEqual(70);
      }
    });

    it("wraps no narrower than MIN_WIDTH, however narrow the terminal says it is", () => {
      expect(plain({}, 20)).toEqual(plain({}, MIN_WIDTH));
    });

    it("leaves every line whole where there is no width, as in a pipe", () => {
      const lines = plain();
      expect(lines.filter((line) => line.includes("changed no files"))).toHaveLength(1);
      expect(lines.find((line) => line.includes("changed no files"))).toContain("measure against");
    });

    it("never cuts a repository path to fit", () => {
      const repo = "/a/very/long/repository/path/that/does/not/fit/in/forty/columns";
      const lines = plain(
        { repos: [{ repo, sessions: 1, turns: 1, spend: { usd: 1, unpriced: 0, unpricedModels: [] } }] },
        40,
      );
      expect(lines.some((line) => line.includes(repo))).toBe(true);
    });
  });

  it("reads the same without colour as with it", () => {
    const strip = (line: string): string => line.replace(/\u001b\[[0-9;]*m/g, "");
    expect(formatScan(report({ landingUnknown: 1, unrankable: 2 }), ansiPalette).map(strip)).toEqual(
      plain({ landingUnknown: 1, unrankable: 2 }),
    );
  });
});
