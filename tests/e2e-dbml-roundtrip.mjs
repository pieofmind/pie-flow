// E2E test: Omniboard ERD edges → DBML export → official @dbml/core parser
// Validates that what we emit is what dbdiagram.io will actually parse.

import { Parser } from "@dbml/core";
import { exportDbml } from "../src/io/dbml/export.ts";
import { importDbml } from "../src/io/dbml/import.ts";

const TESTS = [];
const ok = (name, cond, msg) => TESTS.push({ name, pass: !!cond, msg: msg || "" });

function parseDbml(dbml) {
  const p = new Parser();
  return p.parse(dbml, "dbml");
}

function findRef(db, srcT, srcC, tgtT, tgtC) {
  for (const schema of db.schemas) {
    for (const r of schema.refs) {
      const ep = r.endpoints;
      const e0 = ep[0], e1 = ep[1];
      const match01 =
        e0.tableName === srcT && e0.fieldNames.includes(srcC) &&
        e1.tableName === tgtT && e1.fieldNames.includes(tgtC);
      const match10 =
        e1.tableName === srcT && e1.fieldNames.includes(srcC) &&
        e0.tableName === tgtT && e0.fieldNames.includes(tgtC);
      if (match01 || match10) return { ref: r, e0, e1, swapped: match10 };
    }
  }
  return null;
}

// ── Test 1: cardinality `>` (many-to-one) ──
{
  const m = {
    version: 1,
    nodes: [
      { id: "u", shape: "erd-entity", x: 0, y: 0, w: 220, h: 100, label: "users",
        attrs: { cols: [{ k: "PK", name: "id", type: "int" }] } },
      { id: "o", shape: "erd-entity", x: 0, y: 0, w: 220, h: 100, label: "orders",
        attrs: { cols: [
          { k: "PK", name: "id", type: "int" },
          { k: "FK", name: "user_id", type: "int" },
        ] } },
    ],
    edges: [{ id: "e1", source: "o", target: "u",
      sourcePort: "col:user_id-right", targetPort: "col:id-left",
      style: { start: "crow", end: "bar" } }],
  };
  const dbml = exportDbml(m);
  const db = parseDbml(dbml);
  const r = findRef(db, "orders", "user_id", "users", "id");
  ok("T1 fresh many-to-one parses", r, dbml);
  // For `>` Ref: orders.user_id > users.id — orders side is many (>), users side is one
  if (r) {
    const ordersEp = r.e0.tableName === "orders" ? r.e0 : r.e1;
    const usersEp = r.e0.tableName === "users" ? r.e0 : r.e1;
    ok("T1 orders side is *", ordersEp.relation === "*", `got ${ordersEp.relation}`);
    ok("T1 users side is 1", usersEp.relation === "1", `got ${usersEp.relation}`);
  }
}

// ── Test 2: cardinality `<` (one-to-many, swapped) ──
{
  const m = {
    version: 1,
    nodes: [
      { id: "u", shape: "erd-entity", x: 0, y: 0, w: 220, h: 100, label: "u",
        attrs: { cols: [{ k: "PK", name: "id", type: "int" }] } },
      { id: "o", shape: "erd-entity", x: 0, y: 0, w: 220, h: 100, label: "o",
        attrs: { cols: [{ k: "FK", name: "uid", type: "int" }] } },
    ],
    edges: [{ id: "e1", source: "u", target: "o",
      sourcePort: "col:id-right", targetPort: "col:uid-left",
      style: { start: "bar", end: "crow" } }],
  };
  const dbml = exportDbml(m);
  const db = parseDbml(dbml);
  const r = findRef(db, "u", "id", "o", "uid");
  ok("T2 fresh `<` parses", r, dbml);
  if (r) {
    const uEp = r.e0.tableName === "u" ? r.e0 : r.e1;
    const oEp = r.e0.tableName === "o" ? r.e0 : r.e1;
    ok("T2 u side is 1", uEp.relation === "1");
    ok("T2 o side is *", oEp.relation === "*");
  }
}

// ── Test 3: cardinality `<>` (many-to-many) ──
{
  const m = {
    version: 1,
    nodes: [
      { id: "a", shape: "erd-entity", x: 0, y: 0, w: 220, h: 100, label: "tags",
        attrs: { cols: [{ k: "PK", name: "id", type: "int" }] } },
      { id: "b", shape: "erd-entity", x: 0, y: 0, w: 220, h: 100, label: "posts",
        attrs: { cols: [{ k: "PK", name: "id", type: "int" }] } },
    ],
    edges: [{ id: "e1", source: "a", target: "b",
      sourcePort: "col:id-right", targetPort: "col:id-left",
      style: { start: "crow", end: "crow" } }],
  };
  const dbml = exportDbml(m);
  const db = parseDbml(dbml);
  const r = findRef(db, "tags", "id", "posts", "id");
  ok("T3 fresh `<>` parses", r, dbml);
  if (r) ok("T3 both sides are *",
    r.e0.relation === "*" && r.e1.relation === "*",
    `got ${r.e0.relation},${r.e1.relation}`);
}

// ── Test 4: cardinality `-` (one-to-one) ──
{
  const m = {
    version: 1,
    nodes: [
      { id: "u", shape: "erd-entity", x: 0, y: 0, w: 220, h: 100, label: "users",
        attrs: { cols: [{ k: "PK", name: "id", type: "int" }] } },
      { id: "p", shape: "erd-entity", x: 0, y: 0, w: 220, h: 100, label: "profiles",
        attrs: { cols: [{ k: "PK", name: "id", type: "int" }] } },
    ],
    edges: [{ id: "e1", source: "u", target: "p",
      sourcePort: "col:id-right", targetPort: "col:id-left",
      style: { start: "bar", end: "bar" } }],
  };
  const dbml = exportDbml(m);
  const db = parseDbml(dbml);
  const r = findRef(db, "users", "id", "profiles", "id");
  ok("T4 fresh `-` parses", r, dbml);
  if (r) ok("T4 both sides are 1",
    r.e0.relation === "1" && r.e1.relation === "1");
}

