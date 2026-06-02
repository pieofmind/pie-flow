import { describe, it, expect } from "vitest";
import {
  serializeBoard,
  deserializeBoard,
  deserializeBpmnXml,
  deserializeSourceMeta,
} from "../../src/view/boardSerde";
import type { CanvasModel } from "../../src/canvas/types";

const sampleModel: CanvasModel = {
  nodes: [
    { id: "n1", type: "rect", x: 10, y: 20, w: 100, h: 50, label: "Task A" },
    { id: "n2", type: "rect", x: 200, y: 20, w: 100, h: 50, label: "Task B" },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2", label: "flow" }],
};

const sampleBpmnXml =
  `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  id="defs_1" targetNamespace="http://example.com/bpmn">
  <bpmn:process id="p1" isExecutable="false">
    <bpmn:task id="n1" name="Task A"/>
  </bpmn:process>
</bpmn:definitions>`;

describe("boardSerde — omniboard-bpmn-xml block", () => {
  it("round-trips a board file that contains a BPMN block", () => {
    const raw = serializeBoard(sampleModel, "", undefined, { bpmnXml: sampleBpmnXml });
    expect(raw).toContain("```omniboard-bpmn-xml");
    expect(raw).toContain("<bpmn:definitions");

    const parsedModel = deserializeBoard(raw);
    const parsedXml = deserializeBpmnXml(raw);

    expect(parsedModel).not.toBeNull();
    expect(parsedModel?.nodes).toHaveLength(2);
    expect(parsedModel?.edges).toHaveLength(1);
    expect(parsedXml).toBe(sampleBpmnXml.trim());
  });

  it("parses legacy files (no BPMN block) without crashing", () => {
    const legacyRaw = serializeBoard(sampleModel);
    expect(legacyRaw).not.toContain("omniboard-bpmn-xml");

    const parsedModel = deserializeBoard(legacyRaw);
    const parsedXml = deserializeBpmnXml(legacyRaw);

    expect(parsedModel?.nodes).toHaveLength(2);
    expect(parsedXml).toBeNull();
  });

  it("preserves a previous BPMN block when caller omits bpmnXml on resave", () => {
    const first = serializeBoard(sampleModel, "", undefined, { bpmnXml: sampleBpmnXml });
    // Caller omits bpmnXml — should preserve the block already present in previousRaw.
    const second = serializeBoard(sampleModel, first);
    expect(deserializeBpmnXml(second)).toBe(sampleBpmnXml.trim());
  });

  it("explicitly drops the BPMN block when caller passes empty string", () => {
    const first = serializeBoard(sampleModel, "", undefined, { bpmnXml: sampleBpmnXml });
    const second = serializeBoard(sampleModel, first, undefined, { bpmnXml: "" });
    expect(deserializeBpmnXml(second)).toBeNull();
  });

  it("preserves the source-meta block alongside the BPMN block", () => {
    const meta = { kind: "bpmn-import", originalFile: "demo.bpmn" };
    const raw = serializeBoard(sampleModel, "", meta, { bpmnXml: sampleBpmnXml });

    expect(deserializeSourceMeta(raw)).toEqual(meta);
    expect(deserializeBpmnXml(raw)).toBe(sampleBpmnXml.trim());
    expect(deserializeBoard(raw)?.nodes).toHaveLength(2);
  });

  it("treats a whitespace-only BPMN block as absent", () => {
    const rawWithWhitespace = serializeBoard(sampleModel, "", undefined, {
      bpmnXml: "   \n\t  ",
    });
    expect(deserializeBpmnXml(rawWithWhitespace)).toBeNull();
  });
});
