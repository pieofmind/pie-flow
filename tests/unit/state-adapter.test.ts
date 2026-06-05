import { describe, it, expect } from "vitest";
import { stateAdapter } from "../../src/adapters/state/index";

const SAMPLE = stateAdapter.emptyTemplate();
const TITLED = `stateDiagram-v2
title Quy trình
  [*] --> A
  A --> [*]`;
const FRONTMATTER_TITLE = `---
title: From frontmatter
---
stateDiagram-v2
  [*] --> A`;

describe("state adapter — metadata + palette", () => {
  it("id + codeBlockLanguage", () => {
    expect(stateAdapter.id).toBe("state");
    expect(stateAdapter.codeBlockLanguage).toBe("state");
  });
  it("≥ 3 palette items + unique", () => {
    expect(stateAdapter.paletteItems!.length).toBeGreaterThanOrEqual(3);
    const ids = stateAdapter.paletteItems!.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("covers TRẠNG THÁI, CHUYỂN groups", () => {
    const groups = new Set(stateAdapter.paletteItems!.map((i) => i.group));
    expect(groups.has("TRẠNG THÁI")).toBe(true);
    expect(groups.has("CHUYỂN")).toBe(true);
  });
});

describe("state adapter — validateSource", () => {
  it("valid template", () => {
    expect(stateAdapter.validateSource!(SAMPLE)).toEqual([]);
  });
  it("empty flagged", () => {
    expect(stateAdapter.validateSource!("")[0].message).toBe("Source rỗng");
  });
  it("missing header flagged", () => {
    expect(stateAdapter.validateSource!("foo --> bar")[0].message).toMatch(/stateDiagram/);
  });
  it("oversize flagged", () => {
    expect(stateAdapter.validateSource!("x".repeat(5_000_000))[0].message).toMatch(/quá lớn/);
  });
  it("never throws", () => {
    expect(() => stateAdapter.validateSource!("<<<")).not.toThrow();
  });
});

describe("state adapter — getTitle / setTitle", () => {
  it("getTitle undefined when no title", () => {
    expect(stateAdapter.getTitle!(SAMPLE)).toBeUndefined();
  });
  it("getTitle from Mermaid title line", () => {
    expect(stateAdapter.getTitle!(TITLED)).toBe("Quy trình");
  });
  it("getTitle from frontmatter", () => {
    expect(stateAdapter.getTitle!(FRONTMATTER_TITLE)).toBe("From frontmatter");
  });
  it("setTitle inserts after header", () => {
    const next = stateAdapter.setTitle!(SAMPLE, "Hi");
    expect(stateAdapter.getTitle!(next)).toBe("Hi");
  });
  it("setTitle replaces existing inline title", () => {
    const next = stateAdapter.setTitle!(TITLED, "Mới");
    expect(stateAdapter.getTitle!(next)).toBe("Mới");
  });
  it("setTitle empty removes inline title", () => {
    const next = stateAdapter.setTitle!(TITLED, "");
    expect(stateAdapter.getTitle!(next)).toBeUndefined();
  });
  it("setTitle('') also clears a frontmatter-only title (no ghost)", () => {
    const next = stateAdapter.setTitle!(FRONTMATTER_TITLE, "");
    expect(stateAdapter.getTitle!(next)).toBeUndefined();
  });
  it("setTitle new value supersedes frontmatter title on read", () => {
    const next = stateAdapter.setTitle!(FRONTMATTER_TITLE, "Inline Wins");
    expect(stateAdapter.getTitle!(next)).toBe("Inline Wins");
    // After clearing again, the old frontmatter title must not resurface.
    const cleared = stateAdapter.setTitle!(next, "");
    expect(stateAdapter.getTitle!(cleared)).toBeUndefined();
  });
  it("round-trip title containing $ patterns", () => {
    for (const t of ["Price $5", "a$1b", "see $& here", "cost$$5"]) {
      expect(stateAdapter.getTitle!(stateAdapter.setTitle!(SAMPLE, t))).toBe(t);
      expect(stateAdapter.getTitle!(stateAdapter.setTitle!(TITLED, t))).toBe(t);
    }
  });
});
