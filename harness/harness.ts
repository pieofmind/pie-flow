import { OmniboardCanvas } from "../src/canvas/OmniboardCanvas";
import { renderModelToSvg, collectPluginCss } from "../src/canvas/staticRender";
import { registerAllShapes, SHAPE_CATEGORIES } from "../src/canvas/shapes/index";
import { importBpmn } from "../src/io/bpmn/import";
import { exportBpmn } from "../src/io/bpmn/export";
import { importDbml } from "../src/io/dbml/import";
registerAllShapes();
const host = document.getElementById("host")!;
const canvas = new OmniboardCanvas(host, SHAPE_CATEGORIES, () => {});
(window as any).__import = {
  bpmn: async (raw: string) => { const r = await importBpmn(raw); canvas.loadModel(r.model); return { nodes: r.model.nodes.length, edges: r.model.edges.length, warnings: r.warnings, sourceMeta: r.sourceMeta }; },
  dbml: (raw: string) => { const r = importDbml(raw); canvas.loadModel(r.model); return { nodes: r.model.nodes.length, edges: r.model.edges.length, warnings: r.warnings }; },
};
(window as any).__export = {
  bpmn: async (model: unknown, meta?: unknown) => exportBpmn(
    model as Parameters<typeof exportBpmn>[0],
    meta as Parameters<typeof exportBpmn>[1],
  ),
};
canvas.loadModel({ nodes: [
  { id: "p", shape: "fc-process", x: 50, y: 120, width: 130, height: 56, label: "Xử lý" },
  { id: "user", shape: "erd-entity", x: 250, y: 60, width: 200, height: 159, label: "users",
    attrs: { cols: [
      { k: "PK", name: "id", type: "bigint" },
      { k: "", name: "email", type: "varchar" },
      { k: "", name: "name", type: "varchar" },
      { k: "FK", name: "team_id", type: "bigint" },
      { k: "", name: "created_at", type: "timestamp" },
    ] } },
  { id: "cls", shape: "uml-class", x: 540, y: 60, width: 210, height: 158, label: "OrderService",
    attrs: { fields: ["- repo: OrderRepo", "+ taxRate: float"], methods: ["+ create(o: Order): Order", "+ cancel(id: string): void"] } },
  { id: "iface", shape: "uml-interface", x: 820, y: 90, width: 190, height: 96, label: "Payable",
    attrs: { methods: ["+ pay(amount: int): bool"] } },
], edges: [
  { id: "e1", source: "p", sourcePort: "right", target: "user", targetPort: "left" },
  { id: "e2", source: "user", sourcePort: "right", target: "cls", targetPort: "left", label: "uses" },
] });
(window as any).__ob = canvas;
(window as any).__OB = OmniboardCanvas;
(window as any).__cats = SHAPE_CATEGORIES;
(window as any).__render = renderModelToSvg;
(window as any).__css = collectPluginCss;
