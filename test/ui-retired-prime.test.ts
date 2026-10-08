import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAppUi } from "../src/commands/app-ui.js";
import { loadPrUi } from "../src/commands/pr-ui.js";
import type { UiTerminal } from "../src/commands/ui.js";
import { buildProgram } from "../src/program.js";
import { sectionCommand } from "../src/program/home.js";
import { plainPalette, screenControl, uiThemeFor } from "../src/render/palette.js";
import { renderPr } from "../src/render/pr.js";
import { moveMenuSelection, renderUiMenu, UI_MENU } from "../src/render/tui/menu.js";
import { prUiDocument } from "../src/render/tui/pr.js";
import { cellWidth } from "../src/render/tui/text.js";
import { appendSession, resolveStoreFile, zeroCost } from "../src/store.js";

const view = { repo: "local project", branch: "main", home: {} };
function terminal(columns: number, rows: number) {
  const input = new PassThrough(); const output = new PassThrough();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn() });
  Object.assign(output, { isTTY: true, columns, rows });
  let text = ""; output.on("data", chunk => { text += String(chunk); });
  return { input, output, io: { input, output } as unknown as UiTerminal,
    frame: () => text.split(screenControl.paint).at(-1) ?? "" };
}
let root: string; let options: { cwd: string; home: string; adapters: never[] };
beforeEach(async () => {
  vi.stubEnv("TERM", "xterm"); root = await mkdtemp(path.join(tmpdir(), "session-retired-prime-"));
  options = { cwd: path.join(root, "repo"), home: path.join(root, "store"), adapters: [] }; await mkdir(options.cwd);
});
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe("retiring Prime from the workspace", () => {
  it("removes its destination while preserving the neighboring sections and native CLI", () => {
    expect(UI_MENU.map(item => item.screen)).not.toContain("prime");
    expect(UI_MENU.map(item => item.label).join(" ")).not.toMatch(/Prime/u);
    const index = UI_MENU.findIndex(item => item.screen === "pr");
    expect(UI_MENU.slice(index, index + 3).map(item => item.screen)).toEqual(["pr", "agreement", "scan"]);
    expect(moveMenuSelection("pr", 1)).toBe("agreement"); expect(moveMenuSelection("agreement", 1)).toBe("scan");
    expect(moveMenuSelection("scan", -1)).toBe("agreement");
    expect(buildProgram(options).commands.map(command => command.name())).toContain("prime");
    expect(sectionCommand({ screen: "pr", label: "Pull request" })).toBe("session pr");
    expect(sectionCommand({ screen: "scan", label: "Tool activity" })).toBe("session scan");
  });
  it.each([[60, 20], [110, 40]])("opens every remaining destination with real keys at %i×%i", async (columns, rows) => {
    const signals = process.listeners("SIGTERM");
    for (const [index, item] of UI_MENU.entries()) {
      if (item.screen === "home") continue;
      const term = terminal(columns, rows); const running = runAppUi(view, plainPalette, term.io);
      term.input.write("m" + "\u001b[B".repeat(index));
      const lines = term.frame().split("\r\n");
      expect(lines.join("\n")).toContain(`> ${item.label}`); expect(lines.join("\n")).not.toContain("Plan with Prime");
      expect(lines.length).toBeLessThanOrEqual(rows - 1); expect(lines.every(line => cellWidth(line) <= columns - 1)).toBe(true);
      const plain = renderUiMenu({ ...view, selected: item.screen }, columns, rows).lines;
      const colour = renderUiMenu({ ...view, selected: item.screen }, columns, rows, uiThemeFor({ isTTY: true, env: { TERM: "xterm" } })).lines;
      expect(colour.map(stripVTControlCharacters)).toEqual(plain);
      term.input.write("\r"); expect(await running).toMatchObject({ screen: item.screen, label: item.label });
      expect(term.input.listenerCount("keypress")).toBe(0); expect(term.output.listenerCount("resize")).toBe(0);
      expect(term.io.input.setRawMode).toHaveBeenLastCalledWith(false); expect(process.listeners("SIGTERM")).toEqual(signals);
    }
  });
  it("keeps Agreements selected through resize and returns from the menu before exiting Home", async () => {
    const term = terminal(110, 40); const running = runAppUi(view, plainPalette, term.io);
    term.input.write("m" + "\u001b[B".repeat(UI_MENU.findIndex(item => item.screen === "pr")) + "\u001b[B");
    Object.assign(term.output, { columns: 60, rows: 20 }); term.output.emit("resize");
    expect(term.frame()).toContain("> Agreements"); expect(term.frame()).not.toContain("Plan with Prime");
    term.input.emit("keypress", "", { name: "escape" }); expect(term.frame()).toContain("OVERVIEW");
    term.input.write("q"); expect(await running).toBeUndefined();
    expect(term.input.listenerCount("keypress")).toBe(0); expect(term.io.input.setRawMode).toHaveBeenLastCalledWith(false);
  });
  it("continues reading historical primed evidence without changing its signed record", async () => {
    const proposal = { rule: "declared-drift-v1" as const, intent: "Historical goal", scope: ["suggested.ts"],
      candidates: [{ path: "suggested.ts", reason: "named" as const, sessions: [] }], history: 0, comparable: 0, tracked: 1, omitted: 0 };
    await appendSession({ intent: proposal.intent, intentSource: "primed", proposal, scope: ["accepted.ts"], reality: ["accepted.ts"],
      startCommit: "base", startedAt: "2026-10-01T12:00:00Z", endedAt: "2026-10-01T13:00:00Z", cost: zeroCost() }, options);
    const ledger = await resolveStoreFile(options); const before = await readFile(ledger);
    const loaded = await loadPrUi(options); const record = loaded.sessions[0]!;
    expect(record.intentSource).toBe("primed"); expect(record.proposal).toEqual(proposal);
    const document = prUiDocument(record, loaded.rates); expect(document).toBe(renderPr(record, loaded.rates));
    expect(document).toContain("scope reviewed with Prime"); expect(document).toContain("accepted.ts");
    expect(await readFile(ledger)).toEqual(before);
  });
});
