import { Graph } from "@antv/x6";

const LABEL_BELOW = {
  refX: "50%", refY: "100%", refY2: 6,
  textAnchor: "middle", textVerticalAnchor: "top",
  fill: "#1f2329", fontSize: 12,
};

function ports() {
  const c = { r: 4, magnet: true, stroke: "#3370ff", fill: "#fff", strokeWidth: 1.5, style: { visibility: "hidden" } };
  return {
    groups: {
      top: { position: "top", attrs: { circle: c } },
      bottom: { position: "bottom", attrs: { circle: c } },
      left: { position: "left", attrs: { circle: c } },
      right: { position: "right", attrs: { circle: c } },
    },
    items: [
      { id: "top", group: "top" }, { id: "bottom", group: "bottom" },
      { id: "left", group: "left" }, { id: "right", group: "right" },
    ],
  };
}

let registered = false;

export function registerFlowchartShapes(): void {
  if (registered) return;
  registered = true;

  Graph.registerNode("fc-process", {
    inherit: "rect", width: 120, height: 52,
    attrs: {
      body: { fill: "#eaf1ff", stroke: "#3370ff", strokeWidth: 1.5, rx: 6, ry: 6 },
      label: { fill: "#1f2329", fontSize: 13 },
    },
    ports: ports(),
  }, true);

  Graph.registerNode("fc-decision", {
    inherit: "polygon", width: 120, height: 64,
    attrs: {
      body: { fill: "#fff7e8", stroke: "#ff8800", strokeWidth: 1.5, refPoints: "0,10 10,0 20,10 10,20" },
      label: { fill: "#1f2329", fontSize: 12 },
    },
    ports: ports(),
  }, true);

  Graph.registerNode("fc-start", {
    inherit: "ellipse", width: 44, height: 44,
    attrs: {
      body: { fill: "#34c759", stroke: "#28a745", strokeWidth: 2 },
      label: LABEL_BELOW,
    },
    ports: ports(),
  }, true);

  Graph.registerNode("fc-end", {
    inherit: "ellipse", width: 44, height: 44,
    attrs: {
      body: { fill: "#ff3b30", stroke: "#d70015", strokeWidth: 2 },
      label: LABEL_BELOW,
    },
    ports: ports(),
  }, true);

  Graph.registerNode("fc-io", {
    inherit: "polygon", width: 120, height: 52,
    attrs: {
      body: { fill: "#e7f9ed", stroke: "#34c759", strokeWidth: 1.5, refPoints: "10,0 30,0 20,20 0,20" },
      label: { fill: "#1f2329", fontSize: 12 },
    },
    ports: ports(),
  }, true);

  Graph.registerNode("fc-document", {
    inherit: "rect", width: 120, height: 52,
    attrs: {
      body: { fill: "#fff3e0", stroke: "#ff8800", strokeWidth: 1.5, rx: 4 },
      label: { fill: "#1f2329", fontSize: 12 },
    },
    ports: ports(),
  }, true);

  Graph.registerNode("fc-text", {
    inherit: "rect", width: 100, height: 40,
    attrs: {
      body: { fill: "transparent", stroke: "transparent" },
      label: { fill: "#1f2329", fontSize: 13 },
    },
    ports: ports(),
  }, true);
}

export const FLOWCHART_PALETTE = [
  { shape: "fc-start", label: "Start", w: 44, h: 44 },
  { shape: "fc-process", label: "Process", w: 120, h: 52 },
  { shape: "fc-decision", label: "Decision", w: 120, h: 64 },
  { shape: "fc-io", label: "Input/Output", w: 120, h: 52 },
  { shape: "fc-document", label: "Document", w: 120, h: 52 },
  { shape: "fc-end", label: "End", w: 44, h: 44 },
  { shape: "fc-text", label: "Text", w: 100, h: 40 },
];
