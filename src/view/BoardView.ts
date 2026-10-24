import { TextFileView, WorkspaceLeaf, setIcon, Notice, Menu, Modal } from "obsidian";
import { render, h, type ComponentType } from "preact";
import { OmniboardCanvas } from "../canvas/OmniboardCanvas";
import type { CanvasModel } from "../canvas/types";
import { registerAllShapes, SHAPE_CATEGORIES } from "../canvas/shapes/index";
import { serializeBoard, deserializeBoard } from "./boardSerde";
import { exportBpmn } from "../io/bpmn/export";
import { importFromFile } from "../io/dispatcher";
import { findById, FORMATS } from "../io/registry";
import type { SourceMeta } from "../io/types";
import { emitOmniboardSelectionChange, OMNIBOARD_PROPERTIES_VIEW_TYPE } from "../ui/PropertiesPanel";
import { emitBpmnIssuesRefresh, OMNIBOARD_ISSUES_VIEW_TYPE } from "../ui/BpmnIssuesView";
import { validateBpmnModel } from "../io/bpmn/validator";
import type DiagramsPlugin from "../main";
import { BoardEditor, type BoardEditorProps } from "../ui/BoardEditor";
import { readObsidianTheme } from "../core/theme";
import type { DiagramAdapter } from "../core/adapter";
import { buildBoardTopbar } from "../ui/boardTopbar";
import { BoardSidePanel } from "../ui/boardSidePanel";
import { askExternalChange, writeIfUnchanged } from "./externalChange";

registerAllShapes();

type NoticeKind = "success" | "warn" | "error" | "info";

/** Build a notice payload with a lucide icon + text — keeps toasts consistent with the topbar/Obsidian icon set instead of leaning on emoji. */
function noticeFrag(kind: NoticeKind, text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const wrap = document.createElement("span");
  wrap.addClass("da-notice");
  wrap.addClass(`da-notice-${kind}`);
  const iconEl = wrap.createSpan({ cls: "da-notice-icon" });
  const icon =
    kind === "success" ? "check-circle-2" :
    kind === "warn" ? "alert-triangle" :
    kind === "error" ? "x-circle" : "info";
  setIcon(iconEl, icon);
  wrap.createSpan({ cls: "da-notice-text", text });
  frag.appendChild(wrap);
  return frag;
}

function notify(kind: NoticeKind, text: string, timeout?: number): Notice {
  return new Notice(noticeFrag(kind, text), timeout);
}

/**
 * Save a Blob/string to a user-chosen LOCAL folder via the browser's File
 * System Access API (Obsidian's Electron runtime supports it). Falls back to
 * an `<a download>` trigger when the API is unavailable (Firefox / older
 * Electron) — that path drops the file into the user's default Downloads
 * folder instead of letting them pick one.
 *
 * Returns the resolved filename on success, or null when the user cancels.
 */
interface PickerType { description: string; accept: Record<string, string[]>; }
interface FsPickerWindow {
  showSaveFilePicker?: (opts: { suggestedName?: string; types?: PickerType[] }) => Promise<{
    createWritable: () => Promise<{ write: (data: BlobPart) => Promise<void>; close: () => Promise<void>; }>;
    name: string;
  }>;
}

