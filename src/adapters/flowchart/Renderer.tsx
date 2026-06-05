import { h } from "preact";
import type { RendererProps } from "../../core/adapter";
import type { CanvasModel } from "../../canvas/OmniboardCanvas";
import { CanvasPreview } from "../_shared/CanvasPreview";

/**
 * Flowchart Renderer — read-only inline preview via the shared static-SVG
 * `CanvasPreview` (renderModelToSvg). The model is already a CanvasModel, so
 * no parsing is needed. The old private X6 graph (with the now-unregistered
 * `fc-start` shapes) is gone — same render path as every other card.
 */
export function FlowchartRenderer({ model }: RendererProps<CanvasModel>) {
  return <CanvasPreview model={model} />;
}
