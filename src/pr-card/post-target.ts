// Where `session pr --post` sends the card, and with what token, read before any request. Pure.
import type { PrTarget } from "./github-comments.js";

/** The PR and the token to reach it with. */
export interface PostTarget {
  target: PrTarget;
  token: string;
}

/** Every missing piece named at once; a malformed one named with what it should look like. */
export function postTarget(pr: string | undefined, env: NodeJS.ProcessEnv): PostTarget {
  const token = env.GITHUB_TOKEN ?? "";
  const repository = env.GITHUB_REPOSITORY ?? "";
  const missing = [token === "" && "GITHUB_TOKEN", repository === "" && "GITHUB_REPOSITORY", pr === undefined && "--pr <number>"].filter(
    (name): name is string => name !== false,
  );
  if (missing.length > 0) throw new Error(`Cannot post the card: ${missing.join(", ")} not given. Set GITHUB_TOKEN and GITHUB_REPOSITORY and run session pr --post --pr <number>.`);
  return { target: { ...ownerRepo(repository), number: prNumber(pr as string) }, token };
}

/** `owner/repo`, the shape GitHub Actions sets GITHUB_REPOSITORY to. */
function ownerRepo(repository: string): Pick<PrTarget, "owner" | "repo"> {
  const [owner, repo, ...rest] = repository.split("/");
  if (!owner || !repo || rest.length > 0) throw new Error(`GITHUB_REPOSITORY is ${JSON.stringify(repository)}; it must be owner/repo.`);
  return { owner, repo };
}

/** A pull request number: a positive whole number, written plainly. */
function prNumber(pr: string): number {
  if (!/^[1-9][0-9]*$/u.test(pr)) throw new Error(`--pr takes a pull request number; got ${JSON.stringify(pr)}.`);
  return Number(pr);
}
