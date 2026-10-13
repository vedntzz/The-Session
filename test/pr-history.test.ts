import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prBody } from "../src/commands/pr.js";
import { loadRates } from "../src/pricing.js";
import { renderPr } from "../src/render/pr.js";
import { appendSession, readSessions, resolveStoreFile, zeroCost, type StoreOptions } from "../src/store.js";

let root: string;
let store: StoreOptions;
const proposal = {
  rule: "declared-drift-v1" as const,
  intent: "Historical goal",
  scope: ["suggested.ts"],
  candidates: [{ path: "suggested.ts", reason: "named" as const, sessions: [] }],
  history: 0, comparable: 0, tracked: 1, omitted: 0,
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-pr-history-"));
  store = { cwd: root, home: root };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function recordHistorical(): Promise<void> {
  await appendSession({
    intent: proposal.intent,
    intentSource: "primed",
    proposal,
    scope: ["accepted.ts"],
    reality: ["accepted.ts"],
    startCommit: "base",
    startedAt: "2026-10-01T12:00:00Z",
    endedAt: "2026-10-01T13:00:00Z",
    cost: zeroCost(),
  }, store);
}

describe("historical PR evidence", () => {
  it("reads primed evidence without changing its signed declaration", async () => {
    await recordHistorical();
    const ledger = await resolveStoreFile(store);
    const before = await readFile(ledger);
    const [record] = await readSessions(store);
    expect(record?.intentSource).toBe("primed");
    expect(record?.proposal).toEqual(proposal);
    expect(record?.scope).toEqual(["accepted.ts"]);
    const document = await prBody(undefined, store);
    expect(document).toBe(renderPr(record!, await loadRates(store.home)));
    expect(document).toContain("scope reviewed with Prime");
    expect(document).toContain("accepted.ts");
    expect(await readFile(ledger)).toEqual(before);
  });
});
