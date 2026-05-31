/** Shared 12-way connect ports, hidden until node hover.
 *
 * 3 docking positions per side (25% / 50% / 75%), so multiple arrows
 * converging on the same side can land at distinct points instead of
 * all stacking on the centre — bpmn.io-style spread. Legacy port IDs
 * (`top`, `right`, `bottom`, `left`) stay at the side midpoint for
 * backward compatibility with boards saved before this change.
 */
export function makePorts(stroke = "#5E8FB9") {
  // Visibility is controlled purely by CSS (.x6-port circle hidden, shown on
  // node hover) — no inline style, which would override the CSS and keep ports
  // permanently hidden, making connections impossible.
  const circle = { r: 5.5, magnet: true, stroke, fill: "#fff", strokeWidth: 1.5 };
  return {
    groups: {
      top:    { position: "top",    attrs: { circle } },
      bottom: { position: "bottom", attrs: { circle } },
      left:   { position: "left",   attrs: { circle } },
      right:  { position: "right",  attrs: { circle } },
    },
    items: [
      // Mid-side (legacy IDs — old boards still resolve).
      { id: "top",    group: "top",    args: { x: "50%" } },
      { id: "bottom", group: "bottom", args: { x: "50%" } },
      { id: "left",   group: "left",   args: { y: "50%" } },
      { id: "right",  group: "right",  args: { y: "50%" } },
      // Quarter / three-quarter — new docking positions for arrow spread.
      { id: "top-1",    group: "top",    args: { x: "25%" } },
      { id: "top-2",    group: "top",    args: { x: "75%" } },
      { id: "bottom-1", group: "bottom", args: { x: "25%" } },
      { id: "bottom-2", group: "bottom", args: { x: "75%" } },
      { id: "left-1",   group: "left",   args: { y: "25%" } },
      { id: "left-2",   group: "left",   args: { y: "75%" } },
      { id: "right-1",  group: "right",  args: { y: "25%" } },
      { id: "right-2",  group: "right",  args: { y: "75%" } },
    ],
  };
}

export const LABEL_BELOW = {
  refX: "50%", refY: "100%", refY2: 6,
  textAnchor: "middle", textVerticalAnchor: "top",
  fill: "#1f2329", fontSize: 12,
};
