/**
 * Vertical pools (poolHorizontal: false): lanes are columns side by side,
 * each with its own width (`attrs.lanes[i].width`, optional — absent = equal
 * split), laneId assigned by x, BPMN DI with isHorizontal="false".
 *
 * Before: a vertical pool only moved its title strip to the top; lanes were
 * still stacked top→bottom and assigned by height, and export cut lane bands
 * along y — so vertical lanes were useless.
 */
import { describe, it, expect } from "vitest";
import { nodeHtml } from "../../src/canvas/htmlNode";
import { asStackLanes, fromStackLanes, laneIndexAt, resizeLaneBoundary } from "../../src/canvas/laneLayout";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import type { CanvasModel } from "../../src/canvas/types";

type Lane = { id: string; label: string; height?: number; width?: number };
const cols: Lane[] = [{ id: "a", label: "Khách", width: 200 }, { id: "b", label: "Trực page", width: 400 }, { id: "c", label: "Sale", width: 200 }];

describe("lane geometry along the stacking axis", () => {
  it("a vertical pool reads / writes lane widths", () => {
    const stack = asStackLanes(cols, false);
    expect(laneIndexAt(stack, 800, 150)).toBe(0);    // x = 150 → first column
    expect(laneIndexAt(stack, 800, 300)).toBe(1);
    expect(laneIndexAt(stack, 800, 650)).toBe(2);
    const resized = fromStackLanes(cols, resizeLaneBoundary(stack, 800, 0, 50, 60), false);
    expect(resized.map((l) => l.width)).toEqual([250, 350, 200]);
    expect(resized.every((l) => l.height === undefined)).toBe(true);
  });

  it("a horizontal pool still uses heights", () => {
    const rows: Lane[] = [{ id: "a", label: "A", height: 100 }, { id: "b", label: "B", height: 300 }];
    expect(laneIndexAt(asStackLanes(rows, true), 400, 150)).toBe(1);
  });
});

describe("Board render", () => {
  it("vertical pool: lanes as columns weighted by width, dividers between them", () => {
    const html = nodeHtml("bpmn-pool", "KALIX", undefined, { poolHorizontal: false, lanes: cols });
    expect(html).toContain('class="bp-pool is-vertical"');
    expect(html).toContain('data-lane-id="b" style="flex: 400 1 0px"');
    expect(html.match(/bp-pool-lane-divider/g)?.length).toBe(2);
  });
});

const model: CanvasModel = {
  nodes: [
    { id: "vp", shape: "bpmn-pool", x: 0, y: 0, width: 800, height: 600, label: "KALIX",
      attrs: { poolHorizontal: false, lanes: cols } },
    { id: "t1", shape: "bpmn-task-user", x: 50, y: 200, width: 100, height: 80, label: "Nhắn", laneId: "a" },
    { id: "t2", shape: "bpmn-task-user", x: 350, y: 300, width: 100, height: 80, label: "Trả lời", laneId: "b" },
    { id: "t3", shape: "bpmn-task-user", x: 650, y: 400, width: 100, height: 80, label: "Chốt", laneId: "c" },
  ],
  edges: [{ id: "f1", source: "t1", target: "t2" }, { id: "f2", source: "t2", target: "t3" }],
} as unknown as CanvasModel;

function shape(xml: string, el: string) {
  const re = new RegExp(`<bpmndi:BPMNShape[^>]*bpmnElement="${el}"([^>]*)>\\s*<dc:Bounds x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.-]+)" height="([\\d.-]+)"`);
  const m = re.exec(xml);
  if (!m) throw new Error("no DI for " + el);
  return { attrs: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] };
}

describe("BPMN export / import of a vertical pool", () => {
  it("export writes lanes as columns with isHorizontal=false", async () => {
    const xml = await exportBpmn(model);
    const pool = shape(xml, "vp");
    expect(pool.attrs).toContain('isHorizontal="false"');
    expect([pool.x, pool.y, pool.w, pool.h]).toEqual([0, 0, 800, 600]);
    const [a, b, c] = ["a", "b", "c"].map((id) => shape(xml, id));
    expect([a.x, b.x, c.x]).toEqual([0, 200, 600]);
    expect([a.w, b.w, c.w]).toEqual([200, 400, 200]);
    expect(a.attrs).toContain('isHorizontal="false"');
    expect(a.y).toBeGreaterThan(0);             // below the pool's title strip
    expect(a.y + a.h).toBe(600);
  });

  it("export → import keeps the column widths, orientation and lanes of the nodes", async () => {
    const { model: back } = await importBpmn(await exportBpmn(model));
    const pool = back.nodes.find((n) => n.id === "vp")!;
    expect(pool.attrs?.poolHorizontal).toBe(false);
    expect((pool.attrs?.lanes as Lane[]).map((l) => [l.id, l.width])).toEqual([["a", 200], ["b", 400], ["c", 200]]);
    expect(back.nodes.filter((n) => n.id.startsWith("t")).map((n) => n.laneId)).toEqual(["a", "b", "c"]);
  });
});
