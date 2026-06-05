import type {
  PropertyFieldsContext,
  PropertyFieldSchema,
} from "../../core/adapter";
import type { CanvasModel } from "../../canvas/OmniboardCanvas";
import { getFlowchartTitle, setFlowchartTitle } from "./sourceOps";

/**
 * Story 7-8b proof — function-form property fields for the Flowchart adapter.
 *
 * Demonstrates the contract: the "Tiêu đề" field reads its value from the
 * live model (`getFlowchartTitle`) and dispatches an immutable update through
 * `ctx.setModel` (`setFlowchartTitle`). No static array could express this —
 * the `onChange` closure needs the current model.
 */
export function getFlowchartPropertyFields(
  ctx: PropertyFieldsContext<CanvasModel>,
): ReadonlyArray<PropertyFieldSchema> {
  return [
    {
      kind: "text",
      key: "title",
      label: "Tiêu đề",
      value: getFlowchartTitle(ctx.model) ?? "",
      placeholder: "Tên sơ đồ",
      onChange: (next: string) => {
        ctx.setModel(setFlowchartTitle(ctx.model, next));
      },
    },
  ];
}
