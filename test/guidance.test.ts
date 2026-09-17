// Guidance has two readers, but its facts must not depend on which one opened it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INTENT_SOURCES } from "../src/store/record.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");

describe("agent guidance", () => {
  it("keeps AGENTS.md aligned with Claude.md except its heading and skill root", () => {
    const mirrored = read("AGENTS.md")
      .replace(/^# AGENTS\.md\n/, "# CLAUDE.md\n")
      .replaceAll(".agents/skills/", ".claude/skills/");
    expect(mirrored).toBe(read("Claude.md"));
  });

  it.each(["measurement-rules", "terminal-output"])("keeps the %s skill mirrors identical", (skill) => {
    expect(read(`.agents/skills/${skill}/SKILL.md`))
      .toBe(read(`.claude/skills/${skill}/SKILL.md`));
  });

  it.each(["Claude.md", "AGENTS.md"])("documents every intent source in %s's record sketch", (file) => {
    const line = read(file).split("\n").find((entry) => /^\s+intentSource\?: IntentSource\s+\/\//.test(entry));
    expect(line, `${file} has no intentSource field in its record sketch`).toBeDefined();
    const sources = [...(line ?? "").matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(sources).toEqual(INTENT_SOURCES);
  });
});
