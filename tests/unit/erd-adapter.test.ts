import { describe, it, expect } from "vitest";
import { erdAdapter } from "../../src/adapters/erd/index";

const SAMPLE = erdAdapter.emptyTemplate();
const TITLED = `// @diagram-title: My ERD
// @diagram-version: 1
Table users {
  id int [pk]
}`;

describe("erd adapter — metadata", () => {
  it("id + codeBlockLanguage", () => {
    expect(erdAdapter.id).toBe("erd");
    expect(erdAdapter.codeBlockLanguage).toBe("erd");
  });
});

describe("erd adapter — paletteItems", () => {
  it("≥ 4 items + unique ids", () => {
    expect(erdAdapter.paletteItems!.length).toBeGreaterThanOrEqual(4);
    const ids = erdAdapter.paletteItems!.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("covers BẢNG, CỘT, QUAN HỆ", () => {
    const groups = new Set(erdAdapter.paletteItems!.map((i) => i.group));
    expect(groups.has("BẢNG")).toBe(true);
    expect(groups.has("CỘT")).toBe(true);
    expect(groups.has("QUAN HỆ")).toBe(true);
  });
});

describe("erd adapter — validateSource", () => {
  it("valid template returns []", () => {
    expect(erdAdapter.validateSource!(SAMPLE)).toEqual([]);
  });
  it("empty flagged", () => {
    expect(erdAdapter.validateSource!("")[0].message).toBe("Source rỗng");
  });
  it("missing Table flagged", () => {
    expect(erdAdapter.validateSource!("// @diagram-version: 1\n")[0].message).toMatch(/Table/);
  });
  it("oversize flagged", () => {
    expect(erdAdapter.validateSource!("x".repeat(5_000_000))[0].message).toMatch(/quá lớn/);
  });
  it("never throws", () => {
    expect(() => erdAdapter.validateSource!("garbage")).not.toThrow();
  });
});

describe("erd adapter — getTitle / setTitle", () => {
  it("getTitle undefined when no comment", () => {
    expect(erdAdapter.getTitle!(SAMPLE)).toBeUndefined();
  });
  it("getTitle extracts from comment", () => {
    expect(erdAdapter.getTitle!(TITLED)).toBe("My ERD");
  });
  it("setTitle inserts comment at top", () => {
    const next = erdAdapter.setTitle!(SAMPLE, "New Title");
    expect(next.startsWith("// @diagram-title: New Title")).toBe(true);
    expect(erdAdapter.getTitle!(next)).toBe("New Title");
  });
  it("setTitle replaces existing", () => {
    const next = erdAdapter.setTitle!(TITLED, "Khác");
    expect(erdAdapter.getTitle!(next)).toBe("Khác");
  });
  it("setTitle empty removes comment", () => {
    const next = erdAdapter.setTitle!(TITLED, "");
    expect(erdAdapter.getTitle!(next)).toBeUndefined();
  });
  it("round-trip with special chars", () => {
    const t = `A & "B" — đặc biệt`;
    const next = erdAdapter.setTitle!(SAMPLE, t);
    expect(erdAdapter.getTitle!(next)).toBe(t);
  });
  it("round-trip title containing $ patterns", () => {
    for (const t of ["Price $5", "a$1b", "see $& here", "cost$$5"]) {
      expect(erdAdapter.getTitle!(erdAdapter.setTitle!(SAMPLE, t))).toBe(t);
      expect(erdAdapter.getTitle!(erdAdapter.setTitle!(TITLED, t))).toBe(t);
    }
  });
});
