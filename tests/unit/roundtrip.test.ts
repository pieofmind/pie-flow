import { describe, it, expect } from "vitest";
import {
  parseFlowchart,
  serializeFlowchart,
  emptyFlowchart,
} from "../../src/adapters/flowchart/model";
import type { CanvasModel } from "../../src/canvas/types";

/**
 * Round-trip tests for the board persistence format.
 *
 * A `.board` file is `JSON.stringify(CanvasModel, null, 2)` and is read back
 * with `JSON.parse` (see BoardView.getViewData / setViewData). The flowchart
 * adapter's `serialize`/`parse` use exactly that format, so testing them is
 * equivalent to testing board save/load — without needing X6 or a DOM.
 *
 * Acceptance (spec §10.2): parse(serialize(model)) === model for ≥10 samples
 * per diagram type, no data loss, coordinates/metadata preserved.
 */

type N = CanvasModel["nodes"][number];
type E = CanvasModel["edges"][number];

const roundTrip = (m: CanvasModel): CanvasModel =>
  parseFlowchart(serializeFlowchart(m));

// ── Hand-crafted samples covering every diagram family + its extras ──────────
const SAMPLES: Record<string, CanvasModel> = {
  flowchart: {
    nodes: [
      { id: "s", shape: "fc-start", x: 40, y: 20, width: 120, height: 52, label: "Bắt đầu" },
      { id: "d", shape: "fc-decision", x: 40, y: 120, width: 150, height: 88, label: "Hợp lệ?" },
      { id: "e", shape: "fc-end", x: 40, y: 260, width: 120, height: 52, label: "Kết thúc" },
    ],
    edges: [
      { id: "e1", source: "s", sourcePort: "bottom", target: "d", targetPort: "top" },
      { id: "e2", source: "d", sourcePort: "bottom", target: "e", targetPort: "top", label: "Có" },
    ],
  },

  erd: {
    nodes: [
      {
        id: "users", shape: "erd-entity", x: 100, y: 80, width: 210, height: 178, label: "users",
        attrs: {
          cols: [
            { k: "PK", name: "id", type: "bigint" },
            { k: "FK", name: "team_id", type: "bigint" },
            { k: "", name: "email", type: "varchar" },
          ],
        },
      },
      {
        id: "teams", shape: "erd-entity", x: 460, y: 80, width: 210, height: 110, label: "teams",
        attrs: { cols: [{ k: "PK", name: "id", type: "bigint" }, { k: "", name: "name", type: "varchar" }] },
      },
    ],
    edges: [{ id: "r1", source: "users", sourcePort: "right", target: "teams", targetPort: "left", label: "N — 1" }],
  },

  umlClass: {
    nodes: [
      {
        id: "inv", shape: "uml-class", x: 60, y: 60, width: 230, height: 170, label: "Invoice",
        attrs: {
          fields: ["- id: int", "- total: float"],
          methods: ["+ pay(amount: int): bool", "+ void(): void"],
        },
      },
    ],
    edges: [],
  },

  umlInterface: {
    nodes: [
      {
        id: "pay", shape: "uml-interface", x: 60, y: 60, width: 210, height: 110, label: "Payable",
        attrs: { fields: [], methods: ["+ pay(amount: int): bool"] },
      },
    ],
    edges: [],
  },

  bpmnPool: {
    nodes: [
      {
        id: "pool", shape: "bpmn-pool", x: 0, y: 0, width: 700, height: 280, label: "Bán hàng",
        attrs: {
          lanes: [
            { id: "l1", label: "Sales" },
            { id: "l2", label: "Kế toán" },
          ],
        },
      },
      { id: "st", shape: "bpmn-start", x: 60, y: 60, width: 56, height: 56, label: "Nhận đơn" },
    ],
    edges: [],
  },

  sequence: {
    nodes: [
      { id: "k", shape: "sq-actor", x: 60, y: 20, width: 80, height: 320, label: "Khách" },
      { id: "s", shape: "sq-participant", x: 260, y: 20, width: 120, height: 320, label: "Sales", attrs: { who: "KALIX" } },
    ],
    edges: [
      { id: "m1", source: "k", target: "s", label: "Hỏi giá", y: 80 },
      { id: "m2", source: "s", target: "k", label: "Báo giá", y: 130, ret: true },
    ],
  },

  mindmap: {
    nodes: [
      { id: "r", shape: "mm-root", x: 200, y: 150, width: 140, height: 46, label: "Trung tâm" },
      { id: "b", shape: "mm-branch", x: 420, y: 110, width: 150, height: 42, label: "Nhánh", attrs: { style: { stroke: "#5E8FB9" } } },
      { id: "l", shape: "mm-leaf", x: 620, y: 110, width: 130, height: 38, label: "Lá\nnhiều dòng" },
    ],
    edges: [{ id: "m1", source: "r", sourcePort: "right", target: "b", targetPort: "left" }],
  },

  state: {
    nodes: [
      { id: "i", shape: "st-initial", x: 40, y: 40, width: 22, height: 22, label: "" },
      { id: "a", shape: "st-state", x: 120, y: 30, width: 120, height: 48, label: "Draft" },
      { id: "f", shape: "st-final", x: 300, y: 40, width: 24, height: 24, label: "" },
    ],
    edges: [
      { id: "t1", source: "i", target: "a" },
      { id: "t2", source: "a", target: "f", label: "approve" },
    ],
  },

  styledEdges: {
    nodes: [
      { id: "a", shape: "bs-rect", x: 0, y: 0, width: 100, height: 60, label: "A" },
      { id: "b", shape: "bs-rect", x: 300, y: 0, width: 100, height: 60, label: "B" },
    ],
    edges: [
      {
        id: "e", source: "a", sourcePort: "right", target: "b", targetPort: "left", label: "rel",
        style: { stroke: "#C99A2E", width: 2, dash: "dashed", start: "circle", end: "triangle-f" },
        vertices: [{ x: 150, y: 90 }, { x: 220, y: 90 }],
        labelPos: { distance: 0.5, offset: { x: 0, y: -10 } },
      },
    ],
  },

  styledNodes: {
    nodes: [
      {
        id: "n", shape: "bs-rounded", x: 10, y: 10, width: 160, height: 70, label: "Tô màu",
        attrs: {
          style: { fill: "#FDE8C9", stroke: "#C2603F", fontSize: 16, bold: true, italic: true, underline: true, align: "center", borderWidth: 2, borderDash: "dotted", color: "#3B1F1A" },
          labelOffset: { x: 4, y: -6 },
        },
      },
    ],
    edges: [],
  },

  unicodeLabels: {
    nodes: [
      { id: "u", shape: "bs-text", x: 0, y: 0, width: 200, height: 50, label: "Quy <trình> & \"báo giá\" — 日本語 ✅" },
    ],
    edges: [],
  },

  mixedBoard: {
    nodes: [
      { id: "p", shape: "fc-process", x: 40, y: 40, width: 130, height: 56, label: "Xử lý" },
      { id: "t", shape: "erd-entity", x: 250, y: 40, width: 200, height: 110, label: "orders", attrs: { cols: [{ k: "PK", name: "id", type: "int" }, { k: "", name: "qty", type: "int" }] } },
      { id: "c", shape: "uml-class", x: 520, y: 40, width: 210, height: 130, label: "Svc", attrs: { fields: ["- x: int"], methods: ["+ run(): void"] } },
    ],
    edges: [{ id: "e1", source: "p", sourcePort: "right", target: "t", targetPort: "left", label: "uses" }],
  },
};

