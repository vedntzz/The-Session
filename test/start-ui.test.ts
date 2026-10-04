import { describe, expect, it } from "vitest";
import { characters, draftScope, editStart, initialStartState, pasteStartText } from "../src/render/tui/start-state.js";

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
});
