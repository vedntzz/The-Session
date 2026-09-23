import { describe, expect, it } from "vitest";
import { sessionFrom } from "../src/store.js";
import { selectWriteSession } from "../src/write-session.js";

const base = sessionFrom({ intent: "work", startedAt: "2026-09-22T09:00:00Z", startCommit: "abc" }, "repo", "declared");
const agreement = { paths: ["."], actions: ["edit" as const], sensitivePaths: [], policy: "deny" as const };
const local = { ...base, id: "local", checkout: "/repo", agreement };

describe("write-session selection", () => {
  it("returns no session when none is open here", () => {
    expect(selectWriteSession([], "/repo")).toBeUndefined();
    expect(selectWriteSession([{ ...local, checkout: "/other" }], "/repo")).toBeUndefined();
    expect(selectWriteSession([{ ...local, endedAt: "closed" }], "/repo")).toBeUndefined();
  });
  it("selects the checkout, never the newest repository session", () => {
    const other = { ...local, id: "newer", checkout: "/other", startedAt: "2026-09-22T10:00:00Z" };
    expect(selectWriteSession([local, other], "/repo")).toBe(local);
    expect(selectWriteSession([other, local], "/repo")).toBe(local);
  });
  it("refuses ambiguous local sessions, even when one has no agreement", () => {
    expect(() => selectWriteSession([local, { ...local, id: "second", agreement: undefined }], "/repo")).toThrow("Multiple sessions");
  });
  it("does not infer a checkout for old agreements or silently ignore them", () => {
    expect(() => selectWriteSession([{ ...local, checkout: undefined }], "/repo")).toThrow("no checkout");
    expect(() => selectWriteSession([local, { ...local, checkout: undefined }], "/repo")).toThrow("no checkout");
  });
  it("leaves legacy records without agreements alone", () => {
    expect(selectWriteSession([base], "/repo")).toBeUndefined();
    expect(selectWriteSession([base, local], "/repo")).toBe(local);
  });
});
