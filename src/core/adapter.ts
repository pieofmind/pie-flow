import type { ComponentType } from "preact";

export type DiagramTypeId =
  | "bpmn"
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
}
