import type { CanvasModel } from "../../canvas/types";

/** A message flow joins two participants. One between two steps of the same
 *  sub-process was written by an older export (it took the steps' lanes for
 *  different pools): it is a sequence flow, so drop the message marking. */
export function fixInnerMessageFlows(model: CanvasModel): CanvasModel {
  const parentOf = new Map(model.nodes.map((n) => [n.id, n.parentId] as const));
  const shapeOf = new Map(model.nodes.map((n) => [n.id, n.shape] as const));
  const isInner = (e: CanvasModel["edges"][number]): boolean => {
    const p = parentOf.get(e.source);
    return !!p && p === parentOf.get(e.target) && shapeOf.get(p) !== "bpmn-pool";
  };
  if (!model.edges.some((e) => e.kind === "message" && isInner(e))) return model;
  return {
    ...model,
    edges: model.edges.map((e) => {
      if (e.kind !== "message" || !isInner(e)) return e;
      const { kind: _kind, style, ...rest } = e as typeof e & { style?: Record<string, unknown> };
      const keep = style && style.flowType !== "message" ? { style } : {};
      return { ...rest, ...keep } as typeof e;
    }),
  };
}
