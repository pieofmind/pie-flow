import dagre from "@dagrejs/dagre";
import type { CanvasModel } from "../../canvas/types";

/**
 * In-place dagre (Sugiyama) layout for a CanvasModel — shared by the text
 * adapters whose source has no explicit coordinates (state, sequence, uml).
 * Mutates each node's x/y to a non-overlapping arrangement.
 */
/**
 * True when 2+ nodes share the same position — i.e. the source had no layout
 * info (e.g. a BPMN XML with no BPMNDI), so everything stacks at one point.
 */
export function hasDegenerateLayout(model: CanvasModel): boolean {
  if (model.nodes.length < 2) return false;
  const seen = new Set<string>();
  for (const n of model.nodes) {
    const key = `${Math.round(n.x)},${Math.round(n.y)}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function layoutWithDagre(
  model: CanvasModel,
  dir: "LR" | "TB" = "TB",
): void {
  if (!model.nodes.length) return;
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: dir, nodesep: 48, ranksep: 72, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of model.nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of model.edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  for (const n of model.nodes) {
    const p = g.node(n.id);
    if (p) {
      n.x = Math.round(p.x - n.width / 2);
      n.y = Math.round(p.y - n.height / 2);
    }
  }
}
