/**
 * Board → BPMN XML → Board (what switching to the native view and back does)
 * must give back the same layout: pools, lanes and nodes at the same x / y /
 * width / height, nodes in the same lane.
 *
 * Before: exportBpmn re-derived each participant's DI from the bbox of its
 * member nodes (+ fixed margins) and split lanes at the midpoints between
 * their nodes, ignoring the pool's own rectangle on the Board. Importing that
 * XML moved and resized every pool (32,470 2410×1560 → 72,432 2358×1444 on
 * the as-is board) and re-cut its lanes, so nodes changed lane on the Board.
 */
import { describe, it, expect } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import { mergeBpmnImport, collectIds } from "../../src/view/mergeBpmnCanvas";
import { laneHeights } from "../../src/canvas/laneLayout";
import type { CanvasModel } from "../../src/canvas/types";

type N = CanvasModel["nodes"][number];
const task = (id: string, laneId: string, x: number, y: number, shape = "bpmn-task-user"): N =>
  ({ id, shape, x, y, width: 100, height: 80, label: id, laneId });

// Same structure as the as-is / to-be fanpage boards: a customer pool, a
// company pool with 3 lanes that have NO stored height (equal split on the
// Board), a black-box pool, message flows between pools.
const BOARD: CanvasModel = {
  nodes: [
    { id: "pool_khach", shape: "bpmn-pool", x: 32, y: 0, width: 2410, height: 400, label: "Khách hàng",
      attrs: { lanes: [{ id: "l_khach", label: "Khách hàng" }] } },
    { id: "pool_kalix", shape: "bpmn-pool", x: 32, y: 470, width: 2410, height: 1560, label: "KALIX",
      attrs: { lanes: [{ id: "l_tu_dong", label: "Tự động" }, { id: "l_truc_page", label: "Trực page" }, { id: "l_sale", label: "Sale" }] } },
    { id: "pool_ncc", shape: "bpmn-pool", x: 32, y: 2100, width: 2410, height: 120, label: "Nhà cung cấp",
      attrs: { blackBox: true } },
    task("k1", "l_khach", 200, 160),
    task("k2", "l_khach", 600, 160, "bpmn-task-send"),
    task("a1", "l_tu_dong", 600, 640, "bpmn-task-service"),
    task("t1", "l_truc_page", 900, 1100),
    task("t2", "l_truc_page", 1300, 1400),
    task("s1", "l_sale", 1700, 1800),
  ],
  edges: [
    { id: "f1", source: "a1", target: "t1" },
    { id: "f2", source: "t1", target: "t2" },
    { id: "f3", source: "t2", target: "s1" },
    { id: "m1", source: "k2", target: "a1", kind: "message" },
    { id: "m2", source: "s1", target: "pool_ncc", kind: "message" },
  ],
} as unknown as CanvasModel;

const geo = (n: N) => ({ x: n.x, y: n.y, width: n.width, height: n.height });
const lanesOf = (n: N) => (n.attrs?.lanes as Array<{ id: string; height?: number }> | undefined) ?? [];

/** Board → XML → Board, the way BpmnNativeView stores it after a save. */
async function roundTrip(model: CanvasModel): Promise<CanvasModel> {
  const xml = await exportBpmn(model);
  const { model: imported } = await importBpmn(xml);
  return mergeBpmnImport(model, collectIds(imported), imported).model;
}

describe("Board ⇄ BPMN native keeps the layout", () => {
  it("pools, lanes and nodes come back at the same place (2 round trips)", async () => {
    const once = await roundTrip(BOARD);
    const twice = await roundTrip(once);
    for (const back of [once, twice]) {
      expect(back.nodes.map((n) => n.id).sort()).toEqual(BOARD.nodes.map((n) => n.id).sort());
      for (const n of BOARD.nodes) {
        const b = back.nodes.find((x) => x.id === n.id)!;
        expect(geo(b), n.id).toEqual(geo(n));
        if (n.laneId) expect(b.laneId, n.id).toBe(n.laneId);
        // lanes cut the pool exactly as the Board draws them
        expect(laneHeights(lanesOf(b), b.height), `${n.id} lanes`).toEqual(laneHeights(lanesOf(n), n.height));
        expect(lanesOf(b).map((l) => l.id)).toEqual(lanesOf(n).map((l) => l.id));
      }
      const pool = back.nodes.find((x) => x.id === "pool_ncc")!;
      expect(pool.attrs?.blackBox).toBe(true);
    }
  });

  it("export writes each participant / lane at its Board rectangle", async () => {
    const xml = await exportBpmn(BOARD);
    const b = (el: string) => {
      const m = new RegExp(`bpmnElement="${el}"[^>]*>\\s*<dc:Bounds x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.-]+)" height="([\\d.-]+)"`).exec(xml);
      return m ? [+m[1], +m[2], +m[3], +m[4]] : null;
    };
    expect(b("pool_kalix")).toEqual([32, 470, 2410, 1560]);
    expect(b("l_tu_dong")?.slice(1)).toEqual([470, 2410 - 30, 520]);
    expect(b("l_truc_page")?.[1]).toBe(990);
    expect(b("l_sale")?.[1]).toBe(1510);
  });
});
