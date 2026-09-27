import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const REPO = path.resolve(import.meta.dirname, "..");

/**
 * Claude Code runs a hook's command through /bin/sh, which reads none of the
 * developer's shell startup files — so nothing nvm, Homebrew or Volta put on
 * PATH is there. This is the PATH such a hook actually gets.
 */
const HOOK_PATH = "/usr/bin:/bin";

interface Ran {
  code: number | null;
  stderr: string;
}

/** Runs one registered command the way the editor does: `/bin/sh -c`, payload on stdin. */
function runHook(command: string, cwd: string, env: NodeJS.ProcessEnv, payload: string): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", command], { cwd, env, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end(payload);
  });
}

interface Entry {
  command: string;
}

function commandsIn(file: unknown): Record<string, string> {
  const hooks = (file as { hooks: Record<string, { hooks: Entry[] }[]> }).hooks;
  return Object.fromEntries(
    Object.entries(hooks).map(([event, groups]) => [event, groups[0]!.hooks[0]!.command]),
  );
}

describe("an installed hook, run with only the system PATH", () => {
  let root: string;
  let cli: string;
  let home: string;
  let codex: string;
  let work: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "session-hook-path-")));

    // The installed package, laid out as npm lays it out: compiled output
    // beside the manifest, with the dependencies resolvable from it.
    const pkg = path.join(root, "pkg");
    await mkdir(pkg, { recursive: true });
    for (const file of ["package.json", "rates.json"]) {
      await copyFile(path.join(REPO, file), path.join(pkg, file));
    }
    await symlink(path.join(REPO, "node_modules"), path.join(pkg, "node_modules"), "dir");
    await execFileAsync(
      process.execPath,
      [
        path.join(REPO, "node_modules", "typescript", "bin", "tsc"),
        "-p", path.join(REPO, "tsconfig.json"),
        "--outDir", path.join(pkg, "dist"),
        "--declaration", "false", "--declarationMap", "false", "--sourceMap", "false",
      ],
    );
    cli = path.join(pkg, "dist", "cli.js");

    home = path.join(root, "home");
    codex = path.join(home, ".codex");
    await mkdir(path.join(home, ".claude"), { recursive: true });
    await mkdir(codex, { recursive: true });
    await writeFile(path.join(home, ".claude", "settings.json"), "{}", "utf8");

    work = path.join(root, "work");
    await mkdir(work);
    await execFileAsync("git", ["init", "-q", work]);
    await execFileAsync("git", ["-C", work, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", ["-C", work, "config", "user.name", "Test"]);
    await writeFile(path.join(work, "a.txt"), "a\n", "utf8");
    await execFileAsync("git", ["-C", work, "add", "."]);
    await execFileAsync("git", ["-C", work, "commit", "-q", "-m", "init"]);

    env = {
      HOME: home,
      CODEX_HOME: codex,
      SESSION_HOME: path.join(root, "store"),
      PATH: HOOK_PATH,
    };

    // The developer runs the install from their own shell, where node is on PATH.
    for (const flags of [[], ["--repo"]]) {
      await execFileAsync(process.execPath, [cli, "hook", "install", ...flags], {
        cwd: work,
        env: { ...env, PATH: process.env["PATH"] },
      });
    }
  }, 120_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("cannot find a bare session, which is the failure being fixed", async () => {
    const ran = await runHook("session stop --if-open", work, env, "");
    expect(ran.code).toBe(127);
  });

  it("runs the repository's write check", async () => {
    // A check that cannot start is let through by the host: the write goes
    // ahead unchecked, which is worse than the capture hooks' silent miss.
    const file = path.join(work, ".claude", "settings.local.json");
    const commands = commandsIn(JSON.parse(await readFile(file, "utf8")));
    const payload = JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: path.join(work, "b.txt"), content: "b\n" },
      cwd: work,
    });

    const ran = await runHook(commands["PreToolUse"]!, work, env, payload);

    expect(ran).toEqual({ code: 0, stderr: "" });
  });

  it.each([
    ["Claude Code", ".claude/settings.json"],
    ["Codex", ".codex/hooks.json"],
  ])("opens, names and closes a session from %s's hooks", async (tool, relative) => {
    const commands = commandsIn(JSON.parse(await readFile(path.join(home, relative), "utf8")));
    const store = path.join(root, `store${path.dirname(relative)}`);
    const hookEnv = { ...env, SESSION_HOME: store };

    for (const [event, payload] of [
      ["SessionStart", "{}"],
      ["UserPromptSubmit", JSON.stringify({ prompt: `rename the widget for ${tool}` })],
      ["SessionEnd", "{}"],
    ] as const) {
      const command = commands[event];
      expect(command, event).toBeDefined();
      const ran = await runHook(command!, work, hookEnv, payload);
      expect({ event, ...ran }).toEqual({ event, code: 0, stderr: "" });
    }

    const logs = (await readdir(store)).filter((name) => name.endsWith(".jsonl"));
    expect(logs).toHaveLength(1);
    const records = (await readFile(path.join(store, logs[0]!), "utf8"))
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { set: Record<string, unknown> }).set);
    const session = Object.assign({}, ...records) as Record<string, unknown>;
    expect(session["intent"]).toBe(`rename the widget for ${tool}`);
    expect(session["endedAt"]).toEqual(expect.any(String));
  });
});
