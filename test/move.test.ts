import { describe, expect, it } from "vitest";
import { parseMove } from "../src/shell/move.js";

describe("parseMove", () => {
  it.each([
    ["mv a b", "a", "b", "default"],
    ["mv -f a b", "a", "b", "force"],
    ["mv -i a b", "a", "b", "interactive"],
    ["mv -n a b", "a", "b", "no-clobber"],
    ["mv -- -a -b", "-a", "-b", "default"],
    ["mv -n -- -a b", "-a", "b", "no-clobber"],
    ["mv 'a file' \"b file\"", "a file", "b file", "default"],
    ["mv 'a'\"b\" c", "ab", "c", "default"],
    ["mv 'literal$source' 'target>name'", "literal$source", "target>name", "default"],
    ["mv ../a /absolute", "../a", "/absolute", "default"],
    ["mv folder/ target/", "folder/", "target/", "default"],
    ["mv a a", "a", "a", "default"],
  ])("parses without resolving %s", (command, source, destination, overwrite) => {
    expect(parseMove(command)).toEqual({ kind: "move", source, destination, overwrite });
  });
  it.each([
    "", "mv", "mv a", "mv a b c", "mv '' b", "mv a ''", "mv -f", "mv -- a",
    "mv -f -n a b", "mv -fi a b", "mv -b a b", "mv --backup a b", "mv -S .bak a b",
    "mv -t target a", "mv -T a b", "mv --exchange a b", "mv -u a b", "mv --help a b",
    "mv a -f b", "mv a -- b", "mv a -b", "mv *.ts dest", "mv ~/a b",
    "mv $SRC b", 'mv "$SRC" b', "mv $(echo a) b", "mv `echo a` b",
    "mv a b && rm c", "mv a b; rm c", "mv a b > log", "mv a b | tee log",
    "mv a b &", "mv a b # comment", "mv a\\ b c", "mv 'unfinished b",
    "mv 'a\nfile' b", "mv 'a\u0000file' b", "ENV=x mv a b", "sudo mv a b",
    "/bin/mv a b", "command mv a b", "mv /dev/fd/3 b", "mv a /dev/null",
  ])("keeps uncertain syntax unknown: %s", (command) => {
    expect(parseMove(command)).toEqual({ kind: "unknown" });
  });
  it("does not confuse source removal with an ordinary output path", () => {
    const result = parseMove("mv a b");
    expect(result.kind).toBe("move");
    expect(result).not.toHaveProperty("paths");
    expect(result).not.toHaveProperty("action");
  });
});
