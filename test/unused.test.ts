// Let TypeScript resolve references: text searches mistake comments and namesakes for uses.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);

it("production sources have no unused locals, imports, types or parameters", () => {
  const result = spawnSync(process.execPath, [
    require.resolve("typescript/bin/tsc"),
    "-p", "tsconfig.json", "--noEmit", "--noUnusedLocals", "--noUnusedParameters",
  ], {
    cwd: path.join(import.meta.dirname, ".."),
    encoding: "utf8",
    timeout: 25_000,
  });

  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
