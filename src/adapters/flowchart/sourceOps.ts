/**
 * Source-level operations on Flowchart raw JSON text — sync, side-effect free.
 * Mirrors the BPMN adapter sourceOps pattern (Story 7-8).
 *
 * Flowchart format: JSON-serialized CanvasModel with optional `title` field.
 * parse/serialize on the adapter operate on the parsed CanvasModel object
 * directly; these helpers operate on the raw text form for validateSource.
 */

import type { ParseIssue } from "../../core/adapter";
import type { CanvasModel } from "../../canvas/OmniboardCanvas";

const MAX_VALIDATE_SOURCE_LENGTH = 4 * 1024 * 1024; // 4 MB

interface FlowchartModelWithTitle extends CanvasModel {
  title?: string;
}

export function validateFlowchartSource(source: string): ParseIssue[] {
  if (!source || !source.trim()) {
    return [{ severity: "error", message: "Source rỗng" }];
  }
  if (source.length > MAX_VALIDATE_SOURCE_LENGTH) {
    return [{ severity: "error", message: "File quá lớn để kiểm tra nhanh (>4 MB)" }];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [{ severity: "error", message: `JSON không hợp lệ: ${msg.slice(0, 200)}` }];
  }

  if (!parsed || typeof parsed !== "object") {
    return [{ severity: "error", message: "Cấu trúc JSON không phải object" }];
  }

  const data = parsed as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    return [{ severity: "error", message: "Thiếu trường nodes hoặc edges (phải là array)" }];
  }

  return [];
}

/**
 * Extract optional title from a Flowchart CanvasModel.
 * Returns undefined for empty string per contract.
 */
export function getFlowchartTitle(model: CanvasModel): string | undefined {
  const m = model as FlowchartModelWithTitle;
  const t = m.title;
  if (typeof t !== "string" || t === "") return undefined;
  return t;
}

/**
 * Return a NEW model with the title applied.
 * Empty title removes the field. Immutable.
 *
 * Copies the `nodes`/`edges` array containers too (not just the top-level
 * object) so the returned model never shares mutable arrays with the input —
 * preventing a downstream array mutation from corrupting a retained snapshot
 * (e.g. an undo stack). Element identity is preserved (elements are treated
 * immutably elsewhere).
 */
export function setFlowchartTitle(model: CanvasModel, title: string): CanvasModel {
  const src = model as FlowchartModelWithTitle;
  const next: FlowchartModelWithTitle = {
    ...src,
    nodes: [...src.nodes],
    edges: [...src.edges],
  };
  if (title === "") {
    delete next.title;
  } else {
    next.title = title;
  }
  return next;
}
