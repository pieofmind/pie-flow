import { makeStubAdapter } from "../makeStubAdapter";
import { sequencePaletteItems } from "./palette";
import { SequenceRenderer } from "./Renderer";
import { parseSequenceToCanvas, serializeSequenceFromCanvas } from "./parse";
import {
  validateSequenceSource,
  getSequenceTitle,
  setSequenceTitle,
} from "./sourceOps";
import type { CanvasModel } from "../../canvas/types";

const stub = makeStubAdapter({
  id: "sequence",
  displayName: "Sequence",
  codeBlockLanguage: "sequence",
  icon: "arrow-left-right",
  template: `sequenceDiagram
  participant A as Client
  participant B as Server
  A->>B: Request
  B-->>A: Response`,
});

export const sequenceAdapter = {
  ...stub,
  Renderer: SequenceRenderer,
  // Story 7-16 — additive contract fields
  validateSource: validateSequenceSource,
  getTitle: getSequenceTitle,
  setTitle: setSequenceTitle,
  paletteItems: sequencePaletteItems,
  // Story 7-5d — unified canvas editor (Mermaid sequenceDiagram ⇄ sq-* lifelines).
  toEditor: (source: string) => {
    const model = parseSequenceToCanvas(source);
    return {
      model,
      title: getSequenceTitle(source),
      serialize: (m: CanvasModel, title?: string) => {
        const text = serializeSequenceFromCanvas(m);
        return title !== undefined ? setSequenceTitle(text, title) : text;
      },
    };
  },
};
