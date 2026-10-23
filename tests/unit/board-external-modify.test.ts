// @vitest-environment happy-dom
/**
 * A Board tab must never write its old model over a file changed from outside
 * (another tool / script regenerating the .omniboard.md while the tab is open).
 *
 * 23/10/2026 a script rewrote the board twice while its tab was open; the tab
 * saved its old model over it both times and two pools were lost. Obsidian's
 * TextFileView ignores `modify` events while a save is in flight
 * (`onModify: this.saving || ... loadFileInternal`), so a change landing
 * during the tab's own save is never loaded, and the next save overwrites it.
 *
 * `_helpers/obsidian-faithful` ports the relevant part of Obsidian 1.14.5's
 * TextFileView so the race is reproduced exactly; the vault is an in-memory fake.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CanvasModel } from "../../src/canvas/types";
import type { FakeVault } from "./_helpers/obsidian-faithful";

vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("./_helpers/obsidian-faithful")).faithfulOverrides(),
}));
vi.mock("../../src/canvas/OmniboardCanvas", () => ({ OmniboardCanvas: class {} }));

const POOLS = (n: number): CanvasModel => ({
  nodes: Array.from({ length: n }, (_, i) => ({
    id: `pool_${i}`, shape: "bpmn-pool", x: 0, y: i * 300, width: 800, height: 250, label: `Pool ${i}`,
  })),
  edges: [],
});

let serializeBoard: typeof import("../../src/view/boardSerde").serializeBoard;
let deserializeBoard: typeof import("../../src/view/boardSerde").deserializeBoard;

/** Fake canvas: holds a model; `edit()` mimics a user change on the Board. */
function fakeCanvas(view: { handleCanvasChange(): void }) {
  let model: CanvasModel = { nodes: [], edges: [] };
  const loads: CanvasModel[] = [];
  return {
    loads,
    getModel: () => JSON.parse(JSON.stringify(model)) as CanvasModel,
    loadModel: (m: CanvasModel) => { model = JSON.parse(JSON.stringify(m)); loads.push(model); },
    edit: (fn: (m: CanvasModel) => void) => { fn(model); view.handleCanvasChange(); },
  };
}

async function openBoard(initial: CanvasModel) {
  ({ serializeBoard, deserializeBoard } = await import("../../src/view/boardSerde"));
  const { BoardView } = await import("../../src/view/BoardView");
  const { FakeVault } = await import("./_helpers/obsidian-faithful");
  const vault = new FakeVault();
  const file = { path: "Omniboards/x.omniboard.md", basename: "x" };
  vault.text = serializeBoard(initial, "", undefined, {});
  const view = new BoardView({} as never, { settings: { compressDrawingData: false } } as never) as unknown as
    InstanceType<typeof BoardView> & { file: unknown; app: unknown; loadFileInternal(f: unknown, c: boolean): Promise<void>; handleCanvasChange(): void; askExternalConflict(): Promise<"reload" | "keep"> };
  view.file = file;
  view.app = { vault, workspace: {} };
  vault.views = [view as never];
  const canvas = fakeCanvas(view);
  (view as unknown as { canvas: unknown }).canvas = canvas;
  await view.loadFileInternal(file, true);   // what Obsidian does on open
  return { view, vault, file, canvas };
}

const diskModel = (vault: FakeVault) => deserializeBoard(vault.text)!;
const poolIds = (m: CanvasModel) => m.nodes.filter((n) => n.shape === "bpmn-pool").map((n) => n.id);

describe("Board tab vs. file changed from outside", () => {
  beforeEach(() => { vi.resetModules(); });

  it("a change written while the tab is saving is loaded, not overwritten later", async () => {
    const { view, vault, file, canvas } = await openBoard(POOLS(1));
    // user edits → save; the script rewrites the file (2 pools) while that save is in flight
    canvas.edit((m) => { m.nodes[0].x = 40; });
    vault.afterWrite = async () => { vault.afterWrite = null; vault.external(file, serializeBoard(POOLS(2), "", undefined, {})); };
    await view.save();
    await new Promise((r) => setTimeout(r, 0));
    // the tab now shows what is on disk…
    expect(poolIds(canvas.getModel())).toEqual(["pool_0", "pool_1"]);
    // …and its next save keeps both pools
    canvas.edit((m) => { m.nodes[0].label = "Khách"; });
    await view.save();
    expect(poolIds(diskModel(vault))).toEqual(["pool_0", "pool_1"]);
  });

  it("with unsaved edits, an outside change asks instead of discarding either side", async () => {
    const { view, vault, file, canvas } = await openBoard(POOLS(1));
    const ask = vi.fn(async () => "reload" as const);
    view.askExternalConflict = ask;
    canvas.edit((m) => { m.nodes[0].x = 40; });                    // unsaved edit
    vault.external(file, serializeBoard(POOLS(2), "", undefined, {}));
    await new Promise((r) => setTimeout(r, 0));
    expect(ask).toHaveBeenCalledTimes(1);
    await view.save();                                            // debounced save fires
    expect(poolIds(diskModel(vault))).toEqual(["pool_0", "pool_1"]); // outside change kept on disk
    expect(poolIds(canvas.getModel())).toEqual(["pool_0", "pool_1"]); // "Nạp lại" chosen
  });

  it("choosing 'keep mine' writes the tab's model", async () => {
    const { view, vault, file, canvas } = await openBoard(POOLS(1));
    view.askExternalConflict = async () => "keep";
    canvas.edit((m) => { m.nodes[0].x = 40; });
    vault.external(file, serializeBoard(POOLS(2), "", undefined, {}));
    await new Promise((r) => setTimeout(r, 0));
    await view.save();
    expect(poolIds(diskModel(vault))).toEqual(["pool_0"]);
    expect(diskModel(vault).nodes[0].x).toBe(40);
  });

  it("a save never writes over a disk change it was not told about", async () => {
    const { view, vault, file, canvas } = await openBoard(POOLS(1));
    view.askExternalConflict = async () => "reload";
    vault.external(file, serializeBoard(POOLS(2), "", undefined, {}), true);   // no modify event
    canvas.edit((m) => { m.nodes[0].x = 40; });
    await view.save();
    expect(poolIds(diskModel(vault))).toEqual(["pool_0", "pool_1"]);
    expect(poolIds(canvas.getModel())).toEqual(["pool_0", "pool_1"]);
  });

  it("its own writes don't look like outside changes", async () => {
    const { view, vault, canvas } = await openBoard(POOLS(1));
    const ask = vi.fn(async () => "reload" as const);
    view.askExternalConflict = ask;
    canvas.edit((m) => { m.nodes[0].x = 40; });
    await view.save();
    canvas.edit((m) => { m.nodes[0].x = 80; });
    await view.save();
    expect(ask).not.toHaveBeenCalled();
    expect(diskModel(vault).nodes[0].x).toBe(80);
  });
});
