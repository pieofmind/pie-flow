import type { DiagramAdapter, ParseIssue, ValidationResult } from "../../core/adapter";
import { BpmnRenderer } from "./Renderer";
import { BpmnEditor } from "./Editor";
import { bpmnPaletteItems } from "./palette";
import { importBpmn } from "../../io/bpmn/import";
import { exportBpmn } from "../../io/bpmn/export";
import { hasDegenerateLayout, layoutWithDagre } from "../_shared/layout";
import {
  getBpmnTitle,
  setBpmnTitle,
  validateBpmnSource,
} from "./sourceOps";

const TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" name="Start"/>
  </bpmn:process>
</bpmn:definitions>`;

/**
 * BPMN 2.0 adapter (Story 7-8 — migrated from stub).
 *
 * Design notes:
 * - TModel = raw XML string. The adapter contract is sync, but
 *   `importBpmn`/`exportBpmn` are async (they walk the bpmn-moddle tree).
 *   To preserve the contract without breaking every call site, the async
 *   work happens inside `Renderer`/`Editor` via `useEffect`. `parse` and
 *   `serialize` are identity on the raw XML string.
 * - `validateSource` is a sync best-effort check (XML well-formedness +
 *   presence of `bpmn:definitions`). Full semantic validation lives in
 *   `io/bpmn/validator.ts` and runs at higher levels.
 * - `getTitle`/`setTitle` operate on the FIRST `<bpmn:process>` tag's
 *   `name` attribute via regex — lossless, no moddle parse required.
 * - `paletteItems` is a static declarative schema (no model dependency).
 *   Selection dispatch happens at the BoardEditor / PaletteSidebar level
 *   via `onSelectItem`.
 */
export const bpmnAdapter: DiagramAdapter<string> = {
  id: "bpmn",
  displayName: "BPMN 2.0",
  codeBlockLanguage: "bpmn",
  icon: "git-fork",
  exportFormats: ["svg", "png", "pdf"],

  parse: (source) => source,
  serialize: (model) => model,
  emptyTemplate: () => TEMPLATE,

  Renderer: BpmnRenderer,
  Editor: BpmnEditor,

  validate: (_model): ValidationResult => ({ ok: true, errors: [] }),

  validateSource: (source: string): ParseIssue[] => validateBpmnSource(source),
  getTitle: (model: string): string | undefined => getBpmnTitle(model),
  setTitle: (model: string, title: string): string => setBpmnTitle(model, title),

  paletteItems: bpmnPaletteItems,

  // Story 7-5c — BpmnEditor is a visual/canvas editor; the process name is not
  // shown in the edit surface, so a header title input is the single authority.
  titleEditableInHeader: true,
  // Story 7-5d — unified canvas editor. importBpmn is async; the serialize
  // closure captures sourceMeta for a faithful XML round-trip + applies the
  // edited process name (title).
  toEditor: async (source) => {
    const result = await importBpmn(source);
    if (hasDegenerateLayout(result.model)) layoutWithDagre(result.model, "LR");
    return {
      model: result.model,
      title: getBpmnTitle(source),
      serialize: async (m, title) => {
        const xml = await exportBpmn(m, result.sourceMeta);
        return title !== undefined ? setBpmnTitle(xml, title) : xml;
      },
    };
  },
};
