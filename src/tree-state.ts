// What changed between two looks at a working tree. Pure: the looks are taken
// by treeStateSince in git/blobs.ts, against the session's start commit.

/** Path → blob id (`null`: not a regular file). Absent: as at the start commit. */
export type TreeState = Readonly<Record<string, string | null>>;

/**
 * The paths whose state differs between `before` and `after`, sorted. A path
 * in only one of them moved between "as at the start commit" and something
 * else — edited, created, deleted, or put back — and each of those is a
 * change. Both states must be taken against the same start commit; comparing
 * looks against two different bases would call every difference between the
 * bases a change.
 */
export function treeStateChanges(before: TreeState, after: TreeState): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths]
    .filter((path) => stateOf(before, path) !== stateOf(after, path))
    .sort();
}

/** `undefined` is "as at the start commit", distinct from `null`, "not a file". */
function stateOf(state: TreeState, path: string): string | null | undefined {
  return Object.hasOwn(state, path) ? state[path] : undefined;
}
