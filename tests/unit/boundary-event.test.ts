/**
 * Boundary events (`bpmn-event-intermediate` with `attachedTo`) sit on the
 * border of their host activity, like bpmn-js:
 *  - dragging the event slides it along the host border,
 *  - moving / resizing the host keeps the event at the same place on its border,
 *  - the label goes outside the host so it never covers the host's name.
 */
import { describe, it, expect } from "vitest";
import { snapToHostBorder, followHost, hostSide, eventLabelSide } from "../../src/canvas/boundaryLayout";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import { renderModelToCard } from "../../src/canvas/staticRender";
import type { CanvasModel } from "../../src/canvas/types";

const host = { x: 820, y: 760, width: 120, height: 80 };
const ev = (cx: number, cy: number) => ({ x: cx - 18, y: cy - 18, width: 36, height: 36 });
const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

describe("snapToHostBorder", () => {
  it("puts the event centre on the nearest host edge", () => {
    // repro from the to-be board: centre (880, 760) is already on the top edge
    expect(centre({ ...ev(880, 760), ...snapToHostBorder(ev(880, 760), host) })).toEqual({ x: 880, y: 760 });
    // a bit inside, near the bottom → onto the bottom edge
    expect(centre({ ...ev(0, 0), ...snapToHostBorder(ev(850, 830), host) })).toEqual({ x: 850, y: 840 });
    // outside to the right → right edge, y kept
    expect(centre({ ...ev(0, 0), ...snapToHostBorder(ev(990, 790), host) })).toEqual({ x: 940, y: 790 });
  });

  it("clamps the slide to the edge's length", () => {
    // dragged far past the bottom-right corner → corner
    expect(centre({ ...ev(0, 0), ...snapToHostBorder(ev(1200, 900), host) })).toEqual({ x: 940, y: 840 });
  });
});

describe("hostSide", () => {
  it("names the host edge the event sits on", () => {
    expect(hostSide(ev(880, 760), host)).toBe("top");
    expect(hostSide(ev(880, 840), host)).toBe("bottom");
    expect(hostSide(ev(820, 800), host)).toBe("left");
    expect(hostSide(ev(940, 800), host)).toBe("right");
  });
});

describe("followHost", () => {
  it("moves with the host", () => {
    const moved = { ...host, x: host.x + 100, y: host.y - 40 };
    expect(followHost(ev(880, 840), host, moved)).toEqual({ x: 880 + 100 - 18, y: 840 - 40 - 18 });
  });

  it("keeps its place along the border when the host is resized", () => {
    // bottom edge, a quarter of the way along
    const before = ev(850, 840);
    const wider = { ...host, width: 240, height: 120 };
    const p = followHost(before, host, wider);
    expect(centre({ ...before, ...p })).toEqual({ x: 820 + 60, y: 760 + 120 });
    // right edge, half way down
    const right = followHost(ev(940, 800), host, wider);
    expect(centre({ ...before, ...right })).toEqual({ x: 1060, y: 820 });
  });
});

describe("eventLabelSide", () => {
  it("puts a boundary label outside the host", () => {
    expect(eventLabelSide({ boundary: "top" })).toBe("top");
    expect(eventLabelSide({ boundary: "bottom" })).toBe("bottom");
    expect(eventLabelSide({ boundary: "left" })).toBe("left");
    expect(eventLabelSide({ boundary: "right" })).toBe("right");
  });

  it("free events keep the old rule: flip up only when edges leave below", () => {
    expect(eventLabelSide({ edgeBelow: false, edgeAbove: false })).toBe("bottom");
    expect(eventLabelSide({ edgeBelow: true, edgeAbove: false })).toBe("top");
    expect(eventLabelSide({ edgeBelow: true, edgeAbove: true })).toBe("bottom");
  });
});

describe("BPMN round-trip of a boundary event", () => {
  it("keeps attachedTo, non-interrupting and the spot on the border", async () => {
    const model: CanvasModel = {
      nodes: [
        { id: "sub", shape: "bpmn-task", x: 820, y: 760, width: 120, height: 80, label: "Nhắc 2h · 8h · 20h theo thẻ" },
        { id: "evt", shape: "bpmn-event-intermediate", x: 862, y: 822, width: 36, height: 36, label: "Im 2h",
          attrs: { trigger: "timer", attachedTo: "sub", interrupting: false } },
      ],
      edges: [],
    } as unknown as CanvasModel;
    const xml = await exportBpmn(model);
    expect(xml).toMatch(/<bpmn:boundaryEvent id="evt"[^>]*cancelActivity="false"[^>]*attachedToRef="sub"|<bpmn:boundaryEvent id="evt"[^>]*attachedToRef="sub"[^>]*cancelActivity="false"/);
    const { model: back } = await importBpmn(xml);
    const e = back.nodes.find((n) => n.id === "evt")!;
    expect(e.attrs?.attachedTo).toBe("sub");
    expect(e.attrs?.interrupting).toBe(false);
    expect({ x: e.x, y: e.y }).toEqual({ x: 862, y: 822 });
  });
});

describe("static render (embed card / export)", () => {
  // repro from the to-be board: event listed BEFORE its host, on the top edge
  const model: CanvasModel = {
    nodes: [
      { id: "evt", shape: "bpmn-event-intermediate", x: 862, y: 742, width: 36, height: 36, label: "Khách nhắn khi đang nhắc",
        attrs: { trigger: "message", attachedTo: "sub", interrupting: true } },
      { id: "sub", shape: "bpmn-task", x: 820, y: 760, width: 120, height: 80, label: "Nhắc 2h · 8h · 20h theo thẻ",
        attrs: { markers: ["subprocess"], collapsed: true } },
    ],
    edges: [],
  } as unknown as CanvasModel;

  it("paints a boundary event above its host and its label outside the host", () => {
    const html = renderModelToCard(model);
    const iHost = html.indexOf("Nhắc 2h");
    const iEvt = html.indexOf("Khách nhắn khi đang nhắc");
    expect(iHost).toBeGreaterThan(-1);
    expect(iEvt).toBeGreaterThan(iHost);
    expect(html).toMatch(/bp-event inter label-top/);
  });
});
