import { describe, it, expect } from "vitest";
import {
  parseMindmapToCanvas,
  serializeMindmapFromCanvas,
} from "../../src/adapters/mindmap/parse";

describe("parseMindmapToCanvas", () => {
  const SRC = `# Central topic
## Branch A
### Leaf 1
### Leaf 2
## Branch B
### Leaf 3`;

  it("maps heading levels to mm-root/branch/leaf kinds", () => {
    const m = parseMindmapToCanvas(SRC);
    const byLabel = new Map(m.nodes.map((n) => [n.label, n.shape]));
    expect(byLabel.get("Central topic")).toBe("mm-root");
    expect(byLabel.get("Branch A")).toBe("mm-branch");
    expect(byLabel.get("Leaf 1")).toBe("mm-leaf");
  });

  it("creates parent→child edges", () => {
    const m = parseMindmapToCanvas(SRC);
    // 5 non-root nodes each have one parent edge.
    expect(m.edges.length).toBe(5);
    // Root has no incoming edge.
    const rootId = m.nodes.find((n) => n.label === "Central topic")!.id;
    expect(m.edges.some((e) => e.target === rootId)).toBe(false);
  });

  it("positions deeper levels further right (x by depth)", () => {
    const m = parseMindmapToCanvas(SRC);
    const root = m.nodes.find((n) => n.label === "Central topic")!;
    const branch = m.nodes.find((n) => n.label === "Branch A")!;
    const leaf = m.nodes.find((n) => n.label === "Leaf 1")!;
    expect(branch.x).toBeGreaterThan(root.x);
    expect(leaf.x).toBeGreaterThan(branch.x);
  });

  it("returns empty model for empty source", () => {
    expect(parseMindmapToCanvas("")).toEqual({ nodes: [], edges: [] });
    expect(parseMindmapToCanvas("no headings here")).toEqual({ nodes: [], edges: [] });
  });

  it("never throws on malformed input", () => {
    expect(() => parseMindmapToCanvas("###### only deep\n# then root")).not.toThrow();
  });

  it("round-trips parse → serialize losslessly", () => {
    const out = serializeMindmapFromCanvas(parseMindmapToCanvas(SRC));
    expect(out.trim()).toBe(SRC.trim());
  });

  it("round-trips deeper nesting via the edge tree", () => {
    const deep = `# Root\n## A\n### A1\n#### A1a\n## B`;
    const out = serializeMindmapFromCanvas(parseMindmapToCanvas(deep));
    expect(out.trim()).toBe(deep.trim());
  });

  it("serializes empty model to empty string", () => {
    expect(serializeMindmapFromCanvas({ nodes: [], edges: [] })).toBe("");
  });
});
