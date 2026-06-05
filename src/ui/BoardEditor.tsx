import { h, type VNode } from "preact";
import type { DiagramAdapter, Theme } from "../core/adapter";
import type {
  PaletteSidebarItem,
  PropertyFieldSchema,
} from "../core/sidebarSchema";
import type { CanvasModel, ShapeCategory } from "../canvas/types";
import { PaletteSidebar } from "./PaletteSidebar";
import { PropertiesSidebar } from "./PropertiesSidebar";
import { OmniboardCanvasMount } from "./OmniboardCanvasMount";
import { Icon } from "./Icon";

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
 * Story 7-1 scaffolded the skeleton. Story 7-3 wires the body slot: when
 * `shapeCategories` + `canvasModel` are provided, the canvas mounts; when
 * `paletteItems` is provided, the left palette sidebar renders; when
 * `propertyFields` is provided, the right properties sidebar renders. All
 * three are optional — adapters lacking one or more simply collapse those
 * slots.
 *
 * Header/footer slot content is filled by Stories 7-4 / 7-5 / 7-7. Title
 * editing wiring is Story 7-14.
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
  /**
   * Story 7-5 — optional diagram-type chip label shown in the modal header
   * (e.g. "BPMN 2.0"). Rendered only in `mode="modal"`.
   */
  chipLabel?: string;
  /**
   * Story 7-5 — optional body content. When provided, this VNode is rendered
   * inside the body region instead of the palette/canvas/properties slot
   * composition. Used by `EditModal` to host an adapter's own `<Editor>`
   * inside the unified modal chrome without changing model ownership.
   */
  body?: VNode;
  /**
   * Story 7-5b — when true (canvas mode), the modal header renders unified
   * "Đóng" + "Lưu & đóng" buttons. The host owns the model/save path; the
   * Save button calls `onHeaderSave`. In body-slot mode this stays false so
   * the inner adapter `<Editor>` keeps its own toolbar (no duplicate buttons).
   */
  showHeaderActions?: boolean;
  /** Story 7-5b — header "Lưu & đóng" handler (paired with showHeaderActions). */
  onHeaderSave?: () => void;

  // ── Canvas-mode toolbar actions (rendered in the header when present) ──
  /** Undo the last canvas edit. */
  onUndo?: () => void;
  /** Redo the last undone canvas edit. */
  onRedo?: () => void;
  /** Zoom-to-fit the canvas content. */
  onFit?: () => void;
  /** Auto-arrange the canvas (dagre LR). */
  onAutoLayout?: () => void;

  // ── Story 7-3: body slot composition (all optional, additive) ──

  /** Palette items for the left sidebar. Omit to collapse the palette. */
  paletteItems?: ReadonlyArray<PaletteSidebarItem>;
  /** Currently selected palette item id (cursor mode). */
  selectedPaletteId?: string;
  /** Called when user clicks a palette item. */
  onSelectPaletteItem?: (id: string) => void;
  /** Property fields for the right sidebar. Omit to collapse properties. */
  propertyFields?: ReadonlyArray<PropertyFieldSchema>;
  /** Section title shown in the properties sidebar header. */
  propertiesTitle?: string;
  /** Optional chip beside the properties title (e.g., adapter id). */
  propertiesSubtitle?: string;
  /** Custom empty-state copy when `propertyFields` is empty. */
  propertiesEmptyText?: string;
  /**
   * X6 shape categories driving the canvas palette + spawn behavior.
   * Adapter-specific. Omit to skip canvas mount (sidebars only).
   * Captured once at mount by `<OmniboardCanvasMount>` — to swap adapters
   * at runtime, pass a different `key` prop on `<BoardEditor>` itself.
   */
  shapeCategories?: ReadonlyArray<ShapeCategory>;
  /** Initial canvas model. Required when `shapeCategories` is provided. */
  canvasModel?: CanvasModel;
  /** Fired when the canvas emits a change. */
  onCanvasChange?: (model: CanvasModel) => void;
  /**
   * Fired once the underlying `OmniboardCanvas` instance is constructed.
   * Hosts (BoardView in tab mode, EditModal in modal mode) use this to
   * capture the imperative canvas reference so existing toolbar/export
   * methods can continue to dispatch into it.
   *
   * Latest callback identity wins (`<OmniboardCanvasMount>` mirrors the
   * `latestOnCanvasReadyRef` pattern), so parents may lazy-provide this
   * prop without missing the canvas hand-off.
   *
   * **Memory caveat:** holding the returned reference past unmount keeps
   * the X6 graph in memory. Clear in the same effect that re-renders
   * without `onCanvasReady`, or in the host view's `onClose()`.
   */
  onCanvasReady?: (canvas: import("../canvas/OmniboardCanvas").OmniboardCanvas) => void;
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
 * Note: the body slot is divided into three flex regions only when content
 * is provided. With all body props omitted (Story 7-1 behavior), the body
 * renders an empty `<div>` placeholder so existing tests continue to pass.
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

  const showPalette =
    props.paletteItems !== undefined && props.paletteItems.length > 0;
  const showCanvas =
    props.shapeCategories !== undefined && props.canvasModel !== undefined;
  const showProperties = props.propertyFields !== undefined;
  const hasBodySlot = props.body !== undefined;
  const bodyHasContent = hasBodySlot || showPalette || showCanvas || showProperties;

  // Story 7-5 / 7-5b — modal header chrome (chip + title + optional actions).
  // Tab mode keeps the header empty (BoardView owns the tab title).
  const titleIsEditable = props.onTitleChange !== undefined;
  const showModalHeader =
    props.mode === "modal" &&
    (props.chipLabel !== undefined ||
      props.title !== undefined ||
      titleIsEditable ||
      props.showHeaderActions === true);

  return (
    <div
      class={`diagrams-board-editor ${modeClass}`}
      data-testid="diagrams-board-editor"
    >
      <header
        class="diagrams-board-editor-header"
        data-testid="diagrams-board-editor-header"
      >
        {showModalHeader && (
          <div class="diagrams-board-editor-header-meta">
            {props.chipLabel !== undefined && (
              <span
                class="diagrams-board-editor-chip"
                data-testid="diagrams-board-editor-chip"
              >
                {props.chipLabel}
              </span>
            )}
            {titleIsEditable ? (
              <input
                type="text"
                class="diagrams-board-editor-title-input"
                data-testid="diagrams-board-editor-title-input"
                value={props.title ?? ""}
                placeholder="Tên sơ đồ"
                onInput={(e) =>
                  props.onTitleChange!((e.target as HTMLInputElement).value)
                }
              />
            ) : (
              props.title !== undefined && (
                <span
                  class="diagrams-board-editor-title"
                  data-testid="diagrams-board-editor-title"
                >
                  {props.title}
                </span>
              )
            )}
            {props.showHeaderActions === true && (
              <span class="diagrams-board-editor-header-actions">
                <span class="diagrams-board-editor-toolbar" data-testid="diagrams-board-editor-toolbar">
                  {props.onUndo && (
                    <button type="button" class="diagrams-btn diagrams-btn-icon" title="Hoàn tác" data-testid="diagrams-board-editor-undo" onClick={() => props.onUndo!()}>
                      <Icon name="undo-2" />
                    </button>
                  )}
                  {props.onRedo && (
                    <button type="button" class="diagrams-btn diagrams-btn-icon" title="Làm lại" data-testid="diagrams-board-editor-redo" onClick={() => props.onRedo!()}>
                      <Icon name="redo-2" />
                    </button>
                  )}
                  {props.onAutoLayout && (
                    <button type="button" class="diagrams-btn diagrams-btn-icon" title="Tự sắp xếp" data-testid="diagrams-board-editor-autolayout" onClick={() => props.onAutoLayout!()}>
                      <Icon name="layout-dashboard" />
                    </button>
                  )}
                  {props.onFit && (
                    <button type="button" class="diagrams-btn diagrams-btn-icon" title="Vừa khung" data-testid="diagrams-board-editor-fit" onClick={() => props.onFit!()}>
                      <Icon name="maximize" />
                    </button>
                  )}
                </span>
                <button
                  type="button"
                  class="diagrams-btn"
                  data-testid="diagrams-board-editor-close"
                  onClick={() => props.onClose()}
                >
                  Đóng
                </button>
                <button
                  type="button"
                  class="diagrams-btn diagrams-btn-primary"
                  data-testid="diagrams-board-editor-save"
                  onClick={() => props.onHeaderSave?.()}
                >
                  Lưu &amp; đóng
                </button>
              </span>
            )}
          </div>
        )}
      </header>
      <div
        class={
          bodyHasContent
            ? "diagrams-board-editor-body diagrams-board-editor-body-composed"
            : "diagrams-board-editor-body"
        }
        data-testid="diagrams-board-editor-body"
      >
        {hasBodySlot && props.body}
        {!hasBodySlot && showPalette && (
          <PaletteSidebar
            items={props.paletteItems!}
            selectedId={props.selectedPaletteId}
            onSelectItem={props.onSelectPaletteItem}
          />
        )}
        {!hasBodySlot && showCanvas && (
          <OmniboardCanvasMount
            categories={props.shapeCategories!}
            initialModel={props.canvasModel!}
            onChange={props.onCanvasChange}
            onCanvasReady={props.onCanvasReady}
          />
        )}
        {!hasBodySlot && showProperties && (
          <PropertiesSidebar
            sectionTitle={props.propertiesTitle}
            sectionSubtitle={props.propertiesSubtitle}
            fields={props.propertyFields!}
            emptyStateText={props.propertiesEmptyText}
          />
        )}
      </div>
      <footer
        class="diagrams-board-editor-footer"
        data-testid="diagrams-board-editor-footer"
      />
    </div>
  );
}

export default BoardEditor;
