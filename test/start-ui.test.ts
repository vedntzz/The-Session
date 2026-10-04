import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runStartUi } from "../src/commands/start-ui.js";
import { startSession, startPassiveSession } from "../src/commands/start.js";
import { stopSession } from "../src/commands/stop.js";
import { buildProgram } from "../src/program.js";
import { plainPalette, screenControl, uiThemeFor } from "../src/render/palette.js";
import { renderStartUi } from "../src/render/tui/start-screen.js";
import { characters, draftScope, editStart, initialStartState, pasteStartText } from "../src/render/tui/start-state.js";
import { cellWidth } from "../src/render/tui/text.js";
import type { UiTerminal } from "../src/commands/ui.js";
import { getOpenSession, readSessions, zeroCost, type Session } from "../src/store.js";

const exec = promisify(execFile);
function terminal() {
  const input = new PassThrough(); const output = new PassThrough(); const raw = vi.fn();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: raw });
  Object.assign(output, { isTTY: true, columns: 100, rows: 32 });
  let printed = "";
  output.on("data", chunk => { printed += String(chunk); });
  return { input, output, raw, io: { input, output } as unknown as UiTerminal, text: () => printed };
}
function example(overrides: Partial<Session> = {}): Session {
  return { id: "12345678-example", repo: "path:/example", intent: "Simplify start", scope: ["src/"], baseline: [],
    startedAt: "2026-10-04T12:00:00Z", endedAt: null, startCommit: "abc1234", reality: [], drift: [],
    cost: zeroCost(), outcome: "open", ...overrides };
}

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

