import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    /**
     * Most of this suite drives real git repositories in temp directories, and
     * files run in parallel: a test that spawns a dozen git processes is fast
     * on its own and not fast when three other files are doing the same. The
     * default five seconds is a budget for pure functions, not for subprocesses
     * under load, and a timeout there reports a machine being busy as a bug.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
