import type { CanvasModel } from "../../canvas/types";

/**
 * Parse a markdown-heading mindmap source into a CanvasModel of mm-* nodes.
 *
 *   # Central      → mm-root
 *   ## Branch      → mm-branch
 *   ### Leaf …     → mm-leaf (level ≥ 3)
 *
 * Layout is a left-to-right tree: x by depth, y by an in-order leaf sweep so
 * siblings stack and parents centre on their children. Pure, never throws.
 */
interface RawNode {
  id: string;
  level: number;
  label: string;
  parent: string | null;
  children: string[];
  y: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const COL_W = 240;
const ROW_H = 64;

export function parseMindmapToCanvas(source: string): CanvasModel {
  const lines = source.split(/\r?\n/);
  const nodes: RawNode[] = [];
  // Stack of last-seen node id at each level (1-based index).
  const lastAtLevel: (string | null)[] = [];
  let counter = 0;

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (!m) continue;
    const level = m[1].length;
    const label = m[2];
    const id = `mm${counter++}`;
    // Parent = nearest shallower heading already seen.
    let parent: string | null = null;
    for (let l = level - 1; l >= 1; l--) {
      if (lastAtLevel[l]) {
        parent = lastAtLevel[l]!;
        break;
      }
    }
    nodes.push({ id, level, label, parent, children: [], y: 0 });
    lastAtLevel[level] = id;
    // Invalidate deeper levels (a new sibling resets descendants).
    for (let l = level + 1; l < lastAtLevel.length; l++) lastAtLevel[l] = null;
  }

  if (!nodes.length) return { nodes: [], edges: [] };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n.parent && byId.has(n.parent)) byId.get(n.parent)!.children.push(n.id);
  }

  // In-order leaf sweep to assign vertical slots.
  let slot = 0;
  const assignY = (id: string): number => {
    const n = byId.get(id)!;
    if (n.children.length === 0) {
      n.y = slot++ * ROW_H;
      return n.y;
    }
    const ys = n.children.map(assignY);
    n.y = (ys[0] + ys[ys.length - 1]) / 2;
    return n.y;
  };
  // Roots = nodes without a (resolvable) parent.
  const roots = nodes.filter((n) => !n.parent || !byId.has(n.parent));
  for (const r of roots) assignY(r.id);

  const kindFor = (level: number): string =>
    level <= 1 ? "mm-root" : level === 2 ? "mm-branch" : "mm-leaf";
  const sizeFor = (level: number): { w: number; h: number } =>
    level <= 1
      ? { w: 170, h: 48 }
      : level === 2
        ? { w: 150, h: 42 }
        : { w: 130, h: 38 };

  const model: CanvasModel = { nodes: [], edges: [] };
  for (const n of nodes) {
    const { w, h } = sizeFor(n.level);
    model.nodes.push({
      id: n.id,
      shape: kindFor(n.level),
      x: (n.level - 1) * COL_W,
      y: Math.round(n.y),
      width: w,
      height: h,
      label: n.label,
    });
    if (n.parent && byId.has(n.parent)) {
      model.edges.push({ id: `${n.parent}->${n.id}`, source: n.parent, target: n.id });
    }
  }
  return model;
}

/**
 * Serialize a mindmap CanvasModel (mm-* nodes + parent→child edges) back to a
 * heading tree. Heading depth follows the EDGE tree (root = `#`, child = `##`,
 * …), so nesting deeper than 3 round-trips faithfully even though the visual
 * kind caps at mm-leaf. Children are ordered top-to-bottom by `y`.
 */
export function serializeMindmapFromCanvas(model: CanvasModel): string {
  if (!model.nodes.length) return "";
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of model.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    if (!children.has(e.source)) children.set(e.source, []);
    children.get(e.source)!.push(e.target);
    hasParent.add(e.target);
  }
  const sortByY = (ids: string[]): string[] =>
    [...ids].sort((a, b) => (byId.get(a)!.y ?? 0) - (byId.get(b)!.y ?? 0));

  const lines: string[] = [];
  const visited = new Set<string>();
  const emit = (id: string, depth: number): void => {
    if (visited.has(id)) return; // guard against accidental cycles
    visited.add(id);
    const n = byId.get(id)!;
    lines.push(`${"#".repeat(Math.min(depth, 6))} ${n.label ?? ""}`.trimEnd());
    for (const c of sortByY(children.get(id) ?? [])) emit(c, depth + 1);
  };

  // Roots = nodes with no incoming edge, ordered by y.
  const roots = sortByY(model.nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id));
  for (const r of roots) emit(r, 1);
  // Any node not reached (disconnected cycle) — emit flat.
  for (const n of model.nodes) if (!visited.has(n.id)) emit(n.id, 1);
  return lines.join("\n");
}
