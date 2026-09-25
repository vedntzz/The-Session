import assert from "node:assert/strict";
import test from "node:test";
import { scoreSessions } from "../../evidence/jev-backtest.mjs";

const session = (changedPaths) => ({ intent: "test", candidatePaths: [], changedPaths });
const ranked = (paths) => paths.map((path) => ({ path, confidence: 1, reason: "test" }));

test("recall uses changed files as its denominator at the exact cutoffs", () => {
  const scores = scoreSessions([session(["a", "b", "c", "d"])], [ranked(["a", "x", "y", "b", "z", "u", "v", "w", "q", "c", "d"])]);
  assert.deepEqual(scores.rows[0], { session: 1, changed: 4, hits3: 1, hits10: 3, recall3: 0.25, recall10: 0.75 });
  assert.equal(scores.hit3, 1);
  assert.equal(scores.hit10, 1);
});

test("empty suggestions remain scored as zero", () => {
  const scores = scoreSessions([session(["a"])], [[]]);
  assert.equal(scores.rows.length, 1);
  assert.equal(scores.median3, 0);
  assert.equal(scores.median10, 0);
  assert.equal(scores.hit3, 0);
  assert.equal(scores.hit10, 0);
});

test("medians weight sessions equally without pooling files", () => {
  const scores = scoreSessions([session(["a"]), session(Array.from({ length: 100 }, (_, i) => `${i}`))], [ranked(["a"]), []]);
  assert.equal(scores.median3, 0.5);
  assert.equal(scores.median10, 0.5);
  assert.equal(scores.hit3, 1);
});

test("odd medians are numeric and secondary hits remain separate", () => {
  const scores = scoreSessions([session(["a"]), session(["a", "b", "c", "d"]), session(["a"])], [ranked(["a"]), ranked(["a"]), []]);
  assert.equal(scores.median3, 0.25);
  assert.equal(scores.median10, 0.25);
  assert.equal(scores.hit3, 2);
});

test("intersection counts each changed and suggested path once", () => {
  assert.equal(scoreSessions([session(["a", "a", "b"])], [ranked(["a", "a"]) ]).rows[0].recall3, 0.5);
});

test("no sessions means unmeasured medians", () => {
  assert.deepEqual(scoreSessions([], []), { rows: [], median3: null, median10: null, hit3: 0, hit10: 0 });
});

test("missing predictions and sessions without changes cannot be scored", () => {
  assert.throws(() => scoreSessions([session(["a"])], []));
  assert.throws(() => scoreSessions([session([])], [[]]));
});
