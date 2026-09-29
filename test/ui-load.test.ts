import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knownAgents } from "../src/capture/index.js";
import { startSession } from "../src/commands/start.js";
import { stopSession } from "../src/commands/stop.js";
import { loadUi, runUi, type UiTerminal } from "../src/commands/ui.js";
import { loadRates, parseRates } from "../src/pricing.js";
import { plainPalette, screenControl } from "../src/render/palette.js";
import type { UiData } from "../src/render/tui/screen.js";
import type { StoreOptions } from "../src/store.js";

const execFileAsync = promisify(execFile);

/**
 * What `session ui` loads before it draws, and how it lets go of the terminal
 * when the process is told to stop.
 *
 * `ui.test.ts` drives the screen with data built by hand and covers quit,
 * Ctrl-C and input failure. Left over were the loader — the only place the
 * screen's data comes from the log — and the two signals a terminal emulator
 * or a supervisor sends: SIGTERM and SIGHUP.
 */

let root: string;
let repo: string;
let options: StoreOptions;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-ui-load-"));
  repo = path.join(root, "work");
  await mkdir(repo, { recursive: true });
  options = { home: path.join(root, "store"), cwd: repo, adapters: [] } as StoreOptions;
  const git = (...args: string[]) => execFileAsync("git", ["-C", repo, ...args]);
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("remote", "add", "origin", "git@github.com:acme/tool.git");
  await writeFile(path.join(repo, "a.txt"), "a", "utf8");
  await git("add", "-A");
  await git("-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "first");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

/** Every file under a directory, by relative path, with its bytes. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const name of await readdir(dir, { recursive: true })) {
    const full = path.join(dir, name);
    if ((await stat(full)).isFile()) files[name] = await readFile(full, "utf8");
  }
  return files;
}

async function recordSession(intent: string): Promise<void> {
  await startSession(intent, options);
  await stopSession(options);
}

describe("loadUi", () => {
  it("lists the window's sessions newest first", async () => {
    await recordSession("the first thing");
    await recordSession("the second thing");
    await recordSession("the third thing");

    const ui = await loadUi(7, options);

    expect(ui.sessions.map((session) => session.intent)).toEqual([
      "the third thing",
      "the second thing",
      "the first thing",
    ]);
  });

  it("names the repository by its remote, without the storage prefix", async () => {
    expect((await loadUi(7, options)).repo).toBe("github.com/acme/tool");
  });

  it("carries the window it was asked for, and the rates the store would price with", async () => {
    const ui = await loadUi(3, options);
    expect(ui.days).toBe(3);
    expect(ui.rates).toEqual(await loadRates(options.home as string));
  });

  it("names every agent the tool knows, whether or not it ran", async () => {
    expect((await loadUi(7, options)).agents).toEqual(knownAgents());
  });

  it("loads an empty window rather than failing on a repo nothing was recorded in", async () => {
    expect((await loadUi(7, options)).sessions).toEqual([]);
  });

  it("writes nothing to the store", async () => {
    await recordSession("the only thing");
    const before = await snapshot(options.home as string);
    await loadUi(7, options);
    await loadUi(7, options);
    expect(await snapshot(options.home as string)).toEqual(before);
  });
});

function terminal(): { io: UiTerminal; input: PassThrough; raw: ReturnType<typeof vi.fn>; text: () => string } {
  const input = new PassThrough();
  const output = new PassThrough();
  const raw = vi.fn();
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: raw });
  Object.assign(output, { isTTY: true, columns: 120, rows: 30 });
  let text = "";
  output.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });
  return { io: { input, output } as unknown as UiTerminal, input, raw, text: () => text };
}

const empty = (): UiData => ({ sessions: [], rates: parseRates('{"models":{}}', "test rates"), repo: "acme/tool", days: 7, agents: [] });

/**
 * The listener `runUi` added for a signal. Called directly rather than through
 * `process.emit`, which would also reach whatever the test runner listens with.
 */
function added(signal: NodeJS.Signals, before: readonly Function[]): () => void {
  const fresh = process.listeners(signal).filter((listener) => !before.includes(listener));
  expect(fresh).toHaveLength(1);
  return fresh[0] as () => void;
}

describe.each([
  ["SIGTERM", 143],
  ["SIGHUP", 129],
] as const)("runUi on %s", (signal, code) => {
  it(`exits ${code} and gives the terminal back`, async () => {
    const term = terminal();
    const before = process.listeners(signal);
    const saved = process.exitCode;
    try {
      const running = runUi(empty(), async () => empty(), plainPalette, term.io);
      added(signal, before)();
      await running;

      expect(process.exitCode).toBe(code);
      expect(term.raw.mock.calls).toEqual([[true], [false]]);
      expect(term.text()).toContain(screenControl.leave);
      expect(term.input.listenerCount("keypress")).toBe(0);
    } finally {
      process.exitCode = saved;
    }
  });

  it("removes every signal listener it added", async () => {
    const term = terminal();
    const counts = (["SIGINT", "SIGTERM", "SIGHUP", "exit"] as const).map((name) => process.listenerCount(name));
    const before = process.listeners(signal);
    const saved = process.exitCode;
    try {
      const running = runUi(empty(), async () => empty(), plainPalette, term.io);
      added(signal, before)();
      await running;
      expect((["SIGINT", "SIGTERM", "SIGHUP", "exit"] as const).map((name) => process.listenerCount(name))).toEqual(
        counts,
      );
    } finally {
      process.exitCode = saved;
    }
  });

  it("leaves the screen once, however many times the signal arrives", async () => {
    const term = terminal();
    const before = process.listeners(signal);
    const saved = process.exitCode;
    try {
      const running = runUi(empty(), async () => empty(), plainPalette, term.io);
      const handler = added(signal, before);
      handler();
      handler();
      await running;
      expect(term.text().split(screenControl.leave)).toHaveLength(2);
      expect(term.raw).toHaveBeenCalledTimes(2);
    } finally {
      process.exitCode = saved;
    }
  });
});
