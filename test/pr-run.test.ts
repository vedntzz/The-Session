import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sweepStampFile } from "../src/commands/sweep.js";
import { buildProgram, type ProgramOptions } from "../src/program.js";
import { readSessions } from "../src/store.js";

const execFileAsync = promisify(execFile);

/**
 * `session pr` as somebody runs it: which session it picks, and the three
 * places the document can end up.
 *
 * Separate from `test/pr.test.ts`, which pins the document itself against
 * literals. What is checked here is what only a real store and a real repo can
 * show — that the default is the session you just finished, that a template
 * comes off disk, and above all that **nothing but the document reaches
 * stdout**, since stdout is piped straight into `gh pr create --body-file -`.
 */

let root: string;
let store: ProgramOptions;
/** What `--copy` was asked to put on the clipboard. Nobody's is touched. */
let copied: string[];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-pr-"));
  const cwd = path.join(root, "work");
  await mkdir(cwd, { recursive: true });
  copied = [];
  store = {
    home: path.join(root, "store"),
    cwd,
    // Off the machine's real transcripts: these sessions cost nothing, which
    // is a case the document has to render as well as any other.
    adapters: [],
    tmp: root,
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

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Runs a subcommand and returns everything it wrote to stdout. */
async function run(...argv: string[]): Promise<string[]> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const program = buildProgram(store).exitOverride();
  await program.parseAsync(argv, { from: "user" });
  const lines = log.mock.calls.map((call) => String(call[0]));
  log.mockRestore();
  return lines;
}

/** Records one closed session that changed `a.txt`. */
async function record(intent: string, ...scope: string[]): Promise<void> {
  const cwd = store.cwd as string;
  await run("start", intent, ...(scope.length > 0 ? ["--scope", ...scope] : []));
  await writeFile(path.join(cwd, "a.txt"), `edited for ${intent}`, "utf8");
  await run("stop");
}

describe("session pr", () => {
  it("writes the document to stdout, whole, and nothing else", async () => {
    await record("rate limit the /orders endpoint", "a.txt");

    const lines = await run("pr");

    // One call: the document is one string, and console.log ends it. Anything
    // else here would be a line in somebody's pull request.
    expect(lines).toHaveLength(1);
    expect(lines[0]?.split("\n")[0]).toBe("rate limit the /orders endpoint");
    expect(lines[0]).toContain("## Declared scope\n\n- a.txt");
    expect(lines[0]).toContain("## Changed\n\n- a.txt");
  });

  it("defaults to the session that just finished", async () => {
    await record("the first thing", "a.txt");
    await record("the second thing", "a.txt");

    expect((await run("pr"))[0]?.split("\n")[0]).toBe("the second thing");
  });

  it("takes a session id, or as much of one as is unambiguous", async () => {
    await record("the first thing", "a.txt");
    await record("the second thing", "a.txt");
    const [first] = await readSessions(store);

    const body = (await run("pr", (first?.id ?? "").slice(0, 8)))[0];
    expect(body?.split("\n")[0]).toBe("the first thing");
  });

  it("says what to do when there is no session to write one from", async () => {
    await expect(run("pr")).rejects.toThrow(
      "No closed sessions yet. Run session start, then session stop.",
    );
  });

  it("keeps the daily sweep off stdout", async () => {
    await record("the first thing", "a.txt");
    const cwd = store.cwd as string;
    await execFileAsync("git", ["-C", cwd, "add", "-A"]);
    await execFileAsync("git", ["-C", cwd, "commit", "-q", "--no-verify", "-m", "landed"]);
    // Due for a sweep again: `week` or `show` would settle it and say so.
    await rm(await sweepStampFile(store), { force: true });

    const lines = await run("pr");

    // Not one word about it. The sweep's notice belongs above a view, and this
    // is not a view — it is a file being piped into another program.
    expect(lines).toHaveLength(1);
    expect(lines[0]?.startsWith("the first thing")).toBe(true);
    expect(lines[0]).not.toContain("recorded 1 outcome");
  });

  it("writes it to a file, with the newline a file ends in", async () => {
    await record("rate limit the /orders endpoint", "a.txt");
    const file = path.join(root, "body.md");

    const lines = await run("pr", "--out", file);

    expect(lines).toEqual([`  wrote    ${file}`]);
    const written = await readFile(file, "utf8");
    expect(written.startsWith("rate limit the /orders endpoint")).toBe(true);
    expect(written.endsWith("\n")).toBe(true);
    expect(written.endsWith("\n\n")).toBe(false);
  });

  it("puts it on the clipboard without the trailing newline", async () => {
    await record("rate limit the /orders endpoint", "a.txt");

    const lines = await run("pr", "--copy");

    expect(lines).toEqual(["  copied   the pull request body"]);
    expect(copied).toHaveLength(1);
    expect(copied[0]?.endsWith("\n")).toBe(false);
    expect(copied[0]).toContain("## Changed");
  });

  it("fills a team's own template from the same record", async () => {
    await record("rate limit the /orders endpoint", "a.txt");
    const template = path.join(root, "pr.md");
    await writeFile(template, "## What\n\n{{intent}}\n\n## Files\n\n{{changed}}\n", "utf8");

    const body = (await run("pr", "--template", template))[0];

    expect(body).toBe("## What\n\nrate limit the /orders endpoint\n\n## Files\n\n- a.txt\n");
    // Only what the template asked for: no headings of ours in somebody
    // else's document.
    expect(body).not.toContain("## Declared scope");
  });

  it("refuses an unknown placeholder by name, and names the file", async () => {
    await record("rate limit the /orders endpoint", "a.txt");
    const template = path.join(root, "pr.md");
    await writeFile(template, "{{intent}}\n\nBy {{author}}\n", "utf8");

    await expect(run("pr", "--template", template)).rejects.toThrow(
      `{{author}} in ${template} is not a placeholder. Use one of: ` +
        "{{intent}}, {{intent_full}}, {{scope}}, {{changed}}, {{drift}}, {{cost}}.",
    );
  });

  it("says a missing template is missing, and where it looked", async () => {
    await record("rate limit the /orders endpoint", "a.txt");
    const missing = path.join(root, "nowhere.md");

    // Not "could not read": that sentence in front of a path somebody typo'd
    // sends them to look at permissions on a file that was never there.
    await expect(run("pr", "--template", missing)).rejects.toThrow(
      `No template at ${missing}. Check the path — it is read from the directory you ran session in.`,
    );
  });

  it("says a directory is a directory, and what a template is instead", async () => {
    await record("rate limit the /orders endpoint", "a.txt");

    // The other half of the same mistake: the path exists, so "no template
    // here" would be a lie and the reader would retype a correct path.
    await expect(run("pr", "--template", root)).rejects.toThrow(
      `${root} is a directory. --template takes a Markdown file with ` +
        "{{intent}}, {{intent_full}}, {{scope}}, {{changed}}, {{drift}} and {{cost}} in it.",
    );
  });
});
