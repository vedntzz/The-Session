import { describe, expect, it } from "vitest";
import {
  classify,
  effectiveOutcome,
  evidenceFor,
  isTerminal,
  judge,
  lastObservation,
  manualOutcome,
  observations,
  parseOutcome,
  type FileEvidence,
  type Observation,
  type RepoFacts,
} from "../src/outcome.js";
import { zeroCost, type Session } from "../src/store.js";

/**
 * Everything here is pure: no repository, no temp directories, no git. The
 * repository's answers arrive as `RepoFacts`, which is the whole point of the
 * split — the classification can be tested against situations that would take
 * a rebase and a force-push to produce for real.
 */

const T = {
  start: "2026-08-15T09:00:00.000Z",
  end: "2026-08-15T11:30:00.000Z",
  observed: "2026-08-16T09:00:00.000Z",
};

/** Blob ids only have to be distinct from each other. */
const BLOB = {
  ended: "1111111111111111111111111111111111111111",
  other: "2222222222222222222222222222222222222222",
  third: "3333333333333333333333333333333333333333",
};

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "9f2c1b0e-0000-4000-8000-000000000000",
    repo: "path:/work",
    intent: "add rate limiting",
    scope: [],
    baseline: [],
    reality: [],
    drift: [],
    cost: zeroCost(),
    outcome: "open",
    startedAt: T.start,
    endedAt: T.end,
    startCommit: "cdd3b4f0000000000000000000000000000000ab",
    ...overrides,
  };
}

interface FactsInput {
  history?: Record<string, string[]>;
  absentAtTip?: string[];
  working?: Record<string, string | null>;
}

function facts({ history = {}, absentAtTip = [], working = {} }: FactsInput = {}): RepoFacts {
  return {
    branch: "origin/main",
    tip: "aaaaaaa0000000000000000000000000000000ff",
    history: new Map(Object.entries(history).map(([path, blobs]) => [path, new Set(blobs)])),
    absentAtTip: new Set(absentAtTip),
    working: new Map(Object.entries(working)),
  };
}

function file(overrides: Partial<FileEvidence> = {}): FileEvidence {
  return { path: "src/a.ts", ended: BLOB.ended, working: null, landed: false, ...overrides };
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    outcome: "merged",
    observedAt: T.observed,
    commit: "aaaaaaa0000000000000000000000000000000ff",
    branch: "origin/main",
    source: "computed",
    ...overrides,
  };
}