class DiagramPickerModal extends Modal {
  private readonly diagrams: Array<{ index: number; id: string; planeRef?: string; elementCount?: number }>;
  private readonly onPick: (index: number) => void;
  private readonly onCancel: () => void;
  constructor(
    view: BoardView,
    diagrams: Array<{ index: number; id: string; planeRef?: string; elementCount?: number }>,
    onPick: (index: number) => void,
    onCancel: () => void,
  ) {
    super(view.app);
    this.diagrams = diagrams;
    this.onPick = onPick;
    this.onCancel = onCancel;
  }
  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("omniboard-diagram-picker");
    contentEl.empty();
    contentEl.createEl("h3", { text: "Select BPMN Diagram" });
    contentEl.createEl("p", { text: `This file contains ${this.diagrams.length} diagrams. Pick one to import.` });
    const sorted = [...this.diagrams].sort((a, b) => (b.elementCount ?? 0) - (a.elementCount ?? 0));
    const list = contentEl.createDiv({ cls: "obp-kv" });
    const base = sorted.slice(0, 8);
    const more = sorted.slice(8);
    const mkBtn = (d: { index: number; id: string; planeRef?: string; elementCount?: number }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "obi-row";
      btn.innerHTML =
        `<span class="obi-code">#${d.index + 1} • ${d.elementCount ?? 0} elements</span>` +
        `<span class="obi-msg">${d.id}${d.planeRef ? ` — plane: ${d.planeRef}` : ""}</span>`;
      btn.onclick = () => { this.onPick(d.index); this.close(); };
      return btn;
    };
    for (const d of base) list.appendChild(mkBtn(d));
    if (more.length) {
      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "lk-flyout-more";
      moreBtn.textContent = `Load more (${more.length})`;
      moreBtn.onclick = () => {
        const frag = document.createDocumentFragment();
        for (const d of more) frag.appendChild(mkBtn(d));
        list.insertBefore(frag, moreBtn);
        moreBtn.remove();
      };
      list.appendChild(moreBtn);
    }
    const actions = contentEl.createDiv({ cls: "lk-prow2" });
    const cancel = document.createElement("button");
    cancel.className = "lk-padd";
    cancel.textContent = "Cancel";
    cancel.onclick = () => { this.onCancel(); this.close(); };
    actions.appendChild(cancel);
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
async function saveToLocal(
  data: Blob | string | ArrayBuffer,
  suggestedName: string,
  mimeType: string,
): Promise<string | null> {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const w = window as unknown as FsPickerWindow;
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const ext = suggestedName.match(/\.([^.]+)$/)?.[1] ?? "";
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: ext ? [{ description: ext.toUpperCase(), accept: { [mimeType]: ["." + ext] } }] : [],
      });
      const writer = await handle.createWritable();
      await writer.write(blob);
      await writer.close();
      return handle.name;
    } catch (err) {
      // AbortError = user cancelled → return null silently.
      if ((err as DOMException)?.name === "AbortError") return null;
      throw err;
    }
  }
  // Fallback: download to default Downloads folder.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = suggestedName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return suggestedName;
}

export const BOARD_VIEW_TYPE = "omniboard-board";
export const BOARD_EXTENSION = "omniboard.md";

const EMPTY_MODEL: CanvasModel = { nodes: [], edges: [] };

/**
 * Story 7-4 — BoardView's "adapter" stub.
 *
 * `<BoardEditor>` requires an `adapter` prop (used by Story 7-7's header
 * for chip/title rendering). BoardView is a *multi-diagram canvas master*,
 * not a single-adapter view — none of the adapter methods are actually
 * exercised in tab mode by Story 7-4's body-only wiring. Stub fields are
 * placeholders; if Story 7-7's header reads these, they'll show a generic
 * "Board" label which BoardView's own custom topbar overrides anyway.
 */
const BOARD_TAB_STUB_ADAPTER: DiagramAdapter<CanvasModel> = {
  id: "flowchart",
  displayName: "Board",
  codeBlockLanguage: "omniboard",
  icon: "shapes",
  parse: () => EMPTY_MODEL,
  serialize: () => "",
  emptyTemplate: () => "",
  // Cast via `unknown` to satisfy ComponentType<RendererProps<CanvasModel>>
  // — these are placeholders never invoked at runtime in tab mode (Story 7-7
  // header will introduce real usage). The Story 7-7 wiring is expected to
  // replace this stub with a real per-diagram adapter or a board-aware one.
  Renderer: (() => null) as unknown as DiagramAdapter<CanvasModel>["Renderer"],
  Editor: (() => null) as unknown as DiagramAdapter<CanvasModel>["Editor"],
  exportFormats: ["svg", "png", "pdf"],
  validate: () => ({ ok: true, errors: [] }),
};

/**
 * Excalidraw-style full-screen board view. One file = one board.
 * Opening the file opens the canvas directly — no code block, no modal.
 */
/** Side panel open/closed — shared by every board tab for this session. */
let sideOpen = true;

