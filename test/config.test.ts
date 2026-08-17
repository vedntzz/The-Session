import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatConfig, setConfig, showConfig } from "../src/commands/config.js";
import {
  attributionEntries,
  attributionValues,
  configFile,
  hasAttribution,
  isAttributionKey,
  readConfig,
} from "../src/config.js";

const execFileAsync = promisify(execFile);

let cwd: string;

/** A repo with one commit, since attribution is keyed to a repo root. */
beforeEach(async () => {
  // realpath because git reports the resolved root, and on macOS /var is a
  // symlink to /private/var.
  cwd = await realpath(await mkdtemp(path.join(tmpdir(), "session-config-")));
  await execFileAsync("git", ["init", "-q", cwd]);
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function fileContents(): Promise<string> {
  return readFile(path.join(cwd, ".session.json"), "utf8");
}

describe("readConfig", () => {
  it("is empty when the repo declares nothing", async () => {
    await expect(readConfig(cwd)).resolves.toEqual({});
    expect(hasAttribution(await readConfig(cwd))).toBe(false);
  });

  it("reads the four fields", async () => {
    await writeFile(
      path.join(cwd, ".session.json"),
      JSON.stringify({
        client: "Acme",
        project: "orders-api",
        sow: "SOW-2026-014",
        billingCode: "ACME-ORD-1",
      }),
      "utf8",
    );

    await expect(readConfig(cwd)).resolves.toEqual({
      client: "Acme",
      project: "orders-api",
      sow: "SOW-2026-014",
      billingCode: "ACME-ORD-1",
    });
  });

  it("finds the repo root from a subdirectory", async () => {
    await writeFile(path.join(cwd, ".session.json"), '{"client":"Acme"}', "utf8");
    const nested = path.join(cwd, "packages", "core");
    await mkdir(nested, { recursive: true });

    await expect(readConfig(nested)).resolves.toEqual({ client: "Acme" });
  });

  it("trims values and drops empty ones", async () => {
    await writeFile(path.join(cwd, ".session.json"), '{"client":"  Acme  ","project":"  "}', "utf8");

    await expect(readConfig(cwd)).resolves.toEqual({ client: "Acme" });
  });

  it("ignores keys it does not know, since the file is shared across versions", async () => {
    await writeFile(path.join(cwd, ".session.json"), '{"client":"Acme","invoiceRun":"Q3"}', "utf8");

    await expect(readConfig(cwd)).resolves.toEqual({ client: "Acme" });
  });

  it("refuses a known key holding something that is not a string", async () => {
    await writeFile(path.join(cwd, ".session.json"), '{"client":{"name":"Acme"}}', "utf8");

    await expect(readConfig(cwd)).rejects.toThrow(/client must be a string, got object/);
  });

  it("says which file to fix when it is not valid JSON", async () => {
    await writeFile(path.join(cwd, ".session.json"), "{client: Acme}", "utf8");

    await expect(readConfig(cwd)).rejects.toThrow(/\.session\.json is not valid JSON/);
  });

  it("refuses a file that is not an object", async () => {
    await writeFile(path.join(cwd, ".session.json"), '["Acme"]', "utf8");

    await expect(readConfig(cwd)).rejects.toThrow(/must hold a JSON object/);
  });

  it("treats an empty file as declaring nothing", async () => {
    await writeFile(path.join(cwd, ".session.json"), "\n", "utf8");

    await expect(readConfig(cwd)).resolves.toEqual({});
  });
});

describe("setConfig", () => {
  it("writes the field to .session.json at the repo root", async () => {
    const result = await setConfig("client", "Acme", cwd);

    expect(result.file).toBe(await configFile(cwd));
    expect(JSON.parse(await fileContents())).toEqual({ client: "Acme" });
  });

  it("writes it where git will see it, not under ~/.session", async () => {
    await setConfig("client", "Acme", cwd);

    expect(await configFile(cwd)).toBe(path.join(cwd, ".session.json"));
  });

  it("writes from a subdirectory to the root, not beside the caller", async () => {
    const nested = path.join(cwd, "packages", "core");
    await mkdir(nested, { recursive: true });

    await setConfig("client", "Acme", nested);

    expect(JSON.parse(await fileContents())).toEqual({ client: "Acme" });
  });

  it("formats for a diff a human will review", async () => {
    await setConfig("client", "Acme", cwd);
    await setConfig("project", "orders-api", cwd);

    expect(await fileContents()).toBe('{\n  "client": "Acme",\n  "project": "orders-api"\n}\n');
  });

  it("leaves the other fields alone", async () => {
    await setConfig("client", "Acme", cwd);
    await setConfig("sow", "SOW-2026-014", cwd);

    await expect(readConfig(cwd)).resolves.toEqual({ client: "Acme", sow: "SOW-2026-014" });
  });

  it("keeps keys a newer version wrote", async () => {
    await writeFile(path.join(cwd, ".session.json"), '{"invoiceRun":"Q3"}', "utf8");

    await setConfig("client", "Acme", cwd);

    expect(JSON.parse(await fileContents())).toEqual({ invoiceRun: "Q3", client: "Acme" });
  });

  it("replaces a value rather than appending one", async () => {
    await setConfig("client", "Acme", cwd);
    await setConfig("client", "Globex", cwd);

    await expect(readConfig(cwd)).resolves.toEqual({ client: "Globex" });
  });

  it("clears a field when the value is empty", async () => {
    await setConfig("client", "Acme", cwd);
    await setConfig("project", "orders-api", cwd);

    const result = await setConfig("client", "", cwd);

    expect(result.changed?.removed).toBe(true);
    expect(JSON.parse(await fileContents())).toEqual({ project: "orders-api" });
  });

  it("trims what it is given", async () => {
    await setConfig("client", "  Acme  ", cwd);

    expect(JSON.parse(await fileContents())).toEqual({ client: "Acme" });
  });

  it("refuses a key that is not one of the four", async () => {
    await expect(setConfig("clietn", "Acme", cwd)).rejects.toThrow(
      /clietn is not something a session records.*client, project, sow, billingCode/s,
    );
  });

  it("refuses outside a repo, since the file belongs to one", async () => {
    const loose = await mkdtemp(path.join(tmpdir(), "session-loose-"));
    try {
      await expect(setConfig("client", "Acme", loose)).rejects.toThrow(/Not a git repository/);
    } finally {
      await rm(loose, { recursive: true, force: true });
    }
  });
});

describe("showConfig", () => {
  it("reports what the repo declares without writing anything", async () => {
    await setConfig("client", "Acme", cwd);

    const result = await showConfig(cwd);

    expect(result.attribution).toEqual({ client: "Acme" });
    expect(result.changed).toBeUndefined();
  });

  it("reports an undeclared repo as empty", async () => {
    await expect(showConfig(cwd)).resolves.toMatchObject({ attribution: {} });
  });
});

describe("formatConfig", () => {
  it("says what it wrote and where", async () => {
    const lines = formatConfig(await setConfig("client", "Acme", cwd));

    expect(lines[0]).toBe(`  wrote        ${path.join(cwd, ".session.json")}`);
    expect(lines[1]).toBe("  client       Acme");
  });

  it("says the change starts from the next session", async () => {
    const lines = formatConfig(await setConfig("client", "Acme", cwd));

    expect(lines.at(-1)).toContain("sessions already recorded keep theirs");
  });

  it("says so when a field was cleared away to nothing", async () => {
    await setConfig("client", "Acme", cwd);

    const lines = formatConfig(await setConfig("client", "", cwd));

    expect(lines[0]).toBe(`  cleared      ${path.join(cwd, ".session.json")}`);
    expect(lines[1]).toBe("  none         no attribution declared");
  });

  it("lists the fields in a fixed order, whatever order they were set in", async () => {
    await setConfig("billingCode", "ACME-ORD-1", cwd);
    await setConfig("client", "Acme", cwd);
    await setConfig("sow", "SOW-2026-014", cwd);

    const lines = formatConfig(await showConfig(cwd));

    expect(lines.slice(1)).toEqual([
      "  client       Acme",
      "  sow          SOW-2026-014",
      "  billingCode  ACME-ORD-1",
    ]);
  });

  it("uses no emoji and no colour", async () => {
    for (const line of formatConfig(await setConfig("client", "Acme", cwd))) {
      expect(line).not.toMatch(/\[/);
      expect(line).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe("the field helpers", () => {
  it("knows the four keys", () => {
    expect(isAttributionKey("client")).toBe(true);
    expect(isAttributionKey("billingCode")).toBe(true);
    expect(isAttributionKey("Client")).toBe(false);
    expect(isAttributionKey("nope")).toBe(false);
  });

  it("lists values and pairs in key order, skipping what is unset", () => {
    const attribution = { billingCode: "ACME-ORD-1", client: "Acme" };

    expect(attributionValues(attribution)).toEqual(["Acme", "ACME-ORD-1"]);
    expect(attributionEntries(attribution)).toEqual([
      ["client", "Acme"],
      ["billingCode", "ACME-ORD-1"],
    ]);
  });

  it("treats an absent attribution as declaring nothing", () => {
    expect(hasAttribution(undefined)).toBe(false);
    expect(attributionValues(undefined)).toEqual([]);
  });
});
