import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProgram, type ProgramOptions } from "../src/program.js";
import { asSessions, NO_TRANSCRIPTS } from "../src/program/scan.js";
import type { ScannedSession } from "../src/scan.js";
import { zeroCost } from "../src/store.js";

const execFileAsync = promisify(execFile);

/**
 * `session scan` as the command line runs it: flags in, lines out.
 *
 * The reading is `scan-read.test.ts`, the arithmetic `scan.test.ts`, the words
 * `scan-render.test.ts`. What is left is the wiring between them — which
 * rendering a flag picks, that `--repo` reaches the reader, that a machine
 * with no transcripts is told so — and the one conversion that hands scanned
 * sessions to the HTML page without claiming anything a scan cannot know.
 */

const NOW = new Date("2026-08-23T12:00:00.000Z");

let root: string;
let work: string;
let projects: string;
let store: ProgramOptions;
let opened: string[];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-scan-command-"));
  work = path.join(root, "work");
  projects = path.join(root, "projects");
  await mkdir(work, { recursive: true });
  opened = [];
  store = {
    home: path.join(root, "store"),
    cwd: work,
    adapters: [],
    tmp: root,
    root: projects,
    now: () => NOW,
    launch: async (file) => {
      opened.push(file);
    },
  };
  await execFileAsync("git", ["init", "-q", work]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function run(...argv: string[]): Promise<string[]> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await buildProgram(store).exitOverride().parseAsync(argv, { from: "user" });
  return log.mock.calls.map((call) => String(call[0]));
}

function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

/** One prompt and one priced reply, run in `cwd`. */
async function transcript(name: string, text: string, cwd: string): Promise<void> {
  const dir = path.join(projects, "a-project");
  await mkdir(dir, { recursive: true });
  const lines = [
    { type: "user", timestamp: ago(30), cwd, message: { role: "user", content: text } },
    {
      type: "assistant",
      timestamp: ago(29),
      cwd,
      requestId: `req-${name}`,
      message: {
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "text", text: "thinking about it" }],
        usage: {
          input_tokens: 1_000,
          output_tokens: 100,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    },
  ];
  await writeFile(
    path.join(dir, `${name}.jsonl`),
    lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    "utf8",
  );
}

async function exists(file: string): Promise<boolean> {
  return readdir(path.dirname(file)).then(
    (names) => names.includes(path.basename(file)),
    () => false,
  );
}

describe("session scan", () => {
  it("says there is nothing to scan on a machine where the agent never ran", async () => {
    expect(await run("scan")).toEqual(["", `  ${NO_TRANSCRIPTS}`]);
  });

  it("prints the terminal report for the transcripts it finds", async () => {
    await transcript("aaaa", "add rate limiting to /orders", work);

    const text = (await run("scan")).join("\n");

    expect(text).toContain("1 session");
    expect(text).toContain("the last 30 days");
    expect(text).toContain("add rate limiting to /orders");
  });

  it("reads --days as the window", async () => {
    await transcript("aaaa", "a prompt", work);
    expect((await run("scan", "--days", "3")).join("\n")).toContain("the last 3 days");
  });

  it("refuses a --days that is not a whole number of days", async () => {
    await transcript("aaaa", "a prompt", work);
    await expect(run("scan", "--days", "last tuesday")).rejects.toThrow(/whole number/);
  });

  it("hands --repo to the reader, so other checkouts are left out", async () => {
    const other = path.join(root, "elsewhere");
    await mkdir(other, { recursive: true });
    await transcript("aaaa", "work in this checkout", work);
    await transcript("bbbb", "work somewhere else", other);

    const text = (await run("scan", "--repo", work)).join("\n");

    expect(text).toContain("work in this checkout");
    expect(text).not.toContain("work somewhere else");
  });

  it("finds a checkout named through a symlink, as git files it under the real path", async () => {
    const link = path.join(root, "link-to-work");
    await symlink(work, link);
    await transcript("aaaa", "work in this checkout", work);

    for (const named of [link, path.join(link, "."), await realpath(work)]) {
      expect((await run("scan", "--repo", named)).join("\n")).toContain("work in this checkout");
    }
  });

  it("still filters by a --repo that no longer exists, as typed", async () => {
    const gone = path.join(root, "gone");
    await mkdir(gone, { recursive: true });
    await transcript("aaaa", "work in a deleted directory", gone);
    await transcript("bbbb", "work in this checkout", work);
    await rm(gone, { recursive: true });

    const text = (await run("scan", "--repo", gone)).join("\n");

    expect(text).toContain("work in a deleted directory");
    expect(text).not.toContain("work in this checkout");
  });

  it("writes nothing to the store", async () => {
    await transcript("aaaa", "a prompt", work);
    await run("scan");
    expect(await exists(store.home as string)).toBe(false);
  });

  it("writes an HTML page and opens it for --open, printing no terminal report", async () => {
    await transcript("aaaa", "add rate limiting to /orders", work);

    const lines = await run("scan", "--open");

    expect(opened).toHaveLength(1);
    const file = opened[0] as string;
    expect(lines).toEqual([`  wrote    ${file}`]);
    expect(file.endsWith(".html")).toBe(true);
    expect(await readFile(file, "utf8")).toContain("add rate limiting to /orders");
  });

  it("says there is nothing to scan for --open too, and opens nothing", async () => {
    expect(await run("scan", "--open")).toEqual(["", `  ${NO_TRANSCRIPTS}`]);
    expect(opened).toEqual([]);
  });
});

describe("asSessions", () => {
  const scanned: ScannedSession = {
    id: "aaaa",
    repo: "/dev/one",
    label: "add rate limiting to /orders",
    startedAt: "2026-08-20T14:00:00.000Z",
    endedAt: "2026-08-20T14:40:00.000Z",
    cost: { ...zeroCost(), inputTokens: 100, turns: 2 },
    landed: true,
  };

  it("carries across what a transcript can say for itself", () => {
    const [session] = asSessions([scanned]);
    expect(session).toMatchObject({
      id: "aaaa",
      repo: "/dev/one",
      intent: "add rate limiting to /orders",
      startedAt: "2026-08-20T14:00:00.000Z",
      endedAt: "2026-08-20T14:40:00.000Z",
      cost: scanned.cost,
    });
  });

  it("calls the prompt captured, never declared", () => {
    expect(asSessions([scanned])[0]?.intentSource).toBe("captured");
  });

  it("knows of no scope, no changed paths and no drift", () => {
    const [session] = asSessions([scanned]);
    expect(session?.scope).toEqual([]);
    expect(session?.baseline).toEqual([]);
    expect(session?.reality).toEqual([]);
    expect(session?.drift).toEqual([]);
    expect(session?.startCommit).toBe("");
  });

  it("leaves the outcome open even where something landed while it ran", () => {
    expect(asSessions([scanned])[0]?.outcome).toBe("open");
    expect(asSessions([{ ...scanned, landed: false }])[0]?.outcome).toBe("open");
  });

  it("keeps order and count, and makes nothing of nothing", () => {
    const two = asSessions([scanned, { ...scanned, id: "bbbb" }]);
    expect(two.map((session) => session.id)).toEqual(["aaaa", "bbbb"]);
    expect(asSessions([])).toEqual([]);
  });
});
