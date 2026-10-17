// One card from the sessions matched to a PR: nothing borrowed, nothing guessed.
import { describe, expect, it } from "vitest";
import type { AgentInfo } from "../../src/agents.js";
import { buildCardData, type CardInputs } from "../../src/pr-card/build-card-data.js";
import { renderPrCard } from "../../src/pr-card/render-pr-card.js";
import type { Session } from "../../src/store.js";
import type { ChainCheck } from "../../src/verify.js";
import { cost, RATES, session } from "../fixtures/markdown.js";

const AGENTS: AgentInfo[] = [];
const INTACT: ChainCheck = { total: 3, verified: 3, unsigned: 0, signaturesChecked: true, truncatedTail: false };
const HASHES_ONLY: ChainCheck = { ...INTACT, signaturesChecked: false };
const BROKEN: ChainCheck = { ...INTACT, verified: 1, break: { line: 2, kind: "hash", detail: "does not hash" } };

/** A merged session at 09:00 on the given day, by claude-code, priced at $1.50, its log intact. */
function worked(id: string, day: number, fields: Partial<Session> = {}): Session {
  const startedAt = new Date(Date.UTC(2026, 9, day, 9)).toISOString();
  return session({ id, startedAt, endedAt: startedAt, cost: cost({ inputTokens: 100_000, agents: ["claude-code"] }), ...fields });
}

/** Every session's chain intact unless overridden, no repo facts, not reverted. */
function inputs(sessions: readonly Session[], overrides: Partial<CardInputs> = {}): CardInputs {
  return { rates: RATES, agents: AGENTS, chains: new Map(sessions.map((s) => [s.id, INTACT])), reverted: false, ...overrides };
}

function build(sessions: Session[], overrides: Partial<CardInputs> = {}) {
  return buildCardData(sessions, inputs(sessions, overrides));
}

