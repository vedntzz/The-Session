// Write checks and tool calls number from one counter per session.
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { checkWrite } from "../src/commands/check-write.js";
import { afterToolCall, beforeToolCall } from "../src/commands/tool-call.js";
import { runGit } from "../src/git.js";
import { appendSession, readLog } from "../src/store.js";

let temp: string;
let cwd: string;
let home: string;
beforeEach(async () => {
  temp = await realpath(await mkdtemp(path.join(tmpdir(), "session-shared-counter-")));
  cwd = path.join(temp, "repo");
  home = path.join(temp, "store");
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await runGit(cwd, ["init", "-q"]);
  await writeFile(path.join(cwd, "src/a.ts"), "unchanged");
});
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });

async function* input(payload: string) { yield payload; }
const check = () => checkWrite({ cwd, home, stdin: input(JSON.stringify({
  hook_event_name: "PreToolUse", tool_name: "Write", cwd, tool_input: { file_path: "src/a.ts", content: "x" },
})) });

it("numbers write checks and tool calls from one counter", async () => {
  await appendSession({ intent: "work", startedAt: "2026-09-24T09:00:00Z", startCommit: "abc" }, { cwd, home });
  await check();
  const started = await beforeToolCall({ callId: "call-1", tool: "Edit" }, { cwd, home }, { snapshot: async () => ({}) });
  expect(started?.n).toBe(2);
  await check();
  const unpaired = await afterToolCall({ callId: "call-2", tool: "Edit" }, { cwd, home });
  expect(unpaired).toMatchObject({ unpaired: true, n: 4 });
  const log = await readLog({ cwd, home });
  const checks = log.lines.map((line) => JSON.parse(line.text).set.writeCheck).filter(Boolean);
  expect(checks.map((event: { n: number }) => event.n)).toEqual([1, 3]);
});
