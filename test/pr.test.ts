import { describe, expect, it } from "vitest";
import { parseRates, type RateTable } from "../src/pricing.js";
import {
  fillTemplate,
  FULL_PROMPT,
  NO_DRIFT,
  NOTHING_CHANGED,
  NOTHING_MEASURED,
  PR_PLACEHOLDERS,
  prParts,
  renderPr,
} from "../src/render/pr.js";
import { zeroCost, type Session, type SessionCost } from "../src/store.js";

/**
 * The document, tested without a log and without a repository.
 *
 * Everything here is a literal. The whole claim `session pr` makes is that the
 * body it prints is a transcription of the record and nothing else — no model
 * writes a word of it — and a transcription is only worth anything if it can
 * be checked character by character against what went in.
 */

const RATES: RateTable = parseRates(
  JSON.stringify({
    models: { "claude-opus-5": { input: 5, cacheRead: 0.5, cacheCreation: 6.25, output: 25 } },
  }),
  "test rates",
);

/** A cost of exactly $1.00: 200,000 input tokens at $5 per million. */
function cost(over: Partial<SessionCost> = {}): SessionCost {
  return {
    ...zeroCost(),
    inputTokens: 200_000,
    turns: 9,
    emptyTurns: 2,
    apiCalls: 14,
    model: "claude-opus-5",
    ...over,
  };
}

function session(over: Partial<Session> = {}): Session {
  return {
    id: "9f3c1a2b",
    repo: "remote:github.com/acme/tool",
    intent: "rate limit the /orders endpoint",
    intentSource: "declared",
    scope: ["src/api/"],
    baseline: [],
    reality: ["src/api/orders.ts"],
    drift: [],
    cost: cost(),
    outcome: "open",
    startedAt: "2026-08-20T09:00:00.000Z",
    endedAt: "2026-08-20T10:00:00.000Z",
    startCommit: "abc1234",
    ...over,
  };
}

/** The document for a session, as one string. */
function body(over: Partial<Session> = {}, rates: RateTable = RATES): string {
  return renderPr(session(over), rates);
}

