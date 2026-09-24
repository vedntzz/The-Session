// The write-check event can record every answer the check gives, and no grant.
// The `@ts-expect-error` lines are checked by `npm run typecheck`.
import { describe, expect, it } from "vitest";
import type { WriteCheckDecision, WriteCheckEvent } from "../src/write-check-event.js";

describe("write-check event", () => {
  it("holds ask, deny, silent and not-checked", () => {
    const decisions: WriteCheckDecision[] = ["ask", "deny", "silent", "not-checked"];
    const events: WriteCheckEvent[] = decisions.map((decision, n) => ({
      type: "write-check", n, tool: "Edit", path: "src/a.ts", decision, reason: "outside-paths", agent: "claude-code",
    }));
    expect(events.map((event) => event.decision)).toEqual(decisions);
  });

  it("has no allow and no host defer", () => {
    // @ts-expect-error the check never grants (invariant 6)
    const allow: WriteCheckDecision = "allow";
    // @ts-expect-error the host's defer is translated to silence
    const defer: WriteCheckDecision = "defer";
    expect([allow, defer]).toHaveLength(2);
  });
});
