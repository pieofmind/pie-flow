/** Straight message flow (same X) must export exactly 2 waypoints and must not
 *  come back from XML with a vertex sitting on the endpoint. */
import { describe, it, expect } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import type { CanvasModel } from "../../src/canvas/types";

const model = {
  nodes: [
    { id: "pool_a", shape: "bpmn-pool", x: 32, y: 0, width: 800, height: 210, label: "A", attrs: { lanes: [{ id: "la", label: "A" }] } },
    { id: "pool_b", shape: "bpmn-pool", x: 32, y: 280, width: 800, height: 210, label: "B", attrs: { lanes: [{ id: "lb", label: "B" }] } },
    { id: "a1", shape: "bpmn-task-send", x: 300, y: 65, width: 100, height: 80, label: "Send", laneId: "la" },
    { id: "b1", shape: "bpmn-task-user", x: 300, y: 345, width: 100, height: 80, label: "Recv", laneId: "lb" },
  ],
  edges: [{ id: "m1", source: "a1", target: "b1", kind: "message", router: "orth",
            sourceAnchor: { dx: 50, dy: 80 }, targetAnchor: { dx: 50, dy: 0 } }],
} as unknown as CanvasModel;

describe("waypoint dedupe on straight message flows", () => {
  it("exports 2 waypoints and re-imports without endpoint vertices", async () => {
    const xml = await exportBpmn(model);
    const di = /<bpmndi:BPMNEdge[^>]*bpmnElement="m1"[^>]*>([\s\S]*?)<\/bpmndi:BPMNEdge>/.exec(xml)![1];
    expect((di.match(/<di:waypoint/g) ?? []).length).toBe(2);
    const back = (await importBpmn(xml)).model;
    const m1 = back.edges.find((e) => e.id === "m1");
    expect(m1).toBeTruthy();
    expect(m1!.vertices ?? []).toHaveLength(0);
  });
});
