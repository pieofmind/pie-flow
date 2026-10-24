/** The board's dark mode + background live in the file and survive the native round-trip. */
import { describe, it, expect } from "vitest";
import { serializeBoard, deserializeBoard } from "../../src/view/boardSerde";
import { mergeBpmnImport } from "../../src/view/mergeBpmnCanvas";
import type { CanvasModel } from "../../src/canvas/types";

const model: CanvasModel = {
  nodes: [{ id: "a", shape: "bpmn-task", x: 0, y: 0, width: 100, height: 80, label: "A" }],
  edges: [],
  appState: { theme: "dark", background: "#F8F9FA" },
};

describe("board appState", () => {
  it("is saved in the file and read back", () => {
    expect(deserializeBoard(serializeBoard(model))?.appState).toEqual(model.appState);
  });
  it("survives a BPMN native round-trip merge", () => {
    const merged = mergeBpmnImport(model, new Set(["a"]), { nodes: model.nodes, edges: [] });
    expect(merged.model.appState).toEqual(model.appState);
  });
  it("is absent for a default board", () => {
    expect(deserializeBoard(serializeBoard({ nodes: [], edges: [] }))?.appState).toBeUndefined();
  });
});
