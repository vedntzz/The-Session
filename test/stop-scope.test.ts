import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { zeroCost, type Session } from "../src/store.js";
import { ansiPalette, paletteFor, plainPalette } from "../src/render/palette.js";
import { NO_SCOPE } from "../src/render/terminal/intent.js";
import { formatStopConfirmation } from "../src/render/terminal/stop.js";
import { cellWidth } from "../src/render/tui/text.js";

const stopped = (overrides: Partial<Session> = {}): Session => ({
  id: "abcdef01-2345", repo: "local:test", intent: "Build the UI", scope: ["src/"], baseline: [], reality: [], drift: [],
  cost: zeroCost(), outcome: "open", startCommit: "1234567", startedAt: "2026-01-15T14:02:00Z", endedAt: "2026-01-15T14:39:00Z", ...overrides,
});
it.each([0, 1, 3, 4])("shows the recorded %i outside files and caps only their named rows", (count) => {
  const drift = Array.from({ length: count }, (_, index) => `api/${index}.ts`); const marked: string[] = [];
  const lines = formatStopConfirmation(stopped({ reality: ["src/a.ts", ...drift], drift }), {
    ...plainPalette, drift: (text) => { marked.push(text); return text; },
  });
  expect(lines).toContain("  scope       src/");
  const outside = `  outside     ${count} ${count === 1 ? "file" : "files"}`; expect(lines).toContain(outside);
  const changed = lines.findIndex((line) => line.startsWith("  changed     "));
  expect(lines.indexOf("  scope       src/")).toBeLessThan(changed);
  expect(lines.indexOf(outside)).toBeGreaterThan(changed); expect(lines.indexOf(outside)).toBeLessThan(lines.indexOf("  id          abcdef01"));
  if (count > 0) expect(marked).toContain(`${count} ${count === 1 ? "file" : "files"}`); else expect(marked).toEqual([]);
  if (count <= 3) drift.forEach((file) => { expect(lines).toContain(`              ! ${file}`); expect(marked).toContain(`! ${file}`); });
  else { expect(lines).toContain("              ! all in api/"); expect(marked).toContain("! all in api/"); expect(lines.join("\n")).not.toContain("! api/0.ts"); }
});
it.each([undefined, "primed"] as const)("uses recorded drift rather than recomputing for source %s", (intentSource) => {
  const lines = formatStopConfirmation(stopped({ intentSource, reality: ["src/a.ts"], drift: ["src/a.ts"] }));
  expect(lines).toContain("  scope       src/"); expect(lines).toContain("  outside     1 file"); expect(lines).toContain("              ! src/a.ts");
});
it.each([{ scope: [] }, { intentSource: "captured", scope: ["stale/"] }] as const)("keeps undeclared comparisons unknown: %j", (overrides) => {
  const record = stopped({ ...overrides, scope: [...overrides.scope], drift: ["stale/outside.ts"] }); const before = JSON.stringify(record);
  const lines = formatStopConfirmation(record, plainPalette, ["  outside  stale/outside.ts", `  ${NO_SCOPE}`]);
  expect(lines).toContain("  scope       none declared"); expect(lines).toContain("  outside     unknown");
  expect(lines).toContain("              no scope declared to compare against");
  expect(lines.join("\n")).not.toContain("stale/"); expect(lines.join("\n")).not.toContain("! ");
  expect(lines.join("\n")).not.toContain(NO_SCOPE); expect(JSON.stringify(record)).toBe(before);
});
it.each([60, 80, undefined])("keeps all accepted scope paths and color geometry at width %s", (width) => {
  const literal = `資料/${"e\u0301界".repeat(30)}.ts`; const paths = [literal, "a  file*[x],.ts", "notes/third.ts", "fourth.ts"];
  const record = stopped({ scope: paths, drift: [literal] }); const before = JSON.stringify(record); const plain = formatStopConfirmation(record, plainPalette, [], width);
  const scope = plain.findIndex((line) => line.startsWith("  scope       ")); const changed = plain.findIndex((line) => line.startsWith("  changed     "));
  const rows = plain.slice(scope, changed); expect(rows.slice(0, -3).map((line, index) => line.slice(index ? 16 : 14)).join("")).toBe(literal);
  expect(rows.slice(-3)).toEqual(paths.slice(1).map((file) => `              ${file}`));
  const outside = plain.findIndex((line) => line.startsWith("  outside     ")); const id = plain.findIndex((line) => line.startsWith("  id          "));
  const marked = plain.slice(outside + 1, id).map((line, index) => line.slice(index ? 16 : 14));
  expect(marked[0]).toMatch(/^! \S/u); expect(plain.some((line) => /^\s*!\s*$/u.test(line))).toBe(false);
  expect(marked.map((line, index) => index ? line : line.replace(/^! ?/u, "")).join("")).toBe(literal);
  expect(formatStopConfirmation(record, ansiPalette, [], width).map(stripVTControlCharacters)).toEqual(plain);
  expect(formatStopConfirmation(record, paletteFor({ env: { NO_COLOR: "1" }, isTTY: true }), [], width)).toEqual(plain);
  if (width !== undefined) expect(plain.every((line) => cellWidth(line) <= width)).toBe(true);
  expect(JSON.stringify(record)).toBe(before);
});
it.each([false, true])("sanitizes accepted scope and %s summarized outside paths before ink", (summary) => {
  const seen: string[] = []; const ink = (text: string) => { seen.push(text); return text; };
  const drift = summary ? ["a", "b", "c", "d"].map((name) => `api\u001b[2J/${name}.ts`) : ["notes/a\u001b[2J file.ts"];
  const record = stopped({ scope: ["src/\u001b[2J", "notes/a  file.ts"], drift }); const before = JSON.stringify(record);
  const lines = formatStopConfirmation(record, { ...plainPalette, path: ink, drift: ink, meta: ink }, ["  outside  duplicate", `  ${NO_SCOPE}`, "  note     retained"], 60);
  expect(lines).toContain("  scope       src/"); expect(lines).toContain(`              ! ${summary ? "all in api/" : "notes/a file.ts"}`);
  expect(lines).toContain("  note     retained"); expect(lines.join("\n")).not.toContain("duplicate"); expect(lines.join("\n")).not.toContain(NO_SCOPE);
  expect(seen.join("\n")).not.toContain("\u001b"); expect(JSON.stringify(record)).toBe(before);
});
