/**
 * Lanes nested to any depth (BPMN childLaneSet inside childLaneSet…), not just
 * one level: model helpers, Board render, layout, import / export.
 */
import { describe, it, expect } from "vitest";
import {
  allLaneIds, leafLaneAt, splitLane, mergeChildLanes, addChildLane, removeChildLane, laneBandOf, setSiblings, type PoolLane,
} from "../../src/canvas/laneLayout";
import { nodeHtml } from "../../src/canvas/htmlNode";
import { layoutInLanes, type LayoutNode, type LayoutPool } from "../../src/canvas/laneAwareLayout";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import type { CanvasModel } from "../../src/canvas/types";

type Lane = PoolLane & { label: string; lanes?: Lane[] };
// Khách | KALIX ⊃ { Vận hành ⊃ { Trực page ⊃ { Ca sáng, Ca tối }, Sale }, Kế toán }
const DEEP: Lane[] = [
  { id: "kh", label: "Khách", height: 100 },
  { id: "kalix", label: "KALIX", height: 600, lanes: [
    { id: "vh", label: "Vận hành", height: 400, lanes: [
      { id: "tp", label: "Trực page", height: 300, lanes: [
        { id: "sang", label: "Ca sáng", height: 150 },
        { id: "toi", label: "Ca tối", height: 150 },
      ] },
      { id: "sale", label: "Sale", height: 100 },
    ] },
    { id: "kt", label: "Kế toán", height: 200 },
  ] },
];

describe("lane helpers at any depth", () => {
  it("allLaneIds lists every lane, parents and descendants", () => {
    expect(allLaneIds(DEEP).sort()).toEqual(["kalix", "kh", "kt", "sale", "sang", "toi", "tp", "vh"]);
  });
  it("leafLaneAt walks down to the deepest lane under the point", () => {
    expect(leafLaneAt(DEEP, 700, 50)).toBe("kh");
    expect(leafLaneAt(DEEP, 700, 150)).toBe("sang");     // kalix 100.., vh 100..500, tp 100..400, sang 100..250
    expect(leafLaneAt(DEEP, 700, 300)).toBe("toi");
    expect(leafLaneAt(DEEP, 700, 450)).toBe("sale");
    expect(leafLaneAt(DEEP, 700, 650)).toBe("kt");
  });
  it("splitLane / mergeChildLanes work on a lane at any depth", () => {
    const split = splitLane(DEEP, "kt", ["kt1", "kt2"]);
    expect(split[1].lanes![1].lanes?.map((c) => c.id)).toEqual(["kt1", "kt2"]);
    const split3 = splitLane(DEEP, "sale", ["s1", "s2"]);
    expect(split3[1].lanes![0].lanes![1].lanes?.map((c) => c.id)).toEqual(["s1", "s2"]);
    expect(mergeChildLanes(DEEP, "tp")[1].lanes![0].lanes![0].lanes).toBeUndefined();
    expect(DEEP[1].lanes![1].lanes).toBeUndefined();     // input untouched
  });
  it("addChildLane / removeChildLane work under a deep parent; a lane left with one child merges", () => {
    const added = addChildLane(DEEP, "sang", "giua");
    expect(added[1].lanes![0].lanes![0].lanes!.map((c) => c.id)).toEqual(["sang", "giua", "toi"]);
    const one = removeChildLane(DEEP, "toi");
    expect(one[1].lanes![0].lanes![0].lanes).toBeUndefined();
    expect(removeChildLane(DEEP, "sale")[1].lanes![0].lanes).toBeUndefined();
  });
  it("laneBandOf gives a lane's siblings and its index among them", () => {
    const b = laneBandOf(DEEP, "toi", 700)!;
    expect(b.siblings.map((l) => l.id)).toEqual(["sang", "toi"]);
    expect(b.index).toBe(1);
  });
  it("laneBandOf extents follow the stored sizes down the tree", () => {
    // pool 700 → kalix has 600/700 of it = 600; vh 400/600 of that = 400; tp 300/400 of that = 300
    expect(laneBandOf(DEEP, "kalix", 700)!.extent).toBe(700);
    expect(laneBandOf(DEEP, "vh", 700)!.extent).toBeCloseTo(600);
    expect(laneBandOf(DEEP, "tp", 700)!.extent).toBeCloseTo(400);
    expect(laneBandOf(DEEP, "toi", 700)!.extent).toBeCloseTo(300);
    expect(laneBandOf(DEEP, "nope", 700)).toBeUndefined();
  });
  it("setSiblings replaces one lane's children and leaves the rest", () => {
    const out = setSiblings(DEEP, "tp", (kids) => kids.slice(0, 1));
    expect(out[1].lanes![0].lanes![0].lanes!.map((c) => c.id)).toEqual(["sang"]);
    expect(setSiblings(DEEP, null, (top) => top.slice(1)).map((l) => l.id)).toEqual(["kalix"]);
  });
});

