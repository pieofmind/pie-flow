// @vitest-environment happy-dom
/**
 * The BPMN native view must not write over an .omniboard.md changed from
 * outside (a Board tab, a regenerating script) either.
 *
 * Before: the native view kept the canvas snapshot it took when it opened
 * (`wrapperRaw` / `wrapperCanvas`), merged each modeler save into it and
 * wrote that back — dropping whatever the file had gained meanwhile. Like
 * the Board, it now checks the disk before writing and on every `modify`,
 * also mid-save.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CanvasModel } from "../../src/canvas/types";
import type { FakeVault } from "./_helpers/obsidian-faithful";

vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("./_helpers/obsidian-faithful")).faithfulOverrides(),
}));
vi.mock("../../src/canvas/OmniboardCanvas", () => ({ OmniboardCanvas: class {} }));
vi.mock("../../src/bpmn-native/bpmn-native.css", () => ({ default: "" }));
vi.mock("../../src/bpmn-native/BpmnNativeController", () => ({
  BpmnNativeController: class {
    xml = ""; mounted = false;
    async mount(_c: unknown, xml: string) { this.xml = xml; this.mounted = true; return { warnings: [] }; }
    async saveXml() { return this.xml; }
    dispose() { this.mounted = false; }
    get isMounted() { return this.mounted; }
    getModeler() { return null; }
  },
}));

const POOLS = (n: number): CanvasModel => ({
  nodes: [
    ...Array.from({ length: n }, (_, i) => ({
      id: `pool_${i}`, shape: "bpmn-pool", x: 0, y: i * 300, width: 800, height: 250, label: `Pool ${i}`,
      attrs: { lanes: [{ id: `lane_${i}`, label: `Lane ${i}` }] },
    })),
    { id: "t1", shape: "bpmn-task-user", x: 200, y: 80, width: 100, height: 80, label: "Chào khách", laneId: "lane_0" },
  ],
  edges: [],
});

type View = {
  file: unknown; app: unknown;
  loadFileInternal(f: unknown, c: boolean): Promise<void>;
  save(): Promise<void>;
  askExternalConflict(): Promise<"reload" | "keep">;
  getController(): { xml: string };
};

async function openNative(initial: CanvasModel) {
  const { serializeBoard, deserializeBoard } = await import("../../src/view/boardSerde");
  const { exportBpmn } = await import("../../src/io/bpmn/export");
  const { FakeVault } = await import("./_helpers/obsidian-faithful");
  const { BpmnNativeView } = await import("../../src/bpmn-native/BpmnNativeView");
  const wrapper = async (m: CanvasModel) => serializeBoard(m, "", undefined, { bpmnXml: await exportBpmn(m) });
  const vault = new FakeVault();
  const file = { path: "Omniboards/x.omniboard.md", basename: "x" };
  vault.text = await wrapper(initial);
  const view = new BpmnNativeView({ detach() {} } as never, { settings: { compressDrawingData: false } } as never) as unknown as View;
  view.file = file;
  view.app = { vault, workspace: {} };
  const host = view as unknown as { bpmnContainer: HTMLElement; contentEl: HTMLElement };
  host.bpmnContainer = host.contentEl.appendChild(document.createElement("div"));
  vault.views = [view as never];
  await view.loadFileInternal(file, true);
  await tick();
  /** A user edit in the modeler: rename the task, then the debounced save. */
  const edit = (name: string) => {
    const c = view.getController();
    c.xml = c.xml.replace(/(id="t1" name=")[^"]*"/, `$1${name}"`);
    (view as unknown as { dirty: boolean }).dirty = true;
  };
  const disk = () => deserializeBoard(vault.text)!;
  return { view, vault, file, wrapper, edit, disk };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const poolIds = (m: CanvasModel) => m.nodes.filter((n) => n.shape === "bpmn-pool").map((n) => n.id);

describe("BPMN native view vs. file changed from outside", () => {
  beforeEach(() => { vi.resetModules(); });

  it("an outside change with no modeler edits is loaded; the next save keeps it", async () => {
    const { view, vault, file, wrapper, edit, disk } = await openNative(POOLS(1));
    vault.external(file, await wrapper(POOLS(2)));       // e.g. the Board tab adds a pool
    await tick(); await tick();
    edit("Chào khách mới");
    await view.save();
    expect(poolIds(disk())).toEqual(["pool_0", "pool_1"]);
  });

  it("with modeler edits, an outside change asks and nothing is written over it", async () => {
    const { view, vault, file, wrapper, edit, disk } = await openNative(POOLS(1));
    const ask = vi.fn(async () => "reload" as const);
    view.askExternalConflict = ask;
    edit("Chào khách mới");
    vault.external(file, await wrapper(POOLS(2)));
    await tick(); await tick();
    await view.save();
    expect(ask).toHaveBeenCalled();
    expect(poolIds(disk())).toEqual(["pool_0", "pool_1"]);
  });

  it("a disk change with no modify event is never overwritten by a save", async () => {
    const { view, vault, file, wrapper, edit, disk } = await openNative(POOLS(1));
    view.askExternalConflict = async () => "reload";
    vault.external(file, await wrapper(POOLS(2)), true);
    edit("Chào khách mới");
    await view.save();
    expect(poolIds(disk())).toEqual(["pool_0", "pool_1"]);
  });

  it("its own saves don't look like outside changes", async () => {
    const { view, edit, disk } = await openNative(POOLS(1));
    const ask = vi.fn(async () => "reload" as const);
    view.askExternalConflict = ask;
    edit("Lần 1");
    await view.save();
    edit("Lần 2");
    await view.save();
    expect(ask).not.toHaveBeenCalled();
    expect(disk().nodes.find((n) => n.id === "t1")?.label).toBe("Lần 2");
  });
});
