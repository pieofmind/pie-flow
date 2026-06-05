// One-off: import erd-d1.dbml → serialize as .omniboard.md → write to vault.
// Run: node scripts/gen-erd-board.mjs
import { readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";

// Use tsx to load the TS modules
const require = createRequire(import.meta.url);
require("tsx/cjs");
const { importDbml } = require("../src/io/dbml/import");
const { serializeBoard } = require("../src/view/boardSerde");

const dbml = readFileSync("/Users/linhji/Downloads/erd-d1.dbml", "utf8");
const { model, sourceMeta, warnings } = importDbml(dbml);

console.log(`Parsed: ${model.nodes.length} tables, ${model.edges.length} refs`);
console.log(`Warnings: ${warnings.length}`);
warnings.slice(0, 5).forEach((w) => console.log("  -", w));

const out = serializeBoard(model, "", sourceMeta);
const outPath =
  "/Users/linhji/dev/obsidian-omniboard-bmad/obsidian-vault-test/Omniboards/erd-d1-generated.omniboard.md";
writeFileSync(outPath, out);
console.log(`Wrote ${outPath} (${out.length} bytes)`);
