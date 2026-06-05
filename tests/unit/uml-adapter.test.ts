import { describe, it, expect } from "vitest";
import { umlAdapter } from "../../src/adapters/uml/index";

const SAMPLE = umlAdapter.emptyTemplate();
const TITLED = `@startuml
title My Diagram
class A {}
@enduml`;

describe("uml adapter — metadata + palette", () => {
  it("id + codeBlockLanguage", () => {
    expect(umlAdapter.id).toBe("uml");
    expect(umlAdapter.codeBlockLanguage).toBe("uml");
  });
  it("≥ 4 palette items, unique ids", () => {
    expect(umlAdapter.paletteItems!.length).toBeGreaterThanOrEqual(4);
    const ids = umlAdapter.paletteItems!.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("covers PHẦN TỬ, QUAN HỆ groups", () => {
    const groups = new Set(umlAdapter.paletteItems!.map((i) => i.group));
    expect(groups.has("PHẦN TỬ")).toBe(true);
    expect(groups.has("QUAN HỆ")).toBe(true);
  });
});

describe("uml adapter — validateSource", () => {
  it("valid template", () => {
    expect(umlAdapter.validateSource!(SAMPLE)).toEqual([]);
  });
  it("empty flagged", () => {
    expect(umlAdapter.validateSource!("")[0].message).toBe("Source rỗng");
  });
  it("missing @startuml flagged", () => {
    expect(umlAdapter.validateSource!("class A {}")[0].message).toMatch(/@startuml/);
  });
  it("missing @enduml flagged", () => {
    expect(umlAdapter.validateSource!("@startuml\nclass A {}\n")[0].message).toMatch(/@enduml/);
  });
  it("oversize flagged", () => {
    expect(umlAdapter.validateSource!("x".repeat(5_000_000))[0].message).toMatch(/quá lớn/);
  });
  it("never throws", () => {
    expect(() => umlAdapter.validateSource!("<<<")).not.toThrow();
  });
});

describe("uml adapter — getTitle / setTitle", () => {
  it("getTitle undefined when no title line", () => {
    expect(umlAdapter.getTitle!(SAMPLE)).toBeUndefined();
  });
  it("getTitle extracts", () => {
    expect(umlAdapter.getTitle!(TITLED)).toBe("My Diagram");
  });
  it("setTitle inserts after @startuml", () => {
    const next = umlAdapter.setTitle!(SAMPLE, "Hi");
    expect(umlAdapter.getTitle!(next)).toBe("Hi");
  });
  it("setTitle replaces", () => {
    const next = umlAdapter.setTitle!(TITLED, "X");
    expect(umlAdapter.getTitle!(next)).toBe("X");
  });
  it("setTitle empty removes", () => {
    const next = umlAdapter.setTitle!(TITLED, "");
    expect(umlAdapter.getTitle!(next)).toBeUndefined();
  });
  it("setTitle round-trip special", () => {
    const t = `A & "B" — đặc biệt`;
    const next = umlAdapter.setTitle!(SAMPLE, t);
    expect(umlAdapter.getTitle!(next)).toBe(t);
  });
  it("round-trip title containing $ patterns", () => {
    for (const t of ["Price $5", "a$1b", "see $& here", "cost$$5"]) {
      expect(umlAdapter.getTitle!(umlAdapter.setTitle!(SAMPLE, t))).toBe(t);
      expect(umlAdapter.getTitle!(umlAdapter.setTitle!(TITLED, t))).toBe(t);
    }
  });
});
