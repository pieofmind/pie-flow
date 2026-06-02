import { describe, it, expect } from "vitest";
import { mergeBpmnImport, collectIds } from "../../src/view/mergeBpmnCanvas";
import type { CanvasModel } from "../../src/canvas/types";

const makeNode = (id: string, label = ""): CanvasModel["nodes"][number] =>
  ({ id, type: "rect", x: 0, y: 0, w: 100, h: 50, label } as unknown as CanvasModel["nodes"][number]);

const makeEdge = (id: string, source: string, target: string): CanvasModel["edges"][number] =>
  ({ id, source, target } as unknown as CanvasModel["edges"][number]);

describe("mergeBpmnImport", () => {
  it("preserves canvas-only sticky/free-arrow when BPMN view round-trips unchanged", () => {
    const oldCanvas: CanvasModel = {
      nodes: [makeNode("task1", "Task 1"), makeNode("sticky1", "Note")],
      edges: [makeEdge("flow1", "task1", "task1"), makeEdge("free1", "sticky1", "task1")],
    };
    const oldBpmnIds = new Set(["task1", "flow1"]);

    // BPMN view round-trip: same task & flow back, nothing else
    const newImport: CanvasModel = {
      nodes: [makeNode("task1", "Task 1")],
      edges: [makeEdge("flow1", "task1", "task1")],
    };

    const result = mergeBpmnImport(oldCanvas, oldBpmnIds, newImport);

    expect(result.preservedNodes).toBe(1);
    expect(result.preservedEdges).toBe(1);
    expect(result.model.nodes.map((n) => n.id).sort()).toEqual(["sticky1", "task1"]);
    expect(result.model.edges.map((e) => e.id).sort()).toEqual(["flow1", "free1"]);
  });

  it("drops a BPMN element when user deleted it in BPMN view", () => {
    const oldCanvas: CanvasModel = {
      nodes: [makeNode("task1"), makeNode("task2"), makeNode("sticky1")],
      edges: [],
    };
    const oldBpmnIds = new Set(["task1", "task2"]);

    // User deleted task2 in BPMN view
    const newImport: CanvasModel = {
      nodes: [makeNode("task1")],
      edges: [],
    };

    const result = mergeBpmnImport(oldCanvas, oldBpmnIds, newImport);

    expect(result.model.nodes.map((n) => n.id).sort()).toEqual(["sticky1", "task1"]);
  });

  it("adopts new positions/labels from BPMN view edits", () => {
    const oldCanvas: CanvasModel = {
      nodes: [makeNode("task1", "Old Name")],
      edges: [],
    };
    const oldBpmnIds = new Set(["task1"]);

    // User renamed + moved in BPMN view
    const newImport: CanvasModel = {
      nodes: [{ ...makeNode("task1", "New Name"), x: 500, y: 200 } as CanvasModel["nodes"][number]],
      edges: [],
    };

    const result = mergeBpmnImport(oldCanvas, oldBpmnIds, newImport);
    const t = result.model.nodes.find((n) => n.id === "task1");

    expect(t?.label).toBe("New Name");
    expect((t as { x: number }).x).toBe(500);
  });

  it("adds brand-new BPMN elements created in BPMN view", () => {
    const oldCanvas: CanvasModel = {
      nodes: [makeNode("task1"), makeNode("sticky1")],
      edges: [],
    };
    const oldBpmnIds = new Set(["task1"]);

    // User added task2 in BPMN view
    const newImport: CanvasModel = {
      nodes: [makeNode("task1"), makeNode("task2", "Brand New")],
      edges: [],
    };

    const result = mergeBpmnImport(oldCanvas, oldBpmnIds, newImport);
    expect(result.model.nodes.map((n) => n.id).sort()).toEqual(["sticky1", "task1", "task2"]);
  });

  it("collectIds returns every node and edge id", () => {
    const c: CanvasModel = {
      nodes: [makeNode("n1"), makeNode("n2")],
      edges: [makeEdge("e1", "n1", "n2")],
    };
    expect(collectIds(c)).toEqual(new Set(["n1", "n2", "e1"]));
  });
});
