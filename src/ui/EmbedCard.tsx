/**
 * Unified embed preview card for `![[file.omniboard.md]]` embeds.
 *
 * Rendered by `renderBoardEmbed` in main.ts, which a MutationObserver drives
 * for every omniboard `.internal-embed` (both Reading mode and Live Preview).
 *
 * Visually identical to the inline `<DiagramCard>` (same chip pill, same
 * quick-action buttons, same live preview body) so the user sees ONE card UI
 * everywhere. The badge label shows the board's **title = file name** (the
 * single source of truth lives in the `.omniboard.md` file, so the embed
 * doesn't carry a separate diagram-type label).
 *
 * The component is **synchronous** and obsidian-free: the async file read
 * happens at the host call site, and Obsidian-specific actions (the
 * `setIcon` painter, the Export / overflow menus) are injected as callbacks.
 * Keeps it unit-testable as a plain function.
 */

import { type VNode } from "preact";

export interface EmbedCardProps {
  /** Title shown in the badge + used as the card title (file name, no suffix). */
  title: string;
  /** Node count for the meta line. */
  nodeCount: number;
  /** Edge count for the meta line. */
  edgeCount: number;
  /**
   * Inline SVG markup for the preview body. When undefined → render
   * loading state. When empty string → render the empty/corrupt state.
   */
  svg?: string;
  /** Set when the card represents a state we couldn't render. */
  errorMessage?: string;
  /** Open the popup board editor (the primary "Sửa" action + card click). */
  onEdit: () => void;
  /** Open the Export menu, anchored at the click. Omit to hide the button. */
  onExportMenu?: (e: MouseEvent) => void;
  /** Open the overflow (⋯) menu, anchored at the click. Omit to hide it. */
  onMoreMenu?: (e: MouseEvent) => void;
  /**
   * Optional callback for setIcon — passed the icon span so the host can call
   * Obsidian's `setIcon()` after mount. Decoupled so EmbedCard itself doesn't
   * import obsidian (lets unit tests render it without mocking).
   */
  setIcon?: (el: HTMLSpanElement, name: string) => void;
}

export function EmbedCard(props: EmbedCardProps): VNode {
  const setIconRef =
    (name: string) =>
    (el: HTMLSpanElement | null): void => {
      if (!el || el.dataset.iconApplied) return;
      el.dataset.iconApplied = "1";
      props.setIcon?.(el, name);
    };

  const meta = props.errorMessage
    ? props.errorMessage
    : `${props.nodeCount} phần tử · ${props.edgeCount} nối`;

  return (
    <div
      class="diagrams-card diagrams-card-embed"
      data-testid="diagrams-embed-card"
      onClick={() => props.onEdit()}
    >
      <div class="diagrams-card-header">
        <div class="diagrams-card-chip" onClick={(e) => e.stopPropagation()}>
          <span
            ref={setIconRef("shapes")}
            class="diagrams-card-chip-icon"
            aria-hidden="true"
          />
          <span
            class="diagrams-card-chip-label"
            data-testid="diagrams-embed-title"
          >
            {props.title}
          </span>
        </div>

        <div class="diagrams-card-spacer" />

        {props.onExportMenu && (
          <button
            type="button"
            class="diagrams-card-btn diagrams-card-btn-export"
            aria-label="Export"
            title="Export"
            data-testid="diagrams-embed-export"
            onClick={(e) => {
              e.stopPropagation();
              props.onExportMenu!(e as unknown as MouseEvent);
            }}
          >
            <span
              ref={setIconRef("download")}
              class="diagrams-card-btn-icon"
              aria-hidden="true"
            />
            <span class="diagrams-card-btn-label">Export</span>
          </button>
        )}

        <button
          type="button"
          class="diagrams-card-btn diagrams-card-btn-edit diagrams-card-btn-primary"
          aria-label="Sửa"
          title="Sửa"
          data-testid="diagrams-embed-edit"
          onClick={(e) => {
            e.stopPropagation();
            props.onEdit();
          }}
        >
          <span
            ref={setIconRef("square-pen")}
            class="diagrams-card-btn-icon"
            aria-hidden="true"
          />
          <span class="diagrams-card-btn-label">Sửa</span>
        </button>

        {props.onMoreMenu && (
          <button
            type="button"
            class="diagrams-card-btn diagrams-card-btn-more"
            aria-label="More actions"
            title="More actions"
            data-testid="diagrams-embed-more"
            onClick={(e) => {
              e.stopPropagation();
              props.onMoreMenu!(e as unknown as MouseEvent);
            }}
          >
            <span
              ref={setIconRef("more-horizontal")}
              class="diagrams-card-btn-icon"
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      <div
        class="diagrams-card-preview diagrams-card-embed-preview"
        data-testid="diagrams-embed-preview"
      >
        <div class="diagrams-card-embed-meta">{meta}</div>
        {props.svg === undefined ? (
          <div class="diagrams-card-embed-loading">Đang tải…</div>
        ) : props.svg === "" || props.errorMessage ? (
          <div class="diagrams-card-embed-empty">
            {props.errorMessage ?? "Board trống — bấm Sửa để vẽ."}
          </div>
        ) : (
          <div
            class="diagrams-card-embed-svg"
            // EmbedCard receives pre-rendered SVG from the static render
            // pipeline (see renderModelToSvg). It's plugin-generated, not
            // user-supplied HTML — same trust boundary as DiagramCard's
            // Renderer slot.
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: props.svg }}
          />
        )}
      </div>
    </div>
  );
}
