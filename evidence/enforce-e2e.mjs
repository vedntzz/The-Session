// End-to-end check of agreement enforcement in a real Claude Code run, then
// latency of `session hook check`. Run after npm run build, with `session`
// linked to this checkout (npm link) and `claude` on PATH.
// Usage: node evidence/enforce-e2e.mjs [--no-agent]
// Everything happens in a temporary repo with its own SESSION_HOME; nothing
// under ~/.session is read or written. The agent step spends a few cents on
// the caller's Claude account; --no-agent skips it and measures latency only.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = realpathSync(mkdtempSync(path.join(tmpdir(), "session-e2e-")));
const repo = path.join(root, "repo");
const env = { ...process.env, SESSION_HOME: path.join(root, "store") };
mkdirSync(path.join(repo, "src"), { recursive: true });
const run = (cmd, args, input) =>
  spawnSync(cmd, args, { cwd: repo, env, input, encoding: "utf8" });
const git = (...args) => execFileSync("git", args, { cwd: repo, env });

git("init", "-q");
git("config", "user.email", "e2e@example.invalid");
git("config", "user.name", "e2e");
writeFileSync(path.join(repo, "src/a.ts"), "export const a = 1;\n");
git("add", "-A");
git("commit", "-qm", "init");

console.log("# Agreement enforcement, end to end\n");
console.log(`repo ${repo}\n`);
console.log(run("session", ["hook", "install", "--repo"]).stdout);

// The agreement is written through the same API --review calls on accept.
const { startSession } = await import(path.join(import.meta.dirname, "../dist/commands/start.js"));
process.env.SESSION_HOME = env.SESSION_HOME;
await startSession("e2e: edit src/a.ts only", {
  cwd: repo, scope: ["src"],
  agreement: { paths: ["src"], actions: ["edit"], sensitivePaths: [".env"], policy: "deny" },
});
console.log("agreement: paths [src], actions [edit], sensitive [.env], policy deny\n");

if (!process.argv.includes("--no-agent")) {
  const prompt = "Do exactly these two steps and nothing else, using only the Edit and Write tools. " +
    "Step 1: in src/a.ts add a new last line: export const b = 2;  " +
    "Step 2: create a new file notes.txt at the repository root containing the word hello. " +
    "If a step is blocked, do not retry or work around it; report which step was blocked and the reason given.";
  const agent = spawnSync("claude", ["-p", prompt, "--model", "haiku", "--permission-mode", "acceptEdits",
    "--allowedTools", "Read", "Edit", "Write", "--output-format", "stream-json", "--verbose"],
    { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const results = agent.stdout.split("\n").flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  for (const message of results) {
    for (const part of message.message?.content ?? []) {
      if (part.type === "tool_use") console.log(`tool     ${part.name} ${path.relative(repo, part.input.file_path ?? "")}`);
      if (part.type === "tool_result") {
        const text = typeof part.content === "string" ? part.content : JSON.stringify(part.content);
        console.log(`result   ${part.is_error ? "blocked" : "ok"}  ${part.is_error ? text.slice(0, 140) : ""}`);
      }
    }
  }
  const b = readFileSync(path.join(repo, "src/a.ts"), "utf8").includes("export const b = 2;");
  const notes = existsSync(path.join(repo, "notes.txt"));
  console.log(`\nsrc/a.ts edited: ${b ? "yes (expected)" : "NO"}`);
  console.log(`notes.txt created: ${notes ? "YES (enforcement failed)" : "no (expected)"}\n`);
  if (!b || notes) process.exitCode = 1;

  // What the check recorded: one signed write-check event per path it checked.
  const store = env.SESSION_HOME;
  const events = readdirSync(store).filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => readFileSync(path.join(store, name), "utf8").split("\n").filter(Boolean))
    .map((line) => JSON.parse(line).set.writeCheck).filter(Boolean);
  console.log("write-check events");
  for (const e of events) console.log(`  n=${e.n} ${e.tool} ${e.path ?? "(unknown)"} ${e.decision} ${e.reason} ${e.agent}`);
  const verify = run("session", ["verify"]);
  console.log(`\nsession verify: exit ${verify.status}\n${verify.stdout.trim()}\n`);
  if (!events.some((e) => e.decision === "deny") || verify.status !== 0) process.exitCode = 1;
}

// Latency: a fresh process per check, as the editor runs it.
await startSession("latency", {
  cwd: repo, scope: ["src"],
  agreement: { paths: ["src"], actions: ["edit"], sensitivePaths: [".env"], policy: "deny" },
}).catch(() => undefined); // the agent run's SessionEnd hook may or may not have closed the first
const payload = (tool, file) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, cwd: repo,
  tool_input: { file_path: file, content: "x", old_string: "a", new_string: "b" } });
const time = (fn, n = 30) => {
  const xs = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); fn(); xs.push(performance.now() - t); }
  xs.sort((a, b) => a - b);
  return `p50 ${xs[Math.floor(n / 2)].toFixed(0).padStart(4)} ms  p95 ${xs[Math.ceil(n * 0.95) - 1].toFixed(0).padStart(4)} ms`;
};
console.log("latency, 30 runs each");
console.log(`  bare node start         ${time(() => spawnSync("node", ["-e", "0"]))}`);
console.log(`  session --version       ${time(() => run("session", ["--version"]))}`);
for (const [label, tool, file] of [["allowed Edit src/a.ts", "Edit", "src/a.ts"], ["denied Write notes.txt", "Write", "notes.txt"]]) {
  console.log(`  ${label.padEnd(22)}  ${time(() => run("session", ["hook", "check"], payload(tool, file)))}`);
}