describe("Board render", () => {
  it("draws every level and numbers the dividers by path", () => {
    const html = nodeHtml("bpmn-pool", "Pool", undefined, { lanes: DEEP });
    for (const id of ["kh", "kalix", "vh", "tp", "sang", "toi", "sale", "kt"]) expect(html).toContain(`data-lane-id="${id}"`);
    expect(html).toContain('data-lane-path="1/0/0/0"');     // between Ca sáng and Ca tối
    expect(html).toContain('data-lane-path="1/0/0"');       // between Trực page and Sale
    expect(html).toContain('data-lane-path="1/0"');         // between Vận hành and Kế toán
    expect((html.match(/class="bp-pool-sublanes"/g) ?? []).length).toBe(3);
  });
});

describe("auto layout", () => {
  it("places each shape in its deepest lane and sums the heights up the tree", () => {
    const pools: LayoutPool[] = [{ id: "p", x: 0, y: 0, width: 900, height: 700, lanes: DEEP.map((l) => ({ ...l, height: undefined })) as PoolLane[] }];
    const strip = (ls: PoolLane[]): PoolLane[] => ls.map((l) => ({ ...l, height: undefined, ...(l.lanes ? { lanes: strip(l.lanes) } : {}) }));
    pools[0].lanes = strip(DEEP);
    const nodes: LayoutNode[] = [
      { id: "a", laneId: "sang", x: 300, y: 10, width: 100, height: 80 },
      { id: "b", laneId: "toi", x: 500, y: 10, width: 100, height: 80 },
      { id: "c", laneId: "kt", x: 700, y: 10, width: 100, height: 80 },
    ];
    const out = layoutInLanes(pools, nodes, [{ source: "a", target: "b" }, { source: "b", target: "c" }]);
    const lanes = out.pools.get("p")!.lanes as Lane[];
    const h = (l: Lane): number => l.height ?? 0;
    const kalix = lanes[1], vh = kalix.lanes![0], tp = vh.lanes![0];
    expect(tp.lanes!.every((l) => h(l) > 0)).toBe(true);
    expect(h(tp)).toBe(h(tp.lanes![0]) + h(tp.lanes![1]));
    expect(h(vh)).toBe(h(tp) + h(vh.lanes![1]));
    expect(h(kalix)).toBe(h(vh) + h(kalix.lanes![1]));
    const y = (id: string) => out.nodes.get(id)!.y;
    expect(y("a")).toBeLessThan(y("b") + 1);                // sáng above tối, both inside Trực page's band
  });
});

