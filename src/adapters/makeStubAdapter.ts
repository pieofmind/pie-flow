import type { DiagramAdapter, DiagramTypeId, ExportFormat } from "../core/adapter";
import { PlaceholderRenderer, PlaceholderEditor } from "../ui/Placeholder";

interface StubSpec {
  id: DiagramTypeId;
  displayName: string;
  codeBlockLanguage: string;
  icon: string;
  template: string;
  exportFormats?: ExportFormat[];
}

/**
 * M0 stub adapter: model is the raw text (identity parse/serialize),
 * placeholder renderer + source editor. Real adapters replace these per milestone.
 */
export function makeStubAdapter(spec: StubSpec): DiagramAdapter<string> {
  return {
    id: spec.id,
    displayName: spec.displayName,
    codeBlockLanguage: spec.codeBlockLanguage,
    icon: spec.icon,
    parse: (source) => source,
    serialize: (model) => model,
    emptyTemplate: () => spec.template,
    Renderer: PlaceholderRenderer,
    Editor: PlaceholderEditor,
    exportFormats: spec.exportFormats ?? ["svg", "png"],
    validate: () => ({ ok: true, errors: [] }),
  };
}
