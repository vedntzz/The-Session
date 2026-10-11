import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";
import { zeroCost, type Session } from "../src/store.js";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { formatStopConfirmation } from "../src/render/terminal/stop.js";
import { cellWidth } from "../src/render/tui/text.js";

const stopped = (overrides: Partial<Session> = {}): Session => ({
  id: "abcdef01-2345", repo: "local:test", intent: "Build the UI", scope: ["src/"], baseline: [], reality: [], drift: [],
  cost: zeroCost(), outcome: "open", startCommit: "1234567", startedAt: "2026-01-15T14:02:00Z", endedAt: "2026-01-15T14:39:00Z", ...overrides,
});
it.each([0, 3, 4])("counts %i changed files and caps named rows", (count) => {
  const reality = Array.from({ length: count }, (_, index) => `src/${index}.ts`);
  const lines = formatStopConfirmation(stopped({ reality }));
  expect(lines).toContain("  ◔ session  stopped"); expect(lines).toContain("  intent      Build the UI");
  expect(lines).toContain(`  changed     ${count} files`); expect(lines).toContain("  id          abcdef01");
  if (count <= 3) reality.forEach((file) => expect(lines).toContain(`              ${file}`));
  else { expect(lines.join("\n")).toContain("all in src/"); expect(lines.join("\n")).not.toContain("src/0.ts"); }
  expect(lines.at(-1)).toBe("  next        session week last");
});
it.each([60, 80, undefined])("retains full intent and literal Unicode paths at width %s", (width) => {
  const intent = "Keep every word visible without adding punctuation. ".repeat(4).trim();
  const literal = `資料/${"e\u0301界".repeat(40)}.ts`; const record = stopped({ intent, reality: [literal, "notes/a  file*[x],.ts"] });
  const before = JSON.stringify(record); const plain = formatStopConfirmation(record, plainPalette, [], width);
  const first = plain.findIndex((line) => line.startsWith("  intent      "));
  const scope = plain.findIndex((line) => line.startsWith("  scope       "));
  const changed = plain.findIndex((line) => line.startsWith("  changed     "));
  const outside = plain.findIndex((line) => line.startsWith("  outside     "));
  expect(plain.slice(first, scope).map((line) => line.slice(14)).join(" ")).toBe(intent);
  const paths = plain.slice(changed + 1, outside);
  expect(paths.slice(0, -1).map((line, index) => line.slice(index ? 16 : 14)).join("")).toBe(literal);
  expect(paths.at(-1)).toBe("              notes/a  file*[x],.ts");
  expect(formatStopConfirmation(record, ansiPalette, [], width).map(stripVTControlCharacters)).toEqual(plain);
  if (width !== undefined) expect(plain.every((line) => cellWidth(line) <= width)).toBe(true);
  expect(JSON.stringify(record)).toBe(before);
});
it.each([false, true])("sanitizes %s summarized paths and intent before ink", (summary) => {
  const seen: string[] = []; const ink = (text: string) => { seen.push(text); return text; };
  const reality = summary ? ["a", "b", "c", "d"].map((name) => `api\u001b[2J/${name}.ts`) : ["src/a\u001b[2J file.ts"];
  const lines = formatStopConfirmation(stopped({ intent: "Build\u001b[2J safely", reality }), { ...plainPalette, intent: ink, path: ink, meta: ink });
  expect(lines).toContain("  intent      Build safely"); expect(lines.join("\n")).toContain(summary ? "all in api/" : "src/a file.ts");
  expect(seen.join("\n")).not.toContain("\u001b");
});
it("keeps captured and null intent facts with no appended period", () => {
  const captured = stopped({ intent: "First line\nSecond line.", intentSource: "captured" });
  expect(formatStopConfirmation(captured)).toContain("  prompt      First line …");
  const absent = formatStopConfirmation(stopped({ intent: null, intentSource: "captured" }));
  expect(absent).toContain("  prompt      unknown"); expect(absent).toContain("              no intent recorded");
});
it.each([0, 1])("keeps cost evidence honest with %i measured turns", (turns) => {
  const record = stopped({ cost: { ...zeroCost(), turns, apiCalls: 2 } });
  const detail = "  cost     0 tokens  1 turn  (2 api calls)";
  const lines = formatStopConfirmation(record, plainPalette, [detail]);
  if (turns) expect(lines).toContain(detail);
  else { expect(lines).toContain("  cost        unknown"); expect(lines.join("\n")).not.toContain("tokens"); }
  expect(lines.join("\n")).not.toContain("$");
});
it("keeps safe full metadata in a separated wrapped block", () => {
  const detail = `  note     ${"Keep all metadata visible. ".repeat(6).trim()}\u001b[2J`;
  const lines = formatStopConfirmation(stopped(), plainPalette, [detail], 60);
  const id = lines.findIndex((line) => line.startsWith("  id          ")); const cost = lines.findIndex((line) => line.startsWith("  cost        "));
  const start = id + 2; const details = lines.slice(start, cost);
  expect(lines[start - 1]).toBe(""); expect(details.map((line) => line.slice(2)).join(" ")).toBe(stripVTControlCharacters(detail).slice(2));
  expect(lines.every((line) => cellWidth(line) <= 60)).toBe(true);
});