describe("interactive start with real records", () => {
  let root: string; let cwd: string; let home: string;
  const options=()=>({cwd,home,adapters:[]});
  beforeEach(async()=>{
    vi.stubEnv("TERM","xterm-256color");
    root=await mkdtemp(path.join(tmpdir(),"session-start-ui-"));cwd=path.join(root,"repo");home=path.join(root,"store");
    await mkdir(cwd);await exec("git",["init","-q",cwd]);
    await exec("git",["-C",cwd,"config","user.name","Test"]);await exec("git",["-C",cwd,"config","user.email","test@example.com"]);
    await writeFile(path.join(cwd,"a.txt"),"base");await exec("git",["-C",cwd,"add","a.txt"]);
    await exec("git",["-C",cwd,"-c","commit.gpgsign=false","commit","-qm","base"]);
  });
  afterEach(async()=>{vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});});
  const ready=async(term:ReturnType<typeof terminal>)=>{await vi.waitFor(()=>expect(term.raw).toHaveBeenCalledWith(true));};
  const settled=async(text:()=>string,part:string)=>{await vi.waitFor(()=>expect(text()).toContain(part));};

  it("cancels without creating a log, key, or store; restores input and listeners", async()=>{
    const term=terminal();const signals=process.listenerCount("SIGINT");
    const running=runStartUi({...options(),startTerminal:term.io});await ready(term);
    term.input.write("an unfinished draft");term.input.emit("keypress","",{name:"escape"});
    expect(await running).toEqual({session:undefined,action:"cancelled"});
    await expect(access(home)).rejects.toThrow();expect(term.raw.mock.calls).toEqual([[true],[false]]);
    expect(term.text()).toContain(screenControl.pasteOff);expect(term.text()).toContain(screenControl.leave);
    expect(term.input.listenerCount("keypress")).toBe(0);expect(term.output.listenerCount("resize")).toBe(0);
    expect(process.listenerCount("SIGINT")).toBe(signals);expect(term.input.isPaused()).toBe(true);
  });

  it("starts once from the entered goal and paths, with the baseline taken at acceptance", async()=>{
    const term=terminal();const running=runStartUi({...options(),startTerminal:term.io});await ready(term);
    await writeFile(path.join(cwd,"before.txt"),"pre-existing");
    term.input.write("add a farewell function\tsrc/a file.ts\rtest/a,b.ts\u0013\u0013");
    await settled(term.text,"Session started.");term.input.write("q");
    const result=await running;expect(result.action).toBe("started");
    const [recorded]=await readSessions(options());expect(recorded?.intent).toBe("add a farewell function");
    expect(recorded?.scope).toEqual(["src/a file.ts","test/a,b.ts"]);expect(recorded?.agreement).toBeUndefined();
    expect(recorded?.baseline).toEqual(["before.txt"]);expect(recorded?.intentSource).toBe("declared");
    expect((await readSessions(options())).length).toBe(1);
  });

  it("a bracketed multiline paste stays in the goal field and cannot start", async()=>{
    const term=terminal();const running=runStartUi({...options(),startTerminal:term.io});await ready(term);
    term.input.write("\u001b[200~first line\t\rsecond line\t\r\u001b[201~");
    await settled(term.text,"first line");expect(await readSessions(options())).toEqual([]);
    term.input.write("\u0013");await settled(term.text,"Session started.");term.input.write("q");await running;
    expect((await readSessions(options()))[0]?.intent).toBe("first line  second line");
  });

  it("closes captured work only when the developer explicitly starts", async()=>{
    const captured=await startPassiveSession(options());const term=terminal();const running=runStartUi({...options(),startTerminal:term.io});await ready(term);
    expect(term.text()).toContain("Starting will close");expect((await getOpenSession(options()))?.id).toBe(captured?.id);
    term.input.write("declare this work\u0013");await settled(term.text,"Session started.");term.input.write("q");await running;
    const sessions=await readSessions(options());expect(sessions).toHaveLength(2);expect(sessions[0]?.endedAt).not.toBeNull();
    expect(sessions[1]?.intent).toBe("declare this work");
  });

  it("refuses saving at an unreadable size and starts only after the terminal grows", async()=>{
    const term=terminal();const running=runStartUi({...options(),startTerminal:term.io});await ready(term);
    term.input.write("edit a");Object.assign(term.output,{columns:40,rows:12});term.output.emit("resize");term.input.write("\u0013");
    expect(await readSessions(options())).toEqual([]);expect(term.text()).toContain("Resize");
    Object.assign(term.output,{columns:80,rows:24});term.output.emit("resize");term.input.write("\u0013");
    await settled(term.text,"Session started.");term.input.write("q");await running;
  });

  it("restores the terminal on an input failure", async()=>{
    const term=terminal();const running=runStartUi({...options(),startTerminal:term.io});await ready(term);
    term.input.emit("error",new Error("input disconnected"));await expect(running).rejects.toThrow("input disconnected");
    expect(term.raw).toHaveBeenLastCalledWith(false);expect(term.text()).toContain(screenControl.leave);
  });

  it("keeps pipes, passive hooks and explicit intents out of the full-screen UI", async()=>{
    const term=terminal();Object.assign(term.output,{isTTY:false});
    await expect(runStartUi({...options(),startTerminal:term.io})).rejects.toThrow("No intent given");expect(term.raw).not.toHaveBeenCalled();
    const tty=terminal();const log=vi.spyOn(console,"log").mockImplementation(()=>{});
    try {
      await buildProgram({...options(),startTerminal:tty.io}).parseAsync(["start","explicit intent"],{from:"user"});
      expect(tty.raw).not.toHaveBeenCalled();await stopSession(options());log.mockClear();
      await buildProgram({...options(),startTerminal:tty.io}).parseAsync(["start","--passive"],{from:"user"});
      expect(tty.raw).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();
    } finally {log.mockRestore();}
  });

  it("routes the bare command to the terminal and prints a truthful confirmation on exit", async()=>{
    const term=terminal();const log=vi.spyOn(console,"log").mockImplementation(()=>{});
    try {
      const running=buildProgram({...options(),startTerminal:term.io,palette:plainPalette}).parseAsync(["start"],{from:"user"});await ready(term);
      term.input.write("declare a plan\u0013");await settled(term.text,"Session started.");term.input.write("q");await running;
      expect(log.mock.calls.flat().join("\n")).toContain("started  declare a plan");
      expect((await readSessions(options()))[0]?.intent).toBe("declare a plan");
    } finally {log.mockRestore();}
  });

  it("resumes an open session without changing its original declaration", async()=>{
    const opened=await startSession("edit a",{...options(),scope:["a.txt"]});
    const term=terminal();const running=runStartUi({...options(),startTerminal:term.io});await ready(term);
    expect(term.text()).toContain("Your plan is on the record.");
    expect(term.text()).toContain("edit a");
    term.input.write("q");const result=await running;
    expect(result.action).toBe("open");expect(result.session?.id).toBe(opened.id);
    expect(result.session?.intent).toBe("edit a");expect(result.session?.scope).toEqual(["a.txt"]);
    expect((await readSessions(options()))[0]?.endedAt).toBeNull();
  });

  it("refreshes a session the editor already closed", async()=>{
    const opened=await startSession("first",options());const term=terminal();const running=runStartUi({...options(),startTerminal:term.io});await ready(term);
    await stopSession(options());term.input.write("r");await settled(term.text,"Refreshed from the record.");
    term.input.write("q");const result=await running;expect(result.session?.id).toBe(opened.id);expect(result.session?.endedAt).not.toBeNull();
    expect(result.session?.outcome).toBe("empty");
  });
});
