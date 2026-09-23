/** A content write, not a file deletion. Contains no source text or tool names. */
export interface FileWriteRequest {
  readonly cwd: string;
  readonly filePath: string;
}

/** Invalid payloads are distinct from tools this adapter does not handle. */
export type WriteRequestResult =
  | { kind: "write"; request: FileWriteRequest }
  | { kind: "unsupported" }
  | { kind: "invalid"; reason: "payload-too-large" | "invalid-json" | "invalid-event" | "invalid-input" };
