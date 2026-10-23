/**
 * Message flow onto a pool's border, by mouse.
 *
 * Pools have no connect ports (NON_CONNECTABLE_PORT_KINDS), so on the Board an
 * arrow could not end on a pool — the only way was hand-written JSON with a
 * targetAnchor. Dropping an arrow on a pool now ends it on the pool's border
 * (black-box pool: anywhere on it; pool with lanes: near its top / bottom
 * border), straight above / below the other end, and makes it a message flow
 * (the only flow BPMN allows to a participant).
 */
import { describe, it, expect } from "vitest";
import { poolDropAnchor, POOL_EDGE_BAND } from "../../src/canvas/poolConnect";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import type { CanvasModel } from "../../src/canvas/types";

const blackBox = { x: 0, y: 0, width: 800, height: 120, blackBox: true };
const company = { x: 0, y: 200, width: 800, height: 400, blackBox: false };

describe("poolDropAnchor", () => {
  it("black-box pool: anywhere on it → the border facing the other end, straight above / below it", () => {
    // task below the customer pool, at x = 350
    expect(poolDropAnchor(blackBox, { x: 600, y: 40 }, { x: 350, y: 300 })).toEqual({ dx: 350, dy: 120 });
    // other end above → top border
    expect(poolDropAnchor({ ...blackBox, y: 500 }, { x: 100, y: 560 }, { x: 420, y: 100 })).toEqual({ dx: 420, dy: 0 });
  });

  it("keeps the anchor on the pool when the other end is off to the side", () => {
    expect(poolDropAnchor(blackBox, { x: 600, y: 40 }, { x: 1200, y: 300 })).toEqual({ dx: 800, dy: 120 });
  });

  it("other end level with the pool → the border nearest the drop", () => {
    expect(poolDropAnchor(blackBox, { x: 300, y: 100 }, { x: 900, y: 60 })).toEqual({ dx: 800, dy: 120 });
  });

  it("pool with lanes: only near its top / bottom border (inside it, a drop places a new shape)", () => {
    expect(poolDropAnchor(company, { x: 400, y: 400 }, { x: 300, y: 60 })).toBeNull();
    expect(poolDropAnchor(company, { x: 400, y: 200 + POOL_EDGE_BAND - 1 }, { x: 300, y: 60 })).toEqual({ dx: 300, dy: 0 });
    expect(poolDropAnchor(company, { x: 400, y: 600 + POOL_EDGE_BAND - 1 }, { x: 300, y: 900 })).toEqual({ dx: 300, dy: 400 });
  });

  it("a drop clear of the pool is not a pool drop", () => {
    expect(poolDropAnchor(blackBox, { x: 400, y: 120 + POOL_EDGE_BAND + 5 }, { x: 350, y: 300 })).toBeNull();
  });
});

describe("export of a flow dropped on a pool", () => {
  it("becomes a bpmn:MessageFlow whose targetRef is the participant", async () => {
    const anchor = poolDropAnchor(blackBox, { x: 600, y: 40 }, { x: 350, y: 300 })!;
    const model: CanvasModel = {
      nodes: [
        { id: "pool_khach", shape: "bpmn-pool", ...blackBox, label: "Khách", attrs: { blackBox: true } },
        { id: "pool_kalix", shape: "bpmn-pool", ...company, label: "KALIX", attrs: { lanes: [{ id: "l_tp", label: "Trực page" }] } },
        { id: "send", shape: "bpmn-task-send", x: 300, y: 300, width: 100, height: 80, label: "Gửi báo giá", laneId: "l_tp" },
      ],
      // what the Board stores after the drop: message kind + anchor on the pool
      edges: [{ id: "m1", source: "send", sourcePort: "top", target: "pool_khach", targetAnchor: anchor, kind: "message" }],
    } as unknown as CanvasModel;
    const xml = await exportBpmn(model);
    expect(xml).toMatch(/<bpmn:messageFlow id="m1"[^>]*sourceRef="send"[^>]*targetRef="pool_khach"/);
    const { model: back } = await importBpmn(xml);
    const m1 = back.edges.find((e) => e.id === "m1")!;
    expect(m1.target).toBe("pool_khach");
    expect(m1.kind).toBe("message");
  });
});
