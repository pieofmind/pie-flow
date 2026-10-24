import { describe, it, expect } from "vitest";
import {
  parseFlowchart,
  serializeFlowchart,
  emptyFlowchart,
} from "../../src/adapters/flowchart/model";
import type { CanvasModel } from "../../src/canvas/types";
import { importBpmn } from "../../src/io/bpmn/import";
import { exportBpmn } from "../../src/io/bpmn/export";

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

// ── Đợt F+G: BPMN 2.0 extras (trigger / throwing / interrupting / attachedTo / markers / flowType) ──
describe("BPMN 2.0 extras round-trip (Đợt A→F)", () => {
  it("preserves event trigger + throwing through serialize→parse", () => {
    const m: CanvasModel = {
      nodes: [
        { id: "s1", shape: "bpmn-event-start", x: 0, y: 0, width: 40, height: 40, label: "",
          attrs: { trigger: "message" } },
        { id: "i1", shape: "bpmn-event-intermediate", x: 100, y: 0, width: 40, height: 40, label: "",
          attrs: { trigger: "timer", throwing: true } },
        { id: "e1", shape: "bpmn-event-end", x: 200, y: 0, width: 40, height: 40, label: "",
          attrs: { trigger: "terminate" } },
      ],
      edges: [],
    };
    expect(roundTrip(m)).toEqual(m);
  });

  it("preserves 12 OMG event triggers (incl. signal/error/escalation/compensation/conditional/link/cancel/multiple/parallel-multiple)", () => {
    const triggers = [
      "message", "timer", "signal", "error", "escalation", "compensation",
      "conditional", "link", "cancel", "terminate", "multiple", "parallel-multiple",
    ] as const;
    const m: CanvasModel = {
      nodes: triggers.map((t, i) => ({
        id: `evt-${i}`, shape: "bpmn-event-intermediate",
        x: i * 60, y: 0, width: 40, height: 40, label: t,
        attrs: { trigger: t },
      })),
      edges: [],
    };
    const r = roundTrip(m);
    for (let i = 0; i < triggers.length; i++) {
      expect((r.nodes[i].attrs as Record<string, unknown>).trigger).toBe(triggers[i]);
    }
  });

  it("preserves activity markers (multi-select)", () => {
    const m: CanvasModel = {
      nodes: [
        { id: "t1", shape: "bpmn-task-user", x: 0, y: 0, width: 120, height: 60, label: "Review",
          attrs: { markers: ["loop", "compensation"] } },
        { id: "t2", shape: "bpmn-subprocess", x: 200, y: 0, width: 200, height: 120, label: "Loop sub",
          attrs: { markers: ["mi-par"] } },
        { id: "t3", shape: "bpmn-task-service", x: 0, y: 200, width: 120, height: 60, label: "Seq",
          attrs: { markers: ["mi-seq", "adhoc"] } },
      ],
      edges: [],
    };
    expect(roundTrip(m)).toEqual(m);
  });

  it("preserves interrupting flag + boundary attachment", () => {
    const m: CanvasModel = {
      nodes: [
        { id: "task", shape: "bpmn-task", x: 0, y: 0, width: 120, height: 60, label: "Pay" },
        { id: "boundary", shape: "bpmn-event-intermediate", x: 100, y: 50, width: 36, height: 36, label: "",
          attrs: { trigger: "timer", attachedTo: "task", interrupting: false } },
      ],
      edges: [],
    };
    expect(roundTrip(m)).toEqual(m);
  });

  it("preserves edge flowType + preset (default/message/conditional/association)", () => {
    const m: CanvasModel = {
      nodes: [
        { id: "a", shape: "bpmn-task", x: 0, y: 0, width: 120, height: 60, label: "A" },
        { id: "b", shape: "bpmn-task", x: 200, y: 0, width: 120, height: 60, label: "B" },
      ],
      edges: [
        { id: "f1", source: "a", target: "b",
          style: { flowType: "default", dash: "solid", start: "def-slash", end: "arrow" } },
        { id: "f2", source: "a", target: "b",
          style: { flowType: "message", dash: "dashed", start: "circle", end: "triangle" } },
        { id: "f3", source: "a", target: "b",
          style: { flowType: "conditional", dash: "solid", start: "diamond-o", end: "arrow" } },
        { id: "f4", source: "a", target: "b",
          style: { flowType: "association", dash: "dotted", start: "none", end: "arrow-open" } },
      ],
    };
    const r = roundTrip(m);
    for (let i = 0; i < m.edges.length; i++) {
      expect(r.edges[i].style?.flowType).toBe(m.edges[i].style?.flowType);
      expect(r.edges[i].style?.start).toBe(m.edges[i].style?.start);
      expect(r.edges[i].style?.end).toBe(m.edges[i].style?.end);
    }
  });

  it("preserves the 3 new Activity kinds + Group + 3 new Data artifacts", () => {
    const kinds = [
      "bpmn-transaction", "bpmn-event-subprocess", "bpmn-call-activity",
      "bpmn-group", "bpmn-data-collection", "bpmn-data-input", "bpmn-data-output",
    ];
    const m: CanvasModel = {
      nodes: kinds.map((k, i) => ({
        id: `k${i}`, shape: k, x: i * 220, y: 0, width: 160, height: 80, label: k,
      })),
      edges: [],
    };
    const r = roundTrip(m);
    for (let i = 0; i < kinds.length; i++) {
      expect(r.nodes[i].shape).toBe(kinds[i]);
    }
  });
});

