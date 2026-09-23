import { describe, expect, it } from "vitest";
import { redirectWrites } from "../src/shell/redirect.js";
import { simpleWords } from "../src/shell/words.js";

describe("redirectWrites", () => {
  it.each([
    ["> file", "file"], [": > file", "file"], ["echo hello > file", "file"],
    ["echo hello>file", "file"], ["echo >file", "file"], ["echo -n hello > file", "file"],
    ["echo 'a > b' > 'a file'", "a file"], ['echo "a > b" > "out>file"', "out>file"],
    ["echo 'literal $HOME' > 'name$literal'", "name$literal"],
    ["echo hello > 'a'\"b\"", "ab"], ["> A=b", "A=b"],
    ["echo hello > ../outside", "../outside"], ["echo hello > /absolute", "/absolute"],
    ["echo hello > -", "-"], ["echo hello\t>\tout", "out"],
    ["echo '2'>out", "out"], ["echo 2 >out", "out"],
  ])("recognizes %s", (command, file) => {
    expect(redirectWrites(command)).toEqual({ kind: "writes", paths: [file] });
  });
  it.each([
    "", "echo hello", "echo '>'", "echo hi >", "echo hi > ''", "echo hi > a b",
    "echo hi >> a", "echo hi >| a", "echo hi &> a", "echo hi 2> a", "echo hi 1> a",
    "echo hi 2>&1 > a", "echo hi > a > b", "> a echo hi", "echo hi < in > out",
    "echo hi > $(touch secret)", 'echo hi > "$FILE"', "echo hi > `which file`",
    "echo hi > *.txt", "echo hi > ~/file", "echo hi > {a,b}", "echo hi > a # comment",
    "echo hi > a; rm b", "echo hi > a && rm b", "echo hi > a | tee b",
    "echo hi > a\nrm b", "echo 'hi\nbye' > out", "echo hi > 'bad\u0000path'",
    "echo hi > a\\ b", "echo hi > 'unfinished", "echo \"$VAR\" > out",
    "echo $(touch secret) > out", "echo <(touch secret) > out", "echo hi > >(tee out)",
    "A=b echo hi > out", "npm run build > log", "sed -i 's/a/b/' a > log",
    "rm a > log", "python script.py > log", "printf -v name data > out",
    "exec > out", "command echo hi > out", "sudo echo hi > out",
    "echo hi > /dev/tcp/host/80", "echo hi > /dev/udp/host/80", "echo hi > /dev/fd/3",
  ])("keeps uncertainty unknown: %s", (command) => {
    expect(redirectWrites(command)).toEqual({ kind: "unknown" });
  });
  it("does not widen the shared tokenizer or retain output content", () => {
    expect(simpleWords("echo PRIVATE > out")).toBeUndefined();
    expect(JSON.stringify(redirectWrites("echo PRIVATE > out"))).not.toContain("PRIVATE");
  });
});
