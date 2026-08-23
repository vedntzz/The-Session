// The terminal views, one module per view under `terminal/`.
//
// This file is the seam the rest of the tool imports through: `show`, `week`,
// `scan`, the bare screen and `help all` are separate readers with separate
// layouts, and the only thing they share is the text helpers in `terminal/`.
export { intentOf, CAPTURED_MARKER } from "./terminal/intent.js";
export { describePaths, summarizePaths, PATHS_NAMED, type PathSummary } from "./terminal/paths.js";
export type { View } from "./terminal/cost.js";
export { formatSession } from "./terminal/session.js";
export { formatBrief } from "./terminal/brief.js";
export { formatHome, type Home } from "./terminal/home.js";
export { formatCommands, type CommandEntry } from "./terminal/commands.js";
export { formatWeek, describeFilter, stamp } from "./terminal/week.js";
export { formatScan } from "./terminal/scan.js";