// ── Phase A: BPMN edge types (MessageFlow / Association / conditional / default) ──
describe("BPMN edge kinds — import + export round-trip", () => {
  /** Minimal BPMN doc with a SequenceFlow carrying conditionExpression and
   *  a separate default flow. The source gateway points at the default edge. */
  const COND_DEFAULT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="d" targetNamespace="x">
  <bpmn:process id="P" isExecutable="false">
    <bpmn:exclusiveGateway id="g" default="f_def" name="ok?"/>
    <bpmn:task id="t1" name="Yes"/>
    <bpmn:task id="t2" name="No"/>
    <bpmn:sequenceFlow id="f_cond" sourceRef="g" targetRef="t1">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\${ok == true}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="f_def" sourceRef="g" targetRef="t2"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="dia">
    <bpmndi:BPMNPlane id="pl" bpmnElement="P">
      <bpmndi:BPMNShape id="g_di" bpmnElement="g"><dc:Bounds x="100" y="100" width="50" height="50"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="t1_di" bpmnElement="t1"><dc:Bounds x="220" y="40" width="100" height="60"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="t2_di" bpmnElement="t2"><dc:Bounds x="220" y="160" width="100" height="60"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="f_cond_di" bpmnElement="f_cond">
        <dc:Point xmlns:di="http://www.omg.org/spec/DD/20100524/DI" x="150" y="120"/>
        <dc:Point x="220" y="70"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="f_def_di" bpmnElement="f_def">
        <dc:Point x="150" y="130"/>
        <dc:Point x="220" y="190"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

  /** Collaboration with two pools and a MessageFlow between tasks. */
  const MESSAGE_FLOW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="d" targetNamespace="x">
  <bpmn:collaboration id="C">
    <bpmn:participant id="pA" name="A" processRef="PA"/>
    <bpmn:participant id="pB" name="B" processRef="PB"/>
    <bpmn:messageFlow id="mf1" name="Order" sourceRef="tA" targetRef="tB"/>
  </bpmn:collaboration>
  <bpmn:process id="PA" isExecutable="false"><bpmn:task id="tA" name="Send"/></bpmn:process>
  <bpmn:process id="PB" isExecutable="false"><bpmn:task id="tB" name="Receive"/></bpmn:process>
  <bpmndi:BPMNDiagram id="dia">
    <bpmndi:BPMNPlane id="pl" bpmnElement="C">
      <bpmndi:BPMNShape id="pA_di" bpmnElement="pA" isHorizontal="true"><dc:Bounds x="0" y="0" width="600" height="120"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="pB_di" bpmnElement="pB" isHorizontal="true"><dc:Bounds x="0" y="160" width="600" height="120"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="tA_di" bpmnElement="tA"><dc:Bounds x="100" y="30" width="100" height="60"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="tB_di" bpmnElement="tB"><dc:Bounds x="100" y="190" width="100" height="60"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="mf1_di" bpmnElement="mf1">
        <dc:Point x="150" y="90"/>
        <dc:Point x="150" y="190"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

  /** Association between a TextAnnotation and a task. */
  const ASSOCIATION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="d" targetNamespace="x">
  <bpmn:process id="P" isExecutable="false">
    <bpmn:task id="t" name="Pay"/>
    <bpmn:textAnnotation id="an"><bpmn:text>Note</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="as" sourceRef="an" targetRef="t" associationDirection="One"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="dia">
    <bpmndi:BPMNPlane id="pl" bpmnElement="P">
      <bpmndi:BPMNShape id="t_di" bpmnElement="t"><dc:Bounds x="200" y="100" width="100" height="60"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="an_di" bpmnElement="an"><dc:Bounds x="50" y="50" width="100" height="40"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="as_di" bpmnElement="as">
        <dc:Point x="100" y="90"/>
        <dc:Point x="200" y="130"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

  it("imports conditionExpression body into edge.attrs.condition", async () => {
    const { model } = await importBpmn(COND_DEFAULT_XML);
    const cond = model.edges.find((e) => e.id === "f_cond");
    expect(cond).toBeDefined();
    expect(cond!.attrs?.condition).toMatch(/ok == true/);
    expect(cond!.kind ?? "sequence").toBe("sequence");
  });

  it("imports default attribute into edge.attrs.isDefault on the right edge", async () => {
    const { model } = await importBpmn(COND_DEFAULT_XML);
    const def = model.edges.find((e) => e.id === "f_def");
    const cond = model.edges.find((e) => e.id === "f_cond");
    expect(def?.attrs?.isDefault).toBe(true);
    expect(cond?.attrs?.isDefault).toBeFalsy();
  });

  it("imports bpmn:MessageFlow as edge.kind='message'", async () => {
    const { model } = await importBpmn(MESSAGE_FLOW_XML);
    const mf = model.edges.find((e) => e.id === "mf1");
    expect(mf).toBeDefined();
    expect(mf!.kind).toBe("message");
    expect(mf!.source).toBe("tA");
    expect(mf!.target).toBe("tB");
  });

  it("imports bpmn:Association as edge.kind='association' with direction", async () => {
    const { model } = await importBpmn(ASSOCIATION_XML);
    const as = model.edges.find((e) => e.id === "as");
    expect(as).toBeDefined();
    expect(as!.kind).toBe("association");
    expect(as!.attrs?.associationDirection).toBe("One");
  });

  it("exports conditionExpression body in round-trip", async () => {
    const { model, sourceMeta } = await importBpmn(COND_DEFAULT_XML);
    const xml = await exportBpmn(model, sourceMeta);
    expect(xml).toMatch(/<bpmn:conditionExpression[\s\S]*ok == true[\s\S]*<\/bpmn:conditionExpression>/);
  });

  it("exports default attribute on the source gateway in round-trip", async () => {
    const { model, sourceMeta } = await importBpmn(COND_DEFAULT_XML);
    const xml = await exportBpmn(model, sourceMeta);
    expect(xml).toMatch(/<bpmn:exclusiveGateway[^>]*default="f_def"/);
  });

  it("exports MessageFlow back into the collaboration in round-trip", async () => {
    const { model, sourceMeta } = await importBpmn(MESSAGE_FLOW_XML);
    const xml = await exportBpmn(model, sourceMeta);
    expect(xml).toMatch(/<bpmn:messageFlow[^>]*id="mf1"[^>]*sourceRef="tA"[^>]*targetRef="tB"/);
  });

  it("exports Association as artifact with associationDirection in round-trip", async () => {
    const { model, sourceMeta } = await importBpmn(ASSOCIATION_XML);
    const xml = await exportBpmn(model, sourceMeta);
    expect(xml).toMatch(/<bpmn:association[^>]*id="as"[^>]*associationDirection="One"/);
  });

  it("emits SequenceFlow + Association + condition + default in MINIMAL path (no sourceMeta)", async () => {
    const model: CanvasModel = {
      nodes: [
        { id: "g", shape: "bpmn-gateway-x", x: 0, y: 0, width: 50, height: 50, label: "ok?" },
        { id: "a", shape: "bpmn-task", x: 100, y: 0, width: 100, height: 60, label: "Y" },
        { id: "b", shape: "bpmn-task", x: 100, y: 100, width: 100, height: 60, label: "N" },
        { id: "an", shape: "bpmn-annotation", x: 250, y: 0, width: 100, height: 40, label: "note" },
      ],
      edges: [
        { id: "c1", source: "g", target: "a", attrs: { condition: "x>0" } },
        { id: "d1", source: "g", target: "b", attrs: { isDefault: true } },
        { id: "as1", source: "an", target: "a", kind: "association", attrs: { associationDirection: "Both" } },
      ],
    };
    const xml = await exportBpmn(model, null);
    expect(xml).toMatch(/<bpmn:conditionExpression[\s\S]*x&gt;0[\s\S]*<\/bpmn:conditionExpression>/);
    expect(xml).toMatch(/default="d1"/);
    expect(xml).toMatch(/<bpmn:association[^>]*id="as1"[^>]*associationDirection="Both"/);
  });

  // ── Phase B: subprocess containment + lane membership ──
  const NESTED_SUBPROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="d" targetNamespace="x">
  <bpmn:process id="P">
    <bpmn:task id="outer"/>
    <bpmn:subProcess id="sp1" name="Sub">
      <bpmn:task id="inner1"/>
      <bpmn:subProcess id="sp2" name="Deeper">
        <bpmn:task id="inner2"/>
      </bpmn:subProcess>
    </bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="P">
    <bpmndi:BPMNShape bpmnElement="outer"><dc:Bounds x="50" y="50" width="100" height="60"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="sp1" isExpanded="true"><dc:Bounds x="200" y="50" width="400" height="200"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="inner1"><dc:Bounds x="240" y="100" width="100" height="60"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="sp2" isExpanded="true"><dc:Bounds x="380" y="100" width="200" height="120"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="inner2"><dc:Bounds x="420" y="140" width="100" height="60"/></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;

  const LANE_MEMBERSHIP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="d" targetNamespace="x">
  <bpmn:collaboration id="C"><bpmn:participant id="pool1" processRef="P"/></bpmn:collaboration>
  <bpmn:process id="P">
    <bpmn:laneSet>
      <bpmn:lane id="L1" name="Customer"><bpmn:flowNodeRef>t1</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="L2" name="Vendor"><bpmn:flowNodeRef>t2</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:task id="t1"/>
    <bpmn:task id="t2"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="C">
    <bpmndi:BPMNShape bpmnElement="pool1" isHorizontal="true"><dc:Bounds x="0" y="0" width="600" height="300"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="L1" isHorizontal="true"><dc:Bounds x="40" y="0" width="560" height="150"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="L2" isHorizontal="true"><dc:Bounds x="40" y="150" width="560" height="150"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="t1"><dc:Bounds x="100" y="50" width="100" height="60"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape bpmnElement="t2"><dc:Bounds x="100" y="200" width="100" height="60"/></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;

  it("imports nested subprocess children with parentId (2 levels)", async () => {
    const { model } = await importBpmn(NESTED_SUBPROCESS_XML);
    const outer = model.nodes.find(n => n.id === "outer");
    const sp1 = model.nodes.find(n => n.id === "sp1");
    const inner1 = model.nodes.find(n => n.id === "inner1");
    const sp2 = model.nodes.find(n => n.id === "sp2");
    const inner2 = model.nodes.find(n => n.id === "inner2");
    expect(outer?.parentId).toBeUndefined();
    expect(sp1?.parentId).toBeUndefined();
    expect(inner1?.parentId).toBe("sp1");
    expect(sp2?.parentId).toBe("sp1");
    expect(inner2?.parentId).toBe("sp2");
  });

  it("round-trips nested subprocess — inner1/inner2 nested back into sp1/sp2 in XML", async () => {
    const { model, sourceMeta } = await importBpmn(NESTED_SUBPROCESS_XML);
    const xml = await exportBpmn(model, sourceMeta);
    // Re-parse to inspect structure.
    const r2 = await importBpmn(xml);
    expect(r2.model.nodes.find(n => n.id === "inner1")?.parentId).toBe("sp1");
    expect(r2.model.nodes.find(n => n.id === "inner2")?.parentId).toBe("sp2");
    expect(r2.model.nodes.find(n => n.id === "sp2")?.parentId).toBe("sp1");
  });

  it("imports lane.flowNodeRef → node.laneId", async () => {
    const { model } = await importBpmn(LANE_MEMBERSHIP_XML);
    expect(model.nodes.find(n => n.id === "t1")?.laneId).toBe("L1");
    expect(model.nodes.find(n => n.id === "t2")?.laneId).toBe("L2");
  });

  it("round-trips lane membership — flowNodeRef rebuilt from laneId", async () => {
    const { model, sourceMeta } = await importBpmn(LANE_MEMBERSHIP_XML);
    // User swaps lane membership: move t1 to L2, t2 to L1.
    model.nodes.find(n => n.id === "t1")!.laneId = "L2";
    model.nodes.find(n => n.id === "t2")!.laneId = "L1";
    const xml = await exportBpmn(model, sourceMeta);
    // L1 should now contain t2; L2 should contain t1. Use a permissive regex
    // since the XML may wrap with whitespace/attributes.
    const l1Section = xml.match(/<bpmn:lane[^>]*id="L1"[\s\S]*?<\/bpmn:lane>/)?.[0] ?? "";
    const l2Section = xml.match(/<bpmn:lane[^>]*id="L2"[\s\S]*?<\/bpmn:lane>/)?.[0] ?? "";
    expect(l1Section).toMatch(/flowNodeRef[^>]*>\s*t2\s*</);
    expect(l2Section).toMatch(/flowNodeRef[^>]*>\s*t1\s*</);
  });

  it("relocates a node from subprocess to top-level on parentId change (round-trip)", async () => {
    const { model, sourceMeta } = await importBpmn(NESTED_SUBPROCESS_XML);
    // User drags inner1 out of sp1 to top level.
    model.nodes.find(n => n.id === "inner1")!.parentId = undefined;
    const xml = await exportBpmn(model, sourceMeta);
    const r2 = await importBpmn(xml);
    expect(r2.model.nodes.find(n => n.id === "inner1")?.parentId).toBeUndefined();
    // sp2 + inner2 still nested.
    expect(r2.model.nodes.find(n => n.id === "inner2")?.parentId).toBe("sp2");
  });

  it("minimal-path export nests children based on parentId (cold export)", async () => {
    const model: CanvasModel = {
      nodes: [
        { id: "sp", shape: "bpmn-subprocess", x: 100, y: 50, width: 300, height: 200, label: "Sub" },
        { id: "child", shape: "bpmn-task", x: 140, y: 100, width: 100, height: 60, label: "Inner", parentId: "sp" },
        { id: "outer", shape: "bpmn-task", x: 0, y: 0, width: 100, height: 60, label: "Out" },
      ],
      edges: [],
    };
    const xml = await exportBpmn(model, null);
    // The child <bpmn:task id="child"> must appear INSIDE <bpmn:subProcess id="sp">,
    // NOT directly under bpmn:Process. A regex bounded to the subProcess block proves it.
    const spBlock = xml.match(/<bpmn:subProcess[^>]*id="sp"[\s\S]*?<\/bpmn:subProcess>/)?.[0] ?? "";
    expect(spBlock).toMatch(/id="child"/);
  });

  // ── Phase C: ad-hoc subprocess + isExpanded round-trip ──
  it("imports bpmn:AdHocSubProcess as bpmn-adhoc-subprocess shape", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="d" targetNamespace="x">
  <bpmn:process id="P">
    <bpmn:adHocSubProcess id="ah" name="Brainstorm"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="P">
    <bpmndi:BPMNShape bpmnElement="ah"><dc:Bounds x="50" y="50" width="200" height="120"/></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
    const { model } = await importBpmn(xml);
    const ah = model.nodes.find(n => n.id === "ah");
    expect(ah?.shape).toBe("bpmn-adhoc-subprocess");
  });

  it("exports bpmn-adhoc-subprocess back to bpmn:AdHocSubProcess", async () => {
    const model: CanvasModel = {
      nodes: [{ id: "ah", shape: "bpmn-adhoc-subprocess", x: 0, y: 0, width: 200, height: 120, label: "Brainstorm" }],
      edges: [],
    };
    const xml = await exportBpmn(model, null);
    expect(xml).toMatch(/<bpmn:adHocSubProcess[^>]*id="ah"/);
  });

  it("preserves DI.isExpanded=false → attrs.collapsed=true round-trip", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="d" targetNamespace="x">
  <bpmn:process id="P">
    <bpmn:subProcess id="sp" name="Collapsed"><bpmn:task id="hidden"/></bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="P">
    <bpmndi:BPMNShape bpmnElement="sp" isExpanded="false"><dc:Bounds x="50" y="50" width="120" height="60"/></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
    const { model, sourceMeta } = await importBpmn(xml);
    expect((model.nodes.find(n => n.id === "sp")?.attrs as { collapsed?: boolean }).collapsed).toBe(true);
    const out = await exportBpmn(model, sourceMeta);
    expect(out).toMatch(/<bpmndi:BPMNShape[^>]*bpmnElement="sp"[^>]*isExpanded="false"/);
  });

  it("isExpanded round-trip — toggling collapsed flips DI flag", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="d" targetNamespace="x">
  <bpmn:process id="P"><bpmn:subProcess id="sp"/></bpmn:process>
  <bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="P">
    <bpmndi:BPMNShape bpmnElement="sp" isExpanded="true"><dc:Bounds x="0" y="0" width="200" height="120"/></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
    const { model, sourceMeta } = await importBpmn(xml);
    (model.nodes.find(n => n.id === "sp")!.attrs as Record<string, unknown>).collapsed = true;
    const out = await exportBpmn(model, sourceMeta);
    expect(out).toMatch(/<bpmndi:BPMNShape[^>]*bpmnElement="sp"[^>]*isExpanded="false"/);
  });

  // ── Phase D: documentation + bioc color + camunda extensionElements ──
  const DOC_BIOC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0"
  id="d" targetNamespace="x">
  <bpmn:process id="P">
    <bpmn:task id="t" name="Pay">
      <bpmn:documentation>Process the payment carefully.</bpmn:documentation>
    </bpmn:task>
  </bpmn:process>
  <bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="P">
    <bpmndi:BPMNShape bpmnElement="t" bioc:fill="#bbdefb" bioc:stroke="#1565c0">
      <dc:Bounds x="100" y="100" width="100" height="60"/>
    </bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;

  const CAMUNDA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
  id="d" targetNamespace="x">
  <bpmn:process id="P">
    <bpmn:userTask id="t" name="Review" camunda:assignee="john" camunda:formKey="forms/review">
      <bpmn:extensionElements>
        <camunda:properties>
          <camunda:property name="priority" value="high"/>
        </camunda:properties>
      </bpmn:extensionElements>
    </bpmn:userTask>
  </bpmn:process>
  <bpmndi:BPMNDiagram><bpmndi:BPMNPlane bpmnElement="P">
    <bpmndi:BPMNShape bpmnElement="t"><dc:Bounds x="0" y="0" width="100" height="60"/></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;

  it("imports bpmn:documentation text → node.attrs.bpmnDoc", async () => {
    const { model } = await importBpmn(DOC_BIOC_XML);
    expect((model.nodes.find(n => n.id === "t")?.attrs as Record<string, unknown>).bpmnDoc)
      .toBe("Process the payment carefully.");
  });

  it("imports bioc:fill/stroke as the node's own colour (attrs.style)", async () => {
    const { model } = await importBpmn(DOC_BIOC_XML);
    const a = model.nodes.find(n => n.id === "t")?.attrs as Record<string, unknown>;
    expect(a.style).toEqual({ fill: "#bbdefb", stroke: "#1565c0" });
    expect(a.bpmnFill).toBeUndefined();
  });

  it("exports documentation round-trip — bpmnDoc serialized to <bpmn:documentation>", async () => {
    const { model, sourceMeta } = await importBpmn(DOC_BIOC_XML);
    // User edits the doc
    (model.nodes.find(n => n.id === "t")!.attrs as Record<string, unknown>).bpmnDoc = "Updated doc.";
    const xml = await exportBpmn(model, sourceMeta);
    expect(xml).toMatch(/<bpmn:documentation>Updated doc\.<\/bpmn:documentation>/);
  });

  it("exports bioc color round-trip — the node's style colour lands on BPMNShape", async () => {
    const { model, sourceMeta } = await importBpmn(DOC_BIOC_XML);
    // User changes fill to red, clears the stroke
    (model.nodes.find(n => n.id === "t")!.attrs as Record<string, unknown>).style = { fill: "#ff0000" };
    const xml = await exportBpmn(model, sourceMeta);
    expect(xml).toMatch(/bioc:fill="#ff0000"/);
    expect(xml).not.toMatch(/bioc:stroke=/);
  });

  it("exports the colour of a node drawn on the Board (no DI shape in the file yet)", async () => {
    const { model, sourceMeta } = await importBpmn(DOC_BIOC_XML);
    model.nodes.push({ id: "t2", shape: "bpmn-task", x: 300, y: 100, width: 120, height: 60, label: "New",
      attrs: { style: { fill: "#d6efe0", stroke: "transparent" } } } as never);
    const xml = await exportBpmn(model, sourceMeta);
    expect(xml).toMatch(/bpmnElement="t2"[^>]*bioc:fill="#d6efe0"|bioc:fill="#d6efe0"[^>]*bpmnElement="t2"/);
    expect(xml).not.toMatch(/bioc:stroke="transparent"/);
  });

  it("a board drawn from scratch exports its colours with the bioc namespace", async () => {
    const xml = await exportBpmn({ nodes: [
      { id: "a", shape: "bpmn-task", x: 0, y: 0, width: 120, height: 60, label: "A", attrs: { style: { fill: "#fff3bf" } } },
    ], edges: [] } as never);
    expect(xml).toMatch(/xmlns:bioc="http:\/\/bpmn\.io\/schema\/bpmn\/biocolor\/1\.0"/);
    expect(xml).toMatch(/bioc:fill="#fff3bf"/);
    const { model } = await importBpmn(xml);
    expect((model.nodes.find(n => n.id === "a")?.attrs as { style?: unknown }).style).toEqual({ fill: "#fff3bf" });
  });

  it("clears documentation when bpmnDoc is empty", async () => {
    const { model, sourceMeta } = await importBpmn(DOC_BIOC_XML);
    (model.nodes.find(n => n.id === "t")!.attrs as Record<string, unknown>).bpmnDoc = "";
    const xml = await exportBpmn(model, sourceMeta);
    expect(xml).not.toMatch(/<bpmn:documentation/);
  });

  it("imports camunda:assignee / formKey into node.attrs.camunda", async () => {
    const { model } = await importBpmn(CAMUNDA_XML);
    const a = model.nodes.find(n => n.id === "t")?.attrs as Record<string, unknown>;
    const cam = a.camunda as Record<string, string> | undefined;
    expect(cam?.assignee).toBe("john");
    expect(cam?.formKey).toBe("forms/review");
  });

  it("exports edited Camunda scalar attrs and camunda:property values", async () => {
    const { model, sourceMeta } = await importBpmn(CAMUNDA_XML);
    const attrs = model.nodes.find(n => n.id === "t")!.attrs as Record<string, unknown>;
    attrs.camunda = { assignee: "mary", formKey: "forms/approve" };
    attrs.bpmnProps = [{ name: "priority", value: "urgent" }];
    const xml = await exportBpmn(model, sourceMeta);
    expect(xml).toMatch(/xmlns:camunda="http:\/\/camunda\.org\/schema\/1\.0\/bpmn"/);
    expect(xml).toMatch(/camunda:assignee="mary"/);
    expect(xml).toMatch(/camunda:formKey="forms\/approve"/);
    expect(xml).toMatch(/<camunda:property name="priority" value="urgent" \/>/);
  });

  it("exports new Camunda attrs on a cold minimal BPMN export", async () => {
    const model: CanvasModel = {
      nodes: [{
        id: "t",
        shape: "bpmn-task-user",
        x: 0,
        y: 0,
        width: 120,
        height: 60,
        label: "Review",
        attrs: {
          camunda: { assignee: "john", formKey: "forms/review" },
          bpmnProps: [{ name: "priority", value: "high" }],
        },
      }],
      edges: [],
    };
    const xml = await exportBpmn(model, null);
    expect(xml).toMatch(/<bpmn:userTask[^>]*camunda:assignee="john"[^>]*camunda:formKey="forms\/review"/);
    expect(xml).toMatch(/<bpmn:extensionElements><camunda:properties><camunda:property name="priority" value="high" \/><\/camunda:properties><\/bpmn:extensionElements>/);
  });

  it("strips condition + default when user clears them (re-export drops stale state)", async () => {
    const { model, sourceMeta } = await importBpmn(COND_DEFAULT_XML);
    // User removes both: the conditional flow becomes plain, the default flag is cleared.
    for (const e of model.edges) {
      if (e.attrs) { delete e.attrs.condition; delete e.attrs.isDefault; }
    }
    const xml = await exportBpmn(model, sourceMeta);
    expect(xml).not.toMatch(/<bpmn:conditionExpression/);
    expect(xml).not.toMatch(/default="/);
  });

  it("imports multi-diagram using the richest plane and stores diagramIndex", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="d" targetNamespace="x">
  <bpmn:process id="P"><bpmn:task id="t"/></bpmn:process>
  <bpmndi:BPMNDiagram id="d1"><bpmndi:BPMNPlane bpmnElement="P"></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="d2"><bpmndi:BPMNPlane bpmnElement="P"><bpmndi:BPMNShape bpmnElement="t"><dc:Bounds x="42" y="24" width="120" height="60"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    const { model, sourceMeta } = await importBpmn(xml);
    expect(model.nodes.find((n) => n.id === "t")?.x).toBe(42);
    expect((sourceMeta.payload as { diagramIndex?: number }).diagramIndex).toBe(1);
  });

  it("imports black-box participant with orientation metadata", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  id="d" targetNamespace="x">
  <bpmn:collaboration id="C">
    <bpmn:participant id="p1" name="External Vendor"/>
  </bpmn:collaboration>
  <bpmndi:BPMNDiagram id="d1"><bpmndi:BPMNPlane bpmnElement="C">
    <bpmndi:BPMNShape bpmnElement="p1" isHorizontal="false"><dc:Bounds x="10" y="10" width="300" height="160"/></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    const { model } = await importBpmn(xml);
    const pool = model.nodes.find((n) => n.id === "p1");
    const a = (pool?.attrs ?? {}) as Record<string, unknown>;
    expect(pool?.shape).toBe("bpmn-pool");
    expect(a.blackBox).toBe(true);
    expect(a.poolHorizontal).toBe(false);
  });

  it("round-trips edge label bounds via labelPos", async () => {
    const model: CanvasModel = {
      nodes: [
        { id: "a", shape: "bpmn-task", x: 0, y: 0, width: 120, height: 60, label: "A" },
        { id: "b", shape: "bpmn-task", x: 240, y: 0, width: 120, height: 60, label: "B" },
      ],
      edges: [{
        id: "f1",
        source: "a",
        target: "b",
        label: "hello",
        labelPos: { distance: 0.5, offset: { x: 0, y: -20 } },
      }],
    };
    const xml = await exportBpmn(model, null);
    expect(xml).toMatch(/<bpmndi:BPMNLabel>/);
    const rt = await importBpmn(xml);
    expect(rt.model.edges[0].labelPos).toBeDefined();
    const off = rt.model.edges[0].labelPos?.offset as { x: number; y: number };
    expect(off.y).toBeLessThan(0);
  });

  it("falls back to minimal export when raw BPMN patching fails", async () => {
    const model: CanvasModel = {
      nodes: [
        { id: "a", shape: "bpmn-task", x: 0, y: 0, width: 120, height: 60, label: "A" },
        { id: "b", shape: "bpmn-task", x: 240, y: 0, width: 120, height: 60, label: "B" },
      ],
      edges: [{ id: "f1", source: "a", target: "b", label: "ok" }],
    };
    const badMeta = { format: "bpmn", payload: { raw: "<bpmn:definitions>" } } as SourceMeta;
    const xml = await exportBpmn(model, badMeta);
    expect(xml).toMatch(/<bpmn:definitions/);
    expect(xml).toMatch(/id="a"/);
    expect(xml).toMatch(/id="f1"/);
  });

  it("minimal export normalizes BPMN IDs and drops dangling sequence flows", async () => {
    const model: CanvasModel = {
      nodes: [
        {
          id: "pool1",
          shape: "bpmn-pool",
          x: 0,
          y: 0,
          width: 640,
          height: 320,
          label: "Hiring",
          attrs: {
            lanes: [
              { id: "lane1", label: "HR" },
              { id: "lane2", label: "Manager" },
              { id: "lane3", label: "IT" },
            ],
          },
        },
        { id: "77f95155-8a2d-47ed-8962-3e8e9b425176", shape: "bpmn-gateway-x", x: 120, y: 140, width: 50, height: 50, label: "Gate" },
        { id: "task2", shape: "bpmn-task", x: 260, y: 120, width: 140, height: 80, label: "Task" },
      ],
      edges: [
        {
          id: "85034f04-505f-493a-be8c-06f8984e2c95",
          source: "77f95155-8a2d-47ed-8962-3e8e9b425176",
          target: "task2",
        },
        // dangling target must be dropped
        { id: "e_missing_target", source: "task2", target: "task_missing" },
      ],
    };

    const xml = await exportBpmn(model, null);
    const processSection = xml.match(/<bpmn:process[\s\S]*?<\/bpmn:process>/)?.[0] ?? "";

    // IDs starting with digits are normalized to XML-safe names.
    expect(xml).not.toMatch(/id="77f95155-8a2d-47ed-8962-3e8e9b425176"/);
    expect(xml).not.toMatch(/id="85034f04-505f-493a-be8c-06f8984e2c95"/);
    expect(xml).toMatch(/id="N_77f95155-8a2d-47ed-8962-3e8e9b425176"/);
    expect(xml).toMatch(/id="E_85034f04-505f-493a-be8c-06f8984e2c95"/);

    // Participant must live under collaboration, not as a process flowElement.
    expect(processSection).not.toMatch(/<bpmn:participant\b/);
    expect(xml).toMatch(/<bpmn:collaboration\b/);

    // No dangling edge with missing source/target refs.
    expect(xml).not.toMatch(/id="e_missing_target"/);
    const exportedFlows = xml.match(/<bpmn:sequenceFlow\b[^>]*>/g) ?? [];
    expect(exportedFlows.length).toBe(1);
    expect(exportedFlows[0]).toMatch(/\bsourceRef="/);
    expect(exportedFlows[0]).toMatch(/\btargetRef="/);
  });
});
