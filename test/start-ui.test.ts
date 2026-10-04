import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { uiThemeFor } from "../src/render/palette.js";
import { renderStartUi } from "../src/render/tui/start-screen.js";
import { characters, draftScope, editStart, initialStartState, pasteStartText } from "../src/render/tui/start-state.js";
import { cellWidth } from "../src/render/tui/text.js";

describe("start editing and terminal rendering", () => {
  it("edits graphemes and navigates optional fields without saving", () => {
    let state = editStart(initialStartState(), { sequence: "café e\u0301 修复" });
    expect(characters(state.goal)).toHaveLength(9);
    state = editStart(state, { name: "left" });
    state = editStart(state, { name: "backspace" });
    expect(state.goal).toBe("café e\u0301 复");
    state = editStart(state, { name: "tab" });
    expect(state.field).toBe("scope"); expect(state.scopeOpen).toBe(true);
    state = editStart(state, { name: "tab", shift: true });
    expect(state.field).toBe("goal");
  });

  it("keeps filenames with spaces and commas intact; a paste cannot accept", () => {
    let state = editStart(initialStartState(), { name: "tab" });
    state = pasteStartText(state, 'src/a file.ts\r\ntest/a,b.ts\n\u001b[2Jsrc/other.ts\n');
    expect(draftScope(state)).toEqual(["src/a file.ts", "test/a,b.ts", "src/other.ts"]);
    expect(state.field).toBe("scope");
    const goal = pasteStartText(initialStartState(), "two\nlines\tand more");
    expect(goal.goal).toBe("two lines and more"); expect(goal.field).toBe("goal");
  });

  it.each([[60,20],[80,24],[120,40]])("fits %i columns by %i rows in plain and color", (columns,rows) => {
    const view = {repo:"~/example",branch:"feature/start",draft:initialStartState()};
    const plain = renderStartUi(view,columns,rows).lines;
    const colored = renderStartUi(view,columns,rows,uiThemeFor({isTTY:true,env:{COLORTERM:"truecolor"}})).lines;
    expect(plain.length).toBeLessThanOrEqual(rows-1);
    expect(plain.every(line=>cellWidth(line)<=columns-1)).toBe(true);
    expect(colored.map(stripVTControlCharacters)).toEqual(plain);
    expect(plain.join("\n")).toContain("SESSION");
    expect(plain.join("\n")).toContain("What are you building?");
  });

  it("lets the developer page through a long draft before starting", () => {
    const draft={...initialStartState(),goal:"long intent ".repeat(60),goalCursor:0,field:"start" as const,followCursor:false};
    const view={repo:"example",branch:"branch",draft};
    expect(renderStartUi(view,60,20).lines.join("\n")).toContain("What are you building?");
    const max=renderStartUi(view,60,20).maxScroll;
    expect(renderStartUi({...view,draft:{...draft,scroll:max}},60,20).lines.join("\n")).toContain("Start session");
  });
});
