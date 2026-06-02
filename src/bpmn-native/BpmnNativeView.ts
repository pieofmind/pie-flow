/**
 * BpmnNativeView — Obsidian TextFileView for `.bpmn` files.
 *
 * Opens BPMN XML, renders via bpmn-js Modeler through BpmnNativeController,
 * auto-saves on edit, and cleans up on close.
 *
 * View-local lifecycle: one controller per view, no module-level mutable state.
 */
import { TextFileView, WorkspaceLeaf, Notice, setIcon, Menu, normalizePath } from "obsidian";
import { BpmnNativeController } from "./BpmnNativeController";
import type DiagramsPlugin from "../main";
import {
  OMNIBOARD_SUFFIX,
  isOmniboardMarkdown,
  deserializeBoard,
  deserializeBpmnXml,
  deserializeSourceMeta,
  serializeBoard,
} from "../view/boardSerde";
import { importBpmn } from "../io/bpmn/import";
import { exportBpmn } from "../io/bpmn/export";
import { mergeBpmnImport, collectIds } from "../view/mergeBpmnCanvas";
import type { CanvasModel } from "../canvas/types";
import type { SourceMeta } from "../io/types";
import { BOARD_VIEW_TYPE } from "../view/BoardView";

export const BPMN_NATIVE_VIEW_TYPE = "bpmn-native";
const BPMN_STYLE_ID = "bpmn-native-styles";
const BPMN_STYLE_FILE = "bpmn-native.css";

const MINIMAL_BPMN_FALLBACK = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  id="defs_omniboard" targetNamespace="http://example.com/omniboard">
  <bpmn:process id="p_omniboard" isExecutable="false"/>
  <bpmndi:BPMNDiagram id="d_omniboard">
    <bpmndi:BPMNPlane id="pl_omniboard" bpmnElement="p_omniboard"/>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

