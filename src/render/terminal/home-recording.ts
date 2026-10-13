import { hasDeclaredScope, inOwnWords, type Session } from "../../store.js";
import { plainPalette, type Palette } from "../palette.js";
import { headOf } from "./intent.js";
import { startRows } from "./start-rows.js";
import { clock, INDENT, shortId } from "./text.js";

/** The declaration or captured prompt currently being recorded. */
export function formatRecordingHome(
  running: Session, palette: Palette = plainPalette, width?: number,
): string[] {
  const row = (name: string, value: string, ink: (text: string) => string): string[] =>
    startRows(name, value, ink, palette, width);
  const scope = hasDeclaredScope(running) ? running.scope : [];
  return [
    `${INDENT}${palette.recording("◔ session  recording")}`,
    "",
    ...sessionIntentRows(running, palette, width),
    ...(scope.length > 0
      ? scope.flatMap((path, index) => startRows(index === 0 ? "scope" : "", path, palette.path, palette, width, 2))
      : row("scope", "none declared", palette.meta)),
    ...row("id", shortId(running.id), palette.meta),
    ...row("since", clock(running.startedAt), palette.meta),
    "",
    ...row("next", "session stop", palette.meta),
    ...row("", "session week", palette.meta),
  ];
}

/** Captured text keeps its first-line boundary until the shared row sanitizes it. */
export function sessionIntentRows(session: Session, palette: Palette, width?: number): string[] {
  const own = inOwnWords(session);
  const value = session.intent === null ? "unknown" : own ? session.intent : capturedPrompt(session.intent);
  const reason = session.intentMissing === "paste-only" ? "the first prompt was pasted text, not captured"
    : session.endedAt === null ? "no intent recorded yet" : "no intent recorded";
  return [
    ...startRows(own ? "intent" : "prompt", value, palette.intent, palette, width),
    ...(session.intent === null ? startRows("", reason, palette.meta, palette, width) : []),
  ];
}

function capturedPrompt(intent: string): string {
  const { head, cut } = headOf(intent);
  return `${head}${cut ? " …" : ""}`;
}
