import { plainPalette, type Palette } from "../palette.js";
import { formatStartForm } from "./start-form.js";

/** The declaration step, before a session has been recorded. */
export function formatIntentPrompt(palette: Palette = plainPalette, width?: number, scope?: readonly string[]): string[] {
  return [
    ...formatStartForm({ scope }, palette, width),
    ...(width === undefined ? [] : [""]),
    `  ${palette.intent("Intent")}`,
    "  What are you working on?",
    `  ${palette.meta("Describe the change you want to make.")}`,
    `  ${palette.meta("Enter to continue · Ctrl-C to cancel")}`,
    "",
    "  › ",
  ];
}
