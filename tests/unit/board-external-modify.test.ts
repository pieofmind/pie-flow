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
 * `FaithfulTextFileView` below ports the relevant part of Obsidian 1.14.5's
 * TextFileView (save / onModify / loadFileInternal / setData) so the race is
 * reproduced exactly; the vault is an in-memory fake.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CanvasModel } from "../../src/canvas/types";

vi.mock("obsidian", async () => {
  const stub = await import("./_helpers/obsidian-stub");
  class FaithfulTextFileView {
    contentEl = document.createElement("div");
    file: unknown = null;
    app: unknown;
    leaf: unknown;
    data = "";
    lastSavedData: string | null = null;
    dirty = false;
    saving = false;
    saveAgain = false;
    constructor(leaf: unknown) { this.leaf = leaf; }
    getViewData(): string { return ""; }
    setViewData(_d: string, _c: boolean): void {}
    clear(): void {}
    registerEvent(_e: unknown): void {}
    // Obsidian debounces this (2 s); tests call save() themselves.
    requestSave = (): void => { this.dirty = true; };
    async save(clear?: boolean): Promise<void> {
      this.dirty = false;
      const file = this.file;
      const vault = (this.app as { vault: FakeVault }).vault;
      if (!file) return;
      if (this.saving) { if (!clear) this.saveAgain = true; return; }
      this.saveAgain = false;
      const o = this.getViewData();
      if (this.lastSavedData === o || this.lastSavedData === null) return;
      const prev = this.lastSavedData;
      this.data = o; this.lastSavedData = o; this.saving = true;
      try { await vault.modify(file, o); }
      catch (e) { this.lastSavedData = prev; throw e; }
      finally { this.saving = false; if (this.saveAgain && !clear) void this.save(); }
    }
    onModify(file: unknown): void {
      if (this.saving) return;
      if (file === this.file) void this.loadFileInternal(file, false);
    }
    async loadFileInternal(file: unknown, clear: boolean): Promise<void> {
      const n = await (this.app as { vault: FakeVault }).vault.read(file);
      const i = this.lastSavedData;
      this.lastSavedData = n;
      if (!clear && i) {
        if (i === n) return;
        if (this.dirty && this.getViewData() === n) return;
      }
      this.setData(n, clear);
    }
    setData(e: string, t: boolean): void {
      if (this.data !== e || t) { this.data = e; this.setViewData(e, t); }
    }
  }
  class ItemView { contentEl = document.createElement("div"); constructor(public leaf: unknown) {} }
  return { ...stub, TextFileView: FaithfulTextFileView, ItemView };
});
vi.mock("../../src/canvas/OmniboardCanvas", () => ({ OmniboardCanvas: class {} }));

/** In-memory vault. `modify` lands the text, fires `modify` (Obsidian does
 *  this before the write promise settles, while the view is still `saving`),
 *  then waits on `afterWrite` so a test can slip an external write in. */
class FakeVault {
  text = "";
  writes: string[] = [];
  view: { onModify(f: unknown): void } | null = null;
  afterWrite: (() => Promise<void>) | null = null;
  async read(_f: unknown): Promise<string> { return this.text; }
  async modify(f: unknown, t: string): Promise<void> {
    this.text = t; this.writes.push(t);
    this.view?.onModify(f);
    if (this.afterWrite) await this.afterWrite();
  }
  on(): object { return {}; }
  /** Another tool rewrites the file. `silent` = no modify event reaches the view. */
  external(f: unknown, t: string, silent = false): void {
    this.text = t;
    if (!silent) this.view?.onModify(f);
  }
}

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
  const vault = new FakeVault();
  const file = { path: "Omniboards/x.omniboard.md", basename: "x" };
  vault.text = serializeBoard(initial, "", undefined, {});
  const view = new BoardView({} as never, { settings: { compressDrawingData: false } } as never) as unknown as
    InstanceType<typeof BoardView> & { file: unknown; app: unknown; loadFileInternal(f: unknown, c: boolean): Promise<void>; handleCanvasChange(): void; askExternalConflict(): Promise<"reload" | "keep"> };
  view.file = file;
  view.app = { vault, workspace: {} };
  vault.view = view as never;
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
