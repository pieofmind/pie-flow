import type { DiagramAdapter } from "../../core/adapter";
import { PlaceholderEditor } from "../../ui/Placeholder";
import { DbmlRenderer } from "./Renderer";
import { dbmlPaletteItems } from "./palette";
import { importDbml } from "../../io/dbml/import";
import { exportDbml } from "../../io/dbml/export";
import {
  validateDbmlSource,
  getDbmlTitle,
  setDbmlTitle,
} from "./sourceOps";

const TEMPLATE = `Project example {
  database_type: 'omniboard'
}

Table users {
  id int [pk]
  email varchar
  created_at timestamp
}

Table orders {
  id int [pk]
  user_id int [ref: > users.id]
  total decimal
}`;

/**
 * DBML adapter (Story 7-17 — create + minimum migrate).
 *
 * Design notes:
 * - TModel = string (raw DBML text). parse/serialize identity. Sync contract.
 * - importDbml/exportDbml (sync) live at io/dbml; this adapter exposes them
 *   declaratively but does NOT wire them in the Renderer/Editor yet —
 *   placeholder stubs render the raw source. Wiring is deferred to a
 *   future story when real WYSIWYG ERD-style canvas for DBML is built.
 * - validateSource is a sync best-effort check (presence of Table block).
 * - getTitle/setTitle operate on the optional `Project <name> { ... }` block.
 * - paletteItems is a static declarative schema.
 */
export const dbmlAdapter: DiagramAdapter<string> = {
  id: "dbml",
  displayName: "DBML",
  codeBlockLanguage: "dbml",
  icon: "database",
  exportFormats: ["svg", "png"],

  parse: (source) => source,
  serialize: (model) => model,
  emptyTemplate: () => TEMPLATE,

  Renderer: DbmlRenderer,
  Editor: PlaceholderEditor,

  validate: () => ({ ok: true, errors: [] }),

  validateSource: validateDbmlSource,
  getTitle: getDbmlTitle,
  setTitle: setDbmlTitle,

  paletteItems: dbmlPaletteItems,
  // Story 7-5d — unified canvas editor (importDbml/exportDbml are sync).
  toEditor: (source) => {
    const r = importDbml(source);
    return {
      model: r.model,
      title: getDbmlTitle(source),
      serialize: (m, title) => {
        const s = exportDbml(m, r.sourceMeta);
        return title !== undefined ? setDbmlTitle(s, title) : s;
      },
    };
  },
};
