/** Shared connect ports — 4 visible cardinal (mid-side) defaults + 8 invisible
 * quarter ports kept only for backward compatibility with boards saved by the
 * brief 12-port version of this file.
 *
 * Each cardinal port lives in its own group (`pTop`/`pBottom`/`pLeft`/`pRight`)
 * so X6 doesn't auto-distribute it — a single-item group sits exactly at the
 * side midpoint. The quarter ports each have their own 2-item group so X6
 * places them at 25% and 75% of the side without disturbing the cardinals.
 */
export function makePorts(stroke = "#5E8FB9") {
  // Visibility is controlled purely by CSS (.x6-port circle hidden, shown on
  // node hover via togglePorts which only flips the 4 cardinals visible) — no
  // inline style here, which would override the CSS and keep ports permanently
  // hidden, making connections impossible.
  const circle = { r: 5.5, magnet: true, stroke, fill: "#fff", strokeWidth: 1.5 };
  return {
    groups: {
      // Cardinal (visible) — one item per group so X6 doesn't auto-distribute.
      pTop:    { position: "top",    attrs: { circle } },
      pBottom: { position: "bottom", attrs: { circle } },
      pLeft:   { position: "left",   attrs: { circle } },
      pRight:  { position: "right",  attrs: { circle } },
      // Quarter (invisible, backward-compat) — 2 items per group auto-distribute
      // at 25% / 75% of the side.
      pTopQ:    { position: "top",    attrs: { circle } },
      pBottomQ: { position: "bottom", attrs: { circle } },
      pLeftQ:   { position: "left",   attrs: { circle } },
      pRightQ:  { position: "right",  attrs: { circle } },
    },
    items: [
      // Cardinal — IDs match what's saved by existing boards.
      { id: "top",    group: "pTop"    },
      { id: "bottom", group: "pBottom" },
      { id: "left",   group: "pLeft"   },
      { id: "right",  group: "pRight"  },
      // Quarter (invisible) — resolve any port IDs saved by the 12-port version.
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
