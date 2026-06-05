import { h } from "preact";
import { useMemo } from "preact/hooks";
import type { RendererProps } from "../../core/adapter";
import { CanvasPreview } from "../_shared/CanvasPreview";
import { parseSequenceToCanvas } from "./parse";

/** Sequence Renderer — Mermaid sequenceDiagram → sq-* lifelines via OmniboardCanvas. */
export function SequenceRenderer({ model }: RendererProps<string>) {
  const canvasModel = useMemo(() => {
    try {
      return parseSequenceToCanvas(model);
    } catch {
      return { nodes: [], edges: [] };
    }
  }, [model]);
  return <CanvasPreview model={canvasModel} />;
}
