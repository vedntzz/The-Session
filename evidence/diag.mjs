import { readSessions } from "/Users/vedant/dev-session/dist/store.js";
import { IGNORED_CLASSES } from "/Users/vedant/dev-session/dist/debt.js";
import { classOfPath } from "/Users/vedant/dev-session/dist/classify.js";
const keep = (p) => !IGNORED_CLASSES.includes(classOfPath(p));
const all = (await readSessions({ cwd: "/Users/vedant/dev-session" })).filter((s) => s.reality.length);

console.log("how spread out is a session's work?");
for (const s of all) {
  const r = s.reality.filter(keep);
  if (!r.length) continue;
  const dirs = new Set(r.map((p) => p.split("/").slice(0, 2).join("/")));
  console.log(`  ${s.id.slice(0,8)}  ${String(r.length).padStart(3)} files  ${String(dirs.size).padStart(2)} dirs  ${[...dirs].slice(0,5).join(" ")}`);
}
const counts = new Map();
for (const s of all) for (const p of new Set(s.reality.filter(keep)))
  counts.set(p, (counts.get(p) ?? 0) + 1);
console.log(`\nappears in how many of the ${all.length} sessions that changed anything:`);
for (const [p, n] of [...counts].sort((a,b) => b[1]-a[1]).slice(0, 8))
  console.log(`  ${String(n).padStart(2)}/${all.length}  ${p}`);
const sizes = all.map((s) => s.reality.filter(keep).length).sort((a,b) => a-b);
console.log(`\nfiles per session: median ${sizes[Math.floor(sizes.length/2)]}, max ${sizes.at(-1)}`);
