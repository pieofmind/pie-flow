/**
 * A message flow drawn on a board whose .bpmn has no collaboration (no pools)
 * has no valid host, so export writes it as a sequence flow in the process.
 *
 * Before: it created a MessageFlow then assigned `$type` — a getter-only
 * property on moddle elements — so patchExisting threw and the whole export
 * fell back to emitMinimal, losing everything only the original file had.
 */
import { describe, it, expect, vi } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import type { CanvasModel } from "../../src/canvas/types";

const base = {
  nodes: [
    { id: "a", shape: "bpmn-task", x: 0, y: 0, width: 100, height: 80, label: "A" },
    { id: "b", shape: "bpmn-task", x: 200, y: 0, width: 100, height: 80, label: "B" },
  ],
  edges: [],
} as unknown as CanvasModel;

describe("message flow on a board without pools", () => {
  it("patches the original file and writes a sequence flow", async () => {
    // Something only the original file has: documentation on the process.
    const raw = (await exportBpmn(base)).replace(
      /(<bpmn:process id="Process_Export"[^>]*>)/,
      "$1<bpmn:documentation>giữ lại</bpmn:documentation>",
    );
    const imported = await importBpmn(raw);
    const edited = { ...imported.model, edges: [{ id: "m1", source: "a", target: "b", kind: "message" }] } as CanvasModel;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const xml = await exportBpmn(edited, imported.sourceMeta);
    const fellBack = warn.mock.calls.some((c) => String(c[0]).includes("patchExisting failed"));
    warn.mockRestore();
    expect(fellBack).toBe(false);
    expect(xml).toContain("giữ lại");
    expect(xml).toMatch(/<bpmn:sequenceFlow id="m1"[^>]*sourceRef="a" targetRef="b"/);
    expect(xml).not.toContain("messageFlow");
  });
});
