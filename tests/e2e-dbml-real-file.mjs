// Stress test with real ERD file: import → simulate canvas edit → export → parse
import { Parser } from "@dbml/core";
import { readFileSync } from "node:fs";
import { exportDbml } from "../src/io/dbml/export.ts";
import { importDbml } from "../src/io/dbml/import.ts";

const FILE = "/Users/linhji/dev/odoo-live/specs/dpt_kalix_product/features/product-prop-pricing-diy-20260425/erd-d1.dbml";
const raw = readFileSync(FILE, "utf8");

console.log(`Source file: ${raw.length} bytes`);

const t0 = Date.now();
const { model, sourceMeta } = importDbml(raw);
const t1 = Date.now();
console.log(`Import: ${model.nodes.length} tables, ${model.edges.length} edges in ${t1 - t0}ms`);

// Simulate user adding a new edge between first 2 tables
if (model.nodes.length >= 2) {
  model.edges.push({
    id: "user-drawn-test",
    source: model.nodes[0].id,
    target: model.nodes[1].id,
    sourcePort: "col:id-right",
    targetPort: "col:id-left",
    style: { start: "crow", end: "bar" },
  });
}

const t2 = Date.now();
const out = exportDbml(model, sourceMeta);
const t3 = Date.now();
console.log(`Export: ${out.length} bytes in ${t3 - t2}ms`);

// Now parse with the OFFICIAL @dbml/core parser — same as dbdiagram.io
const t4 = Date.now();
let parsed = null, err = null;
try {
  parsed = new Parser().parse(out, "dbml");
} catch (e) {
  err = e;
}
const t5 = Date.now();

if (err) {
  console.log(`❌ dbdiagram.io parse FAILED in ${t5 - t4}ms`);
  console.log(`   ${err.message?.split("\n").slice(0,5).join("\n   ")}`);
  // Show context around the issue
  if (err.location?.start?.line) {
    const lines = out.split("\n");
    const ln = err.location.start.line;
    console.log("\n   --- context ---");
    for (let i = Math.max(0, ln - 3); i < Math.min(lines.length, ln + 3); i++) {
      console.log(`   ${i+1}: ${lines[i]}`);
    }
  }
  process.exit(1);
}

const schema = parsed.schemas[0];
console.log(`✅ Parsed by @dbml/core in ${t5 - t4}ms`);
console.log(`   Tables: ${schema.tables.length}, Refs: ${schema.refs.length}`);

// Verify our injected edge made it through
const userEdge = schema.refs.find((r) => {
  const ep = r.endpoints;
  return ep.some(e => e.fieldNames.includes("id"));
});
console.log(`   Injected canvas-added ref present: ${userEdge ? "yes" : "no"}`);

// Verify all original tables survived
const origTableNames = (raw.match(/Table\s+(\w+)/g) || []).map(s => s.replace(/Table\s+/, ""));
const outTableNames = new Set(schema.tables.map(t => t.name));
const missing = origTableNames.filter(n => !outTableNames.has(n));
if (missing.length) {
  console.log(`   ❌ MISSING tables: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`   ✅ All ${origTableNames.length} original tables preserved`);
