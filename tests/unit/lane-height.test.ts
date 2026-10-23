/**
 * Per-lane height for `bpmn-pool` (`attrs.lanes[i].height`, optional).
 *
 * Before: the Board split a pool equally between its lanes, the BPMN export
 * re-derived lane bands from member-node midpoints and the import ignored the
 * lane DI bounds — so a lane resized in the native (bpmn-js) view snapped back
 * to an equal split after switching to the Board.
 */
import { describe, it, expect } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import { laneHeights, laneIndexAt, resizeLaneBoundary } from "../../src/canvas/laneLayout";
import { nodeHtml } from "../../src/canvas/htmlNode";
import type { CanvasModel } from "../../src/canvas/types";

type Lane = { id: string; label: string; height?: number };

function task(id: string, laneId: string, x: number, y: number) {
  return { id, shape: "bpmn-task-user", x, y, width: 100, height: 80, label: id, laneId };
}

function bounds(xml: string, el: string): { x: number; y: number; w: number; h: number } {
  const re = new RegExp(`<bpmndi:BPMNShape[^>]*bpmnElement="${el}"[^>]*>\\s*<dc:Bounds x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.-]+)" height="([\\d.-]+)"`);
  const m = re.exec(xml);
  if (!m) throw new Error(`no DI bounds for ${el}`);
  return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
}

const lanesOf = (model: CanvasModel, poolId: string): Lane[] =>
  (model.nodes.find((n) => n.id === poolId)?.attrs?.lanes as Lane[] | undefined) ?? [];

describe("laneLayout helpers", () => {
  const plain: Lane[] = [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }];

  it("legacy lanes without height split the pool equally", () => {
    expect(laneHeights(plain, 600)).toEqual([200, 200, 200]);
    expect(laneIndexAt(plain, 600, 150)).toBe(0);
    expect(laneIndexAt(plain, 600, 250)).toBe(1);
    expect(laneIndexAt(plain, 600, 450)).toBe(2);
  });

  it("assigns the lane by its own height, not an equal split", () => {
    const lanes: Lane[] = [{ id: "a", label: "A", height: 100 }, { id: "b", label: "B", height: 400 }, { id: "c", label: "C", height: 100 }];
    expect(laneHeights(lanes, 600)).toEqual([100, 400, 100]);
    // y=150 is lane B here (equal split would say A), y=450 still B (equal split: C)
    expect(laneIndexAt(lanes, 600, 50)).toBe(0);
    expect(laneIndexAt(lanes, 600, 150)).toBe(1);
    expect(laneIndexAt(lanes, 600, 450)).toBe(1);
    expect(laneIndexAt(lanes, 600, 550)).toBe(2);
    // outside the pool clamps to the edge lanes
    expect(laneIndexAt(lanes, 600, -10)).toBe(0);
    expect(laneIndexAt(lanes, 600, 999)).toBe(2);
  });

  it("scales stored heights when the pool was resized", () => {
    const lanes: Lane[] = [{ id: "a", label: "A", height: 100 }, { id: "b", label: "B", height: 300 }];
    expect(laneHeights(lanes, 800)).toEqual([200, 600]);
  });

  it("a lane without height weighs as much as an average lane", () => {
    const lanes: Lane[] = [{ id: "a", label: "A", height: 100 }, { id: "b", label: "B", height: 300 }, { id: "c", label: "C" }];
    expect(laneHeights(lanes, 600)).toEqual([100, 300, 200]);
    const html = nodeHtml("bpmn-pool", "P", undefined, { lanes: lanes as Array<{ id: string; label: string }> });
    expect(html).toContain('data-lane-id="c" style="flex: 200 1 0px"');
  });

  it("dragging a divider moves height between the two neighbouring lanes only", () => {
    const next = resizeLaneBoundary(plain, 600, 0, 80, 60);
    expect(next.map((l) => l.height)).toEqual([280, 120, 200]);
    expect(next.map((l) => l.id)).toEqual(["a", "b", "c"]);
    // clamped so neither lane drops below the minimum
    expect(resizeLaneBoundary(plain, 600, 0, 500, 60).map((l) => l.height)).toEqual([340, 60, 200]);
    expect(resizeLaneBoundary(plain, 600, 1, -500, 60).map((l) => l.height)).toEqual([200, 60, 340]);
    // input is not mutated
    expect(plain[0].height).toBeUndefined();
  });
});

