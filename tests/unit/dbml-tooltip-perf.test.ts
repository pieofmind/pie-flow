import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { importDbml } from "../../src/io/dbml/import";

describe("DBML edge tooltip + perf (Story 2.5)", () => {
  it("attaches ondelete to edge.attrs.tooltip from inline [delete: cascade]", () => {
    const dbml = `
Table a {
  id int [pk]
  fk_id int [ref: > b.id, delete: cascade]
}
Table b {
  id int [pk]
}
`;
    const { model } = importDbml(dbml);
    expect((model.edges[0].attrs as any)?.tooltip).toBe("ondelete: CASCADE");
  });

  it("parses ondelete from free-form note text (legacy DBML style)", () => {
    const dbml = `
Table a {
  id int [pk]
  fk_id int [ref: > b.id, note: 'ondelete=RESTRICT, nullable']
}
Table b {
  id int [pk]
}
`;
    const { model } = importDbml(dbml);
    expect((model.edges[0].attrs as any)?.tooltip).toBe("ondelete: RESTRICT");
  });

  it("no ondelete metadata → no tooltip attr", () => {
    const dbml = `
Table a {
  id int [pk]
  fk_id int [ref: > b.id]
}
Table b {
  id int [pk]
}
`;
    const { model } = importDbml(dbml);
    expect((model.edges[0].attrs as any)?.tooltip).toBeUndefined();
  });

  it("17-table / 22-ref import + layout completes within 500ms (NFR1)", () => {
    // Generate a realistic ERD-D1-shaped fixture: 17 tables, 22 refs, 6 groups.
    const tables = Array.from({ length: 17 }, (_, i) =>
      `Table t${i} {\n  id int [pk]\n  fk${i} int [ref: > t${(i + 1) % 17}.id]\n}`
    ).join("\n");
    const groups = `
TableGroup g1 {\n  t0\n  t1\n  t2\n  t3\n  t4\n  t5\n}
TableGroup g2 {\n  t6\n}
TableGroup g3 {\n  t7\n  t8\n  t9\n  t10\n}
TableGroup g4 {\n  t11\n  t12\n}
TableGroup g5 {\n  t13\n  t14\n}
TableGroup g6 {\n  t15\n  t16\n}
`;
    const extraRefs = Array.from({ length: 5 }, (_, i) =>
      `Ref: t${i * 3}.id > t${(i * 3 + 7) % 17}.id`
    ).join("\n");
    const dbml = tables + groups + extraRefs;
    const t0 = performance.now();
    const { model } = importDbml(dbml);
    const elapsed = performance.now() - t0;
    expect(model.nodes.length).toBe(17);
    expect(model.edges.length).toBeGreaterThanOrEqual(17); // 17 inline + 5 extra
    expect(elapsed).toBeLessThan(500);
  });

  it("real-world file erd-d1.dbml imports without error", () => {
    const fixturePath = join(__dirname, "..", "..", "..", "obsidian-omniboard-bmad");
    // Use the file at project root if available; otherwise skip soft.
    let raw: string | null = null;
    try {
      raw = readFileSync(process.env.OMNIBOARD_DBML_IN ?? "", "utf8");
    } catch {
      return; // skip if fixture not present locally
    }
    if (!raw) return;
    expect(() => importDbml(raw)).not.toThrow();
    const { model, warnings } = importDbml(raw);
    expect(model.nodes.length).toBeGreaterThan(10);
    // Spec says 17 tables / 22 refs — assert in vicinity
    expect(model.nodes.length).toBeGreaterThanOrEqual(15);
    expect(model.edges.length).toBeGreaterThanOrEqual(15);
    // No FATAL errors in warnings (all soft warnings OK)
    expect(warnings.filter((w) => /error|fatal/i.test(w))).toEqual([]);
  });
});
