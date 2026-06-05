import { h } from "preact";
import { useMemo } from "preact/hooks";
import type { RendererProps } from "../../core/adapter";
import { CanvasPreview } from "../_shared/CanvasPreview";
import { importDbml } from "../../io/dbml/import";

/**
 * DBML Renderer — read-only inline preview via the shared OmniboardCanvas.
 * `importDbml` (sync) parses the DBML source into a dagre-laid-out CanvasModel
 * of `erd-entity` nodes + relationship edges.
 */
export function DbmlRenderer({ model }: RendererProps<string>) {
  const canvasModel = useMemo(() => {
    try {
      return importDbml(model).model;
    } catch {
      return { nodes: [], edges: [] };
    }
  }, [model]);
  return <CanvasPreview model={canvasModel} />;
}