describe("Board render", () => {
  it("lanes with height render proportionally; legacy lanes stay equal", () => {
    const html = nodeHtml("bpmn-pool", "P", undefined, {
      lanes: [{ id: "a", label: "A", height: 100 }, { id: "b", label: "B", height: 400 }],
    });
    expect(html).toContain('data-lane-id="a" style="flex: 100 1 0px"');
    expect(html).toContain('data-lane-id="b" style="flex: 400 1 0px"');
    // a divider handle between lanes, none after the last one
    expect(html.match(/bp-pool-lane-divider/g)?.length).toBe(1);
    const legacy = nodeHtml("bpmn-pool", "P", undefined, { lanes: [{ id: "a", label: "A" }, { id: "b", label: "B" }] });
    expect(legacy).not.toContain("flex:");
  });
});

describe("BPMN round-trip keeps lane heights", () => {
  const model: CanvasModel = {
    nodes: [
      { id: "pool_k", shape: "bpmn-pool", x: 0, y: 0, width: 1000, height: 600, label: "KALIX",
        attrs: { lanes: [
          { id: "lane_kh", label: "Khách", height: 120 },
          { id: "lane_tp", label: "Trực page", height: 360 },
          { id: "lane_sale", label: "Sale", height: 120 },
        ] } },
      task("t1", "lane_kh", 200, 20),
      task("t2", "lane_tp", 200, 130),
      task("t3", "lane_tp", 400, 380),
      task("t4", "lane_sale", 600, 500),
    ],
    edges: [
      { id: "f1", source: "t1", target: "t2" },
      { id: "f2", source: "t2", target: "t3" },
      { id: "f3", source: "t3", target: "t4" },
    ],
  } as unknown as CanvasModel;

  it("export writes each lane's own height into bpmndi", async () => {
    const xml = await exportBpmn(model);
    const pool = bounds(xml, "pool_k");
    expect(pool.y).toBe(0);
    expect(pool.h).toBe(600);
    const kh = bounds(xml, "lane_kh");
    const tp = bounds(xml, "lane_tp");
    const sale = bounds(xml, "lane_sale");
    expect([kh.h, tp.h, sale.h]).toEqual([120, 360, 120]);
    expect([kh.y, tp.y, sale.y]).toEqual([0, 120, 480]);
  });

  it("export → import gives back the same heights (Board ⇄ native view)", async () => {
    const xml = await exportBpmn(model);
    const { model: back } = await importBpmn(xml);
    expect(lanesOf(back, "pool_k").map((l) => [l.id, l.height])).toEqual([
      ["lane_kh", 120], ["lane_tp", 360], ["lane_sale", 120],
    ]);
    // and the re-export (what BpmnNativeView stores after a save) is stable
    const xml2 = await exportBpmn(back);
    expect([bounds(xml2, "lane_kh").h, bounds(xml2, "lane_tp").h, bounds(xml2, "lane_sale").h]).toEqual([120, 360, 120]);
  });

  it("import reads a lane resized in bpmn-js", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="D1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="C1"><bpmn:participant id="P1" name="KALIX" processRef="Proc1" /></bpmn:collaboration>
  <bpmn:process id="Proc1">
    <bpmn:laneSet id="LS1">
      <bpmn:lane id="L1" name="Khách"><bpmn:flowNodeRef>T1</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="L2" name="Trực page"><bpmn:flowNodeRef>T2</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:task id="T1" name="a" /><bpmn:task id="T2" name="b" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BD1"><bpmndi:BPMNPlane id="BP1" bpmnElement="C1">
    <bpmndi:BPMNShape id="P1_di" bpmnElement="P1" isHorizontal="true"><dc:Bounds x="0" y="0" width="800" height="500" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L1_di" bpmnElement="L1" isHorizontal="true"><dc:Bounds x="30" y="0" width="770" height="150" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L2_di" bpmnElement="L2" isHorizontal="true"><dc:Bounds x="30" y="150" width="770" height="350" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T1_di" bpmnElement="T1"><dc:Bounds x="200" y="40" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T2_di" bpmnElement="T2"><dc:Bounds x="200" y="300" width="100" height="80" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    const { model: back } = await importBpmn(xml);
    expect(lanesOf(back, "P1").map((l) => l.height)).toEqual([150, 350]);
  });

  it("legacy pool without lane heights exports its Board rect, lanes split equally", async () => {
    const legacy: CanvasModel = {
      ...model,
      nodes: model.nodes.map((n) => n.id !== "pool_k" ? n : {
        ...n, attrs: { lanes: lanesOf(model, "pool_k").map(({ id, label }) => ({ id, label })) },
      }),
    };
    const xml = await exportBpmn(legacy);
    const pool = bounds(xml, "pool_k");
    expect([pool.y, pool.h]).toEqual([0, 600]);
    expect([bounds(xml, "lane_kh").h, bounds(xml, "lane_tp").h, bounds(xml, "lane_sale").h]).toEqual([200, 200, 200]);
  });
});
