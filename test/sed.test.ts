import { describe, expect, it } from "vitest";
import { sedWrites, type SedDialect } from "../src/shell/sed.js";

describe("sedWrites", () => {
  it.each([
    ["gnu", "sed -i 's/a/b/' src/a.ts", ["src/a.ts"]],
    ["macos", "sed -i '' 's/a/b/g' src/a.ts", ["src/a.ts"]],
    ["gnu", "sed --in-place 's/a/b/' src/a.ts", ["src/a.ts"]],
    ["gnu", "sed --in-place=.bak 's/a/b/' a b", ["a", "a.bak", "b", "b.bak"]],
    ["macos", "sed -i .bak 's/a/b/' a", ["a", "a.bak"]],
    ["gnu", "sed -i.bak 's/a/b/' a", ["a", "a.bak"]],
    ["macos", "sed -i.bak 's/a/b/' a", ["a", "a.bak"]],
    ["gnu", "sed -E -i -e 's/a/b/' -e 's/c/d/' a a", ["a"]],
    ["macos", "sed -n -i '' -e 's/a/b/p' 'a file'", ["a file"]],
    ["gnu", "sed -i 's/a//' ../outside /absolute", ["../outside", "/absolute"]],
    ["gnu", "sed -i -- 's/a/b/' ./-file", ["./-file"]],
  ] as const)("recognizes %s: %s", (dialect, command, paths) => {
    expect(sedWrites(command, dialect)).toEqual({ kind: "writes", paths });
  });

  const refused = [
    "sed 's/a/b/' a", "sed -i", "sed -i 's/a/b/'", "sed -i 's/a/b/' ''",
    "sed -i -f script a", "sed -i 's/a/b/e' a", "sed -i 's/a/b/w secret' a",
    "sed -i 'w secret' a", "sed -i 'e touch secret' a", "sed -i 's/a/b/;w secret' a",
    "sed -i 's/a/b/\nw secret' a", "sed -i 's|a|b|' a", "sed -i 's/[a/]/b/' a",
    "sed -i 's/a/b/' a --follow-symlinks", "sed --follow-symlinks -i 's/a/b/' a",
    "sed -i -i.bak 's/a/b/' a", "sed -i'*.bak' 's/a/b/' a",
    "sed -i../backup 's/a/b/' a", "sed -i 's/a/b/' *.ts", "sed -i 's/a/b/' a > out",
    "sed -i 's/a/b/' a && rm b", "sed -i 's/a/b/' a | tee out",
    "sed -i 's/a/b/' \"$FILE\"", "LANG=C sed -i 's/a/b/' a",
    "sudo sed -i 's/a/b/' a", "/usr/bin/sed -i 's/a/b/' a", "gsed -i 's/a/b/' a",
    "sed -i -e 's/a/b/' -e 'w secret' a", "sed -i 's/a/b/' 'bad\u0000file'",
    "sed -i 's/a/b/' -", "sed -i 's/a/b/' a -e 'w secret'",
  ];
  it.each(refused)("leaves uncertain GNU commands unknown: %s", (command) => {
    expect(sedWrites(command, "gnu")).toEqual({ kind: "unknown" });
  });
  it.each([undefined, "other"])("never guesses dialect %s", (dialect) => {
    expect(sedWrites("sed -i 's/a/b/' a", dialect as SedDialect)).toEqual({ kind: "unknown" });
  });
  it("does not confuse GNU's optional extension with macOS's required extension", () => {
    expect(sedWrites("sed -i 's/a/b/' a", "macos")).toEqual({ kind: "unknown" });
    expect(sedWrites("sed -i '' 's/a/b/' a", "gnu")).toEqual({ kind: "unknown" });
  });
});
