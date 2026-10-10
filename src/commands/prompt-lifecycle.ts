import type { EventEmitter } from "node:events";
import type { Interface } from "node:readline";
import { createPromptReader } from "./prompt-reader.js";
import type { PromptTerminal } from "./prompt-terminal.js";

export interface PromptSignals extends Pick<EventEmitter, "on" | "off"> {
  exitCode?: number | string | null | undefined;
}

interface PromptState {
  cancelled: boolean;
  outputError?: Error;
  stopped: Promise<void>;
  cleanup: () => void;
}

const SIGNALS = [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const;

function listenPrompt(reader: Interface, output: PromptTerminal["output"], signals: PromptSignals): PromptState {
  let stop!: () => void;
  const state: PromptState = { cancelled: false, stopped: new Promise(resolve => { stop = resolve; }), cleanup: () => {} };
  const cancel = (code: number): void => { state.cancelled = true; signals.exitCode = code; reader.close(); stop(); };
  const failed = (error: Error): void => { state.outputError ??= error; reader.close(); stop(); };
  const handlers = SIGNALS.map(([name, code]) => [name, () => cancel(code)] as const);
  for (const [name, listener] of handlers) signals.on(name, listener);
  output.on("error", failed);
  state.cleanup = () => {
    for (const [name, listener] of handlers) signals.off(name, listener);
    output.off("error", failed);
  };
  return state;
}

function flushOutput(output: PromptTerminal["output"]): Promise<void> {
  return new Promise((resolve, reject) => {
    output.write("", error => error ? reject(error) : resolve());
  });
}

function guardedAnswers(answers: AsyncIterator<string>, state: PromptState): AsyncIterator<string> {
  return { next: async () => {
    if (state.cancelled || state.outputError) return { done: true, value: undefined };
    const answer = await answers.next();
    return state.cancelled || state.outputError ? { done: true, value: undefined } : answer;
  } };
}

async function collectAndFlush<T>(collect: (answers: AsyncIterator<string>) => Promise<T | undefined>, answers: AsyncIterator<string>, output: PromptTerminal["output"], state: PromptState): Promise<T | undefined> {
  let result: T | undefined;
  let failure: unknown;
  let failed = false;
  try { result = await collect(answers); }
  catch (error) { failed = true; failure = error; }
  if (!state.cancelled && !state.outputError) await flushOutput(output);
  if (failed) throw failure;
  return result;
}

/** The collector only reads; callers own stream events after cancellation returns. */
export async function withPromptReader<T>(
  terminal: PromptTerminal,
  collect: (answers: AsyncIterator<string>) => Promise<T | undefined>,
  signals: PromptSignals = process,
): Promise<T | undefined> {
  const flowing = terminal.input.readableFlowing === true;
  const reader = createPromptReader(terminal);
  const state = listenPrompt(reader, terminal.output, signals);
  try {
    const completion = collectAndFlush(collect, guardedAnswers(reader[Symbol.asyncIterator](), state), terminal.output, state);
    const result = await Promise.race([completion, state.stopped.then(() => undefined)]);
    if (state.outputError) throw state.outputError;
    return state.cancelled ? undefined : result;
  } catch (error) { throw state.outputError ?? error; }
  finally {
    reader.close();
    state.cleanup();
    if (flowing) terminal.input.resume(); else terminal.input.pause();
  }
}
