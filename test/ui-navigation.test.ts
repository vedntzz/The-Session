import { describe, expect, it } from "vitest";
import {
  goBack, initialNavigation, navigationView, openScreen, updateNavigationView,
} from "../src/render/tui/navigation.js";

describe("UI section navigation", () => {
  it("starts at home with an empty presentation state", () => {
    const state = initialNavigation();
    expect(state.screen).toBe("home");
    expect(state.history).toEqual([]);
    expect(navigationView(state)).toEqual({ query: "", scroll: 0, filters: {} });
  });

  it("restores the selected session, search, filters and scroll after a PR preview", () => {
    const sessions = updateNavigationView(openScreen(initialNavigation(), "sessions"), {
      selectedSessionId: "session-a", query: "navigation", scroll: 7,
      filters: { outcome: "merged", source: "declared" },
    });
    const pr = updateNavigationView(openScreen(sessions, "pr"), {
      selectedSessionId: "session-b", scroll: 12,
    });
    const restored = goBack(pr);
    expect(restored.screen).toBe("sessions");
    expect(navigationView(restored)).toEqual(navigationView(sessions));
    expect(navigationView(restored, "pr").selectedSessionId).toBe("session-b");
  });

  it("reuses a section's saved view when reopened from home", () => {
    const sessions = updateNavigationView(openScreen(initialNavigation(), "sessions"), {
      selectedSessionId: "session-a", query: "outside:yes", scroll: 4,
    });
    const home = goBack(sessions);
    const week = updateNavigationView(openScreen(home, "week"), {
      query: "release", filters: { days: "14" },
    });
    const reopened = openScreen(goBack(week), "sessions");
    expect(navigationView(reopened)).toEqual(navigationView(sessions));
    expect(navigationView(reopened, "week").filters).toEqual({ days: "14" });
  });

  it("keeps filters in their own sections without interpreting or broadening them", () => {
    const sessions = updateNavigationView(openScreen(initialNavigation(), "sessions"), {
      filters: { outcome: "invalid" }, query: "outside:maybe",
    });
    const week = updateNavigationView(openScreen(sessions, "week"), {
      filters: { days: "7" },
    });
    expect(navigationView(week).query).toBe("");
    expect(navigationView(week, "sessions").filters).toEqual({ outcome: "invalid" });
    expect(navigationView(goBack(week)).query).toBe("outside:maybe");
  });

  it("restores each departure snapshot when a route occurs twice in the history", () => {
    const first = updateNavigationView(openScreen(initialNavigation(), "sessions"), {
      selectedSessionId: "session-a", query: "first", scroll: 2,
    });
    const pr = updateNavigationView(openScreen(first, "pr"), { scroll: 9 });
    const second = updateNavigationView(openScreen(pr, "sessions"), {
      selectedSessionId: "session-b", query: "second", scroll: 15,
    });
    const backToPr = goBack(second);
    expect(backToPr.screen).toBe("pr");
    expect(navigationView(backToPr).scroll).toBe(9);
    const backToFirst = goBack(backToPr);
    expect(navigationView(backToFirst)).toEqual(navigationView(first));
    expect(goBack(backToFirst).screen).toBe("home");
  });

  it("does not add history for the current section or go back past home", () => {
    const home = initialNavigation();
    expect(goBack(home)).toBe(home);
    expect(openScreen(home, "home")).toBe(home);
    const sessions = openScreen(home, "sessions");
    expect(openScreen(sessions, "sessions")).toBe(sessions);
    expect(sessions.history).toHaveLength(1);
    expect(goBack(goBack(sessions)).screen).toBe("home");
  });

  it("supports partial updates and explicitly clearing a selection and filters", () => {
    const original = updateNavigationView(openScreen(initialNavigation(), "sessions"), {
      selectedSessionId: "session-a", query: "release", scroll: 3,
      filters: { outcome: "merged" },
    });
    const scrolled = updateNavigationView(original, { scroll: 8 });
    expect(navigationView(scrolled)).toEqual({ ...navigationView(original), scroll: 8 });
    const cleared = updateNavigationView(scrolled, { selectedSessionId: undefined, filters: {} });
    expect(navigationView(cleared)).toEqual({
      selectedSessionId: undefined, query: "release", scroll: 8, filters: {},
    });
    expect(navigationView(original).selectedSessionId).toBe("session-a");
  });

  it("does not retain mutable filter input or alter earlier navigation states", () => {
    const filters = { outcome: "merged" };
    const sessions = updateNavigationView(openScreen(initialNavigation(), "sessions"), {
      selectedSessionId: "session-a", filters,
    });
    const pr = openScreen(sessions, "pr");
    filters.outcome = "abandoned";
    const changed = updateNavigationView(goBack(pr), { filters: { source: "captured" } });
    expect(navigationView(changed).filters).toEqual({ source: "captured" });
    expect(navigationView(sessions).filters).toEqual({ outcome: "merged" });
    expect(pr.history.at(-1)?.view.filters).toEqual({ outcome: "merged" });
    expect(navigationView(goBack(pr)).filters).toEqual({ outcome: "merged" });
    expect(sessions.history).toHaveLength(1);
    expect(pr.history).toHaveLength(2);
  });
});
