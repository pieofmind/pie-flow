import { TextFileView, WorkspaceLeaf, setIcon, Notice, Menu } from "obsidian";
import { OmniboardCanvas } from "../canvas/OmniboardCanvas";
import type { CanvasModel } from "../canvas/types";
import { registerAllShapes, SHAPE_CATEGORIES } from "../canvas/shapes/index";
import { serializeBoard, deserializeBoard } from "./boardSerde";
import { importFromFile } from "../io/dispatcher";
import { findById, FORMATS } from "../io/registry";

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

export const BOARD_VIEW_TYPE = "omniboard-board";
export const BOARD_EXTENSION = "omniboard.md";
const EXT_RE = /\.omniboard\.md$/;

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

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
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

    this.canvas = new OmniboardCanvas(this.host, SHAPE_CATEGORIES, () => this.requestSave());
    this.canvas.loadModel(this.model);
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

  private async handleExportPdf(): Promise<void> {
    if (!this.canvas || !this.file) return;
    try {
      const bytes = await this.canvas.exportPDF();
      const path = this.file.path.replace(EXT_RE, ".pdf");
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing) await this.app.vault.modifyBinary(existing as never, bytes.buffer as ArrayBuffer);
      else await this.app.vault.createBinary(path, bytes.buffer as ArrayBuffer);
      notify("success", `Đã export: ${path}`);
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
      const path = this.file.path.replace(EXT_RE, ".svg");
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing) await this.app.vault.modify(existing as never, svg);
      else await this.app.vault.create(path, svg);
      notify("success", `Đã export: ${path}`);
    } catch {
      notify("error", "Export SVG lỗi");
    }
  }

  private async handleExportPng(scale: number): Promise<void> {
    if (!this.canvas || !this.file) return;
    try {
      const blob = await this.canvas.exportPNG(scale);
      const buf = await blob.arrayBuffer();
      const suffix = scale === 1 ? ".png" : `@${scale}x.png`;
      const path = this.file.path.replace(EXT_RE, suffix);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing) await this.app.vault.modifyBinary(existing as never, buf);
      else await this.app.vault.createBinary(path, buf);
      notify("success", `Đã export: ${path}`);
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
        const result = await importFromFile(file.name, raw);
        const { added } = this.canvas!.mergeModel(result.model);
        // Stash the source meta on the view; on next save it gets serialised
        // into the .omniboard.md so export can round-trip later.
        this.pendingSourceMeta = result.sourceMeta;
        this.requestSave();
        notify(
          "success",
          `Đã import ${added} phần tử từ ${file.name}` +
          (result.warnings.length ? ` (${result.warnings.length} cảnh báo)` : "")
        );
        if (result.warnings.length) {
          for (const w of result.warnings.slice(0, 5)) notify("warn", w, 6000);
        }
      } catch (err) {
        notify("error", `Import lỗi: ${(err as Error).message}`, 8000);
      }
    };
    document.body.appendChild(input);
    input.click();
  }

  private pendingSourceMeta: unknown = null;

  private async handleExportFormat(formatId: string): Promise<void> {
    if (!this.canvas || !this.file) return;
    const fmt = findById(formatId as never);
    if (!fmt) return;
    try {
      const meta = this.pendingSourceMeta ??
        (await import("./boardSerde")).deserializeSourceMeta(this.rawData);
      const text = await fmt.exporter(this.canvas.getModel(), (meta as never) ?? null);
      const ext = fmt.extensions[0];
      const path = this.file.path.replace(EXT_RE, "." + ext);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing) await this.app.vault.modify(existing as never, text);
      else await this.app.vault.create(path, text);
      notify("success", `Đã export ${fmt.displayName}: ${path}`);
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
    this.canvas?.destroy();
    this.canvas = null;
  }
}
