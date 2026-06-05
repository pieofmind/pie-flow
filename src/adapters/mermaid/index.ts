import { makeStubAdapter } from "../makeStubAdapter";
import { MermaidRenderer } from "./MermaidRenderer";
import { mermaidPaletteItems } from "./palette";
import {
  validateMermaidSource,
  getMermaidTitle,
  setMermaidTitle,
} from "./sourceOps";

/**
 * Mermaid (enhanced) — coexists with Obsidian's built-in `mermaid` block. This
 * adapter uses the `mermaid-dx` language tag so users can opt into a Pie-warm
 * theme and an edit modal without overriding the native renderer.
 */
export const mermaidAdapter = {
  ...makeStubAdapter({
    id: "mermaid",
    displayName: "Mermaid (enhanced)",
    codeBlockLanguage: "mermaid-dx",
    icon: "git-branch",
    template: `flowchart LR
  A[Khách inbox] --> B[Tư vấn]
  B --> C{Chốt đơn?}
  C -->|Có| D[Tạo đơn Odoo]
  C -->|Chưa| E[Lưu lead]`,
  }),
  Renderer: MermaidRenderer,
  // Story 7-19
  validateSource: validateMermaidSource,
  getTitle: getMermaidTitle,
  setTitle: setMermaidTitle,
  paletteItems: mermaidPaletteItems,
};
