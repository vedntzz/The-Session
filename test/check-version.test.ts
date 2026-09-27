// prepublishOnly: package.json's version must be greater than the registry's. A
// stand-in `npm` on PATH plays the registry; nothing here reaches the network.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.join(import.meta.dirname, "../scripts/check-version.mjs");

interface Registry { stdout?: string; stderr?: string; status?: number }

function run(version: string, registry: Registry) {
  const dir = mkdtempSync(path.join(tmpdir(), "check-version-"));
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@scope/pkg", version }));
  writeFileSync(path.join(bin, "npm"), [
    "#!/bin/sh",
    `echo "$@" > "${path.join(dir, "args")}"`,
    `printf '%s' '${registry.stdout ?? ""}'`,
    `printf '%s' '${registry.stderr ?? ""}' >&2`,
    `exit ${registry.status ?? 0}`,
  ].join("\n"));
  chmodSync(path.join(bin, "npm"), 0o755);
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: dir, env, encoding: "utf8" });
  return { ...result, args: readFileSync(path.join(dir, "args"), "utf8").trim() };
}

describe("prepublishOnly version check", () => {
  it("asks the registry for this package's published version", () => {
    expect(run("1.0.1", { stdout: "1.0.0\n" }).args).toBe("view @scope/pkg version");
  });

  it.each([
    ["1.0.1", "1.0.0"], ["1.1.0", "1.0.9"], ["2.0.0", "1.99.99"], ["1.10.0", "1.9.0"],
    ["1.0.0", "1.0.0-rc.1"], ["1.0.0-rc.2", "1.0.0-rc.1"], ["1.0.0-rc.10", "1.0.0-rc.9"],
    ["1.0.0-beta", "1.0.0-alpha"], ["1.0.0-alpha.1", "1.0.0-alpha"], ["1.0.0-alpha.beta", "1.0.0-alpha.1"],
  ])("passes %s over a published %s", (version, published) => {
    expect(run(version, { stdout: `${published}\n` }).status).toBe(0);
  });

  it.each([
    ["1.0.0", "1.0.0"], ["0.9.0", "1.0.0"], ["1.9.0", "1.10.0"], ["1.0.0-rc.1", "1.0.0"],
    ["1.0.0-rc.9", "1.0.0-rc.10"], ["1.0.0+build.2", "1.0.0+build.1"],
  ])("fails %s against a published %s, naming both", (version, published) => {
    const result = run(version, { stdout: `${published}\n` });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`package.json is ${version}, not greater than ${published} on the registry`);
  });

  it("passes a package the registry has never seen", () => {
    const result = run("0.1.0", { status: 1, stderr: "npm error code E404\nnpm error 404 Not Found" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("not on the registry yet");
  });

  it("fails when the registry cannot be asked, rather than guessing", () => {
    const result = run("9.9.9", { status: 1, stderr: "npm error code ENOTFOUND" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Could not read the published version of @scope/pkg");
  });

  it("fails a version that is not semver, on either side", () => {
    expect(run("1.0", { stdout: "0.9.0\n" }).stderr).toContain('"1.0" is not a semver version');
    expect(run("1.0.1", { stdout: "\n" }).stderr).toContain('"" is not a semver version');
  });
});
