import { renderUi } from "./screen.js";

export const WEEK_WINDOWS = [7, 14, 30] as const;

/** Week shares the browser's controls and detail rows, with separate source blocks. */
export const renderWeekUi: typeof renderUi = (data, state, columns, rows, palette, notice, theme, returnToHome) =>
  renderUi(data, state, columns, rows, palette, notice, theme, returnToHome, true);
