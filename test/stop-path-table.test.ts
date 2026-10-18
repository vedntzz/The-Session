import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { formatStopConfirmation } from "../src/render/terminal/stop.js";
import { cellWidth } from "../src/render/tui/text.js";
import { zeroCost, type Session } from "../src/store.js";
import { tableValues } from "./fixtures/table.js";

const stopped = (fields: Partial<Session> = {}): Session => ({
  id: "abcdef01-2345", repo: "local:test", intent: "Build the terminal UI", scope: ["src/"],
  baseline: [], reality: ["src/panel.ts", "outside.ts"], drift: ["outside.ts"], cost: zeroCost(), outcome: "open",
  startCommit: "1234567", startedAt: "2026-10-17T15:24:00Z", endedAt: "2026-10-17T15:28:00Z", ...fields,
});
const render = (record = stopped(), width = 80) => formatStopConfirmation(record, plainPalette, [], width);

it.each([40, 60, 80])("tables recorded scope, paths and ID at %i columns", width => {
  const lines = render(stopped(), width);
  expect(tableValues(lines, "scope")).toEqual(["src/"]);
  expect(tableValues(lines, "changed")).toEqual(["2 files", "src/panel.ts", "outside.ts"]);
  expect(tableValues(lines, "outside")).toEqual(["1 file", "! outside.ts"]);
  expect(tableValues(lines, "id")).toEqual(["abcdef01"]);
  expect(new Set(lines.filter(line => /[│╭╰├]/u.test(line)).map(cellWidth))).toEqual(new Set([width]));
});

it.each([0, 1, 3, 4])("keeps %i exact outside files while capping their named paths", count => {
  const paths = Array.from({ length: count }, (_, index) => `api/${index}.ts`);
  const lines = render(stopped({ reality: paths, drift: paths }));
  expect(tableValues(lines, "outside")).toEqual([`${count} ${count === 1 ? "file" : "files"}`,
    ...(count <= 3 ? paths.map(path => `! ${path}`) : ["! all in api/"])]);
  expect(tableValues(lines, "changed")).toEqual([`${count} ${count === 1 ? "file" : "files"}`,
    ...(count <= 3 ? paths : ["all in api/"])]);
});

it.each([{ scope: [] }, { intentSource: "captured" as const, scope: ["stale/"] }])(
  "keeps an undeclared comparison unknown: %j", fields => {
    const lines = render(stopped({ ...fields, drift: ["stale/file.ts"] }));
    expect(tableValues(lines, "scope")).toEqual(["none declared"]);
    expect(tableValues(lines, "outside")).toEqual(["unknown", "no scope declared to compare against"]);
    expect(lines.join("\n")).not.toContain("stale/");
  },
);

it("keeps every accepted scope path and literal Unicode filename without changing the record", () => {
  const path = "資料/" + "e\u0301界".repeat(30) + ".ts";
  const record = stopped({ scope: [path, "a  file.ts", "third.ts", "fourth.ts"], reality: [path], drift: [path] });
  const before = structuredClone(record); const lines = render(record, 40);
  const scope = tableValues(lines, "scope");
  expect(scope.slice(0, -3).join("")).toBe(path); expect(scope.slice(-3)).toEqual(record.scope.slice(1));
  expect(tableValues(lines, "changed").slice(1).join("")).toBe(path);
  expect(tableValues(lines, "outside").slice(1).map(part => part.replace(/^(?:! |  )/u, "")).join("")).toBe(path);
  expect(record).toEqual(before);
});

it("keeps the outside marker attached to an unbroken long filename", () => {
  const path = "a".repeat(100) + ".ts"; const lines = render(stopped({ reality: [path], drift: [path] }), 40);
  const parts = tableValues(lines, "outside").slice(1);
  expect(parts[0]).toMatch(/^! a/u); expect(parts).not.toContain("!");
  expect(parts.map(part => part.replace(/^(?:! |  )/u, "")).join("")).toBe(path);
  expect(lines.every(line => cellWidth(line) <= 40)).toBe(true);
});

it("keeps ANSI geometry plain and strips record controls before ink", () => {
  const record = stopped({ scope: ["src/\u001b[2J"], reality: ["notes/\u001b[31mfile.ts"], drift: ["notes/\u001b[31mfile.ts"] });
  const plain = render(record, 60);
  expect(formatStopConfirmation(record, ansiPalette, [], 60).map(stripVTControlCharacters)).toEqual(plain);
  expect(tableValues(plain, "scope")).toEqual(["src/"]);
  expect(tableValues(plain, "outside")).toEqual(["1 file", "! notes/file.ts"]);
  expect(plain.join("\n")).not.toContain("\u001b");
});
