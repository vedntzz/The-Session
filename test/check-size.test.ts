// `npm run check:size`, a ratchet, run against a throwaway repository with a master branch.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.join(import.meta.dirname, "../scripts/check-size.mjs");
const lines = (count: number) => "x;\n".repeat(count);

function repo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "check-size-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q", "-b", "master");
  writeFileSync(path.join(dir, "old.ts"), lines(300));
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
  return dir;
}

const run = (cwd: string) => spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });

describe("check:size", () => {
  it("passes a touched file of exactly 200 lines, and ignores untouched long ones", () => {
    const dir = repo();
    writeFileSync(path.join(dir, "new.ts"), lines(200));
    expect(run(dir).status).toBe(0);
  });

  it("fails an untracked file over 200 lines, naming it", () => {
    const dir = repo();
    writeFileSync(path.join(dir, "new.ts"), lines(201));
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("new.ts: 201 lines");
  });

  it("fails a file already over 200 lines that grows, naming both lengths", () => {
    const dir = repo();
    writeFileSync(path.join(dir, "old.ts"), lines(301));
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("old.ts: 301 lines, up from 300 on master");
  });

  it("passes a file already over 200 lines that is edited without growing, or shrinks", () => {
    const dir = repo();
    writeFileSync(path.join(dir, "old.ts"), "y;\n" + lines(299));
    expect(run(dir).status).toBe(0);
    writeFileSync(path.join(dir, "old.ts"), lines(250));
    expect(run(dir).status).toBe(0);
  });

  it("fails a file at or under 200 on master that crosses 200", () => {
    const dir = repo();
    writeFileSync(path.join(dir, "short.ts"), lines(150));
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "short"], { cwd: dir });
    writeFileSync(path.join(dir, "short.ts"), lines(201));
    expect(run(dir).stderr).toContain("short.ts: 201 lines, over 200");
  });

  it("ignores files that are not .ts", () => {
    const dir = repo();
    writeFileSync(path.join(dir, "notes.md"), lines(500));
    expect(run(dir).status).toBe(0);
  });
});
