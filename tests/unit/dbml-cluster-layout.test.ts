import { describe, it, expect } from "vitest";
import { importDbml } from "../../src/io/dbml/import";

const T = (name: string) => `Table ${name} {\n  id int [pk]\n}`;

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("DBML import — cluster layout (Story 1.2)", () => {
  it("nodes in same TableGroup cluster closer than cross-group", () => {
    const dbml = `
${T("a1")} ${T("a2")} ${T("a3")}
${T("b1")} ${T("b2")} ${T("b3")}
TableGroup A {
  a1
  a2
  a3
}
TableGroup B {
  b1
  b2
  b3
}
`;
    const { model } = importDbml(dbml);
    const pos = Object.fromEntries(model.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    // average distance within group A
    const inA = (distance(pos.a1, pos.a2) + distance(pos.a2, pos.a3) + distance(pos.a1, pos.a3)) / 3;
    // average distance across groups
    const cross =
      (distance(pos.a1, pos.b1) + distance(pos.a2, pos.b2) + distance(pos.a3, pos.b3)) / 3;
    expect(inA).toBeLessThan(cross);
  });

  it("layout completes for 17-table input within 300ms (NFR1 sub-budget)", () => {
    const tables = Array.from({ length: 17 }, (_, i) => T(`t${i}`)).join("\n");
    const groups = `
TableGroup g1 {\n  t0\n  t1\n  t2\n  t3\n  t4\n  t5\n}
TableGroup g2 {\n  t6\n}
TableGroup g3 {\n  t7\n  t8\n  t9\n  t10\n}
TableGroup g4 {\n  t11\n  t12\n}
TableGroup g5 {\n  t13\n  t14\n}
TableGroup g6 {\n  t15\n  t16\n}
`;
    const refs = Array.from({ length: 22 }, (_, i) =>
      `Ref: t${i % 17}.id > t${(i + 3) % 17}.id`
    ).join("\n");
    const dbml = tables + groups + refs;
    const t0 = performance.now();
    const { model } = importDbml(dbml);
    const elapsed = performance.now() - t0;
    expect(model.nodes.length).toBe(17);
    expect(elapsed).toBeLessThan(300);
  });

  it("all nodes have unique positions (no overlap stack)", () => {
    const dbml = `
${T("a")} ${T("b")} ${T("c")}
TableGroup g1 {
  a
  b
  c
}
`;
    const { model } = importDbml(dbml);
    const positions = model.nodes.map((n) => `${n.x},${n.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("legacy mode (no TableGroup): layout still works", () => {
    const dbml = `${T("a")}\n${T("b")}\nRef: a.id > b.id`;
    const { model } = importDbml(dbml);
    expect(model.nodes.length).toBe(2);
    expect(model.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });
});
