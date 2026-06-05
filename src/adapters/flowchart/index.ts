import type { DiagramAdapter } from "../../core/adapter";
import type { CanvasModel } from "../../canvas/OmniboardCanvas";
import { parseFlowchart, serializeFlowchart, emptyFlowchart } from "./model";
import { FlowchartRenderer } from "./Renderer";
import { PlaceholderEditor } from "../../ui/Placeholder";
import { flowchartPaletteItems } from "./palette";
import { SHAPE_CATEGORIES } from "../../canvas/shapes/index";
import { getFlowchartPropertyFields } from "./propertyFields";
import {
  validateFlowchartSource,
  getFlowchartTitle,
  setFlowchartTitle,
} from "./sourceOps";

export const flowchartAdapter: DiagramAdapter<CanvasModel> = {
  id: "flowchart",
  displayName: "Flowchart",
  codeBlockLanguage: "flowchart",
  icon: "workflow",
  parse: parseFlowchart,
  serialize: serializeFlowchart,
  emptyTemplate: emptyFlowchart,
  Renderer: FlowchartRenderer,
  // Flowchart is canvas-native (see canvasShapeCategories) — the modal always
  // takes the BoardEditor canvas branch, so `Editor` is never reached. A
  // placeholder satisfies the required contract field without dead canvas code.
  Editor: PlaceholderEditor as unknown as DiagramAdapter<CanvasModel>["Editor"],
  exportFormats: ["svg", "png"],
  validate: () => ({ ok: true, errors: [] }),
  // Story 7-15
  validateSource: validateFlowchartSource,
  getTitle: getFlowchartTitle,
  setTitle: setFlowchartTitle,
  paletteItems: flowchartPaletteItems,
  // Story 7-8b — function-form property fields proof
  getPropertyFields: getFlowchartPropertyFields,
  // Story 7-5b — canvas-native: editable directly in BoardEditor's canvas slot
  canvasShapeCategories: SHAPE_CATEGORIES,
  // Story 7-5d — unified canvas editor (model is already a CanvasModel).
  toEditor: (source) => {
    const model = parseFlowchart(source);
    return {
      model,
      title: getFlowchartTitle(model),
      serialize: (m, title) =>
        serializeFlowchart(title !== undefined ? setFlowchartTitle(m, title) : m),
    };
  },
};
