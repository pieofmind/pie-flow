/** Shared connect ports — 12 fixed points, 3 per side.
 *
 * Each cardinal port lives in its own group (`pTop`/`pBottom`/`pLeft`/`pRight`)
 * so X6 doesn't auto-distribute it — a single-item group sits exactly at the
 * side midpoint. The quarter ports each have their own 2-item group so each
 * side exposes left/mid/right or top/mid/bottom connection choices.
 */
export const FIXED_PORT_IDS = [
  "top-1", "top", "top-2",
  "right-1", "right", "right-2",
  "bottom-1", "bottom", "bottom-2",
  "left-1", "left", "left-2",
] as const;

export type FixedPortId = typeof FIXED_PORT_IDS[number];

export function makePorts(stroke = "#5E8FB9") {
  // Visibility is controlled by togglePorts. Keep the base attrs free of inline
  // visibility so X6 can render all 12 fixed magnets when a node is hovered.
  const circle = { r: 2.75, magnet: true, stroke, fill: "#fff", strokeWidth: 0.9 };
  return {
    groups: {
      // Cardinal — one item per group so X6 doesn't auto-distribute.
      pTop:    { position: "top",    attrs: { circle } },
      pBottom: { position: "bottom", attrs: { circle } },
      pLeft:   { position: "left",   attrs: { circle } },
      pRight:  { position: "right",  attrs: { circle } },
      // Quarter — 2 items per group auto-distribute away from the midpoint.
      pTopQ:    { position: "top",    attrs: { circle } },
      pBottomQ: { position: "bottom", attrs: { circle } },
      pLeftQ:   { position: "left",   attrs: { circle } },
      pRightQ:  { position: "right",  attrs: { circle } },
    },
    items: [
      { id: "top",    group: "pTop"    },
      { id: "bottom", group: "pBottom" },
      { id: "left",   group: "pLeft"   },
      { id: "right",  group: "pRight"  },
      { id: "top-1",    group: "pTopQ"    },
      { id: "top-2",    group: "pTopQ"    },
      { id: "bottom-1", group: "pBottomQ" },
      { id: "bottom-2", group: "pBottomQ" },
      { id: "left-1",   group: "pLeftQ"   },
      { id: "left-2",   group: "pLeftQ"   },
      { id: "right-1",  group: "pRightQ"  },
      { id: "right-2",  group: "pRightQ"  },
    ],
  };
}

export const LABEL_BELOW = {
  refX: "50%", refY: "100%", refY2: 6,
  textAnchor: "middle", textVerticalAnchor: "top",
  fill: "#1f2329", fontSize: 12,
};
