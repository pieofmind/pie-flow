import { describe, it, expect } from "vitest";
import { renderModelToCard, renderModelToSvg } from "../../src/canvas/staticRender";
import type { CanvasModel } from "../../src/canvas/types";

/**
 * Mobile preview card composite (Error Pattern #8): iOS WebKit mis-positions
 * offset <foreignObject> nodes, so the mobile path renders edges in an SVG layer
 * + real absolutely-positioned HTML node <div>s instead. These tests pin that
 * contract: NO node foreignObject, correct stage geometry, edges preserved.
 */
const model: CanvasModel = {
  nodes: [
    { id: "a", shape: "bs-rect", label: "A", x: 100, y: 60, width: 120, height: 48, attrs: {} },
    { id: "b", shape: "bs-rect", label: "B", x: 400, y: 260, width: 120, height: 48, attrs: {} },
  ],
  edges: [
    { id: "e1", source: "a", target: "b", sourcePort: "right", targetPort: "left", label: "go" },
  ],
} as unknown as CanvasModel;

describe("renderModelToCard — foreignObject-free mobile composite", () => {
  it("emits NO foreignObject for nodes (the iOS bug source)", () => {
    const html = renderModelToCard(model, 16, "transparent");
    expect(html).not.toContain("foreignObject");
  });

  it("wraps in .ob-card-fit > .ob-card-stage with natural-size data attrs", () => {
    const html = renderModelToCard(model, 16, "transparent");
    expect(html).toContain('class="ob-card-fit lk-root"');
    expect(html).toContain('class="ob-card-stage"');
    // Bounds: x 100..520 → w 420+32=452; y 60..308 → h 248+32=280.
    expect(html).toContain('data-ob-w="452"');
    expect(html).toContain('data-ob-h="280"');
    expect(html).toContain("width:452px;height:280px");
  });

  it("positions each node as an absolute HTML div in stage-local coords", () => {
    const html = renderModelToCard(model, 16, "transparent");
    // Stage origin = (minX-pad, minY-pad) = (84, 44).
    // Node A (100,60) → left 16, top 16. Node B (400,260) → left 316, top 216.
    expect(html).toContain("position:absolute;left:16px;top:16px;width:120px;height:48px");
    expect(html).toContain("position:absolute;left:316px;top:216px;width:120px;height:48px");
    expect(html).toContain(">A<");
    expect(html).toContain(">B<");
  });

  it("keeps edges in an SVG layer with the arrow marker + label", () => {
    const html = renderModelToCard(model, 16, "transparent");
    expect(html).toContain('class="ob-card-edges"');
    expect(html).toContain('marker-end="url(#da-arrow)"');
    expect(html).toContain(">go</text>");
    // Edge SVG keeps absolute model coords via viewBox at bounds origin.
    expect(html).toContain('viewBox="84 44 452 280"');
  });

  it("renders the SAME node HTML as the desktop foreignObject path", () => {
    // The node design must not drift between desktop (renderModelToSvg) and
    // mobile (renderModelToCard) — both go through nodeHtml().
    const card = renderModelToCard(model, 16, "transparent");
    const svg = renderModelToSvg(model, "", 16, "transparent");
    expect(card).toContain('class="fc rect"');
    expect(svg).toContain('class="fc rect"');
  });

  it("empty model still produces a valid stage (no crash, fallback bounds)", () => {
    const empty = { nodes: [], edges: [] } as unknown as CanvasModel;
    const html = renderModelToCard(empty, 16, "transparent");
    expect(html).toContain('class="ob-card-stage"');
    expect(html).not.toContain("foreignObject");
  });

  it("desktop path is unchanged — still uses foreignObject per node", () => {
    const svg = renderModelToSvg(model, "", 16, "transparent");
    const matches = svg.match(/<foreignObject/g) || [];
    expect(matches.length).toBe(2);
  });
});
