import { loadOrCreateKeypair, privateKeyFile, type Keypair } from "../keys.js";
import { storeHome, type StoreOptions } from "../store.js";

/**
 * The public key, generating the pair if this machine has none yet — the same
 * thing the first `session start` would have done. Only the public half is
 * ever printed; the private key is named, not read, so that it stays a thing
 * that lives in one file on one disk.
 */
export async function showKey(options: StoreOptions = {}): Promise<Keypair> {
  return loadOrCreateKeypair(storeHome(options));
}

/**
 * What the command prints. The PEM goes last and unindented so that piping the
 * output into a file, or selecting it with the mouse, gives something another
 * tool will accept.
 */
export function formatKey(keypair: Keypair, options: StoreOptions = {}): string[] {
  return [
    `  key      ${keypair.fingerprint}`,
    `  public   ${keypair.source}`,
    `  private  ${privateKeyFile(storeHome(options))} (never share, never sent)`,
    "",
    keypair.pem.trimEnd(),
  ];
}
