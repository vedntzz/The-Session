import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAgreement, proposerOf, type Agreement } from "../src/agreement.js";
import { verifyLog } from "../src/commands/verify.js";
import { PRIME_RULE, proposeScope, type PrimeProposal } from "../src/prime.js";
import {
  appendSession, foldLog, readLog, readSessions, resolveStoreFile, updateSession,
  type NewSession, type SessionPatch, type StoreOptions,
} from "../src/store.js";

const terms: Agreement = {
  paths: ["src/"], actions: ["create", "edit"], sensitivePaths: ["src/secrets/"], policy: "ask",
};
const input: NewSession = {
  intent: "fix the parser", startedAt: "2026-09-22T09:00:00.000Z", startCommit: "abc123",
};
const proposal: PrimeProposal = {
  rule: PRIME_RULE, intent: input.intent!, scope: ["src/parser.ts"], candidates: [],
  history: 0, comparable: 0, tracked: 1, omitted: 0,
};
let root: string;
let options: StoreOptions;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "session-agreement-"));
  options = { home: path.join(root, "store"), cwd: root };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("accepted terms", () => {
  it("normalizes prefixes without changing the caller's arrays", () => {
    const supplied = { ...terms, paths: [" ./src/ ", "src", "test/"], actions: ["edit", "edit"] };
    const accepted = parseAgreement(supplied);
    expect(accepted).toEqual({ ...terms, paths: ["src", "test"], actions: ["edit"], sensitivePaths: ["src/secrets"] });
    supplied.paths.push("other");
    expect(accepted.paths).toEqual(["src", "test"]);
  });

  it("keeps explicitly empty lists and a whole-repo prefix distinct", () => {
    expect(parseAgreement({ paths: [], actions: [], sensitivePaths: [], policy: "deny" }).paths).toEqual([]);
    expect(parseAgreement({ ...terms, paths: ["./"] }).paths).toEqual(["."]);
  });

  it.each(["", " ", "/etc/passwd", "../other", "src/../other", "C:/other", "C:\\other", "src\\other", "src//other", "src/./other", "src/\nother", "src/\0other"])(
    "refuses an ambiguous or non-repo path %j", (entry) => {
      expect(() => parseAgreement({ ...terms, paths: [entry] })).toThrow(/repo-relative path/);
      expect(() => parseAgreement({ ...terms, sensitivePaths: [entry] })).toThrow(/repo-relative path/);
    },
  );

  it.each([
    null, [], {}, { ...terms, paths: "src" }, { ...terms, sensitivePaths: [42] },
    { ...terms, actions: undefined }, { ...terms, actions: ["Edit"] },
    { ...terms, actions: ["execute"] }, { ...terms, policy: "allow" },
    { ...terms, policy: undefined }, { ...terms, prompt: "not metadata" },
  ])("rejects incomplete or unsupported terms: %j", (value) => {
    expect(() => parseAgreement(value)).toThrow();
  });
});

