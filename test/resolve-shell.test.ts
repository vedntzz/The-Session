import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveShellCommand, sedEitherDialect } from "../src/commands/resolve-shell.js";

let temp: string;
let root: string;
beforeEach(async () => {
  temp = await realpath(await mkdtemp(path.join(tmpdir(), "session-shell-")));
  root = path.join(temp, "repo");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src/a"), "a");
  await writeFile(path.join(root, "package.json"), "{}");
  await writeFile(path.join(root, ".env"), "secret");
});
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });

const resolve = (command: string, cwd = root) => resolveShellCommand(command, cwd, root);
const resolved = (...writes: [string, string][]) =>
  ({ kind: "resolved", writes: writes.map(([p, action]) => ({ path: p, action })) });

describe("resolveShellCommand", () => {
  it.each([
    ["a reader writes nothing", "cat src/a", resolved()],
    ["a frozen install writes no tracked file", "npm ci", resolved()],
    ["an install edits the manifest and creates the lockfile", "npm install lodash",
      resolved(["package.json", "edit"], ["package-lock.json", "create"])],
    ["sed -i with a backup edits in place and creates the backup", "sed -i.bak 's/a/b/' src/a",
      resolved(["src/a", "edit"], ["src/a.bak", "create"])],
    ["a redirect creates its target", "echo hi > src/new", resolved(["src/new", "create"])],
    ["tee writes its operands", "tee src/a src/log", resolved(["src/a", "edit"], ["src/log", "create"])],
    ["a move deletes and creates", "mv src/a src/b", resolved(["src/a", "delete"], ["src/b", "create"])],
    ["a copy creates only the destination", "cp src/a src/c", resolved(["src/c", "create"])],
    ["rm deletes", "rm src/a .env", resolved(["src/a", "delete"], [".env", "delete"])],
  ])("%s", async (_, command, expected) => {
    expect(await resolve(command)).toEqual(expected);
  });

  it("resolves a command's paths from its own directory", async () => {
    expect(await resolve("npm install", path.join(root, "src"))).toEqual(resolved(["src/package-lock.json", "create"]));
  });

  it.each([
    "touch src/a", "node -e 1", "python script.py", "make", "npm run build",
    "ls && rm src/a", "cat src/a | tee src/b", "rm -rf src", "sort -o out src/a", "",
  ])("cannot tell what %j writes", async (command) => {
    expect(await resolve(command)).toEqual({ kind: "unknown" });
  });

  it("knows a sed command only when GNU and macOS sed both read it, and checks both readings", async () => {
    // Which sed runs cannot be told from the platform, and the dialects disagree on -i.
    expect(await resolve("sed -i 's/a/b/' src/a")).toEqual({ kind: "unknown" });
    expect(await resolve("sed -i '' 's/a/b/' src/a")).toEqual({ kind: "unknown" });
    // macOS reads -e as the backup suffix, so src/a-e is checked too.
    expect(await resolve("sed -i -e 's/a/b/' src/a")).toEqual(resolved(["src/a", "edit"], ["src/a-e", "create"]));
  });

  it.each([
    ["a target outside the repository", "echo x > ../out"],
    ["a directory", "rm src"],
    ["a copy from outside the repository", "cp ../x src/b"],
  ])("blocks %s rather than reading it as no writes", async (_, command) => {
    expect((await resolve(command)).kind).toBe("blocked");
  });

  it("writes nothing and reads no contents while resolving", async () => {
    for (const command of ["echo hi > src/new", "rm src/a", "mv src/a src/b", "npm install lodash"]) await resolve(command);
    expect((await readdir(path.join(root, "src"))).sort()).toEqual(["a"]);
    expect(await readFile(path.join(root, "src/a"), "utf8")).toBe("a");
    expect((await readdir(root)).sort()).toEqual([".env", "package.json", "src"]);
  });
});

describe("sedEitherDialect", () => {
  it("is the union of both readings, or unknown when either cannot read it", () => {
    expect(sedEitherDialect("sed -i.bak s/a/b/ f")).toEqual({ kind: "writes", paths: ["f", "f.bak"] });
    expect(sedEitherDialect("sed -i -e s/a/b/ f")).toEqual({ kind: "writes", paths: ["f", "f-e"] });
    expect(sedEitherDialect("sed -i s/a/b/ f")).toEqual({ kind: "unknown" });
    expect(sedEitherDialect("sed s/a/b/ f")).toEqual({ kind: "unknown" });
  });
});
