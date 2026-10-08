import { loadRates } from "../pricing.js";
import type { DebtUiData } from "../render/tui/debt.js";
import { repoIdentity, repoName, storeHome, type StoreOptions } from "../store.js";
import { debtReport } from "./debt.js";
import type { UiBrowserData } from "./ui.js";

/** Every local log, through the native identity merge and debt rule. Browsing writes nothing. */
export async function loadDebtUi(options: StoreOptions = {}): Promise<DebtUiData & UiBrowserData> {
  const [report, here] = await Promise.all([
    loadRates(storeHome(options)).then(rates => debtReport(rates, options)),
    repoIdentity(options.cwd ?? process.cwd()),
  ]);
  return { repos: report.repos, here, repo: repoName(here) };
}
