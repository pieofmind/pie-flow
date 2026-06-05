import { h } from "preact";
import { useMemo } from "preact/hooks";
import type { RendererProps } from "../../core/adapter";
import { CanvasPreview } from "../_shared/CanvasPreview";
import { parseUmlToCanvas } from "./parse";

/** UML Class Renderer — PlantUML class → uml-* nodes via OmniboardCanvas. */
export function UmlRenderer({ model }: RendererProps<string>) {
  const canvasModel = useMemo(() => {
    try {
      return parseUmlToCanvas(model);
    } catch {
      return { nodes: [], edges: [] };
    }
  }, [model]);
  return <CanvasPreview model={canvasModel} />;
}
