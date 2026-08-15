import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProgram, type ProgramOptions } from "../src/program.js";
import { readSessions, type Session } from "../src/store.js";

const execFileAsync = promisify(execFile);

let root: string;
let store: ProgramOptions;
/** Files `--open` was asked to hand to the desktop. No browser is launched. */
let opened: string[];

/**
 * A throwaway repo with one commit, so `start` has a HEAD to record and never
 * touches the developer's real ~/.session.
 */
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-program-"));
  const cwd = path.join(root, "work");
  await mkdir(cwd, { recursive: true });
  opened = [];
  // `adapters: []` keeps these tests off the machine's real transcripts, and
  // `launch` keeps `--open` from opening a browser on whoever runs them.
  store = {
    home: path.join(root, "store"),
    cwd,
    adapters: [],
    tmp: root,
    launch: async (file) => {
      opened.push(file);
    },
  };

  await execFileAsync("git", ["init", "-q", cwd]);
  await execFileAsync("git", ["-C", cwd, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", cwd, "config", "user.name", "Test"]);
  await writeFile(path.join(cwd, "a.txt"), "a", "utf8");
  await execFileAsync("git", ["-C", cwd, "add", "-A"]);
  await execFileAsync("git", ["-C", cwd, "commit", "-q", "--no-verify", "-m", "first"]);
});

/** Runs a subcommand and returns everything it wrote to stdout via console.log. */
async function run(...argv: string[]): Promise<string[]> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const program = buildProgram(store).exitOverride();
  await program.parseAsync(argv, { from: "user" });
  return log.mock.calls.map((call) => String(call[0]));
}

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("session", () => {
  it("week prints a row per session", async () => {
    await run("start", "the first thing");
    await run("stop");
    await run("start", "the second thing");
    await run("stop");

    const lines = await run("week");

    expect(lines[1]).toContain("started");
    expect(lines[2]).toContain("the first thing");
    expect(lines[3]).toContain("the second thing");
    expect(lines.at(-1)).toContain("2 sessions");
  });

  it("week says so when nothing is in the window", async () => {
    await expect(run("week")).resolves.toEqual(["", "  No sessions in the last 7 days"]);
  });

  it("week narrows the window with --days", async () => {
    await run("start", "today's thing");
    await run("stop");

    const lines = await run("week", "--days", "1");

    expect(lines[2]).toContain("today's thing");
    expect(lines.at(-1)).toContain("1 session");
  });

  it("week refuses a --days that is not a whole number of days", async () => {
    await expect(run("week", "--days", "0")).rejects.toThrow(/whole number of days/);
  });

  it("week --open writes a page, says where, and opens it", async () => {
    await run("start", "the thing on the page");
    await run("stop");

    const lines = await run("week", "--open");
    const file = lines[0]?.replace("  wrote    ", "") as string;

    expect(lines).toHaveLength(1);
    expect(file).toMatch(/session-week-[0-9a-f]{16}\.html$/);
    expect(opened).toEqual([file]);
    await expect(readFile(file, "utf8")).resolves.toContain("the thing on the page");
  });

  it("week --open prints the path before reaching for a browser", async () => {
    // A desktop that cannot open the page still leaves the developer holding
    // it, so the failure names the file rather than losing it.
    store.launch = async () => {
      throw new Error("Could not open a browser with xdg-open.");
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = buildProgram(store).exitOverride();

    await expect(program.parseAsync(["week", "--open"], { from: "user" })).rejects.toThrow(
      /Could not open a browser/,
    );
    expect(String(log.mock.calls[0]?.[0])).toMatch(/^ {2}wrote {4}\S+\.html$/);
  });

  it("week --open honours --days", async () => {
    await run("start", "today's thing");
    await run("stop");

    const lines = await run("week", "--open", "--days", "30");
    const file = lines[0]?.replace("  wrote    ", "") as string;

    await expect(readFile(file, "utf8")).resolves.toContain("The last 30 days");
  });

  it("week without --open opens nothing", async () => {
    await run("week");
    expect(opened).toEqual([]);
  });

  it("show prints the last closed session", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await run("stop");

    const lines = await run("show");

    expect(lines[1]).toMatch(/^ {2}touch a\.txt {2,}\d{2}:\d{2} → \d{2}:\d{2}$/);
    expect(lines).toContain("  declared    a.txt");
    expect(lines).toContain("  changed     a.txt");
    expect(lines).toContain("  outcome     open");
  });

  it("show marks drift", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await writeFile(path.join(store.cwd as string, "undeclared.txt"), "surprise", "utf8");
    await run("stop");

    const outside = (await run("show")).find((line) => line.includes("outside")) as string;

    expect(outside).toContain("! undeclared.txt");
    expect(outside).toContain("← you did not declare this");
  });

  it("show takes a session id", async () => {
    await run("start", "the first thing");
    await run("stop");
    await run("start", "the last thing");
    await run("stop");

    const [first] = await readSessions(store);
    const lines = await run("show", (first as Session).id);

    expect(lines[1]).toContain("the first thing");
  });

  it("show surfaces a refusal when no session has closed", async () => {
    await expect(run("show")).rejects.toThrow(/No closed sessions yet/);
  });

  it("start prints a two-line confirmation", async () => {
    const lines = await run("start", "add rate limiting to /orders");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^ {2}started {2}add rate limiting to \/orders {2}\(head [0-9a-f]{7}\)$/);
    expect(lines[1]).toBe("  scope    none declared");
  });

  it("start passes --scope through to the record", async () => {
    const lines = await run("start", "touch the api", "--scope", "api/orders.py", "api/mw/");
    expect(lines[1]).toBe("  scope    api/orders.py  api/mw/");
  });

  it("start requires an intent argument", async () => {
    const program = buildProgram(store).exitOverride();
    program.configureOutput({ writeErr: () => {} });
    await expect(program.parseAsync(["start"], { from: "user" })).rejects.toThrow();
  });

  it("start surfaces a refusal as a rejection", async () => {
    await run("start", "the first thing");
    await expect(run("start", "the second thing")).rejects.toThrow(/already open/);
  });

  it("stop prints what changed", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");

    await expect(run("stop")).resolves.toEqual(["  stopped  touch a.txt", "  changed  a.txt"]);
  });

  it("stop exits 0 when the session drifted: drift is recorded, never blocked", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await writeFile(path.join(store.cwd as string, "undeclared.txt"), "surprise", "utf8");

    // Resolving is the assertion: cli.ts only sets a non-zero exit code when
    // the action throws, so a clean resolve here is an exit 0.
    const lines = await run("stop");

    expect(lines).toContain("  outside  undeclared.txt");
    expect(process.exitCode).toBeUndefined();
  });

  it("stop surfaces a refusal as a rejection when nothing is open", async () => {
    await expect(run("stop")).rejects.toThrow(/No session is open/);
  });

  it("registers exactly the four subcommands", () => {
    const names = buildProgram()
      .commands.map((command) => command.name())
      .sort();
    expect(names).toEqual(["show", "start", "stop", "week"]);
  });

  it("rejects an unknown subcommand", async () => {
    const program = buildProgram().exitOverride();
    program.configureOutput({ writeErr: () => {} });
    await expect(program.parseAsync(["nope"], { from: "user" })).rejects.toThrow();
  });
});