export class BoardView extends TextFileView {
  private canvas: OmniboardCanvas | null = null;
  private host: HTMLElement | null = null;
  private side: BoardSidePanel | null = null;
  private sideFrame = 0;
  private boardTitleEl: { setText: (t: string) => void } | null = null;
  private model: CanvasModel = EMPTY_MODEL;
  private rawData = "";
  private invalidFormat = false;
  private readonly plugin: DiagramsPlugin;
  /**
   * Derived BPMN 2.0 XML refreshed by `save()` before each persist. Values:
   *  - `undefined` → never regenerated yet; serializer preserves the previous block.
   *  - `string`    → embed this XML into the `omniboard-bpmn-xml` block.
   *  - `""`        → previous regen attempt failed; drop the block (master canvas
   *                   model is still written, BPMN view will lazy-regenerate).
   */
  private cachedBpmnXml: string | undefined = undefined;
  /**
   * Guard against writing over a file changed from outside (another tool
   * regenerating the board while this tab is open). `diskModel` is the board
   * model we know to be on disk: set when we load it and when we write it.
   * Obsidian's TextFileView ignores `modify` while a save is in flight, so we
   * check the disk ourselves (onModify override + before every save).
   */
  private diskModel: string | null = null;
  /** Canvas edits not yet written to disk. */
  private localEdits = false;
  /** True while we load disk content into the canvas (its change events are not edits). */
  private applyingDisk = false;
  /** Set while asking the user about a conflict; no save may write meanwhile. */
  private conflict: Promise<void> | null = null;
  /** True only inside our own save(), so getViewData knows it is being written. */
  private writing = false;
  /** A write is in flight; another save request waits for it. */
  private saving = false;
  private saveAgain = false;

  constructor(leaf: WorkspaceLeaf, plugin: DiagramsPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return BOARD_VIEW_TYPE; }
  getDisplayText(): string { return this.file?.basename ?? "Board"; }
  getIcon(): string { return "shapes"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("da-board-view");
    this.contentEl.style.cssText = "padding:0; display:flex; flex-direction:column; height:100%;";

    this.buildTopBar();

    const main = this.contentEl.createDiv({ cls: "da-board-main" });
    this.contentEl.toggleClass("da-side-hidden", !sideOpen);
    this.side = new BoardSidePanel(main, {
      getModel: () => this.canvas?.getModel() ?? null,
      focus: (id) => this.focusCellId(id),
    });
    this.host = main.createDiv({ cls: "da-board-host" });
    this.host.style.cssText = "position:relative; flex:1; min-height:0; min-width:0;";

    // Story 7-4 — mount <BoardEditor mode="tab"> into the host instead of
    // constructing OmniboardCanvas directly. The canvas instance is captured
    // via `onCanvasReady` so existing methods (export, undo, focus, save)
    // continue to reference `this.canvas`. The custom Lark-style topbar
    // above stays intact in this story; header redesign is Story 7-7.
    //
    // P1 cleanup: `onClose()` below calls `render(null, this.host)` which
    // triggers OmniboardCanvasMount's effect cleanup → `canvas.destroy()`.
    const props: BoardEditorProps<CanvasModel> = {
      adapter: BOARD_TAB_STUB_ADAPTER,
      initialModel: this.model,
      theme: readObsidianTheme(),
      mode: "tab",
      // Save/close in tab mode are owned by TextFileView's framework
      // contract + the custom topbar's "Lưu & đóng" button.
      onSave: () => {},
      onClose: () => {},
      shapeCategories: SHAPE_CATEGORIES,
      canvasModel: this.model,
      onCanvasChange: () => this.handleCanvasChange(),
      onCanvasReady: (canvas) => {
        this.canvas = canvas;
        // Resync to the latest `this.model` in case setViewData fired
        // between mount and useEffect drain (the model passed at render
        // time may already be stale by the time the effect runs).
        // It is the disk content, not a user edit.
        this.applyingDisk = true;
        try { canvas.loadModel(this.model); }
        finally { this.applyingDisk = false; }
        canvas.setSelectionChangeHandler(() => {
          emitOmniboardSelectionChange();
          this.side?.markSelected(canvas.getSelectedNodeSnapshot()?.id ?? null);
        });
        emitBpmnIssuesRefresh();
        this.side?.refresh();
      },
    };
    // Cast through `ComponentType<BoardEditorProps<CanvasModel>>` to pin the
    // generic — `h()` infers the component's prop type from its first arg.
    // BoardEditor is generic over TModel and Preact's `h()` typings don't
    // resolve the generic from props inference alone.
    type Specialized = ComponentType<BoardEditorProps<CanvasModel>>;
    render(
      h(BoardEditor as unknown as Specialized, props),
      this.host,
    );
  }

