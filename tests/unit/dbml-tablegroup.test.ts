import { describe, it, expect } from "vitest";
import { importDbml } from "../../src/io/dbml/import";

const T = (name: string) => `Table ${name} {\n  id int [pk]\n}`;

describe("DBML import — TableGroup parsing (Story 1.1)", () => {
  it("assigns __group attr from TableGroup block", () => {
    const dbml = `
${T("product_template")}
${T("product_product")}
${T("res_partner")}

TableGroup product_core {
  product_template
  product_product
}
TableGroup partner {
  res_partner
}
`;
    const { model, warnings } = importDbml(dbml);
    const tmpl = model.nodes.find((n) => n.id === "product_template");
    const prod = model.nodes.find((n) => n.id === "product_product");
    const partner = model.nodes.find((n) => n.id === "res_partner");
    expect((tmpl?.attrs as any)?.__group).toBe("product_core");
    expect((prod?.attrs as any)?.__group).toBe("product_core");
    expect((partner?.attrs as any)?.__group).toBe("partner");
    expect(warnings.filter((w) => /TableGroup/i.test(w))).toEqual([]);
  });

  it("legacy DBML without TableGroup: nodes have no __group", () => {
    const dbml = `${T("foo")}\n${T("bar")}`;
    const { model, warnings } = importDbml(dbml);
    const foo = model.nodes.find((n) => n.id === "foo");
    expect((foo?.attrs as any)?.__group).toBeFalsy();
    expect(warnings.filter((w) => /TableGroup/i.test(w))).toEqual([]);
  });

  it("table in two TableGroups: first wins, warning emitted", () => {
    const dbml = `
${T("x")}
TableGroup g1 {
  x
}
TableGroup g2 {
  x
}
`;
    const { model, warnings } = importDbml(dbml);
    const x = model.nodes.find((n) => n.id === "x");
    expect((x?.attrs as any)?.__group).toBe("g1");
    expect(warnings.some((w) => /multiple TableGroups/i.test(w))).toBe(true);
  });

  it("ghost table in TableGroup: warning, no throw", () => {
    const dbml = `
${T("real")}
TableGroup g1 {
  real
  ghost
}
`;
    expect(() => importDbml(dbml)).not.toThrow();
    const { warnings } = importDbml(dbml);
    expect(warnings.some((w) => /unknown table 'ghost'/i.test(w))).toBe(true);
  });

  it("assigns __headerColor based on group index (cycles palette)", () => {
    const tables = ["a", "b", "c", "d", "e", "f", "g"].map(T).join("\n");
    const groups = `
TableGroup g1 {\n  a\n}
TableGroup g2 {\n  b\n}
TableGroup g3 {\n  c\n}
TableGroup g4 {\n  d\n}
TableGroup g5 {\n  e\n}
TableGroup g6 {\n  f\n}
TableGroup g7 {\n  g\n}
`;
    const { model } = importDbml(tables + groups);
    const colorOf = (id: string) =>
      (model.nodes.find((n) => n.id === id)?.attrs as any)?.__headerColor;
    expect(colorOf("a")).toBe("#5E8FB9");
    expect(colorOf("f")).toBe("#C76B6B");
    // 7th cluster cycles back to first color
    expect(colorOf("g")).toBe("#5E8FB9");
  });
});
