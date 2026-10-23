/**
 * What the Board says an element is must be what the file says: a changed
 * type, catch vs throw, multiple triggers, the called process of a call activity.
 */
import { describe, it, expect, vi } from "vitest";
import { exportBpmn } from "../../src/io/bpmn/export";
import { importBpmn } from "../../src/io/bpmn/import";
import { allowedTriggers } from "../../src/io/bpmn/eventTriggers";
import type { CanvasModel } from "../../src/canvas/types";

const node = (id: string, shape: string, attrs: Record<string, unknown> = {}, x = 0) =>
  ({ id, shape, x, y: 0, width: shape.startsWith("bpmn-event") ? 36 : 100, height: shape.startsWith("bpmn-event") ? 36 : 80, label: id, attrs });
const model = (...nodes: ReturnType<typeof node>[]) => ({ nodes, edges: [] }) as unknown as CanvasModel;

async function patched(first: CanvasModel, edit: (m: CanvasModel) => CanvasModel): Promise<string> {
  const imported = await importBpmn(await exportBpmn(first));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const xml = await exportBpmn(edit(imported.model), imported.sourceMeta);
  expect(warn.mock.calls.some((c) => String(c[0]).includes("patchExisting failed"))).toBe(false);
  warn.mockRestore();
  return xml;
}
const reshape = (id: string, shape: string, attrs?: Record<string, unknown>) => (m: CanvasModel): CanvasModel => ({
  ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, shape, attrs: { ...n.attrs, ...attrs } } : n)),
});

describe("intermediate events: catch or throw", () => {
  it("a timer is a catch event; a message is caught unless marked throwing; a plain one throws", async () => {
    const xml = await exportBpmn(model(
      node("tm", "bpmn-event-intermediate", { trigger: "timer" }),
      node("mc", "bpmn-event-intermediate", { trigger: "message" }, 100),
      node("mt", "bpmn-event-intermediate", { trigger: "message", throwing: true }, 200),
      node("pl", "bpmn-event-intermediate", {}, 300),
    ));
    expect(xml).toMatch(/<bpmn:intermediateCatchEvent id="tm"/);
    expect(xml).toMatch(/<bpmn:intermediateCatchEvent id="mc"/);
    expect(xml).toMatch(/<bpmn:intermediateThrowEvent id="mt"/);
    expect(xml).toMatch(/<bpmn:intermediateThrowEvent id="pl"/);
    const back = (await importBpmn(xml)).model.nodes;
    expect(back.find((n) => n.id === "mc")?.attrs?.throwing).not.toBe(true);
    expect(back.find((n) => n.id === "mt")?.attrs?.throwing).toBe(true);
  });
});

describe("changing an element's type on the Board reaches the file", () => {
  it("task → user task, XOR → AND, throw → catch, keeping id, name and flows", async () => {
    const first = {
      nodes: [node("t", "bpmn-task"), node("g", "bpmn-gateway-x", {}, 200), node("e", "bpmn-event-intermediate", { trigger: "message", throwing: true }, 400)],
      edges: [{ id: "f1", source: "t", target: "g" }, { id: "f2", source: "g", target: "e" }],
    } as unknown as CanvasModel;
    const xml = await patched(first, (m) => reshape("e", "bpmn-event-intermediate", { throwing: false })(reshape("g", "bpmn-gateway-parallel")(reshape("t", "bpmn-task-user")(m))));
    expect(xml).toMatch(/<bpmn:userTask id="t" name="t"/);
    expect(xml).toMatch(/<bpmn:parallelGateway id="g"/);
    expect(xml).toMatch(/<bpmn:intermediateCatchEvent id="e"[\s\S]*?<bpmn:messageEventDefinition/);
    expect(xml).not.toMatch(/<bpmn:(task|exclusiveGateway|intermediateThrowEvent) id=/);
    expect(xml).toMatch(/<bpmn:sequenceFlow id="f1"[^>]*sourceRef="t" targetRef="g"/);
    expect(xml).toMatch(/bpmnElement="g"/);
    const back = (await importBpmn(xml)).model.nodes;
    expect(back.find((n) => n.id === "g")?.shape).toBe("bpmn-gateway-parallel");
  });
});

