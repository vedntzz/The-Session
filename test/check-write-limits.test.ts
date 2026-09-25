// The check at its limits — the deadline, an escaping error — and on shell commands.
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agreement } from "../src/agreement.js";
import { CHECK_DEADLINE_MS, checkWrite } from "../src/commands/check-write.js";
import { CHECK_HOOK } from "../src/capture/hook.js";
import { runGit } from "../src/git.js";
import { buildProgram } from "../src/program.js";
import { appendSession } from "../src/store.js";

let temp: string;
let cwd: string;
let home: string;
const terms: Agreement = { paths: ["src"], actions: ["edit"], sensitivePaths: ["secret"], policy: "deny" };
beforeEach(async () => {
  temp = await realpath(await mkdtemp(path.join(tmpdir(), "session-check-limits-")));
  cwd = path.join(temp, "repo");
  home = path.join(temp, "store");
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await runGit(cwd, ["init", "-q"]);
  await writeFile(path.join(cwd, "src/a.ts"), "unchanged");
  await writeFile(path.join(cwd, "secret"), "unchanged secret");
});
afterEach(async () => { vi.restoreAllMocks(); await rm(temp, { recursive: true, force: true }); });

async function* input(payload: string) { yield payload; }
function payload(file = "src/a.ts", payloadCwd = cwd) {
  return JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Write", cwd: payloadCwd,
    tool_input: { file_path: file, content: "PRIVATE CONTENT" } });
}
const accept = (agreement: Agreement | undefined = terms) => appendSession({
  intent: "work", startedAt: "2026-09-22T09:00:00Z", startCommit: "abc", agreement,
}, { cwd, home });
const decision = (output: string) => JSON.parse(output).hookSpecificOutput.permissionDecision;

describe("when the check cannot answer in time or at all", () => {
  it("denies on its own clock, well inside the hook's registered timeout", () => {
    // The host lets a timed-out hook through; the check must answer first.
    expect(CHECK_DEADLINE_MS).toBeLessThanOrEqual((CHECK_HOOK.timeout * 1000) / 2);
  });

  it("denies a stalled input at the deadline, without echoing anything", async () => {
    async function* stalled() { yield "{"; await new Promise(() => {}); }
    const started = Date.now();
    const result = await checkWrite({ cwd, home, deadlineMs: 50, stdin: stalled() });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(decision(result)).toBe("deny");
    expect(result).toContain("did not finish in time");
    expect(result).not.toContain(cwd);
  });

  it("does not cut a quick answer short", async () => {
    await accept();
    expect(await checkWrite({ cwd, home, deadlineMs: 5_000, stdin: input(payload()) })).toBe("");
    expect(decision(await checkWrite({ cwd, home, deadlineMs: 5_000, stdin: input(payload("outside")) }))).toBe("deny");
  });

  it("exits 2 with a static reason when anything escapes the check", async () => {
    await accept();
    const previous = process.exitCode;
    vi.spyOn(console, "log").mockImplementation(() => { throw new Error("PRIVATE CONTENT"); });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await buildProgram({ cwd, home, stdin: input(payload("outside")) }).parseAsync(["node", "session", "hook", "check"]);
      expect(process.exitCode).toBe(2);
      const written = stderr.mock.calls.map((call) => String(call[0])).join("");
      expect(written).toContain("Write check failed unexpectedly");
      expect(written).not.toContain("PRIVATE CONTENT");
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("shell commands", () => {
  const bash = (command: string, payloadCwd = cwd) => JSON.stringify({
    hook_event_name: "PreToolUse", tool_name: "Bash", cwd: payloadCwd,
    tool_input: { command, description: "PRIVATE DESCRIPTION" },
  });
  const run = (command: string, payloadCwd = cwd) => checkWrite({ cwd, home, stdin: input(bash(command, payloadCwd)) });
  const reason = (output: string) => JSON.parse(output).hookSpecificOutput.permissionDecisionReason as string;

  it("adds no restriction without an agreement, even for a command it cannot read", async () => {
    expect(await run("touch anything")).toBe("");
  });

  it("stays silent for a reader and for a write the agreement accepts", async () => {
    await accept();
    expect(await run("cat src/a.ts")).toBe("");
    expect(await run("echo x > src/a.ts")).toBe("");
  });

  it("decides a recognized write exactly as an Edit or Write", async () => {
    await accept();
    const outside = await run("echo PRIVATE > outside.txt");
    expect(decision(outside)).toBe("deny");
    expect(reason(outside)).toContain("outside-paths, action-not-accepted");
    expect(decision(await run("rm src/a.ts"))).toBe("deny");
    expect(reason(await run("rm src/a.ts"))).toContain("action-not-accepted");
    expect(decision(await run("echo x > secret"))).toBe("deny");
  });

  it("asks, under ask or deny, when it cannot tell what a command writes", async () => {
    for (const policy of ["deny", "ask"] as const) {
      await rm(home, { recursive: true, force: true });
      await accept({ ...terms, policy });
      for (const command of ["touch src/a.ts", "node -e 1", "npm run build", "cat a | tee b"]) {
        const result = await run(command);
        expect(decision(result)).toBe("ask");
        expect(reason(result)).toBe("Can't tell what this writes. Review the command before it runs.");
      }
    }
  });

  it("uses the policy for a recognized write under ask", async () => {
    await accept({ ...terms, policy: "ask" });
    expect(decision(await run("echo x > outside.txt"))).toBe("ask");
  });

  it("stays silent under record, whatever the command", async () => {
    await accept({ ...terms, policy: "record" });
    expect(await run("touch anything")).toBe("");
    expect(await run("echo x > outside.txt")).toBe("");
  });

  it("denies a recognized command whose target cannot be checked", async () => {
    await accept();
    const result = await run("echo x > ../outside");
    expect(decision(result)).toBe("deny");
    expect(reason(result)).toContain("could not be checked");
  });

  it("denies a Bash payload with no command", async () => {
    await accept();
    const result = await checkWrite({ cwd, home, stdin: input(JSON.stringify({
      hook_event_name: "PreToolUse", tool_name: "Bash", cwd, tool_input: {},
    })) });
    expect(decision(result)).toBe("deny");
  });

  it("never echoes the command, its description or a path", async () => {
    await accept();
    for (const command of ["echo PRIVATE > outside.txt", "PRIVATE_TOOL --flag", "rm src/a.ts"]) {
      const result = await run(command);
      expect(result).not.toContain("PRIVATE");
      expect(result).not.toContain(cwd);
      expect(result).not.toContain("src/a.ts");
    }
  });

  it("runs nothing and changes nothing on disk", async () => {
    await accept();
    await run("rm src/a.ts");
    await run("echo x > outside.txt");
    expect(await readFile(path.join(cwd, "src/a.ts"), "utf8")).toBe("unchanged");
    await expect(readFile(path.join(cwd, "outside.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
