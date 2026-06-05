import dagre from "@dagrejs/dagre";
import type { CanvasModel } from "../../canvas/types";
import type { ImportResult, SourceMeta } from "../types";

interface ParsedTable { name: string; columns: Array<{ name: string; type: string; flags: string }>; rawBody: string; }
interface ParsedRef { id: string; src: string; tgt: string; kind: ">" | "<" | "<>" | "-"; srcNullable?: boolean; tooltip?: string }

/** Story 2.5 — extract ondelete metadata from DBML flag string or note text.
 *  Supports both `[delete: cascade]` (DBML 2.x) and `ondelete=CASCADE` inside
 *  free-form `note: '...'` text used by older specs. */
function extractOndelete(flags: string): string | undefined {
  const m1 = /\b(?:on)?delete\s*[:=]\s*([a-z\-]+)/i.exec(flags);
  if (m1) return `ondelete: ${m1[1].toUpperCase()}`;
  return undefined;
}

/** Crow's foot marker mapping for DBML ref kinds (Story 2.4).
 *   `>` = N→1 (many-to-one): source=many, target=one
 *   `<` = 1→N (one-to-many): source=one, target=many
 *   `<>` = N↔M: both ends many
 *   `-` = 1↔1: both ends one
 *  Nullable source FK swaps "one" → "zero-or-one", "many" → "zero-or-many". */
function cardinalityMarkers(kind: ParsedRef["kind"], srcNullable?: boolean) {
  const opt = (m: string) => (srcNullable
    ? (m === "bar" ? "circle-bar" : m === "crow" ? "crow-circle" : m)
    : m);
  switch (kind) {
    case ">": return { source: opt("crow"), target: "bar" };
    case "<": return { source: opt("bar"), target: "crow" };
    case "<>": return { source: opt("crow"), target: "crow" };
    case "-": return { source: opt("bar"), target: "bar" };
    default: return { source: "crow", target: "bar" };
  }
}

const TABLE_RE = /Table\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:as\s+\w+\s*)?\{([\s\S]*?)\n\}/g;
const COLUMN_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+([^\s\[\n]+)(?:\s*\[([^\]]*)\])?\s*$/;
const INLINE_REF_RE = /ref:\s*([<>]+|<>)\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/i;
const REF_RE = /Ref(?:\s+([A-Za-z_][A-Za-z0-9_]*))?\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*([<>]+|<>)\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;
const TABLEGROUP_RE = /TableGroup\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\n\}/g;

/** dbdiagram.io-style 6-color palette for cluster headers. Cycles for >6 groups. */
// Skip blueish #5E8FB9 — matches the default --pg-accent ERD header color
// so a cluster picking it would render visually indistinguishable.
const CLUSTER_PALETTE = ["#C99A2E", "#E07B5C", "#7BAE7F", "#9A6BB5", "#C76B6B", "#3D7BCC"];

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
          const flags = (cm[3] || "").toLowerCase();
          // Nullable detection (Story 2.4): explicit `null` keyword OR absence
          // of `not null`/`pk`. PK columns are implicitly NOT NULL.
          const isPk = /\bpk\b|\bprimary\s+key\b/.test(flags);
          const isNotNull = /\bnot\s+null\b/.test(flags);
          const explicitNull = /\bnull\b(?!\s+null)/.test(flags) && !isNotNull;
          const srcNullable = !isPk && !isNotNull ? (explicitNull || true) : false;
          refs.push({
            id: `__ref_${++refSeq}`,
            src: `${name}.${cm[1]}`,
            tgt: `${ir[2]}.${ir[3]}`,
            kind: ir[1] as ParsedRef["kind"],
            srcNullable,
            tooltip: extractOndelete(cm[3] || ""),
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

  // ── TableGroup parsing (Story 1.1) ──────────────────────────────────────
  // Format: `TableGroup name { tableA tableB ... }` — assign each table to a
  // single cluster; first group wins on conflict, ghost tables emit warnings.
  const tableToGroup = new Map<string, string>();
  const groupOrder: string[] = [];
  const tableSet = new Set(tables.map((t) => t.name));
  TABLEGROUP_RE.lastIndex = 0;
  let gm: RegExpExecArray | null;
  while ((gm = TABLEGROUP_RE.exec(stripped)) !== null) {
    const groupName = gm[1];
    const body = gm[2];
    if (!groupOrder.includes(groupName)) groupOrder.push(groupName);
    for (const rawLine of body.split(/\r?\n/)) {
      const tableName = rawLine.trim().replace(/[,;]+$/, "");
      if (!tableName) continue;
      if (!tableSet.has(tableName)) {
        warnings.push(`TableGroup '${groupName}' references unknown table '${tableName}'; skipped`);
        continue;
      }
      if (tableToGroup.has(tableName)) {
        warnings.push(
          `Table '${tableName}' belongs to multiple TableGroups; using '${tableToGroup.get(tableName)}'`
        );
        continue;
      }
      tableToGroup.set(tableName, groupName);
    }
  }

  // Build model with placeholder positions, then dagre LR layout.
  const model: CanvasModel = { nodes: [], edges: [] };
  const TABLE_W = 220;
  // Generous so the static card preview isn't clipped; the live canvas also
  // auto-grows erd-entity nodes to the real DOM height after load.
  const ROW_H = 27;
  const HEAD_H = 38;

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
    const groupName = tableToGroup.get(t.name);
    const headerColor = groupName
      ? CLUSTER_PALETTE[groupOrder.indexOf(groupName) % CLUSTER_PALETTE.length]
      : undefined;
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
        ...(groupName ? { __group: groupName, __headerColor: headerColor } : {}),
      },
    });
  }

  // Edges: 1 ref = 1 edge, neo vào row cột FK→PK (Story 2.3).
  // No more dedup by pair: each Ref is a distinct relationship column-to-column.
  // Skip refs whose source/target table not parsed (ghost ref warning).
  for (const r of refs) {
    const [sTab, sCol] = r.src.split(".");
    const [tTab, tCol] = r.tgt.split(".");
    if (!idByTable.has(sTab)) {
      warnings.push(`Ref skipped: source table '${sTab}' not found`);
      continue;
    }
    if (!idByTable.has(tTab)) {
      warnings.push(`Ref skipped: target table '${tTab}' not found`);
      continue;
    }
    const markers = cardinalityMarkers(r.kind, r.srcNullable);
    model.edges.push({
      id: r.id,
      source: sTab,
      sourcePort: `col:${sCol}-right`,
      target: tTab,
      targetPort: `col:${tCol || "id"}-left`,
      label: r.kind,
      router: "orth",
      style: { stroke: "#7a8aa6", width: 1, start: markers.source, end: markers.target },
      ...(r.tooltip ? { attrs: { tooltip: r.tooltip } } : {}),
    });
  }

  // Dagre layout LR — compound graph (Story 1.2): nodes within the same
  // TableGroup are placed under a cluster parent so dagre keeps them adjacent.
  // Spacing tuned wider than the legacy 40/80 because column-level edges (Epic 2)
  // need elbow room to dock at row Y without crossing neighbors.
  if (model.nodes.length) {
    const g = new dagre.graphlib.Graph({ compound: true });
    g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 120, marginx: 60, marginy: 60 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of model.nodes) g.setNode(n.id, { width: n.width, height: n.height });
    // Register one cluster parent per TableGroup, then re-parent member nodes.
    for (const groupName of groupOrder) {
      g.setNode(`__cluster:${groupName}`, {} as never);
    }
    for (const [tableName, groupName] of tableToGroup) {
      g.setParent(tableName, `__cluster:${groupName}`);
    }
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
