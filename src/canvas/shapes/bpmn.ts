import { Graph } from "@antv/x6";
import { makePorts, LABEL_BELOW } from "./ports";

let done = false;

export function registerBpmnShapes(): void {
  if (done) return;
  done = true;
  const p = makePorts("#1565c0");

  // ── Events ──
  Graph.registerNode("bpmn-start", {
    inherit: "ellipse", width: 36, height: 36,
    attrs: { body: { fill: "#e7f9ed", stroke: "#2e7d32", strokeWidth: 2 }, label: LABEL_BELOW },
    ports: p,
  }, true);

  Graph.registerNode("bpmn-end", {
    inherit: "ellipse", width: 36, height: 36,
    attrs: { body: { fill: "#fde8e8", stroke: "#c62828", strokeWidth: 4 }, label: LABEL_BELOW },
    ports: p,
  }, true);

  Graph.registerNode("bpmn-intermediate", {
    inherit: "ellipse", width: 36, height: 36,
    markup: [
      { tagName: "ellipse", selector: "outer" },
      { tagName: "ellipse", selector: "inner" },
      { tagName: "text", selector: "label" },
    ],
    attrs: {
      outer: { rx: 18, ry: 18, cx: 18, cy: 18, fill: "#fff8e1", stroke: "#f57f17", strokeWidth: 2 },
      inner: { rx: 13, ry: 13, cx: 18, cy: 18, fill: "transparent", stroke: "#f57f17", strokeWidth: 1.5 },
      label: LABEL_BELOW,
    },
    ports: p,
  }, true);

  // ── Gateways ──
  Graph.registerNode("bpmn-gateway-x", {
    inherit: "polygon", width: 40, height: 40,
    markup: [
      { tagName: "polygon", selector: "body" },
      { tagName: "text", selector: "mark" },
      { tagName: "text", selector: "label" },
    ],
    attrs: {
      body: { fill: "#fff3e0", stroke: "#e65100", strokeWidth: 1.5, refPoints: "20,0 40,20 20,40 0,20" },
      mark: { text: "✕", refX: "50%", refY: "50%", textAnchor: "middle", textVerticalAnchor: "middle", fill: "#e65100", fontSize: 16, fontWeight: "bold" },
      label: { refX: "50%", refY: "100%", refY2: 6, textAnchor: "middle", textVerticalAnchor: "top", fill: "#1f2329", fontSize: 11 },
    },
    ports: p,
  }, true);

  Graph.registerNode("bpmn-gateway-parallel", {
    inherit: "polygon", width: 40, height: 40,
    markup: [
      { tagName: "polygon", selector: "body" },
      { tagName: "text", selector: "mark" },
      { tagName: "text", selector: "label" },
    ],
    attrs: {
      body: { fill: "#e8eaf6", stroke: "#283593", strokeWidth: 1.5, refPoints: "20,0 40,20 20,40 0,20" },
      mark: { text: "+", refX: "50%", refY: "48%", textAnchor: "middle", textVerticalAnchor: "middle", fill: "#283593", fontSize: 22, fontWeight: "bold" },
      label: { refX: "50%", refY: "100%", refY2: 6, textAnchor: "middle", textVerticalAnchor: "top", fill: "#1f2329", fontSize: 11 },
    },
    ports: p,
  }, true);

  // ── Tasks ──
  Graph.registerNode("bpmn-task", {
    inherit: "rect", width: 100, height: 80,
    attrs: { body: { fill: "#ffffff", stroke: "#1565c0", strokeWidth: 1.5, rx: 8, ry: 8 }, label: { fill: "#1f2329", fontSize: 12 } },
    ports: p,
  }, true);

  Graph.registerNode("bpmn-task-user", {
    inherit: "rect", width: 100, height: 80,
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "text", selector: "icon" },
      { tagName: "text", selector: "label" },
    ],
    attrs: {
      body: { fill: "#e3f2fd", stroke: "#1565c0", strokeWidth: 1.5, rx: 8, ry: 8 },
      icon: { text: "👤", x: 7, y: 18, fontSize: 13 },
      label: { refX: "50%", refY: "55%", textAnchor: "middle", textVerticalAnchor: "middle", fill: "#1f2329", fontSize: 12 },
    },
    ports: p,
  }, true);

  Graph.registerNode("bpmn-task-service", {
    inherit: "rect", width: 100, height: 80,
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "text", selector: "icon" },
      { tagName: "text", selector: "label" },
    ],
    attrs: {
      body: { fill: "#e7f9ed", stroke: "#1b5e20", strokeWidth: 1.5, rx: 8, ry: 8 },
      icon: { text: "⚙️", x: 6, y: 18, fontSize: 12 },
      label: { refX: "50%", refY: "55%", textAnchor: "middle", textVerticalAnchor: "middle", fill: "#1f2329", fontSize: 12 },
    },
    ports: p,
  }, true);

  // ── Pool (swimlane container) ──
  Graph.registerNode("bpmn-pool", {
    inherit: "rect", width: 560, height: 180,
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "rect", selector: "header" },
      { tagName: "text", selector: "label" },
    ],
    attrs: {
      body: { refWidth: "100%", refHeight: "100%", fill: "#fafafa", stroke: "#546e7a", strokeWidth: 1.5 },
      header: { height: "100%", width: 30, fill: "#eceff1", stroke: "#546e7a", strokeWidth: 1.5 },
      label: { x: 15, refY: "50%", textAnchor: "middle", textVerticalAnchor: "middle", fill: "#1f2329", fontSize: 13, fontWeight: "bold", transform: "rotate(-90, 15, 90)" },
    },
    ports: p,
  }, true);
}
