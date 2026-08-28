// What a declared scope covers. Pure: two strings in, a yes or no out.
//
// One implementation, because two would be a way for `stop` and `debt` to
// disagree about whether a file was declared — `stop` would record a path as
// drift and `debt` would then fail to see the later declaration that cleared
// it, or clear one nobody made. The rule is small enough to inline and that is
// exactly why it would drift.

/** Strips the `./` prefix and trailing slashes so entries compare uniformly. */
export function normalizeEntry(entry: string): string {
  return entry.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * True when `path` falls under `entry`. Scope entries are path prefixes that
 * stop at directory boundaries, so `api/middleware/` covers
 * `api/middleware/rate_limit.py` but `api/order` never covers `api/orders.py`.
 */
export function covers(entry: string, path: string): boolean {
  const prefix = normalizeEntry(entry);
  if (prefix === "" || prefix === ".") {
    return true; // the whole repo was declared
  }
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** True when any entry of a declared scope covers the path. */
export function inScope(scope: readonly string[], path: string): boolean {
  return scope.some((entry) => covers(entry, path));
}
