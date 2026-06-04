import { type VNode } from "preact";
import { Menu, Notice, setIcon } from "obsidian";
import type { DiagramAdapter, Theme, ExportFormat } from "../core/adapter";

export interface DiagramCardProps {
  adapter: DiagramAdapter;
  source: string;
  theme: Theme;
  /** Triggered when the user opens the full editor (modal). */
  onEdit: () => void;
  /**
   * Optional callback for the Export button / Export menu item.
   * Receives the chosen format. When absent, the card shows a deferred-
   * impl Notice (real export backends are Story 7-20).
   */
  onExport?: (format: ExportFormat) => void;
  /**
   * Optional callback for the "Sửa dạng mã nguồn" 3-dot menu item.
   * When absent, falls back to `onEdit()` (graceful default — the user
   * can still edit the diagram, just in the canvas modal not raw text).
   */
  onSourceEdit?: () => void;
  /**
   * Optional callback for the "Copy as image" 3-dot menu item.
   * When absent, shows a deferred-impl Notice (real PNG copy via static
   * render is Story 7-20).
   */
  onCopyImage?: () => void;
}

const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; icon: string }> = [
  { id: "svg", label: "SVG", icon: "file-code" },
  { id: "png", label: "PNG", icon: "image" },
  { id: "pdf", label: "PDF", icon: "file-text" },
];

/** Imperative menu factory — returns a Menu wired up but not yet shown. */
function buildExportMenu(
  adapter: DiagramAdapter,
  onExport: ((format: ExportFormat) => void) | undefined,
): Menu {
  const menu = new Menu();
  for (const fmt of EXPORT_FORMATS) {
    // Skip formats the adapter says it doesn't support — keeps the menu
    // honest per-adapter (some adapters export to SVG only, some add PDF).
    if (!adapter.exportFormats.includes(fmt.id)) continue;
    menu.addItem((i) =>
      i
        .setTitle(fmt.label)
        .setIcon(fmt.icon)
        .onClick(() => {
          if (onExport) {
            onExport(fmt.id);
          } else {
            new Notice(
              `Export ${fmt.label} — sẽ có trong Story 7-20 (export backends)`,
            );
          }
        }),
    );
  }
  return menu;
}

function buildMoreMenu(
  adapter: DiagramAdapter,
  props: DiagramCardProps,
  exportTriggerEvent: MouseEvent,
): Menu {
  const menu = new Menu();
  menu.addItem((i) =>
    i
      .setTitle("Mở trình chỉnh sửa")
      .setIcon("square-pen")
      .onClick(() => props.onEdit()),
  );
  menu.addItem((i) =>
    i
      .setTitle("Export…")
      .setIcon("download")
      .onClick(() => {
        // Reuse the export menu — open it at the same trigger position.
        buildExportMenu(adapter, props.onExport).showAtMouseEvent(
          exportTriggerEvent,
        );
      }),
  );
  menu.addItem((i) =>
    i
      .setTitle("Copy as image")
      .setIcon("clipboard-copy")
      .onClick(() => {
        if (props.onCopyImage) {
          props.onCopyImage();
        } else {
          new Notice("Copy as image — sẽ có trong Story 7-20");
        }
      }),
  );
  menu.addSeparator();
  menu.addItem((i) =>
    i
      .setTitle("Sửa dạng mã nguồn")
      .setIcon("code")
      // Fallback to onEdit — caller may not yet have a source-mode editor.
      .onClick(() => (props.onSourceEdit ?? props.onEdit)()),
  );
  return menu;
}

/**
 * Read-mode card shown for an inline diagram code block.
 *
 * Story 7-7 polish: header redesigned per Claude Design with an icon
 * chip showing `adapter.displayName`, plus quick-action buttons
 * (Sửa / Export / ⋯). The 3-dot menu and Export button use Obsidian's
 * `Menu` API for native look + keyboard support.
 *
 * Real export backends + "Copy as image" PNG generation are Story 7-20;
 * Story 7-7 wires the UI with placeholder Notices when those callbacks
 * are absent.
 */
