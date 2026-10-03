// SES-4, SES-10, SES-11: writes the check used to miss or place at the wrong path.
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Agreement } from "../src/agreement.js";
import { CHECK_HOOK, hasHook, type Settings } from "../src/capture/hook.js";
import { checkWrite } from "../src/commands/check-write.js";
import { packageManagerAtRoot } from "../src/commands/resolve-package.js";
import { runGit } from "../src/git.js";
import { appendSession } from "../src/store.js";

let temp: string;
let cwd: string;
let home: string;
const terms: Agreement = { paths: ["src"], actions: ["create", "edit"], sensitivePaths: ["src/secret"], policy: "deny" };

beforeEach(async () => {
  temp = await realpath(await mkdtemp(path.join(tmpdir(), "session-sweep-check-")));
  cwd = path.join(temp, "repo");
  home = path.join(temp, "store");
  await mkdir(path.join(cwd, "src/secret"), { recursive: true });
  await runGit(cwd, ["init", "-q"]);
  await writeFile(path.join(cwd, "package.json"), "{}");
  await appendSession({ intent: "work", startedAt: "2026-10-03T09:00:00Z", startCommit: "abc", agreement: terms }, { cwd, home });
});
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });

async function* input(payload: string) { yield payload; }
const event = (tool_name: string, tool_input: unknown, at = cwd) =>
  JSON.stringify({ hook_event_name: "PreToolUse", tool_name, cwd: at, tool_input });
const check = (payload: string) => checkWrite({ cwd, home, stdin: input(payload) });
const decision = (output: string) => (output === "" ? "silent" : JSON.parse(output).hookSpecificOutput.permissionDecision);

describe("SES-4: a package manager below the root", () => {
  it("asks rather than checking src/package.json, which npm would not write", async () => {
    // The agreement covers src, so the old answer — src/package.json, src/package-lock.json — was silence,
    // while npm walked up and rewrote the root's package.json, outside the terms.
    const answer = await check(event("Bash", { command: "npm install lodash" }, path.join(cwd, "src")));
    expect(decision(answer)).toBe("ask");
  });

  it("still checks the root's manifest when the command runs at the root", async () => {
    expect(decision(await check(event("Bash", { command: "npm install lodash" })))).toBe("deny");
  });

  it("asks at a root with no package.json, where npm would walk out of the repository", async () => {
    await rm(path.join(cwd, "package.json"));
    expect(decision(await check(event("Bash", { command: "npm install lodash" })))).toBe("ask");
  });

  it("does not take a symlinked package.json as the stop for the walk", async () => {
    await rm(path.join(cwd, "package.json"));
    await writeFile(path.join(temp, "elsewhere.json"), "{}");
    await symlink(path.join(temp, "elsewhere.json"), path.join(cwd, "package.json"));
    await expect(packageManagerAtRoot("npm install", cwd, cwd)).resolves.toBe(false);
  });
});

describe("SES-11: yarn Plug'n'Play writes more than the lockfile", () => {
  it.each([".pnp.cjs", ".pnp.js", ".pnp.loader.mjs", ".yarnrc.yml"])("cannot tell what yarn writes beside %s", async (name) => {
    await writeFile(path.join(cwd, name), "");
    await expect(packageManagerAtRoot("yarn add lodash", cwd, cwd)).resolves.toBe(false);
    await expect(packageManagerAtRoot("npm install lodash", cwd, cwd)).resolves.toBe(true);
  });
});

describe("SES-10: NotebookEdit is checked", () => {
  it("denies a notebook edit on a sensitive path", async () => {
    const answer = await check(event("NotebookEdit", { notebook_path: "src/secret/n.ipynb", new_source: "x = 1" }));
    expect(decision(answer)).toBe("deny");
    expect(answer).not.toContain("x = 1");
  });

  it("stays silent on a notebook inside the terms", async () => {
    await writeFile(path.join(cwd, "src/n.ipynb"), "{}");
    expect(await check(event("NotebookEdit", { notebook_path: "src/n.ipynb", new_source: "x = 1", edit_mode: "insert" }))).toBe("");
  });

  it("reads an install from before NotebookEdit was matched as needing repair", () => {
    const L = { node: "/usr/bin/node", cli: "/opt/session/dist/cli.js" };
    const old = { matcher: "Edit|Write|MultiEdit|Bash", hooks: [{ type: "command", command: CHECK_HOOK.command, timeout: CHECK_HOOK.timeout }] };
    const settings: Settings = { hooks: { PreToolUse: [old] } };
    expect(hasHook(settings, CHECK_HOOK, L)).toBe(false);
  });
});
