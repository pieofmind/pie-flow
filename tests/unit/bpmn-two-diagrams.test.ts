import { describe, it, expect } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn, inspectBpmnDiagrams } from "../../src/io/bpmn/import";
import { switchBpmnDiagram } from "../../src/io/bpmn/switchDiagram";

const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"';
const shape = (id: string, x: number) => `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="100" width="100" height="80"/></bpmndi:BPMNShape>`;
const TWO = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="D" targetNamespace="urn:t">
  <bpmn:process id="PA" isExecutable="false"><bpmn:task id="a1" name="A1"/><bpmn:task id="a2" name="A2"/><bpmn:sequenceFlow id="fa" sourceRef="a1" targetRef="a2"/></bpmn:process>
  <bpmn:process id="PB" isExecutable="false"><bpmn:task id="b1" name="B1"/><bpmn:task id="b2" name="B2"/><bpmn:sequenceFlow id="fb" sourceRef="b1" targetRef="b2"/></bpmn:process>
  <bpmndi:BPMNDiagram id="DiagA"><bpmndi:BPMNPlane id="PlA" bpmnElement="PA">${shape("a1", 100)}${shape("a2", 300)}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="DiagB"><bpmndi:BPMNPlane id="PlB" bpmnElement="PB">${shape("b1", 100)}${shape("b2", 300)}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const ids = (m: { nodes: Array<{ id: string }> }) => m.nodes.map((n) => n.id).sort();
const planeOf = (xml: string, diagram: string) => xml.match(new RegExp(`<bpmndi:BPMNDiagram id="${diagram}">([\\s\\S]*?)</bpmndi:BPMNDiagram>`))?.[1] ?? "";

describe("a file with two diagrams", () => {
  it("shows only the chosen diagram's elements, whichever is chosen", async () => {
    expect(ids((await importBpmn(TWO, { diagramIndex: 0 })).model)).toEqual(["a1", "a2"]);
    expect(ids((await importBpmn(TWO, { diagramIndex: 1 })).model)).toEqual(["b1", "b2"]);
  });

  it("saving diagram 2 keeps diagram 1 whole and does not copy it into diagram 2", async () => {
    const r = await importBpmn(TWO, { diagramIndex: 1 });
    const moved = { ...r.model, nodes: r.model.nodes.map((n) => (n.id === "b1" ? { ...n, x: 555 } : n)) };
    const xml = await exportBpmn(moved, r.sourceMeta);
    expect(xml).toMatch(/<bpmn:task id="a1"/);
    expect(xml).toMatch(/<bpmn:sequenceFlow id="fa"/);
    expect(planeOf(xml, "DiagA")).toMatch(/bpmnElement="a1"[\s\S]*bpmnElement="a2"/);
    expect(planeOf(xml, "DiagB")).not.toMatch(/bpmnElement="a[12]"/);
    expect(planeOf(xml, "DiagB")).toMatch(/bpmnElement="b1"[\s\S]*x="555"/);
  });

  it("deleting a step in diagram 2 leaves diagram 1's steps alone", async () => {
    const r = await importBpmn(TWO, { diagramIndex: 1 });
    const model = { nodes: r.model.nodes.filter((n) => n.id !== "b2"), edges: [] };
    const xml = await exportBpmn(model, r.sourceMeta);
    expect(xml).not.toMatch(/id="b2"/);
    expect(xml).toMatch(/<bpmn:task id="a2"/);
    expect(xml).toMatch(/<bpmn:sequenceFlow id="fa"/);
  });

  it("edits to both diagrams survive going back and forth", async () => {
    const first = await importBpmn(TWO, { diagramIndex: 0 });
    const xml1 = await exportBpmn({ ...first.model, nodes: first.model.nodes.map((n) => (n.id === "a1" ? { ...n, label: "Mot" } : n)) }, first.sourceMeta);
    const second = await importBpmn(xml1, { diagramIndex: 1 });
    const xml2 = await exportBpmn({ ...second.model, nodes: second.model.nodes.map((n) => (n.id === "b1" ? { ...n, label: "Hai" } : n)) }, second.sourceMeta);
    expect(xml2).toMatch(/id="a1" name="Mot"/);
    expect(xml2).toMatch(/id="b1" name="Hai"/);
  });
});

describe("switching diagrams on the Board", () => {
  it("writes the edit of the current diagram, then shows the other one", async () => {
    const first = await importBpmn(TWO, { diagramIndex: 0 });
    const edited = { ...first.model, nodes: first.model.nodes.map((n) => (n.id === "a1" ? { ...n, label: "Doi ten" } : n)) };
    const next = await switchBpmnDiagram(edited, first.sourceMeta as never, 1);
    expect(ids(next.model)).toEqual(["b1", "b2"]);
    expect(String((next.sourceMeta.payload as { raw: string }).raw)).toMatch(/id="a1" name="Doi ten"/);
    expect((next.sourceMeta.payload as { diagramIndex: number }).diagramIndex).toBe(1);
    const back = await switchBpmnDiagram(next.model, next.sourceMeta, 0);
    expect(ids(back.model)).toEqual(["a1", "a2"]);
    expect(back.model.nodes.find((n) => n.id === "a1")?.label).toBe("Doi ten");
  });

  it("lists the diagrams, marking sub-process planes", async () => {
    const { diagrams } = await inspectBpmnDiagrams(TWO);
    expect(diagrams.map((d) => d.subProcess)).toEqual([false, false]);
  });
});
