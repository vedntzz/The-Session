import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { zeroCost, type Session } from "../src/store.js";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { formatSession } from "../src/render/terminal/session.js";
import { cellWidth } from "../src/render/tui/text.js";
import { tableValues } from "./fixtures/table.js";
import { PRIME_RULE } from "../src/prime.js";

const record = (fields: Partial<Session> = {}): Session => ({
  id: "abcdef01-2345", repo: "local:test", intent: "Build the terminal UI", scope: ["src/"], baseline: [],
  reality: ["src/panel.ts", "outside.txt"], drift: ["outside.txt"], cost: zeroCost(), outcome: "open", startCommit: "1234567",
  startedAt: "2026-10-17T15:24:00Z", endedAt: "2026-10-17T15:28:00Z", ...fields,
});

it.each([40, 60, 80])("partitions every changed path without a summary cap at %i columns", width => {
  const inside = Array.from({ length: 5 }, (_, n) => `src/${n}.ts`); const outside = ["a.txt", "b.txt", "c.txt", "d.txt"];
  const session = record({ reality: [...inside, ...outside], drift: outside }); const before = structuredClone(session);
  const lines = formatSession(session, plainPalette, { width });
  expect(tableValues(lines, "scope")).toEqual(["src/"]); expect(tableValues(lines, "changed")).toEqual(["9 files"]);
  expect(tableValues(lines, "inside")).toEqual(["5 files", ...inside]);
  expect(tableValues(lines, "outside")).toEqual(["4 files", ...outside.map(path => `! ${path}`)]);
  expect(new Set(lines.filter(line => /^  [│╭╰├]/u.test(line)).map(cellWidth))).toEqual(new Set([width]));
  expect(lines.join("\n")).not.toContain("mostly in"); expect(session).toEqual(before);
});

it.each([{ reality: [] }, { reality: ["src/panel.ts"] }])("shows measured zero inside/outside counts for %j", ({ reality }) => {
  const lines = formatSession(record({ reality, drift: [] }), plainPalette, { width: 80 });
  expect(tableValues(lines, "changed")).toEqual([`${reality.length} ${reality.length ? "file" : "files"}`]);
  expect(tableValues(lines, "inside")).toEqual([`${reality.length} ${reality.length ? "file" : "files"}`, ...reality]);
  expect(tableValues(lines, "outside")).toEqual(["0 files"]);
});

it.each([{ scope: [] }, { intentSource: "captured" as const, scope: ["stale/"] }])(
  "lists all changed paths without inventing a scope comparison: %j", fields => {
    const session = record(fields); const lines = formatSession(session, plainPalette, { width: 80 });
    expect(tableValues(lines, "scope")).toEqual(["none declared"]);
    expect(tableValues(lines, "changed")).toEqual(["2 files", ...session.reality]);
    expect(tableValues(lines, "inside")).toEqual([]);
    expect(tableValues(lines, "outside")).toEqual(["unknown", "no scope declared to compare against"]);
    expect(lines.join("\n")).not.toContain("! "); expect(lines.join("\n")).not.toContain("stale/");
  },
);

it("retains every accepted path, long Unicode filename and literal path spacing", () => {
  const path = "資料/" + "e\u0301界".repeat(30) + ".ts";
  const scope = [path, "a  file.ts", "third.ts", "fourth.ts", "fifth.ts"];
  const session = record({ scope, reality: [path, "notes/a  file.ts"], drift: [path] }); const before = structuredClone(session);
  const lines = formatSession(session, plainPalette, { width: 40 });
  const accepted = tableValues(lines, "scope"); expect(accepted.slice(0, -4).join("")).toBe(path); expect(accepted.slice(-4)).toEqual(scope.slice(1));
  expect(tableValues(lines, "inside")).toEqual(["1 file", "notes/a  file.ts"]);
  expect(tableValues(lines, "outside").slice(1).map(part => part.replace(/^(?:! |  )/u, "")).join("")).toBe(path);
  expect(session).toEqual(before);
});

it.each([{ scope: [] }, { scope: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"] }])("retains the complete historical proposal: %j", ({ scope }) => {
  const session = record({ proposal: { scope, rule: PRIME_RULE, intent: "Build the terminal UI", candidates: [],
    history: 0, comparable: 0, tracked: 4, omitted: 0 } }); const before = structuredClone(session);
  const lines = formatSession(session, plainPalette, { width: 80 });
  expect(tableValues(lines, "proposed")).toEqual(scope.length ? scope.map(path => JSON.stringify(path)) : ["no suggestion"]);
  expect(session).toEqual(before);
});

it("sanitizes before ink while retaining geometry and the signed paths", () => {
  const session = record({ scope: ["src/\u001b[2J"], reality: ["out/\u001b[2Jfile.ts"], drift: ["out/\u001b[2Jfile.ts"] });
  const before = structuredClone(session); const seen: string[] = []; const ink = (text: string) => { seen.push(text); return text; };
  const lines = formatSession(session, { ...plainPalette, path: ink, drift: ink }, { width: 40 });
  expect(tableValues(lines, "scope")).toEqual(["src/"]); expect(tableValues(lines, "outside")).toEqual(["1 file", "! out/file.ts"]);
  expect(seen.join("\n")).not.toContain("\u001b"); expect(session).toEqual(before);
  expect(formatSession(session, ansiPalette, { width: 40 }).map(stripVTControlCharacters)).toEqual(lines);
});
