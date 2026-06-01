import { describe, expect, it } from "vitest";
import type { CanvasModel } from "../../src/canvas/types";
import { validateBpmnModel } from "../../src/io/bpmn/validator";

function hasCode(issues: ReturnType<typeof validateBpmnModel>, code: string): boolean {
  return issues.some((i) => i.code === code);
}

describe("BPMN validator", () => {
  it("flags start with no outgoing", () => {
    const model: CanvasModel = { nodes: [{ id: "s", shape: "bpmn-event-start", x: 0, y: 0, width: 36, height: 36, label: "" }], edges: [] };
    expect(hasCode(validateBpmnModel(model), "START_NO_OUTGOING")).toBe(true);
  });

  it("flags end with no incoming", () => {
    const model: CanvasModel = { nodes: [{ id: "e", shape: "bpmn-event-end", x: 0, y: 0, width: 36, height: 36, label: "" }], edges: [] };
    expect(hasCode(validateBpmnModel(model), "END_NO_INCOMING")).toBe(true);
  });

  it("flags empty subprocess", () => {
    const model: CanvasModel = { nodes: [{ id: "sp", shape: "bpmn-subprocess", x: 0, y: 0, width: 200, height: 120, label: "" }], edges: [] };
    expect(hasCode(validateBpmnModel(model), "SUBPROCESS_EMPTY")).toBe(true);
  });

  it("flags boundary with missing host", () => {
    const model: CanvasModel = {
      nodes: [{ id: "b", shape: "bpmn-event-intermediate", x: 0, y: 0, width: 36, height: 36, label: "", attrs: { attachedTo: "missing" } }],
      edges: [],
    };
    expect(hasCode(validateBpmnModel(model), "BOUNDARY_NO_HOST")).toBe(true);
  });

  it("flags event gateway wrong targets", () => {
    const model: CanvasModel = {
      nodes: [
        { id: "g", shape: "bpmn-gateway-event", x: 0, y: 0, width: 50, height: 50, label: "" },
        { id: "t", shape: "bpmn-task", x: 100, y: 0, width: 120, height: 60, label: "" },
      ],
      edges: [{ id: "f", source: "g", target: "t" }],
    };
    expect(hasCode(validateBpmnModel(model), "EVENT_GW_TARGET_NON_CATCH")).toBe(true);
  });

  it("flags sequence flow crossing pools", () => {
    const model: CanvasModel = {
      nodes: [
        { id: "a", shape: "bpmn-task", x: 0, y: 0, width: 120, height: 60, label: "", attrs: { __source: { poolId: "p1" } } },
        { id: "b", shape: "bpmn-task", x: 200, y: 0, width: 120, height: 60, label: "", attrs: { __source: { poolId: "p2" } } },
      ],
      edges: [{ id: "f", source: "a", target: "b", kind: "sequence" }],
    };
    expect(hasCode(validateBpmnModel(model), "SEQUENCE_CROSSES_POOL")).toBe(true);
  });

  it("flags gateway split missing default or conditions", () => {
    const model: CanvasModel = {
      nodes: [
        { id: "g", shape: "bpmn-gateway-x", x: 0, y: 0, width: 50, height: 50, label: "" },
        { id: "a", shape: "bpmn-task", x: 100, y: -50, width: 120, height: 60, label: "" },
        { id: "b", shape: "bpmn-task", x: 100, y: 50, width: 120, height: 60, label: "" },
      ],
      edges: [{ id: "f1", source: "g", target: "a" }, { id: "f2", source: "g", target: "b", attrs: { condition: "x > 0" } }],
    };
    expect(hasCode(validateBpmnModel(model), "GATEWAY_MISSING_DEFAULT_OR_CONDITIONS")).toBe(true);
  });
});
