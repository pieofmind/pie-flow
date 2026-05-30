import { TextFileView, WorkspaceLeaf, setIcon, Notice, Menu } from "obsidian";
import { LarkCanvas } from "../canvas/LarkCanvas";
import type { CanvasModel } from "../canvas/types";
import { registerAllShapes, SHAPE_CATEGORIES } from "../canvas/shapes/index";

registerAllShapes();

export const BOARD_VIEW_TYPE = "omniboard-board";
export const BOARD_EXTENSION = "board";

const EMPTY_MODEL: CanvasModel = { nodes: [], edges: [] };

/**
 * Excalidraw-style full-screen board view. One file = one board.
 * Opening the file opens the canvas directly — no code block, no modal.
 */
export class BoardView extends TextFileView {
  private canvas: LarkCanvas | null = null;
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

    this.canvas = new LarkCanvas(this.host, SHAPE_CATEGORIES, () => this.requestSave());
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
    const exp = bar.createEl("button", { cls: "da-tb-ic" });
    setIcon(exp, "download"); exp.setAttribute("aria-label", "Export"); exp.title = "Export (SVG / PNG)";
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
    menu.showAtMouseEvent(e);
  }

  private async handleExportPdf(): Promise<void> {
    if (!this.canvas || !this.file) return;
    try {
      const bytes = await this.canvas.exportPDF();
      const path = this.file.path.replace(/\.board$/, ".pdf");
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing) await this.app.vault.modifyBinary(existing as never, bytes.buffer as ArrayBuffer);
      else await this.app.vault.createBinary(path, bytes.buffer as ArrayBuffer);
      new Notice(`✅ Đã export: ${path}`);
    } catch {
      new Notice("❌ Export PDF lỗi");
    }
  }

  private async handleCopyMermaid(): Promise<void> {
    if (!this.canvas) return;
    try {
      await navigator.clipboard.writeText(this.canvas.exportMermaid());
      new Notice("✅ Đã copy Mermaid vào clipboard");
    } catch {
      new Notice("❌ Copy Mermaid lỗi");
    }
  }

  private async handleExportSvg(): Promise<void> {
    if (!this.canvas || !this.file) return;
    try {
      const svg = this.canvas.exportSVG();
      const path = this.file.path.replace(/\.board$/, ".svg");
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing) await this.app.vault.modify(existing as never, svg);
      else await this.app.vault.create(path, svg);
      new Notice(`✅ Đã export: ${path}`);
    } catch {
      new Notice("❌ Export SVG lỗi");
    }
  }

  private async handleExportPng(scale: number): Promise<void> {
    if (!this.canvas || !this.file) return;
    try {
      const blob = await this.canvas.exportPNG(scale);
      const buf = await blob.arrayBuffer();
      const suffix = scale === 1 ? ".png" : `@${scale}x.png`;
      const path = this.file.path.replace(/\.board$/, suffix);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing) await this.app.vault.modifyBinary(existing as never, buf);
      else await this.app.vault.createBinary(path, buf);
      new Notice(`✅ Đã export: ${path}`);
    } catch {
      new Notice("❌ Export PNG lỗi");
    }
  }

  // Obsidian → view
  setViewData(data: string, _clear: boolean): void {
    this.rawData = data;
    if (this.boardTitleEl) this.boardTitleEl.setText(this.file?.basename ?? "Board");
    const parsed = this.parse(data);
    if (parsed === null) {
      // Valid file but wrong schema (e.g. Excalidraw JSON). Don't render an
      // empty canvas silently, and refuse to overwrite — preserves the data.
      this.invalidFormat = true;
      void this.backupInvalid(data);
      new Notice(
        "⚠️ File .board không đúng định dạng {nodes, edges} — không hiển thị được. " +
        "Có thể đã bị ghi bằng schema khác (vd Excalidraw). File được giữ nguyên, " +
        "đã tạo bản sao lưu .bak cạnh file.",
        10000
      );
      return;
    }
    this.invalidFormat = false;
    this.model = parsed;
    if (this.canvas) {
      // Skip reload only if the incoming data is identical to what's already on
      // the canvas (our own save echo) — avoids wiping selection mid-edit.
      // Compared live against canvas state, so a fresh/reused view never blocks
      // a real load.
      if (data === JSON.stringify(this.canvas.getModel(), null, 2)) return;
      this.canvas.loadModel(this.model);
    }
  }

  // view → Obsidian (on save)
  getViewData(): string {
    if (this.invalidFormat) return this.rawData; // never clobber an unparseable file
    if (this.canvas) this.model = this.canvas.getModel();
    return JSON.stringify(this.model, null, 2);
  }

  clear(): void { this.model = EMPTY_MODEL; }

  /** Returns the parsed model, or null if the JSON isn't a valid board schema. */
  private parse(data: string): CanvasModel | null {
    const t = data.trim();
    if (!t) return { nodes: [], edges: [] };
    try {
      const m = JSON.parse(t) as CanvasModel;
      if (Array.isArray(m.nodes) && Array.isArray(m.edges)) return m;
    } catch { /* not JSON */ }
    return null;
  }

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

  async onClose(): Promise<void> {
    this.canvas?.destroy();
    this.canvas = null;
  }
}
