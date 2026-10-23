/**
 * Exporting a Board opened from a .bpmn file must not lose what only the file
 * has (timer / ref details, loop cardinality, extra documentation, other pools),
 * and must write back what the Board removed.
 */
import { describe, it, expect, vi } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import type { CanvasModel } from "../../src/canvas/types";

const NS = `xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`;
const shape = (id: string, x: number, y = 100, w = 100, h = 80) =>
  `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}"/></bpmndi:BPMNShape>`;
const doc = (process: string, di: string, extraRoots = "") => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="D" targetNamespace="x">${extraRoots}
  <bpmn:process id="P">${process}</bpmn:process>
  <bpmndi:BPMNDiagram id="Dg"><bpmndi:BPMNPlane id="Pl" bpmnElement="P">${di}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** import → (edit) → export through the patch path, failing on a silent fallback. */
async function roundTrip(xml: string, edit: (m: CanvasModel) => CanvasModel = (m) => m): Promise<string> {
  const imported = await importBpmn(xml);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const out = await exportBpmn(edit(imported.model), imported.sourceMeta);
  const fellBack = warn.mock.calls.some((c) => String(c[0]).includes("patchExisting failed"));
  warn.mockRestore();
  expect(fellBack).toBe(false);
  return out;
}
const setAttrs = (id: string, patch: Record<string, unknown>) => (m: CanvasModel): CanvasModel => ({
  ...m,
  nodes: m.nodes.map((n) => (n.id === id ? { ...n, attrs: { ...n.attrs, ...patch } } : n)),
});

