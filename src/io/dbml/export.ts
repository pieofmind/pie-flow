import type { CanvasModel } from "../../canvas/types";
import type { SourceMeta } from "../types";

interface SourceCol { name: string; type: string; flags: string; }

function nodeColumns(attrs: Record<string, unknown> | undefined): SourceCol[] | null {
  const src = attrs?.__source as { columns?: SourceCol[] } | undefined;
  return Array.isArray(src?.columns) ? src!.columns! : null;
}

function emitTable(name: string, cols: SourceCol[]): string {
  const body = cols.length
    ? cols.map((c) => `  ${c.name} ${c.type}${c.flags ? ` [${c.flags}]` : ""}`).join("\n")
    : `  id integer [pk]`;
  return `Table ${name} {\n${body}\n}`;
}

/** DBML table/column identifiers: [A-Za-z_][A-Za-z0-9_]*. Sanitize anything
 *  else (UUID hyphens, spaces, leading digits) so dbdiagram.io parses cleanly. */
function sanitizeIdent(raw: string, fallback: string): string {
  const base = (raw || "").trim() || fallback;
  let s = base.replace(/[^A-Za-z0-9_]/g, "_");
  if (!s || /^[0-9]/.test(s)) s = "t_" + s;
  return s;
}

/** Build node-id → unique DBML table name. Prefers node.label, falls back to
 *  node.id; disambiguates collisions with a numeric suffix. */
function buildNameMap(nodes: CanvasModel["nodes"]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const n of nodes) {
    const src = (n.attrs as { __source?: { sourceId?: string } } | undefined)?.__source?.sourceId;
    const seed = src || n.label || n.id;
    let name = sanitizeIdent(seed, n.id);
    let i = 2;
    while (used.has(name)) name = `${sanitizeIdent(seed, n.id)}_${i++}`;
    used.add(name);
    out.set(n.id, name);
  }
  return out;
}

/**
 * If source-meta carries the original DBML, return it unchanged for tables it
 * still recognises, then append new tables added on the canvas. We don't try
 * to mutate edited columns inside the original (DBML's free-form syntax makes
 * that error-prone); add a TODO comment so users notice.
 */
export function exportDbml(model: CanvasModel, meta?: SourceMeta | null): string {
  const tableNodes = model.nodes.filter((n) => n.shape === "erd-entity");
  const nameOf = buildNameMap(tableNodes);

  // New tables = canvas tables without a sourceId.
  const newTables = tableNodes
    .filter((n) => !((n.attrs as { __source?: { sourceId?: string } } | undefined)?.__source?.sourceId))
    .map((n) => {
      const cols = nodeColumns(n.attrs as Record<string, unknown>) ?? extractErdCols(n.attrs as Record<string, unknown>);
      return emitTable(nameOf.get(n.id) ?? sanitizeIdent(n.label, n.id), cols);
    });

  // New edges (refs) = edges whose endpoints both refer to tables not present
  // as a `Ref:` in the source. We emit them as new top-level Ref lines using
  // the first column of each endpoint as a fallback target.
  const newRefs: string[] = [];
  if (meta && meta.format === "dbml") {
    const raw = String((meta.payload as { raw?: string })?.raw ?? "");
    const head = raw.endsWith("\n") ? raw : raw + "\n";
    // Detect columns the user edited on the canvas (compared to the captured
    // __source.columns) so we can surface a loud warning instead of silently
    // dropping the edits.
    const edited: string[] = [];
    for (const n of tableNodes) {
      const src = (n.attrs as { __source?: { sourceId?: string; columns?: SourceCol[] } } | undefined)?.__source;
      if (!src?.sourceId) continue;
      const canvasCols = extractErdCols(n.attrs as Record<string, unknown>);
      const origCols = src.columns ?? [];
      if (canvasCols.length !== origCols.length) { edited.push(src.sourceId); continue; }
      for (let i = 0; i < canvasCols.length; i++) {
        if (
          canvasCols[i].name !== origCols[i].name ||
          canvasCols[i].type !== origCols[i].type ||
          canvasCols[i].flags !== origCols[i].flags
        ) {
          edited.push(src.sourceId);
          break;
        }
      }
    }
    const warningHeader = edited.length
      ? `// ⚠ WARNING: column edits on canvas for table(s) [${edited.join(", ")}] are NOT reflected\n` +
        `//   in the original DBML below (this exporter preserves source verbatim).\n` +
        `//   Re-create those tables outside the original block to apply edits.\n\n`
      : "";
    const tail =
      (newTables.length ? "\n\n// ── Added on canvas ─────────────────────────────\n" + newTables.join("\n\n") : "") +
      (newRefs.length ? "\n\n" + newRefs.join("\n") : "") +
      "\n";
    return warningHeader + head + tail;
  }

  // No source meta — emit fresh DBML.
  const fresh = tableNodes.map((n) => {
    const cols = nodeColumns(n.attrs as Record<string, unknown>) ?? extractErdCols(n.attrs as Record<string, unknown>);
    return emitTable(nameOf.get(n.id) ?? sanitizeIdent(n.label, n.id), cols);
  });
  const refs = model.edges
    .filter((e) => nameOf.has(e.source) && nameOf.has(e.target))
    .map((e) => `Ref: ${nameOf.get(e.source)}.id > ${nameOf.get(e.target)}.id`);
  return [fresh.join("\n\n"), refs.join("\n")].filter(Boolean).join("\n\n") + "\n";
}

/** Promote canvas ErdCol[] (k/name/type) back to DBML SourceCol (name/type/flags). */
export function extractErdCols(attrs: Record<string, unknown> | undefined): SourceCol[] {
  const cols = attrs?.cols as Array<{ k: string; name: string; type: string }> | undefined;
  if (!Array.isArray(cols)) return [];
  return cols.map((c) => ({
    name: c.name,
    type: c.type,
    flags: c.k === "PK" ? "pk" : "",
  }));
}
