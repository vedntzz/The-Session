// Writes docs/context.md.
//
// The document is derived, never edited: every figure in it is the output of a
// command run here, and every prose block is copied out of the file that owns
// it by `extracts.mjs`. Run this rather than amending the file — the summary it
// replaced went three releases stale because amending was possible.
//
//   node evidence/gen-context.mjs
//
// `test/context.test.ts` fails when the copied blocks no longer match their
// sources, which is the signal to run this again.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as extracts from "./extracts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd) => {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .trimEnd();
  } catch (error) {
    // A non-zero exit is a fact about the repository too — the backtest's own
    // failure was worth printing when it had one. Keep the output, not a throw.
    return `${error.stdout ?? ""}${error.stderr ?? ""}`.trimEnd();
  }
};

/** A command, its real output, and nothing elided between them. */
const cap = (cmd) => ["```console", `$ ${cmd}`, run(cmd), "```"].join("\n");

const commands = {
  pkg: "npm pkg get name version engines dependencies",
  deps: "npm ls --omit=dev --depth=0",
  src: "find src -name '*.ts' | wc -l && find src -name '*.ts' -exec cat {} + | wc -l",
  test: "find test -name '*.ts' | wc -l && find test -name '*.ts' -exec cat {} + | wc -l",
  verbs: "node evidence/verbs.mjs",
  home: "grep -n 'SESSION_HOME' src/store/paths.ts",
  refs: "grep -n 'export const REF_PREFIX' src/sync/refs.ts",
  attr: "grep -n 'ATTRIBUTION_KEYS = ' src/config.ts && grep -n 'CONFIG_FILE = ' src/config.ts",
  rej: "awk '/^## Rejected/{on=1} on && /^### /{print}' docs/decisions.md",
  bt: "node evidence/prime-backtest.mjs 2>&1 | grep 'exact paths'",
  rates:
    "node -e \"const r=require('./rates.json');" +
    "console.log('model entries: '+Object.keys(r.models).length);" +
    "console.log('prices checked: '+r.checked)\"",
  tests: "npm test 2>&1 | tail -5",
  tc: "npm run typecheck 2>&1 | tail -2",
  skills: "ls .claude/skills",
  skhead: "wc -l .claude/skills/measurement-rules/SKILL.md",
};

const values = {
  head: run("git log --oneline -1"),
  describe: run("git describe --tags --always"),
  v_inv: extracts.invariants(ROOT),
  v_layout: extracts.layout(ROOT),
  v_iface: extracts.sessionInterface(ROOT),
  v_onezero: extracts.whatOneZeroMeans(ROOT),
  v_skill: extracts.measurementRules(ROOT),
};
for (const [name, cmd] of Object.entries(commands)) {
  values[`c_${name}`] = cap(cmd);
}

const template = readFileSync(path.join(ROOT, "evidence/context.tpl.md"), "utf8");
const missing = [];
const rendered = template.replace(/\$\$|\$([a-z_]+)/g, (whole, name) => {
  if (whole === "$$") {
    return "$";
  }
  if (!(name in values)) {
    missing.push(name);
    return whole;
  }
  return values[name];
});
if (missing.length > 0) {
  throw new Error(`template placeholders with no value: ${[...new Set(missing)].join(", ")}`);
}

const out = path.join(ROOT, "docs/context.md");
writeFileSync(out, rendered);
console.log(`wrote ${path.relative(ROOT, out)} — ${rendered.split("\n").length} lines`);
