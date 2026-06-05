import { h } from "preact";
import { useMemo } from "preact/hooks";
import type { RendererProps } from "../../core/adapter";
import { CanvasPreview } from "../_shared/CanvasPreview";
import { importDbml } from "../../io/dbml/import";

/**
 * ERD Renderer — read-only inline preview via the shared OmniboardCanvas.
 * The ERD source format is DBML-lite (`Table x { ... }`), so it reuses the
 * DBML importer → dagre-laid-out CanvasModel of `erd-entity` nodes. Custom
 * `// @diagram-*` comment lines are ignored by the parser.
 */
export function ErdRenderer({ model }: RendererProps<string>) {
  const canvasModel = useMemo(() => {
    try {
      return importDbml(model).model;
    } catch {
      return { nodes: [], edges: [] };
    }
  }, [model]);
  return <CanvasPreview model={canvasModel} />;
}
