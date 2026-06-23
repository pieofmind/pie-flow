import { readFileSync, writeFileSync } from "fs";
import { importDbml } from "../src/io/dbml/import";
import { serializeBoard } from "../src/view/boardSerde";

const dbml = readFileSync(process.env.OMNIBOARD_DBML_IN ?? "erd-d1.dbml", "utf8");
const { model, sourceMeta, warnings } = importDbml(dbml);

console.log(`Parsed: ${model.nodes.length} tables, ${model.edges.length} refs`);
console.log(`Warnings: ${warnings.length}`);
warnings.slice(0, 5).forEach((w) => console.log("  -", w));

const out = serializeBoard(model, "", sourceMeta);
const outPath = process.env.OMNIBOARD_BOARD_OUT ?? "erd-d1-generated.omniboard.md";
writeFileSync(outPath, out);
console.log(`Wrote ${outPath} (${out.length} bytes)`);