export class BpmnNativeView extends TextFileView {
  private controller: BpmnNativeController;
  private bpmnContainer: HTMLDivElement | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private plugin: DiagramsPlugin;
  private boardTitleEl: HTMLDivElement | null = null;
  private paletteRetryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Wrapper-mode state: when the opened file is a `.omniboard.md` wrapper rather
   * than a raw `.bpmn`, this view drives BPMN editing while round-tripping back
   * into the canvas-master format (Story 4.5).
   *
   * `wrapperRaw` is the last persisted full Markdown body — needed so the save
   * path can re-emit frontmatter, canvas-data, and source-meta blocks verbatim
   * alongside the refreshed BPMN block.
   */
  private isWrapper = false;
  private wrapperRaw = "";
  private wrapperCanvas: CanvasModel = { nodes: [], edges: [] };
  private wrapperBpmnIds: ReadonlySet<string> = new Set();
  private wrapperSourceMeta: SourceMeta | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: DiagramsPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.controller = new BpmnNativeController();
  }

  getViewType(): string {
    return BPMN_NATIVE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "BPMN Native";
  }

  getIcon(): string {
    return "workflow";
  }

  getController(): BpmnNativeController {
    return this.controller;
  }

  /** True when the currently-opened file is a `.omniboard.md` wrapper. */
  isWrapperMode(): boolean {
    return this.isWrapper;
  }

  /**
   * Switch this leaf back to the Omniboard BoardView. Only meaningful for
   * wrapper files (`.omniboard.md`); for raw `.bpmn` files there is no paired
   * board to switch to and the toolbar button is hidden.
   */
  async switchToBoardView(): Promise<void> {
    if (!this.file || !this.isWrapper) return;
    await this.persistXml();
    await this.leaf.setViewState({ type: BOARD_VIEW_TYPE, state: { file: this.file.path } });
  }

  // ── TextFileView contract ──

  getViewData(): string {
    return this.data;
  }

  async setViewData(data: string, clear: boolean): Promise<void> {
    if (clear && this.dirty && this.controller.isMounted) {
      await this.persistXml();
    }
    this.resetPendingSave();
    this.controller.dispose();
    this.data = data;
    this.dirty = false;

    // Wrapper detection: an Omniboard markdown wrapper rather than a raw `.bpmn`.
    // We pivot to canvas-master mode: the markdown is the file-of-record, we
    // only edit its derived BPMN block via the modeler.
    const wrapperByExt = this.file?.path?.endsWith(OMNIBOARD_SUFFIX) ?? false;
    const wrapperByMarker = isOmniboardMarkdown(data);
    // H2: extension alone is NOT authoritative — a user-created `*.omniboard.md`
    // without the plugin marker AND without a valid omniboard-data block must
    // not be treated as a wrapper, else the first BPMN edit rewrites the file
    // body and destroys the user's markdown. Require the marker, OR the
    // extension PLUS a parseable canvas.
    const parsedCanvas = deserializeBoard(data);
    this.isWrapper = wrapperByMarker || (wrapperByExt && parsedCanvas !== null);

    let xmlToMount = data;
    if (this.isWrapper) {
      this.wrapperRaw = data;
      const canvas = parsedCanvas ?? { nodes: [], edges: [] };
      this.wrapperCanvas = canvas;
      this.wrapperSourceMeta = (deserializeSourceMeta(data) as SourceMeta | null) ?? null;

      const existingXml = deserializeBpmnXml(data);
      if (existingXml && existingXml.trim().length) {
        xmlToMount = existingXml;
      } else {
        // Lazy regen: legacy wrappers without a derived block, or files where
        // the previous save dropped the block due to export failure.
        try {
          xmlToMount = await exportBpmn(canvas, this.wrapperSourceMeta ?? undefined);
        } catch (err) {
          console.warn("[BpmnNative] Lazy regen failed; falling back to empty BPMN", err);
          xmlToMount = MINIMAL_BPMN_FALLBACK;
        }
      }

      // Snapshot which IDs the BPMN side currently owns — needed by merge logic
      // on save to distinguish BPMN-managed elements from canvas-only ones.
      try {
        const { model: snapshotImport } = await importBpmn(xmlToMount);
        this.wrapperBpmnIds = collectIds(snapshotImport);
      } catch (err) {
        console.warn("[BpmnNative] Could not snapshot BPMN IDs", err);
        this.wrapperBpmnIds = new Set();
      }
    } else {
      this.wrapperRaw = "";
      this.wrapperCanvas = { nodes: [], edges: [] };
      this.wrapperBpmnIds = new Set();
      this.wrapperSourceMeta = null;
    }

    // H1: rebuild top bar so the wrapper-only "Switch to Omniboard view"
    // button appears. onOpen() runs buildTopBar() before Obsidian calls
    // setViewData(), so isWrapper was still false then and the button was
    // never created.
    this.buildTopBar();

    await this.mountModeler(xmlToMount);
  }

  clear(): void {
    this.resetPendingSave();
    this.data = "";
    this.dirty = false;
    if (this.controller.isMounted) {
      this.controller.dispose();
    }
    if (this.bpmnContainer) {
      this.bpmnContainer.empty();
    }
  }

  // ── Lifecycle ──

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("da-board-view");
    this.contentEl.style.cssText = "padding:0; display:flex; flex-direction:column; height:100%;";

    await this.ensureBpmnStyles();

    this.buildTopBar();

    // Create container
    this.bpmnContainer = this.contentEl.createDiv({ cls: "bpmn-native-root" });
    this.bpmnContainer.style.cssText = "position:relative; flex:1; min-height:0;";
  }

  async onClose(): Promise<void> {
    this.resetPendingSave();

    // Flush unsaved changes
    if (this.dirty && this.controller.isMounted) {
      try {
        await this.persistXml();
      } catch {
        // Best effort save on close
      }
    }

    // Destroy modeler
    this.controller.dispose();

    // Clear DOM
    this.contentEl.empty();
    this.bpmnContainer = null;
  }

  // ── Internal ──

  private async mountModeler(xml: string): Promise<void> {
    if (!this.bpmnContainer) return;

    // Clear previous content
    this.controller.dispose();
    this.bpmnContainer.empty();

    try {
      const { warnings } = await this.controller.mount(
        this.bpmnContainer,
        xml,
        () => this.onModelerChanged(),
      );

      this.createNavigationWidget();
      this.injectPaletteMoreButton();

      if (warnings.length > 0) {
        console.warn("[BpmnNative] Import warnings:", warnings);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[BpmnNative] Import failed:", msg);

      // Show error UI with raw XML fallback
      this.bpmnContainer.empty();

      const errorDiv = this.bpmnContainer.createDiv({ cls: "bpmn-native-error" });
      errorDiv.createEl("h3", { text: "⚠ BPMN Import Error" });
      errorDiv.createEl("p", { text: msg });

      if (xml.trim()) {
        errorDiv.createEl("h4", { text: "Raw XML:" });
        const pre = errorDiv.createEl("pre");
        pre.createEl("code", { text: xml.substring(0, 2000) + (xml.length > 2000 ? "\n..." : "") });
      }
      const sourceBtn = errorDiv.createEl("button", { text: "Mở XML source" });
      sourceBtn.onclick = () => {
        if (this.file) {
          void this.leaf.setViewState({ type: "markdown", state: { file: this.file.path } });
        }
      };

      new Notice(`BPMN import lỗi: ${msg}`, 5000);
    }
  }

  private async onModelerChanged(): Promise<void> {
    this.dirty = true;
    // H3: await flush BEFORE requesting Obsidian save so getViewData() sees
    // the new this.data. Fire-and-forget here would race the debounced
    // framework save and persist stale content.
    try {
      await this.flushModelerData();
    } catch (err) {
      console.error("[BpmnNative] flushModelerData failed in onModelerChanged", err);
    }
    this.requestSave();
    this.scheduleSave();
  }

  /** Debounced save — waits 1.5s after last edit before persisting. */
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persistXml();
    }, 1500);
  }

  private async persistXml(): Promise<void> {
    if (!this.controller.isMounted) return;
    // H4: snapshot the file at entry. If Obsidian swaps `this.file` mid-flight
    // (file switch on the same leaf), abort rather than write fileA's data to
    // fileB.
    const targetFile = this.file;
    try {
      const ok = await this.flushModelerData();
      if (!ok) {
        // Empty modeler XML or wrapper-merge failure — do NOT clear dirty,
        // do NOT call super.save() (would persist stale this.data).
        return;
      }
      if (this.file !== targetFile) {
        console.warn("[BpmnNative] File changed during persistXml; aborting save");
        return;
      }
      await super.save();
      this.dirty = false;
    } catch (err: unknown) {
      console.error("[BpmnNative] Save failed:", err);
    }
  }

  async save(clear?: boolean): Promise<void> {
    const targetFile = this.file;
    const ok = await this.flushModelerData();
    if (!ok) {
      // Mirror persistXml: don't clobber file with stale data.
      return;
    }
    if (this.file !== targetFile) {
      console.warn("[BpmnNative] File changed during save(); aborting");
      return;
    }
    await super.save(clear);
    this.dirty = false;
  }

  /**
   * Sync modeler state into `this.data` (and, for wrappers, into the full
   * `.omniboard.md` body). Returns `true` on success; returns `false` to
   * tell callers to skip super.save() because writing would corrupt the file
   * (empty XML, or wrapper-mode merge failure).
   */
  private async flushModelerData(): Promise<boolean> {
    if (!this.controller.isMounted) return false;
    const xml = await this.controller.saveXml();
    // H5: empty XML means the modeler is in a transient state (mid-mount,
    // mid-dispose, or transformation in flight). Do NOT update this.data and
    // signal the caller to skip super.save(), otherwise we persist stale
    // content and clear dirty.
    if (!xml) return false;

    if (this.isWrapper) {
      // Wrapper mode: BPMN edit must round-trip back into the canvas master.
      // Pipeline: importBpmn(newXml) → mergeBpmnImport(oldCanvas, bpmnIds, newImport)
      // → re-export merged → serialize back to wrapper markdown.
      try {
        const { model: newImport } = await importBpmn(xml);
        const merged = mergeBpmnImport(this.wrapperCanvas, this.wrapperBpmnIds, newImport);
        // Re-export from the merged canvas so the derived block stays consistent
        // with the master canvas-data block, even after merging canvas-only items.
        let derivedXml = xml;
        try {
          derivedXml = await exportBpmn(merged.model, this.wrapperSourceMeta ?? undefined);
        } catch (err) {
          console.warn("[BpmnNative] Re-export after merge failed; storing user XML verbatim", err);
        }
        const fullDoc = serializeBoard(
          merged.model,
          this.wrapperRaw,
          this.wrapperSourceMeta ?? undefined,
          {
            compressDrawingData: this.plugin.settings.compressDrawingData,
            bpmnXml: derivedXml,
          },
        );
        this.data = fullDoc;
        this.wrapperRaw = fullDoc;
        this.wrapperCanvas = merged.model;
        this.wrapperBpmnIds = collectIds(newImport);
        return true;
      } catch (err) {
        // C1: wrapper-mode merge failed. We MUST NOT fall through to
        // `this.data = xml` because that writes raw BPMN XML to a
        // `.omniboard.md` file, destroying frontmatter + master canvas +
        // sticky notes + source-meta. Keep this.data at the previous
        // wrapperRaw and tell the caller to skip super.save() so disk
        // content is left untouched. The user's BPMN edit stays in the
        // modeler — a subsequent edit may succeed, or they can export
        // manually.
        console.error(
          "[BpmnNative] Wrapper merge failed; preserving wrapper on disk (user BPMN edit kept in modeler only)",
          err,
        );
        new Notice("Lưu BPMN thất bại — wrapper trên đĩa được giữ nguyên. Xem console để biết chi tiết.", 6000);
        return false;
      }
    }

    this.data = xml;
    return true;
  }

  private resetPendingSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.paletteRetryTimer) {
      clearTimeout(this.paletteRetryTimer);
      this.paletteRetryTimer = null;
    }
  }

  private async ensureBpmnStyles(): Promise<void> {
    try {
      const css = await this.readBpmnCss();
      const existing = document.getElementById(BPMN_STYLE_ID) as HTMLStyleElement | null;
      const styleEl = existing ?? document.createElement("style");
      styleEl.id = BPMN_STYLE_ID;
      styleEl.textContent = css;
      if (!existing) {
        document.head.appendChild(styleEl);
      }
    } catch (err) {
      console.error("[BpmnNative] Failed to load BPMN CSS:", err);
      new Notice("Không load được BPMN CSS.");
    }
  }

  private async readBpmnCss(): Promise<string> {
    const dir = this.plugin.manifest.dir;
    if (!dir) throw new Error("Plugin manifest dir is unavailable");
    return await this.app.vault.adapter.read(normalizePath(`${dir}/${BPMN_STYLE_FILE}`));
  }

  private buildTopBar(): void {
    // Idempotent: remove existing topbar so callers can rebuild after
    // isWrapper / file changes (H1).
    const existing = this.contentEl.querySelector(":scope > .da-topbar");
    if (existing) existing.remove();

    const bar = this.contentEl.createDiv({ cls: "da-topbar" });
    // Ensure topbar precedes the bpmn container in DOM order even when
    // rebuilt after onOpen (CSS flex order does not change semantic order
    // for screen readers / keyboard nav).
    if (this.bpmnContainer && bar.nextSibling !== this.bpmnContainer) {
      this.contentEl.insertBefore(bar, this.bpmnContainer);
    }

    // Close button
    const close = bar.createEl("button", { cls: "da-tb-close" });
    setIcon(close, "x");
    close.createSpan({ text: "Đóng" });
    close.onclick = () => this.leaf.detach();

    // Badge
    const badge = bar.createDiv({ cls: "da-tb-badge" });
    setIcon(badge, "workflow");
    badge.createSpan({ text: "BPMN NATIVE" });

    // Title
    this.boardTitleEl = bar.createDiv({ cls: "da-tb-title", text: this.file?.basename ?? "BPMN Diagram" });

    // Spacer
    bar.createDiv({ cls: "da-tb-grow" });

    // Properties button
    const propsBtn = bar.createEl("button", { cls: "da-tb-ic" });
    setIcon(propsBtn, "sliders-horizontal");
    propsBtn.setAttribute("aria-label", "BPMN properties");
    propsBtn.title = "BPMN properties";
    propsBtn.onclick = () => {
      const leaf = this.plugin.app.workspace.getRightLeaf(false);
      if (leaf) {
        void leaf.setViewState({ type: "bpmn-properties", active: true });
      }
    };

    if (this.isWrapper) {
      const switchBtn = bar.createEl("button", { cls: "da-tb-ic" });
      setIcon(switchBtn, "shapes");
      switchBtn.setAttribute("aria-label", "Switch to Omniboard view");
      switchBtn.title = "Switch to Omniboard view";
      switchBtn.onclick = () => void this.switchToBoardView();
    }

    bar.createDiv({ cls: "da-tb-divider" });

    // Import button (load .bpmn from disk into current modeler)
    const imp = bar.createEl("button", { cls: "da-tb-ic" });
    setIcon(imp, "upload");
    imp.setAttribute("aria-label", "Import .bpmn");
    imp.title = "Import .bpmn file";
    imp.onclick = () => void this.handleImportBpmn();

    // Export button
    const exp = bar.createEl("button", { cls: "da-tb-ic" });
    setIcon(exp, "download");
    exp.setAttribute("aria-label", "Export");
    exp.title = "Export BPMN / SVG / PNG";
    exp.onclick = (e) => this.showExportMenu(e);

    // Save & Close button
    const save = bar.createEl("button", { cls: "da-tb-save" });
    setIcon(save, "check");
    save.createSpan({ text: "Lưu & đóng" });
    save.onclick = async () => {
      await this.persistXml();
      this.leaf.detach();
    };
  }

  private createNavigationWidget(): void {
    if (!this.bpmnContainer) return;
    
    const widget = this.bpmnContainer.createDiv({ cls: "bpmn-nav-widget" });
    
    const btn = (icon: string, title: string, onClick: () => void) => {
      const b = widget.createEl("button", { cls: "bpmn-nav-btn" });
      setIcon(b, icon);
      b.title = title;
      b.onclick = onClick;
    };
    
    btn("plus-circle", "Zoom In", () => {
      if (this.controller.isMounted) {
        this.controller.zoom(this.controller.getZoom() * 1.2);
      }
    });
    
    btn("minus-circle", "Zoom Out", () => {
      if (this.controller.isMounted) {
        this.controller.zoom(this.controller.getZoom() * 0.8);
      }
    });
    
    btn("maximize", "Fit Viewport", () => {
      if (this.controller.isMounted) {
        this.controller.zoom("fit-viewport");
      }
    });
  }

  private injectPaletteMoreButton(): void {
    if (!this.controller.isMounted || !this.bpmnContainer) return;
    
    const paletteEntries = this.bpmnContainer.querySelector(".djs-palette-entries");
    if (!paletteEntries) {
      this.paletteRetryTimer = setTimeout(() => {
        this.paletteRetryTimer = null;
        this.injectPaletteMoreButton();
      }, 50);
      return;
    }
    
    if (paletteEntries.querySelector(".bpmn-custom-more-btn")) {
      return;
    }

    const separator = document.createElement("div");
    separator.className = "separator";
    paletteEntries.appendChild(separator);

    const moreBtn = document.createElement("div");
    moreBtn.className = "entry bpmn-custom-more-btn";
    moreBtn.setAttribute("title", "Create element");
    moreBtn.setAttribute("aria-label", "Create element");
    
    setIcon(moreBtn, "more-horizontal");
    
    moreBtn.onclick = (e) => {
      this.showCreateElementMenu(e);
    };

    paletteEntries.appendChild(moreBtn);
  }

  private showCreateElementMenu(e: MouseEvent): void {
    const menu = new Menu();

    const addShape = (title: string, type: string, iconKey: string, attrs?: any) => {
      menu.addItem((i) => {
        i
          .setTitle(title)
          .setIcon(iconKey) // Native Obsidian icon loading
          .onClick(() => {
            if (this.controller.isMounted) {
              try {
                this.controller.startCreateShape(e, type, attrs);
              } catch (err) {
                console.error("[BpmnNative] Create shape failed:", err);
              }
            }
          });
      });
    };

    menu.addItem((i) => i.setTitle("--- TASKS & ACTIVITIES ---").setDisabled(true));
    addShape("Generic Task", "bpmn:Task", "bpmn-task");
    addShape("User Task", "bpmn:UserTask", "bpmn-user-task");
    addShape("Service Task", "bpmn:ServiceTask", "bpmn-service-task");
    addShape("Script Task", "bpmn:ScriptTask", "bpmn-script-task");
    addShape("Business Rule Task", "bpmn:BusinessRuleTask", "bpmn-business-rule-task");
    addShape("Send Task", "bpmn:SendTask", "bpmn-send-task");
    addShape("Receive Task", "bpmn:ReceiveTask", "bpmn-receive-task");
    addShape("Manual Task", "bpmn:ManualTask", "bpmn-manual-task");
    addShape("Call Activity", "bpmn:CallActivity", "bpmn-call-activity");
    addShape("Sub Process (Expanded)", "bpmn:SubProcess", "bpmn-sub-process", { isExpanded: true });
    addShape("Transaction (Expanded)", "bpmn:Transaction", "bpmn-transaction", { isExpanded: true });
    addShape("Event Sub Process (Expanded)", "bpmn:SubProcess", "bpmn-event-sub-process", { isExpanded: true, triggeredByEvent: true });

    menu.addItem((i) => i.setTitle("--- GATEWAYS ---").setDisabled(true));
    addShape("Exclusive Gateway (XOR)", "bpmn:ExclusiveGateway", "bpmn-gateway-xor");
    addShape("Parallel Gateway (AND)", "bpmn:ParallelGateway", "bpmn-gateway-and");
    addShape("Inclusive Gateway (OR)", "bpmn:InclusiveGateway", "bpmn-gateway-or");
    addShape("Complex Gateway", "bpmn:ComplexGateway", "bpmn-gateway-complex");
    addShape("Event-Based Gateway", "bpmn:EventBasedGateway", "bpmn-gateway-event");

    menu.addItem((i) => i.setTitle("--- EVENTS ---").setDisabled(true));
    addShape("Start Event", "bpmn:StartEvent", "bpmn-start-event");
    addShape("Intermediate Catch Event", "bpmn:IntermediateCatchEvent", "bpmn-catch-event");
    addShape("Intermediate Throw Event", "bpmn:IntermediateThrowEvent", "bpmn-throw-event");
    addShape("Boundary Event", "bpmn:BoundaryEvent", "bpmn-boundary-event");
    addShape("End Event", "bpmn:EndEvent", "bpmn-end-event");

    menu.addItem((i) => i.setTitle("--- DATA & COLLABORATION ---").setDisabled(true));
    addShape("Data Object Reference", "bpmn:DataObjectReference", "bpmn-data-object");
    addShape("Data Store Reference", "bpmn:DataStoreReference", "bpmn-data-store");
    addShape("Data Input", "bpmn:DataInput", "bpmn-data-input");
    addShape("Data Output", "bpmn:DataOutput", "bpmn-data-output");
    addShape("Pool / Participant", "bpmn:Participant", "bpmn-participant");
    addShape("Lane", "bpmn:Lane", "bpmn-lane");
    addShape("Group", "bpmn:Group", "bpmn-group");
    addShape("Text Annotation", "bpmn:TextAnnotation", "bpmn-text-annotation");

    const target = e.currentTarget as HTMLElement;
    if (target) {
      const rect = target.getBoundingClientRect();
      if (target.classList.contains("bpmn-custom-more-btn") || target.closest(".djs-palette")) {
        menu.showAtPosition({ x: rect.right + 8, y: rect.top });
      } else {
        menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
      }
    }
  }

  private showExportMenu(e: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((i) =>
      i
        .setTitle("Export as .bpmn (XML)")
        .setIcon("file-code-2")
        .onClick(() => void this.handleExportBpmn())
    );
    menu.addItem((i) =>
      i
        .setTitle("Export as SVG")
        .setIcon("file-code")
        .onClick(() => void this.handleExportSvg())
    );
    menu.addItem((i) =>
      i
        .setTitle("Export as PNG (2x)")
        .setIcon("image")
        .onClick(() => void this.handleExportPng())
    );

    const target = e.currentTarget as HTMLElement;
    if (target) {
      const rect = target.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
    }
  }

  private async handleExportBpmn(): Promise<void> {
    if (!this.controller.isMounted) return;
    try {
      const xml = await this.controller.saveXml();
      if (!xml) {
        new Notice("Không lấy được BPMN XML từ modeler.");
        return;
      }
      const saved = await saveToLocal(xml, this.suggestedName(".bpmn"), "application/xml");
      if (saved) new Notice(`Đã export BPMN: ${saved}`);
    } catch (err) {
      console.error("[BpmnNative] Export BPMN failed:", err);
      new Notice("Export BPMN lỗi.");
    }
  }

  private async handleImportBpmn(): Promise<void> {
    const xml = await pickLocalBpmnFile();
    if (!xml) return; // user cancelled
    if (this.dirty) {
      const proceed = confirm(
        "Modeler đang có thay đổi chưa lưu. Import sẽ ghi đè nội dung hiện tại. Tiếp tục?",
      );
      if (!proceed) return;
    }
    try {
      await this.mountModeler(xml);
      this.dirty = true;
      // Persist into current file via the normal flush path so wrapper or
      // raw `.bpmn` files both round-trip correctly.
      await this.persistXml();
      new Notice("Đã import BPMN.");
    } catch (err) {
      console.error("[BpmnNative] Import BPMN failed:", err);
      new Notice("Import BPMN lỗi. Xem console để biết chi tiết.");
    }
  }

  private suggestedName(ext: string): string {
    return (this.file?.basename ?? "BPMN-Diagram") + ext;
  }

  private async handleExportSvg(): Promise<void> {
    if (!this.controller.isMounted) return;
    try {
      const svg = await this.controller.saveSvg();
      const saved = await saveToLocal(svg, this.suggestedName(".svg"), "image/svg+xml");
      if (saved) new Notice(`Đã export SVG: ${saved}`);
    } catch (err) {
      console.error("[BpmnNative] Export SVG failed:", err);
      new Notice("Export SVG lỗi.");
    }
  }

  private async handleExportPng(): Promise<void> {
    if (!this.controller.isMounted) return;
    try {
      const svg = await this.controller.saveSvg();
      const blob = await svgToPngBlob(svg);
      const saved = await saveToLocal(blob, this.suggestedName(".png"), "image/png");
      if (saved) new Notice(`Đã export PNG: ${saved}`);
    } catch (err) {
      console.error("[BpmnNative] Export PNG failed:", err);
      new Notice("Export PNG lỗi.");
    }
  }
}

