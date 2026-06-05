import type { ComponentType } from "preact";
import type { PaletteSidebarItem, PropertyFieldSchema } from "./sidebarSchema";
import type { ShapeCategory, CanvasModel } from "../canvas/types";

/**
 * Story 7-5d — a live editing session on the unified canvas. `serialize`
 * writes the (edited) model back to the adapter's source text; it may close
 * over parse-time metadata (e.g. BPMN sourceMeta) and may be async.
 */
export interface CanvasEditSession {
  model: CanvasModel;
  /** Initial diagram title for the editable topbar field (optional). */
  title?: string;
  /**
   * Write the edited model back to source text, applying `title` if given.
   * The closure applies the title the right way per format (flowchart: model
   * field; BPMN: process name; …) so the host stays format-agnostic. May be
   * async.
   */
  serialize: (model: CanvasModel, title?: string) => string | Promise<string>;
}

export type { PaletteSidebarItem, PropertyFieldSchema } from "./sidebarSchema";

/**
 * Story 7-8b — context passed to `DiagramAdapter.getPropertyFields()`.
 *
 * Property fields are produced by a FUNCTION (not a static array) because each
 * field's `onChange` must close over the CURRENT model to build the next one.
 * The host supplies the live model + a dispatch; the adapter returns the field
 * schema for the current selection.
 */
export interface PropertyFieldsContext<TModel> {
  /** Current model — fields read their values from this. */
  model: TModel;
  /** Id of the currently selected canvas node, if any. */
  selectedId?: string;
  /**
   * Dispatch an immutable model update. Field `onChange` handlers call this
   * with a NEW model (e.g. `setModel(setTitle(model, next))`). The host
   * re-renders the sidebar with the updated model.
   */
  setModel: (next: TModel) => void;
}

export type DiagramTypeId =
  | "bpmn"
  | "dbml"
  | "erd"
  | "flowchart"
  | "uml"
  | "sequence"
  | "state"
  | "mindmap"
  | "mermaid";

export type ExportFormat = "svg" | "png" | "pdf";

