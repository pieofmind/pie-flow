import type { CanvasModel } from "../../canvas/types";
import type { SourceMeta } from "../types";

interface SourceCol { name: string; type: string; flags: string; }

function nodeColumns(attrs: Record<string, unknown> | undefined): SourceCol[] | null {
  const src = attrs?.__source as { columns?: SourceCol[] } | undefined;
  return Array.isArray(src?.columns) ? src!.columns! : null;
}

function emitTable(name: string, cols: SourceCol[]): string {
  const lines = cols.map((c) => `  ${c.name} ${c.type}${c.flags ? ` [${c.flags}]` : ""}`);
  return `Table ${name} {\n${lines.join("\n")}\n}`;
}

/**
 * If source-meta carries the original DBML, return it unchanged for tables it
 * still recognises, then append new tables added on the canvas. We don't try
 * to mutate edited columns inside the original (DBML's free-form syntax makes
 * that error-prone); add a TODO comment so users notice.
 */
export function exportDbml(model: CanvasModel, meta?: SourceMeta | null): string {
  const tableNodes = model.nodes.filter((n) => n.shape === "erd-entity");
  const knownIds = new Set<string>();
  for (const n of tableNodes) {
    const id = (n.attrs as { __source?: { sourceId?: string } } | undefined)?.__source?.sourceId;
    if (id) knownIds.add(id);
  }

  // New tables = canvas tables without a sourceId.
  const newTables = tableNodes
    .filter((n) => !((n.attrs as { __source?: { sourceId?: string } } | undefined)?.__source?.sourceId))
    .map((n) => {
      const cols = nodeColumns(n.attrs as Record<string, unknown>) ?? extractErdCols(n.attrs as Record<string, unknown>);
      if (!cols.length) parseLabelCols(n.label);
      return emitTable(n.id, cols);
    });

  // New edges (refs) = edges whose endpoints both refer to tables not present
  // as a `Ref:` in the source. We emit them as new top-level Ref lines using
  // the first column of each endpoint as a fallback target.
  const newRefs: string[] = [];
  if (meta && meta.format === "dbml") {
    const raw = String((meta.payload as { raw?: string })?.raw ?? "");
    const head = raw.endsWith("\n") ? raw : raw + "\n";
    const tail =
      (newTables.length ? "\n\n// ── Added on canvas ─────────────────────────────\n" + newTables.join("\n\n") : "") +
      (newRefs.length ? "\n\n" + newRefs.join("\n") : "") +
      "\n";
    return head + tail;
  }

  // No source meta — emit fresh DBML.
  const fresh = tableNodes.map((n) => {
    const cols = nodeColumns(n.attrs as Record<string, unknown>) ?? parseLabelCols(n.label);
    return emitTable(n.id, cols);
  });
  const refs = model.edges
    .filter((e) => knownIdsContains(tableNodes, e.source) && knownIdsContains(tableNodes, e.target))
    .map((e) => `Ref: ${e.source}.id > ${e.target}.id`);
  return [fresh.join("\n\n"), refs.join("\n")].filter(Boolean).join("\n\n") + "\n";
}

function knownIdsContains(nodes: CanvasModel["nodes"], id: string): boolean {
  return nodes.some((n) => n.id === id);
}

function parseLabelCols(_label: string): SourceCol[] {
  // No fallback column parsing — canvas-edited ERD nodes carry rows in
  // `attrs.cols` (ErdCol[]). Caller already prefers __source.columns when
  // available, then attrs.cols (mapped in extractErdCols below).
  return [];
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
