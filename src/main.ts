import { Plugin, MarkdownView, Editor, Menu, Notice, TFile, WorkspaceLeaf, normalizePath, setIcon } from "obsidian";
import { BoardView, BOARD_VIEW_TYPE } from "./view/BoardView";
import { serializeBoard, deserializeBoard, OMNIBOARD_SUFFIX } from "./view/boardSerde";
import { importBpmn } from "./io/bpmn/import";
import { renderModelToSvg } from "./canvas/staticRender";
import { render, h } from "preact";
import { AdapterRegistry } from "./core/registry";
import { EmbedCard } from "./ui/EmbedCard";
import { OMNIBOARD_PROPERTIES_VIEW_TYPE, OmniboardPropertiesView } from "./ui/PropertiesPanel";
import { BpmnIssuesView, OMNIBOARD_ISSUES_VIEW_TYPE } from "./ui/BpmnIssuesView";
import type { DiagramAdapter } from "./core/adapter";
import { DiagramsSettings, DEFAULT_SETTINGS, DiagramsSettingTab } from "./settings";
import { BpmnNativeView, BPMN_NATIVE_VIEW_TYPE } from "./bpmn-native/BpmnNativeView";
import { BpmnPropertiesView, BPMN_PROPERTIES_VIEW_TYPE } from "./bpmn-native/BpmnPropertiesView";
import { registerBpmnIcons } from "./bpmn-native/bpmn-icons";
import { exportSvg, exportPng, exportPdf, saveToDisk } from "./io/cardExports";
import { FileBoardModal } from "./view/FileBoardModal";
import { BoardTypePicker, ExistingBoardPicker, type BoardTypeChoice } from "./ui/boardPickers";
import type { CanvasModel } from "./canvas/types";

import { bpmnAdapter } from "./adapters/bpmn";
import { erdAdapter } from "./adapters/erd";
import { flowchartAdapter } from "./adapters/flowchart";
import { umlAdapter } from "./adapters/uml";
import { sequenceAdapter } from "./adapters/sequence";
import { stateAdapter } from "./adapters/state";
import { mindmapAdapter } from "./adapters/mindmap";
import { mermaidAdapter } from "./adapters/mermaid";

const ALL_ADAPTERS: DiagramAdapter[] = [
  bpmnAdapter,
  erdAdapter,
  flowchartAdapter,
  umlAdapter,
  sequenceAdapter,
  stateAdapter,
  mindmapAdapter,
  mermaidAdapter,
];

export default class DiagramsPlugin extends Plugin {
  registry = new AdapterRegistry();
  settings: DiagramsSettings = DEFAULT_SETTINGS;
  private embedObserver: MutationObserver | null = null;
  private embedScanQueued = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    registerBpmnIcons();

