import { Graph } from "@antv/x6";
import { makePorts } from "./ports";

let done = false;

export function registerUmlShapes(): void {
  if (done) return;
  done = true;
  const p = makePorts("#1a237e");

  // Class: 3 compartments
  Graph.registerNode("uml-class", {
    inherit: "rect", width: 170, height: 120,
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "rect", selector: "nameBox" },
      { tagName: "line", selector: "div2" },
      { tagName: "text", selector: "label" },
      { tagName: "text", selector: "attrs" },
      { tagName: "text", selector: "methods" },
    ],
    attrs: {
      body: { refWidth: "100%", refHeight: "100%", fill: "#ffffff", stroke: "#5E8FB9", strokeWidth: 1.5, rx: 6 },
      nameBox: { refWidth: "100%", height: 34, fill: "#eef3f9", stroke: "#5E8FB9", strokeWidth: 1.5, rx: 6 },
      div2: { x1: 0, y1: 80, x2: 170, y2: 80, stroke: "rgba(59,31,26,0.14)", strokeWidth: 1 },
      label: { refX: "50%", refY: 0, refY2: 17, textAnchor: "middle", textVerticalAnchor: "middle", fill: "#3B1F1A", fontSize: 13, fontWeight: "bold" },
      attrs: { refX: 8, refY: 50, textVerticalAnchor: "middle", fill: "#1f2329", fontSize: 11, fontFamily: "monospace", text: "+ field: Type" },
      methods: { refX: 8, refY: 100, textVerticalAnchor: "middle", fill: "#1f2329", fontSize: 11, fontFamily: "monospace", text: "+ method(): void" },
    },
    ports: p,
  }, true);

  // Interface
  Graph.registerNode("uml-interface", {
    inherit: "rect", width: 170, height: 90,
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "rect", selector: "nameBox" },
      { tagName: "text", selector: "stereo" },
      { tagName: "text", selector: "label" },
      { tagName: "text", selector: "methods" },
    ],
    attrs: {
      body: { refWidth: "100%", refHeight: "100%", fill: "#ffffff", stroke: "#4527a0", strokeWidth: 1.5, rx: 3 },
      nameBox: { refWidth: "100%", height: 42, fill: "#ede7f6", stroke: "#4527a0", strokeWidth: 1.5, rx: 3 },
      stereo: { refX: "50%", refY: 13, textAnchor: "middle", textVerticalAnchor: "middle", fill: "#4527a0", fontSize: 10, fontStyle: "italic", text: "«interface»" },
      label: { refX: "50%", refY: 30, textAnchor: "middle", textVerticalAnchor: "middle", fill: "#4527a0", fontSize: 13, fontWeight: "bold" },
      methods: { refX: 8, refY: 64, textVerticalAnchor: "middle", fill: "#1f2329", fontSize: 11, fontFamily: "monospace", text: "+ method(): void" },
    },
    ports: p,
  }, true);

  // Actor: stick figure
  Graph.registerNode("uml-actor", {
    inherit: "rect", width: 44, height: 74,
    markup: [
      { tagName: "ellipse", selector: "head" },
      { tagName: "line", selector: "trunk" },
      { tagName: "line", selector: "arms" },
      { tagName: "line", selector: "lleg" },
      { tagName: "line", selector: "rleg" },
      { tagName: "text", selector: "label" },
    ],
    attrs: {
      head: { cx: 22, cy: 11, rx: 8, ry: 8, fill: "#e8eaf6", stroke: "#1a237e", strokeWidth: 1.5 },
      trunk: { x1: 22, y1: 19, x2: 22, y2: 44, stroke: "#1a237e", strokeWidth: 1.5 },
      arms: { x1: 8, y1: 30, x2: 36, y2: 30, stroke: "#1a237e", strokeWidth: 1.5 },
      lleg: { x1: 22, y1: 44, x2: 10, y2: 58, stroke: "#1a237e", strokeWidth: 1.5 },
      rleg: { x1: 22, y1: 44, x2: 34, y2: 58, stroke: "#1a237e", strokeWidth: 1.5 },
      label: { refX: "50%", refY: "100%", refY2: 2, textAnchor: "middle", textVerticalAnchor: "top", fill: "#1f2329", fontSize: 11 },
    },
    ports: p,
  }, true);

  // Use case: ellipse
  Graph.registerNode("uml-usecase", {
    inherit: "ellipse", width: 130, height: 60,
    attrs: { body: { fill: "#e3f2fd", stroke: "#0d47a1", strokeWidth: 1.5 }, label: { fill: "#1f2329", fontSize: 12 } },
    ports: p,
  }, true);
}
