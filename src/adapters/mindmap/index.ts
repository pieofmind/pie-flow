import { makeStubAdapter } from "../makeStubAdapter";
import { mindmapPaletteItems } from "./palette";
import { MindmapRenderer } from "./Renderer";
import { parseMindmapToCanvas, serializeMindmapFromCanvas } from "./parse";
import { validateMindmapSource, getMindmapTitle, setMindmapTitle } from "./sourceOps";

const stub = makeStubAdapter({
  id: "mindmap",
  displayName: "Mindmap",
  codeBlockLanguage: "mindmap",
  icon: "network",
  template: `# Central topic
## Branch A
### Leaf 1
### Leaf 2
## Branch B
### Leaf 3`,
});

export const mindmapAdapter = {
  ...stub,
  Renderer: MindmapRenderer,
  // Story 7-19
  validateSource: validateMindmapSource,
  getTitle: getMindmapTitle,
  setTitle: setMindmapTitle,
  paletteItems: mindmapPaletteItems,
  // Story 7-5d — unified canvas editor (heading tree ⇄ mm-* nodes).
  toEditor: (source: string) => {
    const model = parseMindmapToCanvas(source);
    return {
      model,
      title: getMindmapTitle(source),
      serialize: (m: import("../../canvas/types").CanvasModel, title?: string) => {
        const text = serializeMindmapFromCanvas(m);
        // Title (central topic) is the root H1; apply if the user edited it.
        return title !== undefined ? setMindmapTitle(text, title) : text;
      },
    };
  },
};
