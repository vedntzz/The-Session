import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProgram } from "../src/program.js";
import { primeFor, startPrimed } from "../src/commands/prime.js";
import { readSessions, updateSession, foldLog, readLog, type SessionPatch } from "../src/store.js";
import { verifyLog, verifyFailed } from "../src/commands/verify.js";
import { formatSession } from "../src/render/terminal/session.js";
import { renderPr } from "../src/render/pr.js";

const exec = promisify(execFile);
let root: string;
let options: { home: string; cwd: string };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-prime-"));
  options = { home: path.join(root, "store"), cwd: path.join(root, "repo") };
  await mkdir(options.cwd);
  await exec("git", ["init", "-q", options.cwd]);
  await exec("git", ["-C", options.cwd, "config", "user.email", "test@example.com"]);
  await exec("git", ["-C", options.cwd, "config", "user.name", "Test"]);
  await exec("git", ["-C", options.cwd, "config", "commit.gpgsign", "false"]);
  await writeFile(path.join(options.cwd, "orders.ts"), "orders");
  await exec("git", ["-C", options.cwd, "add", "orders.ts"]);
  await exec("git", ["-C", options.cwd, "commit", "-qm", "initial"]);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
const request = { intent: "fix orders rate limiting", seeds: ["orders.ts"] };

describe("Prime workflow", () => {
  it("previews without creating a store or changing the checkout", async () => {
    const before = await exec("git", ["-C", options.cwd, "status", "--porcelain"]);
    const proposal = await primeFor(request, options);
    expect(proposal.scope).toEqual(["orders.ts"]);
    await expect(readdir(options.home)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await exec("git", ["-C", options.cwd, "status", "--porcelain"])).stdout).toBe(before.stdout);
    expect(await readFile(path.join(options.cwd, "orders.ts"), "utf8")).toBe("orders");
  });
  it("records the original suggestion and edited acceptance in a valid chain", async () => {
    const proposal = await primeFor(request, options);
    const session = await startPrimed(proposal, ["new.ts"], options);
    expect(session.intentSource).toBe("primed");
    expect(session.scope).toEqual(["new.ts"]);
    expect(session.proposal?.scope).toEqual(["orders.ts"]);
    expect(await readSessions(options)).toEqual([session]);
    expect(verifyFailed(await verifyLog(options))).toBe(false);
    expect(formatSession(session).join("\n")).toContain('"orders.ts"');
    expect(renderPr(session, new Map())).toContain("scope reviewed with Prime");
    await updateSession(session.id, { endedAt: new Date().toISOString(), reality: ["new.ts"] }, options);
    const [closed] = await readSessions(options);
    expect(closed?.intentSource).toBe("primed");
    expect(closed?.proposal?.scope).toEqual(["orders.ts"]);
  });
  it("rejects proposal edits and ignores later proposals while folding", async () => {
    const proposal = await primeFor(request, options);
    const session = await startPrimed(proposal, undefined, options);
    await expect(updateSession(session.id, { proposal: { ...proposal, scope: [] } } as unknown as SessionPatch, options)).rejects.toThrow("cannot be edited");
    const log = await readLog(options);
    log.lines.push({ no: 2, text: JSON.stringify({ id: session.id, set: { proposal: { ...proposal, scope: [] }, intentSource: "declared" } }) });
    expect(foldLog(log)[0]?.proposal).toEqual(proposal);
    expect(foldLog(log)[0]?.intentSource).toBe("primed");
  });
  it("does not start on an unsupported suggestion unless scope is supplied", async () => {
    const proposal = await primeFor({ intent: request.intent }, options);
    await expect(startPrimed(proposal, undefined, options)).rejects.toThrow("suggested no scope");
    expect(await readSessions(options)).toEqual([]);
    expect((await startPrimed(proposal, ["new.ts"], options)).scope).toEqual(["new.ts"]);
  });
  it("excludes an unstaged deletion from the available seed files", async () => {
    await rm(path.join(options.cwd, "orders.ts"));
    const proposal = await primeFor(request, options);
    expect(proposal.scope).toEqual([]);
    expect(proposal.reason).toContain("No tracked files match");
  });
  it("exposes preview, acceptance and scope replacement through the CLI", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => { output.push(String(line)); });
    await buildProgram(options).exitOverride().parseAsync(["node", "session", "prime", request.intent, "--seed", "orders.ts"]);
    expect(output.join("\n")).toContain("No session started");
    expect(await readSessions(options)).toEqual([]);
    await buildProgram(options).exitOverride().parseAsync(["node", "session", "prime", request.intent, "--seed", "orders.ts", "--start", "--scope", "new.ts"]);
    expect((await readSessions(options))[0]).toMatchObject({ intentSource: "primed", scope: ["new.ts"], proposal: { scope: ["orders.ts"] } });
  });
  it("puts this repo's debt in the preview, and nothing about it in the record", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => { output.push(String(line)); });
    await buildProgram(options).exitOverride().parseAsync(["node", "session", "prime", request.intent, "--seed", "orders.ts"]);
    expect(output).toContain("  debt     not enough history: 0 sessions recorded here, needs 3");
    await expect(readdir(options.home)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("prints the machine-wide debt report under --debt, and only on its own", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => { output.push(String(line)); });
    await buildProgram(options).exitOverride().parseAsync(["node", "session", "prime", "--debt"]);
    expect(output.join("\n")).toContain("No sessions recorded on this machine");
    await expect(buildProgram(options).exitOverride().parseAsync(["node", "session", "prime", "--debt", request.intent]))
      .rejects.toThrow("--debt takes no intent");
    await expect(buildProgram(options).exitOverride().parseAsync(["node", "session", "prime"]))
      .rejects.toThrow("No intent given");
  });
});
