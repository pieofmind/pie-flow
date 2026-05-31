import type { DiagramAdapter } from "../../core/adapter";
import type { CanvasModel } from "../../canvas/OmniboardCanvas";
import { parseFlowchart, serializeFlowchart, emptyFlowchart } from "./model";
import { FlowchartEditor } from "./Editor";
import { FlowchartRenderer } from "./Renderer";

export const flowchartAdapter: DiagramAdapter<CanvasModel> = {
  id: "flowchart",
  displayName: "Flowchart",
  codeBlockLanguage: "flowchart",
  icon: "workflow",
  parse: parseFlowchart,
  serialize: serializeFlowchart,
  emptyTemplate: emptyFlowchart,
  Renderer: FlowchartRenderer,
  Editor: FlowchartEditor,
  exportFormats: ["svg", "png"],
  validate: () => ({ ok: true, errors: [] }),
};
