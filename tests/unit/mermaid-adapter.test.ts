import { describe, it, expect } from "vitest";
import { mermaidAdapter } from "../../src/adapters/mermaid/index";

const SAMPLE = mermaidAdapter.emptyTemplate();
const WITH_FRONTMATTER = `---
title: My Flow
---
flowchart LR
  A --> B`;

describe("mermaid adapter — metadata + palette", () => {
  it("uses mermaid-dx codeBlockLanguage to coexist with built-in mermaid", () => {
    expect(mermaidAdapter.id).toBe("mermaid");
    expect(mermaidAdapter.codeBlockLanguage).toBe("mermaid-dx");
  });
  it("≥ 4 palette items + unique", () => {
    expect(mermaidAdapter.paletteItems!.length).toBeGreaterThanOrEqual(4);
    const ids = mermaidAdapter.paletteItems!.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("covers PHẦN TỬ, LIÊN KẾT groups", () => {
    const groups = new Set(mermaidAdapter.paletteItems!.map((i) => i.group));
    expect(groups.has("PHẦN TỬ")).toBe(true);
    expect(groups.has("LIÊN KẾT")).toBe(true);
  });
});

describe("mermaid adapter — validateSource", () => {
  it("valid template", () => {
    expect(mermaidAdapter.validateSource!(SAMPLE)).toEqual([]);
  });
  it("empty flagged", () => {
    expect(mermaidAdapter.validateSource!("")[0].message).toBe("Source rỗng");
  });
  it("missing header flagged", () => {
    expect(mermaidAdapter.validateSource!("A --> B")[0].message).toMatch(/Mermaid/);
  });
  it("recognises sequenceDiagram", () => {
    expect(mermaidAdapter.validateSource!("sequenceDiagram\n  A->>B: msg")).toEqual([]);
  });
  it("oversize flagged", () => {
    expect(mermaidAdapter.validateSource!("x".repeat(5_000_000))[0].message).toMatch(/quá lớn/);
  });
  it("never throws", () => {
    expect(() => mermaidAdapter.validateSource!("<<<")).not.toThrow();
  });
});

describe("mermaid adapter — getTitle / setTitle", () => {
  it("getTitle undefined when no frontmatter", () => {
    expect(mermaidAdapter.getTitle!(SAMPLE)).toBeUndefined();
  });
  it("getTitle from frontmatter", () => {
    expect(mermaidAdapter.getTitle!(WITH_FRONTMATTER)).toBe("My Flow");
  });
  it("setTitle inserts frontmatter when absent", () => {
    const next = mermaidAdapter.setTitle!(SAMPLE, "Hi");
    expect(next.startsWith("---")).toBe(true);
    expect(mermaidAdapter.getTitle!(next)).toBe("Hi");
  });
  it("setTitle replaces existing", () => {
    const next = mermaidAdapter.setTitle!(WITH_FRONTMATTER, "X");
    expect(mermaidAdapter.getTitle!(next)).toBe("X");
  });
  it("setTitle empty + frontmatter removes title only", () => {
    const next = mermaidAdapter.setTitle!(WITH_FRONTMATTER, "");
    expect(mermaidAdapter.getTitle!(next)).toBeUndefined();
    expect(next).toContain("flowchart LR");
  });
  it("setTitle round-trip simple ASCII", () => {
    const next = mermaidAdapter.setTitle!(SAMPLE, "Simple");
    expect(mermaidAdapter.getTitle!(next)).toBe("Simple");
  });
  it("round-trip title containing $ patterns", () => {
    for (const t of ["Price 5", "a1b", "plain text"]) {
      expect(mermaidAdapter.getTitle!(mermaidAdapter.setTitle!(SAMPLE, t))).toBe(t);
      expect(mermaidAdapter.getTitle!(mermaidAdapter.setTitle!(WITH_FRONTMATTER, t))).toBe(t);
    }
  });
  it("setTitle('') on frontmatter-only title leaves clean body (no leading blank line)", () => {
    const next = mermaidAdapter.setTitle!(WITH_FRONTMATTER, "");
    expect(mermaidAdapter.getTitle!(next)).toBeUndefined();
    expect(next.startsWith("flowchart")).toBe(true);
  });
});
