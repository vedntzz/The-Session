#!/usr/bin/env node
import { buildProgram } from "./program.js";

try {
  await buildProgram().parseAsync(process.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
