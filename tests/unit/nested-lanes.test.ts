/**
 * One level of nested lanes: `attrs.lanes[i].lanes` (child lanes inside a
 * lane, each with an optional own size). Shapes belong to the LEAF lane.
 * BPMN: a lane with children carries a childLaneSet; DI places the children
 * inside their parent's band, after the parent's title strip.
 *
 * Before: attrs.lanes was flat; export wrote a flat laneSet; import only
 * walked childLaneSet to patch laneId, dropping the hierarchy.
 */
import { describe, it, expect } from "vitest";
import { leafLaneAt } from "../../src/canvas/laneLayout";
import { nodeHtml } from "../../src/canvas/htmlNode";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import type { CanvasModel } from "../../src/canvas/types";

type Lane = { id: string; label: string; height?: number; lanes?: Lane[] };
const LANES: Lane[] = [
  { id: "l_kh", label: "Khách", height: 200 },
  { id: "l_kalix", label: "KALIX", height: 400, lanes: [
    { id: "l_tp", label: "Trực page", height: 300 },
    { id: "l_sale", label: "Sale", height: 100 },
  ] },
];

describe("leaf lane at a point", () => {
  it("a lane without children is its own leaf; with children, the child under the point", () => {
    expect(leafLaneAt(LANES, 600, 100)).toBe("l_kh");
    expect(leafLaneAt(LANES, 600, 250)).toBe("l_tp");       // 200..500 → Trực page
    expect(leafLaneAt(LANES, 600, 550)).toBe("l_sale");     // 500..600 → Sale
  });
  it("children without sizes split their parent equally", () => {
    const lanes: Lane[] = [{ id: "p", label: "P", lanes: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }];
    expect(leafLaneAt(lanes, 400, 150)).toBe("a");
    expect(leafLaneAt(lanes, 400, 250)).toBe("b");
  });
});

describe("Board render", () => {
  it("a lane with children draws their title strips inside it, with dividers between them", () => {
    const html = nodeHtml("bpmn-pool", "Pool", undefined, { lanes: LANES });
    expect(html).toContain('data-lane-id="l_tp"');
    expect(html).toContain('data-lane-id="l_sale"');
    expect(html).toContain('class="bp-pool-sublanes"');
    expect(html).toContain('data-lane-path="1/0"');        // divider between Trực page and Sale
    expect(html).toContain('data-lane-id="l_tp" style="flex: 300 1 0px"');
  });
});

const model: CanvasModel = {
  nodes: [
    { id: "pool", shape: "bpmn-pool", x: 0, y: 0, width: 1000, height: 600, label: "Fanpage", attrs: { lanes: LANES } },
    { id: "t_kh", shape: "bpmn-task-send", x: 200, y: 60, width: 100, height: 80, label: "Nhắn", laneId: "l_kh" },
    { id: "t_tp", shape: "bpmn-task-user", x: 400, y: 300, width: 100, height: 80, label: "Trả lời", laneId: "l_tp" },
    { id: "t_sale", shape: "bpmn-task-user", x: 600, y: 510, width: 100, height: 80, label: "Gọi", laneId: "l_sale" },
  ],
  edges: [{ id: "f1", source: "t_kh", target: "t_tp" }, { id: "f2", source: "t_tp", target: "t_sale" }],
} as unknown as CanvasModel;

function bounds(xml: string, el: string) {
  const m = new RegExp(`bpmnElement="${el}"[^>]*>\\s*<dc:Bounds x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.-]+)" height="([\\d.-]+)"`).exec(xml);
  if (!m) throw new Error("no DI for " + el);
  return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
}

describe("BPMN export / import", () => {
  it("export nests the children in a childLaneSet and places them inside the parent", async () => {
    const xml = await exportBpmn(model);
    expect(xml).toMatch(/<bpmn:lane id="l_kalix"[^>]*>[\s\S]*?<bpmn:childLaneSet[^>]*>[\s\S]*?<bpmn:lane id="l_tp"[\s\S]*?<bpmn:lane id="l_sale"[\s\S]*?<\/bpmn:childLaneSet>/);
    const parent = bounds(xml, "l_kalix"), tp = bounds(xml, "l_tp"), sale = bounds(xml, "l_sale");
    expect([parent.y, parent.h]).toEqual([200, 400]);
    expect([tp.y, tp.h, sale.y, sale.h]).toEqual([200, 300, 500, 100]);
    expect(tp.x).toBeGreaterThan(parent.x);                  // after the parent's title strip
    expect(tp.x + tp.w).toBe(parent.x + parent.w);
    // a shape is referenced by its leaf lane and by the parent
    expect(xml).toMatch(/<bpmn:lane id="l_kalix"[^>]*>\s*<bpmn:flowNodeRef>t_tp<\/bpmn:flowNodeRef>/);
  });

  it("export → import keeps the hierarchy, sizes and each shape's leaf lane", async () => {
    const { model: back } = await importBpmn(await exportBpmn(model));
    const lanes = back.nodes.find((n) => n.id === "pool")!.attrs?.lanes as Lane[];
    expect(lanes.map((l) => [l.id, l.height, (l.lanes ?? []).map((c) => [c.id, c.height])])).toEqual([
      ["l_kh", 200, []],
      ["l_kalix", 400, [["l_tp", 300], ["l_sale", 100]]],
    ]);
    expect(["t_kh", "t_tp", "t_sale"].map((id) => back.nodes.find((n) => n.id === id)!.laneId)).toEqual(["l_kh", "l_tp", "l_sale"]);
  });
});