describe("CanvasModel round-trip — hand-crafted samples", () => {
  for (const [name, model] of Object.entries(SAMPLES)) {
    it(`preserves "${name}" through parse(serialize(model))`, () => {
      expect(roundTrip(model)).toEqual(model);
    });

    it(`is idempotent for "${name}"`, () => {
      const once = serializeFlowchart(model);
      const twice = serializeFlowchart(parseFlowchart(once));
      expect(twice).toBe(once);
    });
  }
});

// ── ≥10 generated variants per diagram family (spec §10.2) ───────────────────
const FAMILIES: Array<{ family: string; make: (i: number) => N }> = [
  { family: "flowchart", make: (i) => ({ id: `fc${i}`, shape: "fc-process", x: i * 40, y: i * 25, width: 120 + i, height: 56, label: `Bước ${i}` }) },
  { family: "erd", make: (i) => ({ id: `erd${i}`, shape: "erd-entity", x: i * 30, y: i * 30, width: 200, height: 120, label: `t_${i}`, attrs: { cols: [{ k: i % 2 ? "PK" : "FK", name: `c${i}`, type: "int" }] } }) },
  { family: "uml", make: (i) => ({ id: `uml${i}`, shape: i % 2 ? "uml-class" : "uml-interface", x: i, y: i, width: 200, height: 140, label: `C${i}`, attrs: { fields: [`- f${i}: int`], methods: [`+ m${i}(): void`] } }) },
  { family: "bpmn", make: (i) => ({ id: `bp${i}`, shape: "bpmn-task-user", x: i * 10, y: i * 10, width: 130, height: 80, label: `Task ${i}` }) },
  { family: "sequence", make: (i) => ({ id: `sq${i}`, shape: "sq-participant", x: i * 120, y: 0, width: 110, height: 300, label: `P${i}`, attrs: { who: `W${i}` } }) },
  { family: "mindmap", make: (i) => ({ id: `mm${i}`, shape: "mm-branch", x: i * 50, y: i * 40, width: 150, height: 42, label: `Nhánh ${i}`, attrs: { style: { stroke: "#5E8FB9" } } }) },
  { family: "state", make: (i) => ({ id: `st${i}`, shape: "st-state", x: i * 40, y: 0, width: 120, height: 48, label: `S${i}` }) },
];

