import { Graph } from "@antv/x6";
import { makePorts } from "./ports";

let done = false;

export function registerBasicShapes(): void {
  if (done) return;
  done = true;
  const p = makePorts();

  Graph.registerNode("bs-rect", {
    inherit: "rect", width: 120, height: 60,
    attrs: { body: { fill: "#ffffff", stroke: "#1f2329", strokeWidth: 1.5 }, label: { fill: "#1f2329", fontSize: 13 } },
    ports: p,
  }, true);

  Graph.registerNode("bs-rounded", {
    inherit: "rect", width: 120, height: 60,
    attrs: { body: { fill: "#ffffff", stroke: "#1f2329", strokeWidth: 1.5, rx: 10, ry: 10 }, label: { fill: "#1f2329", fontSize: 13 } },
    ports: p,
  }, true);

  Graph.registerNode("bs-ellipse", {
    inherit: "ellipse", width: 120, height: 70,
    attrs: { body: { fill: "#ffffff", stroke: "#1f2329", strokeWidth: 1.5 }, label: { fill: "#1f2329", fontSize: 13 } },
    ports: p,
  }, true);

  Graph.registerNode("bs-diamond", {
    inherit: "polygon", width: 120, height: 70,
    attrs: { body: { fill: "#ffffff", stroke: "#1f2329", strokeWidth: 1.5, refPoints: "0,10 10,0 20,10 10,20" }, label: { fill: "#1f2329", fontSize: 12 } },
    ports: p,
  }, true);

  Graph.registerNode("bs-text", {
    inherit: "rect", width: 100, height: 40,
    attrs: { body: { fill: "transparent", stroke: "transparent" }, label: { fill: "#1f2329", fontSize: 14 } },
    ports: p,
  }, true);

  // Sticky note (Omniboard yellow)
  Graph.registerNode("bs-sticky", {
    inherit: "rect", width: 140, height: 120,
    attrs: {
      body: { fill: "#fff3bf", stroke: "#f0c000", strokeWidth: 1 },
      label: { fill: "#1f2329", fontSize: 13, textWrap: { width: -16, height: -16, breakWord: true } },
    },
    ports: p,
  }, true);
}