describe("renderPr", () => {
  it("writes the whole document from the record", () => {
    expect(
      body({
        intent: "rate limit the /orders endpoint",
        scope: ["src/api/"],
        reality: ["src/api/orders.ts", "src/api/limiter.ts"],
        drift: ["src/store.ts"],
      }),
    ).toBe(
      [
        "rate limit the /orders endpoint",
        "",
        "## Declared scope",
        "",
        "- src/api/",
        "",
        "## Changed",
        "",
        "- src/api/limiter.ts",
        "- src/api/orders.ts",
        "",
        "## Outside declared scope",
        "",
        "- src/store.ts",
        "",
        "_$1.00 · 9 turns · 2 that changed no files_",
      ].join("\n"),
    );
  });

  it("ends without a trailing newline, so a paste does not carry one", () => {
    expect(body().endsWith("files_")).toBe(true);
  });

  it("leads with the intent, not with where the work went", () => {
    // There is nowhere for it to have gone yet: this is the document that
    // opens the pull request that would land it.
    expect(body().split("\n")[0]).toBe("rate limit the /orders endpoint");
    expect(body()).not.toMatch(/merged|abandoned|landed/i);
  });

  it("labels a captured intent, since nobody declared it", () => {
    const captured = body({ intentSource: "captured", intent: "why is the limiter flaky?" });

    expect(captured.split("\n")[0]).toBe(
      "why is the limiter flaky? (captured from the first prompt, not declared)",
    );
  });

  it("says nothing of the sort about a declared one", () => {
    expect(body()).not.toContain("captured");
  });

  it("takes the first line of a captured prompt, and folds away the rest", () => {
    const wrapped = body({ intentSource: "captured", intent: "fix the limiter\n\nit 429s early" });

    expect(wrapped.split("\n")[0]).toBe(
      "fix the limiter (captured from the first prompt, not declared)",
    );
    // Nothing is dropped: every word is one click away.
    expect(wrapped).toContain(`<details><summary>${FULL_PROMPT}</summary>`);
    expect(wrapped).toContain("fix the limiter\n\nit 429s early");
  });

  it("takes the first sentence when that ends sooner", () => {
    const long = body({
      intentSource: "captured",
      intent: "Add session debt. For each repo, list the files that keep drifting.",
    });

    expect(long.split("\n")[0]).toBe(
      "Add session debt. (captured from the first prompt, not declared)",
    );
  });

  it("takes the first line when that ends sooner", () => {
    const long = body({
      intentSource: "captured",
      intent: "make the limiter configurable\nit should read from .session.json. and nothing else",
    });

    expect(long.split("\n")[0]).toBe(
      "make the limiter configurable (captured from the first prompt, not declared)",
    );
  });

  it("keeps a path or a version whole, since the stop inside one is not an end", () => {
    const path = body({ intentSource: "captured", intent: "fix src/api/orders.ts so it 429s" });

    expect(path.split("\n")[0]).toBe(
      "fix src/api/orders.ts so it 429s (captured from the first prompt, not declared)",
    );
    // Nothing was cut, so nothing is folded away.
    expect(path).not.toContain("<details>");
  });

  it("ends a run of stops where the run ends", () => {
    const trailing = body({ intentSource: "captured", intent: "wait... why is it 429ing?" });

    expect(trailing.split("\n")[0]).toBe(
      "wait... (captured from the first prompt, not declared)",
    );
  });

  it("opens no block for a captured prompt that was already one sentence", () => {
    const short = body({ intentSource: "captured", intent: "why is the limiter flaky?" });

    expect(short).not.toContain("<details>");
    expect(short.split("\n")[0]).toBe(
      "why is the limiter flaky? (captured from the first prompt, not declared)",
    );
  });

  it("never truncates a declaration, and never opens a block over one", () => {
    // Somebody typed it as the whole of what they were setting out to do, and
    // every word of it is the promise the diff is held to.
    const declared = body({ intent: "rate limit /orders. then cache the 429s. then measure it." });

    expect(declared.split("\n")[0]).toBe(
      "rate limit /orders. then cache the 429s. then measure it.",
    );
    expect(declared).not.toContain("<details>");
  });

  it("puts the block immediately under the summary line", () => {
    const lines = body({ intentSource: "captured", intent: "one. two." }).split("\n");

    expect(lines[0]).toBe("one. (captured from the first prompt, not declared)");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe(`<details><summary>${FULL_PROMPT}</summary>`);
    // And before anything else the document has to say.
    expect(lines.indexOf("## Declared scope")).toBeGreaterThan(lines.indexOf("</details>"));
  });

  it("fences the prompt so it cannot break out of the block", () => {
    // A prompt is text somebody typed at an agent. It can hold anything, and
    // a literal closing tag would spill the rest of it into the pull request
    // as markup.
    const nasty = body({
      intentSource: "captured",
      intent: "first line\n</details>\n## not a heading",
    });

    expect(nasty).toContain("```\nfirst line\n</details>\n## not a heading\n```");
  });

  it("widens the fence past any backticks the prompt holds", () => {
    const fenced = body({
      intentSource: "captured",
      intent: "why does this fail\n```ts\nconst a = 1;\n```",
    });

    // Four, so the prompt's own three-backtick fence cannot close it.
    expect(fenced).toContain("````\nwhy does this fail\n```ts");
    expect(fenced).toContain("```\n````");
  });

  it("omits the drift section entirely when nothing went outside", () => {
    const clean = body({ drift: [] });

    expect(clean).not.toContain("## Outside declared scope");
    // And says nothing in its place: a heading over "none" is one a reviewer
    // learns to skip.
    expect(clean).not.toContain(NO_DRIFT);
  });

  it("omits it for a session that declared no scope, whatever the record holds", () => {
    // Drift is the distance between a declaration and reality. Without a
    // declaration there is no distance, and a pull request claiming twelve
    // files went outside a plan nobody made is an accusation the log cannot
    // support.
    const undeclared = body({ scope: [], drift: ["src/store.ts", "src/git.ts"] });

    expect(undeclared).not.toContain("## Outside declared scope");
    expect(undeclared).toContain("no scope — nothing was declared to drift from");
  });

  it("names every file it changed, however many there are", () => {
    // The list is the thing being reviewed. `show`'s cap is for a line in a
    // terminal, and there is no line here.
    const many = Array.from({ length: 40 }, (_, index) => `src/api/f${index}.ts`);
    const listed = body({ reality: many });

    for (const path of many) {
      expect(listed).toContain(`- ${path}\n`);
    }
    expect(listed).not.toMatch(/\d+ files,/u);
  });

  it("keeps a directory's files together, each group sorted", () => {
    const listed = body({
      reality: ["src/b.ts", "test/a.test.ts", "src/api/orders.ts", "src/a.ts", "README.md"],
    });

    // Not the order a plain sort gives: that puts src/api/orders.ts between
    // src/a.ts and src/b.ts, dropping another directory into the middle of
    // this one.
    expect(listed).toContain(
      [
        "- README.md",
        "- src/a.ts",
        "- src/b.ts",
        "- src/api/orders.ts",
        "- test/a.test.ts",
      ].join("\n"),
    );
  });

  it("names every drift path too", () => {
    const drifted = body({
      drift: ["db/d.sql", "db/a.sql", "db/c.sql", "db/b.sql"],
    });

    expect(drifted).toContain("- db/a.sql\n- db/b.sql\n- db/c.sql\n- db/d.sql");
    expect(drifted).not.toContain("4 files");
  });

  it("says so when a session changed nothing", () => {
    expect(body({ reality: [] })).toContain(NOTHING_CHANGED);
  });

  it("puts the money last, quiet, and once", () => {
    const lines = body().split("\n");

    expect(lines.at(-1)).toBe("_$1.00 · 9 turns · 2 that changed no files_");
    expect(body().match(/\$/gu)).toHaveLength(1);
  });

  it("counts one turn as one turn", () => {
    expect(body({ cost: cost({ turns: 1, emptyTurns: 0 }) })).toContain(
      "$1.00 · 1 turn · 0 that changed no files",
    );
  });

  it("names the model rather than pricing it at a guess", () => {
    const unpriced = body({ cost: cost({ model: "gpt-9" }) });

    expect(unpriced).toContain("200,000 tokens, gpt-9 unpriced · 9 turns · 2 that changed no files");
    expect(unpriced).not.toContain("$0.00");
  });

  it("says nothing was captured rather than printing a row of noughts", () => {
    const nothing = body({ cost: { ...zeroCost(), model: "" } });

    expect(nothing).toContain(NOTHING_MEASURED);
    expect(nothing).not.toContain("$0.00");
    expect(nothing).not.toContain("0 turns");
  });

  it("prices nothing at all when it was handed no rates", () => {
    // The same path a genuinely unknown model takes: tokens and the name.
    expect(body({}, new Map())).toContain("200,000 tokens, claude-opus-5 unpriced");
  });

  it("carries no colour, no emoji and no box drawing", () => {
    const rich = body({ drift: ["src/store.ts"] });

    expect(rich).not.toContain("[");
    expect(rich).not.toMatch(/[─-╿]/u);
    expect(rich).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("prParts", () => {
  it("hands over the five values plain, for a template to arrange", () => {
    const parts = prParts(session({ drift: ["src/store.ts"] }), RATES);

    expect(parts).toEqual({
      intent: "rate limit the /orders endpoint",
      intent_full: "rate limit the /orders endpoint",
      scope: "- src/api/",
      changed: "- src/api/orders.ts",
      drift: "- src/store.ts",
      cost: "$1.00 · 9 turns · 2 that changed no files",
    });
  });

  it("gives a template something to put under its own drift heading", () => {
    // The default document drops that section; a template's author wrote the
    // heading themselves, and nothing under it would be a broken document.
    expect(prParts(session({ drift: [] }), RATES).drift).toBe(NO_DRIFT);
  });

  it("says there was nothing to drift from when no scope was declared", () => {
    // The third state, and neither of the other two sentences is true in it.
    // "Nothing went outside the declared scope" claims a declaration that was
    // never made, and a list of paths would accuse the work of leaving a plan
    // nobody wrote. The wording is the one `{{scope}}` and `## Declared scope`
    // already use, so a template that prints both reads as one document.
    const parts = prParts(session({ scope: [], drift: ["src/store.ts"] }), RATES);

    expect(parts.drift).toBe("no scope — nothing was declared to drift from");
    expect(parts.drift).toBe(parts.scope);
    expect(parts.drift).not.toBe(NO_DRIFT);
    expect(parts.drift).not.toContain("src/store.ts");
  });

  it("hands a template the whole prompt as well as the line", () => {
    const parts = prParts(
      session({ intentSource: "captured", intent: "fix the limiter\n\nit 429s early" }),
      RATES,
    );

    expect(parts.intent).toBe("fix the limiter (captured from the first prompt, not declared)");
    // Whole and unflattened: an author who asked for it wants what was typed.
    expect(parts.intent_full).toBe("fix the limiter\n\nit 429s early");
  });

  it("has one value per placeholder, and no others", () => {
    expect(Object.keys(prParts(session(), RATES)).sort()).toEqual([...PR_PLACEHOLDERS].sort());
  });
});

describe("fillTemplate", () => {
  const parts = { intent: "I", intent_full: "F", scope: "S", changed: "C", drift: "D", cost: "M" };

  it("fills every placeholder a team's own format asks for", () => {
    expect(
      fillTemplate("# {{intent}}\n\n{{intent_full}}\n{{scope}}\n{{changed}}\n{{drift}}\n\n{{cost}}", parts),
    ).toBe("# I\n\nF\nS\nC\nD\n\nM");
  });

  it("fills one used twice, both times", () => {
    expect(fillTemplate("{{intent}} / {{intent}}", parts)).toBe("I / I");
  });

  it("allows the spaced-out spelling", () => {
    expect(fillTemplate("{{ intent }}", parts)).toBe("I");
  });

  it("leaves a template with no placeholders in it alone", () => {
    expect(fillTemplate("nothing to fill", parts)).toBe("nothing to fill");
  });

  it("refuses an unknown placeholder by name", () => {
    expect(() => fillTemplate("{{author}}", parts)).toThrow(
      "{{author}} is not a placeholder. Use one of: " +
        "{{intent}}, {{intent_full}}, {{scope}}, {{changed}}, {{drift}}, {{cost}}.",
    );
  });

  it("names the file it was in, since that is where the typo is", () => {
    expect(() => fillTemplate("{{autor}}", parts, ".github/pr.md")).toThrow(
      "{{autor}} in .github/pr.md is not a placeholder.",
    );
  });

  it("names every unknown one at once", () => {
    expect(() => fillTemplate("{{author}} {{ticket}} {{intent}}", parts)).toThrow(
      "{{author}}, {{ticket}} are not placeholders.",
    );
  });

  it("never leaves braces in the output for a reviewer to find", () => {
    // The failure this refusal exists to prevent: `{{autor}}` reaching a pull
    // request, where it is found by somebody who cannot fix it.
    expect(() => fillTemplate("{{autor}}", parts)).toThrow();
    expect(fillTemplate("{{intent}}", parts)).not.toContain("{{");
  });
});
