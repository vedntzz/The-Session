import { renderScanHtml, renderScanMarkdown } from "../render/scan-report.js";
import { scanQuery, visibleScanned, type ScanUiData } from "../render/tui/scan.js";
import type { UiState } from "../render/tui/state.js";
import type { UiBrowserAction } from "./ui.js";
import { copyToClipboard, openInBrowser, writeWeekPage, type WeekOptions } from "./week.js";

function report(data: ScanUiData, state: UiState) {
  if (scanQuery(state.query).error) throw new Error("Fix the search or clear filters with Esc before exporting.");
  const selection = [`Local Claude Code transcripts: ${data.root}`,
    ...(data.restriction ? [`Reader limited to directory: ${data.restriction}`] : []),
    state.query.trim() ? `Search: ${state.query.trim()}` : "All loaded tool sessions",
    `Usage details: ${state.usage ? "shown" : "hidden"}`].join(" · ");
  return { sessions: visibleScanned(data, state), selection };
}

/** Actions export the loaded matching transcripts; no second read and no signed-record writes. */
export function scanExportActions(options: WeekOptions = {}): readonly UiBrowserAction<ScanUiData>[] {
  return [
    { key: "c", label: "Copy Markdown", async run(data, state, _value, signal) {
      const { sessions, selection } = report(data, state);
      const text = renderScanMarkdown(sessions, data.days, data.rates, selection, state.usage, data.checked);
      signal?.throwIfAborted();
      await copyToClipboard(text, options);
      return `Copied Markdown · ${sessions.length} matching tool sessions · last ${data.days} days.`;
    } },
    { key: "h", label: "Open HTML", async run(data, state, _value, signal) {
      const { sessions, selection } = report(data, state);
      const html = renderScanHtml(sessions, data.days, data.rates, selection, state.usage, data.checked);
      signal?.throwIfAborted();
      const file = await writeWeekPage(html, options, "scan");
      signal?.throwIfAborted();
      try { await openInBrowser(file, options); }
      catch { throw new Error(`HTML saved. Open ${file} yourself.`); }
      return `Opened HTML · ${sessions.length} matching tool sessions · last ${data.days} days.`;
    } },
  ];
}
