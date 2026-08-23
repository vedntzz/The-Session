import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./git.js";

/**
 * Who the work was for.
 *
 * This is the one file `session` reads that belongs to the repo rather than to
 * the developer: `.session.json` sits at the repo root and is checked in, so a
 * team bills the same client by the same name without four people typing it
 * four ways. The developer's own settings stay under `~/.session`, which is
 * where anything machine-specific belongs.
 *
 * Every field is optional. A repo that declares none is the ordinary case.
 */
export interface Attribution {
  /** Who is being billed. */
  client?: string;
  /** What the work is part of, where that is not the repo itself. */
  project?: string;
  /** The statement of work it falls under. */
  sow?: string;
  /** Whatever code the invoice needs. */
  billingCode?: string;
}

/** The fields `session config set` will write, and the order it prints them. */
export const ATTRIBUTION_KEYS = ["client", "project", "sow", "billingCode"] as const;

export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];

/** The file, at the repo root. Checked in on purpose. */
export const CONFIG_FILE = ".session.json";

export function isAttributionKey(key: string): key is AttributionKey {
  return (ATTRIBUTION_KEYS as readonly string[]).includes(key);
}

/** True when anything at all is declared. */
export function hasAttribution(attribution: Attribution = {}): boolean {
  return ATTRIBUTION_KEYS.some((key) => attribution[key] !== undefined);
}

/** The values that are set, in the fixed key order, for a one-line summary. */
export function attributionValues(attribution: Attribution = {}): string[] {
  return ATTRIBUTION_KEYS.map((key) => attribution[key]).filter(
    (value): value is string => value !== undefined,
  );
}

/** The pairs that are set, in the fixed key order, for a labelled listing. */
export function attributionEntries(attribution: Attribution = {}): [AttributionKey, string][] {
  return ATTRIBUTION_KEYS.flatMap((key) => {
    const value = attribution[key];
    return value === undefined ? [] : [[key, value] as [AttributionKey, string]];
  });
}

/** Where the config lives for the repo `cwd` is inside. */
export async function configFile(cwd: string = process.cwd()): Promise<string> {
  return path.join(await repoRoot(cwd), CONFIG_FILE);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the file whole, so that keys this version does not know about survive
 * a write. The file is checked in and shared: a teammate on a later version
 * may have set something this one has never heard of, and dropping it on the
 * next `config set` would start a fight in the diff.
 */
async function readRaw(file: string): Promise<Record<string, unknown>> {
  const text = await readText(file);
  return text.trim() === "" ? {} : parseObject(text, file);
}

/** The file's text, or empty where a repo has never declared attribution. */
async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

/** Both failures name the file and what to do, since a human wrote it by hand. */
function parseObject(text: string, file: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${file} is not valid JSON. Fix it by hand, then run session config set again.`,
      { cause: error },
    );
  }
  if (!isObject(parsed)) {
    throw new Error(`${file} must hold a JSON object, like {"client": "Acme"}.`);
  }
  return parsed;
}

/**
 * The attribution this repo declares, or an empty one.
 *
 * Unknown keys are ignored rather than rejected: the file is shared, and a
 * newer `session` writing a field this one does not know is not an error. A
 * *known* key holding something that is not a string is an error — it would
 * otherwise land in the record as whatever it happened to be.
 */
export async function readConfig(cwd: string = process.cwd()): Promise<Attribution> {
  const file = await configFile(cwd);
  const raw = await readRaw(file);
  const attribution: Attribution = {};

  for (const key of ATTRIBUTION_KEYS) {
    const value = raw[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== "string") {
      throw new Error(
        `${file}: ${key} must be a string, got ${Array.isArray(value) ? "an array" : typeof value}.`,
      );
    }
    const trimmed = value.trim();
    if (trimmed !== "") {
      attribution[key] = trimmed;
    }
  }
  return attribution;
}

/**
 * Sets one field, leaving the rest of the file — including keys this version
 * does not recognise — exactly as it was. An empty value removes the field,
 * which is the only way to unset one and needs no second verb to do it.
 *
 * Written with a trailing newline and two-space indent because this file goes
 * into git, and a diff nobody can read is a diff nobody reviews.
 */
export async function setConfigValue(
  key: AttributionKey,
  value: string,
  cwd: string = process.cwd(),
): Promise<{ file: string; attribution: Attribution; removed: boolean }> {
  const file = await configFile(cwd);
  const raw = await readRaw(file);

  const trimmed = value.trim();
  const removed = trimmed === "";
  if (removed) {
    delete raw[key];
  } else {
    raw[key] = trimmed;
  }

  await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  return { file, attribution: await readConfig(cwd), removed };
}
