import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agreement } from "../src/agreement.js";
import { MAX_WRITE_PAYLOAD_BYTES } from "../src/capture/adapters/claude-write.js";
import { CHECK_DEADLINE_MS, checkWrite } from "../src/commands/check-write.js";
import { CHECK_HOOK } from "../src/capture/hook.js";
import { runGit } from "../src/git.js";
import { buildProgram } from "../src/program.js";
import { appendSession, foldLog, readLog, readSessions, resolveStoreFile, updateSession, type SessionPatch } from "../src/store.js";
import { verifyLog } from "../src/commands/verify.js";

let temp: string;
let cwd: string;
let home: string;
const terms: Agreement = { paths: ["src"], actions: ["edit"], sensitivePaths: ["secret"], policy: "deny" };
beforeEach(async () => {
  temp = await realpath(await mkdtemp(path.join(tmpdir(), "session-check-write-")));
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
const check = (file = "src/a.ts", payloadCwd = cwd) => checkWrite({ cwd, home, stdin: input(payload(file, payloadCwd)) });
const accept = (agreement: Agreement | undefined = terms) => appendSession({
  intent: "work", startedAt: "2026-09-22T09:00:00Z", startCommit: "abc", agreement,
}, { cwd, home });
const decision = (output: string) => JSON.parse(output).hookSpecificOutput.permissionDecision;

describe("PreToolUse command", () => {
  it("captures a canonical checkout from subdirectories and aliases and signs it", async () => {
    const alias = path.join(temp, "alias");
    await symlink(cwd, alias, "dir");
    const session = await appendSession({ intent: "work", startCommit: "abc", startedAt: "2026-09-22T09:00:00Z" }, { home, cwd: path.join(alias, "src") });
    expect(session.checkout).toBe(cwd);
    expect((await readSessions({ cwd, home }))[0]?.checkout).toBe(cwd);
    expect((await verifyLog({ cwd, home })).check).toMatchObject({ verified: 1, signaturesChecked: true });
    expect(await checkWrite({ cwd: alias, home, stdin: input(payload()) })).toBe("");
  });
  it("refuses checkout patches and ignores forged later bindings, including legacy insertion", async () => {
    const session = await accept();
    await expect(updateSession(session.id, { checkout: temp } as unknown as SessionPatch, { cwd, home })).rejects.toThrow("Checkout");
    const log = await readLog({ cwd, home });
    const forged = { no: 2, text: JSON.stringify({ id: session.id, set: { checkout: temp } }) };
    expect(foldLog({ ...log, lines: [...log.lines, forged] })[0]?.checkout).toBe(cwd);
    const original = JSON.parse(log.lines[0]!.text);
    delete original.set.checkout;
    const legacy = { ...log, lines: [{ no: 1, text: JSON.stringify(original) }, forged] };
    expect(foldLog(legacy)[0]?.checkout).toBeUndefined();
  });
  it("denies multiple local sessions instead of choosing a newer permissive one", async () => {
    await accept();
    await accept({ ...terms, policy: "record" });
    expect(decision(await check())).toBe("deny");
  });
  it("does not use another checkout's newer agreement in a shared remote log", async () => {
    const remote = path.join(temp, "remote.git");
    await runGit(cwd, ["remote", "add", "origin", remote]);
    await accept();
    const other = path.join(temp, "other");
    await mkdir(other);
    await runGit(other, ["init", "-q"]);
    await runGit(other, ["remote", "add", "origin", remote]);
    await appendSession({ intent: "other", startCommit: "abc", startedAt: "2026-09-22T10:00:00Z", agreement: { ...terms, policy: "record" } }, { cwd: other, home });
    expect((await readSessions({ cwd, home })).length).toBe(2);
    expect(decision(await check("outside"))).toBe("deny");
    expect(await checkWrite({ cwd: other, home, stdin: input(payload("outside", other)) })).toBe("");
  });
  it("does not grant permission when there is no session or no agreement", async () => {
    expect(await check("outside")).toBe("");
    await appendSession({ intent: "legacy", startedAt: "2026-09-22T09:00:00Z", startCommit: "abc" }, { cwd, home });
    expect(await check("outside")).toBe("");
  });
  it("ignores closed agreements", async () => {
    const session = await accept();
    await updateSession(session.id, { endedAt: "2026-09-22T10:00:00Z" }, { cwd, home });
    expect(await check("outside")).toBe("");
  });
  it("leaves accepted writes to normal editor permissions", async () => {
    await accept();
    expect(await check()).toBe("");
  });
  it.each(["ask", "deny"] as const)("responds with %s for a mismatch", async (policy) => {
    await accept({ ...terms, policy });
    const result = await check("outside");
    expect(decision(result)).toBe(policy);
    expect(result).toContain("outside-paths, action-not-accepted");
    expect(result).not.toContain("PRIVATE CONTENT");
    expect(result).not.toContain(cwd);
  });
  it("record-only adds no restriction even to unresolvable targets", async () => {
    await accept({ ...terms, policy: "record" });
    expect(await check("../outside")).toBe("");
  });
  it.each(["src/alias", "secret"])("checks sensitivity of both symlink names: %s", async (sensitive) => {
    await symlink("../secret", path.join(cwd, "src/alias"));
    await accept({ ...terms, paths: ["."], sensitivePaths: [sensitive] });
    expect(decision(await check("src/alias"))).toBe("deny");
  });
  it.each(["ask", "deny"] as const)("denies unresolved targets under %s policy", async (policy) => {
    await accept({ ...terms, policy });
    expect(decision(await check("../outside"))).toBe("deny");
    expect(decision(await check("src/a.ts", temp))).toBe("deny");
  });
  it("does not let the payload choose another repository's agreement", async () => {
    await accept();
    const other = path.join(temp, "other");
    await mkdir(other);
    await runGit(other, ["init", "-q"]);
    expect(decision(await check("file", other))).toBe("deny");
  });
  it("works from a trusted repository subdirectory", async () => {
    await accept();
    expect(await checkWrite({ cwd: path.join(cwd, "src"), home, stdin: input(payload()) })).toBe("");
  });
  it("does not alter the source or signed log", async () => {
    await accept();
    const file = await resolveStoreFile({ cwd, home });
    const before = await readFile(file, "utf8");
    await check("outside");
    expect(await readFile(file, "utf8")).toBe(before);
    expect(await readFile(path.join(cwd, "src/a.ts"), "utf8")).toBe("unchanged");
  });
  it("returns a content-free denial for a corrupt log or unavailable checkout", async () => {
    await accept();
    await writeFile(await resolveStoreFile({ cwd, home }), "PRIVATE CONTENT\n");
    expect(decision(await check())).toBe("deny");
    const result = await checkWrite({ cwd: temp, home, stdin: input(payload()) });
    expect(decision(result)).toBe("deny");
    expect(result).not.toContain(temp);
  });
  it.each(["", "{PRIVATE CONTENT", "{}"])("denies malformed payload %j", async (value) => {
    const result = await checkWrite({ cwd, home, stdin: input(value) });
    expect(decision(result)).toBe("deny");
    expect(result).not.toContain("PRIVATE CONTENT");
  });
  it("leaves unsupported tools alone without requiring a repository", async () => {
    expect(await checkWrite({ cwd: temp, stdin: input(JSON.stringify({
      hook_event_name: "PreToolUse", tool_name: "Read",
    })) })).toBe("");
  });
  it("stops consuming oversized input and closes the iterator", async () => {
    let closed = false;
    async function* large() {
      try {
        yield Buffer.alloc(MAX_WRITE_PAYLOAD_BYTES + 1);
        throw new Error("must not consume this");
      } finally { closed = true; }
    }
    const result = await checkWrite({ cwd, home, stdin: large() });
    expect(result).toContain("exceeds 2 MiB");
    expect(decision(result)).toBe("deny");
    expect(closed).toBe(true);
  });
  it("keeps UTF-8 intact across byte chunks", async () => {
    await accept({ ...terms, paths: ["src/é.ts"], actions: ["create"] });
    async function* bytes() { for (const byte of Buffer.from(payload("src/é.ts"))) yield Buffer.from([byte]); }
    expect(await checkWrite({ cwd, home, stdin: bytes() })).toBe("");
  });
  it("denies a failed input stream without leaking its error", async () => {
    async function* broken() { yield "{"; throw new Error("PRIVATE CONTENT"); }
    const result = await checkWrite({ cwd, home, stdin: broken() });
    expect(decision(result)).toBe("deny");
    expect(result).not.toContain("PRIVATE CONTENT");
  });
  it("prints only one JSON response through the CLI and no normal-permission output", async () => {
    await accept();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await buildProgram({ cwd, home, stdin: input(payload("outside")) }).parseAsync(["node", "session", "hook", "check"]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(decision(log.mock.calls[0]![0] as string)).toBe("deny");
    log.mockClear();
    await buildProgram({ cwd, home, stdin: input(payload()) }).parseAsync(["node", "session", "hook", "check"]);
    expect(log).not.toHaveBeenCalled();
  });
});

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