describe("classify", () => {
  it("calls it merged when every file's content is in the branch", () => {
    const verdict = classify([
      file({ path: "src/a.ts", landed: true }),
      file({ path: "src/b.ts", landed: true }),
    ]);

    expect(verdict.outcome).toBe("merged");
    expect(verdict.landed).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("calls it merged even though the files are still in the working tree", () => {
    // The ordinary state after merging and pulling: the branch has the content
    // and so does the tree. Reading that as "in flight" would mark almost
    // everything open.
    const verdict = classify([file({ landed: true, working: BLOB.ended })]);

    expect(verdict.outcome).toBe("merged");
  });

  it("calls it open when the work is only in the working tree", () => {
    const verdict = classify([file({ working: BLOB.ended })]);

    expect(verdict.outcome).toBe("open");
    expect(verdict.inFlight).toEqual(["src/a.ts"]);
  });

  it("calls it abandoned when the work is in neither place", () => {
    const verdict = classify([file({ working: BLOB.other })]);

    expect(verdict.outcome).toBe("abandoned");
    expect(verdict.lost).toEqual(["src/a.ts"]);
  });

  it("calls it abandoned when the file is gone from the tree entirely", () => {
    expect(classify([file({ working: null })]).outcome).toBe("abandoned");
  });

  it("calls a partly landed session open while the rest is still in the tree", () => {
    const verdict = classify([
      file({ path: "src/a.ts", landed: true }),
      file({ path: "src/b.ts", working: BLOB.ended }),
    ]);

    expect(verdict.outcome).toBe("open");
    expect(verdict.landed).toEqual(["src/a.ts"]);
    expect(verdict.inFlight).toEqual(["src/b.ts"]);
  });

  it("calls a partly landed session merged once the rest is nowhere", () => {
    // Some of it went in and the remainder was dropped along the way, which is
    // what review does to a branch. It merged.
    const verdict = classify([
      file({ path: "src/a.ts", landed: true }),
      file({ path: "src/b.ts", working: null }),
    ]);

    expect(verdict.outcome).toBe("merged");
    expect(verdict.lost).toEqual(["src/b.ts"]);
  });

  it("calls a session that left nothing behind abandoned", () => {
    const verdict = classify([]);

    expect(verdict.outcome).toBe("abandoned");
    expect(verdict).toMatchObject({ landed: [], inFlight: [], lost: [] });
  });

  describe("deletions", () => {
    it("treats a deletion still absent from the tree as in flight", () => {
      expect(classify([file({ ended: null, working: null })]).outcome).toBe("open");
    });

    it("treats a landed deletion as merged", () => {
      expect(classify([file({ ended: null, working: null, landed: true })]).outcome).toBe("merged");
    });

    it("treats a deletion someone put back as abandoned", () => {
      expect(classify([file({ ended: null, working: BLOB.other })]).outcome).toBe("abandoned");
    });
  });
});

describe("evidenceFor", () => {
  it("finds content that survived a squash merge", () => {
    // The squash commit is not the session's commit and shares no sha with it.
    // What it does share is the bytes, which is the whole reason for matching
    // on content: sha matching would report this as abandoned.
    const wrote = session({
      reality: ["src/a.ts"],
      endState: { "src/a.ts": BLOB.ended },
    });

    const evidence = evidenceFor(
      wrote,
      facts({ history: { "src/a.ts": [BLOB.other, BLOB.ended] } }),
    );

    expect(evidence).toEqual([
      { path: "src/a.ts", ended: BLOB.ended, working: null, landed: true },
    ]);
  });

  it("does not credit a path whose content came from somewhere else", () => {
    const wrote = session({ reality: ["src/a.ts"], endState: { "src/a.ts": BLOB.ended } });

    const [evidence] = evidenceFor(wrote, facts({ history: { "src/a.ts": [BLOB.other] } }));

    expect(evidence?.landed).toBe(false);
  });

  it("reads a deletion as landed when the path is gone at the tip", () => {
    const wrote = session({ reality: ["src/gone.ts"], endState: { "src/gone.ts": null } });

    const [evidence] = evidenceFor(wrote, facts({ absentAtTip: ["src/gone.ts"] }));

    expect(evidence).toMatchObject({ ended: null, landed: true });
  });

  it("reports what the working tree holds now", () => {
    const wrote = session({ reality: ["src/a.ts"], endState: { "src/a.ts": BLOB.ended } });

    const [evidence] = evidenceFor(wrote, facts({ working: { "src/a.ts": BLOB.third } }));

    expect(evidence?.working).toBe(BLOB.third);
  });

  it("skips reality paths with no recorded end state", () => {
    // Nothing to look for. Matching on the name alone would credit this
    // session with whatever anyone else later put at that path.
    const wrote = session({
      reality: ["src/a.ts", "src/b.ts"],
      endState: { "src/a.ts": BLOB.ended },
    });

    expect(evidenceFor(wrote, facts()).map((entry) => entry.path)).toEqual(["src/a.ts"]);
  });

  it("is empty for a session with no end state at all", () => {
    expect(evidenceFor(session({ reality: ["src/a.ts"] }), facts())).toEqual([]);
  });
});

describe("judge", () => {
  it("goes from a session and the repo straight to a verdict", () => {
    const wrote = session({ reality: ["src/a.ts"], endState: { "src/a.ts": BLOB.ended } });

    expect(judge(wrote, facts({ history: { "src/a.ts": [BLOB.ended] } }))).toMatchObject({
      outcome: "merged",
      landed: ["src/a.ts"],
    });
  });
});

describe("effectiveOutcome", () => {
  const merged = facts({ history: { "src/a.ts": [BLOB.ended] } });
  const wrote = session({ reality: ["src/a.ts"], endState: { "src/a.ts": BLOB.ended } });

  it("computes rather than trusting the stored field", () => {
    // The record says open — as every record does until something settles it.
    expect(wrote.outcome).toBe("open");
    expect(effectiveOutcome(wrote, merged)).toBe("merged");
  });

  it("ignores a stored field that disagrees with the repository", () => {
    const stale = { ...wrote, outcome: "abandoned" as const };

    expect(effectiveOutcome(stale, merged)).toBe("merged");
  });

  it("calls a session that has not stopped open, whatever the repo holds", () => {
    const running = { ...wrote, endedAt: null };

    expect(effectiveOutcome(running, merged)).toBe("open");
  });

  it("lets a manual mark override the computation", () => {
    const marked = {
      ...wrote,
      observations: [observation({ outcome: "abandoned", source: "manual" })],
    };

    expect(effectiveOutcome(marked, merged)).toBe("abandoned");
  });

  it("takes the most recent manual mark when there are several", () => {
    const marked = {
      ...wrote,
      observations: [
        observation({ outcome: "abandoned", source: "manual" }),
        observation({ outcome: "merged", source: "manual" }),
      ],
    };

    expect(effectiveOutcome(marked, facts())).toBe("merged");
  });

  it("does not let a computed observation override a later computation", () => {
    // A settled answer is a record of what was true then. What is true now is
    // still worked out from the repository.
    const settled = { ...wrote, observations: [observation({ outcome: "abandoned" })] };

    expect(effectiveOutcome(settled, merged)).toBe("merged");
  });

  it("prefers a manual mark over a computed observation made after it", () => {
    const both = {
      ...wrote,
      observations: [
        observation({ outcome: "abandoned", source: "manual" }),
        observation({ outcome: "merged", source: "computed" }),
      ],
    };

    expect(effectiveOutcome(both, facts())).toBe("abandoned");
  });

  it("falls back to the record when there is no repository to ask", () => {
    const settled = { ...wrote, outcome: "merged" as const };

    expect(effectiveOutcome(settled, undefined)).toBe("merged");
  });

  it("falls back to the record for a session stopped before end states existed", () => {
    const old = session({ reality: ["src/a.ts"], outcome: "merged" });

    expect(effectiveOutcome(old, merged)).toBe("merged");
  });

  it("declines to guess about an old session rather than calling it abandoned", () => {
    // No end state and a stored `open`: reporting open is a refusal to answer,
    // which beats declaring the work lost on no evidence.
    const old = session({ reality: ["src/a.ts"] });

    expect(effectiveOutcome(old, merged)).toBe("open");
  });
});

describe("observations", () => {
  it("is empty for a session nobody has settled", () => {
    expect(observations(session())).toEqual([]);
    expect(lastObservation(session())).toBeUndefined();
    expect(manualOutcome(session())).toBeUndefined();
  });

  it("returns the last of any kind, and the last manual one", () => {
    const wrote = session({
      observations: [
        observation({ outcome: "merged", source: "manual" }),
        observation({ outcome: "abandoned", source: "computed" }),
      ],
    });

    expect(lastObservation(wrote)?.outcome).toBe("abandoned");
    expect(manualOutcome(wrote)?.outcome).toBe("merged");
  });
});

describe("isTerminal", () => {
  it("is true for the outcomes that will not change on their own", () => {
    expect(isTerminal("merged")).toBe(true);
    expect(isTerminal("abandoned")).toBe(true);
    expect(isTerminal("open")).toBe(false);
  });
});

describe("parseOutcome", () => {
  it("takes the three outcomes, in any case and with stray space", () => {
    expect(parseOutcome("merged")).toBe("merged");
    expect(parseOutcome("  ABANDONED ")).toBe("abandoned");
    expect(parseOutcome("Open")).toBe("open");
  });

  it("names the alternatives when it is given something else", () => {
    expect(() => parseOutcome("shipped")).toThrow(/not an outcome.*open, merged, abandoned/s);
  });
});