  private buildTopBar(): void {
    const bar = this.contentEl.createDiv({ cls: "da-topbar" });
    // Story 7-5d — the topbar is built by the SHARED `buildBoardTopbar`, the
    // single source of truth used by both this tab view and the inline-card
    // edit modal. Changing a common button here updates both surfaces.
    const { setTitle } = buildBoardTopbar(bar, {
      getCanvas: () => this.canvas,
      badgeLabel: "BOARD",
      badgeIcon: "shapes",
      title: this.file?.basename ?? "Board",
      onClose: () => this.leaf.detach(),
      onSave: () => void (async () => { await this.save(); this.leaf.detach(); })(),
      onExport: (e) => this.showExportMenu(e),
      onToggleSide: () => {
        sideOpen = !sideOpen;
        this.contentEl.toggleClass("da-side-hidden", !sideOpen);
        if (sideOpen) this.side?.refresh();
      },
      extraButtons: [
        { icon: "workflow", tip: "Chuyển sang BPMN Native", onClick: () => void this.switchToBpmnNativeView() },
        { icon: "sliders-horizontal", tip: "BPMN properties", onClick: () => void this.openPropertiesLeaf(), inMenu: true },
        { icon: "alert-triangle", tip: "BPMN issues", onClick: () => void this.openIssuesLeaf(), inMenu: true },
        { icon: "file-text", tip: "Mở dưới dạng Markdown", onClick: () => void this.openAsMarkdown(), inMenu: true },
        { icon: "upload", tip: "Import (BPMN / DBML)", onClick: () => this.openImportPicker(), inMenu: true },
      ],
    });
    // Rename handler (onLoadFile) updates the title via this thin adapter.
    this.boardTitleEl = { setText: (t: string) => setTitle(t) };
  }

  /** A change on the canvas. BoardView keeps `this.model` in sync via
   *  canvas.getModel() at save time (see getViewData / save); here we just
   *  trigger the change pipeline. */
  private handleCanvasChange(): void {
    // Outline / issue list follow every change, disk reloads included — once per frame.
    if (sideOpen && !this.sideFrame) this.sideFrame = requestAnimationFrame(() => { this.sideFrame = 0; this.side?.refresh(); });
    if (this.applyingDisk) return;
    this.localEdits = true;
    this.requestSave();
    emitBpmnIssuesRefresh();
  }

  /** Board model of a file's text, as a comparable string (null = unparseable). */
  private static fingerprint(text: string): string | null {
    const m = deserializeBoard(text);
    return m ? JSON.stringify(m) : null;
  }

  /** Obsidian calls this when the file changes on disk. Unlike the base
   *  class we also look while a save is in flight — that is exactly when a
   *  regenerating script's write used to get lost. */
  onModify(file: unknown): void {
    if (file !== this.file) return;
    void this.checkDisk();
  }

  /** Compare the disk with what we last loaded / wrote. Returns true when the
   *  disk holds what we expect (safe to write). */
  private async checkDisk(): Promise<boolean> {
    if (!this.file || this.invalidFormat) return true;
    const disk = await this.app.vault.read(this.file);
    const fp = BoardView.fingerprint(disk);
    if (fp === null || fp === this.diskModel) return true;
    if (!this.localEdits) this.applyDisk(disk);
    else await this.resolveConflict();
    return false;
  }

  /** Load disk content into the canvas, keeping zoom / pan. */
  private applyDisk(disk: string): void {
    const base = this as unknown as { data: string; lastSavedData: string | null; dirty: boolean };
    base.data = disk;
    base.lastSavedData = disk;
    this.applyingDisk = true;
    try { this.setViewData(disk, false); }
    finally { this.applyingDisk = false; }
    this.localEdits = false;
    base.dirty = false;
  }

