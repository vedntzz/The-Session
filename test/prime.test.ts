import { describe, expect, it } from "vitest";
import { proposeScope } from "../src/prime.js";
import { zeroCost, type Session } from "../src/store.js";

const repo = "path:/repo";
const before = "2026-09-14T12:00:00Z";
const tracked = ["api/orders.ts", "db/orders.ts", "api/users.ts"];
function past(id: number, extra: Partial<Session> = {}): Session {
  return { id: String(id), repo, intent: "add orders rate limiting", scope: ["api/orders.ts"],
    reality: ["api/orders.ts", "db/orders.ts"], drift: ["db/orders.ts"], baseline: [],
    startedAt: `2026-09-0${id}T10:00:00Z`, endedAt: `2026-09-0${id}T11:00:00Z`,
    startCommit: "abc", outcome: "open", cost: zeroCost(), ...extra };
}
const history = [past(1), past(2), past(3)];
const request = { intent: "fix orders rate limiting" };

describe("Prime evidence", () => {
  it("suggests repeated planning misses with the actual supporting ids", () => {
    expect(proposeScope(request, history, tracked, repo, before)).toMatchObject({
      scope: ["db/orders.ts"], comparable: 3,
      candidates: [{ path: "db/orders.ts", reason: "drift", sessions: ["1", "2", "3"] }],
    });
  });
  it("does not promote busy files or use broad class similarity", () => {
    const unrelated = history.map((s) => ({ ...s, intent: "add users avatars" }));
    expect(proposeScope(request, unrelated, tracked, repo, before).scope).toEqual([]);
    expect(proposeScope(request, history.map((s) => ({ ...s, drift: [] })), tracked, repo, before).scope).toEqual([]);
  });
  it("never trains on the target, future, open, other repo or assisted sessions", () => {
    for (const extra of [
      { endedAt: before }, { endedAt: null }, { repo: "path:/elsewhere" },
      { intentSource: "primed" as const }, { intentSource: "captured" as const }, { scope: [] },
    ]) {
      expect(proposeScope(request, history.map((s) => ({ ...s, ...extra })), tracked, repo, before).scope).toEqual([]);
    }
  });
  it("requires three supporting declarations and reports thin evidence", () => {
    const result = proposeScope(request, history.slice(0, 2), tracked, repo, before);
    expect(result.scope).toEqual([]);
    expect(result.reason).toContain("No supported suggestion");
    expect(result.comparable).toBe(2);
  });
  it("does not repeat a planning miss that was subsequently declared", () => {
    const cleared = [...history, past(4, { scope: ["db/"], drift: [] })];
    expect(proposeScope(request, cleared, tracked, repo, before).scope).toEqual([]);
  });
  it("does not suggest deleted paths", () => {
    expect(proposeScope(request, history, ["api/orders.ts"], repo, before).scope).toEqual([]);
  });
  it("keeps named files without history, deduplicated and in stable order", () => {
    const result = proposeScope({ ...request, seeds: ["./api/orders.ts", "api/orders.ts"] }, [], tracked, repo, before);
    expect(result.scope).toEqual(["api/orders.ts"]);
    expect(result.history).toBe(0);
  });
  it("abstains on broad seeds rather than taking arbitrary files or rolling up", () => {
    const files = Array.from({ length: 6 }, (_, i) => `src/${i}.ts`);
    const result = proposeScope({ ...request, seeds: ["src/"] }, [], files, repo, before);
    expect(result.scope).toEqual([]);
    expect(result.reason).toContain("cover 6 files");
  });
  it("caps suggestions at five exact paths and counts omissions", () => {
    const files = Array.from({ length: 8 }, (_, i) => `db/${i}.ts`);
    const result = proposeScope(request, history.map((s) => ({ ...s, drift: files })), files, repo, before);
    expect(result.scope).toHaveLength(5);
    expect(result.omitted).toBe(3);
    expect(result.scope.every((file) => files.includes(file))).toBe(true);
  });
  it("rejects repository-wide and escaping seeds", () => {
    for (const seed of [".", "./", "", "/tmp/a", "../a", "src/../../a"]) {
      expect(() => proposeScope({ ...request, seeds: [seed] }, history, tracked, repo, before)).toThrow("inside the repo");
    }
  });
  it("names missing seeds rather than quietly discarding them", () => {
    expect(proposeScope({ ...request, seeds: ["new.ts"] }, history, tracked, repo, before).reason).toContain("new.ts");
  });
  it("uses the support fraction, not only the count", () => {
    const diluted = [...history, ...[4, 5, 6].map((id) => past(id, { drift: [] }))];
    expect(proposeScope(request, diluted, tracked, repo, before).scope).toEqual([]);
  });
});
