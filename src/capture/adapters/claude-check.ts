// Claude Code's payloads for the write check: Edit, Write and MultiEdit, then Bash.
import type { CheckAdapter } from "../check-adapter.js";
import { parseClaudeBash } from "./claude-bash.js";
import { CLAUDE_CODE } from "./claude-name.js";
import { parseClaudeWrite } from "./claude-write.js";

export const claudeCheckAdapter: CheckAdapter = {
  name: CLAUDE_CODE,
  parse(payload) {
    const file = parseClaudeWrite(payload);
    return file.kind === "unsupported" ? parseClaudeBash(payload) : file;
  },
};
