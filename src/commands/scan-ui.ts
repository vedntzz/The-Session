import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { repoRoot } from "../git.js";
import { loadRates } from "../pricing.js";
import type { ScanUiData } from "../render/tui/scan.js";
import { repoIdentity, repoName, storeHome, type StoreOptions } from "../store.js";
import { parseScanDays, scanSessions, transcriptsExist, type ScanOptions } from "./scan.js";

/** Native transcript rows remain separate from signed Session records. Nothing is written. */
export async function loadScanUi(days: number, options: StoreOptions & ScanOptions = {}): Promise<ScanUiData> {
  parseScanDays(String(days));
  const cwd = resolve(options.cwd ?? process.cwd());
  const [rates, identity, checkout, present] = await Promise.all([
    loadRates(storeHome(options)), repoIdentity(cwd),
    repoRoot(cwd).catch(() => realpath(cwd).catch(() => cwd)), transcriptsExist(options),
  ]);
  const { sessions, root } = await scanSessions(days, rates, options);
  return { sessions: [...sessions].reverse(), rates, days, repo: repoName(identity), root, present,
    currentRepos: [...new Set([cwd, checkout])], restriction: options.repo };
}
