/** bpmn-annotation canvas label ↔ bpmn:TextAnnotation.text (not .name). */
import { describe, it, expect } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import type { CanvasModel } from "../../src/canvas/types";

const model = {
  nodes: [
    { id: "t1", shape: "bpmn-task-user", x: 100, y: 100, width: 100, height: 80, label: "Task" },
    { id: "anno_t1", shape: "bpmn-annotation", x: 100, y: 200, width: 150, height: 56, label: "⚠ ghi chú" },
  ],
  edges: [{ id: "assoc_t1", source: "t1", target: "anno_t1", kind: "association" }],
} as unknown as CanvasModel;

describe("text annotation export", () => {
  it("writes the canvas label into <bpmn:text>", async () => {
    const xml = await exportBpmn(model);
    expect(xml).toMatch(/<bpmn:textAnnotation id="anno_t1">\s*<bpmn:text>⚠ ghi chú<\/bpmn:text>/);
    expect(xml).not.toMatch(/textAnnotation id="anno_t1" name=/);
  });
});
