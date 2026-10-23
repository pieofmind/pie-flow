/** A step inside a sub-process belongs to the sub-process's process, whatever lane
 *  its position suggests: flows between such steps are sequence flows, not message flows. */
import { describe, it, expect } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import type { CanvasModel } from "../../src/canvas/types";

const n = (id: string, shape: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  ({ id, shape, x, y, width: shape.startsWith("bpmn-event") ? 36 : 100, height: shape.startsWith("bpmn-event") ? 36 : 60, label: id, ...extra });

const model = {
  nodes: [
    n("pk", "bpmn-pool", 0, 0, { width: 800, height: 120, attrs: { poolHorizontal: true, lanes: [{ id: "lk", label: "K" }] } }),
    n("ps", "bpmn-pool", 0, 200, { width: 800, height: 300, attrs: { poolHorizontal: true, lanes: [{ id: "l1", label: "A" }, { id: "l2", label: "B" }] } }),
    n("sub", "bpmn-subprocess", 100, 250, { width: 300, height: 150, laneId: "l1" }),
    // steps inside the sub-process, with lanes picked by position (one even in the other pool)
    n("s1", "bpmn-task", 120, 20, { parentId: "sub", laneId: "lk" }),
    n("s2", "bpmn-task", 260, 20, { parentId: "sub", laneId: "l2" }),
  ],
  edges: [{ id: "f", source: "s1", target: "s2" }],
} as unknown as CanvasModel;

describe("flows between steps of a sub-process", () => {
  it("are sequence flows inside the sub-process, never message flows", async () => {
    const xml = await exportBpmn(model);
    expect(xml).not.toMatch(/<bpmn:messageFlow id="f"/);
    expect(xml).toMatch(/<bpmn:subProcess id="sub"[\s\S]*<bpmn:sequenceFlow id="f"[^>]*sourceRef="s1" targetRef="s2"[\s\S]*<\/bpmn:subProcess>/);
  });
  it("steps stay in the sub-process's own process lanes", async () => {
    const xml = await exportBpmn(model);
    const lane = (id: string) => xml.match(new RegExp(`<bpmn:lane id="${id}"[\\s\\S]*?</bpmn:lane>`))?.[0] ?? "";
    expect(lane("lk")).not.toMatch(/>s1</);
  });
});

describe("a file an older build saved with message flows between sub-process steps", () => {
  const bad = { ...model, edges: [{ id: "f", source: "s1", target: "s2", kind: "message", style: { flowType: "message", dash: "dashed" } }] } as unknown as CanvasModel;
  it("exports them as sequence flows", async () => {
    const xml = await exportBpmn(bad);
    expect(xml).not.toMatch(/<bpmn:messageFlow id="f"/);
    expect(xml).toMatch(/<bpmn:sequenceFlow id="f"/);
  });
  it("a real message flow between two pools stays one", async () => {
    const real = { ...model, edges: [{ id: "mm", source: "sub", target: "pk", kind: "message" }] } as unknown as CanvasModel;
    expect(await exportBpmn(real)).toMatch(/<bpmn:messageFlow id="mm"/);
  });
});
