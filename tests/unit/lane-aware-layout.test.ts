/**
 * "Tự sắp xếp" for BPMN boards with pools: lay the flow out left→right
 * (dagre, one pass over every pool so message flows line up) while every
 * shape stays in its own lane; lanes grow to fit, pools keep their order.
 *
 * Before: autoLayout ran dagre over all leaf shapes ignoring lanes, moved
 * shapes into other lanes and shrank each pool to hug them (lanes lost).
 */
import { describe, it, expect } from "vitest";
import { layoutInLanes, type LayoutNode, type LayoutPool } from "../../src/canvas/laneAwareLayout";

const n = (id: string, laneId: string, x: number, y: number, w = 100, h = 80): LayoutNode => ({ id, laneId, x, y, width: w, height: h });

// Customer pool (1 lane) above the company pool (Trực page + Sale), shapes
// scattered on purpose.
const pools: LayoutPool[] = [
  { id: "p_kh", x: 32, y: 0, width: 900, height: 300, lanes: [{ id: "l_kh", label: "Khách" }] },
  { id: "p_kalix", x: 32, y: 400, width: 900, height: 500, lanes: [{ id: "l_tp", label: "Trực page" }, { id: "l_sale", label: "Sale" }] },
];
const nodes: LayoutNode[] = [
  n("k1", "l_kh", 700, 150), n("k2", "l_kh", 100, 40),
  n("t1", "l_tp", 600, 450), n("t2", "l_tp", 120, 700), n("t3", "l_tp", 400, 460),
  n("s1", "l_sale", 50, 800),
];
const edges = [
  { source: "k2", target: "t1" },   // message flow
  { source: "t1", target: "t2" }, { source: "t1", target: "t3" },   // fork: t2, t3 same rank
  { source: "t2", target: "s1" }, { source: "t3", target: "s1" },
  { source: "s1", target: "k1" },   // message flow back
];

const out = layoutInLanes(pools, nodes, edges);
const pos = (id: string) => ({ ...nodes.find((x) => x.id === id)!, ...out.nodes.get(id)! });
const laneBand = (poolId: string, laneId: string) => {
  const p = out.pools.get(poolId)!;
  let y = p.y;
  for (const ln of p.lanes) { if (ln.id === laneId) return { top: y, bottom: y + (ln.height ?? 0) }; y += ln.height ?? 0; }
  throw new Error("no lane " + laneId);
};

describe("layoutInLanes", () => {
  it("keeps every shape inside its own lane", () => {
    for (const [id, poolId, laneId] of [["k1", "p_kh", "l_kh"], ["k2", "p_kh", "l_kh"], ["t1", "p_kalix", "l_tp"], ["t2", "p_kalix", "l_tp"], ["t3", "p_kalix", "l_tp"], ["s1", "p_kalix", "l_sale"]] as const) {
      const b = laneBand(poolId, laneId), p = pos(id);
      expect(p.y, id).toBeGreaterThanOrEqual(b.top);
      expect(p.y + p.height, id).toBeLessThanOrEqual(b.bottom);
    }
  });

  it("flows left → right along the arrows, across pools too", () => {
    expect(pos("k2").x).toBeLessThan(pos("t1").x);
    expect(pos("t1").x).toBeLessThan(pos("t2").x);
    expect(pos("t2").x).toBeLessThan(pos("s1").x);
    expect(pos("s1").x).toBeLessThan(pos("k1").x);
  });

  it("no two shapes overlap; same-rank shapes in one lane stack and the lane grows", () => {
    const all = nodes.map((x) => pos(x.id));
    for (const a of all) for (const b of all) {
      if (a.id >= b.id) continue;
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap, `${a.id} × ${b.id}`).toBe(false);
    }
    const tp = laneBand("p_kalix", "l_tp"), sale = laneBand("p_kalix", "l_sale");
    expect(tp.bottom - tp.top).toBeGreaterThan(sale.bottom - sale.top);   // t2 / t3 stacked
  });

  it("pools keep their order, don't overlap and share the left edge / width", () => {
    const a = out.pools.get("p_kh")!, b = out.pools.get("p_kalix")!;
    expect(a.y).toBe(0);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
    expect([a.x, a.width]).toEqual([b.x, b.width]);
    expect(b.height).toBe(b.lanes.reduce((s, l) => s + (l.height ?? 0), 0));
    for (const id of ["k1", "t1", "s1"]) expect(pos(id).x + pos(id).width).toBeLessThanOrEqual(a.x + a.width);
  });
});

describe("annotations / data objects follow their task", () => {
  const withData: LayoutNode[] = [...nodes, { ...n("d1", "l_tp", 3000, 2000, 40, 60), follow: "t1" }];
  const res = layoutInLanes(pools, withData, edges);
  const p = (id: string) => ({ ...withData.find((x) => x.id === id)!, ...res.nodes.get(id)! });

  it("same column as its task, inside its own lane, clear of every shape", () => {
    expect(p("d1").x).toBe(p("t1").x);
    const tp = (() => { const pool = res.pools.get("p_kalix")!; return { top: pool.y, bottom: pool.y + (pool.lanes[0].height ?? 0) }; })();
    expect(p("d1").y).toBeGreaterThanOrEqual(tp.top);
    expect(p("d1").y + 60).toBeLessThanOrEqual(tp.bottom);
    for (const o of withData) {
      if (o.id === "d1") continue;
      const q = p(o.id);
      const overlap = q.x < p("d1").x + 40 && p("d1").x < q.x + q.width && q.y < p("d1").y + 60 && p("d1").y < q.y + q.height;
      expect(overlap, "d1 × " + o.id).toBe(false);
    }
  });
});

describe("a free note in a lane (no arrow)", () => {
  const withNote: LayoutNode[] = [...nodes, { ...n("note", "l_tp", 500, 455, 200, 60), keepX: true }];
  const res = layoutInLanes(pools, withNote, edges);
  const p = (id: string) => ({ ...withNote.find((x) => x.id === id)!, ...res.nodes.get(id)! });

  it("keeps its x, stays in its lane, and nothing lands on it", () => {
    expect(p("note").x).toBe(500);
    const pool = res.pools.get("p_kalix")!;
    expect(p("note").y + 60).toBeLessThanOrEqual(pool.y + (pool.lanes[0].height ?? 0));
    for (const o of withNote) {
      if (o.id === "note") continue;
      const q = p(o.id), a = p("note");
      expect(q.x < a.x + 200 && a.x < q.x + q.width && q.y < a.y + 60 && a.y < q.y + q.height, "note × " + o.id).toBe(false);
    }
  });
});
