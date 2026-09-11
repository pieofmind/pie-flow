/**
 * Artifact-type BPMN elements (Association, Group, TextAnnotation) have NO
 * `name` attribute in the BPMN 2.0 schema — Association/Group carry no label,
 * TextAnnotation uses <text>. Emitting `name` on them produces bpmn-moddle
 * "unknown attribute <name>" warnings and makes the native bpmn-js view choke.
 *
 * This is the same root cause as the TextAnnotation text-vs-name fix: the
 * generic edge/node emitter stamped `name` on every element regardless of
 * type. Regression guard for the whole family (assoc + group).
 *
 * Reproduced from the user's real board `as-is-kb2-...` which has 4
 * annotation→node associations and emitted 4 such warnings before the fix.
 */
import { describe, it, expect } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import { BpmnModdle } from "bpmn-moddle";
import type { CanvasModel } from "../../src/canvas/types";

const model: CanvasModel = {
  nodes: [
    { id: "pool", shape: "bpmn-pool", x: 0, y: 0, width: 800, height: 320, label: "P",
      attrs: { lanes: [{ id: "l1", label: "L" }] } },
    { id: "t1", shape: "bpmn-task", x: 200, y: 100, width: 100, height: 80, label: "Task", laneId: "l1" },
    { id: "anno", shape: "bpmn-annotation", x: 450, y: 60, width: 160, height: 60, label: "⚠ note text", laneId: "l1" },
    { id: "grp", shape: "bpmn-group", x: 40, y: 40, width: 700, height: 240, label: "Grouping" },
  ],
  edges: [
    { id: "assoc1", source: "t1", target: "anno", kind: "association" },
  ],
} as unknown as CanvasModel;

describe("artifact elements never carry a BPMN `name` attribute", () => {
  it("export produces zero moddle warnings (no name on Association/Group)", async () => {
    const xml = await exportBpmn(model);
    const moddle = new BpmnModdle();
    const { warnings } = await moddle.fromXML(xml);
    expect(warnings.map((w) => w.message)).toEqual([]);
  });

  it("Association and Group elements are emitted without a name attribute", async () => {
    const xml = await exportBpmn(model);
    // Association: <bpmn:association ...> must not contain name=
    const assoc = /<bpmn:association\b[^>]*>/i.exec(xml)?.[0] ?? "";
    expect(assoc, "association element present").not.toBe("");
    expect(assoc).not.toMatch(/\bname=/);
    // Group: <bpmn:group ...> must not contain name=
    const grp = /<bpmn:group\b[^>]*>/i.exec(xml)?.[0] ?? "";
    expect(grp, "group element present").not.toBe("");
    expect(grp).not.toMatch(/\bname=/);
  });

  it("round-trips: association stays association, annotation text + group survive", async () => {
    const xml = await exportBpmn(model);
    const { model: back } = await importBpmn(xml);
    const assoc = back.edges.find((e) => e.id === "assoc1");
    expect(assoc?.kind).toBe("association");
    const anno = back.nodes.find((n) => n.id === "anno");
    expect(anno?.label).toBe("⚠ note text");
    expect(back.nodes.some((n) => n.shape === "bpmn-group")).toBe(true);
  });
});
