import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildKnowledge, knowledgeJson } from "../src/knowledge.js";
import { renderKnowledge } from "../src/render/knowledge/page.js";
import { KNOWLEDGE_CLIENT } from "../src/render/knowledge/client.js";
import { zeroCost, type Session } from "../src/store.js";

export function example(overrides: Partial<Session> = {}): Session {
  return { id: "one", repo: "path:/repo", intent: "fix request handling", intentSource: "declared",
    startedAt: "2026-09-17T12:00:00Z", endedAt: "2026-09-17T13:00:00Z", startCommit: "abc",
    scope: ["src/api"], baseline: [], reality: ["src/api/orders.ts", "test/orders.ts"], drift: ["test/orders.ts"],
    outcome: "merged", cost: zeroCost(), ...overrides };
}
export const window = { at: "2026-09-18T00:00:00Z", days: 30, matching: 1 };

describe("compact knowledge snapshot", () => {
  it("deduplicates paths and preserves intent, evidence references and nulls", () => {
    const input = [example(), example({ id: "passive", intentSource: "captured", intent: null, scope: [], drift: [] }),
      example({ id: "running", endedAt: null, outcome: "open" }),
      example({ id: "empty", reality: [], drift: [], outcome: "empty" })];
    const graph = buildKnowledge(input, "path:/repo", { ...window, matching: 7 });
    expect(graph.paths).toEqual(["src/api", "src/api/orders.ts", "test/orders.ts"]);
    expect(graph.sessions[0]!.slice(6,9)).toEqual([[0],[1,2],[2]]);
    expect(graph.sessions[1]![3]).toBe(null);
    expect(graph.sessions[1]![8]).toBe(null);
    expect(graph.sessions[2]![8]).toBe(null);
    expect(graph.sessions[3]![8]).toEqual([]);
    expect(graph.sessions[3]![5]).toBe("empty");
    expect(graph.snapshot.omitted).toBe(3);
    expect(JSON.parse(knowledgeJson(graph))).toEqual(graph);
  });
  it("keeps a Prime proposal separate from accepted scope", () => {
    const session = example({ intentSource: "primed", proposal: { scope: ["original.ts"] } as Session["proposal"] });
    const graph = buildKnowledge([session], session.repo, window);
    expect(graph.sessions[0]![10]!.map(i=>graph.paths[i])).toEqual(["original.ts"]);
    expect(graph.sessions[0]![6].map(i=>graph.paths[i])).toEqual(["src/api"]);
  });
  it("is deterministic and smaller than repeated named objects on shared-path history", () => {
    const shared=Array.from({length:20},(_,i)=>'src/api/very-long-shared-directory-name/module-'+i+'.ts');
    const sessions=Array.from({length:50},(_,i)=>example({id:String(i),scope:shared,reality:shared,drift:[]}));
    const graph=buildKnowledge(sessions,'path:/repo',{...window,matching:50});
    expect(knowledgeJson(graph)).toBe(knowledgeJson(buildKnowledge(sessions,'path:/repo',{...window,matching:50})));
    const expanded=graph.sessions.map(row=>Object.fromEntries(graph.columns.map((key,i)=>[key,[6,7,8,10].includes(i)&&Array.isArray(row[i])?(row[i] as number[]).map(n=>graph.paths[n]):row[i]])));
    expect(Buffer.byteLength(knowledgeJson(graph))).toBeLessThan(Buffer.byteLength(JSON.stringify(expanded)));
  });
  it("safely embeds hostile text without script injection or external assets", () => {
    const intent='</script><script>alert("owned")</script><img src=x onerror=alert(1)>';
    const graph=buildKnowledge([example({intent})], 'path:/<script>repo</script>', window);
    const html=renderKnowledge(graph);
    expect(html).not.toContain(intent);
    const embedded=html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/)![1]!;
    expect(JSON.parse(embedded).sessions[0][3]).toBe(intent);
    expect(html).not.toMatch(/<(script|link|img)[^>]+(?:src|href)=["']https?:/);
    expect(html).toContain("default-src 'none'");
    expect(()=>new Script(KNOWLEDGE_CLIENT)).not.toThrow();
  });
});
