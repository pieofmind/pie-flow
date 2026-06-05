import { describe, it, expect } from "vitest";
import { exportDbml } from "../../src/io/dbml/export";
import { importDbml } from "../../src/io/dbml/import";
import type { CanvasModel } from "../../src/canvas/types";

function table(id: string, label: string, cols: Array<{ k: string; name: string; type: string }>) {
  return {
    id, shape: "erd-entity" as const, x: 0, y: 0, w: 220, h: 100, label,
    attrs: { cols },
  };
}

describe("DBML export — cardinality from markers", () => {
  it("crow→bar exports as '>'", () => {
    const m: CanvasModel = {
      version: 1,
      nodes: [table("a", "users", [{ k: "PK", name: "id", type: "int" }]),
              table("b", "orders", [{ k: "FK", name: "user_id", type: "int" }])],
      edges: [{ id: "e1", source: "b", target: "a",
        sourcePort: "col:user_id-right", targetPort: "col:id-left",
        style: { start: "crow", end: "bar" } }],
    };
    const out = exportDbml(m);
    expect(out).toMatch(/Ref:\s+orders\.user_id\s+>\s+users\.id/);
  });

  it("bar→crow exports as '<'", () => {
    const m: CanvasModel = {
      version: 1,
      nodes: [table("a", "u", [{ k: "PK", name: "id", type: "int" }]),
              table("b", "o", [{ k: "FK", name: "uid", type: "int" }])],
      edges: [{ id: "e1", source: "a", target: "b",
        sourcePort: "col:id-right", targetPort: "col:uid-left",
        style: { start: "bar", end: "crow" } }],
    };
    expect(exportDbml(m)).toMatch(/Ref:\s+u\.id\s+<\s+o\.uid/);
  });

  it("crow→crow exports as '<>'", () => {
    const m: CanvasModel = {
      version: 1,
      nodes: [table("a", "u", [{ k: "PK", name: "id", type: "int" }]),
              table("b", "t", [{ k: "PK", name: "id", type: "int" }])],
      edges: [{ id: "e1", source: "a", target: "b",
        sourcePort: "col:id-right", targetPort: "col:id-left",
        style: { start: "crow", end: "crow" } }],
    };
    expect(exportDbml(m)).toMatch(/Ref:\s+u\.id\s+<>\s+t\.id/);
  });

  it("bar→bar exports as '-'", () => {
    const m: CanvasModel = {
      version: 1,
      nodes: [table("a", "u", [{ k: "PK", name: "id", type: "int" }]),
              table("b", "p", [{ k: "PK", name: "id", type: "int" }])],
      edges: [{ id: "e1", source: "a", target: "b",
        sourcePort: "col:id-right", targetPort: "col:id-left",
        style: { start: "bar", end: "bar" } }],
    };
    expect(exportDbml(m)).toMatch(/Ref:\s+u\.id\s+-\s+p\.id/);
  });

  it("nullable variants (circle-bar/crow-circle) collapse to base operator", () => {
    const m: CanvasModel = {
      version: 1,
      nodes: [table("a", "u", [{ k: "PK", name: "id", type: "int" }]),
              table("b", "o", [{ k: "FK", name: "uid", type: "int" }])],
      edges: [{ id: "e1", source: "b", target: "a",
        sourcePort: "col:uid-right", targetPort: "col:id-left",
        style: { start: "crow-circle", end: "bar" } }],
    };
    expect(exportDbml(m)).toMatch(/Ref:\s+o\.uid\s+>\s+u\.id/);
  });
});

describe("DBML export — FK column from ports", () => {
  it("col:NAME-right/left preserved", () => {
    const m: CanvasModel = {
      version: 1,
      nodes: [table("a", "users", [{ k: "PK", name: "id", type: "int" }]),
              table("b", "orders", [{ k: "FK", name: "customer_id", type: "int" }])],
      edges: [{ id: "e1", source: "b", target: "a",
        sourcePort: "col:customer_id-right", targetPort: "col:id-left",
        style: { start: "crow", end: "bar" } }],
    };
    expect(exportDbml(m)).toMatch(/orders\.customer_id\s+>\s+users\.id/);
  });

  it("cardinal port (top/bottom/left/right) falls back to 'id'", () => {
    const m: CanvasModel = {
      version: 1,
      nodes: [table("a", "users", [{ k: "PK", name: "id", type: "int" }]),
              table("b", "orders", [{ k: "PK", name: "id", type: "int" }])],
      edges: [{ id: "e1", source: "b", target: "a",
        sourcePort: "right", targetPort: "left",
        style: { start: "crow", end: "bar" } }],
    };
    expect(exportDbml(m)).toMatch(/orders\.id\s+>\s+users\.id/);
  });
});

describe("DBML export — source-meta path emits new edges", () => {
  it("edge added on canvas after import is included in output", () => {
    const dbml = `Table users {\n  id int [pk]\n}\n\nTable orders {\n  id int [pk]\n  user_id int\n}\n`;
    const { model, sourceMeta } = importDbml(dbml);
    // Simulate adding an edge on canvas.
    const usersNode = model.nodes.find((n) => n.label === "users")!;
    const ordersNode = model.nodes.find((n) => n.label === "orders")!;
    model.edges.push({
      id: "new-edge", source: ordersNode.id, target: usersNode.id,
      sourcePort: "col:user_id-right", targetPort: "col:id-left",
      style: { start: "crow", end: "bar" },
    });
    const out = exportDbml(model, sourceMeta);
    expect(out).toMatch(/Ref:\s+orders\.user_id\s+>\s+users\.id/);
  });

  it("edge already in source is NOT re-emitted", () => {
    const dbml = `Table users {\n  id int [pk]\n}\n\nTable orders {\n  id int [pk]\n  user_id int [ref: > users.id]\n}\n`;
    const { model, sourceMeta } = importDbml(dbml);
    const out = exportDbml(model, sourceMeta);
    const count = (out.match(/Ref:\s+orders\.user_id\s+>\s+users\.id/g) || []).length;
    expect(count).toBe(0); // already inline in source, not duplicated as top-level Ref
  });
});