describe("details only the file has survive an export", () => {
  it("timer duration on a start event", async () => {
    const xml = doc(`<bpmn:startEvent id="s"><bpmn:timerEventDefinition id="td"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT8H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:startEvent>`, shape("s", 0, 100, 36, 36));
    expect(await roundTrip(xml)).toMatch(/<bpmn:timeDuration[^>]*>PT8H<\/bpmn:timeDuration>/);
  });

  it("messageRef on a message event", async () => {
    const xml = doc(`<bpmn:startEvent id="s"><bpmn:messageEventDefinition id="md" messageRef="Msg"/></bpmn:startEvent>`, shape("s", 0, 100, 36, 36), `<bpmn:message id="Msg" name="Tin Zalo"/>`);
    expect(await roundTrip(xml)).toMatch(/<bpmn:messageEventDefinition id="md" messageRef="Msg"/);
  });

  it("multi-instance cardinality + completion condition, also when switched to sequential", async () => {
    const xml = doc(`<bpmn:task id="t"><bpmn:multiInstanceLoopCharacteristics><bpmn:loopCardinality xsi:type="bpmn:tFormalExpression">3</bpmn:loopCardinality><bpmn:completionCondition xsi:type="bpmn:tFormalExpression">done</bpmn:completionCondition></bpmn:multiInstanceLoopCharacteristics></bpmn:task>`, shape("t", 0));
    const same = await roundTrip(xml);
    expect(same).toMatch(/<bpmn:loopCardinality[^>]*>3<\/bpmn:loopCardinality>/);
    expect(same).toMatch(/<bpmn:completionCondition[^>]*>done<\/bpmn:completionCondition>/);
    const seq = await roundTrip(xml, setAttrs("t", { markers: ["mi-seq"] }));
    expect(seq).toMatch(/<bpmn:multiInstanceLoopCharacteristics isSequential="true">/);
    expect(seq).toMatch(/<bpmn:loopCardinality[^>]*>3<\/bpmn:loopCardinality>/);
  });

  it("documentation after the first one", async () => {
    const xml = doc(`<bpmn:task id="t"><bpmn:documentation>Một</bpmn:documentation><bpmn:documentation>Hai</bpmn:documentation></bpmn:task>`, shape("t", 0));
    const out = await roundTrip(xml, setAttrs("t", { bpmnDoc: "Một sửa" }));
    expect(out).toContain("Một sửa");
    expect(out).toContain("<bpmn:documentation>Hai</bpmn:documentation>");
  });

  it("the expression language of a sequence-flow condition", async () => {
    const xml = doc(`<bpmn:exclusiveGateway id="g"/><bpmn:task id="t"/><bpmn:sequenceFlow id="f" sourceRef="g" targetRef="t"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" language="feel">x &gt; 1</bpmn:conditionExpression></bpmn:sequenceFlow>`,
      shape("g", 0, 100, 50, 50) + shape("t", 200) + `<bpmndi:BPMNEdge id="f_di" bpmnElement="f"><di:waypoint x="50" y="125"/><di:waypoint x="200" y="140"/></bpmndi:BPMNEdge>`);
    expect(await roundTrip(xml)).toMatch(/<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression" language="feel">x &gt; 1<\/bpmn:conditionExpression>/);
  });
});

describe("what the Board removed is removed from the file", () => {
  it("trigger, loop, compensation and non-interrupting", async () => {
    const xml = doc(
      `<bpmn:task id="t" isForCompensation="true"><bpmn:standardLoopCharacteristics/></bpmn:task>
       <bpmn:boundaryEvent id="b" attachedToRef="t" cancelActivity="false"><bpmn:timerEventDefinition/></bpmn:boundaryEvent>`,
      shape("t", 0) + shape("b", 82, 162, 36, 36));
    const out = await roundTrip(xml, (m) => setAttrs("b", { trigger: undefined, interrupting: undefined })(setAttrs("t", { markers: [] })(m)));
    expect(out).not.toContain("standardLoopCharacteristics");
    expect(out).not.toContain("isForCompensation");
    expect(out).not.toContain("timerEventDefinition");
    expect(out).not.toContain('cancelActivity="false"');
  });
});

describe("several pools", () => {
  const twoPools = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="D" targetNamespace="x">
  <bpmn:collaboration id="C">
    <bpmn:participant id="PA" name="KALIX" processRef="P1"/>
    <bpmn:participant id="PB" name="Khách" processRef="P2"/>
  </bpmn:collaboration>
  <bpmn:process id="P1"><bpmn:task id="a"/></bpmn:process>
  <bpmn:process id="P2"><bpmn:task id="b"/><bpmn:task id="gone"/></bpmn:process>
  <bpmndi:BPMNDiagram id="Dg"><bpmndi:BPMNPlane id="Pl" bpmnElement="C">
    <bpmndi:BPMNShape id="PA_di" bpmnElement="PA" isHorizontal="true"><dc:Bounds x="0" y="0" width="800" height="200"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="PB_di" bpmnElement="PB" isHorizontal="true"><dc:Bounds x="0" y="300" width="800" height="200"/></bpmndi:BPMNShape>
    ${shape("a", 100, 60)}${shape("b", 100, 360)}${shape("gone", 300, 360)}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
  const proc = (xml: string, id: string) => xml.match(new RegExp(`<bpmn:process id="${id}"[^>]*>([\\s\\S]*?)</bpmn:process>`))?.[1] ?? "";

  it("a shape added in the second pool lands in its process; one deleted there is gone; nothing is duplicated", async () => {
    const out = await roundTrip(twoPools, (m) => ({
      ...m,
      nodes: [...m.nodes.filter((n) => n.id !== "gone"), { id: "c", shape: "bpmn-task", x: 400, y: 360, width: 100, height: 80, label: "Mới" }],
      edges: [{ id: "bc", source: "b", target: "c" }],
    }) as CanvasModel);
    expect(proc(out, "P2")).toMatch(/<bpmn:task id="c"/);
    expect(proc(out, "P2")).toMatch(/<bpmn:sequenceFlow id="bc"/);
    expect(proc(out, "P1")).not.toMatch(/id="c"|id="bc"/);
    expect(out).not.toContain('"gone"');
    expect((out.match(/<bpmn:task id="b"/g) ?? []).length).toBe(1);
  });
});

describe("artifacts and data", () => {
  it("a new annotation / group goes to artifacts and the group keeps its label", async () => {
    const xml = doc(`<bpmn:task id="t"/>`, shape("t", 0));
    const out = await roundTrip(xml, (m) => ({
      ...m,
      nodes: [...m.nodes,
        { id: "an", shape: "bpmn-annotation", x: 200, y: 0, width: 120, height: 40, label: "Ghi chú" },
        { id: "gr", shape: "bpmn-group", x: -20, y: 80, width: 160, height: 120, label: "Nhóm A" }],
    }) as CanvasModel);
    const flow = out.match(/<bpmn:process id="P"[^>]*>([\s\S]*?)<\/bpmn:process>/)![1];
    expect(flow).toMatch(/<bpmn:textAnnotation id="an">\s*<bpmn:text>Ghi chú<\/bpmn:text>/);
    expect(flow).toMatch(/<bpmn:group id="gr" categoryValueRef="[^"]+"/);
    const back = await importBpmn(out);
    expect(back.model.nodes.find((n) => n.id === "gr")?.label).toBe("Nhóm A");
    expect(back.model.nodes.find((n) => n.id === "an")?.label).toBe("Ghi chú");
  });

  it("a data object marked collection: import reads isCollection, export writes it on the DataObject", async () => {
    const xml = doc(`<bpmn:dataObject id="do" isCollection="true"/><bpmn:dataObjectReference id="dr" name="Đơn" dataObjectRef="do"/>`, shape("dr", 0, 100, 36, 50));
    const imported = await importBpmn(xml);
    expect(imported.model.nodes.find((n) => n.id === "dr")?.shape).toBe("bpmn-data-collection");
    const fresh = await exportBpmn({ nodes: [{ id: "dc", shape: "bpmn-data-collection", x: 0, y: 0, width: 36, height: 50, label: "Ds" }], edges: [] } as unknown as CanvasModel);
    expect(fresh).toMatch(/<bpmn:dataObject id="[^"]+" isCollection="true"/);
    expect(fresh).toMatch(/<bpmn:dataObjectReference id="dc" name="Ds" dataObjectRef="[^"]+"/);
    expect((await importBpmn(fresh)).model.nodes.find((n) => n.id === "dc")?.shape).toBe("bpmn-data-collection");
  });

  it("data input / output live in the process ioSpecification and come back on import", async () => {
    const out = await exportBpmn({ nodes: [
      { id: "t", shape: "bpmn-task", x: 200, y: 0, width: 100, height: 80, label: "T" },
      { id: "in", shape: "bpmn-data-input", x: 0, y: 0, width: 36, height: 50, label: "Vào" },
      { id: "out", shape: "bpmn-data-output", x: 400, y: 0, width: 36, height: 50, label: "Ra" },
    ], edges: [] } as unknown as CanvasModel);
    const io = out.match(/<bpmn:ioSpecification[^>]*>([\s\S]*?)<\/bpmn:ioSpecification>/)?.[1] ?? "";
    expect(io).toMatch(/<bpmn:dataInput id="in" name="Vào"/);
    expect(io).toMatch(/<bpmn:dataOutput id="out" name="Ra"/);
    const back = (await importBpmn(out)).model.nodes;
    expect(back.find((n) => n.id === "in")).toMatchObject({ shape: "bpmn-data-input", label: "Vào", x: 0 });
    expect(back.find((n) => n.id === "out")).toMatchObject({ shape: "bpmn-data-output", label: "Ra", x: 400 });
  });
});
