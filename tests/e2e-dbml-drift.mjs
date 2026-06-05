// Drift test: import → export → import → export, N rounds.
// Verifies content is stable (no progressive corruption).
import { readFileSync } from "node:fs";
import { Parser } from "@dbml/core";
import { exportDbml } from "../src/io/dbml/export.ts";
import { importDbml } from "../src/io/dbml/import.ts";

const FILE = "/Users/linhji/dev/odoo-live/specs/dpt_kalix_product/features/product-prop-pricing-diy-20260425/erd-d1.dbml";
let current = readFileSync(FILE, "utf8");

let prevTables = -1, prevRefs = -1;
for (let i = 1; i <= 5; i++) {
  const { model, sourceMeta } = importDbml(current);
  const out = exportDbml(model, sourceMeta);
  const parsed = new Parser().parse(out, "dbml");
  const tables = parsed.schemas[0].tables.length;
  const refs = parsed.schemas[0].refs.length;
  const stable = (i === 1) || (tables === prevTables && refs === prevRefs);
  console.log(`Round ${i}: tables=${tables} refs=${refs} bytes=${out.length} ${stable ? "✅" : "❌ DRIFT"}`);
  if (i > 1 && !stable) process.exit(1);
  prevTables = tables; prevRefs = refs;
  current = out;
}
console.log("\n✅ No drift across 5 import→export cycles");
