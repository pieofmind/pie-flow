import { h } from "preact";
import { useMemo } from "preact/hooks";
import type { RendererProps } from "../../core/adapter";
import { CanvasPreview } from "../_shared/CanvasPreview";
import { parseMindmapToCanvas } from "./parse";

/** Mindmap Renderer — heading tree → mm-* nodes via the shared OmniboardCanvas. */
export function MindmapRenderer({ model }: RendererProps<string>) {
  const canvasModel = useMemo(() => {
    try {
      return parseMindmapToCanvas(model);
    } catch {
      return { nodes: [], edges: [] };
    }
  }, [model]);
  return <CanvasPreview model={canvasModel} />;
}
