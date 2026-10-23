import type { CanvasModel } from "../../canvas/types";
import type { SourceMeta } from "../types";
import { exportBpmn } from "./export";
import { importBpmn } from "./import";

/** Show another diagram of the same BPMN file: first write the Board's edits of
 *  the current one into the file, then read diagram `index` from the result. */
export async function switchBpmnDiagram(
  model: CanvasModel,
  meta: SourceMeta,
  index: number,
): Promise<{ model: CanvasModel; sourceMeta: SourceMeta; warnings: string[] }> {
  const raw = await exportBpmn(model, meta);
  const { model: next, sourceMeta, warnings } = await importBpmn(raw, { diagramIndex: index });
  return { model: next, sourceMeta: sourceMeta as SourceMeta, warnings };
}