export interface Theme {
  isDark: boolean;
  /** Resolved Obsidian CSS variable values useful for diagram styling. */
  colors: {
    background: string;
    backgroundSecondary: string;
    border: string;
    text: string;
    textMuted: string;
    accent: string;
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Source-level parse issue surfaced to the user via the inline card's
 * warning UI (Story 7-6). Returned by the optional
 * `DiagramAdapter.validateSource()` method. Distinct from `ValidationResult`
 * which validates a *parsed model* (post-parse semantic check).
 */
export interface ParseIssue {
  severity: "error" | "warning";
  message: string;
  /** 1-based line number where the issue starts, if known. */
  line?: number;
  /** 1-based column number where the issue starts, if known. */
  column?: number;
}

export interface RendererProps<TModel> {
  model: TModel;
  theme: Theme;
}

export interface EditorProps<TModel> {
  initialModel: TModel;
  theme: Theme;
  onSave: (model: TModel) => void;
  onClose: () => void;
}

/**
 * A self-contained plugin for a single diagram type.
 * Adding a new diagram type = implementing one adapter, no core changes.
 *
 * TModel defaults to `any` because the registry holds heterogeneous adapters
 * (each with its own model type) and treats them opaquely. Concrete adapters
 * still declare a precise TModel for internal type-safety.
 */
export interface DiagramAdapter<TModel = any> {
  id: DiagramTypeId;
  displayName: string;
  /** The fenced code-block language tag, e.g. "bpmn". */
  codeBlockLanguage: string;
  /** Lucide icon name used in menus/cards. */
  icon: string;

  /** Text (code-block body) → in-memory model. Must never throw; return best-effort. */
  parse(source: string): TModel;
  /** In-memory model → text. Round-trippable with parse(). */
  serialize(model: TModel): string;
  /** Template inserted when the user creates a new diagram of this type. */
  emptyTemplate(): string;

  Renderer: ComponentType<RendererProps<TModel>>;
  Editor: ComponentType<EditorProps<TModel>>;

  exportFormats: ExportFormat[];
  validate(model: TModel): ValidationResult;

  /**
   * Story 7-6 — optional source-level validation surfacing parse issues
   * to the inline card's warning UI. Called with the raw code-block text
   * BEFORE `parse()` is invoked. Return an empty array (or omit the
   * method entirely) when the source is valid.
   *
   * Contract:
   * - MUST NEVER THROW. Best-effort: return `[]` rather than throwing on
   *   unexpected input.
   * - Severity `"error"` triggers the yellow warning card; `"warning"`
   *   may be surfaced as an inline hint in future stories.
   * - Issues are display-only — they do NOT prevent `parse()` from being
   *   called (per P3, parse remains best-effort and never throws).
   */
  validateSource?(source: string): ParseIssue[];

  /**
   * Story 7-14 — optional human-readable title accessor for the diagram.
   * Used by `<BoardEditor>` header when rendering the chip+title pair
   * shown in the Claude Design (e.g., "BPMN 2.0  Quy trình bán hàng KALIX").
   *
   * Contract:
   * - Returns `undefined` (or omits the method) when the adapter has no
   *   concept of a title or the model doesn't carry one.
   * - Pure read — must not mutate the model.
   */
  getTitle?(model: TModel): string | undefined;

  /**
   * Story 7-14 — optional title setter. Returns a NEW model with the
   * title applied (immutable per project rule). When absent, the
   * BoardEditor header's title input renders read-only.
   *
   * Contract:
   * - MUST be immutable: do not mutate the input `model`; return a fresh
   *   one with the title applied (deep-clone or structural-share as
   *   appropriate per adapter).
   * - Empty string `""` is a valid title (means "no title"). Adapters
   *   should treat it consistently with `getTitle` returning undefined.
   */
  setTitle?(model: TModel, title: string): TModel;

  /**
   * Story 7-8 — optional declarative palette schema. When provided, the
   * `<BoardEditor>` left sidebar (`<PaletteSidebar>`) renders these items.
   * Items are static per adapter — they don't depend on the current model.
   * Selection dispatch happens at the sidebar level via `onSelectItem`
   * (BoardEditor consumer wires concrete action). Adapters that have
   * no concept of a palette omit the field; BoardEditor then hides the
   * left sidebar.
   */
  paletteItems?: ReadonlyArray<PaletteSidebarItem>;

  /**
   * Story 7-8b — optional function-form property fields. Returns the schema
   * for the properties sidebar given the current model + selection.
   *
   * Function form (not a static array like `paletteItems`) because each
   * field's `value` is read from `ctx.model` and its `onChange` must dispatch
   * a NEW model via `ctx.setModel` — both require the live model at call time.
   *
   * Contract:
   * - MUST be pure with respect to `ctx.model` (read-only; never mutate it).
   * - Field `onChange` handlers call `ctx.setModel(nextModel)` with an
   *   immutably-updated model.
   * - Return `[]` (or omit the method) when there is nothing to edit; the
   *   host then collapses the properties sidebar.
   * - **HOST OBLIGATION:** the host MUST re-invoke `getPropertyFields` with the
   *   updated model after every `setModel` (do NOT cache the returned array
   *   across model changes). Each field's `onChange` closes over the `ctx.model`
   *   it was built with; reusing a stale array would lose updates on rapid
   *   successive edits.
   */
  getPropertyFields?(
    ctx: PropertyFieldsContext<TModel>,
  ): ReadonlyArray<PropertyFieldSchema>;

  /**
   * Story 7-5b — opt-in flag marking this adapter as "canvas-native": its
   * `TModel` IS a `CanvasModel` and it can be edited directly in the unified
   * `<BoardEditor>` canvas slot (palette + X6 canvas), not just its own
   * `<Editor>`. When present, hosts (EditModal via ModalEditorHost) mount the
   * canvas slot using this shape catalog instead of the adapter's `<Editor>`.
   *
   * Adapters whose model is NOT a CanvasModel (raw-string adapters like BPMN,
   * sequence, etc.) omit this — hosts fall back to `<Editor>` in the body slot.
   */
  canvasShapeCategories?: ReadonlyArray<ShapeCategory>;

  /**
   * Story 7-5d — open this source in the UNIFIED OmniboardCanvas editor
   * (shared topbar + canvas, identical to BoardView). When present, the edit
   * modal parses the source to a CanvasModel via `toEditor` and edits it on the
   * real canvas, then writes it back with the returned `serialize` closure
   * (which captures any parse-time metadata, e.g. BPMN sourceMeta, for a
   * faithful round-trip).
   *
   * Adapters that cannot (yet) round-trip through a CanvasModel omit this and
   * fall back to the raw-text editor.
   */
  toEditor?(source: string): CanvasEditSession | Promise<CanvasEditSession>;

  /**
   * Story 7-5c — opt-in: this adapter's `<Editor>` body does NOT surface the
   * title (e.g. a visual/canvas editor where the title is metadata, not shown
   * in the edit surface). When true AND `setTitle` exists, the modal header
   * renders an editable title `<input>` that is the single authority — applied
   * onto the model at save via `setTitle`.
   *
   * Leave unset for raw-source editors (the title lives in the visible source,
   * so a header input would be a confusing second title editor). Those keep a
   * read-only header title (Story 7-5).
   */
  titleEditableInHeader?: boolean;
}
