import type { CanvasModel } from "../canvas/types";

export type FormatId = "bpmn" | "dbml" | "mermaid" | "jsoncanvas" | "drawio" | "excalidraw" | "plantuml" | "dot";

/** Per-format metadata captured at import time, kept verbatim for round-trip export. */
export interface SourceMeta {
  format: FormatId;
  /** Format-specific blob (header/namespaces/comments/unknown elements). JSON-serializable. */
  payload: Record<string, unknown>;
}

export interface ImportResult {
  model: CanvasModel;
  warnings: string[];
  sourceMeta: SourceMeta;
}

export interface ImportOptions {
  diagramIndex?: number;
}

export type Importer = (raw: string, options?: ImportOptions) => Promise<ImportResult> | ImportResult;
export type Exporter = (model: CanvasModel, meta?: SourceMeta | null) => Promise<string> | string;

export interface FormatDescriptor {
  id: FormatId;
  displayName: string;
  /** Lowercase, no leading dot. */
  extensions: string[];
  importer: Importer;
  exporter: Exporter;
}
