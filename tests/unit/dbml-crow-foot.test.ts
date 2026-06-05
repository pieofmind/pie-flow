import { describe, it, expect } from "vitest";
import { importDbml } from "../../src/io/dbml/import";

const T = (name: string, cols = "id int [pk]") => `Table ${name} {\n  ${cols}\n}`;

describe("DBML crow's foot cardinality markers (Story 2.4)", () => {
  it("Ref a.x > b.id (N→1): source=crow, target=bar", () => {
    const dbml = `${T("a", "id int [pk]\n  x int [not null]")}\n${T("b")}\nRef: a.x > b.id\n`;
    const { model } = importDbml(dbml);
    const e = model.edges[0];
    expect(e.style?.start).toBe("crow");
    expect(e.style?.end).toBe("bar");
  });

  it("Ref a.x < b.id (1→N): source=bar, target=crow", () => {
    const dbml = `${T("a", "id int [pk]\n  x int [not null]")}\n${T("b")}\nRef: a.x < b.id\n`;
    const { model } = importDbml(dbml);
    const e = model.edges[0];
    expect(e.style?.start).toBe("bar");
    expect(e.style?.end).toBe("crow");
  });

  it("Ref a.x <> b.id (N↔M): both ends crow", () => {
    const dbml = `${T("a", "id int [pk]\n  x int [not null]")}\n${T("b")}\nRef: a.x <> b.id\n`;
    const { model } = importDbml(dbml);
    const e = model.edges[0];
    expect(e.style?.start).toBe("crow");
    expect(e.style?.end).toBe("crow");
  });

  it("nullable inline FK: source marker becomes circle-bar (0..1) or crow-circle (0..N)", () => {
    const dbml = `
${T("a", "id int [pk]\n  fk_id int [null, ref: > b.id]")}
${T("b")}
`;
    const { model } = importDbml(dbml);
    const e = model.edges[0];
    // > is N→1 with nullable source → crow becomes crow-circle (0..N) at source
    expect(e.style?.start).toBe("crow-circle");
    expect(e.style?.end).toBe("bar");
  });

  it("PK FK (rare but possible) is treated as not-null at source", () => {
    const dbml = `
${T("a", "id int [pk, ref: > b.id]")}
${T("b")}
`;
    const { model } = importDbml(dbml);
    const e = model.edges[0];
    expect(e.style?.start).toBe("crow"); // not crow-circle, PK is not-null
  });
});
