import { makeStubAdapter } from "../makeStubAdapter";
import { umlPaletteItems } from "./palette";
import { UmlRenderer } from "./Renderer";
import { parseUmlToCanvas, serializeUmlFromCanvas } from "./parse";
import { validateUmlSource, getUmlTitle, setUmlTitle } from "./sourceOps";
import type { CanvasModel } from "../../canvas/types";

const stub = makeStubAdapter({
  id: "uml",
  displayName: "UML Class",
  codeBlockLanguage: "uml",
  icon: "box",
  template: `@startuml
' @pos Customer: 100,50
class Customer {
  +id: int
  +name: string
  +placeOrder(): Order
}
@enduml`,
});

export const umlAdapter = {
  ...stub,
  Renderer: UmlRenderer,
  // Story 7-19
  validateSource: validateUmlSource,
  getTitle: getUmlTitle,
  setTitle: setUmlTitle,
  paletteItems: umlPaletteItems,
  // Story 7-5d — unified canvas editor (PlantUML class ⇄ uml-* nodes).
  toEditor: (source: string) => {
    const model = parseUmlToCanvas(source);
    return {
      model,
      title: getUmlTitle(source),
      serialize: (m: CanvasModel, title?: string) => {
        const text = serializeUmlFromCanvas(m);
        return title !== undefined ? setUmlTitle(text, title) : text;
      },
    };
  },
};