// ── BPMN round trip ──
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="D" targetNamespace="x">
  <bpmn:collaboration id="C"><bpmn:participant id="Part" name="KALIX" processRef="P"/></bpmn:collaboration>
  <bpmn:process id="P">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="L1" name="Vận hành"><bpmn:childLaneSet id="LS1">
        <bpmn:lane id="L2" name="Trực page"><bpmn:childLaneSet id="LS2">
          <bpmn:lane id="L3" name="Ca sáng"><bpmn:childLaneSet id="LS3">
            <bpmn:lane id="L4a" name="Tổ A"><bpmn:flowNodeRef>t1</bpmn:flowNodeRef></bpmn:lane>
            <bpmn:lane id="L4b" name="Tổ B"/>
          </bpmn:childLaneSet></bpmn:lane>
          <bpmn:lane id="L3b" name="Ca tối"/>
        </bpmn:childLaneSet></bpmn:lane>
        <bpmn:lane id="L2b" name="Sale"/>
      </bpmn:childLaneSet></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:task id="t1" name="Trả lời"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Dg"><bpmndi:BPMNPlane id="Pl" bpmnElement="C">
    <bpmndi:BPMNShape id="Part_di" bpmnElement="Part" isHorizontal="true"><dc:Bounds x="0" y="0" width="900" height="800"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L1_di" bpmnElement="L1" isHorizontal="true"><dc:Bounds x="30" y="0" width="870" height="800"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L2_di" bpmnElement="L2" isHorizontal="true"><dc:Bounds x="60" y="0" width="840" height="600"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L3_di" bpmnElement="L3" isHorizontal="true"><dc:Bounds x="90" y="0" width="810" height="400"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L4a_di" bpmnElement="L4a" isHorizontal="true"><dc:Bounds x="120" y="0" width="780" height="250"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L4b_di" bpmnElement="L4b" isHorizontal="true"><dc:Bounds x="120" y="250" width="780" height="150"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L3b_di" bpmnElement="L3b" isHorizontal="true"><dc:Bounds x="90" y="400" width="810" height="200"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L2b_di" bpmnElement="L2b" isHorizontal="true"><dc:Bounds x="60" y="600" width="840" height="200"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="t1_di" bpmnElement="t1"><dc:Bounds x="300" y="60" width="100" height="80"/></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const shape = (lanes: Lane[]): unknown => lanes.map((l) => [l.id, l.height, shape(l.lanes ?? [])]);

describe("import / export of four nested levels", () => {
  it("import keeps the whole hierarchy with sizes, and the shape sits in its deepest lane", async () => {
    const { model } = await importBpmn(XML);
    const lanes = model.nodes.find((n) => n.shape === "bpmn-pool")!.attrs?.lanes as Lane[];
    expect(shape(lanes)).toEqual([
      ["L1", 800, [
        ["L2", 600, [["L3", 400, [["L4a", 250, []], ["L4b", 150, []]]], ["L3b", 200, []]]],
        ["L2b", 200, []],
      ]],
    ]);
    expect(model.nodes.find((n) => n.id === "t1")!.laneId).toBe("L4a");
  });

  it("export → import is stable, and writes each level as a childLaneSet", async () => {
    const first = await importBpmn(XML);
    const xml = await exportBpmn(first.model, first.sourceMeta);
    expect(xml).toMatch(/<bpmn:lane id="L3"[^>]*>[\s\S]*?<bpmn:childLaneSet[^>]*>[\s\S]*?<bpmn:lane id="L4a"/);
    const again = await importBpmn(xml);
    const lanes = again.model.nodes.find((n) => n.shape === "bpmn-pool")!.attrs?.lanes as Lane[];
    expect(shape(lanes)).toEqual(shape(first.model.nodes.find((n) => n.shape === "bpmn-pool")!.attrs?.lanes as Lane[]));
    expect(again.model.nodes.find((n) => n.id === "t1")!.laneId).toBe("L4a");
  });

  it("a board built with four levels exports every lane with DI inside its parent", async () => {
    const model: CanvasModel = {
      nodes: [
        { id: "pool", shape: "bpmn-pool", x: 0, y: 0, width: 1000, height: 700, label: "P", attrs: { lanes: DEEP } },
        { id: "t", shape: "bpmn-task", x: 300, y: 160, width: 100, height: 80, label: "T", laneId: "sang" },
      ],
      edges: [],
    } as unknown as CanvasModel;
    const xml = await exportBpmn(model);
    for (const id of ["kh", "kalix", "vh", "tp", "sang", "toi", "sale", "kt"]) expect(xml).toContain(`<bpmn:lane id="${id}"`);
    expect(xml).toMatch(/<bpmn:lane id="tp"[^>]*>[\s\S]*?<bpmn:childLaneSet[^>]*>[\s\S]*?<bpmn:lane id="sang"/);
    const { model: back } = await importBpmn(xml);
    expect(shape(back.nodes.find((n) => n.shape === "bpmn-pool")!.attrs?.lanes as Lane[]).toString()).toContain("sang");
    expect(back.nodes.find((n) => n.id === "t")!.laneId).toBe("sang");
  });
});
