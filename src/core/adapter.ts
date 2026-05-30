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
}
