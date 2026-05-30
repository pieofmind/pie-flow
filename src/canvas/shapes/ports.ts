/** Shared 4-way connect ports, hidden until node hover. */
export function makePorts(stroke = "#5E8FB9") {
  // Visibility is controlled purely by CSS (.x6-port circle hidden, shown on
  // node hover) — no inline style, which would override the CSS and keep ports
  // permanently hidden, making connections impossible.
  const circle = { r: 5.5, magnet: true, stroke, fill: "#fff", strokeWidth: 1.5 };
  return {
    groups: {
      top: { position: "top", attrs: { circle } },
      bottom: { position: "bottom", attrs: { circle } },
      left: { position: "left", attrs: { circle } },
      right: { position: "right", attrs: { circle } },
    },
    items: [
      { id: "top", group: "top" }, { id: "bottom", group: "bottom" },
      { id: "left", group: "left" }, { id: "right", group: "right" },
    ],
  };
}

export const LABEL_BELOW = {
  refX: "50%", refY: "100%", refY2: 6,
  textAnchor: "middle", textVerticalAnchor: "top",
  fill: "#1f2329", fontSize: 12,
};
