import * as dagre from "@dagrejs/dagre";
import { allLaneIds, type PoolLane } from "./laneLayout";

/**
 * "Tự sắp xếp" for BPMN boards with (horizontal) pools. One dagre pass
 * (left→right) over every shape gives each its column, so flows — message
 * flows between pools included — read left to right; then every shape is put
 * back in its own (leaf) lane, shapes of one lane that share a column stack
 * in rows, each lane grows to fit its rows, and pools are stacked in their
 * original order with a shared left edge and width. Pure.
 */

/** `follow` = id of the shape this one hangs off (annotation / data object →
 *  its task): it takes that shape's column and a row right after it, instead
 *  of a column of its own. */
/** `keepX` = a free note (no arrow): keeps its x and goes in its lane's last
 *  rows, so nothing is placed on top of it. */
export interface LayoutNode { id: string; x: number; y: number; width: number; height: number; laneId?: string; poolId?: string; follow?: string; keepX?: boolean }
export interface LayoutPool { id: string; x: number; y: number; width: number; height: number; lanes: PoolLane[]; blackBox?: boolean }
export interface LayoutEdge { source: string; target: string }
export interface LayoutResult {
  nodes: Map<string, { x: number; y: number }>;
  pools: Map<string, { x: number; y: number; width: number; height: number; lanes: PoolLane[] }>;
}

const POOL_HEAD = 44 + 24;   // Board: pool title strip + lane title strip
const PAD_X = 40;
const PAD_Y = 30;            // above / below the rows of a lane
const ROW_GAP = 30;
const COL_GAP = 30;
const POOL_GAP = 60;
const MIN_LANE = 120;

export function layoutInLanes(pools: LayoutPool[], nodes: LayoutNode[], edges: LayoutEdge[]): LayoutResult {
  // 1. Columns: one left→right dagre pass over every shape.
  const g = new dagre.graphlib.Graph({ directed: true });
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 90, ranker: "longest-path" });
  g.setDefaultEdgeLabel(() => ({}));
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  const leader = (nd: LayoutNode): LayoutNode | undefined => (nd.follow ? byId.get(nd.follow) : undefined);
  const ranked = nodes.filter((nd) => !leader(nd) && !nd.keepX);
  for (const nd of ranked) g.setNode(nd.id, { width: nd.width, height: nd.height });
  const ids = new Set(ranked.map((nd) => nd.id));
  for (const e of edges) if (e.source !== e.target && ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const placedRaw = (id: string) => g.node(id) as { x: number; y: number; width: number; height: number };
  // A follower sorts right after its leader (so it lands in the next row).
  const orderY = (nd: LayoutNode): number => {
    if (nd.keepX) return Number.MAX_SAFE_INTEGER;
    const l = leader(nd);
    return l ? placedRaw(l.id).y + 0.5 : placedRaw(nd.id).y;
  };
  const minLeft = Math.min(...ranked.map((nd) => placedRaw(nd.id).x - nd.width / 2));
  const left = Math.min(...pools.map((p) => p.x));
  const colX = (nd: LayoutNode): number => {
    if (nd.keepX) return Math.max(nd.x, left + POOL_HEAD + PAD_X);
    const l = leader(nd);
    if (l) return colX(l);
    return left + POOL_HEAD + PAD_X + (placedRaw(nd.id).x - nd.width / 2 - minLeft);
  };
  const right = Math.max(...nodes.map((nd) => colX(nd) + nd.width), ...pools.map((p) => p.x + p.width)) + PAD_X;

  // 2. Rows inside each leaf lane: dagre's vertical order, a shape goes to the
  //    first row where it doesn't collide with that row's shapes.
  const out: LayoutResult = { nodes: new Map(), pools: new Map() };
  const placeLane = (members: LayoutNode[], top: number): number => {
    const rows: Array<{ spans: Array<[number, number]>; height: number; items: LayoutNode[] }> = [];
    for (const nd of [...members].sort((a, b) => orderY(a) - orderY(b))) {
      const span: [number, number] = [colX(nd) - COL_GAP / 2, colX(nd) + nd.width + COL_GAP / 2];
      let row = rows.find((r) => r.spans.every(([a, b]) => span[1] <= a || span[0] >= b));
      if (!row) { row = { spans: [], height: 0, items: [] }; rows.push(row); }
      row.spans.push(span);
      row.height = Math.max(row.height, nd.height);
      row.items.push(nd);
    }
    let y = top + PAD_Y;
    for (const r of rows) {
      for (const nd of r.items) out.nodes.set(nd.id, { x: colX(nd), y: y + (r.height - nd.height) / 2 });
      y += r.height + ROW_GAP;
    }
    const used = rows.length ? y - ROW_GAP + PAD_Y - top : 0;
    return Math.max(MIN_LANE, used);
  };

  // 3. Pools top → bottom in their original order; lanes top → bottom.
  let y = Math.min(...pools.map((p) => p.y));
  for (const pool of [...pools].sort((a, b) => a.y - b.y)) {
    const laneIds = new Set(allLaneIds(pool.lanes));
    const inPool = nodes.filter((nd) => nd.poolId === pool.id || (!!nd.laneId && laneIds.has(nd.laneId)));
    let height: number;
    let lanes = pool.lanes;
    if (pool.blackBox || !inPool.length) {
      height = pool.height;
    } else if (!lanes.length) {
      height = placeLane(inPool, y);
    } else {
      let at = y;
      const ofLane = (id: string) => inPool.filter((nd) => nd.laneId === id);
      // A lane with children is the stack of its children; shapes pinned to the
      // parent itself go with its first child. Heights add up the tree.
      const place = (list: PoolLane[], extra: LayoutNode[] = []): PoolLane[] => list.map((ln, i) => {
        if (!ln.lanes?.length) {
          const h = placeLane([...ofLane(ln.id), ...(i === 0 ? extra : [])], at);
          at += h;
          return { ...ln, height: h };
        }
        const start = at;
        const children = place(ln.lanes, [...ofLane(ln.id), ...(i === 0 ? extra : [])]);
        return { ...ln, height: at - start, lanes: children };
      });
      lanes = place(lanes);
      height = at - y;
    }
    out.pools.set(pool.id, { x: left, y, width: right - left, height, lanes });
    y += height + POOL_GAP;
  }
  return out;
}
