import { describe, expect, it } from "vitest";
import { readOnlyWrites } from "../src/shell/read-only.js";

const NOTHING = { kind: "writes", paths: [] };
const UNKNOWN = { kind: "unknown" };

describe("readOnlyWrites", () => {
  it.each([
    "cat src/a.ts", "head -n 20 README.md", "tail -f log/app.log", "wc -l src/a.ts",
    "ls -la", "pwd", "echo hello", "true", "false",
    "grep -rn TODO src", "egrep foo a", "fgrep foo a", "diff a b", "cmp a b",
    "stat a", "du -sh .", "df -h", "which node", "basename src/a.ts", "dirname src/a.ts",
    "realpath a", "readlink link", "whoami", "uname -a",
    "find . -name '*.ts'", "find src -type f -newer a",
    "git status", "git status --short", "git log --oneline -5", "git diff main",
    "git show HEAD", "git blame src/a.ts", "git ls-files", "git rev-parse HEAD",
    "git describe --tags", "git shortlog -sn",
    "git branch", "git branch -a", "git branch --show-current", "git remote", "git remote -v",
  ])("writes nothing: %s", (command) => {
    expect(readOnlyWrites(command)).toEqual(NOTHING);
  });

  it.each([
    ["find deleting", "find . -name '*.log' -delete"],
    ["find running a program", "find . -exec rm {} ;"],
    ["find running a program per directory", "find . -execdir touch x ;"],
    ["find asking to run", "find . -ok rm ;"],
    ["find writing a listing", "find . -fprint out.txt"],
    ["find writing a formatted listing", "find . -fprintf out.txt %p"],
    ["find writing ls output", "find . -fls out.txt"],
    ["git diff writing a file", "git diff --output=patch.diff"],
    ["git log writing a file", "git log --output patch"],
    ["git diff running an external tool", "git diff --ext-diff"],
    ["git pointed at another directory", "git -C ../other status"],
    ["git with a config override", "git -c core.pager=touch status"],
    ["git creating a branch", "git branch feature"],
    ["git deleting a branch", "git branch -D feature"],
    ["git adding a remote", "git remote add origin url"],
    ["git committing", "git commit -m x"],
    ["git checking out", "git checkout src/a.ts"],
    ["git stashing", "git stash"],
    ["bare git", "git"],
    ["sort, which can write with -o", "sort -o out a"],
    ["uniq, whose second operand is an output", "uniq a b"],
    ["tree, which can write with -o", "tree -o out"],
    ["env, which runs a command", "env rm a"],
    ["xargs, which runs a command", "xargs rm"],
    ["a script", "node -e 1"],
    ["a redirect", "cat a > b"],
    ["a pipe", "cat a | tee b"],
    ["a chain", "ls && rm a"],
    ["an environment prefix", "LANG=C ls"],
    ["an unlisted program", "touch a"],
    ["a prototype name", "constructor"],
    ["a ~ anywhere in a word, which the shared tokenizer refuses", "git diff HEAD~1"],
  ])("is unknown for %s", (_, command) => {
    expect(readOnlyWrites(command)).toEqual(UNKNOWN);
  });
});
