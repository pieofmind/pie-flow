import type { CanvasModel } from "../../canvas/types";
import { layoutWithDagre } from "../_shared/layout";

/**
 * Mermaid `stateDiagram-v2` ⇄ CanvasModel (st-* nodes).
 *
 *   [*] --> Draft            initial  → Draft
 *   Draft --> Submitted: x   transition with label
 *   Submitted --> [*]        Submitted → final
 *
 * Layout: explicit `positions:` frontmatter when present, otherwise dagre.
 */

const TRANSITION_RE = /^\s*([A-Za-z0-9_\[\]*]+)\s*-->\s*([A-Za-z0-9_\[\]*]+)\s*(?::\s*(.+))?$/;

interface Pos {
  [name: string]: [number, number];
}

function parsePositions(source: string): Pos {
  const fm = source.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fm) return {};
  const block = fm[1];
  const m = block.match(/positions:\s*\n([\s\S]*?)(?=\n\S|$)/);
  if (!m) return {};
  const pos: Pos = {};
  for (const line of m[1].split(/\r?\n/)) {
    const pm = line.match(/^\s+([^:]+):\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/);
    if (pm) pos[pm[1].trim()] = [Number(pm[2]), Number(pm[3])];
  }
  return pos;
}

const SIZE = { w: 132, h: 52 };

export function parseStateToCanvas(source: string): CanvasModel {
  const positions = parsePositions(source);
  const model: CanvasModel = { nodes: [], edges: [] };
  const idOf = new Map<string, string>(); // state name → node id
  let initialId: string | null = null;
  let finalCounter = 0;

  const ensureState = (name: string): string => {
    if (name === "[*]") return ""; // handled by caller
    if (idOf.has(name)) return idOf.get(name)!;
    const id = `st_${idOf.size}`;
    idOf.set(name, id);
    const p = positions[name];
    model.nodes.push({
      id,
      shape: "st-state",
      x: p ? p[0] : 0,
      y: p ? p[1] : 0,
      width: SIZE.w,
      height: SIZE.h,
      label: name,
    });
    return id;
  };

  const ensureInitial = (): string => {
    if (initialId) return initialId;
    initialId = "st_initial";
    const p = positions["[*]"];
    model.nodes.push({
      id: initialId,
      shape: "st-initial",
      x: p ? p[0] : 0,
      y: p ? p[1] : 0,
      width: 28,
      height: 28,
      label: "",
    });
    return initialId;
  };
  const newFinal = (): string => {
    const id = `st_final_${finalCounter++}`;
    model.nodes.push({ id, shape: "st-final", x: 0, y: 0, width: 28, height: 28, label: "" });
    return id;
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("%%") || /^stateDiagram/.test(line) || line === "---") continue;
    const m = line.match(TRANSITION_RE);
    if (!m) continue;
    const [, from, to, label] = m;
    const src = from === "[*]" ? ensureInitial() : ensureState(from);
    const tgt = to === "[*]" ? newFinal() : ensureState(to);
    model.edges.push({
      id: `e${model.edges.length}`,
      source: src,
      target: tgt,
      ...(label ? { label: label.trim() } : {}),
    });
  }

  // Lay out only when positions were not fully supplied.
  const named = model.nodes.filter((n) => n.shape === "st-state");
  const allPositioned = named.length > 0 && named.every((n) => positions[n.label]);
  if (!allPositioned) layoutWithDagre(model, "TB");

  return model;
}

export function serializeStateFromCanvas(model: CanvasModel): string {
  const labelOf = new Map(model.nodes.map((n) => [n.id, n]));
  const nameFor = (id: string): string => {
    const n = labelOf.get(id);
    if (!n) return "[*]";
    if (n.shape === "st-initial" || n.shape === "st-final") return "[*]";
    return n.label || "Unnamed";
  };

  const lines: string[] = [];
  for (const e of model.edges) {
    const from = nameFor(e.source);
    const to = nameFor(e.target);
    lines.push(`  ${from} --> ${to}${e.label ? `: ${e.label}` : ""}`);
  }

  // Positions frontmatter (named states only) so canvas moves round-trip.
  const posLines: string[] = [];
  for (const n of model.nodes) {
    if (n.shape === "st-state") posLines.push(`  ${n.label}: [${Math.round(n.x)}, ${Math.round(n.y)}]`);
  }

  const fm = posLines.length ? `---\npositions:\n${posLines.join("\n")}\n---\n` : "";
  return `${fm}stateDiagram-v2\n${lines.join("\n")}`;
}