describe("multiple / parallel multiple triggers", () => {
  it("export more than one event definition and import them back as the same trigger", async () => {
    const xml = await exportBpmn(model(
      node("m", "bpmn-event-start", { trigger: "multiple" }),
      node("p", "bpmn-event-start", { trigger: "parallel-multiple" }, 100),
    ));
    const defsOf = (id: string) => xml.match(new RegExp(`<bpmn:startEvent id="${id}"[^>]*>([\\s\\S]*?)</bpmn:startEvent>`))?.[1].match(/EventDefinition/g)?.length ?? 0;
    expect(defsOf("m")).toBeGreaterThan(1);
    expect(defsOf("p")).toBeGreaterThan(1);
    expect(xml).toMatch(/<bpmn:startEvent id="p"[^>]*parallelMultiple="true"/);
    const back = (await importBpmn(xml)).model.nodes;
    expect(back.find((n) => n.id === "m")?.attrs?.trigger).toBe("multiple");
    expect(back.find((n) => n.id === "p")?.attrs?.trigger).toBe("parallel-multiple");
  });
});

describe("call activity", () => {
  it("calledElement round-trips", async () => {
    const xml = await exportBpmn(model(node("c", "bpmn-call-activity", { calledElement: "Process_ChamSoc" })));
    expect(xml).toMatch(/<bpmn:callActivity id="c" name="c" calledElement="Process_ChamSoc"/);
    expect((await importBpmn(xml)).model.nodes[0].attrs?.calledElement).toBe("Process_ChamSoc");
  });
});

describe("triggers allowed where an event sits (BPMN 2.0 table 10.93 / 10.94 / 10.95)", () => {
  it("start, intermediate catch / throw, boundary, end", () => {
    expect(allowedTriggers("bpmn-event-start", {})).not.toContain("terminate");
    expect(allowedTriggers("bpmn-event-start", {})).toContain("timer");
    expect(allowedTriggers("bpmn-event-end", {})).toContain("terminate");
    expect(allowedTriggers("bpmn-event-end", {})).not.toContain("timer");
    expect(allowedTriggers("bpmn-event-intermediate", {})).toContain("timer");          // catch
    expect(allowedTriggers("bpmn-event-intermediate", { throwing: true })).not.toContain("timer");
    expect(allowedTriggers("bpmn-event-intermediate", { throwing: true })).toContain("escalation");
    expect(allowedTriggers("bpmn-event-intermediate", { attachedTo: "t" })).toContain("error");
    expect(allowedTriggers("bpmn-event-intermediate", { attachedTo: "t" })).not.toContain("link");
  });
});

describe("renaming a node's id on the Board", () => {
  it("renames the file element and keeps what only the file had", async () => {
    const first = { ...model(node("a", "bpmn-task"), node("b", "bpmn-task", {}, 200)), edges: [{ id: "f", source: "a", target: "b" }] } as unknown as CanvasModel;
    const raw = (await exportBpmn(first)).replace(/<bpmn:task id="a"([^>]*?)\s*\/>/, '<bpmn:task id="a"$1><bpmn:extensionElements><x:keep xmlns:x="urn:x"/></bpmn:extensionElements></bpmn:task>');
    const imported = await importBpmn(raw);
    const renamed: CanvasModel = {
      nodes: imported.model.nodes.map((n) => (n.id === "a" ? { ...n, id: "Task_Moi" } : n)),
      edges: imported.model.edges.map((e) => (e.source === "a" ? { ...e, source: "Task_Moi" } : e)),
    };
    const xml = await exportBpmn(renamed, imported.sourceMeta);
    expect(xml).not.toMatch(/id="a"/);
    expect(xml).toMatch(/<bpmn:task id="Task_Moi"[^>]*>\s*<bpmn:extensionElements>\s*<x:keep/);
    expect(xml).toMatch(/sourceRef="Task_Moi" targetRef="b"/);
    expect(xml).toMatch(/bpmnElement="Task_Moi"/);
  });
});

describe("trigger choices", () => {
  it("keeps a trigger the file brought in even when the table forbids it", async () => {
    const { triggerChoices } = await import("../../src/io/bpmn/eventTriggers");
    expect(triggerChoices("bpmn-event-start", { trigger: "terminate" })).toContain("terminate");
    expect(triggerChoices("bpmn-event-start", {})).not.toContain("terminate");
  });
});
