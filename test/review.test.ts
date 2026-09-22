import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { promisify, stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agreement } from "../src/agreement.js";
import { reviewAgreement, startReviewed } from "../src/commands/review.js";
import { verifyLog } from "../src/commands/verify.js";
import { buildProgram } from "../src/program.js";
import { PRIME_RULE, type PrimeProposal } from "../src/prime.js";
import { formatAgreement } from "../src/render/agreement.js";
import { ansiPalette, plainPalette } from "../src/render/palette.js";
import { readSessions, type StoreOptions } from "../src/store.js";

const exec = promisify(execFile);
const initial: Agreement = { paths: ["src"], actions: ["create", "edit"], sensitivePaths: [], policy: "record" };
const proposal: PrimeProposal = {
  proposer: "prime", rule: PRIME_RULE, intent: "fix parser", scope: ["a.txt"],
  candidates: [{ path: "a.txt", reason: "named", sessions: [] }], history: 0, comparable: 0, tracked: 1, omitted: 0,
};

/** Answers arrive only after a prompt, like a developer using a cooked terminal. */
function terminal(answers: Array<string | null>, onPrompt?: (prompt: string) => void | Promise<void>) {
  const chunks: string[] = [];
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = Object.assign(new Writable({
    write(chunk, _encoding, callback) {
      const text = String(chunk);
      chunks.push(text);
      if (text.endsWith("> ") || text.endsWith(": ")) {
        setImmediate(() => {
          void Promise.resolve().then(() => onPrompt?.(text)).then(() => {
            const answer = answers.shift();
            if (answer == null) input.end();
            else input.write(`${answer}\n`);
          }).catch((error: Error) => input.destroy(error));
        });
      }
      callback();
    },
  }), { isTTY: true, columns: 80 });
  return { input, output, text: () => chunks.join("") };
}

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repo(): Promise<StoreOptions> {
  const cwd = await mkdtemp(path.join(tmpdir(), "session-review-"));
  roots.push(cwd);
  await exec("git", ["init", "-q", cwd]);
  await exec("git", ["-C", cwd, "config", "user.name", "Test"]);
  await exec("git", ["-C", cwd, "config", "user.email", "test@example.com"]);
  await exec("git", ["-C", cwd, "config", "commit.gpgsign", "false"]);
  await writeFile(path.join(cwd, "a.txt"), "original");
  await exec("git", ["-C", cwd, "add", "a.txt"]);
  await exec("git", ["-C", cwd, "commit", "-qm", "fixture"]);
  return { cwd, home: path.join(cwd, "store") };
}

describe("agreement screen", () => {
  it("shows original and accepted scopes separately, all terms, and the enforcement limit", () => {
    const text = formatAgreement("fix parser", initial, proposal).join("\n");
    expect(text).toContain("Prime's original scope");
    expect(text).toContain('"a.txt"');
    expect(text).toContain('"src"');
    expect(text).toContain("create, edit");
    expect(text).toContain("record — record writes without blocking");
    expect(text).toContain("Policy is recorded only");
    expect(text).toContain("No session has started yet");
  });

  it("sanitizes terminal control text and keeps the same words with colour disabled", () => {
    const intent = "fix\u001b[2Jparser\u001b]0;title\u0007";
    const args = { ...initial, paths: ["src\u009b31m/file"] };
    const plain = formatAgreement(intent, args, undefined, plainPalette, 60);
    const coloured = formatAgreement(intent, args, undefined, ansiPalette, 60);
    expect(plain.join("\n")).not.toMatch(/[\u001b\u009b\u0007]/u);
    expect(coloured.map(stripVTControlCharacters)).toEqual(plain);
  });

  it("does not truncate long paths or cap lists", () => {
    const paths = Array.from({ length: 20 }, (_, i) => `src/${"long".repeat(30)}-${i}.ts`);
    const text = formatAgreement("fix parser", { ...initial, paths }, undefined, plainPalette, 60).join("\n");
    for (const value of paths) expect(text).toContain(JSON.stringify(value));
  });
});

