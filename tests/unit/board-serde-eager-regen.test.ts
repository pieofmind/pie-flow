import { describe, it, expect } from "vitest";
import {
  serializeBoard,
  deserializeBoard,
  deserializeBpmnXml,
} from "../../src/view/boardSerde";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import type { CanvasModel } from "../../src/canvas/types";

/**
 * Integration test for AC #2 — the eager-regen save path:
 *   exportBpmn(model)  →  serializeBoard(..., { bpmnXml })  →  round-trip
 */

const BPMN_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  id="defs_1" targetNamespace="http://example.com">
  <bpmn:process id="p1" isExecutable="false">
    <bpmn:startEvent id="e_start" name="Start"/>
    <bpmn:task id="t_a" name="Do A"/>
    <bpmn:endEvent id="e_end" name="End"/>
    <bpmn:sequenceFlow id="f1" sourceRef="e_start" targetRef="t_a"/>
    <bpmn:sequenceFlow id="f2" sourceRef="t_a" targetRef="e_end"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="d_1">
    <bpmndi:BPMNPlane id="pl_1" bpmnElement="p1">
      <bpmndi:BPMNShape id="s_start" bpmnElement="e_start">
        <dc:Bounds x="100" y="100" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="s_a" bpmnElement="t_a">
        <dc:Bounds x="200" y="90" width="100" height="56"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="s_end" bpmnElement="e_end">
        <dc:Bounds x="360" y="100" width="36" height="36"/>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe("BoardView eager BPMN regen — exportBpmn ↔ serializeBoard pipeline", () => {
  it("regenerated XML embeds + round-trips losslessly", async () => {
    const { model, sourceMeta } = await importBpmn(BPMN_FIXTURE);

    // Eager export (what BoardView.save() will do)
    const regenXml = await exportBpmn(model, sourceMeta);
    expect(regenXml).toContain("<bpmn:definitions");
    expect(regenXml).toContain('id="t_a"');

    // Serialize as a board file with the derived block embedded
    const fileText = serializeBoard(model, "", sourceMeta, { bpmnXml: regenXml });

    // Parse back: both blocks must survive
    const parsedModel = deserializeBoard(fileText);
    const parsedXml = deserializeBpmnXml(fileText);

    expect(parsedModel).not.toBeNull();
    expect(parsedModel?.nodes.map((n) => n.id).sort()).toEqual(
      model.nodes.map((n) => n.id).sort(),
    );
    expect(parsedXml).toBe(regenXml.trim());
  });

  it("non-BPMN canvas model still serializes (bpmnXml dropped, master preserved)", () => {
    const nonBpmnModel: CanvasModel = {
      nodes: [{ id: "sticky1", type: "rect", shape: "sticky", x: 0, y: 0, w: 80, h: 80, label: "Note" }],
      edges: [],
    } as unknown as CanvasModel;

    // Simulate the failure branch — caller passes "" to drop the derived block.
    const fileText = serializeBoard(nonBpmnModel, "", undefined, { bpmnXml: "" });

    expect(deserializeBpmnXml(fileText)).toBeNull();
    expect(deserializeBoard(fileText)?.nodes).toHaveLength(1);
  });

  it("preserves an existing BPMN block when caller skips opts.bpmnXml", async () => {
    const { model, sourceMeta } = await importBpmn(BPMN_FIXTURE);
    const xml = await exportBpmn(model, sourceMeta);
    const first = serializeBoard(model, "", sourceMeta, { bpmnXml: xml });

    // Subsequent save where save() never set cachedBpmnXml (legacy/edge case) —
    // serializer should preserve the previously embedded XML.
    const second = serializeBoard(model, first, sourceMeta);
    expect(deserializeBpmnXml(second)).toBe(xml.trim());
  });
});
