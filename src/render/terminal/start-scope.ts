import { plainPalette, type Palette } from "../palette.js";

/** Scope is optional; the blank line separates it from the accepted intent. */
export function formatScopePrompt(palette: Palette = plainPalette): string[] {
  return [
    "",
    "  " + palette.intent("Scope (optional)"),
    "  Which files?",
    "  " + palette.meta("One file or folder prefix per line."),
    "  " + palette.meta("Empty line to finish or skip."),
    "  " + palette.meta("Enter to add · Ctrl-C to cancel"),
    "",
    "  › ",
  ];
}
