import { primeSeeds, type PrimeRequest } from "../prime.js";
import { plainPalette, type Palette } from "../render/palette.js";
import { navigatePrime, renderPrimeUi, type PrimeUiData } from "../render/tui/prime.js";
import { repoIdentity, repoName, type StoreOptions } from "../store.js";
import { debtHere, primeFor } from "./prime.js";
import { runUiBrowser, type UiBrowserAction, type UiBrowserData, type UiBrowserResult, type UiTerminal } from "./ui.js";

type PrimeBrowserData = PrimeUiData & UiBrowserData;
export interface PrimeUiResult extends UiBrowserResult { request: PrimeRequest }
const copyRequest = (request: PrimeRequest): PrimeRequest => ({ intent: request.intent,
  ...(request.seeds ? { seeds: [...request.seeds] } : {}) });

/** Preview uses the native read-only rule; opening the editor merely reads the repo name. */
export async function loadPrimeUi(request: PrimeRequest, options: StoreOptions = {}, preview = false): Promise<PrimeUiData> {
  const identity = await repoIdentity(options.cwd ?? process.cwd());
  const data: PrimeUiData = { repo: repoName(identity), request: copyRequest(request) };
  if (preview) {
    const [proposal, debt] = await Promise.all([primeFor(request, options), debtHere(options)]);
    data.preview = { proposal, debt };
  }
  return data;
}

function seedPaths(value: string): string[] {
  let paths: unknown;
  try { paths = JSON.parse(value); } catch { throw new Error('Use a list such as ["src/orders.ts"], or [] to clear named paths.'); }
  if (!Array.isArray(paths) || !paths.every(path => typeof path === "string")) {
    throw new Error('Use a list of path strings such as ["src/orders.ts"], or [] to clear named paths.');
  }
  return primeSeeds(paths);
}

/** Drafts are unsigned and local. No accept action or session writer is reachable here. */
export async function runPrimeUi(options: StoreOptions = {}, palette: Palette = plainPalette,
  terminal: UiTerminal = { input: process.stdin, output: process.stdout }, saved?: PrimeUiResult): Promise<PrimeUiResult> {
  let current: PrimeBrowserData = await loadPrimeUi(saved?.request ?? { intent: "" }, options);
  let closed = false;
  const refresh = async (): Promise<PrimeBrowserData> => {
    delete current.preview;
    const next = await loadPrimeUi(current.request, options, Boolean(current.request.intent.trim()));
    if (!closed) current = next;
    return next;
  };
  const actions: UiBrowserAction<PrimeBrowserData>[] = [
    { key: "g", label: "Goal", input: { label: "What do you want to change?", initial: () => current.request.intent },
      run: async (data, _state, value = "") => {
        data.request = { ...data.request, intent: value.trim() }; delete data.preview;
        return data.request.intent ? "Goal updated. p previews suggested files." : "Goal cleared. g sets a goal.";
      } },
    { key: "s", label: "Named paths", input: { label: 'Optional paths, for example ["src/orders.ts"]; [] clears', initial: () => JSON.stringify(current.request.seeds ?? []) },
      run: async (data, _state, value = "") => {
        const seeds = seedPaths(value);
        data.request = { ...data.request, seeds }; delete data.preview;
        return "Named paths updated. p recomputes the preview.";
      } },
    { key: "p", label: "Preview", run: async (data, _state, _value, signal) => {
      delete data.preview;
      if (!data.request.intent.trim()) throw new Error("g sets a goal before p previews suggested files.");
      const next = await loadPrimeUi(data.request, options, true);
      if (!signal?.aborted) { data.preview = next.preview; data.repo = next.repo; }
      return "Preview updated. No session started.";
    } },
  ];
  try {
    const result = await runUiBrowser(current, refresh, palette, terminal, { ...saved, returnToHome: true,
      render: renderPrimeUi, select: () => [], navigate: navigatePrime, actions,
      canReturnHome: state => !state.help, refreshNotice: "Recomputing from local history and tracked files…" });
    return { ...result, request: copyRequest(current.request) };
  } finally { closed = true; }
}
