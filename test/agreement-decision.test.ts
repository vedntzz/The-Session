import { describe, expect, it } from "vitest";
import { decideAgreementWrite, type AgreementWrite } from "../src/agreement-decision.js";
import { AGREEMENT_POLICIES, type Agreement } from "../src/agreement.js";

const agreement: Agreement = {
  paths: ["src/"], actions: ["create", "edit"], sensitivePaths: ["src/keys/"], policy: "ask",
};

describe("agreement write decisions", () => {
  it("adds no restriction when no agreement was recorded", () => {
    expect(decideAgreementWrite(undefined, { path: "anywhere.ts", action: "delete" }))
      .toEqual({ decision: "defer", violations: [] });
  });

  it.each(AGREEMENT_POLICIES)("defers a compliant write under %s, without granting permission", (policy) => {
    expect(decideAgreementWrite({ ...agreement, policy }, { path: "src/parser.ts", action: "edit" }))
      .toEqual({ decision: "defer", violations: [] });
  });

  it.each(AGREEMENT_POLICIES)("uses %s for a path outside the accepted prefixes", (policy) => {
    expect(decideAgreementWrite({ ...agreement, policy }, { path: "test/parser.ts", action: "create" }))
      .toEqual({ decision: policy === "record" ? "defer" : policy, violations: ["outside-paths"] });
  });

  it.each(AGREEMENT_POLICIES)("uses %s for an unaccepted operation", (policy) => {
    expect(decideAgreementWrite({ ...agreement, policy }, { path: "src/parser.ts", action: "delete" }))
      .toEqual({ decision: policy === "record" ? "defer" : policy, violations: ["action-not-accepted"] });
  });

  it.each(AGREEMENT_POLICIES)("uses %s for sensitive paths even inside scope", (policy) => {
    expect(decideAgreementWrite({ ...agreement, policy }, { path: "src/keys/token.ts", action: "edit" }))
      .toEqual({ decision: policy === "record" ? "defer" : policy, violations: ["sensitive-path"] });
  });

  it("checks sensitive paths even when the whole repository was accepted", () => {
    expect(decideAgreementWrite({ ...agreement, paths: ["."], policy: "deny" }, { path: "src/keys/token.ts", action: "edit" }))
      .toEqual({ decision: "deny", violations: ["sensitive-path"] });
  });

  it("retains every mismatch, in stable order, in record-only mode too", () => {
    expect(decideAgreementWrite({ ...agreement, paths: ["test"], policy: "record" }, { path: "src/keys/token.ts", action: "delete" }))
      .toEqual({ decision: "defer", violations: ["outside-paths", "action-not-accepted", "sensitive-path"] });
  });

  it("matches accepted paths at directory boundaries, not string prefixes", () => {
    expect(decideAgreementWrite(agreement, { path: "src-extra/parser.ts", action: "edit" }).violations)
      .toEqual(["outside-paths"]);
    expect(decideAgreementWrite({ ...agreement, paths: ["src/parser.ts"] }, { path: "src/parser.ts.bak", action: "edit" }).violations)
      .toEqual(["outside-paths"]);
  });

  it("matches sensitive paths at the same directory boundaries", () => {
    expect(decideAgreementWrite(agreement, { path: "src/keys-backup/token.ts", action: "edit" }))
      .toEqual({ decision: "defer", violations: [] });
  });

  it("treats empty accepted lists as accepting no paths or operations", () => {
    expect(decideAgreementWrite({ ...agreement, paths: [], actions: [] }, { path: "src/parser.ts", action: "edit" }))
      .toEqual({ decision: "ask", violations: ["outside-paths", "action-not-accepted"] });
  });

  it("uses the declared action rather than inferring it from a filename", () => {
    const accepted = { ...agreement, actions: ["create"] as const };
    expect(decideAgreementWrite(accepted, { path: "src/new.ts", action: "create" }).violations).toEqual([]);
    expect(decideAgreementWrite(accepted, { path: "src/new.ts", action: "edit" }).violations).toEqual(["action-not-accepted"]);
  });

  it("does not mutate accepted terms or the attempted write", () => {
    const accepted = Object.freeze({ ...agreement, paths: Object.freeze(["src/"]), actions: Object.freeze(["edit"] as const) });
    const write = Object.freeze({ path: "src/a file, with commas.ts", action: "edit" as const });
    expect(decideAgreementWrite(accepted, write)).toEqual({ decision: "defer", violations: [] });
    expect(accepted.paths).toEqual(["src/"]);
  });

  it.each(["", ".", "./src/a.ts", "src/../a.ts", "../outside.ts", "/tmp/a.ts", "src/", " src/a.ts", "src/a.ts ", "src\\a.ts", "src//a.ts", "src/\na.ts"])(
    "refuses unresolved or ambiguous paths rather than guessing: %j", (path) => {
      expect(() => decideAgreementWrite(agreement, { path, action: "edit" })).toThrow();
    },
  );

  it("refuses unsupported actions and malformed recorded terms", () => {
    expect(() => decideAgreementWrite(agreement, { path: "src/a.ts", action: "execute" } as unknown as AgreementWrite)).toThrow(/Write action/);
    expect(() => decideAgreementWrite({ ...agreement, policy: "allow" } as unknown as Agreement, { path: "src/a.ts", action: "edit" })).toThrow(/Agreement policy/);
  });
});
