import { makeStubAdapter } from "../makeStubAdapter";
import { statePaletteItems } from "./palette";
import { StateRenderer } from "./Renderer";
import { parseStateToCanvas, serializeStateFromCanvas } from "./parse";
import { validateStateSource, getStateTitle, setStateTitle } from "./sourceOps";
import type { CanvasModel } from "../../canvas/types";

const stub = makeStubAdapter({
  id: "state",
  displayName: "State Machine",
  codeBlockLanguage: "state",
  icon: "circle-dot",
  template: `---
positions:
  Draft: [100, 100]
  Submitted: [300, 100]
---
stateDiagram-v2
  [*] --> Draft
  Draft --> Submitted: submit
  Submitted --> Draft: reject`,
});

export const stateAdapter = {
  ...stub,
  Renderer: StateRenderer,
  // Story 7-19
  validateSource: validateStateSource,
  getTitle: getStateTitle,
  setTitle: setStateTitle,
  paletteItems: statePaletteItems,
  // Story 7-5d — unified canvas editor (Mermaid stateDiagram ⇄ st-* nodes).
  toEditor: (source: string) => {
    const model = parseStateToCanvas(source);
    return {
      model,
      title: getStateTitle(source),
      serialize: (m: CanvasModel, title?: string) => {
        const text = serializeStateFromCanvas(m);
        return title !== undefined ? setStateTitle(text, title) : text;
      },
    };
  },
};
