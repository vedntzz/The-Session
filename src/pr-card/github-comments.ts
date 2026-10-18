// The PR card as a comment, through GitHub's REST API. The one call this makes is the one the
// GitHub Action exception in docs/decisions.md permits; nothing in the CLI reaches for it.
import type { PrComment } from "./find-card-comment.js";

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
  const json = parse(await response.text());
  if (!response.ok) throw failure(response.status, json, doing, token);
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

/** More pages than this is not a PR worth paging through; it is a loop. */
const MAX_PAGES = 20;

/** Every comment on the PR, oldest first, across pages; only the fields the card match reads. */
export async function listComments(target: PrTarget, token: string, fetchFn: FetchFn = fetch): Promise<PrComment[]> {
  const doing = `listing comments on ${target.owner}/${target.repo}#${target.number}`;
  const comments: PrComment[] = [];
  let url: string | null = `${commentsUrl(target)}?per_page=100`;
  for (let page = 0; url !== null; page++) {
    if (page === MAX_PAGES) {
      throw new Error(`Stopped ${doing} after ${MAX_PAGES} pages of 100 comments, the limit. Check the PR for a comment loop.`);
    }
    const response = await send(githubRequest("GET", url, token), token, fetchFn);
    const json: unknown = parse(await response.text());
    if (!response.ok) throw failure(response.status, json as Record<string, unknown> | undefined, doing, token);
    if (!Array.isArray(json)) throw new Error(`GitHub answered ${response.status} to ${doing} with no list of comments. Try again.`);
    for (const item of json) comments.push(toComment(item, doing));
    url = nextLink(response.headers.get("Link"));
    if (url !== null && new URL(url).origin !== API) {
      throw new Error(`GitHub's next page for ${doing} is not on ${API}. Stopped rather than send the token there.`);
    }
  }
  return comments;
}

/** The rel="next" URL of a Link header, or null when there is no next page. */
function nextLink(header: string | null): string | null {
  for (const part of header?.split(",") ?? []) {
    const match = /^\s*<([^>]*)>(.*)$/.exec(part);
    if (match && /;\s*rel="next"/.test(match[2]!)) return match[1]!;
  }
  return null;
}

/** id, body and updated_at; who wrote it is dropped here, before anything can read it. */
function toComment(item: unknown, doing: string): PrComment {
  const record = item !== null && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const { id, body, updated_at } = record;
  if (typeof id !== "number" || !Number.isInteger(id) || typeof updated_at !== "string") {
    throw new Error(`GitHub's answer to ${doing} had a comment missing its id or updated_at. Try again.`);
  }
  return { id, body: typeof body === "string" ? body : null, updated_at };
}

/** The status and GitHub's own message, with what to do next; never the token. */
function failure(status: number, json: Record<string, unknown> | undefined, doing: string, token: string): Error {
  const message = typeof json?.["message"] === "string" ? `: ${json["message"]}` : "";
  return new Error(scrub(`GitHub answered ${status} to ${doing}${message}. ${hint(status)}`, token));
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