  private resolveConflict(): Promise<void> {
    this.conflict ??= (async () => {
      try {
        const choice = await this.askExternalConflict();
        if (!this.file) return;
        const disk = await this.app.vault.read(this.file);
        if (choice === "reload") { this.applyDisk(disk); return; }
        // Keep mine: accept writing over what is on disk now.
        this.diskModel = BoardView.fingerprint(disk);
        this.requestSave();
      } finally { this.conflict = null; }
    })();
    return this.conflict;
  }

  /** Ask whether to reload the file changed from outside or keep this tab's edits. */
  protected askExternalConflict(): Promise<"reload" | "keep"> {
    return askExternalChange(this.app);
  }

  getCanvas(): OmniboardCanvas | null {
    return this.canvas;
  }

  /**
   * Switch this leaf to the BPMN Native view on the same wrapper file. The view
   * type string is hard-coded to avoid a circular import with BpmnNativeView —
   * it stays in lock-step with `BPMN_NATIVE_VIEW_TYPE` in BpmnNativeView.ts.
   */
  async switchToBpmnNativeView(): Promise<void> {
    if (!this.file) return;
    await this.save();
    await this.leaf.setViewState({ type: "bpmn-native", state: { file: this.file.path } });
  }

  focusCellId(id: string): boolean {
    return this.canvas?.focusCellById(id) ?? false;
  }

