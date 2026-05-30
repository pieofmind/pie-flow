import { Graph } from "@antv/x6";
import { makePorts, LABEL_BELOW } from "./ports";

let done = false;

export function registerStateShapes(): void {
  if (done) return;
  done = true;
  const p = makePorts("#7048e8");

  // Initial state — small filled circle
  Graph.registerNode("st-initial", {
    inherit: "ellipse", width: 28, height: 28,
    attrs: { body: { fill: "#1f2329", stroke: "#1f2329" }, label: LABEL_BELOW },
    ports: p,
  }, true);

  // State — rounded rect with title bar feel
  Graph.registerNode("st-state", {
    inherit: "rect", width: 130, height: 56,
    attrs: {
      body: { fill: "#f3effd", stroke: "#7048e8", strokeWidth: 1.5, rx: 12, ry: 12 },
      label: { fill: "#1f2329", fontSize: 13, fontWeight: "bold" },
    },
    ports: p,
  }, true);

  // Final state — double circle (outer + filled inner)
  Graph.registerNode("st-final", {
    inherit: "ellipse", width: 30, height: 30,
    markup: [
      { tagName: "ellipse", selector: "outer" },
      { tagName: "ellipse", selector: "inner" },
      { tagName: "text", selector: "label" },
    ],
    attrs: {
      outer: { rx: 15, ry: 15, cx: 15, cy: 15, fill: "#fff", stroke: "#1f2329", strokeWidth: 2 },
      inner: { rx: 8, ry: 8, cx: 15, cy: 15, fill: "#1f2329" },
      label: LABEL_BELOW,
    },
    ports: p,
  }, true);

  // Choice / junction — small diamond
  Graph.registerNode("st-choice", {
    inherit: "polygon", width: 40, height: 40,
    attrs: { body: { fill: "#fff3e0", stroke: "#e8590c", strokeWidth: 1.5, refPoints: "0,10 10,0 20,10 10,20" }, label: LABEL_BELOW },
    ports: p,
  }, true);
}
