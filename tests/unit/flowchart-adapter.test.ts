import { describe, it, expect } from "vitest";
import { flowchartAdapter } from "../../src/adapters/flowchart/index";
import type { CanvasModel } from "../../src/canvas/OmniboardCanvas";

const TEMPLATE = flowchartAdapter.emptyTemplate();
const SAMPLE_MODEL: CanvasModel = { nodes: [], edges: [] };

describe("flowchart adapter — contract metadata", () => {
  it("declares id, displayName, codeBlockLanguage, icon", () => {
    expect(flowchartAdapter.id).toBe("flowchart");
    expect(flowchartAdapter.displayName).toBe("Flowchart");
    expect(flowchartAdapter.codeBlockLanguage).toBe("flowchart");
    expect(flowchartAdapter.icon).toBeTruthy();
  });

  it("exposes export formats", () => {
    expect(flowchartAdapter.exportFormats).toContain("svg");
    expect(flowchartAdapter.exportFormats).toContain("png");
  });

  it("validate() permissive", () => {
    expect(flowchartAdapter.validate(SAMPLE_MODEL).ok).toBe(true);
  });
});

describe("flowchart adapter — paletteItems", () => {
  it("declares at least 6 items", () => {
    expect(flowchartAdapter.paletteItems).toBeDefined();
    expect(flowchartAdapter.paletteItems!.length).toBeGreaterThanOrEqual(6);
  });
  it("each item has id, label, icon", () => {
    for (const item of flowchartAdapter.paletteItems!) {
      expect(item.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });
  it("ids unique", () => {
    const ids = flowchartAdapter.paletteItems!.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("covers PHẦN TỬ, LIÊN KẾT, DỮ LIỆU groups", () => {
    const groups = new Set(flowchartAdapter.paletteItems!.map((i) => i.group));
    expect(groups.has("PHẦN TỬ")).toBe(true);
    expect(groups.has("LIÊN KẾT")).toBe(true);
    expect(groups.has("DỮ LIỆU")).toBe(true);
  });
});

describe("flowchart adapter — validateSource", () => {
  it("returns [] for valid template", () => {
    expect(flowchartAdapter.validateSource!(TEMPLATE)).toEqual([]);
  });
  it("flags empty input", () => {
    expect(flowchartAdapter.validateSource!("")[0].message).toBe("Source rỗng");
    expect(flowchartAdapter.validateSource!("  \n  ")[0].message).toBe("Source rỗng");
  });
  it("flags broken JSON", () => {
    const issues = flowchartAdapter.validateSource!("{not json}");
    expect(issues.length).toBe(1);
    expect(issues[0].message).toMatch(/JSON không hợp lệ/);
  });
  it("flags missing nodes/edges arrays", () => {
    const issues = flowchartAdapter.validateSource!(JSON.stringify({ foo: "bar" }));
    expect(issues[0].message).toMatch(/nodes hoặc edges/);
  });
  it("flags non-array nodes", () => {
    const issues = flowchartAdapter.validateSource!(JSON.stringify({ nodes: "x", edges: [] }));
    expect(issues.length).toBe(1);
  });
  it("flags large source without throwing", () => {
    const huge = "x".repeat(5_000_000);
    const issues = flowchartAdapter.validateSource!(huge);
    expect(issues[0].message).toMatch(/quá lớn/);
  });
  it("never throws on garbage", () => {
    expect(() => flowchartAdapter.validateSource!("<<>><")).not.toThrow();
    expect(() => flowchartAdapter.validateSource!("null")).not.toThrow();
  });
});

describe("flowchart adapter — getTitle / setTitle", () => {
  it("getTitle returns undefined when model has no title", () => {
    expect(flowchartAdapter.getTitle!(SAMPLE_MODEL)).toBeUndefined();
  });

  it("setTitle inserts title (immutable)", () => {
    const next = flowchartAdapter.setTitle!(SAMPLE_MODEL, "My Flow") as CanvasModel & { title?: string };
    expect(next.title).toBe("My Flow");
    expect((SAMPLE_MODEL as CanvasModel & { title?: string }).title).toBeUndefined();
  });

  it("setTitle replaces existing title", () => {
    const m = flowchartAdapter.setTitle!(SAMPLE_MODEL, "A");
    const m2 = flowchartAdapter.setTitle!(m, "B");
    expect(flowchartAdapter.getTitle!(m2)).toBe("B");
  });

  it("setTitle empty string removes title", () => {
    const m = flowchartAdapter.setTitle!(SAMPLE_MODEL, "Hi");
    const m2 = flowchartAdapter.setTitle!(m, "");
    expect(flowchartAdapter.getTitle!(m2)).toBeUndefined();
  });

  it("round-trip with special chars", () => {
    const t = `A & "B" <C> ∑`;
    const m = flowchartAdapter.setTitle!(SAMPLE_MODEL, t);
    expect(flowchartAdapter.getTitle!(m)).toBe(t);
  });

  it("setTitle preserves nodes/edges content but with NEW array containers (immutable)", () => {
    const orig: CanvasModel = {
      nodes: [{ id: "n1", shape: "fc-start", x: 0, y: 0, width: 10, height: 10, label: "" }],
      edges: [{ id: "e1", source: "n1", target: "n1" }],
    };
    const next = flowchartAdapter.setTitle!(orig, "X");
    // Same content…
    expect(next.nodes).toEqual(orig.nodes);
    expect(next.edges).toEqual(orig.edges);
    // …but distinct array references so a later push() cannot corrupt `orig`.
    expect(next.nodes).not.toBe(orig.nodes);
    expect(next.edges).not.toBe(orig.edges);
  });

  it("setTitle does not let array mutation on the result leak into the source", () => {
    const orig: CanvasModel = { nodes: [], edges: [] };
    const next = flowchartAdapter.setTitle!(orig, "X");
    (next.nodes as unknown[]).push({ id: "x" });
    expect(orig.nodes.length).toBe(0);
  });
});
