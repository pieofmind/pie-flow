/** Per-column port factory for ERD entity nodes (Story 2.2).
 *
 *  Each column row exposes two ports — one on the left edge, one on the right —
 *  positioned absolutely at the row's vertical centre. Importer + edge wiring
 *  (Story 2.3) reference these via `col:${name}-left` / `col:${name}-right`.
 *
 *  Layout constants MUST stay in sync with import.ts (HEAD_H=38, ROW_H=27)
 *  which sets node height; using smaller CSS-only values shifts ports above the
 *  visible row centre (see screenshot bug fixed 2026-06-05). The +6 baseline
 *  shift centers the port on the row text middle, not the row-box top.
 */

import type { ErdCol } from "./htmlNode";

const HEAD_H = 38;
const ROW_H = 27;

export interface ErdColPort {
  id: string;
  group: string;
  args: { x: number; y: number };
}

/** Produce 2 ports per column (left + right edge), absolutely positioned at
 *  the row's vertical centre. Width is the node width; height is derived from
 *  cols.length to keep the math consistent with addHtmlNode.
 *
 *  Returns an empty array for empty cols (degenerate case — edge case AC). */
export function buildErdColumnPorts(cols: ErdCol[], width: number): ErdColPort[] {
  if (!cols || cols.length === 0) return [];
  const ports: ErdColPort[] = [];
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    if (!col || !col.name) continue;
    const y = HEAD_H + i * ROW_H + ROW_H / 2;
    ports.push({
      id: `col:${col.name}-left`,
      group: "erdColLeft",
      args: { x: 0, y },
    });
    ports.push({
      id: `col:${col.name}-right`,
      group: "erdColRight",
      args: { x: width, y },
    });
  }
  return ports;
}

/** Port group spec for X6 Node.setPorts — uses "absolute" positioning so the
 *  per-column ports stay locked to their row's pixel Y regardless of node size.
 *
 *  Hit-area trick: `r: 11` makes the port circle a generous magnet zone, but
 *  `fill: rgba(94,143,185,0.001)` keeps it visually invisible until hover.
 *  X6 toggles visibility on `node:mouseenter` via togglePorts — for ERD this
 *  reveals all col:* ports on hover so user can grab any row.
 */
export const ERD_COL_PORT_GROUPS = {
  erdColLeft: {
    position: { name: "absolute" },
    attrs: {
      circle: {
        r: 11,
        magnet: true,
        stroke: "#5E8FB9",
        strokeWidth: 0,
        fill: "rgba(94,143,185,0.001)",
        cursor: "crosshair",
      },
    },
  },
  erdColRight: {
    position: { name: "absolute" },
    attrs: {
      circle: {
        r: 11,
        magnet: true,
        stroke: "#5E8FB9",
        strokeWidth: 0,
        fill: "rgba(94,143,185,0.001)",
        cursor: "crosshair",
      },
    },
  },
};
