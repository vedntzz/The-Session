// What the three commands print.
import { isIntact, type ChainCheck } from "../verify.js";
import type { Peer } from "./refs.js";
import type { Fetched, PullResult, PushResult } from "./publish.js";

// --- the views -----------------------------------------------------------

export const LABEL_WIDTH = 9;

export function line(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)}${value}`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The date part of a timestamp — the day is the resolution anyone reads here. */
export function day(iso: string | undefined): string {
  return iso === undefined ? "never" : iso.slice(0, 10);
}

export function formatPush(result: PushResult): string[] {
  return [
    line("verified", `${plural(result.records, "record", "records")}, chain intact`),
    line("ref", result.ref),
    line(
      "pushed",
      result.committed
        ? `${plural(result.records, "record", "records")} to origin`
        : `nothing new — origin already has these ${plural(result.records, "record", "records")}`,
    ),
  ];
}

/**
 * One row per key, laid out the way `peers` lays them out: the fingerprint is
 * what the row is about, and everything else trails it. The state is a word at
 * the end rather than a label at the front — `unchanged` is exactly as wide as
 * the label column, and a label that touches its own value is unreadable.
 */
export function keyRows(rows: readonly { fingerprint: string; records: number }[]): string[] {
  const counts = rows.map((row) => plural(row.records, "record", "records"));
  const width = counts.reduce((widest, count) => Math.max(widest, count.length), 0);
  return rows.map((row, index) => `  ${row.fingerprint}  ${(counts[index] as string).padStart(width)}`);
}

export function formatPull(result: PullResult): string[] {
  if (result.fetched.length === 0) {
    return [line("pulled", "nothing — origin has no session records yet")];
  }

  const lines = keyRows(result.fetched).map(
    (row, index) => `${row}  ${(result.fetched[index] as Fetched).state}`,
  );
  lines.push(line("pulled", `${plural(result.fetched.length, "key", "keys")} from origin`));
  return lines;
}

export function formatPeers(peers: readonly Peer[]): string[] {
  if (peers.length === 0) {
    return [
      line("peers", "none yet"),
      line("", "session push publishes yours; session pull brings everyone else's"),
    ];
  }

  const lines = keyRows(peers.map((peer) => ({ ...peer, records: peer.summary.records }))).map(
    (row, index) => {
      const peer = peers[index] as Peer;
      return `${row}  last ${day(peer.summary.lastSeen)}${peer.mine ? "  (this machine)" : ""}`;
    },
  );

  // Only ever said about a peer, and only when it is true: this machine's own
  // log cannot get here broken, since push refuses to publish one.
  for (const peer of peers) {
    if (!isIntact(peer.summary.check)) {
      const { line: at, detail } = peer.summary.check.break as NonNullable<ChainCheck["break"]>;
      lines.push(line("broken", `${peer.fingerprint} — line ${at} ${detail}`));
    }
  }

  lines.push(line("peers", `${plural(peers.length, "key", "keys")} on this machine`));
  return lines;
}
