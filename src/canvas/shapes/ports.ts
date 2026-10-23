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

/** Radius of a port's grab area (the visible dot stays ≈2.75). */
export const PORT_HIT_RADIUS = 8;

export function makePorts(stroke = "#5E8FB9") {
  // Visibility is controlled by togglePorts. Keep the base attrs free of inline
  // visibility so X6 can render all 12 fixed magnets when a node is hovered.
  //
  // Grab area vs. look: the magnet is an r=8 circle (easy to hit) painted with a
  // radial gradient that draws the same small dot as before (white r≈2.75 with a
  // thin ring) and is transparent outside it. A transparent gradient still
  // counts as painted, so the whole disc takes the pointer — no extra element,
  // so every `circle[port=…]` selector keeps working.
  const circle = {
    r: PORT_HIT_RADIUS, magnet: true, stroke: "none",
    fill: {
      type: "radialGradient",
      stops: [
        { offset: "0%", color: "#fff" },
        { offset: "28%", color: "#fff" },
        { offset: "29%", color: stroke },
        { offset: "40%", color: stroke },
        { offset: "41%", color: stroke, opacity: 0 },
        { offset: "100%", color: stroke, opacity: 0 },
      ],
    },
  };
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

// ── Drop-anywhere connect geometry (pure; shared by canvas + tests) ──────────
export type PortSide = "top" | "right" | "bottom" | "left";
export interface Box { x: number; y: number; width: number; height: number; }
export interface Pt { x: number; y: number; }

/** Fixed port id on `side`, band chosen by 0..1 position along that side. */
export function fixedPort(side: PortSide, along: number): FixedPortId {
  const band = along < 0.375 ? "-1" : along > 0.625 ? "-2" : "";
  return `${side}${band}` as FixedPortId;
}

/** Nearest of the 12 fixed ports to `pt` (clamped into the box). Ties resolve
 *  top → bottom → left → right so results are deterministic. */
export function nearestFixedPortInBox(b: Box, pt: Pt): FixedPortId {
  const dx = Math.max(0, Math.min(b.width, pt.x - b.x));
  const dy = Math.max(0, Math.min(b.height, pt.y - b.y));
  const dLeft = dx, dRight = b.width - dx, dTop = dy, dBottom = b.height - dy;
  const m = Math.min(dLeft, dRight, dTop, dBottom);
  if (m === dTop) return fixedPort("top", b.width > 0 ? dx / b.width : 0.5);
  if (m === dBottom) return fixedPort("bottom", b.width > 0 ? dx / b.width : 0.5);
  if (m === dLeft) return fixedPort("left", b.height > 0 ? dy / b.height : 0.5);
  return fixedPort("right", b.height > 0 ? dy / b.height : 0.5);
}

/** Among items whose bbox contains `pt`, the SMALLEST bbox — so a task inside
 *  a pool/lane wins over the container. Undefined when nothing contains it. */
export function pickDropTarget<T extends { bbox: Box }>(items: readonly T[], pt: Pt): T | undefined {
  let best: T | undefined;
  for (const it of items) {
    const b = it.bbox;
    if (pt.x < b.x || pt.x > b.x + b.width || pt.y < b.y || pt.y > b.y + b.height) continue;
    if (!best || b.width * b.height < best.bbox.width * best.bbox.height) best = it;
  }
  return best;
}
