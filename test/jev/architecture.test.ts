// Jev's boundary, read from the source as text: an advisor that cannot reach
// the log, and a core that knows only Jev's contract.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(import.meta.dirname, "../../src");
const INTERFACE = "jev/interface.ts";

function sources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(full) : entry.name.endsWith(".ts") ? [path.relative(SRC, full)] : [];
  });
}

/** Every relative import of a file, resolved to a path under src/. */
function imports(file: string): string[] {
  const text = readFileSync(path.join(SRC, file), "utf8");
  return [...text.matchAll(/(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g)].map(([, spec]) =>
    path.normalize(path.join(path.dirname(file), spec!.replace(/\.js$/, ".ts"))),
  );
}

const inJev = (file: string) => file.startsWith("jev/");
const forbidden = (dep: string) => dep.startsWith("store/") || dep.startsWith("capture/") || dep === "chain.ts";

describe("Jev's boundary", () => {
  it("has a contract to hold to", () => {
    expect(sources()).toContain(INTERFACE);
  });

  it("src/jev/ imports nothing from src/store, src/chain or src/capture", () => {
    const reached = sources().filter(inJev).flatMap((file) => imports(file).filter(forbidden).map((dep) => `${file} -> ${dep}`));
    expect(reached).toEqual([]);
  });

  it("nothing outside src/jev/ imports src/jev/ except interface.ts", () => {
    const reached = sources()
      .filter((file) => !inJev(file))
      .flatMap((file) => imports(file).filter((dep) => inJev(dep) && dep !== INTERFACE).map((dep) => `${file} -> ${dep}`));
    expect(reached).toEqual([]);
  });
});
