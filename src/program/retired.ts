/**
 * Commands cut at the v1 boundary, and where their work went. Answered before
 * any guess: `show` is two edits from `stop`, and a reader with the old habit
 * offered `session stop` would end a session they meant to look at.
 */
export const RETIRED: Readonly<Record<string, string>> = {
  ui: "use session week, or session week <id> --full for full evidence.",
  show: "use week <id>. session week last is the most recent closed session.",
  debt: "use prime --debt.",
  estimate: "removed; see week.",
};
