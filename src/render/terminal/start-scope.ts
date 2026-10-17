import { plainPalette, type Palette } from "../palette.js";
import { formatStartForm } from "./start-form.js";

/** Scope is optional; the blank line separates it from the accepted intent. */
export function formatScopePrompt(palette: Palette = plainPalette, width?: number, intent?: string): string[] {
  return [
    "",
    ...formatStartForm({ intent }, palette, width),
    ...(width === undefined ? [] : [""]),
    "  " + palette.intent("Scope (optional)"),
    "  Which files?",
    "  " + palette.meta("One file or folder prefix per line."),
    "  " + palette.meta("Empty line to finish or skip."),
    "  " + palette.meta("Enter to add · Ctrl-C to cancel"),
    "",
    "  › ",
  ];
}
