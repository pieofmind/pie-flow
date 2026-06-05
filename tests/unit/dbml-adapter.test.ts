import { describe, it, expect } from "vitest";
import { dbmlAdapter } from "../../src/adapters/dbml/index";

const SAMPLE = dbmlAdapter.emptyTemplate();
const NO_PROJECT = `Table foo {
  id int [pk]
}`;

describe("dbml adapter — metadata", () => {
  it("declares id, codeBlockLanguage", () => {
    expect(dbmlAdapter.id).toBe("dbml");
    expect(dbmlAdapter.codeBlockLanguage).toBe("dbml");
    expect(dbmlAdapter.displayName).toBe("DBML");
  });
});

describe("dbml adapter — parse/serialize identity", () => {
  it("parse identity", () => {
    expect(dbmlAdapter.parse(SAMPLE)).toBe(SAMPLE);
  });
  it("serialize identity", () => {
    expect(dbmlAdapter.serialize(SAMPLE)).toBe(SAMPLE);
  });
  it("round-trip", () => {
    expect(dbmlAdapter.serialize(dbmlAdapter.parse(SAMPLE))).toBe(SAMPLE);
  });
});

describe("dbml adapter — paletteItems", () => {
  it("≥ 5 items, unique ids", () => {
    expect(dbmlAdapter.paletteItems!.length).toBeGreaterThanOrEqual(5);
    const ids = dbmlAdapter.paletteItems!.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("covers BẢNG, QUAN HỆ, KHÁC", () => {
    const groups = new Set(dbmlAdapter.paletteItems!.map((i) => i.group));
    expect(groups.has("BẢNG")).toBe(true);
    expect(groups.has("QUAN HỆ")).toBe(true);
    expect(groups.has("KHÁC")).toBe(true);
  });
});

describe("dbml adapter — validateSource", () => {
  it("valid template returns []", () => {
    expect(dbmlAdapter.validateSource!(SAMPLE)).toEqual([]);
  });
  it("empty flagged", () => {
    expect(dbmlAdapter.validateSource!("")[0].message).toBe("Source rỗng");
  });
  it("missing Table flagged", () => {
    const issues = dbmlAdapter.validateSource!("Project x { }");
    expect(issues[0].message).toMatch(/Table/);
  });
  it("oversize flagged", () => {
    expect(dbmlAdapter.validateSource!("x".repeat(5_000_000))[0].message).toMatch(/quá lớn/);
  });
  it("never throws", () => {
    expect(() => dbmlAdapter.validateSource!("{{}}")).not.toThrow();
  });
});

describe("dbml adapter — getTitle / setTitle", () => {
  it("getTitle from template returns 'example'", () => {
    expect(dbmlAdapter.getTitle!(SAMPLE)).toBe("example");
  });
  it("getTitle undefined when no Project", () => {
    expect(dbmlAdapter.getTitle!(NO_PROJECT)).toBeUndefined();
  });
  it("setTitle inserts Project block when absent", () => {
    const next = dbmlAdapter.setTitle!(NO_PROJECT, "my_db");
    expect(dbmlAdapter.getTitle!(next)).toBe("my_db");
    expect(next).toContain("Project my_db");
    expect(next).toContain("Table foo");
  });
  it("setTitle replaces existing Project name", () => {
    const next = dbmlAdapter.setTitle!(SAMPLE, "other");
    expect(dbmlAdapter.getTitle!(next)).toBe("other");
  });
  it("setTitle empty is no-op (DBML disallows empty)", () => {
    expect(dbmlAdapter.setTitle!(SAMPLE, "")).toBe(SAMPLE);
  });
  it("setTitle with spaces wraps in quotes", () => {
    const next = dbmlAdapter.setTitle!(NO_PROJECT, "my db");
    expect(next).toContain(`Project "my db"`);
  });
  it("round-trip simple identifier", () => {
    const next = dbmlAdapter.setTitle!(NO_PROJECT, "simple_name");
    expect(dbmlAdapter.getTitle!(next)).toBe("simple_name");
  });
  it("round-trip title WITH spaces (quoted-name regression)", () => {
    const next = dbmlAdapter.setTitle!(NO_PROJECT, "my db");
    expect(dbmlAdapter.getTitle!(next)).toBe("my db");
  });
  it("setTitle twice on quoted name does not duplicate Project block", () => {
    const once = dbmlAdapter.setTitle!(NO_PROJECT, "my db");
    const twice = dbmlAdapter.setTitle!(once, "other db");
    expect(dbmlAdapter.getTitle!(twice)).toBe("other db");
    expect((twice.match(/^Project\b/gm) ?? []).length).toBe(1);
  });
  it("strips embedded double quotes from title (DBML has no escape)", () => {
    const next = dbmlAdapter.setTitle!(NO_PROJECT, `a"b`);
    // quote removed → 'ab', no spaces so unquoted
    expect(dbmlAdapter.getTitle!(next)).toBe("ab");
  });
});
