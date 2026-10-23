/**
 * A collapsed sub-process keeps its child steps. BPMN (and bpmn-js drill-down)
 * puts them on a separate BPMNPlane whose bpmnElement is the sub-process;
 * an expanded sub-process draws them on the main plane.
 */
import { describe, it, expect } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import type { CanvasModel } from "../../src/canvas/types";

const model = (collapsed: boolean) => ({
  nodes: [
    { id: "s", shape: "bpmn-event-start", x: 0, y: 40, width: 36, height: 36 },
    { id: "sub", shape: "bpmn-subprocess", x: 100, y: 0, width: collapsed ? 120 : 400, height: collapsed ? 80 : 200, label: "Chăm sóc", attrs: collapsed ? { collapsed: true } : {} },
    { id: "c1", shape: "bpmn-task", x: 130, y: 60, width: 100, height: 80, label: "Gọi", parentId: "sub" },
    { id: "c2", shape: "bpmn-task", x: 280, y: 60, width: 100, height: 80, label: "Nhắn", parentId: "sub" },
  ],
  edges: [
    { id: "f", source: "s", target: "sub" },
    { id: "fc", source: "c1", target: "c2" },
  ],
}) as unknown as CanvasModel;

const planes = (xml: string) => [...xml.matchAll(/<bpmndi:BPMNPlane id="[^"]*" bpmnElement="([^"]+)">([\s\S]*?)<\/bpmndi:BPMNPlane>/g)]
  .map((m) => ({ ref: m[1], body: m[2] }));
const onPlane = (xml: string, ref: string) => planes(xml).find((p) => p.ref === ref)?.body ?? "";

describe("children of a sub-process", () => {
  it("collapsed: children + their flow sit inside the sub-process and on its own plane", async () => {
    const xml = await exportBpmn(model(true));
    expect(xml).toMatch(/<bpmn:subProcess id="sub" name="Chăm sóc">[\s\S]*<bpmn:task id="c1"[\s\S]*<bpmn:sequenceFlow id="fc"[\s\S]*<\/bpmn:subProcess>/);
    const sp = onPlane(xml, "sub");
    expect(sp).toContain('bpmnElement="c1"');
    expect(sp).toContain('bpmnElement="c2"');
    expect(sp).toContain('bpmnElement="fc"');
    const main = planes(xml).find((p) => p.ref !== "sub")!.body;
    expect(main).toMatch(/bpmnElement="sub" isExpanded="false"/);
    expect(main).not.toContain('bpmnElement="c1"');
    expect(main).not.toContain('bpmnElement="fc"');
  });

  it("collapsed: round trip keeps children, flow and the collapsed frame", async () => {
    const { model: back } = await importBpmn(await exportBpmn(model(true)));
    const sub = back.nodes.find((n) => n.id === "sub")!;
    expect(sub.shape).toBe("bpmn-subprocess");
    expect(sub.attrs).toMatchObject({ collapsed: true });
    expect(back.nodes.find((n) => n.id === "c1")).toMatchObject({ parentId: "sub", x: 130, y: 60 });
    expect(back.edges.find((e) => e.id === "fc")).toMatchObject({ source: "c1", target: "c2" });
  });

  it("expanded: everything on the main plane, no sub-plane", async () => {
    const xml = await exportBpmn(model(false));
    expect(planes(xml)).toHaveLength(1);
    expect(planes(xml)[0].body).toContain('bpmnElement="c1"');
  });

  it("patch path: collapsing moves child DI to a sub-plane, expanding moves it back", async () => {
    const first = await importBpmn(await exportBpmn(model(false)));
    const collapse = (m: CanvasModel, c: boolean) => ({
      ...m,
      nodes: m.nodes.map((n) => (n.id === "sub" ? { ...n, width: c ? 120 : 400, height: c ? 80 : 200, attrs: { ...n.attrs, collapsed: c } } : n)),
    }) as CanvasModel;
    const collapsedXml = await exportBpmn(collapse(first.model, true), first.sourceMeta);
    expect(onPlane(collapsedXml, "sub")).toContain('bpmnElement="c1"');
    expect((collapsedXml.match(/bpmnElement="c1"/g) ?? []).length).toBe(1);
    const second = await importBpmn(collapsedXml);
    expect(second.model.nodes.find((n) => n.id === "c1")).toMatchObject({ parentId: "sub" });
    const expandedXml = await exportBpmn(collapse(second.model, false), second.sourceMeta);
    expect(planes(expandedXml)).toHaveLength(1);
    expect((expandedXml.match(/bpmnElement="c1"/g) ?? []).length).toBe(1);
  });

  it("a deleted child disappears from the sub-plane too", async () => {
    const first = await importBpmn(await exportBpmn(model(true)));
    const edited = { nodes: first.model.nodes.filter((n) => n.id !== "c2"), edges: first.model.edges.filter((e) => e.id !== "fc") } as CanvasModel;
    const xml = await exportBpmn(edited, first.sourceMeta);
    expect(xml).not.toContain('"c2"');
    expect(onPlane(xml, "sub")).toContain('bpmnElement="c1"');
  });

  it("imports a bpmn-js drill-down file: main plane chosen, children read from the sub-plane", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="D" targetNamespace="x">
  <bpmn:process id="P">
    <bpmn:subProcess id="sp" name="Khung">
      <bpmn:task id="a"/><bpmn:task id="b"/><bpmn:task id="c"/>
      <bpmn:sequenceFlow id="ab" sourceRef="a" targetRef="b"/>
    </bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Dg"><bpmndi:BPMNPlane id="Pl" bpmnElement="P">
    <bpmndi:BPMNShape id="sp_di" bpmnElement="sp" isExpanded="false"><dc:Bounds x="300" y="300" width="100" height="80"/></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="Dg2"><bpmndi:BPMNPlane id="sp_plane" bpmnElement="sp">
    <bpmndi:BPMNShape id="a_di" bpmnElement="a"><dc:Bounds x="10" y="10" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="b_di" bpmnElement="b"><dc:Bounds x="200" y="10" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="c_di" bpmnElement="c"><dc:Bounds x="400" y="10" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="ab_di" bpmnElement="ab"><di:waypoint x="110" y="50"/><di:waypoint x="200" y="50"/></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    const { model: m, warnings } = await importBpmn(xml);
    expect(m.nodes.find((n) => n.id === "sp")).toMatchObject({ shape: "bpmn-subprocess", x: 300, y: 300, attrs: { collapsed: true } });
    expect(m.nodes.find((n) => n.id === "b")).toMatchObject({ parentId: "sp", x: 200, y: 10 });
    expect(m.edges.find((e) => e.id === "ab")).toBeTruthy();
    expect(warnings.join("\n")).not.toMatch(/thiếu BPMNShape DI|diagrams/);
  });
});
