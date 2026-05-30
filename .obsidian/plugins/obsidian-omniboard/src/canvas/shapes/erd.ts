import { Graph } from "@antv/x6";
import { makePorts } from "./ports";

let done = false;

export function registerErdShapes(): void {
  if (done) return;
  done = true;
  const p = makePorts("#3f51b5");

  // Entity: accent header + attribute rows (design .erd-table look)
  Graph.registerNode("erd-entity", {
    inherit: "rect", width: 184, height: 108,
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "rect", selector: "header" },
      { tagName: "text", selector: "label" },
      { tagName: "line", selector: "div1" },
      { tagName: "line", selector: "div2" },
      { tagName: "text", selector: "row1" },
      { tagName: "text", selector: "row1t" },
      { tagName: "text", selector: "row2" },
      { tagName: "text", selector: "row2t" },
    ],
    attrs: {
      body: { refWidth: "100%", refHeight: "100%", fill: "#ffffff", stroke: "#5E8FB9", strokeWidth: 1.5, rx: 8, ry: 8 },
      header: { refWidth: "100%", height: 34, fill: "#5E8FB9", rx: 8, ry: 8 },
      label: { refX: 12, refY: 17, textVerticalAnchor: "middle", fill: "#ffffff", fontSize: 13, fontWeight: "bold" },
      div1: { refX: 0, refY: 72, x1: 0, y1: 0, x2: 184, y2: 0, stroke: "rgba(59,31,26,0.10)", strokeWidth: 1 },
      div2: { stroke: "transparent" },
      row1: { refX: 12, refY: 53, textVerticalAnchor: "middle", fill: "#C99A2E", fontSize: 9, fontWeight: "bold", text: "PK" },
      row1t: { refX: 38, refY: 53, textVerticalAnchor: "middle", fill: "#3B1F1A", fontSize: 12, fontWeight: 600, text: "id" },
      row2: { refX: 12, refY: 90, textVerticalAnchor: "middle", fill: "rgba(59,31,26,0.42)", fontSize: 9, fontWeight: "bold", text: "FK" },
      row2t: { refX: 38, refY: 90, textVerticalAnchor: "middle", fill: "#3B1F1A", fontSize: 12, text: "name" },
    },
    ports: p,
  }, true);

  // Relationship: diamond
  Graph.registerNode("erd-relationship", {
    inherit: "polygon", width: 120, height: 60,
    attrs: { body: { fill: "#e0f7fa", stroke: "#00838f", strokeWidth: 1.5, refPoints: "0,10 10,0 20,10 10,20" }, label: { fill: "#004d40", fontSize: 12, fontWeight: "bold" } },
    ports: p,
  }, true);

  // Attribute: ellipse
  Graph.registerNode("erd-attribute", {
    inherit: "ellipse", width: 110, height: 44,
    attrs: { body: { fill: "#fff9c4", stroke: "#f9a825", strokeWidth: 1.5 }, label: { fill: "#1f2329", fontSize: 12 } },
    ports: p,
  }, true);

  // Key attribute: underlined label
  Graph.registerNode("erd-key", {
    inherit: "ellipse", width: 110, height: 44,
    attrs: { body: { fill: "#fff9c4", stroke: "#f57f17", strokeWidth: 2 }, label: { fill: "#1f2329", fontSize: 12, textDecoration: "underline", fontWeight: "bold" } },
    ports: p,
  }, true);
}
