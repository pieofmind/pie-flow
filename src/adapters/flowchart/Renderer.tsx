import { h } from "preact";
import { useRef, useEffect } from "preact/hooks";
import { Graph } from "@antv/x6";
import type { RendererProps } from "../../core/adapter";
import type { CanvasModel } from "../../canvas/LarkCanvas";
import { registerAllShapes } from "../../canvas/shapes/index";

registerAllShapes();

const SMART_ROUTER = { name: "manhattan", args: { padding: 16 } };
const CONNECTOR = { name: "rounded", args: { radius: 10 } };
const EDGE_ATTRS = { line: { stroke: "#8a8f99", strokeWidth: 2, targetMarker: { name: "block", width: 11, height: 8 } } };

/** Read-mode: static, non-interactive X6 render fit to content. */
export function FlowchartRenderer({ model }: RendererProps<CanvasModel>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (!model.nodes.length) { ref.current.innerHTML = `<div class="diagrams-empty">(empty flowchart)</div>`; return; }
    const graph = new Graph({
      container: ref.current,
      width: ref.current.clientWidth || 600,
      height: 300,
      interacting: false,
      background: { color: "transparent" },
    });
    for (const n of model.nodes) {
      graph.addNode({ id: n.id, shape: n.shape, x: n.x, y: n.y, width: n.width, height: n.height, label: n.label, attrs: n.attrs as any });
    }
    for (const e of model.edges) {
      graph.addEdge({ source: { cell: e.source, port: e.sourcePort }, target: { cell: e.target, port: e.targetPort }, router: SMART_ROUTER, connector: CONNECTOR, attrs: EDGE_ATTRS, labels: e.label ? [{ attrs: { label: { text: e.label } } }] : [] });
    }
    graph.zoomToFit({ padding: 20, maxScale: 1 });
    return () => graph.dispose();
  }, []);

  return <div ref={ref} class="diagrams-render-host" style="width:100%;height:300px;" />;
}
