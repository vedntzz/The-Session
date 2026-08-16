import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

  it("registers exactly the seven subcommands", () => {
    const names = buildProgram()
      .commands.map((command) => command.name())
      .sort();
    expect(names).toEqual(["hook", "key", "show", "start", "stop", "verify", "week"]);
  });

  it("puts install under hook", () => {
    const hook = buildProgram().commands.find((command) => command.name() === "hook");

    expect(hook?.commands.map((command) => command.name())).toEqual(["install"]);
  });

  it("puts show under key", () => {
    const key = buildProgram().commands.find((command) => command.name() === "key");

    expect(key?.commands.map((command) => command.name())).toEqual(["show"]);
  });

  it("verify confirms a log this tool wrote itself", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await run("stop");

    const lines = await run("verify");

    expect(lines.at(-1)).toMatch(/^ {2}chain {3}intact — 2 records, hashes and signatures/);
    expect(process.exitCode).toBeUndefined();
  });

  it("verify exits non-zero on a log that was edited", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    const log = path.join(store.home as string, ...(await readdir(store.home as string)).filter((n) => n.endsWith(".jsonl")));
    const record = JSON.parse(await readFile(log, "utf8"));
    record.set.intent = "something else entirely";
    await writeFile(log, `${JSON.stringify(record)}\n`, "utf8");

    try {
      const lines = await run("verify");

      expect(lines.some((line) => line.startsWith("  broken  line 1 "))).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = undefined;
    }
  });

  it("verify --log --key checks a log handed over from another machine", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await run("stop");
    // What the other person sends: the log file and the public key, nothing else.
    const home = store.home as string;
    const log = path.join(home, (await readdir(home)).find((n) => n.endsWith(".jsonl")) as string);
    const key = path.join(home, "keys", "ed25519.pub");
    const elsewhere = path.join(root, "elsewhere");
    await mkdir(elsewhere, { recursive: true });
    await writeFile(path.join(elsewhere, "theirs.jsonl"), await readFile(log, "utf8"), "utf8");
    await writeFile(path.join(elsewhere, "theirs.pub"), await readFile(key, "utf8"), "utf8");

    const lines = await run(
      "verify",
      "--log",
      path.join(elsewhere, "theirs.jsonl"),
      "--key",
      path.join(elsewhere, "theirs.pub"),
    );

    expect(lines[0]).toContain("theirs.jsonl");
    expect(lines[1]).toContain("as the log claims");
    expect(lines.at(-1)).toMatch(/^ {2}chain {3}intact — 2 records, hashes and signatures/);
    expect(process.exitCode).toBeUndefined();
  });

  it("verify --log alone says which key to ask for", async () => {
    await run("start", "touch a.txt");
    const home = store.home as string;
    const log = path.join(home, (await readdir(home)).find((n) => n.endsWith(".jsonl")) as string);

    const lines = await run("verify", "--log", log);

    expect(lines[1]).toContain("Pass --key to check the signatures");
    expect(lines[2]).toMatch(/^ {2}claims {2}ed25519:[0-9a-f]{32} signed it/);
  });

  it("key show prints a public key and never the private one", async () => {
    const lines = await run("key", "show");

    expect(lines[0]).toMatch(/^ {2}key {6}ed25519:[0-9a-f]{32}$/);
    expect(lines.join("\n")).toContain("-----BEGIN PUBLIC KEY-----");
    expect(lines.join("\n")).not.toContain("PRIVATE KEY-----\nM");
  });

  it("key show reports the same key session start signs with", async () => {
    await run("start", "touch a.txt");

    const shown = (await run("key", "show"))[0];
    const verified = (await run("verify")).find((line) => line.startsWith("  key"));

    expect(verified).toContain(shown?.trim().replace(/^key\s+/, "") ?? "");
  });

  it("stop --if-open closes an open session and reports it", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");

    await expect(run("stop", "--if-open")).resolves.toEqual([
      "  stopped  touch a.txt",
      "  changed  a.txt",
    ]);
  });

  it("stop --if-open says nothing and exits 0 when no session is open", async () => {
    // This is the hook's ordinary case: a Claude Code session nobody declared.
    await expect(run("stop", "--if-open")).resolves.toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });

  it("stop without --if-open still refuses when nothing is open", async () => {
    await expect(run("stop")).rejects.toThrow(/No session is open/);
  });

  it("hook install registers the hook and says what it wrote and where", async () => {
    const settings = path.join(root, "settings.json");
    await writeFile(settings, JSON.stringify({ model: "opus" }), "utf8");
    store.settings = settings;

    const lines = await run("hook", "install");

    expect(lines).toEqual([
      `  wrote    ${settings}`,
      "  hook     SessionEnd → session stop --if-open",
    ]);
    await expect(readFile(settings, "utf8")).resolves.toContain('"SessionEnd"');
  });

  it("hook install --uninstall takes it back out", async () => {
    const settings = path.join(root, "settings.json");
    await writeFile(settings, JSON.stringify({ model: "opus" }), "utf8");
    store.settings = settings;
    await run("hook", "install");

    const lines = await run("hook", "install", "--uninstall");

    expect(lines[0]).toBe(`  removed  ${settings}`);
    await expect(readFile(settings, "utf8")).resolves.toBe('{\n  "model": "opus"\n}\n');
  });

  it("hook install fails clearly when there is no settings file", async () => {
    store.settings = path.join(root, "nowhere", "settings.json");

    await expect(run("hook", "install")).rejects.toThrow(/No Claude Code settings file at/);
  });

  it("the hook it registers is a command this CLI answers to", async () => {
    // The hook is only worth writing if `session stop --if-open` parses.
    const program = buildProgram(store).exitOverride();
    program.configureOutput({ writeErr: () => {} });

    await expect(
      program.parseAsync(["stop", "--if-open"], { from: "user" }),
    ).resolves.toBeDefined();
  });

  it("rejects an unknown subcommand", async () => {
    const program = buildProgram().exitOverride();
    program.configureOutput({ writeErr: () => {} });
    await expect(program.parseAsync(["nope"], { from: "user" })).rejects.toThrow();
  });

  it("reports the version the package was published as", async () => {
    // `--version` is written into the command tree by hand, so nothing but
    // this test stops a release from shipping a CLI that misreports itself.
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    expect(buildProgram().version()).toBe(manifest.version);
  });
});