describe("CanvasModel round-trip — 10 generated variants per family", () => {
  for (const { family, make } of FAMILIES) {
    it(`round-trips 10 ${family} variants`, () => {
      for (let count = 1; count <= 10; count++) {
        // A model with `count` chained nodes (edges reference real node ids).
        const nodes = Array.from({ length: count }, (_, k) => make(k));
        const edges: E[] = nodes.slice(1).map((n, k) => ({
          id: `e${k}`, source: nodes[k].id, target: n.id, label: `→${k + 1}`,
        }));
        const model: CanvasModel = { nodes, edges };
        expect(roundTrip(model)).toEqual(model);
      }
    });
  }
});

// ── Metadata preservation ────────────────────────────────────────────────────
describe("metadata is preserved exactly", () => {
  it("keeps node coordinates, size and attrs", () => {
    const out = roundTrip(SAMPLES.styledNodes);
    const n = out.nodes[0];
    expect({ x: n.x, y: n.y, width: n.width, height: n.height }).toEqual({ x: 10, y: 10, width: 160, height: 70 });
    expect(n.attrs).toEqual(SAMPLES.styledNodes.nodes[0].attrs);
  });

  it("keeps edge style, vertices and labelPos", () => {
    const out = roundTrip(SAMPLES.styledEdges);
    expect(out.edges[0]).toEqual(SAMPLES.styledEdges.edges[0]);
  });

  it("keeps ERD column keys (PK/FK/empty) in order", () => {
    const out = roundTrip(SAMPLES.erd);
    expect(out.nodes[0].attrs!.cols).toEqual([
      { k: "PK", name: "id", type: "bigint" },
      { k: "FK", name: "team_id", type: "bigint" },
      { k: "", name: "email", type: "varchar" },
    ]);
  });

  it("keeps sequence edge timing (y) and return flag (ret)", () => {
    const out = roundTrip(SAMPLES.sequence);
    expect(out.edges.map((e) => ({ y: e.y, ret: e.ret }))).toEqual([
      { y: 80, ret: undefined },
      { y: 130, ret: true },
    ]);
  });

  it("preserves special characters in labels verbatim", () => {
    const out = roundTrip(SAMPLES.unicodeLabels);
    expect(out.nodes[0].label).toBe('Quy <trình> & "báo giá" — 日本語 ✅');
  });

  it("preserves multi-line labels", () => {
    const out = roundTrip(SAMPLES.mindmap);
    expect(out.nodes[2].label).toBe("Lá\nnhiều dòng");
  });
});

// ── Robustness: malformed input must not throw or swallow into garbage ────────
describe("parse robustness", () => {
  it("returns an empty model for invalid JSON (no throw)", () => {
    expect(parseFlowchart("not json {{{")).toEqual({ nodes: [], edges: [] });
  });

  it("returns an empty model for an empty / whitespace source", () => {
    expect(parseFlowchart("")).toEqual({ nodes: [], edges: [] });
    expect(parseFlowchart("   \n  ")).toEqual({ nodes: [], edges: [] });
  });

  it("rejects JSON that is not a CanvasModel (missing arrays)", () => {
    expect(parseFlowchart('{"foo":1}')).toEqual({ nodes: [], edges: [] });
    expect(parseFlowchart('{"nodes":[]}')).toEqual({ nodes: [], edges: [] });
    expect(parseFlowchart("[1,2,3]")).toEqual({ nodes: [], edges: [] });
  });

  it("round-trips the empty board template", () => {
    const m = parseFlowchart(emptyFlowchart());
    expect(roundTrip(m)).toEqual(m);
    expect(m.nodes.length).toBeGreaterThan(0);
  });

  it("round-trips a fully empty model", () => {
    const empty: CanvasModel = { nodes: [], edges: [] };
    expect(roundTrip(empty)).toEqual(empty);
  });
});
