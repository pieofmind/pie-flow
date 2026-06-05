import { makeStubAdapter } from "../makeStubAdapter";
import { erdPaletteItems } from "./palette";
import { ErdRenderer } from "./Renderer";
import { validateErdSource, getErdTitle, setErdTitle } from "./sourceOps";
import { importDbml } from "../../io/dbml/import";
import { exportDbml } from "../../io/dbml/export";

const stub = makeStubAdapter({
  id: "erd",
  displayName: "ER Diagram",
  codeBlockLanguage: "erd",
  icon: "table",
  template: `// @diagram-version: 1
Table customers {
  id int [pk]
  name varchar
  // @pos: 120,80
}`,
});

export const erdAdapter = {
  ...stub,
  Renderer: ErdRenderer,
  // Story 7-18
  validateSource: validateErdSource,
  getTitle: getErdTitle,
  setTitle: setErdTitle,
  paletteItems: erdPaletteItems,
  // Story 7-5d — unified canvas editor (ERD is DBML-lite → reuse DBML io).
  toEditor: (source: string) => {
    const r = importDbml(source);
    return {
      model: r.model,
      title: getErdTitle(source),
      serialize: (m: import("../../canvas/types").CanvasModel, title?: string) => {
        const s = exportDbml(m, r.sourceMeta);
        return title !== undefined ? setErdTitle(s, title) : s;
      },
    };
  },
};
