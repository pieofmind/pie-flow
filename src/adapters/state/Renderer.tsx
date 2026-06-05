import { h } from "preact";
import { useMemo } from "preact/hooks";
import type { RendererProps } from "../../core/adapter";
import { CanvasPreview } from "../_shared/CanvasPreview";
import { parseStateToCanvas } from "./parse";

/** State Machine Renderer — Mermaid stateDiagram → st-* nodes via OmniboardCanvas. */
export function StateRenderer({ model }: RendererProps<string>) {
  const canvasModel = useMemo(() => {
    try {
      return parseStateToCanvas(model);
    } catch {
      return { nodes: [], edges: [] };
    }
  }, [model]);
  return <CanvasPreview model={canvasModel} />;
}