  private async openPropertiesLeaf(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(OMNIBOARD_PROPERTIES_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: OMNIBOARD_PROPERTIES_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
    emitOmniboardSelectionChange();
  }

  private async openIssuesLeaf(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(OMNIBOARD_ISSUES_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: OMNIBOARD_ISSUES_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
    emitBpmnIssuesRefresh();
  }

  private showExportMenu(e: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("SVG").setIcon("file-code").onClick(() => this.handleExportSvg()));
    menu.addSeparator();
    [1, 2, 4].forEach((s) =>
      menu.addItem((i) => i.setTitle(`PNG ${s}×`).setIcon("image").onClick(() => this.handleExportPng(s)))
    );
    menu.addItem((i) => i.setTitle("PDF (A4)").setIcon("file-text").onClick(() => this.handleExportPdf()));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Copy as Mermaid").setIcon("clipboard-copy").onClick(() => this.handleCopyMermaid()));
    menu.addSeparator();
    for (const fmt of FORMATS) {
      menu.addItem((i) =>
        i.setTitle(fmt.displayName).setIcon("file-output").onClick(() => this.handleExportFormat(fmt.id))
      );
    }
    menu.showAtMouseEvent(e);
  }

  private suggestedName(suffix: string): string {
    return (this.file?.basename ?? "Omniboard") + suffix;
  }

  private async handleExportPdf(): Promise<void> {
    if (!this.canvas || !this.file) return;
    try {
      const bytes = await this.canvas.exportPDF();
      const saved = await saveToLocal(bytes.buffer as ArrayBuffer, this.suggestedName(".pdf"), "application/pdf");
      if (saved) notify("success", `Đã export: ${saved}`);
    } catch {
      notify("error", "Export PDF lỗi");
    }
  }

  private async handleCopyMermaid(): Promise<void> {
    if (!this.canvas) return;
    try {
      await navigator.clipboard.writeText(this.canvas.exportMermaid());
      notify("success", "Đã copy Mermaid vào clipboard");
    } catch {
      notify("error", "Copy Mermaid lỗi");
    }
  }

  private async handleExportSvg(): Promise<void> {
    if (!this.canvas || !this.file) return;
    try {
      const svg = this.canvas.exportSVG();
      const saved = await saveToLocal(svg, this.suggestedName(".svg"), "image/svg+xml");
      if (saved) notify("success", `Đã export: ${saved}`);
    } catch {
      notify("error", "Export SVG lỗi");
    }
  }

  private async handleExportPng(scale: number): Promise<void> {
    if (!this.canvas || !this.file) return;
    try {
      const blob = await this.canvas.exportPNG(scale);
      const suffix = scale === 1 ? ".png" : `@${scale}x.png`;
      const saved = await saveToLocal(blob, this.suggestedName(suffix), "image/png");
      if (saved) notify("success", `Đã export: ${saved}`);
    } catch {
      notify("error", "Export PNG lỗi");
    }
  }

  // Obsidian → view
  setViewData(data: string, _clear: boolean): void {
    // H6: clear per-file derived state so a stale cached BPMN from the
    // previously-opened file does not bleed into the next file's first save.
    // Obsidian reuses BoardView instances when switching files on the same leaf.
    this.cachedBpmnXml = undefined;
    this.rawData = data;
    if (this.boardTitleEl) this.boardTitleEl.setText(this.file?.basename ?? "Board");
    const parsed = deserializeBoard(data);
    if (parsed === null) {
      this.invalidFormat = true;
      void this.backupInvalid(data);
      notify(
        "warn",
        "File .omniboard.md không đúng định dạng — drawing block thiếu/hỏng. File được giữ nguyên, đã tạo bản sao lưu .bak cạnh file.",
        10000
      );
      return;
    }
    this.invalidFormat = false;
    this.model = parsed;
    this.diskModel = JSON.stringify(parsed);
    this.localEdits = false;
    if (this.canvas) {
      // Echo-skip: compare models semantically (the serialized markdown is not
      // stable byte-wise because the text mirror depends on label order).
      const current = JSON.stringify(this.canvas.getModel());
      if (JSON.stringify(parsed) === current) return;
      // A reload of the same file (outside change) keeps the user's zoom / pan.
      this.canvas.loadModel(this.model, { keepView: this.applyingDisk });
      emitBpmnIssuesRefresh();
    }
  }

  // view → Obsidian (on save)
  getViewData(): string {
    if (this.invalidFormat) return this.rawData; // never clobber an unparseable file
    if (this.canvas) this.model = this.canvas.getModel();
    if (this.writing) {
      // The base save() writes exactly this: from now on it is what's on disk.
      this.diskModel = JSON.stringify(this.model);
      this.localEdits = false;
    }
    return serializeBoard(this.model, this.rawData, this.pendingSourceMeta ?? undefined, {
      compressDrawingData: this.plugin.settings.compressDrawingData,
      bpmnXml: this.cachedBpmnXml,
    });
  }

  /**
   * Override the persist path so the derived `omniboard-bpmn-xml` block can be
   * refreshed via the async `exportBpmn(model)` pipeline before the sync
   * `getViewData()` is invoked by the framework. Best-effort: on failure the
   * derived block is dropped, never the master canvas data.
   */
  async save(clear?: boolean): Promise<void> {
    if (!this.invalidFormat) {
      if (this.canvas) this.model = this.canvas.getModel();
      const start = performance.now();
      try {
        const xml = await exportBpmn(this.model, this.pendingSourceMeta ?? undefined);
        this.cachedBpmnXml = xml;
      } catch (err) {
        this.cachedBpmnXml = ""; // explicitly drop the stale derived block
        console.warn("[omniboard] BPMN regen failed; dropping derived block", err);
      }
      const elapsed = performance.now() - start;
      if (elapsed > 100) {
        console.warn(`[omniboard] BPMN regen took ${elapsed.toFixed(1)}ms`);
      }
    }
    // Never write over a disk change we haven't seen: load it or ask first.
    if (this.conflict) return;
    if (this.invalidFormat || !this.file) return super.save(clear);
    await this.writeBoard(clear);
  }

  /**
   * The base TextFileView.save, but the write is conditional and atomic: it
   * only lands if the disk still holds the board we loaded / last wrote,
   * checked inside the same vault.process (no window for an outside write
   * between check and write). Otherwise nothing is written and the outside
   * change is loaded or asked about.
   */
  private async writeBoard(clear?: boolean): Promise<void> {
    const base = this as unknown as { data: string | null; lastSavedData: string | null; dirty: boolean };
    const file = this.file;
    if (!file || base.lastSavedData === null) return;      // not loaded yet
    if (this.saving) { this.saveAgain = true; return; }
    const expected = this.diskModel;
    this.writing = true;
    let text: string;
    try { text = this.getViewData(); }                     // also marks it as what's on disk
    finally { this.writing = false; }
    base.dirty = false;
    if (text === base.lastSavedData) return;
    this.saving = true;
    try {
      const wrote = await writeIfUnchanged(this.app.vault, file, (disk) => {
        const fp = BoardView.fingerprint(disk);
        return fp === null || fp === expected;
      }, text);
      if (!wrote) {
        this.diskModel = expected;
        this.localEdits = true;
        await this.checkDisk();
        return;
      }
      base.data = text;
      base.lastSavedData = text;
      if (clear) { base.data = null; base.lastSavedData = null; this.clear(); }
    } catch (err) {
      this.diskModel = expected;
      this.localEdits = true;
      console.error("[omniboard] save failed", err);
      notify("error", `Lưu board lỗi: ${(err as Error).message}`);
    } finally {
      this.saving = false;
      if (this.saveAgain) { this.saveAgain = false; void this.save(); }
    }
  }

  clear(): void { this.model = EMPTY_MODEL; }

  /** Save a one-time copy of unparseable data next to the file (data safety, spec §8). */
  private async backupInvalid(data: string): Promise<void> {
    if (!this.file || !data.trim()) return;
    const path = this.file.path + ".bak";
    try {
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing) {
        if ((await this.app.vault.read(existing as never)) === data) return; // already backed up
        await this.app.vault.modify(existing as never, data);
      } else {
        await this.app.vault.create(path, data);
      }
    } catch { /* backup is best-effort; never block the view */ }
  }

