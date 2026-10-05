import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { homeState } from "../src/commands/home.js";
import type { RepoFacts } from "../src/outcome.js";
import { uiThemeFor } from "../src/render/palette.js";
import { homeActions, renderHomeUi } from "../src/render/tui/home.js";
import { cellWidth } from "../src/render/tui/text.js";
import { appendSession, resolveStoreFile, updateSession, zeroCost, type Session } from "../src/store.js";

const context = { repo: "~/example", branch: "feature/ui" };
function session(patch: Partial<Session> = {}): Session {
  return { id: "12345678-example", repo: "path:/example", intent: "Simplify navigation", scope: ["src/"], baseline: [],
    startedAt: "2026-10-04T12:00:00Z", endedAt: "2026-10-04T12:10:00Z", startCommit: "old",
    reality: ["src/a.ts"], drift: [], cost: zeroCost(), outcome: "open", ...patch };
}
const textOf = (home: Parameters<typeof homeActions>[0]) => renderHomeUi({ ...context, home }, 100, 32).lines.join("\n");

describe("Home screen", () => {
  it.each([[60, 20], [80, 24], [120, 40]])("fits all three states at %i by %i with identical colour geometry", (columns, rows) => {
    for (const home of [{}, { running: session({ endedAt: null }) }, { last: session() }]) {
      const view = { ...context, home };
      const plain = renderHomeUi(view, columns, rows).lines;
      const colored = renderHomeUi(view, columns, rows, uiThemeFor({ isTTY: true, env: { COLORTERM: "truecolor" } })).lines;
      expect(plain).toHaveLength(rows - 1);
      expect(plain.every(line => cellWidth(line) === columns - 1)).toBe(true);
      expect(colored.map(stripVTControlCharacters)).toEqual(plain);
      expect(plain.filter(line => line.trimStart().startsWith(">"))).toHaveLength(1);
    }
  });

  it("prioritizes active work and offers resume rather than another start", () => {
    const home = { running: session({ endedAt: null, intent: "Current goal", outcome: "merged" }), last: session({ intent: "Old goal" }) };
    const text = textOf(home);
    expect(text).toContain("Session is recording."); expect(text).toContain("Current goal");
    expect(text).not.toContain("Old goal"); expect(text).not.toContain("landed");
    expect(homeActions(home)[0]).toEqual({ label: "Resume session", screen: "start", selectedSessionId: home.running.id });
    expect(homeActions(home).map(action => action.label)).not.toContain("Start session");
  });

  it("offers first-time setup without invented activity or usage", () => {
    expect(textOf({})).toContain("No sessions recorded in this repo yet.");
    expect(homeActions({}).map(action => action.screen)).toEqual(["start", "hooks"]);
    expect(textOf({})).not.toMatch(/\$0\.00|0 turns|landed/u);
  });

  it("targets the finished record and reports outside-plan changes", () => {
    const last = session({ outcome: "merged", reality: ["src/a.ts", "test/a.ts"], drift: ["test/a.ts"] });
    expect(textOf({ last })).toContain("The work landed on the default branch.");
    expect(textOf({ last })).toContain("1 file changed outside what you declared: test/a.ts.");
    expect(homeActions({ last })[0]).toEqual({ label: "Review last session", screen: "sessions", selectedSessionId: last.id });
    expect(homeActions({ last })[1]?.screen).toBe("start");
  });

  it("keeps unmeasured drift apart from a session that changed nothing", () => {
    const last = session({ intentSource: "captured", scope: [], drift: ["test/a.ts"] });
    expect(textOf({ last })).toContain("Outside-plan changes are not measured.");
    expect(textOf({ last })).not.toContain("1 file changed outside");
    const empty = textOf({ last: session({ reality: [], outcome: "empty" }) });
    expect(empty).toContain("This session changed no files.");
    expect(empty).not.toContain("has not landed");
  });

  it.each([undefined, "paste-only" as const])("names missing captured text (%s) without inventing a goal", intentMissing => {
    const text = textOf({ running: session({ intent: null, intentSource: "captured", intentMissing, endedAt: null }) });
    expect(text).toContain(intentMissing ? "(pasted text not captured)" : "(no prompt yet)");
    expect(text).not.toContain("captured from the first prompt, not declared");
  });

  it("keeps a long declaration reachable and both actions visible while scrolling", () => {
    const view = { ...context, home: { last: session({ intent: "navigation ".repeat(100) + "FINAL GOAL", intentSource: "declared" }) } };
    const max = renderHomeUi(view, 60, 20).maxScroll;
    const frames = Array.from({ length: max + 1 }, (_, scroll) => renderHomeUi({ ...view, scroll }, 60, 20).lines);
    expect(frames.flat().map(line => line.trim()).join(" ")).toContain("FINAL GOAL");
    frames.forEach(lines => expect(lines.join("\n")).toContain("> Review last session"));
    expect(renderHomeUi({ ...view, scroll: max + 100 }, 60, 20)).toEqual(renderHomeUi({ ...view, scroll: max }, 60, 20));
    expect(renderHomeUi({ ...view, scroll: -10 }, 60, 20)).toEqual(renderHomeUi(view, 60, 20));
  });

  it("sanitizes record text, supports the second action and gives resize guidance", () => {
    const view = { repo: "\u001b[2J项目", branch: "branch\u202e", selected: 1, home: { last: session({ intent: "safe\u001b]0;hidden\u0007 goal" }) } };
    const text = renderHomeUi(view, 60, 20).lines.join("\n");
    expect(text).not.toMatch(/[\u001b\u0007\u202e]/u); expect(text).toContain("> Start session");
    expect(renderHomeUi(view, 59, 20).lines.join("\n")).toContain("Resize to at least 60 columns and 20 rows.");
  });

  it("reads an empty repository without creating a store or key", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "session-home-ui-"));
    try {
      const home = path.join(root, "store");
      const state = await homeState({ cwd: root, home });
      expect(state).toEqual({}); renderHomeUi({ ...context, home: state }, 80, 24);
      await expect(access(home)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readdir(root)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("resolves stale outcomes without changing the signed record or creating files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "session-home-ui-"));
    try {
      const options = { cwd: root, home: path.join(root, "store") };
      const opened = await appendSession({ intent: "Simplify navigation", startedAt: session().startedAt, startCommit: "old", scope: ["src/"] }, options);
      await updateSession(opened.id, { endedAt: session().endedAt, reality: ["src/a.ts"], endState: { "src/a.ts": "new" } }, options);
      const file = await resolveStoreFile(options);
      const before = await readFile(file); const files = await readdir(options.home);
      const facts: RepoFacts = { branch: "master", tip: "tip", history: new Map([["src/a.ts", new Set(["new"])]]), absentAtTip: new Set(), working: new Map(), preexisting: new Set() };
      const state = await homeState(options, facts);
      expect(state.last?.outcome).toBe("merged");
      expect(textOf(state)).toContain("The work landed on the default branch.");
      expect(await readFile(file)).toEqual(before); expect(await readdir(options.home)).toEqual(files);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
