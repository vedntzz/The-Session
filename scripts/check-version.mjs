// Refuses a publish whose version is not greater than the one on the registry.
// Runs as prepublishOnly, from the package root. A package the registry has
// never seen passes; any other failure to ask it fails, rather than guessing.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Negative, zero or positive, by semver precedence. Throws on anything that is not a version. */
export function compare(a, b) {
  const [x, y] = [a, b].map((v) => {
    const m = SEMVER.exec(v);
    if (!m) throw new Error(`"${v}" is not a semver version.`);
    return { core: m.slice(1, 4).map(Number), pre: m[4]?.split(".") ?? [] };
  });
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    if (p === q) continue;
    const [pn, qn] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

function main() {
  const { name, version } = JSON.parse(readFileSync("package.json", "utf8"));
  const view = spawnSync("npm", ["view", name, "version"], { encoding: "utf8" });
  if (view.status !== 0) {
    if (/E404/.test(view.stderr)) {
      console.log(`${name} is not on the registry yet; publishing ${version}.`);
      return 0;
    }
    console.error(`Could not read the published version of ${name}: npm view exited ${view.status ?? view.error?.code}. Check the registry is reachable, then publish again.`);
    return 1;
  }
  const published = view.stdout.trim();
  try {
    if (compare(version, published) > 0) return 0;
  } catch (error) {
    console.error(`${error.message} Fix package.json or the registry response, then publish again.`);
    return 1;
  }
  console.error(`package.json is ${version}, not greater than ${published} on the registry. Bump the version, then publish again.`);
  return 1;
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exit(main());
