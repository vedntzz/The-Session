/**
 * Runs before every test file, in the worker that runs it: HOME, CODEX_HOME,
 * SESSION_HOME and XDG_CONFIG_HOME all point into one temporary directory.
 *
 * A default that reaches for the machine's own config — `~/.claude`,
 * `~/.codex`, `~/.session` — then reaches that directory instead, so a test
 * that forgets to pass a path writes somewhere nobody lives rather than into
 * the developer's editor settings. `os.homedir()` reads HOME, which is what
 * every one of those defaults goes through.
 *
 * Git reads its global config from HOME too, so the directory gets one: an
 * identity for the commits tests make, and nothing of the developer's.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const root = realpathSync(mkdtempSync(path.join(tmpdir(), "session-test-home-")));
const home = path.join(root, "home");
mkdirSync(home);
writeFileSync(
  path.join(home, ".gitconfig"),
  "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = master\n",
);

process.env["HOME"] = home;
process.env["CODEX_HOME"] = path.join(home, ".codex");
process.env["SESSION_HOME"] = path.join(home, ".session");
process.env["XDG_CONFIG_HOME"] = path.join(home, ".config");

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
