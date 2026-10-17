import { expect, vi } from "vitest";

/** A hook payload on a stream, standing in for the one Claude Code pipes in. */
export function stdinWith(payload: string): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      yield payload;
    },
  };
}

/** Fail a CLI test if its hook accidentally consumes the runner's input. */
export function watchProcessStdin(): () => void {
  const reader = vi.spyOn(process.stdin, Symbol.asyncIterator);
  return () => expect(reader).not.toHaveBeenCalled();
}
