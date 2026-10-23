/**
 * Data object / data store labels sit OUTSIDE the shape, like bpmn-js.
 *
 * Before: htmlNode drew the label (`.lbl`) inside the node box under the icon,
 * so the node box = icon + text and every arrow ending on the node's bottom
 * port ran into the text (association into "Số điện thoại / Zalo" crossed
 * "Zalo"). Now the node box is just the shape (the page / cylinder fills it),
 * the label is an external `.bp-elabel` below it (draggable, flips up when
 * edges leave below), and BPMN DI label bounds round-trip.
 */
import { describe, it, expect } from "vitest";
import { nodeHtml } from "../../src/canvas/htmlNode";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import type { CanvasModel } from "../../src/canvas/types";

describe("Board render", () => {
  for (const kind of ["bpmn-data-object", "bpmn-data-collection", "bpmn-data-input", "bpmn-data-output", "bpmn-data-store"]) {
    it(`${kind}: shape fills the node, label is external`, () => {
      const html = nodeHtml(kind, "Số điện thoại / Zalo");
      expect(html).toContain('class="bp-elabel"');
      expect(html).not.toContain('class="lbl"');
      expect(html).toMatch(/<svg class="bp-data-shape"[^>]*preserveAspectRatio="none"/);
    });
  }
});

const model = (labelOffset?: { x: number; y: number }): CanvasModel => ({
  nodes: [
    { id: "t1", shape: "bpmn-task-user", x: 100, y: 100, width: 100, height: 80, label: "Ghi số" },
    { id: "d1", shape: "bpmn-data-object", x: 300, y: 260, width: 40, height: 60, label: "Số điện thoại / Zalo",
      ...(labelOffset ? { attrs: { labelOffset } } : {}) },
    { id: "s1", shape: "bpmn-data-store", x: 500, y: 260, width: 60, height: 50, label: "Lead Odoo" },
  ],
  edges: [
    { id: "a1", source: "t1", target: "d1", targetPort: "bottom", kind: "association" },
  ],
} as unknown as CanvasModel);

function labelBounds(xml: string, el: string) {
  const re = new RegExp(`bpmnElement="${el}"[^>]*>\\s*<dc:Bounds[^>]*/>\\s*<bpmndi:BPMNLabel>\\s*<dc:Bounds x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.-]+)" height="([\\d.-]+)"`);
  const m = re.exec(xml);
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
}

describe("BPMN DI label bounds", () => {
  it("label of a data object / store is below the shape, clear of its bottom port", async () => {
    const xml = await exportBpmn(model());
    const d = labelBounds(xml, "d1");
    const s = labelBounds(xml, "s1");
    expect(d).not.toBeNull();
    expect(s).not.toBeNull();
    // label starts below the shape box (y + height) → an arrow ending at the
    // bottom port (300+20, 260+60) never touches it
    expect(d!.y).toBeGreaterThanOrEqual(260 + 60);
    expect(s!.y).toBeGreaterThanOrEqual(260 + 50);
    // centred under the shape
    expect(d!.x + d!.w / 2).toBe(320);
  });

  it("a dragged label position round-trips", async () => {
    const xml = await exportBpmn(model({ x: 30, y: 12 }));
    const { model: back } = await importBpmn(xml);
    const d = back.nodes.find((n) => n.id === "d1")!;
    expect(d.attrs?.labelOffset).toEqual({ x: 30, y: 12 });
    const s = back.nodes.find((n) => n.id === "s1")!;
    expect(s.attrs?.labelOffset).toBeUndefined();   // default position → no offset
    expect({ w: d.width, h: d.height }).toEqual({ w: 40, h: 60 });
  });
});
