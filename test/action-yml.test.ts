// The composite action at the repo root and the workflow that runs it here.
// Parses both files, then runs the action's own bash steps against a stub CLI.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(import.meta.dirname, "..");

type Yaml = string | Yaml[] | { [key: string]: Yaml };
type Line = { indent: number; text: string };
type Step = { name?: string; id?: string; if?: string; run?: string; uses?: string; env?: Record<string, string>; with?: Record<string, string> };

/** The YAML subset these files use: block maps, block lists, quoted or plain scalars, `|` literals. No yaml package is installed. */
function parseYaml(source: string): Yaml {
  const lines: Line[] = source.split("\n").map((raw) => ({ indent: raw.length - raw.trimStart().length, text: raw.trim() }));
  let i = 0;
  const skip = () => {
    while (i < lines.length && (lines[i]!.text === "" || lines[i]!.text.startsWith("#"))) i++;
  };
  const scalar = (text: string): string => (/^(["']).*\1$/.test(text) ? text.slice(1, -1) : text);
  const literal = (parent: number): string => {
    const body: string[] = [];
    while (i < lines.length && (lines[i]!.text === "" || lines[i]!.indent > parent)) body.push(lines[i++]!.text === "" ? "" : " ".repeat(lines[i - 1]!.indent) + lines[i - 1]!.text);
    const strip = Math.min(...body.filter((l) => l !== "").map((l) => l.length - l.trimStart().length));
    return body.map((l) => l.slice(strip)).join("\n").replace(/\n*$/, "\n");
  };
  const block = (indent: number): Yaml => {
    skip();
    return lines[i]!.text.startsWith("- ") ? list(indent) : map(indent);
  };
  const map = (indent: number): Yaml => {
    const out: Record<string, Yaml> = {};
    for (skip(); i < lines.length && lines[i]!.indent === indent && !lines[i]!.text.startsWith("- "); skip()) {
      const { text } = lines[i++]!;
      const colon = text.indexOf(":");
      const key = text.slice(0, colon);
      const rest = text.slice(colon + 1).trim();
      if (rest === "|") out[key] = literal(indent);
      else if (rest !== "") out[key] = scalar(rest);
      else {
        skip();
        out[key] = i < lines.length && lines[i]!.indent > indent ? block(lines[i]!.indent) : "";
      }
    }
    return out;
  };
  const list = (indent: number): Yaml => {
    const out: Yaml[] = [];
    for (skip(); i < lines.length && lines[i]!.indent === indent && lines[i]!.text.startsWith("- "); skip()) {
      const rest = lines[i]!.text.slice(2);
      if (!/^[\w-]+:/.test(rest)) {
        out.push(scalar(rest));
        i++;
        continue;
      }
      lines[i] = { indent: indent + 2, text: rest };
      out.push(map(indent + 2));
    }
    return out;
  };
  return block(0);
}

const load = (file: string) => parseYaml(readFileSync(path.join(ROOT, file), "utf8")) as Record<string, any>;
const action = load("action.yml");
const workflow = load(".github/workflows/session-card.yml");
const steps = action.runs.steps as Step[];
const stepById = (id: string) => steps.find((step) => step.id === id)!;

/** Runs one of the action's bash steps with the given env, returning stdout and what it wrote to GITHUB_OUTPUT. */
function runStep(step: Step, env: Record<string, string>): { stdout: string; output: string } {
  const outputFile = path.join(mkdtempSync(path.join(tmpdir(), "action-yml-")), "output");
  execFileSync("touch", [outputFile]);
  const stdout = execFileSync("bash", ["-e", "-c", step.run!], { env: { PATH: process.env.PATH, GITHUB_OUTPUT: outputFile, ...env }, encoding: "utf8" });
  return { stdout, output: readFileSync(outputFile, "utf8") };
}

describe("action.yml", () => {
  it("is a composite action with the three inputs and their defaults", () => {
    expect(action.runs.using).toBe("composite");
    expect(Object.keys(action.inputs).sort()).toEqual(["cli", "github-token", "show-intent"]);
    expect(action.inputs["github-token"].default).toBe("${{ github.token }}");
    expect(action.inputs["show-intent"].default).toBe("false");
    expect(action.inputs.cli.default).toBe("npx --yes @vedantzz/session@3");
  });

  it("passes the token only as the GITHUB_TOKEN env of the posting step", () => {
    const holders = steps.filter((step) => JSON.stringify(step).includes("inputs.github-token"));
    expect(holders.map((step) => step.id)).toEqual(["post"]);
    expect(stepById("post").env!.GITHUB_TOKEN).toBe("${{ inputs.github-token }}");
    for (const step of steps) expect(step.run ?? "").not.toMatch(/github\.token|github-token|GITHUB_TOKEN/);
  });

  it("puts no expression inside any run script", () => {
    for (const step of steps) expect(step.run ?? "").not.toContain("${{");
  });

  it("fetches the session refs without failing when there are none", () => {
    const fetch = steps.find((step) => (step.run ?? "").includes("refs/session/"))!;
    expect(fetch.run).toContain("git fetch origin '+refs/session/*:refs/session/*'");
    expect(fetch.run).toMatch(/\|\| echo/);
    expect(fetch.if).toBe("steps.gate.outputs.post == 'true'");
  });

  it("posts with the PR number and base, and --show-intent only when the input is true", () => {
    const post = stepById("post");
    expect(post.if).toBe("steps.gate.outputs.post == 'true'");
    const env = { SESSION_CLI: "printf %s\\n", PR_NUMBER: "7", BASE_REF: "master", GITHUB_TOKEN: "t" };
    const hidden = runStep(post, { ...env, SHOW_INTENT: "false" }).stdout.trim().split("\n");
    expect(hidden).toEqual(["pr", "--post", "--pr", "7", "--base", "origin/master", "--head", "HEAD"]);
    expect(runStep(post, { ...env, SHOW_INTENT: "true" }).stdout.trim().split("\n")).toEqual([...hidden, "--show-intent"]);
    expect(runStep(post, { ...env, SHOW_INTENT: "yes" }).stdout).not.toContain("--show-intent");
  });

  it("skips any event but pull_request with a message, and exits 0", () => {
    const run = runStep(stepById("gate"), { EVENT_NAME: "push", HEAD_REPO: "", REPO: "o/r" });
    expect(run.output).toContain("post=false");
    expect(run.stdout).toMatch(/skipped.*push/);
  });

  it("skips a fork PR with a warning, and exits 0", () => {
    const run = runStep(stepById("gate"), { EVENT_NAME: "pull_request", HEAD_REPO: "fork/r", REPO: "o/r" });
    expect(run.output).toContain("post=false");
    expect(run.stdout).toMatch(/^::warning::.*fork/m);
  });

  it("posts on a pull request from the same repository", () => {
    const run = runStep(stepById("gate"), { EVENT_NAME: "pull_request", HEAD_REPO: "o/r", REPO: "o/r" });
    expect(run.output).toContain("post=true");
  });
});

describe(".github/workflows/session-card.yml", () => {
  const jobSteps = (Object.values(workflow.jobs)[0] as { steps: Step[] }).steps;

  it("runs on pull_request with read contents and write PRs and issues", () => {
    expect(Object.keys(workflow.on)).toEqual(["pull_request"]);
    expect(workflow.permissions).toEqual({ contents: "read", "pull-requests": "write", issues: "write" });
  });

  it("checks out full history, builds, and uses the local action with the built CLI", () => {
    expect(jobSteps.find((step) => step.uses?.startsWith("actions/checkout"))!.with).toEqual({ "fetch-depth": "0" });
    expect(jobSteps.some((step) => step.run === "npm ci && npm run build")).toBe(true);
    expect(jobSteps.at(-1)).toMatchObject({ uses: "./", with: { cli: "node dist/cli.js" } });
  });
});
