# QA backlog

Found during QA sweeps and left unfixed on purpose: each entry says what was seen, how to reproduce it, and where the cause appears to be. Nothing here is scheduled.

## A hook whose stdin is left open never exits

Found in sweep 2, item 2 (2026-10-03).

`session start --passive` and `session stop --if-open` write their record and then do not exit when stdin is a pipe that stays open and receives nothing. Closed-empty stdin is fine and exits at once (`test/hook-e2e.test.ts`). Claude Code writes the payload and closes, so it is not hit there; a runner that holds stdin open leaves the process alive until the host's timeout kills it (10s start, 30s stop). The stop's record and sweep are written before that, so nothing is lost; the process lingers.

Repro, in any repo with a commit:

```js
// node t.mjs start --passive   → "still running at 5s"
import { spawn } from "node:child_process";
const c = spawn(process.execPath, ["dist/cli.js", ...process.argv.slice(2)], { stdio: ["pipe", "inherit", "inherit"] });
c.on("exit", (code) => console.log("exit", code));
setTimeout(() => { console.log("still running at 5s"); c.kill(); }, 5000).unref();
```

Likely cause: `hookPayloadFrom` (`src/capture/adapters/hook-payload.ts`) stops waiting after `PAYLOAD_WAIT_MS` but leaves its `for await` over `process.stdin` pending; `pause()` does not release the handle. `src/program/hook.ts` already destroys stdin for the check's deadline for the same reason.
