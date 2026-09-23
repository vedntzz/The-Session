import { describe, expect, it } from "vitest";
import { packageManagerWrites } from "../src/shell/package-manager.js";
import { simpleWords } from "../src/shell/words.js";

const writes = (...paths: string[]) => ({ kind: "writes", paths });
const UNKNOWN = { kind: "unknown" };

describe("simpleWords", () => {
  it("splits one plain command into its words", () => {
    expect(simpleWords("npm  install\tlodash")).toEqual(["npm", "install", "lodash"]);
  });

  it("reads single quotes literally and double quotes only when nothing can expand", () => {
    expect(simpleWords(`npm i 'left pad' "@scope/pkg"`)).toEqual(["npm", "i", "left pad", "@scope/pkg"]);
    expect(simpleWords(`npm i "$PKG"`)).toBeUndefined();
    expect(simpleWords("npm i 'unterminated")).toBeUndefined();
  });

  it.each([
    "npm i a && rm -rf src", "npm i a; echo", "npm i a | tee log", "npm i a > out",
    "npm i $(cat list)", "npm i `cat list`", "npm i a*", "npm i ~/pkg", "npm i a\nrm b",
    "(npm i a)", "npm i a &", "npm i {a,b}", "npm i a # comment", "npm i a\\ b",
  ])("refuses anything the shell would chain, redirect or expand: %j", (command) => {
    expect(simpleWords(command)).toBeUndefined();
  });

  it("refuses zsh expansions POSIX sh would not make", () => {
    // Claude Code's Bash tool runs zsh on macOS: `=cmd` expands to cmd's path,
    // and `^` is a glob operator under extendedglob.
    expect(simpleWords("rm =node")).toBeUndefined();
    expect(simpleWords("git diff HEAD^")).toBeUndefined();
    expect(simpleWords("ls ^*.ts")).toBeUndefined();
  });

  it("keeps a quoted or mid-word = and a quoted ^ literal", () => {
    expect(simpleWords("rm '=node'")).toEqual(["rm", "=node"]);
    expect(simpleWords("npm i --registry=x a=b")).toEqual(["npm", "i", "--registry=x", "a=b"]);
    expect(simpleWords("grep '^foo' a")).toEqual(["grep", "^foo", "a"]);
  });

  it("refuses an environment assignment in front of the command", () => {
    expect(simpleWords("NODE_ENV=production npm ci")).toBeUndefined();
  });

  it("has no words for an empty command", () => {
    expect(simpleWords("   ")).toBeUndefined();
  });
});

describe("packageManagerWrites", () => {
  it.each([
    ["npm install lodash", writes("package.json", "package-lock.json")],
    ["npm i -D vitest", writes("package.json", "package-lock.json")],
    ["npm add --save-exact left-pad@1.3.0", writes("package.json", "package-lock.json")],
    ["npm install", writes("package-lock.json")],
    ["npm uninstall lodash", writes("package.json", "package-lock.json")],
    ["npm update", writes("package.json", "package-lock.json")],
    ["npm ci", writes()],
    ["npm install lodash --no-save", writes()],
    ["pnpm add -D vitest", writes("package.json", "pnpm-lock.yaml")],
    ["pnpm install", writes("pnpm-lock.yaml")],
    ["pnpm install --frozen-lockfile", writes()],
    ["pnpm remove lodash", writes("package.json", "pnpm-lock.yaml")],
    ["pnpm up --latest", writes("package.json", "pnpm-lock.yaml")],
    ["yarn", writes("yarn.lock")],
    ["yarn install --frozen-lockfile", writes()],
    ["yarn install --immutable", writes()],
    ["yarn add --dev vitest", writes("package.json", "yarn.lock")],
    ["yarn remove lodash", writes("package.json", "yarn.lock")],
    ["yarn upgrade", writes("package.json", "yarn.lock")],
  ])("%s", (command, expected) => {
    expect(packageManagerWrites(command)).toEqual(expected);
  });

  it.each([
    ["a global install writes outside the repository", "npm install -g typescript"],
    ["a global install, long form", "pnpm add --global typescript"],
    ["another directory", "npm install --prefix ../other lodash"],
    ["another directory, pnpm", "pnpm -C ../other install"],
    ["another directory, yarn", "yarn --cwd ../other add lodash"],
    ["a workspace", "npm install -w api lodash"],
    ["a recursive install", "pnpm -r install"],
    ["an unlisted flag", "npm install --registry=https://example.invalid lodash"],
    ["scripts, which run anything", "npm run build"],
    ["npm test", "npm test"],
    ["npx, which runs anything", "npx prettier --write ."],
    ["an add with nothing to add", "pnpm add"],
    ["a remove with nothing to remove", "npm uninstall"],
    ["pnpm install with packages, which pnpm refuses", "pnpm install lodash"],
    ["yarn install with packages, which yarn refuses", "yarn install lodash"],
    ["npm ci with packages", "npm ci lodash"],
    ["bare npm", "npm"],
    ["a chained command", "npm install lodash && git commit -am x"],
    ["an environment prefix", "CI=1 npm install"],
    ["another program", "bun add lodash"],
    ["a subcommand borrowed from Object.prototype", "npm constructor"],
  ])("is unknown for %s", (_, command) => {
    expect(packageManagerWrites(command)).toEqual(UNKNOWN);
  });
});
