import { fillTemplate, prParts } from "../render/pr.js";
import { renderPrUi, type PrUiTemplate } from "../render/tui/pr.js";
import { visibleSessions } from "../render/tui/state.js";
import type { StoreOptions } from "../store.js";
import { readTemplate } from "./pr.js";
import type { UiBrowserOptions } from "./ui.js";

/** An accepted, validated file snapshot, kept only for this workspace visit. */
export function prTemplateUi(options: StoreOptions = {}): Pick<UiBrowserOptions, "render" | "actions"> {
  let template: PrUiTemplate | undefined;
  return {
    render: (data, state, columns, rows, palette, notice, theme) =>
      renderPrUi({ ...data, template }, state, columns, rows, palette, notice, theme),
    actions: [{
      key: "t", label: "Load template",
      input: { label: "Template path (blank = default)", initial: () => template?.path ?? "" },
      async run(data, state, value = "", signal) {
        const file = value.trim();
        if (!file) {
          signal?.throwIfAborted(); template = undefined;
          return "Default format selected. Enter previews; t chooses a template.";
        }
        const selected = visibleSessions(data.sessions, state)[state.selected];
        if (!selected) throw new Error("Select a matching session before loading a template.");
        const source = await readTemplate(file, options.cwd);
        fillTemplate(source, prParts(selected, data.rates), file);
        signal?.throwIfAborted();
        template = { path: file, source };
        return `Template loaded: ${file}. Enter previews; t changes it. Refresh keeps this file snapshot.`;
      },
    }],
  };
}
