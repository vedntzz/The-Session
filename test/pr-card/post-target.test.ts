import { describe, expect, it } from "vitest";
import { postTarget } from "../../src/pr-card/post-target.js";

const env = { GITHUB_TOKEN: "ghs_secret", GITHUB_REPOSITORY: "acme/widgets" };

describe("postTarget", () => {
  it("reads the token, owner/repo and the PR number", () => {
    expect(postTarget("42", env)).toEqual({ target: { owner: "acme", repo: "widgets", number: 42 }, token: "ghs_secret" });
  });

  it("names every missing piece at once", () => {
    expect(() => postTarget(undefined, {})).toThrow("Cannot post the card: GITHUB_TOKEN, GITHUB_REPOSITORY, --pr <number> not given.");
  });

  it("names a missing token alone, and an empty one as missing", () => {
    expect(() => postTarget("1", { GITHUB_REPOSITORY: "a/b" })).toThrow("Cannot post the card: GITHUB_TOKEN not given.");
    expect(() => postTarget("1", { GITHUB_REPOSITORY: "a/b", GITHUB_TOKEN: "" })).toThrow("Cannot post the card: GITHUB_TOKEN not given.");
  });

  it("names a missing repository alone", () => {
    expect(() => postTarget("1", { GITHUB_TOKEN: "t" })).toThrow("Cannot post the card: GITHUB_REPOSITORY not given.");
  });

  it("names a missing PR number alone", () => {
    expect(() => postTarget(undefined, env)).toThrow("Cannot post the card: --pr <number> not given.");
  });

  it.each(["acme", "acme/", "/widgets", "acme/widgets/extra"])("refuses GITHUB_REPOSITORY %s", (repository) => {
    expect(() => postTarget("1", { ...env, GITHUB_REPOSITORY: repository })).toThrow("it must be owner/repo.");
  });

  it.each(["0", "-1", "1.5", "12abc", "", "012"])("refuses --pr %s", (pr) => {
    expect(() => postTarget(pr, env)).toThrow("--pr takes a pull request number");
  });

  it("never puts the token in an error", () => {
    for (const call of [() => postTarget(undefined, env), () => postTarget("x", env), () => postTarget("1", { ...env, GITHUB_REPOSITORY: "bad" })]) {
      expect(call).toThrow();
      try { call(); } catch (error) { expect(String(error)).not.toContain("ghs_secret"); }
    }
  });
});
