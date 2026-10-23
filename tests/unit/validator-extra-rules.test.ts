import { describe, expect, it } from "vitest";
import type { CanvasModel } from "../../src/canvas/types";
import { validateBpmnModel } from "../../src/io/bpmn/validator";

const n = (id: string, shape: string, extra: Partial<CanvasModel["nodes"][number]> = {}) =>
  ({ id, shape, x: 0, y: 0, width: 100, height: 60, label: id, ...extra }) as CanvasModel["nodes"][number];
const f = (id: string, source: string, target: string, kind?: "message" | "association") =>
  ({ id, source, target, ...(kind ? { kind } : {}) }) as CanvasModel["edges"][number];
const codes = (m: CanvasModel, code: string) => validateBpmnModel(m).filter((i) => i.code === code).map((i) => i.targetId).sort();

describe("UNREACHABLE_NODE", () => {
  it("flags a flow node no start event leads to, and a chain cut off from the start", () => {
    const m: CanvasModel = {
      nodes: [n("s", "bpmn-event-start"), n("a", "bpmn-task"), n("e", "bpmn-event-end"), n("x", "bpmn-task"), n("y", "bpmn-task"), n("alone", "bpmn-task")],
      edges: [f("1", "s", "a"), f("2", "a", "e"), f("3", "x", "y")],
    };
    expect(codes(m, "UNREACHABLE_NODE")).toEqual(["alone", "x", "y"]);
  });
  it("counts boundary events, link catch events and message flows' ends as entry points", () => {
    const m: CanvasModel = {
      nodes: [
        n("s", "bpmn-event-start"), n("host", "bpmn-task"), n("b", "bpmn-event-intermediate", { attrs: { attachedTo: "host", trigger: "timer" } }),
        n("afterB", "bpmn-task"), n("lk", "bpmn-event-intermediate", { attrs: { trigger: "link" } }), n("afterLk", "bpmn-task"),
      ],
      edges: [f("1", "s", "host"), f("2", "b", "afterB"), f("3", "lk", "afterLk")],
    };
    expect(codes(m, "UNREACHABLE_NODE")).toEqual([]);
  });
  it("does not flag artifacts, pools, lanes or tasks in an ad-hoc sub-process, nor anything when the scope has no start", () => {
    const m: CanvasModel = {
      nodes: [
        n("s", "bpmn-event-start"), n("a", "bpmn-task"), n("d", "bpmn-data-object"), n("t", "bpmn-text-annotation"), n("p", "bpmn-pool"), n("l", "bpmn-lane"),
        n("ah", "bpmn-adhoc-subprocess"), n("in1", "bpmn-task", { parentId: "ah" }),
      ],
      edges: [f("1", "s", "a"), f("2", "a", "ah")],
    };
    expect(codes(m, "UNREACHABLE_NODE")).toEqual([]);
    const noStart: CanvasModel = { nodes: [n("a", "bpmn-task")], edges: [] };
    expect(codes(noStart, "UNREACHABLE_NODE")).toEqual([]);
  });
  it("checks each sub-process on its own: a step cut off from the inner start is flagged", () => {
    const m: CanvasModel = {
      nodes: [
        n("s", "bpmn-event-start"), n("sp", "bpmn-subprocess"),
        n("is", "bpmn-event-start", { parentId: "sp" }), n("i1", "bpmn-task", { parentId: "sp" }), n("i2", "bpmn-task", { parentId: "sp" }),
      ],
      edges: [f("1", "s", "sp"), f("2", "is", "i1")],
    };
    expect(codes(m, "UNREACHABLE_NODE")).toEqual(["i2"]);
  });
});

describe("GATEWAY_PAIR_MISMATCH", () => {
  const split = (type: string, join: string): CanvasModel => ({
    nodes: [n("s", "bpmn-event-start"), n("g1", type), n("a", "bpmn-task"), n("b", "bpmn-task"), n("g2", join), n("e", "bpmn-event-end")],
    edges: [f("1", "s", "g1"), f("2", "g1", "a"), f("3", "g1", "b"), f("4", "a", "g2"), f("5", "b", "g2"), f("6", "g2", "e")],
  });
  it("flags a parallel split closed by an exclusive join and the other way round", () => {
    expect(codes(split("bpmn-gateway-parallel", "bpmn-gateway-x"), "GATEWAY_PAIR_MISMATCH")).toEqual(["g1", "g2"]);
    expect(codes(split("bpmn-gateway-x", "bpmn-gateway-parallel"), "GATEWAY_PAIR_MISMATCH")).toEqual(["g1", "g2"]);
  });
  it("accepts matching pairs, an inclusive join, and an event-based split into an exclusive join", () => {
    expect(codes(split("bpmn-gateway-parallel", "bpmn-gateway-parallel"), "GATEWAY_PAIR_MISMATCH")).toEqual([]);
    expect(codes(split("bpmn-gateway-x", "bpmn-gateway-x"), "GATEWAY_PAIR_MISMATCH")).toEqual([]);
    expect(codes(split("bpmn-gateway-x", "bpmn-gateway-inclusive"), "GATEWAY_PAIR_MISMATCH")).toEqual([]);
    expect(codes(split("bpmn-gateway-event", "bpmn-gateway-x"), "GATEWAY_PAIR_MISMATCH")).toEqual([]);
  });
  it("accepts a split whose branches never meet again", () => {
    const m: CanvasModel = {
      nodes: [n("s", "bpmn-event-start"), n("g", "bpmn-gateway-parallel"), n("a", "bpmn-event-end"), n("b", "bpmn-event-end")],
      edges: [f("1", "s", "g"), f("2", "g", "a"), f("3", "g", "b")],
    };
    expect(codes(m, "GATEWAY_PAIR_MISMATCH")).toEqual([]);
  });
});

describe("UNNAMED_ELEMENT", () => {
  it("flags tasks, sub-processes, exclusive splits and call activities without a name", () => {
    const m: CanvasModel = {
      nodes: [
        n("t", "bpmn-task", { label: "" }), n("u", "bpmn-task-user", { label: "  " }), n("sp", "bpmn-subprocess", { label: "" }),
        n("ca", "bpmn-call-activity", { label: "" }), n("ok", "bpmn-task", { label: "Có tên" }),
        n("g", "bpmn-gateway-x", { label: "" }),
      ],
      edges: [f("1", "g", "ok"), f("2", "g", "t")],
    };
    expect(codes(m, "UNNAMED_ELEMENT")).toEqual(["ca", "g", "sp", "t", "u"]);
  });
  it("leaves events, joins, parallel gateways, artifacts and lanes alone", () => {
    const m: CanvasModel = {
      nodes: [
        n("s", "bpmn-event-start", { label: "" }), n("gp", "bpmn-gateway-parallel", { label: "" }), n("d", "bpmn-data-object", { label: "" }),
        n("j", "bpmn-gateway-x", { label: "" }), n("l", "bpmn-lane", { label: "" }),
        n("a", "bpmn-task", { label: "A" }), n("b", "bpmn-task", { label: "B" }),
      ],
      edges: [f("1", "a", "j"), f("2", "b", "j"), f("3", "j", "s")],
    };
    expect(codes(m, "UNNAMED_ELEMENT")).toEqual([]);
  });
});
