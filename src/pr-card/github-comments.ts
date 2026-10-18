// The PR card as a comment, through GitHub's REST API. The one call this makes is the one the
// GitHub Action exception in docs/decisions.md permits; nothing in the CLI reaches for it.

/** The fetch this needs; the global one by default, a fake in tests. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** The pull request the card belongs to. */
export interface PrTarget {
  owner: string;
  repo: string;
  number: number;
}

/** One request to GitHub, built apart from sending it. */
export interface GitHubRequest {
  url: string;
  init: RequestInit;
}

const API = "https://api.github.com";

/** Where a PR's comments live; a PR is an issue to this API. */
export function commentsUrl(target: PrTarget): string {
  return `${API}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/issues/${target.number}/comments`;
}

/** Where one comment lives, by its id; the PR number plays no part in the path. */
export function commentUrl(target: PrTarget, commentId: number): string {
  return `${API}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/issues/comments/${commentId}`;
}

/** The comment was deleted after it was found; the caller may post a new one in its place. */
export class CommentGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentGoneError";
  }
}

/** The headers GitHub asks for, the token, and the comment as `{ body }`. */
export function githubRequest(method: string, url: string, token: string, body?: string): GitHubRequest {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (body === undefined) return { url, init: { method, headers, redirect: "error" } };
  headers["Content-Type"] = "application/json";
  return { url, init: { method, headers, redirect: "error", body: JSON.stringify({ body }) } };
}

/** Sends one request; a failure to reach GitHub at all is named as that, with the token taken out. */
export async function send(request: GitHubRequest, token: string, fetchFn: FetchFn): Promise<Response> {
  try {
    return await fetchFn(request.url, request.init);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(scrub(`Could not reach GitHub: ${reason}. Check the network and try again.`, token));
  }
}

/** The comment's id from a 2xx answer; otherwise the status and GitHub's own message, never the token. */
export async function readCommentId(response: Response, doing: string, token: string): Promise<number> {
  const text = await response.text();
  const json = parse(text);
  if (!response.ok) {
    const message = typeof json?.["message"] === "string" ? `: ${json["message"]}` : "";
    throw new Error(scrub(`GitHub answered ${response.status} to ${doing}${message}. ${hint(response.status)}`, token));
  }
  const id = json?.["id"];
  if (typeof id !== "number" || !Number.isInteger(id)) {
    throw new Error(`GitHub answered ${response.status} to ${doing} with no comment id. Check the PR for a new comment before retrying.`);
  }
  return id;
}

/** Posts `body` as a new comment on the PR and returns its id. */
export async function createComment(target: PrTarget, body: string, token: string, fetchFn: FetchFn = fetch): Promise<number> {
  const request = githubRequest("POST", commentsUrl(target), token, body);
  const doing = `commenting on ${target.owner}/${target.repo}#${target.number}`;
  return readCommentId(await send(request, token, fetchFn), doing, token);
}

/** Replaces the body of comment `commentId` with `body` and returns its id; a 404 is a CommentGoneError. */
export async function updateComment(
  target: PrTarget,
  commentId: number,
  body: string,
  token: string,
  fetchFn: FetchFn = fetch,
): Promise<number> {
  const request = githubRequest("PATCH", commentUrl(target, commentId), token, body);
  const doing = `updating comment ${commentId} on ${target.owner}/${target.repo}#${target.number}`;
  const response = await send(request, token, fetchFn);
  if (response.status === 404) {
    throw new CommentGoneError(`GitHub answered 404 to ${doing}: the comment no longer exists. Post a new comment instead.`);
  }
  return readCommentId(response, doing, token);
}

function parse(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** What to do next, for the statuses a token or a PR number explains. */
function hint(status: number): string {
  if (status === 401) return "Check the token is set and has not expired.";
  if (status === 403) return "Check the token may write to pull requests in this repository.";
  if (status === 404) return "Check the owner, repository and PR number, and that the token can see the repository.";
  return "Try again; if it persists, check GitHub's status.";
}

/** The token, wherever it turns up, is replaced; an empty token has nothing to hide. */
function scrub(message: string, token: string): string {
  return token === "" ? message : message.split(token).join("[token]");
}
