import { describe, expect, it } from "vitest";
import { boardOutline } from "./boardSidePanel";
import type { CanvasModel } from "../canvas/types";

const n = (id: string, x: number, extra: Partial<CanvasModel["nodes"][number]> = {}) =>
  ({ id, shape: "bpmn-task", label: id, x, y: 0, width: 80, height: 40, ...extra }) as CanvasModel["nodes"][number];

describe("boardOutline", () => {
  it("lists pools → lanes → steps left to right, black-box pools noted, loose nodes last", () => {
    const model = {
      nodes: [
        n("pool", 0, { shape: "bpmn-pool", label: "KALIX", attrs: { lanes: [{ id: "l1", label: "Trực page" }] } }),
        n("bb", 0, { shape: "bpmn-pool", label: "Khách" }),
        n("b", 300, { laneId: "l1" }),
        n("a", 100, { laneId: "l1" }),
        n("note", 50, { shape: "bpmn-annotation", laneId: "l1" }),
        n("inner", 120, { laneId: "l1", parentId: "a" }),
        n("free", 10),
      ],
      edges: [],
    } as CanvasModel;
    const out = boardOutline(model);
    expect(out.map((g) => g.title)).toEqual(["KALIX", "Khách", "Ngoài pool"]);
    expect(out[0].lanes[0].nodes.map((x) => x.id)).toEqual(["a", "b"]);
    expect(out[1].note).toBe("Hộp đen · chỉ trao đổi tin");
    expect(out[2].lanes[0].nodes.map((x) => x.id)).toEqual(["free"]);
  });
});
