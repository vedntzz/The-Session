import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, GENESIS, lineHash, recordHash, sha256 } from "../src/chain.js";

describe("sha256 / lineHash", () => {
  it("is hex SHA-256 of the utf8 bytes", () => {
    expect(sha256("hello")).toBe(createHash("sha256").update("hello", "utf8").digest("hex"));
  });

  it("hashes a line as it sits on disk, newline excluded", () => {
    expect(lineHash('{"id":"a"}')).toBe(sha256('{"id":"a"}'));
    expect(lineHash('{"id":"a"}')).not.toBe(sha256('{"id":"a"}\n'));
  });

  it("gives the first record a prev that is not a hash of anything", () => {
    expect(GENESIS).toMatch(/^0{64}$/);
  });
});

describe("canonicalJson", () => {
  it("sorts object keys, so a re-serialization that reorders them still verifies", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe(canonicalJson({ b: 1, a: 2 }));
  });

  it("sorts nested keys too", () => {
    expect(canonicalJson({ set: { z: 1, a: { y: 2, x: 3 } } })).toBe(
      '{"set":{"a":{"x":3,"y":2},"z":1}}',
    );
  });

  it("keeps array order, which is data rather than layout", () => {
    expect(canonicalJson({ scope: ["src/b.ts", "src/a.ts"] })).toBe('{"scope":["src/b.ts","src/a.ts"]}');
    expect(canonicalJson(["a", "b"])).not.toBe(canonicalJson(["b", "a"]));
  });

  it("survives a round trip through JSON.parse", () => {
    const value = { v: 1, id: "9f2c", at: "2026-08-15T09:00:00.000Z", set: { scope: [], turns: 3 } };
    expect(canonicalJson(JSON.parse(JSON.stringify(value)))).toBe(canonicalJson(value));
  });

  it("drops undefined, as JSON.stringify would", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("escapes strings the same way JSON.stringify does", () => {
    const tricky = { path: 'src/"odd"\n\\name.ts', emoji: "café" };
    expect(JSON.parse(canonicalJson(tricky))).toEqual(tricky);
  });

  it("handles null and empty containers", () => {
    expect(canonicalJson({ endedAt: null, scope: [], set: {} })).toBe(
      '{"endedAt":null,"scope":[],"set":{}}',
    );
  });
});

describe("recordHash", () => {
  const body = { v: 1, id: "abc", at: "2026-08-15T09:00:00.000Z", set: { intent: "x" }, prev: GENESIS };

  it("covers the body and nothing else", () => {
    expect(recordHash(body)).toBe(sha256(canonicalJson(body)));
  });

  it("changes when any field of the record changes", () => {
    const base = recordHash(body);
    expect(recordHash({ ...body, id: "abd" })).not.toBe(base);
    expect(recordHash({ ...body, at: "2026-08-15T09:00:00.001Z" })).not.toBe(base);
    expect(recordHash({ ...body, set: { intent: "y" } })).not.toBe(base);
    expect(recordHash({ ...body, v: 2 })).not.toBe(base);
  });

  it("changes when the link to the record before it changes", () => {
    expect(recordHash({ ...body, prev: sha256("something else") })).not.toBe(recordHash(body));
  });
});
