import type { CanvasModel } from "../../canvas/types";
import { layoutWithDagre } from "../_shared/layout";

/**
 * PlantUML class diagram ⇄ CanvasModel (uml-class / uml-interface nodes).
 *
 *   class Customer {
 *     +id: int            → field
 *     +placeOrder(): Order → method (has parentheses)
 *   }
 *   Customer <|-- Vip      → inheritance edge (relation token preserved)
 *   ' @pos Customer: 100,50  → optional explicit position
 *
 * Members live on node.attrs.fields / node.attrs.methods; relation tokens on
 * edge.attrs.umlRel so the exact PlantUML arrow round-trips.
 */

const CLASS_OPEN_RE = /^(class|interface)\s+(\w+)\s*\{?\s*$/;
const POS_RE = /^'\s*@pos\s+(\w+)\s*:\s*(-?\d+)\s*,\s*(-?\d+)/;
const REL_RE = /^(\w+)\s*(<\|--|--\|>|\.\.>|<\.\.|o--|\*--|-->|<--|--|\.\.)\s*(\w+)\s*(?::\s*(.+))?$/;

const W = 200;
// Height estimate for the STATIC card preview (the live canvas auto-grows to
// the real DOM). Header + per-block padding + per-line height, sized generously
// so content is never clipped in the thumbnail.
const HEAD = 40;
const BLOCK_PAD = 16;
const LINE = 22;

export function parseUmlToCanvas(source: string): CanvasModel {
  const positions: Record<string, [number, number]> = {};
  const classes = new Map<string, { kind: "uml-class" | "uml-interface"; fields: string[]; methods: string[] }>();
  const rels: Array<{ from: string; to: string; op: string; label?: string }> = [];

  const lines = source.split(/\r?\n/);
  let current: string | null = null;

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^@startuml/.test(line) || /^@enduml/.test(line) || /^title\b/.test(line)) continue;

    const pos = line.match(POS_RE);
    if (pos) {
      positions[pos[1]] = [Number(pos[2]), Number(pos[3])];
      continue;
    }
    if (line.startsWith("'")) continue; // other comments

    if (current) {
      if (line === "}") {
        current = null;
        continue;
      }
      const cls = classes.get(current)!;
      if (line.includes("(")) cls.methods.push(line);
      else cls.fields.push(line);
      continue;
    }

    const open = line.match(CLASS_OPEN_RE);
    if (open) {
      const [, kw, name] = open;
      if (!classes.has(name)) classes.set(name, { kind: kw === "interface" ? "uml-interface" : "uml-class", fields: [], methods: [] });
      // Only enter member mode if the line ended with `{`.
      if (line.endsWith("{")) current = name;
      continue;
    }

    const rel = line.match(REL_RE);
    if (rel) {
      const [, from, op, to, label] = rel;
      if (!classes.has(from)) classes.set(from, { kind: "uml-class", fields: [], methods: [] });
      if (!classes.has(to)) classes.set(to, { kind: "uml-class", fields: [], methods: [] });
      rels.push({ from, to, op, label });
    }
  }

  const model: CanvasModel = { nodes: [], edges: [] };
  for (const [name, c] of classes) {
    const h =
      HEAD +
      (c.fields.length ? BLOCK_PAD + c.fields.length * LINE : 0) +
      (c.methods.length ? BLOCK_PAD + c.methods.length * LINE : 0) +
      8;
    const p = positions[name];
    model.nodes.push({
      id: name,
      shape: c.kind,
      x: p ? p[0] : 0,
      y: p ? p[1] : 0,
      width: W,
      height: h,
      label: name,
      attrs: { fields: c.fields, methods: c.methods },
    });
  }
  rels.forEach((r, i) => {
    model.edges.push({
      id: `r${i}`,
      source: r.from,
      target: r.to,
      ...(r.label ? { label: r.label } : {}),
      attrs: { umlRel: r.op },
    });
  });

  const allPositioned = model.nodes.length > 0 && model.nodes.every((n) => positions[n.id]);
  if (!allPositioned) layoutWithDagre(model, "TB");

  return model;
}

export function serializeUmlFromCanvas(model: CanvasModel): string {
  const lines: string[] = ["@startuml"];
  const classNodes = model.nodes.filter(
    (n) => n.shape === "uml-class" || n.shape === "uml-interface",
  );

  for (const n of classNodes) {
    lines.push(`' @pos ${n.label}: ${Math.round(n.x)},${Math.round(n.y)}`);
  }
  for (const n of classNodes) {
    const kw = n.shape === "uml-interface" ? "interface" : "class";
    const fields = (n.attrs?.fields as string[] | undefined) ?? [];
    const methods = (n.attrs?.methods as string[] | undefined) ?? [];
    if (!fields.length && !methods.length) {
      lines.push(`${kw} ${n.label}`);
    } else {
      lines.push(`${kw} ${n.label} {`);
      for (const f of fields) lines.push(`  ${f}`);
      for (const m of methods) lines.push(`  ${m}`);
      lines.push(`}`);
    }
  }
  const byId = new Set(model.nodes.map((n) => n.id));
  for (const e of model.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    const op = (e.attrs?.umlRel as string) ?? "-->";
    lines.push(`${e.source} ${op} ${e.target}${e.label ? ` : ${e.label}` : ""}`);
  }
  lines.push("@enduml");
  return lines.join("\n");
}
