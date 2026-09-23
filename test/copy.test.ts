import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCopy } from "../src/shell/copy.js";
import { resolveCopy } from "../src/commands/resolve-copy.js";

describe("copy recognition", () => {
  it.each([
    ["cp a b", "a", "b", "default"], ["cp -i a b", "a", "b", "interactive"],
    ["cp -n a b", "a", "b", "no-clobber"], ["cp -- -a -b", "-a", "-b", "default"],
    ["cp -n -- -a b", "-a", "b", "no-clobber"],
    ["cp 'a file' \"b file\"", "a file", "b file", "default"],
    ["cp ../a /absolute", "../a", "/absolute", "default"],
  ])("parses %s", (command, source, destination, overwrite) => {
    expect(parseCopy(command)).toEqual({ kind: "copy", source, destination, overwrite });
  });
  it.each([
    "", "cp", "cp a", "cp a b c", "cp '' b", "cp a ''", "cp -i", "cp -- a",
    "cp -f a b", "cp -R a b", "cp -r a b", "cp -a a b", "cp -p a b",
    "cp -l a b", "cp -s a b", "cp -L a b", "cp -P a b", "cp -b a b",
    "cp --backup a b", "cp --remove-destination a b", "cp -t b a", "cp -T a b",
    "cp --parents a b", "cp --reflink a b", "cp -in a b", "cp -i -n a b",
    "cp a -i b", "cp a -- b", "cp *.ts dest", "cp ~/a b", "cp $SRC b",
    "cp $(echo a) b", "cp a b && rm c", "cp a b > log", "cp a b | tee log",
    "cp 'bad\u0000file' b", "cp 'bad\nfile' b", "cp 'unfinished b", "cp a\\ b c",
    "ENV=x cp a b", "sudo cp a b", "command cp a b", "/bin/cp a b", "cp /dev/null b",
  ])("refuses %s", (command) => {
    expect(parseCopy(command)).toEqual({ kind: "unknown" });
  });

  it("resolves only destination writes and refuses unsafe pairs without copying", async () => {
    const temp = await realpath(await mkdtemp(path.join(tmpdir(), "session-copy-")));
    try {
      const root = path.join(temp, "repo");
      await mkdir(path.join(root, "src"), { recursive: true });
      await mkdir(path.join(root, "dest"));
      await writeFile(path.join(root, "src/a"), "source");
      await writeFile(path.join(root, "dest/b"), "original");
      const resolve = (command: string, cwd = root) => resolveCopy(parseCopy(command), cwd, root);
      for (const flag of ["", "-i ", "-n "]) {
        expect(await resolve(`cp ${flag}src/a dest/b`)).toEqual({ kind: "resolved", writes: [{ path: "dest/b", action: "edit" }] });
        expect(await resolve(`cp ${flag}src/a dest/new`)).toEqual({ kind: "resolved", writes: [{ path: "dest/new", action: "create" }] });
      }
      await symlink("dest", path.join(root, "alias"), "dir");
      expect(await resolve("cp src/a alias/new")).toEqual({ kind: "resolved", writes: [
        { path: "alias/new", action: "create" }, { path: "dest/new", action: "create" },
      ] });
      await symlink(root, path.join(temp, "root-alias"), "dir");
      expect((await resolveCopy(parseCopy("cp a new"), path.join(temp, "root-alias/src"), path.join(temp, "root-alias"))).kind).toBe("resolved");
      for (const command of ["cp missing dest/new", "cp src/a missing/new", "cp src/a src/a", "cp src dest/new", "cp src/a dest", "cp src/a dest/", "cp src/a ../out", "cp --backup src/a dest/b"]) {
        expect((await resolve(command)).kind, command).toBe("blocked");
      }
      expect((await resolve("cp src/a dest/new", temp)).kind).toBe("blocked");
      await symlink("src/a", path.join(root, "leaf"));
      expect(await resolve("cp leaf dest/new")).toEqual({ kind: "blocked", reason: "symlink-operand" });
      expect(await resolve("cp dest/b leaf")).toEqual({ kind: "blocked", reason: "symlink-operand" });
      await symlink(temp, path.join(root, "escape"), "dir");
      expect((await resolve("cp src/a escape/new")).kind).toBe("blocked");
      await symlink("missing", path.join(root, "broken"));
      expect((await resolve("cp src/a broken")).kind).toBe("blocked");
      await link(path.join(root, "dest/b"), path.join(temp, "hard"));
      expect(await resolve("cp src/a dest/b")).toEqual({ kind: "blocked", reason: "hard-linked-file" });
      expect(await readFile(path.join(root, "src/a"), "utf8")).toBe("source");
      expect(await readFile(path.join(root, "dest/b"), "utf8")).toBe("original");
      await expect(readFile(path.join(root, "dest/new"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
});