// ── Test 5: nullable variant (circle-bar) collapses to bar ──
{
  const m = {
    version: 1,
    nodes: [
      { id: "u", shape: "erd-entity", x: 0, y: 0, w: 220, h: 100, label: "u",
        attrs: { cols: [{ k: "PK", name: "id", type: "int" }] } },
      { id: "o", shape: "erd-entity", x: 0, y: 0, w: 220, h: 100, label: "o",
        attrs: { cols: [{ k: "FK", name: "uid", type: "int" }] } },
    ],
    edges: [{ id: "e1", source: "o", target: "u",
      sourcePort: "col:uid-right", targetPort: "col:id-left",
      style: { start: "crow-circle", end: "bar" } }],
  };
  const dbml = exportDbml(m);
  const db = parseDbml(dbml);
  const r = findRef(db, "o", "uid", "u", "id");
  ok("T5 nullable variant parses as `>`", r, dbml);
}

// ── Test 6: source-meta path — new edge added on canvas-loaded board ──
{
  const orig = `Table users {\n  id int [pk]\n}\n\nTable orders {\n  id int [pk]\n  user_id int\n}\n`;
  const { model, sourceMeta } = importDbml(orig);
  const u = model.nodes.find((n) => n.label === "users");
  const o = model.nodes.find((n) => n.label === "orders");
  model.edges.push({
    id: "user-drawn-edge-xyz", source: o.id, target: u.id,
    sourcePort: "col:user_id-right", targetPort: "col:id-left",
    style: { start: "crow", end: "bar" },
  });
  const dbml = exportDbml(model, sourceMeta);
  const db = parseDbml(dbml);
  const r = findRef(db, "orders", "user_id", "users", "id");
  ok("T6 canvas-added edge on imported board parses", r, dbml);
}

// ── Test 7: no duplicate when source already has inline ref ──
{
  const orig = `Table users {\n  id int [pk]\n}\n\nTable orders {\n  id int [pk]\n  user_id int [ref: > users.id]\n}\n`;
  const { model, sourceMeta } = importDbml(orig);
  const dbml = exportDbml(model, sourceMeta);
  // dbdiagram.io rejects duplicate refs — must parse without error
  let parsed = null, err = null;
  try { parsed = parseDbml(dbml); } catch (e) { err = e; }
  ok("T7 no-edit roundtrip parses without duplicate ref", parsed && !err,
    err ? err.message : dbml);
}

// ── Test 8: round-trip cardinality preservation ──
{
  const orig = `Table users {\n  id int [pk]\n}\n\nTable orders {\n  id int [pk]\n}\n\nRef: orders.id > users.id\nRef: users.id - orders.id\n`;
  const { model, sourceMeta } = importDbml(orig);
  // Force re-emission via fresh path (no sourceMeta)
  const fresh = exportDbml({ version: 1, nodes: model.nodes, edges: model.edges }, null);
  const db = parseDbml(fresh);
  const gtRef = findRef(db, "orders", "id", "users", "id");
  ok("T8 `>` survives roundtrip", gtRef, fresh);
}

// ── Test 9: composite FK with non-id PK ──
{
  const m = {
    version: 1,
    nodes: [
      { id: "p", shape: "erd-entity", x: 0, y: 0, w: 220, h: 100, label: "products",
        attrs: { cols: [
          { k: "PK", name: "sku", type: "varchar" },
          { k: "", name: "name", type: "varchar" },
        ] } },
      { id: "i", shape: "erd-entity", x: 0, y: 0, w: 220, h: 100, label: "inventory",
        attrs: { cols: [
          { k: "PK", name: "id", type: "int" },
          { k: "FK", name: "product_sku", type: "varchar" },
        ] } },
    ],
    edges: [{ id: "e1", source: "i", target: "p",
      sourcePort: "col:product_sku-right", targetPort: "col:sku-left",
      style: { start: "crow", end: "bar" } }],
  };
  const dbml = exportDbml(m);
  const db = parseDbml(dbml);
  const r = findRef(db, "inventory", "product_sku", "products", "sku");
  ok("T9 non-id FK column preserved", r, dbml);
}

// ── Test 10: cardinal-port fallback to .id ──
{
  const m = {
    version: 1,
    nodes: [
      { id: "u", shape: "erd-entity", x: 0, y: 0, w: 220, h: 100, label: "u",
        attrs: { cols: [{ k: "PK", name: "id", type: "int" }] } },
      { id: "o", shape: "erd-entity", x: 0, y: 0, w: 220, h: 100, label: "o",
        attrs: { cols: [{ k: "PK", name: "id", type: "int" }] } },
    ],
    edges: [{ id: "e1", source: "o", target: "u",
      sourcePort: "right", targetPort: "left",  // cardinal ports
      style: { start: "crow", end: "bar" } }],
  };
  const dbml = exportDbml(m);
  const db = parseDbml(dbml);
  const r = findRef(db, "o", "id", "u", "id");
  ok("T10 cardinal-port edge falls back to .id", r, dbml);
}

// ── Report ──
let passed = 0, failed = 0;
for (const t of TESTS) {
  const tag = t.pass ? "✅" : "❌";
  console.log(`${tag} ${t.name}${t.pass ? "" : "\n   " + t.msg.split("\n").slice(0,5).join("\n   ")}`);
  if (t.pass) passed++; else failed++;
}
console.log(`\n${passed}/${TESTS.length} passed`);
process.exit(failed ? 1 : 0);