  /** Open a hidden file input to let the user pick a diagram file to import. */
  private openImportPicker(): void {
    if (!this.canvas) return;
    const input = document.createElement("input");
    input.type = "file";
    const exts = FORMATS.flatMap((f) => f.extensions.map((e) => "." + e));
    input.accept = exts.join(",");
    input.style.display = "none";
    input.onchange = async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        const raw = await file.text();
        let result;
        if (/\.(bpmn|bpmn2|xml)$/i.test(file.name) && /xmlns[^=]*=["']http:\/\/www\.omg\.org\/spec\/BPMN/i.test(raw.slice(0, 4096))) {
          const { inspectBpmnDiagrams } = await import("../io/bpmn/import");
          const { diagramCount, diagrams } = await inspectBpmnDiagrams(raw);
          let diagramIndex = 0;
          if (diagramCount > 1) {
            diagramIndex = await new Promise<number | null>((resolve) => {
              new DiagramPickerModal(this, diagrams, (idx) => resolve(idx), () => resolve(null)).open();
            }) ?? -1;
            if (diagramIndex < 0) return;
          }
          result = await importFromFile(file.name, raw, { diagramIndex });
        } else {
          result = await importFromFile(file.name, raw);
        }
        const { added } = this.canvas!.mergeModel(result.model);
        // Stash the source meta on the view; on next save it gets serialised
        // into the .omniboard.md so export can round-trip later.
        this.pendingSourceMeta = result.sourceMeta as SourceMeta;
        this.requestSave();
        notify(
          "success",
          `Đã import ${added} phần tử từ ${file.name}` +
          (result.warnings.length ? ` (${result.warnings.length} cảnh báo)` : "")
        );
        if (result.warnings.length) {
          for (const w of result.warnings.slice(0, 5)) notify("warn", w, 6000);
        }
        emitBpmnIssuesRefresh();
      } catch (err) {
        notify("error", `Import lỗi: ${(err as Error).message}`, 8000);
      }
    };
    document.body.appendChild(input);
    input.click();
  }

  private pendingSourceMeta: SourceMeta | null = null;

  /** Open the find box (the Command Palette way, when Obsidian takes Ctrl+F first). */
  findOnBoard(): void { this.canvas?.openSearch(); }

  /** Show another diagram of the BPMN file this board came from; the edits so far go into the file first. */
  async switchDiagram(): Promise<void> {
    if (!this.canvas) return;
    const meta = this.pendingSourceMeta ?? ((await import("./boardSerde")).deserializeSourceMeta(this.rawData) as SourceMeta | null);
    const raw = meta?.format === "bpmn" ? String((meta.payload as { raw?: string } | undefined)?.raw ?? "") : "";
    if (!raw) { notify("warn", "Board này không đến từ một file BPMN."); return; }
    try {
      const { inspectBpmnDiagrams } = await import("../io/bpmn/import");
      const shown = Number((meta!.payload as { diagramIndex?: number }).diagramIndex ?? 0);
      const others = (await inspectBpmnDiagrams(raw)).diagrams.filter((d) => !d.subProcess && d.index !== shown);
      if (!others.length) { notify("info", "File BPMN chỉ có một sơ đồ."); return; }
      const index = await new Promise<number | null>((resolve) => {
        new DiagramPickerModal(this, others, (i) => resolve(i), () => resolve(null)).open();
      });
      if (index === null) return;
      const { switchBpmnDiagram } = await import("../io/bpmn/switchDiagram");
      const prev = this.canvas.getModel();
      const next = await switchBpmnDiagram(prev, meta!, index);
      this.pendingSourceMeta = next.sourceMeta;
      this.model = prev.appState ? { ...next.model, appState: prev.appState } : next.model;
      this.canvas.loadModel(this.model);   // a new document: undo does not cross it
      this.requestSave();
      notify("success", `Đang xem sơ đồ #${index + 1} của file BPMN`);
    } catch (err) {
      notify("error", `Không chuyển được sơ đồ: ${(err as Error).message}`, 8000);
    }
  }

  private async handleExportFormat(formatId: string): Promise<void> {
    if (!this.canvas || !this.file) return;
    const fmt = findById(formatId as never);
    if (!fmt) return;
    try {
      const model = this.canvas.getModel();
      if (fmt.id === "bpmn" && this.plugin.settings.validateBpmnBeforeExport) {
        const issues = validateBpmnModel(model);
        const errors = issues.filter((i) => i.severity === "error");
        const warns = issues.filter((i) => i.severity === "warn");
        if (errors.length) {
          notify("error", `BPMN export bị chặn: ${errors.length} lỗi semantic.`);
          for (const i of errors.slice(0, 6)) notify("error", `[${i.code}] ${i.message}`, 8000);
          for (const i of warns.slice(0, 3)) notify("warn", `[${i.code}] ${i.message}`, 6000);
          return;
        }
        for (const i of warns.slice(0, 6)) notify("warn", `[${i.code}] ${i.message}`, 6000);
      }
      const meta: SourceMeta | null =
        this.pendingSourceMeta ??
        ((await import("./boardSerde")).deserializeSourceMeta(this.rawData) as SourceMeta | null);
      const text = await fmt.exporter(model, meta);
      const ext = fmt.extensions[0];
      const mime =
        ext === "bpmn" || ext === "bpmn2" ? "application/xml" :
        ext === "dbml" ? "text/plain" :
        "text/plain";
      const saved = await saveToLocal(text, this.suggestedName("." + ext), mime);
      if (saved) notify("success", `Đã export ${fmt.displayName}: ${saved}`);
    } catch (err) {
      notify("error", `Export ${fmt.displayName} lỗi: ${(err as Error).message}`, 8000);
    }
  }

  /** Save current state then switch the leaf to the default markdown view. */
  async openAsMarkdown(): Promise<void> {
    if (!this.file) return;
    await this.save();
    await this.leaf.setViewState({ type: "markdown", state: { file: this.file.path } });
  }

  async onClose(): Promise<void> {
    // Story 7-4: clear the selection handler BEFORE unmount so any pending
    // X6 selection events during teardown don't fire into a half-disposed
    // properties panel.
    this.canvas?.setSelectionChangeHandler(null);
    cancelAnimationFrame(this.sideFrame);
    this.side = null;
    // Unmount the Preact tree → OmniboardCanvasMount's useEffect cleanup
    // calls `canvas.destroy()` exactly once (idempotent via destroyedRef
    // guard added in Story 7-3). This replaces the previous direct
    // `this.canvas.destroy()` call.
    if (this.host) {
      render(null, this.host);
    }
    this.canvas = null;
    emitBpmnIssuesRefresh();
  }
}
