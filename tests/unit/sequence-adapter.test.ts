import { describe, it, expect } from "vitest";
import { sequenceAdapter } from "../../src/adapters/sequence/index";

const SAMPLE = sequenceAdapter.emptyTemplate();
const TITLED = `sequenceDiagram
title Quy trình bán hàng
  participant A as Client
  participant B as Server
  A->>B: Request`;

describe("sequence adapter — metadata", () => {
  it("declares id + codeBlockLanguage", () => {
    expect(sequenceAdapter.id).toBe("sequence");
    expect(sequenceAdapter.codeBlockLanguage).toBe("sequence");
  });
});

describe("sequence adapter — paletteItems", () => {
  it("≥ 6 items, unique ids", () => {
    expect(sequenceAdapter.paletteItems).toBeDefined();
    expect(sequenceAdapter.paletteItems!.length).toBeGreaterThanOrEqual(6);
    const ids = sequenceAdapter.paletteItems!.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("each item shape", () => {
    for (const i of sequenceAdapter.paletteItems!) {
      expect(i.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(i.label.length).toBeGreaterThan(0);
      expect(i.icon.length).toBeGreaterThan(0);
    }
  });
  it("covers PHẦN TỬ, THÔNG ĐIỆP, KHỐI groups", () => {
    const groups = new Set(sequenceAdapter.paletteItems!.map((i) => i.group));
    expect(groups.has("PHẦN TỬ")).toBe(true);
    expect(groups.has("THÔNG ĐIỆP")).toBe(true);
    expect(groups.has("KHỐI")).toBe(true);
  });
});

describe("sequence adapter — validateSource", () => {
  it("valid template returns []", () => {
    expect(sequenceAdapter.validateSource!(SAMPLE)).toEqual([]);
  });
  it("empty source flagged", () => {
    expect(sequenceAdapter.validateSource!("")[0].message).toBe("Source rỗng");
    expect(sequenceAdapter.validateSource!("   ")[0].message).toBe("Source rỗng");
  });
  it("missing header flagged", () => {
    const issues = sequenceAdapter.validateSource!("foo --> bar");
    expect(issues[0].message).toMatch(/sequenceDiagram/);
  });
  it("oversize flagged", () => {
    const huge = "x".repeat(5_000_000);
    expect(sequenceAdapter.validateSource!(huge)[0].message).toMatch(/quá lớn/);
  });
  it("never throws", () => {
    expect(() => sequenceAdapter.validateSource!("<<<")).not.toThrow();
  });
});

describe("sequence adapter — getTitle / setTitle", () => {
  it("getTitle undefined when no title line", () => {
    expect(sequenceAdapter.getTitle!(SAMPLE)).toBeUndefined();
  });
  it("getTitle extracts title", () => {
    expect(sequenceAdapter.getTitle!(TITLED)).toBe("Quy trình bán hàng");
  });
  it("setTitle inserts after header", () => {
    const next = sequenceAdapter.setTitle!(SAMPLE, "My Title");
    expect(sequenceAdapter.getTitle!(next)).toBe("My Title");
    expect(next).not.toBe(SAMPLE);
  });
  it("setTitle replaces existing title", () => {
    const next = sequenceAdapter.setTitle!(TITLED, "Khác");
    expect(sequenceAdapter.getTitle!(next)).toBe("Khác");
  });
  it("setTitle empty removes title line", () => {
    const next = sequenceAdapter.setTitle!(TITLED, "");
    expect(sequenceAdapter.getTitle!(next)).toBeUndefined();
    expect(next).toMatch(/sequenceDiagram/);
  });
  it("setTitle round-trip with special chars", () => {
    const t = `A "quoted" & special`;
    const next = sequenceAdapter.setTitle!(SAMPLE, t);
    expect(sequenceAdapter.getTitle!(next)).toBe(t);
  });
  it("setTitle no-op when no header", () => {
    const noHead = "foo bar";
    expect(sequenceAdapter.setTitle!(noHead, "X")).toBe(noHead);
  });
  it("round-trip title containing $ patterns (replace-string regression)", () => {
    for (const t of ["Price $5", "a$1b", "see $& here", "cost$$5", "x$`y", "p$'q"]) {
      const inserted = sequenceAdapter.setTitle!(SAMPLE, t);
      expect(sequenceAdapter.getTitle!(inserted)).toBe(t);
      const replaced = sequenceAdapter.setTitle!(TITLED, t);
      expect(sequenceAdapter.getTitle!(replaced)).toBe(t);
    }
  });
});
