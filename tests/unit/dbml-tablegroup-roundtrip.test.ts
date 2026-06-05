import { describe, it, expect } from "vitest";
import { importDbml } from "../../src/io/dbml/import";
import { exportDbml } from "../../src/io/dbml/export";

const T = (name: string) => `Table ${name} {\n  id int [pk]\n}`;

describe("DBML round-trip — TableGroup preservation (Story 1.3)", () => {
  it("import → export → import yields same TableGroup mapping", () => {
    const dbml = `
${T("a")}
${T("b")}
${T("c")}
TableGroup g1 {
  a
  b
}
TableGroup g2 {
  c
}
`;
    const r1 = importDbml(dbml);
    const exported = exportDbml(r1.model, r1.sourceMeta);
    const r2 = importDbml(exported);
    const groupOf = (model: typeof r1.model, id: string) =>
      (model.nodes.find((n) => n.id === id)?.attrs as any)?.__group;
    expect(groupOf(r2.model, "a")).toBe("g1");
    expect(groupOf(r2.model, "b")).toBe("g1");
    expect(groupOf(r2.model, "c")).toBe("g2");
  });

  it("new table added on canvas is OUTSIDE original TableGroup blocks", () => {
    const dbml = `
${T("a")}
TableGroup g1 {
  a
}
`;
    const r1 = importDbml(dbml);
    // simulate adding a new table on canvas
    r1.model.nodes.push({
      id: "newbie",
      shape: "erd-entity",
      x: 0, y: 0, width: 220, height: 60,
      label: "newbie",
      attrs: { cols: [{ k: "PK", name: "id", type: "int" }] },
    });
    const exported = exportDbml(r1.model, r1.sourceMeta);
    // original TableGroup block must still appear verbatim
    expect(exported).toContain("TableGroup g1 {");
    // new table must be appended after the "Added on canvas" marker
    const idx = exported.indexOf("// ── Added on canvas");
    expect(idx).toBeGreaterThan(-1);
    expect(exported.indexOf("Table newbie", idx)).toBeGreaterThan(idx);
  });

  it("DBML without TableGroup still round-trips cleanly", () => {
    const dbml = `${T("foo")}\n${T("bar")}\nRef: foo.id > bar.id\n`;
    const r1 = importDbml(dbml);
    const exported = exportDbml(r1.model, r1.sourceMeta);
    const r2 = importDbml(exported);
    expect(r2.model.nodes.length).toBe(2);
    expect(r2.model.edges.length).toBe(1);
  });
});
