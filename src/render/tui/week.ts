import { renderUi } from "./screen.js";
import { navigate } from "./state.js";

export const WEEK_WINDOWS = [7, 14, 30] as const;

/** Usage is a view preference; search, Help and Ctrl-U retain the browser's controls. */
export const navigateWeek: typeof navigate = (state, key, count, maxScroll) =>
  !state.searching && !state.help && !key.ctrl && key.name === "u"
    ? { ...state, usage: !state.usage, scroll: 0 }
    : navigate(state, key, count, maxScroll);

/** Week shares the browser's controls and detail rows, with separate source blocks. */
export const renderWeekUi: typeof renderUi = (data, state, columns, rows, palette, notice, theme, returnToHome) =>
  renderUi(data, state, columns, rows, palette, notice, theme, returnToHome, true);
