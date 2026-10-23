import { Graph, Registry, type Node } from "@antv/x6";

/**
 * "avoid" router — orthogonal routing that goes AROUND shapes (X6 manhattan
 * with every shape as an obstacle except containers drawn behind others).
 * An arrow with hand-made bends keeps exactly those bends (plain orth through
 * them). The default for new arrows; arrows saved with router "orth" keep it.
 */
export const AVOID_ROUTER = { name: "avoid", args: { padding: 20 } };

const CONTAINER_KINDS = new Set(["bpmn-pool", "bpmn-lane", "bpmn-group", "bpmn-annotation"]);
const EXPANDABLE_KINDS = new Set(["bpmn-subprocess", "bpmn-event-subprocess", "bpmn-transaction"]);

/** Is a shape something arrows must route around? Pools / lanes / groups /
 *  annotations and expanded sub-processes contain other shapes, so arrows
 *  run inside them. */
export function isRouteObstacle(kind: string, data?: { collapsed?: boolean }): boolean {
  if (CONTAINER_KINDS.has(kind)) return false;
  if (EXPANDABLE_KINDS.has(kind) && data?.collapsed !== true) return false;
  return true;
}

type Side = "top" | "right" | "bottom" | "left";
/** Side of a fixed port id ("right", "top-1", …), to leave / enter through it. */
function portSide(port: unknown): Side | undefined {
  const m = typeof port === "string" ? /^(top|right|bottom|left)/.exec(port) : null;
  return m ? (m[1] as Side) : undefined;
}

let registered = false;
export function registerAvoidRouter(): void {
  if (registered) return;
  registered = true;
  type Def = Registry.Router.CommonDefinition;
  Graph.registerRouter("avoid", function (this: unknown, vertices, args, view) {
    const presets = Registry.Router.presets as unknown as Record<string, Def>;
    const padding = (args as { padding?: number }).padding ?? 20;
    if (vertices.length) return presets.orth.call(this as never, vertices, { padding }, view);
    const graph = view.graph;
    // Steps hidden inside a closed sub-process are not in the way either.
    const excludeNodes = graph.getNodes().filter((n: Node) => !n.isVisible() || !isRouteObstacle(String(n.getData()?.kind ?? ""), n.getData()));
    const src = portSide((view.cell.getSource() as { port?: string }).port);
    const tgt = portSide((view.cell.getTarget() as { port?: string }).port);
    return presets.manhattan.call(this as never, vertices, {
      padding,
      step: 20,
      excludeNodes,
      ...(src ? { startDirections: [src] } : {}),
      ...(tgt ? { endDirections: [tgt] } : {}),
    }, view);
  } as Def, true);
}
