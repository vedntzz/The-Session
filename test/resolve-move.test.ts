import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { resolveMove } from "../src/commands/resolve-move.js";
import { parseMove } from "../src/shell/move.js";
import { decideAgreementWrite } from "../src/agreement-decision.js";

let temp: string;
let root: string;
beforeEach(async () => {
  temp = await realpath(await mkdtemp(path.join(tmpdir(), "session-move-")));
  root = path.join(temp, "repo");
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "dest"));
  await writeFile(path.join(root, "src/a"), "source");
  await writeFile(path.join(root, "dest/b"), "destination");
});
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });
const resolve = (command: string, cwd = root) => resolveMove(parseMove(command), cwd, root);

describe("move resolution", () => {
  it.each(["", "-f ", "-i ", "-n "])("keeps potential deletion and replacement for %s", async (flag) => {
    expect(await resolve(`mv ${flag}src/a dest/b`)).toEqual({ kind: "resolved", writes: [
      { path: "src/a", action: "delete" }, { path: "dest/b", action: "edit" },
    ] });
    expect(await readFile(path.join(root, "src/a"), "utf8")).toBe("source");
    expect(await readFile(path.join(root, "dest/b"), "utf8")).toBe("destination");
  });
  it("classifies a new destination and leaves it absent", async () => {
    expect(await resolve("mv src/a dest/new")).toEqual({ kind: "resolved", writes: [
      { path: "src/a", action: "delete" }, { path: "dest/new", action: "create" },
    ] });
    await expect(readFile(path.join(root, "dest/new"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("checks parent aliases as well as physical paths", async () => {
    await symlink("src", path.join(root, "alias"), "dir");
    await symlink("dest", path.join(root, "output"), "dir");
    expect(await resolve("mv alias/a output/new")).toEqual({ kind: "resolved", writes: [
      { path: "alias/a", action: "delete" }, { path: "src/a", action: "delete" },
      { path: "output/new", action: "create" }, { path: "dest/new", action: "create" },
    ] });
  });
  it("supports trusted root aliases and subdirectories", async () => {
    const alias = path.join(temp, "alias");
    await symlink(root, alias, "dir");
    expect((await resolveMove(parseMove("mv a new"), path.join(alias, "src"), alias)).kind).toBe("resolved");
  });
  it.each(["mv src dest/new", "mv src/a dest", "mv src/a dest/", "mv src/ dest/new"])("refuses directory semantics: %s", async (command) => {
    expect((await resolve(command)).kind).toBe("blocked");
  });
  it.each(["mv missing dest/new", "mv src/a missing/new", "mv src/a src/a", "mv src/a ../outside", "mv ../outside dest/new"])("refuses unresolved/no-op paths: %s", async (command) => {
    expect((await resolve(command)).kind).toBe("blocked");
  });
  it.each(["source", "destination"])("refuses a leaf symlink at %s", async (side) => {
    await symlink(side === "source" ? "src/a" : "dest/b", path.join(root, "leaf"));
    expect(await resolve(side === "source" ? "mv leaf dest/new" : "mv src/a leaf"))
      .toEqual({ kind: "blocked", reason: "symlink-operand" });
  });
  it("refuses same-file aliases, dangling links, escapes and hard links", async () => {
    await symlink("src", path.join(root, "alias"), "dir");
    expect(await resolve("mv src/a alias/a")).toEqual({ kind: "blocked", reason: "same-file" });
    await symlink("missing", path.join(root, "broken"));
    expect((await resolve("mv src/a broken")).kind).toBe("blocked");
    await symlink(temp, path.join(root, "escape"), "dir");
    expect((await resolve("mv src/a escape/new")).kind).toBe("blocked");
    await link(path.join(root, "src/a"), path.join(temp, "hard"));
    expect(await resolve("mv src/a dest/new")).toEqual({ kind: "blocked", reason: "hard-linked-file" });
  });
  it("does not silently pass an unknown command or foreign cwd", async () => {
    expect(await resolve("mv --backup src/a dest/new")).toEqual({ kind: "blocked", reason: "unsupported-move" });
    expect((await resolve("mv src/a dest/new", temp)).kind).toBe("blocked");
  });
  it("requires delete permission for the source, independently of destination scope", async () => {
    const result = await resolve("mv src/a dest/new");
    if (result.kind !== "resolved") throw new Error("expected resolution");
    const decisions = result.writes.map((write) => decideAgreementWrite({
      paths: ["."], actions: ["create", "edit"], sensitivePaths: [], policy: "deny",
    }, write));
    expect(decisions.map((item) => item.decision)).toEqual(["deny", "defer"]);
  });
});
