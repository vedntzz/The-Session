// `session verify`.
import type { Command } from "commander";
import {
  formatVerify,
  formatVerifyPeers,
  peersFailed,
  verifyFailed,
  verifyLog,
  verifyPeers,
} from "../commands/verify.js";
import type { ProgramOptions } from "./options.js";
import { printLines } from "./print.js";

export function registerVerify(program: Command, options: ProgramOptions): void {
  program
    .command("verify")
    .description("Check a log's hash chain and signatures")
    .option("--log <path>", "a log file to check instead of this repo's own")
    .option("--key <path>", "the public key to check against: a key file, or the PEM itself")
    .option("--peers", "check every chain pulled into this repo, key by key")
    // A broken log, an empty one, and a pulled chain that does not add up are
    // findings, not crashes: the report is the point. The exit code is there
    // so a script can gate on it.
    .action(async (flags: { log?: string; key?: string; peers?: boolean }) => {
      if (flags.peers) {
        await reportPeerChains(flags, options);
        return;
      }
      const result = await verifyLog({ ...options, log: flags.log, key: flags.key });
      printLines(formatVerify(result));
      if (verifyFailed(result)) {
        process.exitCode = 1;
      }
    });
}

async function reportPeerChains(
  flags: { log?: string; key?: string },
  options: ProgramOptions,
): Promise<void> {
  if (flags.log !== undefined) {
    throw new Error(
      "--peers checks the chains pulled into this repo; --log names one file. " +
        "Pass one or the other.",
    );
  }
  const result = await verifyPeers({ ...options, key: flags.key });
  printLines(formatVerifyPeers(result));
  if (peersFailed(result)) {
    process.exitCode = 1;
  }
}
