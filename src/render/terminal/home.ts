// `session` with no arguments: the checkout's current recorded state.
import type { Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import type { View } from "./cost.js";
import { formatIdleHome } from "./home-idle.js";
import { formatHomeTable } from "./home-table.js";
import { formatRecordingHome } from "./home-recording.js";

/** What the repo looks like right now, for the bare `session` screen. */
export interface Home {
  /** The session still running, when there is one. */
  running?: Session;
  /** The most recent session that has stopped, when there is one. */
  last?: Session;
}

/** A read-only view of the running, last finished, or empty state. */
export function formatHome(home: Home, palette: Palette = plainPalette, view: View = {}): string[] {
  if (view.width !== undefined) return formatHomeTable(home, palette, view);
  return home.running
    ? formatRecordingHome(home.running, palette, view.width)
    : formatIdleHome(home.last, palette, view);
}
