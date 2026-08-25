import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOOKS } from "../src/capture/hook.js";
import { buildProgram, parseFlag, type ProgramOptions } from "../src/program.js";
import { readSessions, type Session } from "../src/store.js";

const execFileAsync = promisify(execFile);

let root: string;
let store: ProgramOptions;
/** Files `--open` was asked to hand to the desktop. No browser is launched. */
let opened: string[];
/** What `--copy` was asked to put on the clipboard. Nobody's is touched. */
let copied: string[];

/**
 * A throwaway repo with one commit, so `start` has a HEAD to record and never
 * touches the developer's real ~/.session.
 */
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-program-"));
  const cwd = path.join(root, "work");
  await mkdir(cwd, { recursive: true });
  opened = [];
  copied = [];
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
    copy: async (text) => {
      copied.push(text);
    },
  };

  await execFileAsync("git", ["init", "-q", cwd]);
  await execFileAsync("git", ["-C", cwd, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", cwd, "config", "user.name", "Test"]);
  await writeFile(path.join(cwd, "a.txt"), "a", "utf8");
  await execFileAsync("git", ["-C", cwd, "add", "-A"]);
  await execFileAsync("git", ["-C", cwd, "commit", "-q", "--no-verify", "-m", "first"]);
});

/** A hook payload on a stream, standing in for the one Claude Code pipes in. */
function stdinWith(payload: string): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      yield payload;
    },
  };
}

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

    expect(lines[1]).toContain("2 sessions");
    expect(lines[1]).toContain("landed on the default branch");
    expect(lines[3]).toContain("started");
    expect(lines[4]).toContain("the first thing");
    expect(lines[5]).toContain("the second thing");
    expect(lines.at(-2)).toContain("2 sessions");
  });

  it("week says so when nothing is in the window", async () => {
    await expect(run("week")).resolves.toEqual(["", "  No sessions in the last 7 days"]);
  });

  it("week narrows the window with --days", async () => {
    await run("start", "today's thing");
    await run("stop");

    const lines = await run("week", "--days", "1");

    expect(lines[4]).toContain("today's thing");
    expect(lines.at(-2)).toContain("1 session");
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

    const lines = await run("show", "--full");

    expect(lines[1]).toMatch(/^ {2}touch a\.txt {2,}\d{2}:\d{2} → \d{2}:\d{2}$/);
    expect(lines).toContain("  declared    a.txt");
    expect(lines).toContain("  changed     a.txt");
    expect(lines).toContain("  outcome     open");
  });

  it("show without --full answers in three sentences and a line of figures", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await run("stop");

    const lines = await run("show");

    expect(lines[1]).toBe("  The work has not landed on the default branch yet.");
    expect(lines[2]).toBe('  You asked for "touch a.txt".');
    expect(lines[3]).toBe("  Everything it changed stayed inside what you declared.");
    // No labelled columns, no gutter, no outcome word: that is what --full is.
    expect(lines.join("\n")).not.toContain("declared    ");
    expect(lines.join("\n")).not.toContain("outcome");
  });

  it("show says in the sentence what went outside the scope", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await writeFile(path.join(store.cwd as string, "undeclared.txt"), "surprise", "utf8");
    await run("stop");

    const lines = await run("show");

    expect(lines[3]).toBe("  1 file changed outside what you declared: undeclared.txt.");
  });

  it("show marks drift", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await writeFile(path.join(store.cwd as string, "undeclared.txt"), "surprise", "utf8");
    await run("stop");

    const outside = (await run("show", "--full")).find((line) => line.includes("outside")) as string;

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

    expect(lines[2]).toContain("the first thing");
    expect(lines[2]).toBe('  You asked for "the first thing".');
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

  it("estimate reads the class off the intent and says so", async () => {
    const lines = await run("estimate", "rate limit the /orders endpoint");

    expect(lines[1]).toBe("  estimate  rate limit the /orders endpoint");
    expect(lines[2]).toBe("  class     api         from the intent");
    // Both blocks, both empty. Neither is dropped: a missing block would leave
    // the other reading as the whole answer.
    expect(lines).toContain("  declared  none — nothing like this was declared before it ran");
    expect(lines).toContain("  captured  none — the hook recorded nothing like this");
  });

  it("estimate prefers --scope over the words of the intent", async () => {
    const lines = await run("estimate", "clean up the orders table code", "--scope", "src/ui/");

    expect(lines[2]).toBe("  class     ui          from --scope");
  });

  it("estimate says nothing numeric until there are enough sessions", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await run("stop");

    // a.txt is docs by the path rules, which is why --class says so here.
    const lines = await run("estimate", "touch it again", "--class", "docs");

    expect(lines).toContain("  declared  1 session   intent written at session start");
    expect(lines.join("\n")).toContain("fewer than 5 sessions");
    expect(lines.join("\n")).not.toContain("median");
  });

  it("estimate refuses a --since it cannot read", async () => {
    await expect(run("estimate", "x", "--since", "last tuesday")).rejects.toThrow(/--since takes/);
  });

  it("estimate refuses a class that is not one", async () => {
    await expect(run("estimate", "x", "--class", "frontend")).rejects.toThrow(/not a class/);
  });

  it("push refuses when the repo has no origin to publish to", async () => {
    await run("start", "the thing");
    await run("stop");

    await expect(run("push")).rejects.toThrow(/No origin remote/);
  });

  it("peers says what to run when nothing has been shared yet", async () => {
    await expect(run("peers")).resolves.toEqual([
      "  peers    none yet",
      "           session push publishes yours; session pull brings everyone else's",
    ]);
  });

  it("the bare screen names the state and at most two commands", async () => {
    const lines = await run();

    expect(lines[1]).toBe("  No sessions recorded in this repo yet.");
    // Two suggestions, not a menu. Blank lines aside, that is the whole screen.
    const said = lines.filter((line) => line.trim() !== "");
    expect(said).toHaveLength(3);
    expect(said[1]).toContain('session start "…"');
    expect(said[2]).toContain("session hook install");
  });

  it("the bare screen says what is recording, and how to close it", async () => {
    await run("start", "rate limit the /orders endpoint");

    const lines = await run();

    expect(lines[1]).toMatch(/^ {2}Recording since \d{2}:\d{2}: rate limit the \/orders endpoint\.$/);
    const said = lines.filter((line) => line.trim() !== "");
    expect(said).toHaveLength(3);
    expect(said[1]).toContain("session stop");
    expect(said[2]).toContain("session week");
  });

  it("the bare screen points at the last session once nothing is running", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await run("stop");

    const lines = await run();

    expect(lines[1]).toMatch(/^ {2}Nothing is recording\. The last session ended at \d{2}:\d{2}/);
    const said = lines.filter((line) => line.trim() !== "");
    expect(said).toHaveLength(3);
    expect(said[1]).toContain("session show");
    expect(said[2]).toContain('session start "…"');
  });

  it("--help lists the bare screen, start, week and help all, and nothing else", () => {
    const help = buildProgram(store).helpInformation();
    const commands = help
      .slice(help.indexOf("Commands:"))
      .split("\n")
      .slice(1)
      .filter((line) => line.startsWith("  "))
      .map((line) => line.trim().split(/ {2,}/)[0]);

    expect(commands).toEqual(["session", "start [options] [intent]", "week [options]", "help all"]);
  });

  it("--help says where the rest of the commands went", () => {
    // Through `outputHelp`, because the trailing note is help *text* rather
    // than part of the formatted body `helpInformation` returns.
    const written: string[] = [];
    buildProgram(store)
      .configureOutput({ writeOut: (text) => written.push(text) })
      .outputHelp();

    expect(written.join("")).toContain("session help all");
  });

  it("names every command it left out, read off the tree rather than by hand", () => {
    // The sentence was written out by hand once and was wrong by three
    // commands within a release. Built from the tree, a command registered
    // without being added here cannot go unmentioned.
    const written: string[] = [];
    const program = buildProgram(store);
    program.configureOutput({ writeOut: (text) => written.push(text) }).outputHelp();
    const help = written.join("");

    const brief = ["start", "week"];
    for (const command of program.commands.map((one) => one.name())) {
      if (brief.includes(command) || command === "help") {
        continue;
      }
      expect(help, command).toContain(command);
    }
  });

  it("does not break the command it tells you to run across two lines", () => {
    // It is the one thing in the sentence the reader is meant to type.
    const written: string[] = [];
    buildProgram(store)
      .configureOutput({ writeOut: (text) => written.push(text) })
      .outputHelp();

    expect(written.join("")).toMatch(/^.*session help all\./m);
  });

  it("help all lists every command, including the ones --help leaves out", async () => {
    const listed = (await run("help", "all"))
      .slice(3)
      .map((line) => line.trim().split(/ {2,}/)[0]);

    // Every top-level command, and the subcommands under the three that have
    // them. Nothing is hidden here; that is the whole job of this command.
    for (const name of ["start", "stop", "show", "estimate", "verify", "settle", "push", "peers"]) {
      expect(listed).toContain(name);
    }
    expect(listed).toContain("config set");
    expect(listed).toContain("hook install");
  });

  it("help all is built from the tree, so nothing can fall off it", async () => {
    const registered = buildProgram(store).commands.flatMap((command) => [
      command.name(),
      ...command.commands.map((sub) => `${command.name()} ${sub.name()}`),
    ]);
    const listed = (await run("help", "all"))
      .slice(3)
      .map((line) => line.trim().split(/ {2,}/)[0]);

    expect(listed).toEqual(registered);
  });

  it("help refuses a topic it does not have", async () => {
    await expect(run("help", "sync")).rejects.toThrow(/The only one is: session help all/);
  });

  it("every command --help still lists says it is hidden from nowhere", async () => {
    // The commands the short help leaves out are hidden from a list, not from
    // the parser: each one still runs.
    await expect(run("peers")).resolves.toBeDefined();
    await expect(run("config", "show")).resolves.toBeDefined();
    await expect(run("key", "show")).resolves.toBeDefined();
  });

  it("week --md emits Markdown instead of the table", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await run("stop");

    const document = (await run("week", "--md")).join("\n");

    expect(document).toMatch(/^### AI-assisted work · /);
    expect(document).toContain("| Date | Work | Outcome | Unplanned | Cost |");
    expect(document).toContain("|---|---|---|---:|---:|");
    expect(document).toContain("| **Total** |");
    // The terminal table's furniture is not in it.
    expect(document).not.toContain("started");
  });

  it("week --copy puts the Markdown on the clipboard instead of stdout", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await run("stop");

    const printed = (await run("week", "--copy")).join("\n");

    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatch(/^### AI-assisted work · /);
    expect(copied[0]).toContain("| Date | Work | Outcome | Unplanned | Cost |");
    // Only the confirmation reaches stdout.
    expect(printed).toBe("  copied   1 session as Markdown");
  });

  it("week --copy means the Markdown, not the terminal table", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await run("stop");

    // No `--md` beside it: a terminal table is not what anybody pastes.
    await run("week", "--copy");

    expect(copied[0]).not.toContain("started");
  });

  it("week --md escapes a pipe in an intent end to end", async () => {
    await run("start", "fix grep foo | wc -l", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await run("stop");

    const document = (await run("week", "--md")).join("\n");
    const row = document.split("\n").find((line) => line.includes("grep foo")) as string;

    expect(row).toContain("grep foo \\| wc -l");
    expect(row.split(/(?<!\\)\|/)).toHaveLength(7);
  });

  it("registers exactly the seventeen subcommands", () => {
    const names = buildProgram()
      .commands.map((command) => command.name())
      .sort();
    expect(names).toEqual([
      "config",
      "estimate",
      "help",
      "hook",
      "intent",
      "key",
      "mark",
      "peers",
      "pull",
      "push",
      "scan",
      "settle",
      "show",
      "start",
      "stop",
      "verify",
      "week",
    ]);
  });

  it("puts set and show under config", () => {
    const config = buildProgram().commands.find((command) => command.name() === "config");

    expect(config?.commands.map((command) => command.name())).toEqual(["set", "show"]);
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

  it("verify exits non-zero on a repo with nothing recorded in it", async () => {
    try {
      const lines = await run("verify");

      expect(lines.at(-1)).toBe(
        "  chain   no records — nothing was verified. Run session start to record one.",
      );
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = undefined;
    }
  });

  it("verify --peers exits non-zero when no chain has been pulled here", async () => {
    try {
      const lines = await run("verify", "--peers");

      expect(lines[0]).toBe(
        "  chains  none — nothing has been pulled into this repo, so nothing was checked",
      );
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = undefined;
    }
  });

  it("verify refuses --peers and --log together: they name different things", async () => {
    await expect(run("verify", "--peers", "--log", "somewhere.jsonl")).rejects.toThrow(
      /--peers checks the chains pulled into this repo/,
    );
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

  it("config set writes .session.json at the repo root, not under the store", async () => {
    const lines = await run("config", "set", "client", "Acme");

    const file = path.join(store.cwd as string, ".session.json");
    // realpath: git reports the resolved root, and on macOS /var is a symlink.
    expect(lines[0]).toBe(`  wrote        ${path.join(await realpath(store.cwd as string), ".session.json")}`);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ client: "Acme" });
    await expect(readdir(store.home as string)).rejects.toThrow(/ENOENT/);
  });

  it("config show prints what the repo declares", async () => {
    await run("config", "set", "client", "Acme");
    await run("config", "set", "project", "orders-api");

    const lines = await run("config", "show");

    expect(lines[1]).toBe("  client       Acme");
    expect(lines[2]).toBe("  project      orders-api");
  });

  it("config set refuses a key that is not one of the four", async () => {
    await expect(run("config", "set", "clietn", "Acme")).rejects.toThrow(/not something a session/);
  });

  it("start records what config set declared, and says so", async () => {
    await run("config", "set", "client", "Acme");

    const lines = await run("start", "add rate limiting");

    expect(lines[2]).toBe("  for      Acme");
    const [session] = await readSessions(store);
    expect(session?.attribution).toEqual({ client: "Acme" });
  });

  it("week --client narrows the table and says it narrowed", async () => {
    await run("config", "set", "client", "Acme");
    await run("start", "for acme");
    await run("stop");
    await run("config", "set", "client", "Globex");
    await run("start", "for globex");
    await run("stop");

    const lines = await run("week", "--client", "Acme");

    expect(lines[2]).toBe("  only client Acme");
    expect(lines.join("\n")).toContain("for acme");
    expect(lines.join("\n")).not.toContain("for globex");
  });

  it("week --project narrows too, and an empty result says which filter", async () => {
    await run("config", "set", "project", "orders-api");
    await run("start", "for orders");
    await run("stop");

    await expect(run("week", "--project", "billing")).resolves.toEqual([
      "",
      "  No sessions in the last 7 days for project billing",
    ]);
  });

  it("week --open carries the filter onto the page", async () => {
    await run("config", "set", "client", "Acme");
    await run("start", "for acme");
    await run("stop");

    await run("week", "--open", "--client", "Acme");

    const page = await readFile(opened[0] as string, "utf8");
    expect(page).toContain("The last 7 days, client Acme");
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
      "  hook     SessionStart → session start --passive",
      "  hook     UserPromptSubmit → session intent --from-prompt",
    ]);
    await expect(readFile(settings, "utf8")).resolves.toContain('"SessionEnd"');
  });

  it("hook install --passive=false registers the closer alone", async () => {
    const settings = path.join(root, "settings.json");
    await writeFile(settings, JSON.stringify({ model: "opus" }), "utf8");
    store.settings = settings;

    const lines = await run("hook", "install", "--passive=false");

    expect(lines).toEqual([
      `  wrote    ${settings}`,
      "  hook     SessionEnd → session stop --if-open",
    ]);
    const written = await readFile(settings, "utf8");
    expect(written).not.toContain("SessionStart");
    expect(written).not.toContain("UserPromptSubmit");
  });

  it("hook install --no-passive says the same thing", async () => {
    const settings = path.join(root, "settings.json");
    await writeFile(settings, "{}", "utf8");
    store.settings = settings;

    const lines = await run("hook", "install", "--no-passive");

    expect(lines).toHaveLength(2);
  });

  it("hook install refuses a --passive value that is neither", async () => {
    const settings = path.join(root, "settings.json");
    await writeFile(settings, "{}", "utf8");
    store.settings = settings;

    await expect(run("hook", "install", "--passive=maybe")).rejects.toThrow(
      /--passive takes true or false/,
    );
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

  it("every hook it registers is a command this CLI answers to", async () => {
    // A hook is only worth writing if the command line in it parses.
    for (const hook of HOOKS) {
      const argv = hook.command.split(" ").slice(1);
      const program = buildProgram({ ...store, stdin: stdinWith("") }).exitOverride();
      program.configureOutput({ writeErr: () => {} });

      await expect(program.parseAsync(argv, { from: "user" })).resolves.toBeDefined();
    }
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
    // Shape as well as equality. The two sides now read one file, so a
    // manifest that gave back nothing usable would satisfy a comparison of
    // it with itself; this is what says the thing read was a version.
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints that version when asked for it", async () => {
    // The getter agreeing with the manifest is not the same as `--version`
    // reaching the user, which is the only way anybody actually asks.
    const program = buildProgram().exitOverride();
    let printed = "";
    program.configureOutput({ writeOut: (text) => (printed += text) });

    await expect(program.parseAsync(["--version"], { from: "user" })).rejects.toThrow();

    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(printed.trim()).toBe(manifest.version);
  });
});

describe("session, priced", () => {
  /**
   * A stub adapter, so these tests never read the machine's own transcripts.
   * `claude-opus-4-1` is in the bundled table at $15 per million input tokens.
   */
  function spending(model: string, inputTokens: number): ProgramOptions["adapters"] {
    return [
      {
        name: "stub",
        isAvailable: async () => true,
        capture: async () => ({
          inputTokens,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 0,
          turns: 4,
          emptyTurns: 1,
          apiCalls: 9,
          callsWithoutEdits: 3,
          model,
          emptyTurnTokens: {
            inputTokens: inputTokens / 4,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            outputTokens: 0,
          },
        }),
      },
    ];
  }

  async function spent(model = "claude-opus-4-1", inputTokens = 1_000_000): Promise<void> {
    await run("start", "spend some money");
    // Changes a file, so the session has something that could have merged.
    // Without one it is `empty`, which is a different thing entirely — see
    // the test below.
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    store = { ...store, adapters: spending(model, inputTokens) };
    await run("stop");
    store = { ...store, adapters: [] };
  }

  /** The same money, on a session that changed nothing at all. */
  async function spentOnNothing(): Promise<void> {
    await run("start", "read the code and change nothing");
    store = { ...store, adapters: spending("claude-opus-4-1", 1_000_000) };
    await run("stop");
    store = { ...store, adapters: [] };
  }

  it("show --full leads with the dollar figure and keeps tokens back", async () => {
    await spent();
    const lines = await run("show", "--full");

    expect(lines.find((line) => line.includes("cost"))).toContain("$15.00");
    expect(lines.find((line) => line.includes("no edits"))).toContain("$3.75");
    expect(lines.some((line) => line.includes("tokens"))).toBe(false);
  });

  it("show puts the cost, the turns and the empty turns on one line", async () => {
    await spent();
    const lines = await run("show");

    expect(lines.at(-1)).toMatch(/^ {2}\$15\.00 · \d+ turns? · \d+ produced nothing$/);
  });

  it("show --tokens spells the counters out as well, and implies --full", async () => {
    await spent();
    const lines = await run("show", "--tokens");

    expect(lines.find((line) => line.includes("tokens"))).toContain("1,000,000 in");
    expect(lines.find((line) => line.includes("cost"))).toContain("$15.00");
  });

  it("week keeps cost as the last column, and adds tokens only when asked", async () => {
    await spent();

    const plain = await run("week");
    expect(plain[3]).toContain("cost");
    expect(plain[3]).not.toContain("tokens");
    expect(plain[4]).toContain("$15.00");

    const detailed = await run("week", "--tokens");
    expect(detailed[3]).toContain("tokens");
    expect(detailed[4]).toContain("1,000,000");
  });

  it("week says what the window cost and how much never merged", async () => {
    await spent();
    const lines = await run("week");

    // Nothing has merged, so the whole of it is still owed an outcome.
    expect(lines).toContain("  $15.00 spent, $15.00 of it on changes that never merged");
  });

  it("week calls a session that changed nothing empty, not abandoned", async () => {
    await spentOnNothing();

    const lines = await run("week");

    expect(lines[1]).toContain("1 changed no files");
    expect(lines[4]).toContain("  empty ");
    expect(lines.join("\n")).not.toContain("abandoned");
  });

  it("week keeps that session's spend out of what never merged", async () => {
    await spent();
    await spentOnNothing();

    const lines = await run("week");

    // Both cost $15. Only the one that changed a file is money on changes
    // that never merged; the other never had a change to land.
    expect(lines).toContain("  $30.00 spent, $15.00 of it on changes that never merged");
  });

  it("mark refuses a session that changed nothing", async () => {
    await spentOnNothing();
    const [session] = await readSessions(store);

    await expect(run("mark", (session as Session).id, "abandoned")).rejects.toThrow(
      /changed no files/,
    );
  });

  it("week reports an unpriced model rather than pricing it at a guess", async () => {
    await spent("some-model-nobody-has-priced");
    const lines = await run("week");

    expect(lines.some((line) => line.includes("$"))).toBe(false);
    expect(
      lines.some((line) => line.includes("1 session unpriced: some-model-nobody-has-priced")),
    ).toBe(true);
    // And the file that would fix it, whole, with the model already in it.
    expect(lines.join("\n")).toContain('"some-model-nobody-has-priced": { "input": 0');
  });

  it("week --md says nothing could be priced rather than totalling it at $0.00", async () => {
    // End to end, because the rule is only worth having if the command routes
    // through the renderer that obeys it. A window nobody can price must not
    // reach a meeting note as a week that cost nothing.
    await spent("some-model-nobody-has-priced");
    const lines = await run("week", "--md");
    const document = lines.join("\n");

    expect(document.split("\n").at(-1)).toBe("**— spent: nothing here could be priced**");
    expect(document).toContain("no rate (some-model-nobody-has-priced)");
    expect(document).not.toContain("$0.00");
  });

  it("week --md still totals a week that genuinely cost nothing at $0.00", async () => {
    // The other half, through the same command: nothing was captured, so no
    // rate is missing and the nought is a figure somebody measured.
    await run("start", "cost nothing at all");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await run("stop");

    const document = (await run("week", "--md")).join("\n");

    expect(document).toContain("$0.00 spent");
    expect(document).not.toContain("cost unavailable");
  });

  it("prices an unknown model once rates.json in the store names it", async () => {
    await spent("some-model-nobody-has-priced");
    await mkdir(store.home as string, { recursive: true });
    await writeFile(
      path.join(store.home as string, "rates.json"),
      JSON.stringify({
        models: {
          "some-model-nobody-has-priced": {
            input: 2,
            cacheRead: 0,
            cacheCreation: 0,
            output: 0,
          },
        },
      }),
      "utf8",
    );

    // Nothing was rewritten: the same record, read against a table that now
    // has a price in it.
    expect((await run("week"))[4]).toContain("$2.00");
  });

  it("keeps the bundled rates when the store adds one model", async () => {
    await spent();
    await mkdir(store.home as string, { recursive: true });
    await writeFile(
      path.join(store.home as string, "rates.json"),
      JSON.stringify({ models: { "mine-1": { input: 1, cacheRead: 0, cacheCreation: 0, output: 0 } } }),
      "utf8",
    );

    expect((await run("week"))[4]).toContain("$15.00");
  });
});

describe("passive capture, end to end", () => {
  /** What Claude Code writes to a UserPromptSubmit hook. */
  function payload(prompt: string): string {
    return JSON.stringify({
      session_id: "abc",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: store.cwd,
      hook_event_name: "UserPromptSubmit",
      prompt,
    });
  }

  /** Runs the prompt hook with a payload on stdin, as the editor would. */
  async function prompt(text: string): Promise<void> {
    const program = buildProgram({ ...store, stdin: stdinWith(payload(text)) }).exitOverride();
    await program.parseAsync(["intent", "--from-prompt"], { from: "user" });
  }

  it("records a session nobody declared, from the hook alone", async () => {
    await run("start", "--passive");
    await prompt("why does /orders 500 when the cart is empty");
    await run("stop", "--if-open");

    const [session] = await readSessions(store);
    expect(session?.intent).toBe("why does /orders 500 when the cart is empty");
    expect(session?.intentSource).toBe("captured");
    expect(session?.scope).toEqual([]);
    expect(session?.drift).toEqual([]);
    expect(session?.endedAt).not.toBeNull();
  });

  it("says nothing on the way past, either time", async () => {
    // Both handlers have their stdout fed to the agent as context.
    await expect(run("start", "--passive")).resolves.toEqual([]);
    const program = buildProgram({
      ...store,
      stdin: stdinWith(payload("do the thing")),
    }).exitOverride();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["intent", "--from-prompt"], { from: "user" });
    expect(log.mock.calls).toEqual([]);
  });

  it("keeps the first prompt as the intent, whatever comes after it", async () => {
    await run("start", "--passive");
    await prompt("fix the redirect loop");
    await prompt("actually, rewrite the whole module");

    const [session] = await readSessions(store);
    expect(session?.intent).toBe("fix the redirect loop");
  });

  it("defers entirely to a session the developer started", async () => {
    await run("start", "extract the store layer", "--scope", "src/store.ts");
    await run("start", "--passive");
    await prompt("actually just fix the tests");

    const sessions = await readSessions(store);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.intent).toBe("extract the store layer");
    expect(sessions[0]?.intentSource).toBe("declared");
  });

  it("blocks nothing when there is no session to write to", async () => {
    // No SessionStart ran, so there is nothing open. The prompt goes through.
    await expect(prompt("nobody is recording this")).resolves.toBeUndefined();
    expect(process.exitCode).toBeUndefined();
  });

  it("blocks nothing when the payload is not what it expected", async () => {
    const program = buildProgram({ ...store, stdin: stdinWith("{ not json") }).exitOverride();

    await expect(
      program.parseAsync(["intent", "--from-prompt"], { from: "user" }),
    ).resolves.toBeDefined();
    expect(process.exitCode).toBeUndefined();
  });

  it("marks the row in the week, and says underneath what the mark means", async () => {
    await run("start", "--passive");
    await prompt("why does /orders 500");
    await run("stop", "--if-open");

    const lines = await run("week");

    expect(lines[4]).toContain("~ why does /orders 500");
    expect(lines.at(-2)).toContain("1 session recorded by the hook");
  });

  it("says on show that the intent was captured and no scope was declared", async () => {
    await run("start", "--passive");
    await prompt("why does /orders 500");
    await run("stop", "--if-open");

    const lines = await run("show", "--full");

    expect(lines.some((text) => text.includes("captured from the first prompt"))).toBe(true);
    expect(lines.some((text) => text.includes("makes drift visible"))).toBe(true);
    expect(lines.some((text) => text.trimStart().startsWith("outside"))).toBe(false);
  });

  it("says the same in three sentences without --full", async () => {
    await run("start", "--passive");
    await prompt("why does /orders 500");
    // Something has to change, or the stronger fact — that it changed nothing
    // — is the one the second sentence reports.
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await run("stop", "--if-open");

    const lines = await run("show");

    expect(lines[2]).toBe(
      '  Your first prompt was "why does /orders 500", and you declared nothing up front.',
    );
    expect(lines[3]).toContain("session start --scope");
  });

  it("week --md honours the filters, so a pasted table is the one asked for", async () => {
    await run("start", "declared it", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await run("stop");
    await run("start", "--passive");
    await prompt("never said a word");
    await writeFile(path.join(store.cwd as string, "b.txt"), "written", "utf8");
    await run("stop", "--if-open");

    const document = (await run("week", "--md", "--intent", "declared")).join("\n");

    expect(document).toContain("declared it");
    expect(document).not.toContain("never said a word");
  });

  it("week --intent keeps one kind and says which", async () => {
    await run("start", "declared it first", "--scope", "a.txt");
    await run("stop");
    await run("start", "--passive");
    await prompt("never said a word");
    await run("stop", "--if-open");

    const captured = await run("week", "--intent", "captured");
    expect(captured[2]).toBe("  only captured intents");
    expect(captured.join("\n")).toContain("never said a word");
    expect(captured.join("\n")).not.toContain("declared it first");

    const declared = await run("week", "--intent", "declared");
    expect(declared[2]).toBe("  only declared intents");
    expect(declared.join("\n")).toContain("declared it first");
    expect(declared.join("\n")).not.toContain("never said a word");
  });

  it("week --intent says what it takes when given something else", async () => {
    await expect(run("week", "--intent", "hook")).rejects.toThrow(
      /Use one of: declared, captured/,
    );
  });

  it("estimate reports the two apart rather than pooling them", async () => {
    await run("start", "touch a.txt", "--scope", "a.txt");
    await writeFile(path.join(store.cwd as string, "a.txt"), "edited", "utf8");
    await run("stop");

    // A different file, because a.txt is still dirty from the session above and
    // would land in this one's baseline rather than its reality.
    await run("start", "--passive");
    await prompt("touch b.txt as well");
    await writeFile(path.join(store.cwd as string, "b.txt"), "written", "utf8");
    await run("stop", "--if-open");

    // a.txt is docs by the path rules, so both sessions land in the same class
    // — which is exactly where pooling them would have gone unnoticed.
    const lines = await run("estimate", "touch it again", "--class", "docs");

    expect(lines).toContain("  declared  1 session   intent written at session start");
    expect(lines).toContain("  captured  1 session   intent taken from the first prompt");
  });

  it("start with neither an intent nor --passive still says what to type", async () => {
    await expect(run("start")).rejects.toThrow(/No intent given/);
  });
});

describe("parseFlag", () => {
  it("reads the words a person would write", () => {
    expect(parseFlag("true")).toBe(true);
    expect(parseFlag("yes")).toBe(true);
    expect(parseFlag("1")).toBe(true);
    expect(parseFlag("false")).toBe(false);
    expect(parseFlag("No")).toBe(false);
    expect(parseFlag(" off ")).toBe(false);
  });

  it("refuses anything else rather than reading it as off", () => {
    // A typo silently turning capture off is the failure nobody would notice
    // until a week of sessions was missing.
    expect(() => parseFlag("maybe")).toThrow(/takes true or false/);
    expect(() => parseFlag("")).toThrow(/takes true or false/);
  });
});
