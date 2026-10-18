import { hasDeclaredScope, type Session } from "../../store.js";
import type { Palette } from "../palette.js";
import type { View } from "./cost.js";
import { fieldTable, type TableField } from "./field-table.js";
import { homePrice } from "./home-idle.js";
import { sessionIntentFields } from "./home-recording.js";
import type { Home } from "./home.js";
import { startRows } from "./start-rows.js";
import { clock, INDENT, shortId } from "./text.js";

function runningFields(session: Session, palette: Palette): TableField[] {
  return [...sessionIntentFields(session, palette),
    { label: "scope", values: hasDeclaredScope(session) && session.scope.length ? session.scope : ["none declared"] },
    { label: "id", values: [shortId(session.id)] },
    { label: "since", values: [clock(session.startedAt)] },
  ];
}

function idleFields(last: Session | undefined, palette: Palette, view: View): TableField[] {
  if (!last) return [{ label: "state", values: ["No sessions recorded in this repo yet."] }];
  return [{ label: "state", values: ["Nothing is recording."] },
    ...sessionIntentFields(last, palette),
    { label: "last", values: [shortId(last.id)] },
    { label: "ended", values: [last.endedAt === null ? "unknown" : clock(last.endedAt)] },
    { label: "cost", values: [homePrice(last, view)], ink: palette.meta },
  ];
}

/** The same recorded facts and next commands, with terminal-only table decoration. */
export function formatHomeTable(home: Home, palette: Palette, view: View): string[] {
  const state = home.running ? "recording" : home.last ? "stopped" : "ready";
  const ink = home.running ? palette.recording : palette.meta;
  const fields = home.running ? runningFields(home.running, palette) : idleFields(home.last, palette, view);
  const next: readonly [string, string] = home.running ? ["session stop", "session week"]
    : home.last ? ["session week last", "session start"] : ["session start", "session hook install"];
  return [INDENT + ink(`◔ session  ${state}`), "", ...fieldTable(fields, palette, view.width), "",
    ...startRows("next", next[0], palette.meta, palette, view.width),
    ...startRows("", next[1], palette.meta, palette, view.width),
  ];
}