describe("agreement review", () => {
  it("accepts only an explicit choice and leaves the supplied draft unchanged", async () => {
    const io = terminal(["", "yes", "accept"]);
    expect(await reviewAgreement("fix parser", initial, undefined, io)).toEqual(initial);
    expect(io.text()).toContain("only accept starts the session");
    expect(initial.paths).toEqual(["src"]);
  });

  it("edits every field, supports paths with commas/spaces, and preserves the proposal", async () => {
    const io = terminal([
      "paths", '["test/a, b.ts", "new/"]', "actions", '["edit", "delete"]',
      "sensitive", '["new/keys"]', "policy", "deny", "accept",
    ]);
    expect(await reviewAgreement("fix parser", initial, proposal, io)).toEqual({
      paths: ["test/a, b.ts", "new"], actions: ["edit", "delete"], sensitivePaths: ["new/keys"], policy: "deny",
    });
    expect(proposal.scope).toEqual(["a.txt"]);
    expect(io.text()).toContain('"test/a, b.ts"');
    expect(io.text()).toContain("deny writes outside these terms");
  });

  it("retains valid terms after malformed JSON, invalid paths/actions/policy, and blank edits", async () => {
    const io = terminal([
      "paths", "src/", "paths", '["../outside"]', "actions", '["execute"]',
      "policy", "allow", "sensitive", "", "accept",
    ]);
    expect(await reviewAgreement("fix parser", initial, undefined, io)).toEqual(initial);
    expect(io.text()).toContain("Use a JSON list");
    expect(io.text()).toContain("invalid repo-relative path");
    expect(io.text()).toContain("Agreement actions must");
    expect(io.text()).toContain("Agreement policy must");
    expect(io.text()).toContain("empty answer keeps");
  });

  it("requires explicit [] to clear a list", async () => {
    const io = terminal(["paths", "[]", "actions", "[]", "accept"]);
    expect(await reviewAgreement("inspect", initial, undefined, io)).toEqual({ ...initial, paths: [], actions: [] });
  });

  it("requires a replacement when Prime has no scope", async () => {
    const io = terminal(["accept", "paths", '["new.ts"]', "accept"]);
    const accepted = await reviewAgreement("fix parser", { ...initial, paths: [] }, { ...proposal, scope: [] }, io);
    expect(accepted?.paths).toEqual(["new.ts"]);
    expect(io.text()).toContain("Choose paths and supply a nonempty list");
  });

  it.each([["cancel"], [null], ["paths", null]])("cancels without accepted terms: %j", async (...script) => {
    const io = terminal(script as Array<string | null>);
    expect(await reviewAgreement("fix parser", initial, undefined, io)).toBeUndefined();
  });

  it("rejects redirected input or output before reading", async () => {
    for (const side of ["input", "output"] as const) {
      const io = terminal([]);
      io[side].isTTY = false;
      await expect(reviewAgreement("fix parser", initial, undefined, io)).rejects.toThrow(/interactive terminal/);
      expect(io.text()).toBe("");
    }
  });

  it("cancels on SIGINT and releases its process and input listeners", async () => {
    const exitCode = process.exitCode;
    const before = process.listenerCount("SIGINT");
    const io = terminal([null], () => { process.emit("SIGINT"); });
    try {
      expect(await reviewAgreement("fix parser", initial, undefined, io)).toBeUndefined();
      expect(process.exitCode).toBe(130);
      expect(process.listenerCount("SIGINT")).toBe(before);
      expect(io.input.readableFlowing).toBe(false);
    } finally { process.exitCode = exitCode; }
  });

  it("does not present an external suggestion as Prime's", async () => {
    await expect(reviewAgreement("fix parser", initial, { ...proposal, proposer: "external" }, terminal([])))
      .rejects.toThrow(/External proposal review is not supported/);
  });
});

