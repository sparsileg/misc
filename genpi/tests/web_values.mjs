// Helper for check_web.py: runs the browser version's algorithms and
// formatters under Node and writes the results for Python to compare.
//
// Reads a JSON request on stdin; writes <outdir>/<name>.f64 (raw float64
// arrays) and <outdir>/formats.json.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as algos from "../web/pialgos.js";
import * as fmt from "../web/format.js";

const req = JSON.parse(readFileSync(0, "utf8"));
const out = req.outdir;

function take(gen, n) {
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = gen.next().value;
  return a;
}

const save = (name, arr) => writeFileSync(join(out, `${name}.f64`), Buffer.from(arr.buffer));

for (const [name, n] of Object.entries(req.sequences)) save(name, take(algos[name](), n));
save("crawl_at", Float64Array.from(req.crawl_at, (r) => algos.crawlCircle(r)));

// Buffon: many independent runs; the estimate at the end of each.
const b = req.buffon;
const ends = new Float64Array(b.runs);
for (let i = 0; i < b.runs; i++) {
  const g = algos.buffon();
  let v;
  for (let j = 0; j < b.drops; j++) v = g.next().value;
  ends[i] = v;
}
save("buffon", ends);

const f = req.formats;
writeFileSync(join(out, "formats.json"), JSON.stringify({
  fixed15: f.fixed15.map((x) => fmt.fmtF(x, 15)),
  e3: f.e3.map((x) => fmt.fmtE(x, 3)),
  e2: f.e2.map((x) => fmt.fmtE(x, 2)),
  short: f.short.map(fmt.fmtShort),
  count: f.count.map(fmt.fmtCount),
  rate: f.rate.map(fmt.fmtRate),
}));