    // ── Excalidraw-style board: shares the .md extension with Obsidian, but
    // auto-swaps to the board view when the file's frontmatter marks it as one.
    this.registerView(BOARD_VIEW_TYPE, (leaf) => new BoardView(leaf, this));
    this.registerView(OMNIBOARD_PROPERTIES_VIEW_TYPE, (leaf) => new OmniboardPropertiesView(leaf));
    this.registerView(OMNIBOARD_ISSUES_VIEW_TYPE, (leaf) => new BpmnIssuesView(leaf));
    // ── BPMN Native Mode (spike): dedicated view for .bpmn files
    this.registerView(BPMN_NATIVE_VIEW_TYPE, (leaf) => new BpmnNativeView(leaf, this));
    this.registerView(BPMN_PROPERTIES_VIEW_TYPE, (leaf) => new BpmnPropertiesView(leaf));
    this.registerExtensions(["bpmn"], BPMN_NATIVE_VIEW_TYPE);
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        void this.maybeSwapToBoardView(file);
        void this.maybeSwapToBpmnNativeView(file);
      })
    );

    // Add "Open as Omniboard" entry to the file's More-options menu (and
    // File Explorer context menu) for any *.omniboard.md file.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source) => {
        if (!(file instanceof TFile) || !file.path.endsWith(OMNIBOARD_SUFFIX)) return;
        const leaf = this.findLeafForFile(file);
        const inBoardView = leaf?.view?.getViewType() === BOARD_VIEW_TYPE;
        menu.addItem((item) => {
          item
            .setTitle(inBoardView ? "Open as Markdown" : "Open as Omniboard")
            .setIcon(inBoardView ? "file-text" : "shapes")
            .setSection?.("pane")
            .onClick(async () => {
              const target = leaf ?? this.app.workspace.getLeaf("tab");
              if (!leaf) await target.openFile(file);
              await target.setViewState({
                type: inBoardView ? "markdown" : BOARD_VIEW_TYPE,
                state: { file: file.path },
              });
            });
        });
      })
    );

    // ── The 3 quick board commands (Cmd+P). Both "create" commands open a
    //    one-step type picker; the third embeds an already-existing board. ──

    // Ribbon mirrors command 3 (new board, full canvas).
    this.addRibbonIcon("shapes", "Tạo board mới (full canvas)", () =>
      this.pickTypeThen((choice) => void this.createAndOpenBoard(choice)),
    );

    this.addCommand({
      id: "insert-new-board",
      name: "Chèn board mới vào note",
      editorCallback: (editor: Editor) =>
        this.pickTypeThen((choice) => void this.insertNewBoard(editor, choice)),
    });

    this.addCommand({
      id: "insert-existing-board",
      name: "Chèn board có sẵn vào note",
      editorCallback: (editor: Editor) =>
        new ExistingBoardPicker(this.app, (file) => {
          editor.replaceSelection(`![[${file.path}]]\n`);
        }).open(),
    });

    this.addCommand({
      id: "new-board-canvas",
      name: "Tạo board mới (full canvas)",
      callback: () =>
        this.pickTypeThen((choice) => void this.createAndOpenBoard(choice)),
    });

    this.addCommand({
      id: "open-as-markdown",
      name: "Open current board as Markdown",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf || leaf.view?.getViewType() !== BOARD_VIEW_TYPE) return false;
        if (checking) return true;
        void (leaf.view as BoardView).openAsMarkdown();
        return true;
      },
    });

    this.addCommand({
      id: "open-as-board",
      name: "Open current markdown as board",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf || leaf.view?.getViewType() !== "markdown") return false;
        const file = (leaf.view as MarkdownView).file;
        if (!file || !file.path.endsWith(OMNIBOARD_SUFFIX)) return false;
        if (checking) return true;
        void leaf.setViewState({ type: BOARD_VIEW_TYPE, state: { file: file.path } });
        return true;
      },
    });

    this.addCommand({
      id: "open-omniboard-properties",
      name: "Open Omniboard BPMN properties",
      callback: async () => {
        const existing = this.app.workspace.getLeavesOfType(OMNIBOARD_PROPERTIES_VIEW_TYPE)[0];
        const leaf = existing ?? this.app.workspace.getRightLeaf(false);
        if (!leaf) return;
        await leaf.setViewState({ type: OMNIBOARD_PROPERTIES_VIEW_TYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
      },
    });

    this.addCommand({
      id: "open-bpmn-native-properties",
      name: "Open BPMN Native properties",
      callback: async () => {
        const existing = this.app.workspace.getLeavesOfType(BPMN_PROPERTIES_VIEW_TYPE)[0];
        const leaf = existing ?? this.app.workspace.getRightLeaf(false);
        if (!leaf) return;
        await leaf.setViewState({ type: BPMN_PROPERTIES_VIEW_TYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
      },
    });

    this.addCommand({
      id: "open-omniboard-bpmn-issues",
      name: "Open Omniboard BPMN issues",
      callback: async () => {
        const existing = this.app.workspace.getLeavesOfType(OMNIBOARD_ISSUES_VIEW_TYPE)[0];
        const leaf = existing ?? this.app.workspace.getRightLeaf(false);
        if (!leaf) return;
        await leaf.setViewState({ type: OMNIBOARD_ISSUES_VIEW_TYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
      },
    });

    this.addCommand({
      id: "open-bpmn-native",
      name: "Open BPMN file in native mode",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return false;
        // @ts-expect-error view.file is available on FileView at runtime
        const file = leaf.view?.file as TFile | undefined;
        if (!file || !file.path.endsWith(".bpmn")) return false;
        if (checking) return true;
        void leaf.setViewState({ type: BPMN_NATIVE_VIEW_TYPE, state: { file: file.path } });
        return true;
      },
    });

    this.addCommand({
      id: "open-bpmn-source",
      name: "Open BPMN file as source",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return false;
        // @ts-expect-error view.file is available on FileView at runtime
        const file = leaf.view?.file as TFile | undefined;
        if (!file || !file.path.endsWith(".bpmn")) return false;
        if (checking) return true;
        void leaf.setViewState({ type: "markdown", state: { file: file.path } });
        return true;
      },
    });

    // Story 4.5 — Switch commands for wrapper format `.omniboard.md`.
    this.addCommand({
      id: "switch-to-bpmn-native",
      name: "Switch to BPMN Native view",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf || leaf.view?.getViewType() !== BOARD_VIEW_TYPE) return false;
        const file = (leaf.view as BoardView).file;
        if (!file || !file.path.endsWith(OMNIBOARD_SUFFIX)) return false;
        if (checking) return true;
        void (leaf.view as BoardView).switchToBpmnNativeView();
        return true;
      },
    });

    this.addCommand({
      id: "switch-to-board",
      name: "Switch to Omniboard view",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf || leaf.view?.getViewType() !== BPMN_NATIVE_VIEW_TYPE) return false;
        const view = leaf.view as BpmnNativeView;
        if (!view.isWrapperMode()) return false;
        if (checking) return true;
        void view.switchToBoardView();
        return true;
      },
    });

    this.addCommand({
      id: "convert-bpmn-to-wrapper",
      name: "Convert .bpmn to Omniboard wrapper (.omniboard.md)",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return false;
        // @ts-expect-error view.file is available on FileView at runtime
        const file = leaf.view?.file as TFile | undefined;
        if (!file || !file.path.endsWith(".bpmn")) return false;
        if (checking) return true;
        void this.convertBpmnToWrapper(file);
        return true;
      },
    });

    // Render ![[x.omniboard]] / ![[x.omniboard.md]] embeds as a preview card.
    //
    // SINGLE route: a MutationObserver replaces any omniboard `.internal-embed`
    // (the file has a `.md` extension, so Obsidian always renders it as a NATIVE
    // markdown embed in BOTH reading mode and Live Preview). Using one route
    // avoids the duplicate-card problem of running a CM6 editor extension AND a
    // post-processor side by side, and works identically across modes.
    this.installEmbedObserver();

    // Register adapters — used by the board type picker to seed a typed board.
    // Inline ```code``` diagram blocks are intentionally NOT rendered: every
    // diagram lives in a `.omniboard.md` file (single source of truth).
    for (const adapter of ALL_ADAPTERS) {
      this.registry.register(adapter);
    }

    this.addSettingTab(new DiagramsSettingTab(this.app, this));
  }

  onunload(): void {
    const styles = document.getElementById("bpmn-native-styles");
    if (styles) styles.remove();
    this.embedObserver?.disconnect();
    this.embedObserver = null;
  }

  /** Is this embed `src` an omniboard board file? */
  private isOmniboardEmbedSrc(src: string): boolean {
    const path = src.replace(/#.*$/, "");
    return path.endsWith(OMNIBOARD_SUFFIX) || path.endsWith(".omniboard");
  }

  /**
   * Watch the workspace for `.internal-embed` elements pointing at an omniboard
   * file and render our card into them. Scans are rAF-debounced and the
   * `.omniboard-embed-processed` class keeps each embed processed at most once
   * (renderBoardEmbed is itself idempotent), so this stays cheap even while
   * typing.
   */
  private installEmbedObserver(): void {
    const scan = (): void => {
      this.embedScanQueued = false;
      const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";
      // Scan ALL omniboard embeds (not just unprocessed ones): Obsidian may
      // asynchronously re-fill an embed's children after we render the card,
      // wiping our wrapper — renderBoardEmbed is idempotent (skips when its
      // wrapper is still present) and re-renders when it was removed.
      const nodes = this.app.workspace.containerEl.querySelectorAll<HTMLElement>(
        ".internal-embed",
      );
      nodes.forEach((node) => {
        const src = node.getAttribute("src") ?? "";
        if (!this.isOmniboardEmbedSrc(src)) return;
        void this.renderBoardEmbed(node, sourcePath);
      });
    };
    const observer = new MutationObserver(() => {
      if (this.embedScanQueued) return;
      this.embedScanQueued = true;
      window.requestAnimationFrame(scan);
    });
    observer.observe(this.app.workspace.containerEl, {
      childList: true,
      subtree: true,
    });
    this.embedObserver = observer;
    scan(); // pick up embeds already in the DOM at load time
  }

  /** Create a fresh, empty .omniboard.md file and return it (or null on failure). */
  /**
   * Convert a raw `.bpmn` file into a `.omniboard.md` wrapper next to it, then
   * open the wrapper in BoardView. Master block is canvas-data imported from
   * the BPMN XML; the original XML is embedded verbatim as the derived block.
   */
  private async convertBpmnToWrapper(bpmnFile: TFile): Promise<void> {
    try {
      const xml = await this.app.vault.read(bpmnFile);
      const { model, sourceMeta } = await importBpmn(xml);
      const basename = bpmnFile.basename;
      const dir = bpmnFile.parent?.path ?? "";
      const wrapperPath = normalizePath(
        (dir ? dir + "/" : "") + `${basename}${OMNIBOARD_SUFFIX}`,
      );
      const content = serializeBoard(model, "", sourceMeta, {
        compressDrawingData: this.settings.compressDrawingData,
        bpmnXml: xml,
      });
      // H7: do NOT silently overwrite an existing wrapper — caller is a
      // *convert* command, not "merge into existing". Bail with a Notice so
      // the user can rename or move the existing file first.
      const existing = this.app.vault.getAbstractFileByPath(wrapperPath);
      if (existing instanceof TFile) {
        new Notice(
          `Đã tồn tại "${wrapperPath}". Xoá hoặc đổi tên file đó trước khi convert.`,
          7000,
        );
        return;
      }
      let wrapperFile: TFile;
      try {
        wrapperFile = await this.app.vault.create(wrapperPath, content);
      } catch (createErr) {
        console.error("[omniboard] vault.create failed for wrapper", createErr);
        new Notice("Không tạo được file wrapper .omniboard.md (xem console).");
        return;
      }
      const leaf = this.app.workspace.getLeaf(false);
      if (!leaf) {
        new Notice("Không lấy được leaf để mở wrapper. File đã tạo: " + wrapperFile.path);
        return;
      }
      await leaf.setViewState({ type: BOARD_VIEW_TYPE, state: { file: wrapperFile.path } });
      new Notice(`Đã tạo wrapper: ${wrapperFile.path}`);
    } catch (err) {
      console.error("[omniboard] convertBpmnToWrapper failed", err);
      new Notice("Convert BPMN → wrapper thất bại. Xem console để biết chi tiết.");
    }
  }

  /**
   * Create a new `.omniboard.md` file in the configured board folder.
   * `seedModel` pre-fills the canvas (used to create a typed board, e.g. a
   * flowchart); omit for an empty board. `baseName` overrides the timestamp
   * file name.
   */
  private async createBoardFile(
    seedModel?: CanvasModel,
    baseName?: string,
  ): Promise<TFile | null> {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const name = (baseName?.trim() || `Omniboard ${stamp}`).replace(/[\\/:*?"<>|]/g, "-");
    const dir = await this.ensureBoardFolder();
    const path = normalizePath((dir ? dir + "/" : "") + `${name}${OMNIBOARD_SUFFIX}`);
    const content = serializeBoard(seedModel ?? { nodes: [], edges: [] }, "", undefined, {
      compressDrawingData: this.settings.compressDrawingData,
    });
    try {
      return await this.app.vault.create(path, content);
    } catch {
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) return existing;
      new Notice("Không tạo được file omniboard.");
      return null;
    }
  }

  /** Ensure the configured board folder exists; returns its normalized path
   *  (empty string when configured as vault root). */
  private async ensureBoardFolder(): Promise<string> {
    const folder = this.settings.boardFolder?.trim() ?? "";
    if (!folder) return "";
    const dir = normalizePath(folder);
    if (!this.app.vault.getAbstractFileByPath(dir)) {
      try {
        await this.app.vault.createFolder(dir);
      } catch {
        // Folder may have been created concurrently — ignore and fall back to
        // root if it still doesn't resolve.
        if (!this.app.vault.getAbstractFileByPath(dir)) return "";
      }
    }
    return dir;
  }

  /** Build the type-picker choices: a blank board + one per registered adapter. */
  private boardTypeChoices(): BoardTypeChoice[] {
    return [
      { adapter: null, label: "Board trắng", icon: "square-dashed" },
      ...this.registry.all().map((a) => ({
        adapter: a,
        label: a.displayName,
        icon: a.icon,
      })),
    ];
  }

  /** Open the type picker, then run `cb` with the chosen type. */
  private pickTypeThen(cb: (choice: BoardTypeChoice) => void): void {
    new BoardTypePicker(this.app, this.boardTypeChoices(), cb).open();
  }

  /** Seed an empty CanvasModel for a picker choice (blank → empty board). */
  private async seedModelForChoice(choice: BoardTypeChoice): Promise<CanvasModel> {
    const adapter = choice.adapter;
    if (adapter?.toEditor) {
      try {
        const session = await adapter.toEditor(adapter.emptyTemplate());
        return session.model;
      } catch (e) {
        console.warn("[omniboard] seedModelForChoice toEditor failed", e);
      }
    }
    return { nodes: [], edges: [] };
  }

  /** Create a board file for the chosen type and embed it at the cursor. */
  private async insertNewBoard(editor: Editor, choice: BoardTypeChoice): Promise<void> {
    const model = await this.seedModelForChoice(choice);
    const file = await this.createBoardFile(model, choice.adapter?.displayName);
    if (!file) return;
    editor.replaceSelection(`![[${file.path}]]\n`);
  }

  /** Open `file` in the full-tab BoardView (single source of truth canvas). */
  async openBoardFile(file: TFile): Promise<void> {
    const leaf = this.findLeafForFile(file) ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: BOARD_VIEW_TYPE, state: { file: file.path } });
    this.app.workspace.revealLeaf(leaf);
  }

  /** Open the popup board editor for `file` (edits the file in place). */
  openFileBoardEditor(file: TFile): void {
    new FileBoardModal(this.app, this, file).open();
  }

  /**
   * When Obsidian opens a `.omniboard.md` file in the default markdown view,
   * swap the leaf over to the dedicated board view. Lookup goes through
   * metadataCache so a manual edit removing the marker frontmatter cleanly
   * falls back to the markdown view.
   */
  private async maybeSwapToBoardView(file: TFile | null): Promise<void> {
    if (!file || !file.path.endsWith(OMNIBOARD_SUFFIX)) return;
    const ok = await this.hasOmniboardFrontmatter(file);
    if (!ok) return;
    const leaf = this.findLeafForFile(file);
    if (!leaf || leaf.view?.getViewType() === BOARD_VIEW_TYPE) return;
    await leaf.setViewState({ type: BOARD_VIEW_TYPE, state: { file: file.path } });
  }

  /** Auto-swap .bpmn files to the BPMN Native view. */
  private async maybeSwapToBpmnNativeView(file: TFile | null): Promise<void> {
    if (!file || !file.path.endsWith(".bpmn")) return;
    const leaf = this.findLeafForFile(file);
    if (!leaf || leaf.view?.getViewType() === BPMN_NATIVE_VIEW_TYPE) return;
    await leaf.setViewState({ type: BPMN_NATIVE_VIEW_TYPE, state: { file: file.path } });
  }

  /** Resolve the marker frontmatter. metadataCache may not have indexed the
   *  file yet (freshly created / vault sync), so fall back to a quick raw read. */
  private async hasOmniboardFrontmatter(file: TFile): Promise<boolean> {
    const cache = this.app.metadataCache.getFileCache(file);
    const cached = cache?.frontmatter?.["omniboard-plugin"];
    if (cached === "parsed") return true;
    if (cached !== undefined) return false; // metadataCache present but doesn't have the marker
    try {
      const raw = await this.app.vault.cachedRead(file);
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
      if (!m) return false;
      // Accept bare or quoted YAML value: `omniboard-plugin: parsed` /
      // `omniboard-plugin: "parsed"` / `omniboard-plugin: 'parsed'`.
      return /^omniboard-plugin\s*:\s*["']?parsed["']?\s*$/m.test(m[1]);
    } catch {
      return false;
    }
  }

  private findLeafForFile(file: TFile): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((l) => {
      // @ts-expect-error - view.file is available on FileView/MarkdownView at runtime
      if (l.view?.file?.path === file.path) found = l;
    });
    return found;
  }

  /** Create a board file for the chosen type and open it in the full board view. */
  private async createAndOpenBoard(choice: BoardTypeChoice): Promise<void> {
    const model = await this.seedModelForChoice(choice);
    const file = await this.createBoardFile(model, choice.adapter?.displayName);
    if (!file) return;
    await this.openBoardFile(file);
  }

  /**
   * Render an `![[x.omniboard.md]]` internal embed as a preview card.
   *
   * Idempotent: the card is rendered into a dedicated `.omniboard-embed-cardwrap`
   * child. If that child is already present we skip — this lets the
   * MutationObserver fallback call us repeatedly without churning the card, and
   * survives Obsidian asynchronously re-filling the embed with the file's raw
   * markdown (that native content is hidden by CSS; see styles.css).
   */
  private async renderBoardEmbed(host: HTMLElement, sourcePath: string): Promise<void> {
    if (host.querySelector(":scope > .omniboard-embed-cardwrap")) return;
    const src = host.getAttribute("src");
    if (!src) return;
    const file = this.app.metadataCache.getFirstLinkpathDest(src.replace(/#.*$/, ""), sourcePath);
    if (!(file instanceof TFile)) return;
    host.addClass("omniboard-embed-processed");
    // Mark the native chrome (title/link) as hidden but keep it in the DOM so
    // Obsidian's embed bookkeeping stays intact. Our card goes in a fresh wrap.
    const wrap = host.createDiv({ cls: "omniboard-embed-cardwrap" });

    // Render the <EmbedCard> into the wrapper (the MutationObserver drives this
    // for both Reading mode and Live Preview).
    let nodeCount = 0;
    let edgeCount = 0;
    let svg: string | undefined = undefined;
    let errorMessage: string | undefined = undefined;
    let model: CanvasModel | null = null;
    try {
      const raw = await this.app.vault.cachedRead(file);
      model = deserializeBoard(raw);
      if (!model) {
        errorMessage = "File không đúng định dạng Omniboard.";
      } else {
        nodeCount = model.nodes?.length ?? 0;
        edgeCount = model.edges?.length ?? 0;
        // Empty board → svg="" so the empty-state copy renders.
        svg = nodeCount > 0 ? renderModelToSvg(model, "", 16, "transparent") : "";
      }
    } catch {
      errorMessage = "Không đọc được board.";
    }

    render(
      h(EmbedCard, {
        title: file.basename,
        nodeCount,
        edgeCount,
        svg,
        errorMessage,
        onEdit: () => this.openFileBoardEditor(file),
        onExportMenu: model
          ? (e) => this.buildBoardExportMenu(model!, file.basename).showAtMouseEvent(e)
          : undefined,
        onMoreMenu: (e) => this.buildBoardMoreMenu(file, model, sourcePath).showAtMouseEvent(e),
        setIcon: (el, name) => setIcon(el, name),
      }),
      wrap,
    );
  }

  /** Export menu (SVG / PNG / PDF) for a board model — shared by embed cards.
   *  Uses the standalone static renderer (self-contained SVG via collectPluginCss)
   *  so it works without a live canvas. */
  buildBoardExportMenu(model: CanvasModel, baseName: string): Menu {
    const menu = new Menu();
    const run = async (
      fn: () => Promise<string | null>,
    ): Promise<void> => {
      try {
        const saved = await fn();
        if (saved) new Notice(`Đã export: ${saved}`);
      } catch (err) {
        console.warn("[omniboard] board export failed", err);
        new Notice("Export thất bại — xem console.");
      }
    };
    menu.addItem((i) =>
      i.setTitle("SVG").setIcon("file-code").onClick(() =>
        void run(() => saveToDisk(exportSvg(model), `${baseName}.svg`, "image/svg+xml")),
      ),
    );
    menu.addItem((i) =>
      i.setTitle("PNG").setIcon("image").onClick(() =>
        void run(async () => saveToDisk(await exportPng(model, 2), `${baseName}.png`, "image/png")),
      ),
    );
    menu.addItem((i) =>
      i.setTitle("PDF").setIcon("file-text").onClick(() =>
        void run(async () => saveToDisk(await exportPdf(model), `${baseName}.pdf`, "application/pdf")),
      ),
    );
    return menu;
  }

  /** Overflow (⋯) menu for a board embed card. `hostPath` is the note the
   *  embed lives in — used by "Xóa khỏi note" to remove the `![[...]]` line. */
  buildBoardMoreMenu(file: TFile, model: CanvasModel | null, hostPath: string): Menu {
    const menu = new Menu();
    menu.addItem((i) =>
      i.setTitle("Sửa toàn màn hình").setIcon("maximize-2").onClick(() => void this.openBoardFile(file)),
    );
    menu.addItem((i) =>
      i.setTitle("Mở trong tab mới").setIcon("external-link").onClick(() =>
        void this.app.workspace.getLeaf("tab").openFile(file),
      ),
    );
    if (model) {
      menu.addItem((i) =>
        i.setTitle("Copy as image").setIcon("clipboard-copy").onClick(async () => {
          try {
            const png = await exportPng(model, 2);
            await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
            new Notice("Đã copy vào clipboard");
          } catch {
            new Notice("Copy clipboard thất bại (browser có thể không hỗ trợ).");
          }
        }),
      );
    }
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle("Xóa khỏi note")
        .setIcon("trash-2")
        .onClick(() => void this.removeEmbedFromNote(file, hostPath)),
    );
    return menu;
  }

  /**
   * Remove the `![[boardFile]]` embed from the note at `hostPath` (the board
   * file itself is kept — it's the single source of truth). Uses the metadata
   * cache to locate the exact embed by resolved target, so only this board's
   * embed is removed even when the note embeds several boards.
   */
  private async removeEmbedFromNote(boardFile: TFile, hostPath: string): Promise<void> {
    const host = this.app.vault.getAbstractFileByPath(hostPath);
    if (!(host instanceof TFile)) {
      new Notice("Không tìm thấy note chứa board.");
      return;
    }
    const embeds = this.app.metadataCache.getFileCache(host)?.embeds ?? [];
    const target = embeds.find((e) => {
      const dest = this.app.metadataCache.getFirstLinkpathDest(
        e.link.replace(/#.*$/, ""),
        hostPath,
      );
      return dest?.path === boardFile.path;
    });
    if (!target) {
      new Notice("Không tìm thấy embed của board trong note này.");
      return;
    }
    try {
      const content = await this.app.vault.read(host);
      const { start, end } = target.position;
      // Drop the embed text; also swallow a trailing newline so the board's
      // own line doesn't leave a blank gap behind.
      let after = end.offset;
      if (content[after] === "\n") after += 1;
      const next = content.slice(0, start.offset) + content.slice(after);
      await this.app.vault.modify(host, next);
      new Notice("Đã gỡ board khỏi note.");
    } catch (e) {
      console.error("[omniboard] removeEmbedFromNote failed", e);
      new Notice("Gỡ board khỏi note thất bại — xem console.");
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