describe("reviewed start through the command tree", () => {
  it("writes accepted terms only on acceptance and verifies their signatures", async () => {
    const options = await repo();
    const io = terminal(["policy", "ask", "accept"], async () => {
      await expect(readdir(options.home!)).rejects.toMatchObject({ code: "ENOENT" });
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await buildProgram({ ...options, reviewTerminal: io }).exitOverride()
      .parseAsync(["start", "fix parser", "--scope", "a.txt", "--review"], { from: "user" });
    const sessions = await readSessions(options);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      intent: "fix parser", intentSource: "declared", scope: ["a.txt"],
      agreement: { paths: ["a.txt"], actions: ["create", "edit"], sensitivePaths: [], policy: "ask" },
    });
    expect((await verifyLog(options)).check).toMatchObject({ verified: 1, signaturesChecked: true });
    expect((await verifyLog(options)).check.break).toBeUndefined();
  });

  it("cancellation after edits leaves no store or signing key", async () => {
    const options = await repo();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await buildProgram({ ...options, reviewTerminal: terminal(["paths", '["new.ts"]', "cancel"]) }).exitOverride()
      .parseAsync(["start", "fix parser", "--review"], { from: "user" });
    await expect(readdir(options.home!)).rejects.toMatchObject({ code: "ENOENT" });
    expect(log).toHaveBeenCalledWith("  Cancelled. No session started.");
  });

  it("keeps Prime's full proposal apart from edited accepted paths", async () => {
    const options = await repo();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const io = terminal(["paths", '["new.ts"]', "accept"]);
    await buildProgram({ ...options, reviewTerminal: io }).exitOverride()
      .parseAsync(["prime", "fix parser", "--seed", "a.txt", "--start", "--review"], { from: "user" });
    expect((await readSessions(options))[0]).toMatchObject({
      intentSource: "primed", scope: ["new.ts"], agreement: { paths: ["new.ts"] },
      proposal: { proposer: "prime", scope: ["a.txt"], tracked: 1, candidates: [{ path: "a.txt", reason: "named" }] },
    });
    const printed = log.mock.calls.flat().join("\n");
    expect(printed).toContain("0 comparable declarations");
    expect(printed).toContain("1/1 tracked files; exact paths only");
    expect(printed).not.toContain("Repeat with --start");
  });

  it("refuses invalid flag combinations without a record", async () => {
    const options = await repo();
    for (const argv of [
      ["start", "--passive", "--review"],
      ["prime", "fix parser", "--review"],
      ["prime", "--debt", "--review"],
    ]) {
      await expect(buildProgram({ ...options, reviewTerminal: terminal([]) }).exitOverride().parseAsync(argv, { from: "user" }))
        .rejects.toThrow(/--review|--debt/);
    }
    await expect(readdir(options.home!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("checks an open session before asking for any input", async () => {
    const options = await repo();
    await startReviewed("first", { ...options, reviewTerminal: terminal(["accept"]) });
    const io = terminal([]);
    await expect(startReviewed("second", { ...options, reviewTerminal: io })).rejects.toThrow(/already open/);
    expect(io.text()).toBe("");
    expect(await readSessions(options)).toHaveLength(1);
  });

  it("captures the baseline at acceptance, after files change during the review", async () => {
    const options = await repo();
    const io = terminal(["accept"], async () => {
      await writeFile(path.join(options.cwd!, "a.txt"), "changed while reviewing");
    });
    const session = await startReviewed("fix parser", { ...options, reviewTerminal: io });
    expect(session?.baseline).toEqual(["a.txt"]);
  });

  it("rechecks for another session opened while the review was waiting", async () => {
    const options = await repo();
    const io = terminal(["accept"], async () => {
      await startReviewed("other terminal", { ...options, reviewTerminal: terminal(["accept"]) });
    });
    await expect(startReviewed("fix parser", { ...options, reviewTerminal: io })).rejects.toThrow(/already open/);
    const sessions = await readSessions(options);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.intent).toBe("other terminal");
  });
});
