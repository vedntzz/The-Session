import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decideAgreementWrite } from "../src/agreement-decision.js";
import { parseClaudeWrite } from "../src/capture/adapters/claude-write.js";
import { resolveFileWrite } from "../src/commands/resolve-write.js";

let temp: string;
let root: string;
let outside: string;
beforeEach(async () => {
  temp = await realpath(await mkdtemp(path.join(tmpdir(), "session-resolve-write-")));
  root = path.join(temp, "repo");
  outside = path.join(temp, "repo-other");
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "secrets"));
  await mkdir(outside);
  await writeFile(path.join(root, "src/a.ts"), "source stays unchanged");
  await writeFile(path.join(root, "secrets/key"), "secret stays unchanged");
});
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });

const resolve = (filePath: string, cwd = root) => resolveFileWrite({ cwd, filePath }, root);

describe("file-write resolution", () => {
  it("resolves absolute and cwd-relative paths to the same existing file", async () => {
    const expected = { kind: "resolved", writes: [{ path: "src/a.ts", action: "edit" }] };
    expect(await resolve(path.join(root, "src/a.ts"))).toEqual(expected);
    expect(await resolve("./a.ts", path.join(root, "src"))).toEqual(expected);
  });

  it("classifies missing files and missing parent directories as create without creating them", async () => {
    for (const target of ["src/new.ts", "new/deep/file.ts"]) {
      expect(await resolve(target)).toEqual({ kind: "resolved", writes: [{ path: target, action: "create" }] });
      await expect(lstat(path.join(root, target))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("preserves path spaces and commas instead of splitting or reading contents", async () => {
    expect(await resolve("src/a file, name.ts")).toEqual({ kind: "resolved", writes: [{ path: "src/a file, name.ts", action: "create" }] });
    await resolve("src/a.ts");
    expect(await readFile(path.join(root, "src/a.ts"), "utf8")).toBe("source stays unchanged");
  });

  it("checks both the requested file symlink and its real target", async () => {
    await symlink("../secrets/key", path.join(root, "src/alias"));
    const result = await resolve("src/alias");
    expect(result).toEqual({ kind: "resolved", writes: [
      { path: "src/alias", action: "edit" }, { path: "secrets/key", action: "edit" },
    ] });
    if (result.kind !== "resolved") throw new Error("expected a resolved target");
    const decisions = result.writes.map((write) => decideAgreementWrite({
      paths: ["."], actions: ["edit"], sensitivePaths: ["secrets"], policy: "deny",
    }, write));
    expect(decisions.map((decision) => decision.decision)).toEqual(["defer", "deny"]);
    // The alias itself can also be sensitive, even if its target is not.
    expect(decideAgreementWrite({ paths: ["."], actions: ["edit"], sensitivePaths: ["src/alias"], policy: "ask" }, result.writes[0]!).decision).toBe("ask");
  });

  it("resolves directory symlinks and new files beneath them", async () => {
    await symlink("../secrets", path.join(root, "src/alias"), "dir");
    expect(await resolve("src/alias/new/deep.ts")).toEqual({ kind: "resolved", writes: [
      { path: "src/alias/new/deep.ts", action: "create" }, { path: "secrets/new/deep.ts", action: "create" },
    ] });
    expect(await resolve("key", path.join(root, "src/alias"))).toEqual({ kind: "resolved", writes: [
      { path: "src/alias/key", action: "edit" }, { path: "secrets/key", action: "edit" },
    ] });
  });

  it("supports an alias of the repository root, including the cwd's spelling", async () => {
    const alias = path.join(temp, "alias");
    await symlink(root, alias, "dir");
    const expected = { kind: "resolved", writes: [{ path: "src/a.ts", action: "edit" }] };
    expect(await resolve("a.ts", path.join(alias, "src"))).toEqual(expected);
    expect(await resolveFileWrite({ cwd: root, filePath: path.join(alias, "src/a.ts") }, alias)).toEqual(expected);
  });

  it("rejects an outside target or cwd, including a sibling with the same prefix", async () => {
    expect(await resolve(path.join(outside, "new.ts"))).toEqual({ kind: "blocked", reason: "outside-repo" });
    expect(await resolve(path.join(root, "src/a.ts"), outside)).toEqual({ kind: "blocked", reason: "outside-repo" });
  });

  it("rejects symlink escapes before following any later path back inside", async () => {
    await symlink(outside, path.join(root, "src/escape"), "dir");
    await symlink(root, path.join(outside, "back"), "dir");
    for (const target of ["src/escape/new.ts", "src/escape/back/src/a.ts"]) {
      expect(await resolve(target)).toEqual({ kind: "blocked", reason: "outside-repo" });
    }
  });

  it("does not mistake dangling or cyclic symlinks for new files", async () => {
    await symlink("missing", path.join(root, "dangling"));
    await symlink("cycle", path.join(root, "cycle"));
    for (const target of ["dangling", "dangling/file", "cycle"]) {
      expect(await resolve(target)).toEqual({ kind: "blocked", reason: "filesystem-error" });
    }
  });

  it("rejects directories, the root itself and a file used as a parent", async () => {
    for (const target of [root, "src", "src/a.ts/child"]) {
      expect(await resolve(target)).toEqual({ kind: "blocked", reason: "not-file" });
    }
  });

  it("refuses hard-linked files whose other aliases cannot be bounded by a path check", async () => {
    await link(path.join(root, "src/a.ts"), path.join(outside, "alias"));
    expect(await resolve("src/a.ts")).toEqual({ kind: "blocked", reason: "hard-linked-file" });
  });

  it.each(["", "src/../secrets/key", "../repo-other/a.ts", "src/a.ts ", " src/a.ts", "src\\a.ts", "src/\na.ts", "src/", "new/.", "C:/outside"])(
    "refuses ambiguous or unsupported spelling %j", async (value) => {
      expect(await resolve(value)).toEqual({ kind: "blocked", reason: "invalid-path" });
    },
  );

  it("does not infer a root or cwd when it cannot read them", async () => {
    expect(await resolveFileWrite({ cwd: root, filePath: "a.ts" }, path.join(temp, "missing")))
      .toEqual({ kind: "blocked", reason: "filesystem-error" });
    expect(await resolve("a.ts", "relative/cwd")).toEqual({ kind: "blocked", reason: "invalid-path" });
  });

  it.each(["Write", "Edit", "MultiEdit"])("normalizes a %s call without claiming success or deletion", async (tool_name) => {
    const text = { old_string: "source stays unchanged", new_string: "" };
    const tool_input = { file_path: "src/a.ts", content: "", ...text, edits: [text] };
    const parsed = parseClaudeWrite(JSON.stringify({ hook_event_name: "PreToolUse", tool_name, tool_input, cwd: root }));
    if (parsed.kind !== "write") throw new Error("expected a parsed write");
    expect(await resolveFileWrite(parsed.request, root)).toEqual({ kind: "resolved", writes: [{ path: "src/a.ts", action: "edit" }] });
    expect(await readFile(path.join(root, "src/a.ts"), "utf8")).toBe("source stays unchanged");
    const newRequest = { ...parsed.request, filePath: "src/new.ts" };
    expect(await resolveFileWrite(newRequest, root)).toEqual({ kind: "resolved", writes: [{ path: "src/new.ts", action: "create" }] });
  });
});
