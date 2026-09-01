import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { overlaps, parseScanDays, scanSessions, transcriptsExist } from "../src/commands/scan.js";
import { parseRates, type RateTable } from "../src/pricing.js";

const execFileAsync = promisify(execFile);

/**
 * The half that reads the disk: transcripts in, sessions out.
 *
 * Separate from `test/scan.test.ts`, which tests the arithmetic with literals.
 * What is checked here is what only a real directory can show — that a session
 * is one transcript, that calls outside the window are left out, that a
 * fourteen-megabyte file is never held in memory, and that the command writes
 * nothing anywhere.
 */

const RATES: RateTable = parseRates(
  JSON.stringify({
    models: { "claude-opus-5": { input: 5, cacheRead: 0.5, cacheCreation: 6.25, output: 25 } },
  }),
  "test rates",
);

const NOW = new Date("2026-08-23T12:00:00.000Z");
const clock = () => NOW;

let root: string;
let projects: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-scan-"));
  projects = path.join(root, "projects");
  await mkdir(projects, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Minutes before `NOW`, as a transcript writes an instant. */
function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function prompt(at: string, text: string, cwd: string): string {
  return JSON.stringify({
    type: "user",
    timestamp: at,
    cwd,
    message: { role: "user", content: text },
  });
}

/** One assistant reply, optionally one that wrote a file. */
function reply(
  at: string,
  requestId: string,
  cwd: string,
  over: { edited?: boolean; output?: number; model?: string } = {},
): string {
  const content = over.edited
    ? [{ type: "tool_use", name: "Edit", input: {} }]
    : [{ type: "text", text: "thinking about it" }];
  return JSON.stringify({
    type: "assistant",
    timestamp: at,
    cwd,
    requestId,
    message: {
      role: "assistant",
      model: over.model ?? "claude-opus-5",
      content,
      usage: {
        input_tokens: 1_000,
        output_tokens: over.output ?? 100,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  });
}

async function writeTranscript(name: string, lines: string[]): Promise<string> {
  const dir = path.join(projects, "a-project");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.jsonl`);
  await writeFile(file, lines.join("\n") + "\n", "utf8");
  return file;
}

describe("parseScanDays", () => {
  it("defaults to thirty days", () => {
    expect(parseScanDays(undefined)).toBe(30);
  });

  it("refuses anything that is not a whole number of days", () => {
    expect(() => parseScanDays("0")).toThrow(/whole number/);
    expect(() => parseScanDays("2.5")).toThrow(/whole number/);
    expect(() => parseScanDays("last tuesday")).toThrow(/whole number/);
  });
});

describe("transcriptsExist", () => {
  it("is false on a machine where the agent has never run", () => {
    return expect(transcriptsExist({ root: path.join(root, "nowhere") })).resolves.toBe(false);
  });

  it("is true where there is a directory to read", () => {
    return expect(transcriptsExist({ root: projects })).resolves.toBe(true);
  });
});

describe("scanSessions", () => {
  it("reads one session per transcript, with no setup of any kind", async () => {
    await writeTranscript("aaaa", [
      prompt(ago(60), "add rate limiting to /orders", "/dev/one"),
      reply(ago(59), "req-1", "/dev/one", { edited: true }),
    ]);
    await writeTranscript("bbbb", [
      prompt(ago(30), "fix the flaky test", "/dev/one"),
      reply(ago(29), "req-2", "/dev/one"),
    ]);

    const { report } = await scanSessions(30, RATES, { root: projects, now: clock });

    expect(report.sessions).toBe(2);
    expect(report.top.map((top) => top.session.label).sort()).toEqual([
      "add rate limiting to /orders",
      "fix the flaky test",
    ]);
  });

  it("collapses streaming fragments of one call by requestId", async () => {
    // The same call arrives several times carrying the same usage block.
    // Adding it up each time would multiply the bill by however many pieces
    // the network happened to split it into.
    await writeTranscript("aaaa", [
      prompt(ago(60), "do a thing", "/dev/one"),
      reply(ago(59), "req-1", "/dev/one"),
      reply(ago(59), "req-1", "/dev/one"),
      reply(ago(59), "req-1", "/dev/one"),
    ]);

    const { report, sessions } = await scanSessions(30, RATES, { root: projects, now: clock });

    expect(sessions[0]?.cost.apiCalls).toBe(1);
    expect(sessions[0]?.cost.inputTokens).toBe(1_000);
    expect(report.spend.usd).toBeCloseTo(1_000 * 5e-6 + 100 * 25e-6, 10);
  });

  it("keeps the four token counters apart", async () => {
    await writeTranscript("aaaa", [
      prompt(ago(60), "do a thing", "/dev/one"),
      JSON.stringify({
        type: "assistant",
        timestamp: ago(59),
        cwd: "/dev/one",
        requestId: "req-1",
        message: {
          model: "claude-opus-5",
          content: [{ type: "text", text: "hi" }],
          usage: {
            input_tokens: 11,
            output_tokens: 22,
            cache_read_input_tokens: 33,
            cache_creation_input_tokens: 44,
          },
        },
      }),
    ]);

    const { sessions } = await scanSessions(30, RATES, { root: projects, now: clock });

    expect(sessions[0]?.cost).toMatchObject({
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 33,
      cacheCreationTokens: 44,
    });
  });

  it("segments turns at each prompt, and claims nothing about what they wrote", async () => {
    await writeTranscript("aaaa", [
      prompt(ago(60), "first", "/dev/one"),
      reply(ago(59), "req-1", "/dev/one", { edited: true }),
      prompt(ago(50), "second", "/dev/one"),
      reply(ago(49), "req-2", "/dev/one"),
      reply(ago(48), "req-3", "/dev/one"),
    ]);

    const { sessions } = await scanSessions(30, RATES, { root: projects, now: clock });

    expect(sessions[0]?.cost.turns).toBe(2);
    expect(sessions[0]?.cost.apiCalls).toBe(3);
    // Whether the second turn produced anything is a question for a diff, and
    // `scan` has none — the same refusal that keeps `merged` out of this
    // report. An `Edit` in the first turn does not change that.
    expect(sessions[0]?.cost.emptyTurns).toBeUndefined();
    expect(sessions[0]?.cost.callsWithoutEdits).toBeUndefined();
  });

  it("reads a transcript that only ever called Bash exactly the same way", async () => {
    // The shape the tool-name rule got wrong: real agents write files through
    // the shell, and a scan of them used to report every turn as empty.
    await writeTranscript("aaaa", [
      prompt(ago(60), "first", "/dev/one"),
      reply(ago(59), "req-1", "/dev/one"),
      reply(ago(58), "req-2", "/dev/one"),
    ]);

    const { sessions } = await scanSessions(30, RATES, { root: projects, now: clock });

    expect(sessions[0]?.cost.turns).toBe(1);
    expect(sessions[0]?.cost.emptyTurns).toBeUndefined();
    expect(sessions[0]?.cost.emptyTurnTokens).toBeUndefined();
  });

  it("leaves out calls from before the window", async () => {
    await writeTranscript("aaaa", [
      prompt(ago(60 * 24 * 45), "long ago", "/dev/one"),
      reply(ago(60 * 24 * 45), "old", "/dev/one"),
      prompt(ago(60), "recently", "/dev/one"),
      reply(ago(59), "new", "/dev/one"),
    ]);

    const { sessions } = await scanSessions(30, RATES, { root: projects, now: clock });

    expect(sessions[0]?.cost.apiCalls).toBe(1);
  });

  it("drops a transcript whose activity all falls outside the window", async () => {
    // The file was touched in the window, which is why it was opened. Nothing
    // in it happened there, so it is not a session that cost nothing.
    await writeTranscript("aaaa", [
      prompt(ago(60 * 24 * 45), "long ago", "/dev/one"),
      reply(ago(60 * 24 * 45), "old", "/dev/one"),
    ]);

    const { report } = await scanSessions(30, RATES, { root: projects, now: clock });

    expect(report.sessions).toBe(0);
  });

  it("survives a half-written line without losing the rest of the file", async () => {
    await writeTranscript("aaaa", [
      prompt(ago(60), "do a thing", "/dev/one"),
      '{"type":"assistant","timestamp":"',
      reply(ago(59), "req-1", "/dev/one"),
    ]);

    const { sessions } = await scanSessions(30, RATES, { root: projects, now: clock });

    expect(sessions[0]?.cost.apiCalls).toBe(1);
  });

  it("labels a session with no prompt in it rather than leaving the row blank", async () => {
    await writeTranscript("aaaa", [reply(ago(59), "req-1", "/dev/one")]);

    const { sessions } = await scanSessions(30, RATES, { root: projects, now: clock });

    expect(sessions[0]?.label).toBe("(no prompt)");
  });

  it("does not take a slash command for the prompt the session was about", async () => {
    await writeTranscript("aaaa", [
      prompt(ago(61), "<command-name>/clear</command-name>", "/dev/one"),
      prompt(ago(60), "the actual question", "/dev/one"),
      reply(ago(59), "req-1", "/dev/one"),
    ]);

    const { sessions } = await scanSessions(30, RATES, { root: projects, now: clock });

    expect(sessions[0]?.label).toBe("the actual question");
  });

  it("still cuts a turn at a slash command, even though it will not label one", async () => {
    // The label and the turn boundary are different questions. A nicer label
    // must never change a cost figure.
    await writeTranscript("aaaa", [
      prompt(ago(61), "<command-name>/clear</command-name>", "/dev/one"),
      reply(ago(60), "req-1", "/dev/one"),
      prompt(ago(59), "the actual question", "/dev/one"),
      reply(ago(58), "req-2", "/dev/one"),
    ]);

    const { sessions } = await scanSessions(30, RATES, { root: projects, now: clock });

    expect(sessions[0]?.cost.turns).toBe(2);
  });

  it("narrows to one checkout with --repo", async () => {
    await writeTranscript("aaaa", [
      prompt(ago(60), "in one", "/dev/one"),
      reply(ago(59), "req-1", "/dev/one"),
    ]);
    await writeTranscript("bbbb", [
      prompt(ago(60), "in two", "/dev/two"),
      reply(ago(59), "req-2", "/dev/two"),
    ]);

    const { report } = await scanSessions(30, RATES, {
      root: projects,
      now: clock,
      repo: "/dev/one",
    });

    expect(report.sessions).toBe(1);
    expect(report.repos.map((row) => row.repo)).toEqual([path.resolve("/dev/one")]);
  });

  it("reports nothing, rather than failing, where no transcripts exist", async () => {
    const { report } = await scanSessions(30, RATES, {
      root: path.join(root, "nowhere"),
      now: clock,
    });

    expect(report.sessions).toBe(0);
    expect(report.repos).toEqual([]);
    expect(report.top).toEqual([]);
  });
});

describe("reading a transcript that is too big to hold", () => {
  it("streams rather than loading the file", async () => {
    // Transcripts reach fourteen megabytes and a scan opens every one of them.
    // This is a big file read under a heap cap well below its size: a reader
    // that took the whole thing into a string would not survive it.
    const lines = [prompt(ago(60), "a long session", "/dev/one")];
    // ~12 MB of transcript, in calls that all collapse into two.
    const padding = "x".repeat(2_000);
    for (let index = 0; index < 6_000; index += 1) {
      lines.push(
        JSON.stringify({
          type: "assistant",
          timestamp: ago(59),
          cwd: "/dev/one",
          requestId: index % 2 === 0 ? "req-1" : "req-2",
          message: {
            model: "claude-opus-5",
            content: [{ type: "text", text: padding }],
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        }),
      );
    }
    const file = await writeTranscript("big", lines);

    const { sessions } = await scanSessions(30, RATES, { root: projects, now: clock });

    expect(sessions[0]?.cost.apiCalls).toBe(2);
    expect(file).toContain("big.jsonl");
  });
});

describe("overlaps", () => {
  const session = { startedAt: "2026-08-20T14:00:00.000Z", endedAt: "2026-08-20T15:00:00.000Z" };
  const at = (iso: string) => ({ commit: "abc", at: Date.parse(iso) });

  it("is true for a commit that landed while the session ran", () => {
    expect(overlaps(session, [at("2026-08-20T14:30:00.000Z")])).toBe(true);
  });

  it("is false for one that landed before it started or after it ended", () => {
    expect(overlaps(session, [at("2026-08-20T13:59:59.000Z")])).toBe(false);
    expect(overlaps(session, [at("2026-08-20T15:00:01.000Z")])).toBe(false);
  });

  it("counts the boundaries, which are inside the window", () => {
    expect(overlaps(session, [at(session.startedAt)])).toBe(true);
    expect(overlaps(session, [at(session.endedAt)])).toBe(true);
  });

  it("is false where nothing landed at all", () => {
    expect(overlaps(session, [])).toBe(false);
  });
});

describe("against a real checkout", () => {
  let repo: string;

  beforeEach(async () => {
    repo = path.join(root, "repo");
    await mkdir(repo, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repo });
    await execFileAsync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
    await execFileAsync("git", ["config", "user.name", "T"], { cwd: repo });
    await writeFile(path.join(repo, "a.txt"), "one", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: repo });
    await execFileAsync("git", ["commit", "-m", "first"], { cwd: repo });
  });

  /** When the commit git actually made says it landed. */
  async function committedAt(): Promise<number> {
    const { stdout } = await execFileAsync("git", ["log", "-1", "--format=%ct"], { cwd: repo });
    return Number(stdout.trim()) * 1000;
  }

  it("marks a session that was running when a commit landed", async () => {
    // Anchored to the commit git actually wrote rather than to this suite's
    // fixed clock: the session has to be running at the moment the commit
    // says it landed, and only git knows when that was.
    const landed = await committedAt();
    const iso = (offsetMs: number) => new Date(landed + offsetMs).toISOString();
    // Two calls straddling the commit: a session's window runs from its first
    // call to its last, so one call on each side is what "was running" means.
    await writeTranscript("aaaa", [
      prompt(iso(-120_000), "do a thing", repo),
      reply(iso(-60_000), "req-1", repo),
      reply(iso(60_000), "req-2", repo),
    ]);

    const { sessions } = await scanSessions(30, RATES, {
      root: projects,
      now: () => new Date(landed + 300_000),
    });

    expect(sessions[0]?.landed).toBe(true);
  });

  it("marks a session that ran when nothing landed as not having overlapped one", async () => {
    // False, not absent: git could be asked, and the answer was no.
    const landed = await committedAt();
    const iso = (offsetMs: number) => new Date(landed + offsetMs).toISOString();
    await writeTranscript("aaaa", [
      prompt(iso(600_000), "do a thing", repo),
      reply(iso(660_000), "req-1", repo),
    ]);

    const { sessions } = await scanSessions(30, RATES, {
      root: projects,
      now: () => new Date(landed + 900_000),
    });

    expect(sessions[0]?.landed).toBe(false);
  });

  it("leaves a session in a plain directory unmarked, not marked false", async () => {
    const plain = path.join(root, "not-a-repo");
    await mkdir(plain, { recursive: true });
    await writeTranscript("bbbb", [
      prompt(ago(60), "do a thing", plain),
      reply(ago(59), "req-1", plain),
    ]);

    const { sessions } = await scanSessions(30, RATES, {
      root: projects,
      now: clock,
      repo: plain,
    });

    expect(sessions[0]?.landed).toBeUndefined();
  });

  it("groups a subdirectory of a checkout under the checkout itself", async () => {
    const inner = path.join(repo, "src", "deep");
    await mkdir(inner, { recursive: true });
    await writeTranscript("aaaa", [prompt(ago(60), "one", repo), reply(ago(59), "r1", repo)]);
    await writeTranscript("bbbb", [prompt(ago(60), "two", inner), reply(ago(59), "r2", inner)]);

    const { report } = await scanSessions(30, RATES, { root: projects, now: clock });

    expect(report.repos).toHaveLength(1);
    expect(report.repos[0]?.sessions).toBe(2);
  });

  it("writes nothing: not a record, not a config, nothing in the repo", async () => {
    // The whole promise of the command. It runs on a machine that has never
    // set this tool up, and leaves it that way.
    await writeTranscript("aaaa", [prompt(ago(60), "one", repo), reply(ago(59), "r1", repo)]);
    const before = await execFileAsync("git", ["status", "--porcelain"], { cwd: repo });

    await scanSessions(30, RATES, { root: projects, now: clock });

    const after = await execFileAsync("git", ["status", "--porcelain"], { cwd: repo });
    expect(after.stdout).toBe(before.stdout);
    expect(after.stdout.trim()).toBe("");
    // And nothing appeared beside the transcripts either.
    await expect(
      execFileAsync("git", ["log", "--oneline"], { cwd: repo }).then(({ stdout }) =>
        stdout.trim().split("\n").length,
      ),
    ).resolves.toBe(1);
  });
});
