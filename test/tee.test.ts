import { describe, expect, it } from "vitest";
import { teeWrites } from "../src/shell/tee.js";

describe("teeWrites", () => {
  it.each([
    ["tee out", ["out"]], ["tee a b", ["a", "b"]], ["tee a a b", ["a", "b"]],
    ["tee -a out", ["out"]], ["tee -i out", ["out"]], ["tee -ai out", ["out"]],
    ["tee -ia -a out", ["out"]], ["tee --append --ignore-interrupts out", ["out"]],
    ["tee -- -a --help", ["-a", "--help"]], ["tee -a -- -file", ["-file"]],
    ["tee 'a file' \"other file\"", ["a file", "other file"]],
    ["tee 'a'\"b\"", ["ab"]], ["tee 'literal$path' 'a>b'", ["literal$path", "a>b"]],
    ["tee ../outside /absolute", ["../outside", "/absolute"]],
    ["tee\tfile", ["file"]], ["tee ./- ./a", ["./-", "./a"]],
  ] as const)("recognizes %s", (command, paths) => {
    expect(teeWrites(command)).toEqual({ kind: "writes", paths });
  });
  it.each([
    "", "tee", "tee -a", "tee --", "tee ''", "tee -", "tee -- -", "tee a -",
    "tee -p out", "tee --output-error=warn out", "tee --help out", "tee -z out",
    "tee --append=out", "tee out -a", "tee out -- other", "tee -A out",
    "echo hi | tee out", "tee a | tee b", "tee a > b", "tee a < input",
    "tee a <<EOF", "tee a && rm b", "tee a; rm b", "tee a &", "tee a # comment",
    "tee $(touch secret)", "tee `echo file`", 'tee "$FILE"', "tee *.txt", "tee ~/out",
    "tee {a,b}", "tee >(cat)", "tee a\\ b", "tee 'unfinished", "tee 'a\nfile'",
    "tee 'bad\u0000path'", "ENV=value tee a", "sudo tee a", "command tee a",
    "/usr/bin/tee a", "tee /dev/fd/3", "tee /dev/stdout", "tee /dev/null",
  ])("keeps uncertainty unknown: %s", (command) => {
    expect(teeWrites(command)).toEqual({ kind: "unknown" });
  });
});
