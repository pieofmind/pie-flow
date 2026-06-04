/**
 * Story 7-11 — unified embed preview card.
 *
 * Renders the preview UI for `![[file.omniboard.md]]` embeds. Shared
 * by:
 * - The Reading mode post-processor in main.ts (`renderBoardEmbed`)
 * - The Live Preview CodeMirror 6 widget in
 *   `src/embed/liveEmbedExtension.ts`
 *
 * Visually consistent with the polished inline `<DiagramCard>` from
 * Story 7-7 — same chip pill, same button styling, same border /
 * shadow — so users see ONE card UI across all three rendering
 * surfaces (inline code block, embed Reading mode, embed Live
 * Preview).
 *
 * The component is **synchronous**: it receives the already-parsed
 * model and a "click Mở" callback. The async file-read happens at
 * the host call site (post-processor or CM6 widget) — both already
 * use `vault.cachedRead`. Keeps this component DOM-renderable in
 * isolation for tests + avoids importing obsidian here.
 */

import { type VNode } from "preact";

export interface EmbedCardProps {
  /** Filename to display in the chip + as the card title. */
  filename: string;
  /** Diagram type label (e.g. "Omniboard"). Shown in the chip. */
  typeLabel?: string;
  /** Node count for the meta line. */
  nodeCount: number;
  /** Edge count for the meta line. */
  edgeCount: number;
  /**
   * Inline SVG markup for the preview body. When undefined → render
   * loading state. When empty string → render the empty/corrupt
   * state.
   */
  svg?: string;
  /** Set when the card represents a state we couldn't render. */
  errorMessage?: string;
  /** Click handler for the "Mở" action — typically opens BoardView. */
  onOpen: () => void;
  /**
   * Optional callback for setIcon — passed the icon span so the host
   * can call Obsidian's `setIcon()` after mount. Decoupled here so
   * EmbedCard itself doesn't import obsidian (lets unit tests render
   * it without mocking).
   */
  setIcon?: (el: HTMLSpanElement, name: string) => void;
}

export function EmbedCard(props: EmbedCardProps): VNode {
  const typeLabel = props.typeLabel ?? "Omniboard";

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
    <div class="diagrams-card diagrams-card-embed" data-testid="diagrams-embed-card">
      <div class="diagrams-card-header">
        <div
          class="diagrams-card-chip"
          onClick={(e) => e.stopPropagation()}
        >
          <span
            ref={setIconRef("shapes")}
            class="diagrams-card-chip-icon"
            aria-hidden="true"
          />
          <span class="diagrams-card-chip-label">{typeLabel}</span>
        </div>
        <div class="diagrams-card-embed-title" data-testid="diagrams-embed-title">
          {props.filename}
        </div>
        <div class="diagrams-card-spacer" />
        <button
          type="button"
          class="diagrams-card-btn diagrams-card-btn-primary"
          data-testid="diagrams-embed-open"
          onClick={(e) => {
            e.stopPropagation();
            props.onOpen();
          }}
        >
          <span
            ref={setIconRef("external-link")}
            class="diagrams-card-btn-icon"
            aria-hidden="true"
          />
          <span class="diagrams-card-btn-label">Mở</span>
        </button>
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
            {props.errorMessage ?? "Board trống — bấm Mở để vẽ."}
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
