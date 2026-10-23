/**
 * A task carrying the "subprocess" marker (⊞ on the Board) is a collapsed
 * call into a sub-process: export it as bpmn:SubProcess with
 * DI isExpanded = !collapsed, so it survives the native ⇄ Board round trip.
 *
 * Before: export wrote bpmn:Task and dropped the marker; new DI shapes had no
 * isExpanded, so a collapsed sub-process came back expanded.
 */
import { describe, it, expect } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import type { CanvasModel } from "../../src/canvas/types";

const model = (attrs: Record<string, unknown>) => ({
  nodes: [
    { id: "s", shape: "bpmn-event-start", x: 0, y: 20, width: 36, height: 36 },
    { id: "sub", shape: "bpmn-task", x: 100, y: 0, width: 100, height: 80, label: "Xử lý khiếu nại", attrs },
  ],
  edges: [{ id: "f", source: "s", target: "sub" }],
}) as unknown as CanvasModel;

const back = async (xml: string) => (await importBpmn(xml)).model.nodes.find((n) => n.id === "sub")!;

describe("task with the subprocess marker", () => {
  it("exports as a collapsed bpmn:SubProcess and imports back collapsed", async () => {
    const xml = await exportBpmn(model({ markers: ["subprocess"], collapsed: true }));
    expect(xml).toMatch(/<bpmn:subProcess id="sub" name="Xử lý khiếu nại"/);
    expect(xml).toMatch(/bpmnElement="sub" isExpanded="false"/);
    const n = await back(xml);
    expect(n.shape).toBe("bpmn-subprocess");
    expect((n.attrs as { collapsed?: boolean }).collapsed).toBe(true);
  });

  it("the patch path (file opened from .bpmn with a bpmn:Task) turns it into a sub-process too", async () => {
    const raw = await exportBpmn(model({}));
    expect(raw).toMatch(/<bpmn:task id="sub"/);
    const imported = await importBpmn(raw);
    const edited = {
      ...imported.model,
      nodes: imported.model.nodes.map((n) => (n.id === "sub" ? { ...n, attrs: { ...n.attrs, markers: ["subprocess"], collapsed: true } } : n)),
    } as CanvasModel;
    const xml = await exportBpmn(edited, imported.sourceMeta);
    expect(xml).not.toMatch(/<bpmn:task id="sub"/);
    expect(xml).toMatch(/<bpmn:subProcess id="sub"/);
    expect(xml).toMatch(/<bpmn:sequenceFlow id="f"[^>]*sourceRef="s" targetRef="sub"/);
    expect((await back(xml)).attrs).toMatchObject({ collapsed: true });
  });
});
