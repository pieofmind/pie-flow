/**
 * Generate a test ERD board covering every cardinality + edge case so user
 * can export to DBML and paste into dbdiagram.io for visual verification.
 *
 * Scenarios:
 *   A. `>` (many-to-one)  — orders → customers
 *   B. `<` (one-to-many)  — companies ← employees (reversed)
 *   C. `<>` (many-to-many) — tags ↔ posts (join table)
 *   D. `-` (one-to-one)   — users ↔ profiles
 *   E. Nullable FK (crow-circle) — tasks → assignees (assignee_id NULL)
 *   F. Non-id FK column   — inventory.product_sku → products.sku
 *   G. Multiple FK in same table — order_items.order_id + product_id
 *   H. Self-reference     — employees.manager_id → employees.id
 *   I. TableGroup cluster — wraps scenario A in a "Sales" cluster
 */
import { writeFileSync } from "fs";
import { importDbml } from "../src/io/dbml/import";
import { serializeBoard } from "../src/view/boardSerde";

const dbml = `Project test_erd {
  database_type: 'omniboard-test'
  Note: 'Generated test board — covers all 4 cardinalities + nullable + non-id FK + self-ref'
}

// ── A. > (many-to-one) — inside TableGroup "Sales"
Table customers {
  id int [pk]
  email varchar [not null]
  name varchar
}

Table orders {
  id int [pk]
  customer_id int [ref: > customers.id, not null]
  total decimal
}

TableGroup Sales {
  customers
  orders
}

// ── B. < (one-to-many) reversed — companies ← employees
Table companies {
  id int [pk]
  name varchar [not null]
}

Table employees {
  id int [pk]
  company_id int [not null]
  manager_id int [null]
  name varchar
}
Ref: companies.id < employees.company_id

// ── C. <> (many-to-many) — join via post_tags
Table posts {
  id int [pk]
  title varchar
}

Table tags {
  id int [pk]
  name varchar [unique]
}
Ref: posts.id <> tags.id

// ── D. - (one-to-one)
Table users {
  id int [pk]
  email varchar [unique, not null]
}

Table profiles {
  id int [pk]
  user_id int [unique, not null]
  bio text
}
Ref: users.id - profiles.user_id

// ── E. Nullable FK (crow-circle marker)
Table assignees {
  id int [pk]
  name varchar
}

Table tasks {
  id int [pk]
  title varchar [not null]
  assignee_id int [null, ref: > assignees.id]
}

// ── F. Non-id FK — products.sku is PK (not id)
Table products {
  sku varchar [pk]
  name varchar [not null]
  price decimal
}

Table inventory {
  id int [pk]
  product_sku varchar [ref: > products.sku, not null]
  qty int
}

// ── G. Multiple FK in same table
Table order_items {
  id int [pk]
  order_id int [ref: > orders.id, not null]
  product_sku varchar [ref: > products.sku, not null]
  qty int
}

// ── H. Self-reference (employee → manager)
Ref: employees.manager_id > employees.id
`;

const { model, sourceMeta, warnings } = importDbml(dbml);

console.log(`Parsed: ${model.nodes.length} tables, ${model.edges.length} edges`);
console.log(`Warnings: ${warnings.length}`);
warnings.forEach((w) => console.log("  ⚠", w));

const out = serializeBoard(model, "", sourceMeta);

const TARGETS = [
  "/Users/linhji/dev/obsidian-omniboard-bmad/obsidian-vault-test/Omniboards/erd-test-all-scenarios.omniboard.md",
  "/Users/linhji/obsidian-vault/erd-test-all-scenarios.omniboard.md",
];
for (const t of TARGETS) {
  writeFileSync(t, out);
  console.log(`✅ Wrote ${t} (${out.length} bytes)`);
}
