import { describe, it, expect } from "vitest";
import { mindmapAdapter } from "../../src/adapters/mindmap/index";

const SAMPLE = mindmapAdapter.emptyTemplate();
const NO_H1 = `## Branch A
### Leaf`;

describe("mindmap adapter — metadata + palette", () => {
  it("id + codeBlockLanguage", () => {
    expect(mindmapAdapter.id).toBe("mindmap");
    expect(mindmapAdapter.codeBlockLanguage).toBe("mindmap");
  });
  it("≥ 3 palette items + unique", () => {
    expect(mindmapAdapter.paletteItems!.length).toBeGreaterThanOrEqual(3);
    const ids = mindmapAdapter.paletteItems!.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("covers CẤU TRÚC group", () => {
    const groups = new Set(mindmapAdapter.paletteItems!.map((i) => i.group));
    expect(groups.has("CẤU TRÚC")).toBe(true);
  });
});

describe("mindmap adapter — validateSource", () => {
  it("valid template", () => {
    expect(mindmapAdapter.validateSource!(SAMPLE)).toEqual([]);
  });
  it("empty flagged", () => {
    expect(mindmapAdapter.validateSource!("")[0].message).toBe("Source rỗng");
  });
  it("missing central topic flagged", () => {
    expect(mindmapAdapter.validateSource!(NO_H1)[0].message).toMatch(/chủ đề trung tâm/);
  });
  it("oversize flagged", () => {
    expect(mindmapAdapter.validateSource!("x".repeat(5_000_000))[0].message).toMatch(/quá lớn/);
  });
  it("never throws", () => {
    expect(() => mindmapAdapter.validateSource!("<<<")).not.toThrow();
  });
});

describe("mindmap adapter — getTitle / setTitle", () => {
  it("getTitle extracts central topic", () => {
    expect(mindmapAdapter.getTitle!(SAMPLE)).toBe("Central topic");
  });
  it("getTitle undefined when no H1", () => {
    expect(mindmapAdapter.getTitle!(NO_H1)).toBeUndefined();
  });
  it("setTitle replaces H1", () => {
    const next = mindmapAdapter.setTitle!(SAMPLE, "New");
    expect(mindmapAdapter.getTitle!(next)).toBe("New");
  });
  it("setTitle inserts H1 when absent", () => {
    const next = mindmapAdapter.setTitle!(NO_H1, "Root");
    expect(next.startsWith("# Root")).toBe(true);
    expect(next).toContain("## Branch A");
  });
  it("setTitle round-trip with special chars", () => {
    const t = `A & "B" — đặc biệt`;
    const next = mindmapAdapter.setTitle!(SAMPLE, t);
    expect(mindmapAdapter.getTitle!(next)).toBe(t);
  });
  it("round-trip title containing $ patterns", () => {
    for (const t of ["Price $5", "a$1b", "see $& here", "cost$$5"]) {
      expect(mindmapAdapter.getTitle!(mindmapAdapter.setTitle!(SAMPLE, t))).toBe(t);
    }
  });
  it("setTitle empty removes H1 and does NOT promote a branch to title", () => {
    const next = mindmapAdapter.setTitle!(SAMPLE, "");
    expect(mindmapAdapter.getTitle!(next)).toBeUndefined();
    // The first branch heading must remain a branch, not become the root.
    expect(next).toContain("## Branch A");
  });
});
