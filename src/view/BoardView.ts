import { TextFileView, WorkspaceLeaf, setIcon, Notice, Menu, Modal } from "obsidian";
import { OmniboardCanvas } from "../canvas/OmniboardCanvas";
import type { CanvasModel } from "../canvas/types";
import { registerAllShapes, SHAPE_CATEGORIES } from "../canvas/shapes/index";
import { serializeBoard, deserializeBoard } from "./boardSerde";
import { importFromFile } from "../io/dispatcher";
import { findById, FORMATS } from "../io/registry";
import type { SourceMeta } from "../io/types";
import { emitOmniboardSelectionChange, OMNIBOARD_PROPERTIES_VIEW_TYPE } from "../ui/PropertiesPanel";
import { emitBpmnIssuesRefresh, OMNIBOARD_ISSUES_VIEW_TYPE } from "../ui/BpmnIssuesView";
import { validateBpmnModel } from "../io/bpmn/validator";
import type DiagramsPlugin from "../main";

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
 * Excalidraw-style full-screen board view. One file = one board.
 * Opening the file opens the canvas directly — no code block, no modal.
 */
export class BoardView extends TextFileView {
  private canvas: OmniboardCanvas | null = null;
  private host: HTMLElement | null = null;
  private boardTitleEl: HTMLElement | null = null;
  private model: CanvasModel = EMPTY_MODEL;
  private rawData = "";
  private invalidFormat = false;
  private readonly plugin: DiagramsPlugin;

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

    this.host = this.contentEl.createDiv({ cls: "da-board-host" });
    this.host.style.cssText = "position:relative; flex:1; min-height:0;";

    this.canvas = new OmniboardCanvas(this.host, SHAPE_CATEGORIES, () => { this.requestSave(); emitBpmnIssuesRefresh(); });
    this.canvas.setSelectionChangeHandler(emitOmniboardSelectionChange);
    this.canvas.loadModel(this.model);
    emitBpmnIssuesRefresh();
  }

  private buildTopBar(): void {
    const bar = this.contentEl.createDiv({ cls: "da-topbar" });

    const close = bar.createEl("button", { cls: "da-tb-close" });
    setIcon(close, "x");
    close.createSpan({ text: "Đóng" });
    close.onclick = () => this.leaf.detach();

    const badge = bar.createDiv({ cls: "da-tb-badge" });
    setIcon(badge, "shapes");
    badge.createSpan({ text: "BOARD" });

    this.boardTitleEl = bar.createDiv({ cls: "da-tb-title", text: this.file?.basename ?? "Board" });

    bar.createDiv({ cls: "da-tb-grow" });

    const iconBtn = (icon: string, tip: string, fn: () => void) => {
      const b = bar.createEl("button", { cls: "da-tb-ic" });
      setIcon(b, icon); b.setAttribute("aria-label", tip); b.title = tip; b.onclick = fn;
      return b;
    };
    iconBtn("undo-2", "Undo", () => this.canvas?.undo());
    iconBtn("redo-2", "Redo", () => this.canvas?.redo());
    iconBtn("copy", "Nhân bản (⌘D)", () => this.canvas?.duplicate());
    iconBtn("trash-2", "Xóa", () => this.canvas?.deleteSelection());
    iconBtn("sliders-horizontal", "BPMN properties", () => this.openPropertiesLeaf());
    iconBtn("alert-triangle", "BPMN issues", () => this.openIssuesLeaf());
    const layoutBtn = iconBtn("workflow", "Tự sắp xếp (auto layout)", () => {
      const m = new Menu();
      m.addItem((i) => i.setTitle("Sắp xếp ngang →").setIcon("arrow-right").onClick(() => this.canvas?.autoLayout("LR")));
      m.addItem((i) => i.setTitle("Sắp xếp dọc ↓").setIcon("arrow-down").onClick(() => this.canvas?.autoLayout("TB")));
      const r = layoutBtn.getBoundingClientRect();
      m.showAtPosition({ x: r.left, y: r.bottom + 4 });
    });
    bar.createDiv({ cls: "da-tb-divider" });
    iconBtn("file-text", "Mở dưới dạng Markdown", () => this.openAsMarkdown());
    const imp = bar.createEl("button", { cls: "da-tb-ic" });
    setIcon(imp, "upload"); imp.setAttribute("aria-label", "Import");
    imp.title = "Import (BPMN / DBML)";
    imp.onclick = () => this.openImportPicker();
    const exp = bar.createEl("button", { cls: "da-tb-ic" });
    setIcon(exp, "download"); exp.setAttribute("aria-label", "Export"); exp.title = "Export (SVG / PNG / BPMN / DBML)";
    exp.onclick = (e) => this.showExportMenu(e);

    const save = bar.createEl("button", { cls: "da-tb-save" });
    setIcon(save, "check");
    save.createSpan({ text: "Lưu & đóng" });
    save.onclick = async () => { await this.save(); this.leaf.detach(); };
  }

  getCanvas(): OmniboardCanvas | null {
    return this.canvas;
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
    if (this.canvas) {
      // Echo-skip: compare models semantically (the serialized markdown is not
      // stable byte-wise because the text mirror depends on label order).
      const current = JSON.stringify(this.canvas.getModel());
      if (JSON.stringify(parsed) === current) return;
      this.canvas.loadModel(this.model);
      emitBpmnIssuesRefresh();
    }
  }

  // view → Obsidian (on save)
  getViewData(): string {
    if (this.invalidFormat) return this.rawData; // never clobber an unparseable file
    if (this.canvas) this.model = this.canvas.getModel();
    return serializeBoard(this.model, this.rawData, this.pendingSourceMeta ?? undefined);
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
    this.canvas?.setSelectionChangeHandler(null);
    this.canvas?.destroy();
    this.canvas = null;
    emitBpmnIssuesRefresh();
  }
}
