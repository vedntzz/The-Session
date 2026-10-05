export type UiScreen =
  | "home" | "start" | "sessions" | "week" | "pr" | "scan" | "agents"
  | "prime" | "debt" | "agreement" | "outcomes" | "survival" | "knowledge"
  | "hooks" | "peers" | "sync" | "verify" | "key" | "attribution" | "help";

export interface UiViewState {
  readonly selectedSessionId?: string;
  readonly query: string;
  readonly scroll: number;
  readonly filters: Readonly<Record<string, string>>;
}

interface NavigationFrame {
  readonly screen: UiScreen;
  readonly view: UiViewState;
}

export interface UiNavigation {
  readonly screen: UiScreen;
  readonly views: Readonly<Partial<Record<UiScreen, UiViewState>>>;
  readonly history: readonly NavigationFrame[];
}

export function initialNavigation(): UiNavigation {
  return { screen: "home", views: {}, history: [] };
}

export function navigationView(state: UiNavigation, screen = state.screen): UiViewState {
  return state.views[screen] ?? { query: "", scroll: 0, filters: {} };
}

function snapshot(view: UiViewState): UiViewState {
  return { ...view, filters: { ...view.filters } };
}

/** Updates presentation state only; filters retain their screen's own validation rules. */
export function updateNavigationView(state: UiNavigation, patch: Partial<UiViewState>): UiNavigation {
  const view = snapshot({ ...navigationView(state), ...patch });
  return { ...state, views: { ...state.views, [state.screen]: view } };
}

/** Opening a section reuses its last view; Back remembers the exact departure view. */
export function openScreen(state: UiNavigation, screen: UiScreen): UiNavigation {
  if (screen === state.screen) return state;
  return {
    ...state,
    screen,
    history: [...state.history, { screen: state.screen, view: snapshot(navigationView(state)) }],
  };
}

export function goBack(state: UiNavigation): UiNavigation {
  const previous = state.history.at(-1);
  if (!previous) return state;
  return {
    screen: previous.screen,
    views: { ...state.views, [previous.screen]: snapshot(previous.view) },
    history: state.history.slice(0, -1),
  };
}
