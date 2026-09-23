import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decideAgreementWrite } from "../src/agreement-decision.js";
import { resolveRemove } from "../src/commands/resolve-remove.js";
import { parseRemove } from "../src/shell/remove.js";

describe("parseRemove", () => {
  it.each([
    ["rm a", ["a"], false],
    ["rm src/a src/b", ["src/a", "src/b"], false],
    ["rm -f a", ["a"], true],
    ["rm -i a", ["a"], false],
    ["rm -- -weird", ["-weird"], false],
    ["rm -f -- -weird b", ["-weird", "b"], true],
    ["rm 'a file'", ["a file"], false],
  ])("%s", (command, paths, force) => {
    expect(parseRemove(command)).toEqual({ kind: "remove", paths, force });
  });

  it.each([
    "rm", "rm -f", "rm --",
    "rm -r dir", "rm -R dir", "rm -rf dir", "rm --recursive dir", "rm -d dir",
    "rm -v a", "rm -fi a", "rm -f -i a", "rm --force a", "rm a -f",
    "rm -weird", "rm ''", "rm /dev/null",
    "rm a && echo", "rm *.log", "rm ~/a", "rm $FILE", "FOO=1 rm a",
    "rmdir a", "unlink a", "echo rm a", "rm a\u0007",
  ])("is unknown for %j", (command) => {
    expect(parseRemove(command)).toEqual({ kind: "unknown" });
  });
});

describe("resolveRemove", () => {
  let temp: string;
  let root: string;
  beforeEach(async () => {
    temp = await realpath(await mkdtemp(path.join(tmpdir(), "session-remove-")));
    root = path.join(temp, "repo");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/a"), "a");
    await writeFile(path.join(root, "src/b"), "b");
    await writeFile(path.join(root, ".env"), "secret");
  });
  afterEach(async () => { await rm(temp, { recursive: true, force: true }); });
  const resolve = (command: string, cwd = root) => resolveRemove(parseRemove(command), cwd, root);

  it("deletes every operand, and deletes nothing itself", async () => {
    expect(await resolve("rm src/a src/b")).toEqual({ kind: "resolved", writes: [
      { path: "src/a", action: "delete" }, { path: "src/b", action: "delete" },
    ] });
    expect(await readFile(path.join(root, "src/a"), "utf8")).toBe("a");
  });

  it("resolves operands from a subdirectory and names each file once", async () => {
    expect(await resolve("rm a ./a", path.join(root, "src"))).toEqual({ kind: "resolved", writes: [
      { path: "src/a", action: "delete" },
    ] });
  });

  it("still counts a missing operand as a delete, with or without -f", async () => {
    for (const command of ["rm src/missing", "rm -f src/missing"]) {
      expect(await resolve(command)).toEqual({ kind: "resolved", writes: [{ path: "src/missing", action: "delete" }] });
    }
  });

  it("keeps parent aliases as well as physical paths", async () => {
    await symlink("src", path.join(root, "alias"), "dir");
    expect(await resolve("rm alias/a")).toEqual({ kind: "resolved", writes: [
      { path: "alias/a", action: "delete" }, { path: "src/a", action: "delete" },
    ] });
  });

  it("refuses a leaf symlink, whose target rm would not delete", async () => {
    await symlink("src/a", path.join(root, "link"));
    expect(await resolve("rm link")).toEqual({ kind: "blocked", reason: "symlink-operand" });
  });

  it.each([
    ["a directory", "rm src"],
    ["a path outside the repository", "rm ../outside"],
    ["one bad operand among good ones", "rm src/a ../outside"],
  ])("blocks %s", async (_, command) => {
    expect((await resolve(command)).kind).toBe("blocked");
  });

  it("blocks a hard-linked file, whose other names survive", async () => {
    await link(path.join(root, "src/a"), path.join(root, "src/other"));
    expect(await resolve("rm src/a")).toEqual({ kind: "blocked", reason: "hard-linked-file" });
  });

  it("blocks an unparsed command rather than resolving nothing", async () => {
    expect(await resolveRemove({ kind: "unknown" }, root, root)).toEqual({ kind: "blocked", reason: "unsupported-remove" });
  });

  it("feeds the decision: deleting a sensitive file is a violation even inside the paths", async () => {
    const resolved = await resolve("rm .env");
    if (resolved.kind !== "resolved") throw new Error("expected a resolution");
    const agreement = { paths: ["."], actions: ["create" as const, "edit" as const, "delete" as const], sensitivePaths: [".env"], policy: "deny" as const };
    expect(decideAgreementWrite(agreement, resolved.writes[0]!)).toEqual({ decision: "deny", violations: ["sensitive-path"] });
    const noDelete = { ...agreement, actions: ["edit" as const], sensitivePaths: [] };
    const other = await resolve("rm src/a");
    if (other.kind !== "resolved") throw new Error("expected a resolution");
    expect(decideAgreementWrite(noDelete, other.writes[0]!)).toEqual({ decision: "deny", violations: ["action-not-accepted"] });
  });
});
