import { describe, it, expect } from "vitest";
import { importDbml } from "../../src/io/dbml/import";

const T = (name: string, cols = "id int [pk]") => `Table ${name} {\n  ${cols}\n}`;

describe("DBML edge wiring per-column + orth router (Story 2.3)", () => {
  it("Ref a.x > b.id wires col:x-right → col:id-left, router=orth", () => {
    const dbml = `
${T("a", "id int [pk]\n  product_id int")}
${T("b")}
Ref: a.product_id > b.id
`;
    const { model } = importDbml(dbml);
    expect(model.edges.length).toBe(1);
    const e = model.edges[0];
    expect(e.source).toBe("a");
    expect(e.sourcePort).toBe("col:product_id-right");
    expect(e.target).toBe("b");
    expect(e.targetPort).toBe("col:id-left");
    expect(e.router).toBe("orth");
  });

  it("inline ref column-level: targetPort defaults to col:id-left", () => {
    const dbml = `
${T("a", "id int [pk]\n  fk_id int [ref: > b.id]")}
${T("b")}
`;
    const { model } = importDbml(dbml);
    expect(model.edges.length).toBe(1);
    expect(model.edges[0].sourcePort).toBe("col:fk_id-right");
    expect(model.edges[0].targetPort).toBe("col:id-left");
  });

  it("ghost target table: edge skipped + warning emitted (no throw)", () => {
    const dbml = `${T("a", "id int [pk]\n  x int")}\nRef: a.x > ghost.id\n`;
    const { model, warnings } = importDbml(dbml);
    expect(model.edges.length).toBe(0);
    expect(warnings.some((w) => /Ref skipped.*ghost/.test(w))).toBe(true);
  });

  it("multiple refs from same table create distinct edges (no dedup)", () => {
    const dbml = `
${T("order", "id int [pk]\n  customer_id int\n  product_id int")}
${T("customer")}
${T("product")}
Ref: order.customer_id > customer.id
Ref: order.product_id > product.id
`;
    const { model } = importDbml(dbml);
    expect(model.edges.length).toBe(2);
    const customerEdge = model.edges.find((e) => e.target === "customer")!;
    const productEdge = model.edges.find((e) => e.target === "product")!;
    expect(customerEdge.sourcePort).toBe("col:customer_id-right");
    expect(productEdge.sourcePort).toBe("col:product_id-right");
  });

  it("preserves DBML `kind` (>/</<>) on edge.label for cardinality mapping (Story 2.4)", () => {
    const dbml = `
${T("a", "id int [pk]\n  x int")}
${T("b")}
Ref: a.x > b.id
Ref: a.x < b.id
Ref: a.x <> b.id
`;
    const { model } = importDbml(dbml);
    const labels = model.edges.map((e) => e.label);
    expect(labels).toContain(">");
    expect(labels).toContain("<");
    expect(labels).toContain("<>");
  });
});
