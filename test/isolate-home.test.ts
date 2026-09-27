import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { settingsFile } from "../src/commands/hook.js";
import { storeHome } from "../src/store/paths.js";

describe("the test setup", () => {
  const scratch = realpathSync(tmpdir());

  it("gives every test a home in a temporary directory", () => {
    expect(homedir()).toBe(process.env["HOME"]);
    expect(homedir().startsWith(scratch + path.sep)).toBe(true);
  });

  it("sends every default config path there, not to the machine's own", () => {
    for (const file of [settingsFile(), storeHome()]) {
      expect(file.startsWith(homedir() + path.sep)).toBe(true);
    }
  });
});