describe("buildCardData", () => {
  it("is null with no sessions, so the caller renders the no-record card", () => {
    expect(build([])).toBeNull();
  });

  it("reads one session's intent, agents, files, outcome and cost off its record", () => {
    const one = worked("s1", 1, { intent: "add a retry", reality: ["src/a.ts", "docs/b.md"], drift: ["docs/b.md"] });
    expect(build([one])).toEqual({
      askedFor: "add a retry",
      agents: ["claude-code"],
      files: [{ path: "docs/b.md", inScope: false }, { path: "src/a.ts", inScope: true }],
      cost: { priced: true, usd: 1.5 },
      chain: "verified",
      outcome: "merged",
      reverted: false,
    });
  });

  it("leaves askedFor null when nothing was recorded, rather than borrowing one", () => {
    expect(build([worked("s1", 1, { intent: null })])?.askedFor).toBeNull();
  });

  it("takes reverted from the caller", () => {
    expect(build([worked("s1", 1)], { reverted: true })?.reverted).toBe(true);
  });

  it("joins two intents in start order, de-duplicates agents and merges files by path", () => {
    const later = worked("later", 2, {
      intent: "second", reality: ["src/a.ts", "src/c.ts"], drift: ["src/a.ts"],
      cost: cost({ inputTokens: 100_000, agents: ["claude-code", "codex"] }),
    });
    const earlier = worked("earlier", 1, { intent: "first", reality: ["src/a.ts"], drift: [] });
    const card = build([later, earlier]);
    expect(card?.askedFor).toBe("first · second");
    expect(card?.agents).toEqual(["claude-code", "codex"]);
    expect(card?.files).toEqual([{ path: "src/a.ts", inScope: false }, { path: "src/c.ts", inScope: true }]);
  });

  it("joins only the intents that were recorded", () => {
    expect(build([worked("a", 1, { intent: null }), worked("b", 2, { intent: "second" })])?.askedFor).toBe("second");
  });

  it("sums the cost when every session is priced", () => {
    expect(build([worked("a", 1), worked("b", 2)])?.cost).toEqual({ priced: true, usd: 3 });
  });

  it("makes the whole card unpriced when any session is, with no partial dollar figure", () => {
    const unrated = worked("b", 2, { cost: cost({ model: "claude-x", inputTokens: 100_000 }) });
    const card = build([worked("a", 1), unrated]);
    expect(card?.cost).toEqual({ priced: false, reason: "1 of 2 sessions, no rate for claude-x" });
    expect(card?.cost).not.toHaveProperty("usd");
  });

  it("names each unrated model once, joined with commas", () => {
    const unrated = (id: string, day: number, model: string) => worked(id, day, { cost: cost({ model, inputTokens: 1 }) });
    const card = build([unrated("a", 1, "claude-x"), unrated("b", 2, "gpt-y"), unrated("c", 3, "claude-x")]);
    expect(card?.cost).toEqual({ priced: false, reason: "3 of 3 sessions, no rate for claude-x, gpt-y" });
  });

  it("names the model alone when the card has one session", () => {
    const unrated = worked("a", 1, { cost: cost({ model: "claude-x", inputTokens: 1 }) });
    expect(build([unrated])?.cost).toEqual({ priced: false, reason: "no rate for claude-x" });
  });

  it("renders the cost row with unpriced said once", () => {
    const unrated = worked("b", 2, { cost: cost({ model: "claude-x", inputTokens: 1 }) });
    const card = build([worked("a", 1), unrated]);
    const row = renderPrCard(card!).split("\n").find((line) => line.startsWith("| Cost |"));
    expect(row).toBe("| Cost | unpriced (1 of 2 sessions, no rate for claude-x) |");
    expect(row?.match(/unpriced/gu)).toHaveLength(1);
  });

  it("counts a session nothing was captured for apart from one with no rate", () => {
    const uncaptured = worked("b", 2, { cost: cost({ turns: 0, apiCalls: 0 }) });
    expect(build([worked("a", 1), uncaptured])?.cost).toEqual({ priced: false, reason: "1 of 2 sessions uncaptured" });
  });

  it("reads a log checked by hashes alone as hashes-only, never verified", () => {
    const sessions = [worked("a", 1)];
    expect(build(sessions, { chains: new Map([["a", HASHES_ONLY]]) })?.chain).toBe("hashes-only");
  });

  it("ranks broken over missing over hashes-only over verified", () => {
    const sessions = [worked("a", 1), worked("b", 2)];
    const chainsOf = (a?: ChainCheck, b?: ChainCheck) =>
      new Map([...(a ? [["a", a] as const] : []), ...(b ? [["b", b] as const] : [])]);
    expect(build(sessions, { chains: chainsOf(INTACT, HASHES_ONLY) })?.chain).toBe("hashes-only");
    expect(build(sessions, { chains: chainsOf(HASHES_ONLY) })?.chain).toBe("missing");
    expect(build(sessions, { chains: chainsOf(BROKEN) })?.chain).toBe("broken");
    expect(build(sessions, { chains: chainsOf(BROKEN, HASHES_ONLY) })?.chain).toBe("broken");
  });

  it("is verified only when every session's chain verifies", () => {
    const sessions = [worked("a", 1), worked("b", 2)];
    expect(build(sessions)?.chain).toBe("verified");
    expect(build(sessions, { chains: new Map([["a", INTACT], ["b", BROKEN]]) })?.chain).toBe("broken");
    expect(build(sessions, { chains: new Map([["a", INTACT]]) })?.chain).toBe("missing");
  });

  it("reads broken over missing, and an empty log as missing", () => {
    const sessions = [worked("a", 1), worked("b", 2)];
    expect(build(sessions, { chains: new Map([["a", BROKEN]]) })?.chain).toBe("broken");
    expect(build(sessions, { chains: new Map([["a", INTACT], ["b", { ...INTACT, total: 0, verified: 0 }]]) })?.chain).toBe("missing");
  });

  it("shows the least-landed outcome, ignoring sessions that changed nothing", () => {
    const merged = worked("a", 1, { outcome: "merged" });
    const open = worked("b", 2, { outcome: "open", endedAt: null });
    const empty = worked("c", 3, { reality: [], drift: [] });
    expect(build([merged, open])?.outcome).toBe("open");
    expect(build([merged, empty])?.outcome).toBe("merged");
    expect(build([empty])?.outcome).toBe("empty");
  });

  it("carries no author, name or email", () => {
    const card = build([worked("s1", 1)]);
    expect(Object.keys(card ?? {}).sort()).toEqual(["agents", "askedFor", "chain", "cost", "files", "outcome", "reverted"]);
    expect(JSON.stringify(card)).not.toMatch(/@|author|email/iu);
  });
});
