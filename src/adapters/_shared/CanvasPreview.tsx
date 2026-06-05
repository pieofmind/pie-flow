import { h } from "preact";
import { useMemo } from "preact/hooks";
import type { CanvasModel } from "../../canvas/types";
import { renderModelToSvg } from "../../canvas/staticRender";

/**
 * Shared read-only inline preview that renders a CanvasModel to a STATIC SVG
 * via `renderModelToSvg` — the same path the markdown code-block processor and
 * export pipeline use. This is the right tool for a card thumbnail:
 *
 * - No interactive chrome (toolbar / minimap / context bars) — those belong in
 *   the editing modal, not a preview.
 * - No per-card X6 graph instance (light; many cards per note are cheap).
 * - No cross-card overlay bleed.
 *
 * `css=""` because the plugin's `.lk-root` styles are already loaded globally
 * (styles.css), so the foreignObject HTML inside the SVG inherits them.
 */
export function CanvasPreview({ model }: { model: CanvasModel }) {
  const svg = useMemo(() => {
    if (!model.nodes.length) return "";
    try {
      return renderModelToSvg(model, "", 16, "transparent");
    } catch {
      return "";
    }
  }, [model]);

  if (!svg) {
    return <div class="diagrams-empty">(sơ đồ trống)</div>;
  }
  return (
    <div
      class="diagrams-adapter-preview"
      data-testid="canvas-preview"
      // Plugin-generated SVG (same as main.ts code-block processor) — not user HTML.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
