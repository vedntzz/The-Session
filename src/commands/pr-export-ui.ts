import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prUiDocument, type PrUiTemplate } from "../render/tui/pr.js";
import type { UiData } from "../render/tui/screen.js";
import { visibleSessions, type UiState } from "../render/tui/state.js";
import { shortId } from "../render/terminal/text.js";
import type { UiBrowserAction } from "./ui.js";
import { copyToClipboard, type WeekOptions } from "./week.js";

function selectedDocument(data: UiData, state: UiState, template?: PrUiTemplate) {
  const selected = visibleSessions(data.sessions, state)[state.selected];
  if (!selected) throw new Error("Select a matching session before copying or saving.");
  return { id: shortId(selected.id), body: prUiDocument(selected, data.rates, template) };
}

/** Export the loaded record and accepted template snapshot, without rereading either. */
export function prExportActions(template: () => PrUiTemplate | undefined, options: WeekOptions = {}): readonly UiBrowserAction[] {
  return [
    { key: "c", label: "Copy Markdown", async run(data, state, _value, signal) {
      const { id, body } = selectedDocument(data, state, template());
      signal?.throwIfAborted();
      await copyToClipboard(body, options);
      return `Copied PR description · session ${id}.`;
    } },
    { key: "f", label: "Save Markdown", input: { label: "Markdown file path (new file)", initial: () => "session-pr.md" },
      async run(data, state, value = "", signal) {
        const { id, body } = selectedDocument(data, state, template());
        const file = value.trim();
        if (!file) throw new Error("Enter a Markdown file path, or Esc to cancel.");
        const destination = resolve(options.cwd ?? process.cwd(), file);
        signal?.throwIfAborted();
        try { await writeFile(destination, `${body}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); }
        catch (error) {
          throw new Error(saveProblem(file, error as NodeJS.ErrnoException), { cause: error });
        }
        return `Saved PR description · session ${id} · ${destination}`;
      },
    },
  ];
}

function saveProblem(file: string, error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case "EEXIST": return `${file} already exists; choose another filename. Existing files are kept.`;
    case "ENOENT": return `${file} has no parent directory; choose an existing directory.`;
    case "EACCES":
    case "EPERM": return `${file} cannot be written; choose a directory you can write to.`;
    default: return `${file} could not be saved: ${error.message}. Choose another path and retry.`;
  }
}
