/**
 * Multi-pool export: each participant's DI bounds must wrap ITS OWN member
 * nodes (lane membership / geometry), not the bbox of the whole canvas.
 *
 * Before the fix `emitPoolLaneShapes` computed one bbox over every flow node
 * and stamped it on every pool → 3 pools rendered as 3 identical full-canvas
 * frames in the native (bpmn-js) view.
 */
import { describe, it, expect } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import type { CanvasModel } from "../../src/canvas/types";

function task(id: string, laneId: string, x: number, y: number) {
  return { id, shape: "bpmn-task-user", x, y, width: 100, height: 80, label: id, laneId };
}

const model: CanvasModel = {
  nodes: [
    { id: "pool_a", shape: "bpmn-pool", x: 32, y: 0, width: 1200, height: 520, label: "A",
      attrs: { lanes: [{ id: "a_l1", label: "A1" }, { id: "a_l2", label: "A2" }] } },
    { id: "pool_b", shape: "bpmn-pool", x: 32, y: 600, width: 1200, height: 210, label: "B",
      attrs: { lanes: [{ id: "b_l1", label: "B1" }] } },
    task("a1", "a_l1", 150, 90),
    task("a2", "a_l2", 400, 350),
    task("b1", "b_l1", 300, 665),
    task("b2", "b_l1", 900, 665),
  ],
  edges: [
    { id: "e1", source: "a1", target: "a2" },
    { id: "e2", source: "b1", target: "b2" },
    { id: "m1", source: "a2", target: "b1", kind: "message" },
  ],
} as unknown as CanvasModel;

function bounds(xml: string, el: string): { x: number; y: number; w: number; h: number } {
  const re = new RegExp(`<bpmndi:BPMNShape[^>]*bpmnElement="${el}"[^>]*>\\s*<dc:Bounds x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.-]+)" height="([\\d.-]+)"`);
  const m = re.exec(xml);
  if (!m) throw new Error(`no DI bounds for ${el}`);
  return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
}

describe("multi-pool export: per-pool participant bounds", () => {
  it("each pool wraps only its own nodes and pools do not overlap", async () => {
    const xml = await exportBpmn(model);
    const a = bounds(xml, "pool_a");
    const b = bounds(xml, "pool_b");
    // pool A must contain a1/a2 but stop above pool B's nodes
    expect(a.y).toBeLessThanOrEqual(90);
    expect(a.y + a.h).toBeGreaterThanOrEqual(350 + 80);
    expect(a.y + a.h).toBeLessThan(665);
    // pool B must start below pool A and contain b1/b2
    expect(b.y).toBeGreaterThan(a.y + a.h);
    expect(b.y).toBeLessThanOrEqual(665);
    expect(b.y + b.h).toBeGreaterThanOrEqual(665 + 80);
    // lanes of pool B must live inside pool B, not span the canvas
    const bl = bounds(xml, "b_l1");
    expect(bl.y).toBeGreaterThanOrEqual(b.y);
    expect(bl.y + bl.h).toBeLessThanOrEqual(b.y + b.h + 0.01);
  });
});
