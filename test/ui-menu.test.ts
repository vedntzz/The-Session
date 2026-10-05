import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { uiThemeFor } from "../src/render/palette.js";
import { SESSION_MARK } from "../src/render/tui/chrome.js";
import { moveMenuSelection, renderUiMenu, UI_MENU } from "../src/render/tui/menu.js";
import { renderStartUi } from "../src/render/tui/start-screen.js";
import { initialStartState } from "../src/render/tui/start-state.js";
import { cellWidth } from "../src/render/tui/text.js";

const view = { repo: "~/example", branch: "feature/ui", selected: "home" as const };

describe("shared Session header and menu", () => {
  it.each([[60, 20], [80, 24], [120, 40]])("fits %i by %i in plain, basic and true colour", (columns, rows) => {
    for (const item of UI_MENU) {
      const current = { ...view, selected: item.screen };
      const plain = renderUiMenu(current, columns, rows).lines;
      expect(plain).toHaveLength(rows - 1);
      expect(plain.every(line => cellWidth(line) === columns - 1)).toBe(true);
      expect(plain.join("\n")).toContain(`> ${item.label}`);
      expect(plain.filter(line => line.trimStart().startsWith(">"))).toHaveLength(1);
      expect(plain.map(line => line.trim()).join(" ")).toContain(item.hint);
      expect(plain.join("\n")).toContain(`Section ${UI_MENU.indexOf(item) + 1} of ${UI_MENU.length}`);
      for (const env of [{ TERM: "xterm" }, { COLORTERM: "truecolor" }]) {
        const colored = renderUiMenu(current, columns, rows, uiThemeFor({ isTTY: true, env })).lines;
        expect(colored.map(stripVTControlCharacters)).toEqual(plain);
      }
    }
  });

  it("uses the same supplied logo and context in the existing start screen", () => {
    const start = renderStartUi({ ...view, draft: initialStartState() }, 80, 30).lines;
    const menu = renderUiMenu(view, 80, 30).lines;
    expect(start.slice(0, 3)).toEqual(menu.slice(0, 3));
    SESSION_MARK.forEach(mark => expect(menu.join("\n")).toContain(mark));
    expect(menu.join("\n")).toContain(view.repo);
    expect(menu.join("\n")).toContain(view.branch);
  });

  it("keeps the selected destination, explanation and controls visible after shrinking", () => {
    const current = { ...view, selected: "help" as const };
    for (const [columns, rows] of [[120, 40], [60, 20]]) {
      const text = renderUiMenu(current, columns!, rows!).lines.join("\n");
      expect(text).toContain("> Help");
      expect(text).toContain("Find controls and available Session commands.");
      expect(text).toContain("Enter Open");
      expect(text).toContain("Esc Back");
    }
  });

  it("makes every destination reachable without wrapping past either end", () => {
    let selected = UI_MENU[0]!.screen;
    const reached = [selected];
    for (let i = 1; i < UI_MENU.length; i++) { selected = moveMenuSelection(selected, 1); reached.push(selected); }
    expect(new Set(reached).size).toBe(UI_MENU.length);
    expect(reached).toEqual(UI_MENU.map(item => item.screen));
    expect(moveMenuSelection(selected, 1)).toBe("help");
    expect(moveMenuSelection("home", -1)).toBe("home");
    expect(moveMenuSelection("help", -1)).toBe("attribution");
  });

  it("sanitizes control sequences and fits wide repository and branch names", () => {
    const lines = renderUiMenu({ ...view, repo: "\u001b[2J\u001b]0;hidden\u0007" + "项目".repeat(50), branch: "\u202ehidden\n" + "界".repeat(80) }, 60, 20).lines;
    expect(lines.every(line => cellWidth(line) === 59)).toBe(true);
    expect(lines.join("\n")).not.toMatch(/[\u001b\u0007\u202e]/u);
    expect(lines.join("\n")).not.toContain("0;hidden");
  });

  it.each([[59, 20], [80, 19], [10, 5], [1, 2]])("offers resize guidance below the minimum at %i by %i", (columns, rows) => {
    const lines = renderUiMenu(view, columns, rows).lines;
    expect(lines.length).toBeLessThanOrEqual(rows - 1);
    expect(lines.every(line => cellWidth(line) <= Math.max(1, columns - 1))).toBe(true);
    expect(lines.join("\n")).not.toContain("> Overview");
    if (columns >= 59) expect(lines.join("\n")).toContain("Resize to at least 60 columns and 20 rows.");
  });
});
