import { describe, it, expect } from "vitest";
import { flowchartAdapter } from "../../src/adapters/flowchart/index";
import type { CanvasModel } from "../../src/canvas/OmniboardCanvas";
import type { PropertyFieldText } from "../../src/core/sidebarSchema";

const BASE: CanvasModel = { nodes: [], edges: [] };

describe("7-8b — getPropertyFields function-form contract", () => {
  it("flowchart adapter exposes getPropertyFields", () => {
    expect(typeof flowchartAdapter.getPropertyFields).toBe("function");
  });

  it("returns a title text field reading from the live model", () => {
    const titled = flowchartAdapter.setTitle!(BASE, "Quy trình A");
    const fields = flowchartAdapter.getPropertyFields!({
      model: titled,
      setModel: () => {},
    });
    expect(fields.length).toBeGreaterThanOrEqual(1);
    const title = fields.find((f) => f.key === "title") as PropertyFieldText;
    expect(title).toBeDefined();
    expect(title.kind).toBe("text");
    expect(title.value).toBe("Quy trình A");
  });

  it("title field value is empty string when model has no title", () => {
    const fields = flowchartAdapter.getPropertyFields!({ model: BASE, setModel: () => {} });
    const title = fields.find((f) => f.key === "title") as PropertyFieldText;
    expect(title.value).toBe("");
  });

  it("onChange dispatches an immutable model update via setModel", () => {
    let dispatched: CanvasModel | undefined;
    const fields = flowchartAdapter.getPropertyFields!({
      model: BASE,
      setModel: (next) => {
        dispatched = next;
      },
    });
    const title = fields.find((f) => f.key === "title") as PropertyFieldText;
    title.onChange!("Tên mới");

    expect(dispatched).toBeDefined();
    expect(flowchartAdapter.getTitle!(dispatched!)).toBe("Tên mới");
    // Original model untouched (immutability).
    expect(flowchartAdapter.getTitle!(BASE)).toBeUndefined();
    expect(dispatched).not.toBe(BASE);
  });

  it("does not mutate the context model when building fields", () => {
    const snapshot = JSON.stringify(BASE);
    flowchartAdapter.getPropertyFields!({ model: BASE, setModel: () => {} });
    expect(JSON.stringify(BASE)).toBe(snapshot);
  });

  it("accepts an optional selectedId in context (ignored by flowchart proof)", () => {
    const fields = flowchartAdapter.getPropertyFields!({
      model: BASE,
      selectedId: "node-42",
      setModel: () => {},
    });
    // flowchart proof is selection-agnostic — still returns the title field.
    expect(fields.find((f) => f.key === "title")).toBeDefined();
  });

  it("each onChange uses the model it was built with (no stale lost-update within one build)", () => {
    // Building once then dispatching reflects the build-time model; the host
    // contract requires re-calling getPropertyFields after setModel — verified
    // here by rebuilding with the dispatched model and confirming continuity.
    let model = flowchartAdapter.setTitle!(BASE, "A");
    const setModel = (next: CanvasModel) => {
      model = next;
    };
    // Build against current model, dispatch a new title.
    const fields1 = flowchartAdapter.getPropertyFields!({ model, setModel });
    (fields1.find((f) => f.key === "title") as { onChange?: (v: string) => void }).onChange!("B");
    expect(flowchartAdapter.getTitle!(model)).toBe("B");
    // Host re-builds with the updated model — next edit stacks correctly.
    const fields2 = flowchartAdapter.getPropertyFields!({ model, setModel });
    (fields2.find((f) => f.key === "title") as { onChange?: (v: string) => void }).onChange!("C");
    expect(flowchartAdapter.getTitle!(model)).toBe("C");
  });
});
