import type { Session } from "./store.js";

/**
 * What a session was mostly working on, read off the paths it changed.
 *
 * A coarse label, deliberately: the useful question at the end of a week is
 * "where did the money go — schema work, UI, tests?", and eight buckets answer
 * it. Anything finer would need to know what the code means, and knowing what
 * code means is exactly what this tool does not do.
 *
 * The rules are the table below and nothing else. They are path patterns, in
 * order, first match wins — so a class can be checked by reading one line, and
 * a repo whose layout is not in the table can be fixed by adding one. That is
 * why the table is at the top of the file rather than spread through it.
 */

/** Every class there is. The order here is the one the CLI lists them in. */
export const SESSION_CLASSES = [
  "schema",
  "api",
  "ui",
  "test",
  "config",
  "docs",
  "build",
  "other",
] as const;

export type SessionClass = (typeof SESSION_CLASSES)[number];

/** One line of the table: a class, what a path has to look like, and a case in point. */
export interface ClassRule {
  class: SessionClass;
  /** Tested against the lowercased path — `Dockerfile` needs no special case. */
  match: RegExp;
  /** A path this rule is here for. Asserted in the tests, so it cannot go stale. */
  example: string;
}

/**
 * The rules, in order. The first one that matches a path decides it; a path
 * that matches none is `other`. The order also breaks ties between classes
 * when a session's paths are split evenly — see `classifyPaths`.
 *
 * Order is the whole design, and it goes from the most telling signal to the
 * least. Tests first: a test about the schema is a test. Build next, so a
 * workflow file is not read as settings. Then docs, because writing about the
 * API is not the API. Then the three that say what the code is. Config last of
 * the named classes, because `.json` and `.yaml` are what everything else is
 * written in, and a rule that greedy has to go where it can do least harm.
 */
export const CLASS_RULES: readonly ClassRule[] = [
  // class            a path counts as this when it looks like                                    e.g.
  { class: "test",   match: /(^|\/)(tests?|__tests__|specs?|e2e|fixtures?)\//,                     example: "test/store.test.ts" },
  // The lookahead keeps `tsconfig.test.json` out: a `.test.` in the middle of a
  // data file is naming which config it is, not naming a test.
  { class: "test",   match: /[._](test|spec)\.(?!json|ya?ml|toml)[a-z0-9]+$|(^|\/)test_[^/]+\.py$/, example: "src/store_test.go" },

  { class: "build",  match: /(^|\/)(\.github|\.circleci|ci|scripts|infra|deploy|terraform|k8s|helm)\//, example: ".github/workflows/ci.yml" },
  { class: "build",  match: /(^|\/)(dockerfile|makefile|docker-compose\.ya?ml|\.gitlab-ci\.yml)$/,      example: "Dockerfile" },
  { class: "build",  match: /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|go\.(mod|sum)|cargo\.(toml|lock)|pyproject\.toml|requirements\.txt|tsconfig[a-z.-]*\.json)$/, example: "package.json" },

  { class: "docs",   match: /(^|\/)docs?\//,                                                       example: "docs/pricing.md" },
  { class: "docs",   match: /\.(md|mdx|rst|adoc|txt)$|(^|\/)(readme|changelog|license|contributing)[^/]*$/, example: "README.md" },

  { class: "schema", match: /(^|\/)(migrations?|migrate|schemas?|db|database|models?)\//,           example: "db/migrate/006_orders.rb" },
  { class: "schema", match: /\.(sql|prisma|graphql|gql)$|(^|\/)schema\.[a-z]+$/,                    example: "api/schema.sql" },

  { class: "api",    match: /(^|\/)(apis?|routes?|controllers?|handlers?|endpoints?|resolvers?|middleware|server|services?)\//, example: "src/api/orders.ts" },
  { class: "api",    match: /\.proto$|(^|\/)(openapi|swagger)[^/]*\.(ya?ml|json)$/,                 example: "openapi.yaml" },

  { class: "ui",     match: /(^|\/)(components?|ui|views?|pages|screens|styles|assets|public|static)\//, example: "src/components/Button.tsx" },
  { class: "ui",     match: /\.(css|scss|sass|less|html|svg|vue|svelte|jsx|tsx)$/,                  example: "src/Button.tsx" },

  { class: "config", match: /(^|\/)configs?\//,                                                    example: "config/rates.yml" },
  { class: "config", match: /\.(json|ya?ml|toml|ini|cfg|conf|env|properties)$/,                     example: "rates.json" },
  { class: "config", match: /(^|\/)\.[^/]+$/,                                                      example: ".gitignore" },
];

/** What a path is called when no rule claims it. Not a rule: it matches nothing. */
const UNMATCHED: SessionClass = "other";

/**
 * Which class a single path belongs to.
 *
 * Lowercased first, because the table would otherwise need `Dockerfile`,
 * `dockerfile` and `DOCKERFILE`, and a table nobody can read in ten seconds is
 * not the table this file is for. Leading `./` goes too, so paths compare the
 * way `scope` entries do.
 */
export function classOfPath(file: string): SessionClass {
  const path = file.trim().replace(/^\.\//, "").toLowerCase();
  if (path === "") {
    return UNMATCHED;
  }
  return CLASS_RULES.find((rule) => rule.match.test(path))?.class ?? UNMATCHED;
}

/** Table order, for breaking a tie the same way every time. */
function rankOf(value: SessionClass): number {
  const rank = CLASS_RULES.findIndex((rule) => rule.class === value);
  // `other` is in no rule, so it sorts after every class that is.
  return rank === -1 ? CLASS_RULES.length : rank;
}

/**
 * The class of a set of paths: whichever one the most of them belong to, ties
 * broken by the order of the table.
 *
 * `other` competes on the same terms as the rest and can win. That is the
 * honest answer for a session that mostly touched files no rule recognises —
 * calling it `ui` because one stylesheet was in there would be a label made up
 * to avoid admitting a gap. The fix for a repo that keeps landing in `other`
 * is a line in the table, not a thumb on the scale here.
 *
 * No paths at all is `other` too: a session that changed nothing left nothing
 * to read.
 */
export function classifyPaths(paths: readonly string[]): SessionClass {
  const counts = new Map<SessionClass, number>();
  for (const path of paths) {
    const value = classOfPath(path);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let winner: SessionClass = UNMATCHED;
  let best = 0;
  for (const [value, count] of counts) {
    if (count > best || (count === best && rankOf(value) < rankOf(winner))) {
      winner = value;
      best = count;
    }
  }
  return winner;
}

/**
 * A session's class: what `stop` recorded, or what its paths say when it was
 * stopped before this existed.
 *
 * Deriving it for an old record is not the same as inferring a fact nobody
 * measured — `reality` is on the record, and the rules are a pure function of
 * it, so the answer here is the answer `stop` would have written. The field is
 * stored anyway so that the log says what it means without this file.
 */
export function classOf(session: Session): SessionClass {
  return session.class ?? classifyPaths(session.reality);
}

/** Reads a class off the command line, naming the alternatives when it is not one. */
export function parseClass(value: string): SessionClass {
  const wanted = value.trim().toLowerCase();
  const found = SESSION_CLASSES.find((name) => name === wanted);
  if (found) {
    return found;
  }
  throw new Error(`${value} is not a class. Use one of: ${SESSION_CLASSES.join(", ")}.`);
}
