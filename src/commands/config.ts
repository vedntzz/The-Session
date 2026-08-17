import {
  ATTRIBUTION_KEYS,
  attributionEntries,
  configFile,
  hasAttribution,
  isAttributionKey,
  readConfig,
  setConfigValue,
  type Attribution,
} from "../config.js";
import { isRepo } from "../git.js";

/** What a `session config` command did, in the words it prints. */
export interface ConfigResult {
  /** The `.session.json` that was read, and written if anything changed. */
  file: string;
  attribution: Attribution;
  /** Absent for `show`. */
  changed?: { key: string; value: string; removed: boolean };
}

async function repoOrRefuse(cwd: string): Promise<void> {
  if (!(await isRepo(cwd))) {
    throw new Error(
      `Not a git repository: ${cwd}. Attribution belongs to a repo, in a file the ` +
        `team checks in — run session config from inside one.`,
    );
  }
}

/**
 * Sets one attribution field.
 *
 * The key is checked against the four rather than written through: this file
 * is read by every `session start` in the repo, and a mistyped key that landed
 * silently would look exactly like a field nobody had set.
 */
export async function setConfig(
  key: string,
  value: string,
  cwd: string = process.cwd(),
): Promise<ConfigResult> {
  await repoOrRefuse(cwd);

  if (!isAttributionKey(key)) {
    throw new Error(
      `${key} is not something a session records. Use one of: ${ATTRIBUTION_KEYS.join(", ")}.`,
    );
  }

  const { file, attribution, removed } = await setConfigValue(key, value, cwd);
  return { file, attribution, changed: { key, value: value.trim(), removed } };
}

/** What the repo declares, without writing anything. */
export async function showConfig(cwd: string = process.cwd()): Promise<ConfigResult> {
  await repoOrRefuse(cwd);
  return { file: await configFile(cwd), attribution: await readConfig(cwd) };
}

/**
 * What the command prints: what the file says now, and — after a `set` — the
 * one line that changed. Sessions already recorded are not revisited, so it is
 * worth being plain that this takes effect from the next `session start`.
 */
export function formatConfig(result: ConfigResult): string[] {
  const lines: string[] = [line(result.changed ? (result.changed.removed ? "cleared" : "wrote") : "file", result.file)];

  for (const [key, value] of attributionEntries(result.attribution)) {
    lines.push(line(key, value));
  }

  if (!hasAttribution(result.attribution)) {
    lines.push(line("none", "no attribution declared"));
  } else if (result.changed) {
    lines.push(line("applies", "from the next session start; sessions already recorded keep theirs"));
  }

  return lines;
}

/** Wide enough for `billingCode`, which is the longest thing this prints. */
const LABEL_WIDTH = 13;

function line(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}`;
}
