import { h, type VNode } from "preact";
import type { DiagramAdapter, Theme } from "../core/adapter";

/**
 * Display mode for the unified diagram editor.
 * - `modal` — mounted inside an `EditModal` popup (caller renders close button, save button).
 * - `tab`   — mounted as the body of a full Obsidian `ItemView` (no close affordance).
 *
 * Story 7-1 only emits a modifier class for CSS targeting; mode-specific
 * behavior (header buttons, sizing) is implemented in Stories 7-4 / 7-5.
 */
export type BoardEditorMode = "modal" | "tab";

/**
 * Props for the unified `<BoardEditor>` component.
 *
 * Story 7-1 scaffolds the skeleton only. Sub-components (palette, canvas,
 * properties) are wired in Stories 7-2 / 7-3. Header/footer slot content is
 * filled by Stories 7-4 / 7-5 / 7-7. Title editing is Story 7-14.
 *
 * @template TModel - Diagram-specific model type owned by the adapter.
 */
export interface BoardEditorProps<TModel> {
  /** Adapter handling parse/serialize/render for this diagram type. */
  adapter: DiagramAdapter<TModel>;
  /** Initial model — what the canvas/preview shows on mount. */
  initialModel: TModel;
  /** Obsidian theme bridge (colors, dark mode) — passed to renderers. */
  theme: Theme;
  /** Host context — affects CSS modifier class and (later) header chrome. */
  mode: BoardEditorMode;
  /** Called when the user commits changes (Save / Lưu & đóng). */
  onSave: (model: TModel) => void;
  /** Called when the user dismisses without saving (× Close / Esc). */
  onClose: () => void;
  /** Optional title — when present, header should render it (Story 7-14). */
  title?: string;
  /** Optional title change callback — paired with `title` (Story 7-14). */
  onTitleChange?: (title: string) => void;
}

/**
 * Unified Preact component hosting the diagram editor UI for both
 * `EditModal` (popup) and `BoardView` (full tab).
 *
 * **Lifecycle contract — caller MUST clean up after unmount.**
 *
 * Render directly into the Obsidian-owned content element (do NOT create
 * an intermediate host div — that would leak a stray DOM node per open):
 *
 * ```ts
 * import { render, h } from "preact";
 *
 * // onOpen (inside a Modal subclass):
 * render(h(BoardEditor, props), this.contentEl);
 *
 * // onClose:
 * render(null, this.contentEl);
 * this.contentEl.empty();   // matches src/core/modal.ts pattern (modal.ts:48-51)
 * ```
 *
 * If a wrapper element is genuinely required, you MUST also remove it:
 *
 * ```ts
 * const host = parent.createDiv();
 * render(h(BoardEditor, props), host);
 * // cleanup:
 * render(null, host);
 * host.remove();   // P1 — release the wrapper too, not just the Preact tree
 * ```
 *
 * Skipping cleanup violates P1 (Plugin is tenant of Obsidian) and leaks
 * Preact trees + listeners across reload cycles (Error Pattern #4).
 *
 * **Story 7-1 scope:** Renders the layout shell (header / body / footer
 * slots) with mode modifier class only. All sub-components and behaviors
 * are added in subsequent stories per the architecture in
 * `_bmad-output/planning-artifacts/inline-card-modal-architecture.md`.
 */
export function BoardEditor<TModel>(
  props: BoardEditorProps<TModel>,
): VNode {
  // `mode` drives a modifier class on the root; downstream stories use this
  // class as the single source of truth for mode-specific styling.
  const modeClass =
    props.mode === "modal"
      ? "diagrams-board-editor-mode-modal"
      : "diagrams-board-editor-mode-tab";

  return (
    <div
      class={`diagrams-board-editor ${modeClass}`}
      data-testid="diagrams-board-editor"
    >
      <header
        class="diagrams-board-editor-header"
        data-testid="diagrams-board-editor-header"
      />
      <div
        class="diagrams-board-editor-body"
        data-testid="diagrams-board-editor-body"
      />
      <footer
        class="diagrams-board-editor-footer"
        data-testid="diagrams-board-editor-footer"
      />
    </div>
  );
}

export default BoardEditor;