export function DiagramCard(props: DiagramCardProps): VNode {
  const { adapter, source, theme, onEdit } = props;
  const model = adapter.parse(source);
  const Renderer = adapter.Renderer;

  // Story 7-6 — source-level validation. Adapters that don't implement
  // `validateSource` are treated as always-valid (best-effort parse
  // contract per P3). An issue array with severity="error" triggers the
  // warning card variant.
  const issues = adapter.validateSource?.(source) ?? [];
  const errorIssue = issues.find((i) => i.severity === "error");

  // setIcon is imperative DOM mutation — call via callback refs so we
  // don't depend on preact/hooks (which require a render context that
  // unit tests calling the component as a plain function don't provide).
  // Callback refs fire only when the element is created/destroyed, so
  // setIcon runs once per mount without re-render churn.
  const setIconRef =
    (name: string) =>
    (el: HTMLSpanElement | null): void => {
      if (el && !el.dataset.iconApplied) {
        setIcon(el, name);
        el.dataset.iconApplied = "1";
      }
    };

  return (
    <div class="diagrams-card" onClick={onEdit} data-testid="diagrams-card">
      <div class="diagrams-card-header">
        {/* Chip is informational — does NOT trigger onEdit on click */}
        <div
          class="diagrams-card-chip"
          onClick={(e) => e.stopPropagation()}
          data-testid="diagrams-card-chip"
        >
          <span ref={setIconRef(adapter.icon)} class="diagrams-card-chip-icon" aria-hidden="true" />
          <span class="diagrams-card-chip-label">{adapter.displayName}</span>
        </div>

        <div class="diagrams-card-spacer" />

        <button
          type="button"
          class="diagrams-card-btn diagrams-card-btn-export"
          aria-label="Export"
          title="Export"
          data-testid="diagrams-card-export"
          onClick={(e) => {
            e.stopPropagation();
            buildExportMenu(adapter, props.onExport).showAtMouseEvent(e);
          }}
        >
          <span ref={setIconRef("download")} class="diagrams-card-btn-icon" aria-hidden="true" />
          <span class="diagrams-card-btn-label">Export</span>
        </button>

        <button
          type="button"
          class="diagrams-card-btn diagrams-card-btn-edit diagrams-card-btn-primary"
          aria-label="Sửa"
          title="Sửa"
          data-testid="diagrams-card-edit"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <span ref={setIconRef("square-pen")} class="diagrams-card-btn-icon" aria-hidden="true" />
          <span class="diagrams-card-btn-label">Sửa</span>
        </button>

        <button
          type="button"
          class="diagrams-card-btn diagrams-card-btn-more"
          aria-label="More actions"
          title="More actions"
          data-testid="diagrams-card-more"
          onClick={(e) => {
            e.stopPropagation();
            buildMoreMenu(adapter, props, e).showAtMouseEvent(e);
          }}
        >
          <span ref={setIconRef("more-horizontal")} class="diagrams-card-btn-icon" aria-hidden="true" />
        </button>
      </div>

      <div class="diagrams-card-preview" data-testid="diagrams-card-preview">
        {errorIssue ? (
          <div
            class="diagrams-card-warning"
            data-testid="diagrams-card-warning"
            role="alert"
          >
            <span
              ref={setIconRef("alert-triangle")}
              class="diagrams-card-warning-icon"
              aria-hidden="true"
            />
            <div class="diagrams-card-warning-body">
              <div class="diagrams-card-warning-title">
                {errorIssue.message}
                {errorIssue.line !== undefined && (
                  <span class="diagrams-card-warning-loc">
                    {" · "}
                    {adapter.codeBlockLanguage}
                    {" · dòng "}
                    {errorIssue.line}
                  </span>
                )}
              </div>
              <button
                type="button"
                class="diagrams-card-warning-btn"
                data-testid="diagrams-card-warning-edit"
                onClick={(e) => {
                  e.stopPropagation();
                  (props.onSourceEdit ?? onEdit)();
                }}
              >
                Mở editor để sửa
              </button>
            </div>
          </div>
        ) : (
          <Renderer model={model} theme={theme} />
        )}
      </div>
    </div>
  );
}
