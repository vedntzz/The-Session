// Types for `extracts.mjs`, which is plain ESM so the generator can run it
// with no build step. Hand-written because `allowJs` is off and this is the
// one place a test reaches outside `src`.

/** Repository root, absolute. */
type Root = string;

export declare const invariants: (root: Root) => string;
export declare const layout: (root: Root) => string;
export declare const sessionInterface: (root: Root) => string;
export declare const whatOneZeroMeans: (root: Root) => string;
export declare const measurementRules: (root: Root) => string;

export declare const extracts: Readonly<Record<string, (root: Root) => string>>;