describe("agreement storage", () => {
  it("signs the agreement in the creating record and derives the measurement scope", async () => {
    const created = await appendSession({ ...input, agreement: terms }, options);
    expect(created.agreement).toEqual(parseAgreement(terms));
    expect(created.scope).toEqual(["src"]);
    expect(await readSessions(options)).toEqual([created]);
    const log = await readLog(options);
    expect(log.lines).toHaveLength(1);
    expect(JSON.parse(log.lines[0]!.text).set.agreement).toEqual(created.agreement);
    expect((await verifyLog(options)).check).toMatchObject({ verified: 1, signaturesChecked: true });
    expect((await verifyLog(options)).check.break).toBeUndefined();
  });

  it("accepts equivalent explicit scope and records the agreement's order", async () => {
    const created = await appendSession({
      ...input, agreement: { ...terms, paths: ["src", "test"] }, scope: ["test/", "./src", "src"],
    }, options);
    expect(created.scope).toEqual(["src", "test"]);
  });

  it.each([
    { agreement: { ...terms, policy: "bogus" } },
    { agreement: terms, scope: ["elsewhere"] },
    { agreement: terms, scope: [] },
    { agreement: terms, intent: null },
    { agreement: terms, intentSource: "captured" },
    { agreement: terms, intent: " " },
  ])("refuses invalid declarations before creating the store: %j", async (extra) => {
    await expect(appendSession({ ...input, ...extra } as NewSession, options)).rejects.toThrow();
    await expect(readdir(options.home!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the original suggestion apart from accepted paths", async () => {
    const created = await appendSession({ ...input, intentSource: "primed", proposal, agreement: terms }, options);
    expect(created.proposal?.scope).toEqual(["src/parser.ts"]);
    expect(created.scope).toEqual(["src"]);
    expect(await readSessions(options)).toEqual([created]);
  });

  it.each([undefined, terms])("refuses to add, replace or remove an agreement later (%j)", async (agreement) => {
    const created = await appendSession({ ...input, agreement }, options);
    const before = await readLog(options);
    for (const value of [undefined, null, terms, { ...terms, policy: "record" }]) {
      await expect(updateSession(created.id, { agreement: value } as unknown as SessionPatch, options))
        .rejects.toThrow(/cannot be added or edited/);
    }
    expect(await readLog(options)).toEqual(before);
  });

  it("refuses scope edits on agreed sessions but permits normal closing patches", async () => {
    const created = await appendSession({ ...input, agreement: terms }, options);
    for (const scope of [undefined, [], ["elsewhere"], created.scope]) {
      await expect(updateSession(created.id, { scope }, options)).rejects.toThrow(/fixed by the agreement/);
    }
    const closed = await updateSession(created.id, {
      endedAt: "2026-09-22T10:00:00.000Z", reality: ["src/parser.ts", "test/parser.ts"], drift: ["test/parser.ts"],
    }, options);
    expect(closed.agreement).toEqual(created.agreement);
    expect(await readSessions(options)).toEqual([closed]);
    expect((await verifyLog(options)).check.break).toBeUndefined();
  });

  it.each([undefined, terms])("ignores forged later agreement patches, including first insertion (%j)", async (agreement) => {
    const created = await appendSession({ ...input, agreement }, options);
    const log = await readLog(options);
    for (const value of [terms, { ...terms, policy: "record" }, null]) {
      log.lines.push({ no: log.lines.length + 1, text: JSON.stringify({
        id: created.id, set: { agreement: value, scope: ["elsewhere"] },
      }) });
      const folded = foldLog(log)[0]!;
      expect(folded.agreement).toEqual(created.agreement);
      // Legacy scope behavior is unchanged; an agreement locks its scope.
      expect(folded.scope).toEqual(agreement ? created.scope : ["elsewhere"]);
    }
  });

  it("leaves older records and their signatures unchanged", async () => {
    const old = await appendSession({ ...input, intentSource: "primed", proposal }, options);
    const before = (await readLog(options)).lines[0]!.text;
    expect(JSON.parse(before).set).not.toHaveProperty("agreement");
    expect(JSON.parse(before).set.proposal).not.toHaveProperty("proposer");
    await appendSession({ ...input, agreement: terms }, options);
    await updateSession(old.id, { scope: ["legacy-edit"] }, options);
    expect((await readLog(options)).lines[0]!.text).toBe(before);
    const legacy = (await readSessions(options)).find((session) => session.id === old.id)!;
    expect(legacy.agreement).toBeUndefined();
    expect(legacy.scope).toEqual(["legacy-edit"]);
    expect(proposerOf(legacy.proposal!)).toBe("prime");
    expect((await verifyLog(options)).check).toMatchObject({ verified: 3, signaturesChecked: true });
    expect((await verifyLog(options)).check.break).toBeUndefined();
  });

  it.each(["paths", "actions", "sensitivePaths", "policy"] as const)("detects tampering with %s", async (field) => {
    await appendSession({ ...input, agreement: terms }, options);
    const file = await resolveStoreFile(options);
    const record = JSON.parse(await readFile(file, "utf8"));
    record.set.agreement[field] = field === "policy" ? "record" : [];
    await writeFile(file, `${JSON.stringify(record)}\n`);
    expect((await verifyLog(options)).check.break).toMatchObject({ line: 1, kind: "hash" });
  });
});

describe("proposal provenance", () => {
  it("labels new Prime proposals explicitly, with a read-only fallback for old ones", () => {
    expect(proposeScope({ intent: "fix parser" }, [], [], "repo", input.startedAt).proposer).toBe("prime");
    expect(proposerOf(proposal)).toBe("prime");
    expect(proposal).not.toHaveProperty("proposer");
    expect(proposerOf({ proposer: "external" })).toBe("external");
  });

  it("round-trips the proposer, fixes it at creation and detects tampering", async () => {
    const original = { ...proposal, proposer: "external" as const };
    const created = await appendSession({ ...input, intentSource: "primed", proposal: original, agreement: terms }, options);
    expect((await readSessions(options))[0]?.proposal?.proposer).toBe("external");
    await expect(updateSession(created.id, { proposal } as unknown as SessionPatch, options)).rejects.toThrow(/cannot be edited/);
    const log = await readLog(options);
    log.lines.push({ no: 2, text: JSON.stringify({ id: created.id, set: { proposal } }) });
    expect(foldLog(log)[0]?.proposal).toEqual(original);
    const file = await resolveStoreFile(options);
    const record = JSON.parse(await readFile(file, "utf8"));
    record.set.proposal.proposer = "prime";
    await writeFile(file, `${JSON.stringify(record)}\n`);
    expect((await verifyLog(options)).check.break).toMatchObject({ line: 1, kind: "hash" });
  });

  it("refuses unknown proposers before any record is written", async () => {
    await expect(appendSession({
      ...input, intentSource: "primed", proposal: { ...proposal, proposer: "unknown" } as unknown as PrimeProposal,
    }, options)).rejects.toThrow(/proposer must be prime or external/);
    await expect(readdir(options.home!)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