interface FsPickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
    name: string;
  }>;
}

/**
 * Show a file picker (or fall back to a hidden `<input type="file">`) and
 * return the BPMN XML text. Returns `null` if the user cancels or selects
 * an unreadable file.
 */
async function pickLocalBpmnFile(): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".bpmn,.xml,application/xml,text/xml";
    input.style.display = "none";
    const cleanup = () => {
      input.remove();
    };
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        cleanup();
        resolve(null);
        return;
      }
      try {
        const text = await file.text();
        cleanup();
        resolve(text);
      } catch (err) {
        console.error("[BpmnNative] Read picked file failed:", err);
        cleanup();
        resolve(null);
      }
    };
    // Cancel cleanup: the browser does not always fire change on cancel,
    // so we attach a one-shot focus handler to detect dismiss.
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      setTimeout(() => {
        if (!input.files?.length) {
          cleanup();
          resolve(null);
        }
      }, 300);
    };
    window.addEventListener("focus", onFocus, { once: true });

    document.body.appendChild(input);
    input.click();
  });
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
      if ((err as DOMException)?.name === "AbortError") return null;
      throw err;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = suggestedName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return suggestedName;
}

function svgToPngBlob(svgString: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          
          const parser = new DOMParser();
          const doc = parser.parseFromString(svgString, "image/svg+xml");
          const svgEl = doc.querySelector("svg");
          const width = svgEl ? (parseInt(svgEl.getAttribute("width") || "800", 10)) : 800;
          const height = svgEl ? (parseInt(svgEl.getAttribute("height") || "600", 10)) : 600;
          
          const scale = 2;
          canvas.width = width * scale;
          canvas.height = height * scale;
          
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Could not get 2d context"));
            return;
          }
          
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          ctx.scale(scale, scale);
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            URL.revokeObjectURL(url);
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Canvas to blob conversion failed"));
            }
          }, "image/png");
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };

      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(new Error("SVG image load failed: " + String(err)));
      };

      img.src = url;
    } catch (err) {
      reject(err);
    }
  });
}
