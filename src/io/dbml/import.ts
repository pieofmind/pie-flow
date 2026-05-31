import dagre from "@dagrejs/dagre";
import type { CanvasModel } from "../../canvas/types";
import type { ImportResult, SourceMeta } from "../types";

interface ParsedTable { name: string; columns: Array<{ name: string; type: string; flags: string }>; rawBody: string; }
interface ParsedRef { id: string; src: string; tgt: string; kind: ">" | "<" | "<>" | "-"; }

const TABLE_RE = /Table\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:as\s+\w+\s*)?\{([\s\S]*?)\n\}/g;
const COLUMN_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+([^\s\[\n]+)(?:\s*\[([^\]]*)\])?\s*$/;
const INLINE_REF_RE = /ref:\s*([<>]+|<>)\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/i;
const REF_RE = /Ref(?:\s+([A-Za-z_][A-Za-z0-9_]*))?\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*([<>]+|<>)\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;

/** Strip /* ... *​/, //... and -- ... comments. Preserves line count to keep
 * positions roughly intact (each comment becomes spaces of same length). */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const span = end < 0 ? src.length : end + 2;
      out += src.slice(i, span).replace(/[^\n]/g, " ");
      i = span;
    } else if (src[i] === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      const span = end < 0 ? src.length : end;
      out += src.slice(i, span).replace(/[^\n]/g, " ");
      i = span;
    } else {
      out += src[i++];
    }
  }
  return out;
}

const MAX_DBML_BYTES = 2 * 1024 * 1024;

export function importDbml(raw: string): ImportResult {
  if (raw.length > MAX_DBML_BYTES) {
    throw new Error(`DBML file quá lớn (${(raw.length / 1024 / 1024).toFixed(1)} MB). Giới hạn: 2 MB.`);
  }
  const stripped = stripComments(raw);
  const tables: ParsedTable[] = [];
  const refs: ParsedRef[] = [];
  const warnings: string[] = [];
  let refSeq = 0;

  // Tables
  TABLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TABLE_RE.exec(stripped)) !== null) {
    const name = m[1];
    const body = m[2];
    const cols: ParsedTable["columns"] = [];
    for (const line of body.split(/\r?\n/)) {
      const cm = COLUMN_RE.exec(line);
      if (cm) {
        cols.push({ name: cm[1], type: cm[2], flags: (cm[3] || "").trim() });
        // Inline ref: { ref: > other.id }
        const ir = INLINE_REF_RE.exec(cm[3] || "");
        if (ir) {
          refs.push({
            id: `__ref_${++refSeq}`,
            src: `${name}.${cm[1]}`,
            tgt: `${ir[2]}.${ir[3]}`,
            kind: ir[1] as ParsedRef["kind"],
          });
        }
      }
    }
    tables.push({ name, columns: cols, rawBody: body });
  }

  // Top-level Ref:
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(stripped)) !== null) {
    refs.push({
      id: m[1] || `__ref_${++refSeq}`,
      src: `${m[2]}.${m[3]}`,
      tgt: `${m[5]}.${m[6]}`,
      kind: m[4] as ParsedRef["kind"],
    });
  }

  if (tables.length === 0) warnings.push("Không tìm thấy table nào trong DBML.");

  // Build model with placeholder positions, then dagre LR layout.
  const model: CanvasModel = { nodes: [], edges: [] };
  const TABLE_W = 220;
  const ROW_H = 22;
  const HEAD_H = 36;

  const idByTable = new Map<string, string>();
  for (const t of tables) {
    const id = t.name;
    idByTable.set(t.name, id);
    // Map DBML flags → ErdCol.k. `pk`/`primary key` → PK; `ref:` → FK.
    const erdCols = t.columns.map((c) => {
      const flags = c.flags.toLowerCase();
      const isPk = /\bpk\b|\bprimary\s+key\b/.test(flags);
      const isFk = /\bref\s*:/.test(flags);
      return { k: (isPk ? "PK" : isFk ? "FK" : "") as "" | "PK" | "FK", name: c.name, type: c.type };
    });
    const height = HEAD_H + Math.max(1, erdCols.length) * ROW_H + 12;
    model.nodes.push({
      id,
      shape: "erd-entity",
      x: 0, y: 0,
      width: TABLE_W,
      height,
      label: t.name,
      attrs: {
        cols: erdCols,
        __source: { format: "dbml", sourceId: t.name, kind: "table", columns: t.columns },
      },
    });
  }

  // Edges: 1 ref = 1 edge between tables (deduplicate by pair to avoid clutter).
  const seenPairs = new Set<string>();
  for (const r of refs) {
    const [sTab] = r.src.split(".");
    const [tTab] = r.tgt.split(".");
    if (!idByTable.has(sTab) || !idByTable.has(tTab)) continue;
    const key = `${sTab}->${tTab}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    model.edges.push({
      id: r.id,
      source: sTab,
      target: tTab,
      label: r.kind,
      style: { stroke: "#7a8aa6", width: 1 },
    });
  }

  // Dagre layout LR.
  if (model.nodes.length) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80, marginx: 60, marginy: 60 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of model.nodes) g.setNode(n.id, { width: n.width, height: n.height });
    for (const e of model.edges) g.setEdge(e.source, e.target);
    dagre.layout(g);
    for (const n of model.nodes) {
      const dn = g.node(n.id);
      if (dn) { n.x = dn.x - n.width / 2; n.y = dn.y - n.height / 2; }
    }
  }

  const sourceMeta: SourceMeta = { format: "dbml", payload: { raw } };
  return { model, warnings, sourceMeta };
}
